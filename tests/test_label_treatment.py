"""Head B hand-labelling: resumable, deterministic, append-only."""

import pytest

from training.scanner.label_treatment import KEYS, append_label, load_labels, todo


def test_labels_append_and_reload(tmp_path):
    csv_path = tmp_path / "treatment_labels.csv"
    append_label(csv_path, "fabric/train/lace/a.jpg", "piece_dyed")
    append_label(csv_path, "fabric/train/knit/b.jpg", "printed")
    assert load_labels(csv_path) == {
        "fabric/train/lace/a.jpg": "piece_dyed",
        "fabric/train/knit/b.jpg": "printed",
    }


def test_todo_is_deterministic_and_skips_done():
    pool = [f"img{i}.jpg" for i in range(50)]
    first = todo(pool, {}, 10, seed=0)
    assert first == todo(pool, {}, 10, seed=0) and len(first) == 10
    rest = todo(pool, {p: "printed" for p in first}, 10, seed=0)
    assert not set(first) & set(rest)


def test_the_four_treatments_have_keys():
    assert set(KEYS.values()) == {"printed", "piece_dyed", "yarn_dyed", "undyed"}


def _label(tmp_path, monkeypatch, splits: dict[str, str], keys: tuple[str, ...]) -> dict:
    """Run the tool on images named after ``splits`` (name -> split), pressing ``keys``."""
    mpl = pytest.importorskip("matplotlib")
    Image = pytest.importorskip("PIL.Image")
    mpl.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backend_bases import KeyEvent

    from training.scanner.label_treatment import main

    rows = ["path,label,split,source,sha1"]
    for name, split in splits.items():
        p = tmp_path / "data" / "fabric" / split / "lace" / f"{name}.jpg"
        p.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (8, 8)).save(p)
        rows.append(f"fabric/{split}/lace/{name}.jpg,lace,{split},archive,x")
    (tmp_path / "split.csv").write_text("\n".join(rows) + "\n")
    monkeypatch.chdir(tmp_path)

    def press_keys():
        assert "s" not in plt.rcParams["keymap.save"]  # else 's' opens a save dialog
        canvas = plt.gcf().canvas
        for key in keys:
            canvas.callbacks.process("key_press_event", KeyEvent("key_press_event", canvas, key))

    monkeypatch.setattr(plt, "show", press_keys)
    main(["--split", "split.csv", "--data-root", "data", "--n", str(len(splits))])
    return load_labels(tmp_path / "data" / "treatment_labels.csv")


def test_keypresses_label_and_skip_without_matplotlib_saving(tmp_path, monkeypatch):
    labels = _label(tmp_path, monkeypatch, {"a": "train", "b": "train"}, ("1", "s"))
    assert list(labels.values()) == ["printed"]


def test_val_images_are_queued_too_since_head_b_calibrates_on_val(tmp_path, monkeypatch):
    splits = {"a": "train", "b": "val", "c": "test"}
    labels = _label(tmp_path, monkeypatch, splits, ("1", "1"))
    assert sorted(labels) == ["fabric/train/lace/a.jpg", "fabric/val/lace/b.jpg"]


def test_skipped_images_are_not_queued_again(tmp_path, monkeypatch):
    splits = {"a": "train", "b": "train"}
    _label(tmp_path, monkeypatch, splits, ("s",))
    labels = _label(tmp_path, monkeypatch, splits, ("1",))  # a second session
    skipped = load_labels(tmp_path / "data" / "treatment_skips.csv")
    assert len(skipped) == 1 and len(labels) == 1 and not set(skipped) & set(labels)


def test_u_goes_back_so_a_wrong_key_can_be_fixed(tmp_path, monkeypatch):
    labels = _label(tmp_path, monkeypatch, {"a": "train", "b": "train"}, ("1", "u", "2"))
    assert list(labels.values()) == ["piece_dyed"]
