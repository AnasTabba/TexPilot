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


def test_keypresses_label_and_skip_without_matplotlib_saving(tmp_path, monkeypatch):
    mpl = pytest.importorskip("matplotlib")
    Image = pytest.importorskip("PIL.Image")
    mpl.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backend_bases import KeyEvent

    from training.scanner.label_treatment import main

    for name in ("a", "b"):
        p = tmp_path / "data" / "fabric" / "train" / "lace" / f"{name}.jpg"
        p.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (8, 8)).save(p)
    split = tmp_path / "split.csv"
    split.write_text(
        "path,label,split,source,sha1\n"
        "fabric/train/lace/a.jpg,lace,train,archive,x\n"
        "fabric/train/lace/b.jpg,lace,train,archive,x\n"
    )
    monkeypatch.chdir(tmp_path)

    def press_keys():
        assert "s" not in plt.rcParams["keymap.save"]  # else 's' opens a save dialog
        canvas = plt.gcf().canvas
        for key in ("1", "s"):
            canvas.callbacks.process("key_press_event", KeyEvent("key_press_event", canvas, key))

    monkeypatch.setattr(plt, "show", press_keys)
    main(["--split", str(split), "--data-root", str(tmp_path / "data"), "--n", "2"])
    assert list(load_labels(tmp_path / "data" / "treatment_labels.csv").values()) == ["printed"]
