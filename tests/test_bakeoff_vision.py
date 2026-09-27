"""Scanner-on-phone-set mechanics with a fake predictor."""

import pytest

pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.datasets.base import Sample  # noqa: E402
from services.vision.predictor import GarmentOutput, HeadOutput, VisionOutput  # noqa: E402
from training.scanner.bakeoff import head_accuracy, run_vision, threshold_records  # noqa: E402


class FakeScanner:
    def predict(self, data):
        return VisionOutput(
            HeadOutput("denim", 0.95, []),
            None,
            HeadOutput("synthetic", 0.93, []),
            garment=GarmentOutput("pants", 0.8, (0, 0, 1, 1)),
        )


def test_run_vision_records_heads_and_caches(tmp_path):
    p = tmp_path / "1_garment.jpg"
    Image.new("RGB", (20, 20)).save(p)
    rows = run_vision(
        "crop", [Sample(image_path=p, group_id="1")], lambda: FakeScanner(), tmp_path / "c"
    )
    assert rows[0]["structure"] == ["denim", 0.95] and rows[0]["family"] == ["synthetic", 0.93]
    assert (tmp_path / "c" / "vision_crop.json").exists()


def test_abstention_counts_as_wrong_and_lowers_coverage():
    rows = [
        {"id": "a", "family": ["cellulosic", 0.9]},
        {"id": "b", "family": None},
        {"id": "c", "family": ["protein", 0.9]},
    ]
    acc, cov, n = head_accuracy(
        rows, {"a": "cellulosic", "b": "synthetic", "c": "synthetic"}, "family"
    )
    assert (acc, cov, n) == (pytest.approx(1 / 3), pytest.approx(2 / 3), 3)


def test_threshold_records_pair_vision_with_labels_and_skip_failures():
    rows = [
        {"id": "a", "structure": None, "family": ["synthetic", 0.95], "error": None},
        {"id": "b", "structure": None, "family": None, "error": "RuntimeError: x"},
    ]
    recs = threshold_records(rows, {"a": "synthetic", "b": "cellulosic"})
    assert {(tuple(r["stated"]), r["should_flag"]) for r in recs} == {
        (("synthetic",), False),
        (("cellulosic",), True),
    }
