"""Benchmark runner: fake Method on synthetic PNGs in tmp_path. Checks threshold source,
perturbation handling, unified fit count, JSON output and single-tile images. No model needed."""

import json

import pytest

np = pytest.importorskip("numpy")
PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

from training.fault.bench import _mask, run_benchmark  # noqa: E402
from training.fault.data import Sample  # noqa: E402

ROW_KEYS = {
    "dataset", "category", "method", "mode", "perturbation", "auroc", "ap", "pixel_auroc",
    "pixel_ap", "aupro", "f1", "recall", "precision", "false_alarms_per_1000", "fa_ci95",
    "n_good", "n_defect", "threshold", "latency_ms", "tiles_per_image",
}  # fmt: skip


class FakeMethod:
    """Map = red channel of each tile. Records how often fit was called."""

    name = "fake_brightness"

    def __init__(self) -> None:
        self.fit_calls: list[int] = []

    def fit(self, train: list) -> None:
        self.fit_calls.append(len(train))

    def score_tiles(self, tiles: list) -> list:
        return [t[..., 0].astype(np.float32) for t in tiles]


class FakeTransductive(FakeMethod):
    """FakeMethod that declares transductive=True and records the size of every call."""

    name = "fake_transductive"
    transductive = True

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[int] = []

    def score_tiles(self, tiles: list) -> list:
        self.calls.append(len(tiles))
        return super().score_tiles(tiles)


def _write(path, arr) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path)
    return str(path)


def _dark(size: int) -> np.ndarray:
    return np.full((size, size, 3), 40, np.uint8)


def _make_samples(root, categories=("carpet", "grid"), size=128, test_value=None):
    """Dark good images; defects have a white square and a mask. Test images can be overwritten
    with `test_value` (a constant grey) to check that the threshold never reads test pixels."""
    out: list[Sample] = []
    for cat in categories:
        base = root / cat
        for i in range(3):
            p = _write(base / "train" / f"g{i}.png", _dark(size))
            out.append(Sample(p, 0, None, cat, "fake", "train"))
        for i in range(2):
            p = _write(base / "calib" / f"c{i}.png", _dark(size))
            out.append(Sample(p, 0, None, cat, "fake", "calib"))
        for i in range(2):
            img = _dark(size)
            if test_value is not None:
                img = np.full((size, size, 3), test_value, np.uint8)
            p = _write(base / "test" / f"good{i}.png", img)
            out.append(Sample(p, 0, None, cat, "fake", "test"))
        for i in range(2):
            img = _dark(size)
            mask = np.zeros((size, size), np.uint8)
            img[20:60, 20:60] = 255
            mask[20:60, 20:60] = 255
            if test_value is not None:
                img = np.full((size, size, 3), test_value, np.uint8)
            p = _write(base / "test" / f"bad{i}.png", img)
            m = _write(base / "gt" / f"bad{i}_mask.png", mask)
            out.append(Sample(p, 1, m, cat, "fake", "test"))
    return out


def test_run_benchmark_with_fake_method(tmp_path):
    samples = _make_samples(tmp_path / "data")
    out = tmp_path / "res" / "fake.json"
    result = run_benchmark(FakeMethod(), samples, out)

    rows = result["rows"]
    timing = result["timing"]
    assert timing["train_tiles"] == 6
    assert timing["test_images"] == 8 and timing["test_tiles"] == 8
    assert all(
        timing[key] >= 0 for key in ("load_tile_seconds", "fit_seconds", "evaluation_seconds")
    )
    assert [r["category"] for r in rows] == ["carpet", "grid"]
    for r in rows:
        assert set(r) == ROW_KEYS
        assert r["auroc"] == 1.0
        assert r["pixel_auroc"] is not None
        assert r["n_good"] == 2 and r["n_defect"] == 2
        assert r["threshold"] == pytest.approx(40.0)
        assert r["mode"] == "per_category" and r["perturbation"] is None
        assert r["tiles_per_image"] == 1.0

    # Threshold must come from calib only: replace every test image and it must not move.
    samples2 = _make_samples(tmp_path / "data2", test_value=250)
    rows2 = run_benchmark(FakeMethod(), samples2, tmp_path / "res" / "fake2.json")["rows"]
    assert [r["threshold"] for r in rows2] == [r["threshold"] for r in rows]


def test_transductive_method_scores_category_in_one_call(tmp_path):
    samples = _make_samples(tmp_path / "data", categories=("carpet",))
    method = FakeTransductive()
    rows = run_benchmark(method, samples, tmp_path / "tr.json")["rows"]
    # calib (2 images) is scored in one call, then all test images (4) in one call
    assert method.calls == [2, 4]
    assert rows[0]["auroc"] == 1.0
    assert rows[0]["tiles_per_image"] == 1.0
    assert rows[0]["latency_ms"] is not None and rows[0]["latency_ms"] >= 0.0


def test_unified_mode_fits_once(tmp_path):
    samples = _make_samples(tmp_path / "data")
    method = FakeMethod()
    rows = run_benchmark(method, samples, tmp_path / "u.json", mode="unified")["rows"]
    assert method.fit_calls == [6]  # 3 train images x 2 categories, one tile each
    assert len(rows) == 2 and all(r["mode"] == "unified" for r in rows)


def test_perturbation_leaves_threshold_unchanged(tmp_path):
    samples = _make_samples(tmp_path / "data")
    clean = run_benchmark(FakeMethod(), samples, tmp_path / "c.json")["rows"]
    pert = run_benchmark(FakeMethod(), samples, tmp_path / "p.json", perturbation="brightness_up")[
        "rows"
    ]
    assert [r["threshold"] for r in pert] == [r["threshold"] for r in clean]
    assert all(r["perturbation"] == "brightness_up" for r in pert)


def test_json_output_equals_returned_rows(tmp_path):
    samples = _make_samples(tmp_path / "data")
    out = tmp_path / "deep" / "dir" / "res.json"
    rows = run_benchmark(FakeMethod(), samples, out)["rows"]
    assert json.loads(out.read_text()) == rows


def test_small_image_is_one_tile(tmp_path):
    samples = _make_samples(tmp_path / "data", categories=("tiny",), size=64)
    rows = run_benchmark(FakeMethod(), samples, tmp_path / "t.json")["rows"]
    assert len(rows) == 1
    assert rows[0]["tiles_per_image"] == 1.0
    assert rows[0]["auroc"] == 1.0


def test_mask_string_is_union_and_grey_threshold(tmp_path):
    a = np.zeros((8, 8), np.uint8)
    a[0:2, 0:2] = 255
    a[4, 4] = 60  # soft edge: background
    b = np.zeros((8, 8), np.uint8)
    b[6:8, 6:8] = 255
    b[3, 3] = 200  # defect
    pa = _write(tmp_path / "a.png", a)
    pb = _write(tmp_path / "b.png", b)
    sample = Sample("img.png", 1, f"{pa};{pb}", "carpet", "fake", "test")

    m = _mask(sample, 8, 8)

    expected = np.zeros((8, 8), np.uint8)
    expected[0:2, 0:2] = 1
    expected[6:8, 6:8] = 1
    expected[3, 3] = 1
    assert np.array_equal(m, expected)
    assert m[4, 4] == 0


def test_unknown_mode_raises(tmp_path):
    with pytest.raises(ValueError):
        run_benchmark(FakeMethod(), [], tmp_path / "x.json", mode="bogus")


def test_unmasked_defect_is_left_out_of_pixel_metrics(tmp_path, capsys):
    samples = _make_samples(tmp_path / "data", categories=("carpet",))
    img = _dark(128)
    img[20:60, 20:60] = 255
    p = _write(tmp_path / "data" / "carpet" / "test" / "bad_nomask.png", img)
    unmasked = Sample(p, 1, None, "carpet", "fake", "test")

    without = run_benchmark(FakeMethod(), samples, tmp_path / "without.json")["rows"][0]
    assert "no mask" not in capsys.readouterr().out

    with_ = run_benchmark(FakeMethod(), samples + [unmasked], tmp_path / "with.json")["rows"][0]
    out = capsys.readouterr().out

    assert with_["pixel_ap"] == pytest.approx(1.0)
    for key in ("pixel_auroc", "pixel_ap", "aupro"):
        assert with_[key] == pytest.approx(without[key])
    assert with_["n_defect"] == without["n_defect"] + 1  # image metrics keep every image
    assert "carpet" in out and "1 defect image(s) had no mask" in out


def test_category_without_calib_is_skipped(tmp_path, capsys):
    samples = [s for s in _make_samples(tmp_path / "data") if not (
        s.category == "grid" and s.split == "calib"
    )]  # fmt: skip
    rows = run_benchmark(FakeMethod(), samples, tmp_path / "s.json")["rows"]
    assert [r["category"] for r in rows] == ["carpet"]
    assert "grid" in capsys.readouterr().out
