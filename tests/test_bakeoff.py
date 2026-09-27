"""Bake-off mechanics with fake backends: caching, per-item failure, the decision rule."""

import json

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.datasets.base import Sample  # noqa: E402
from services.vision.garment import Detection  # noqa: E402
from training.scanner.bakeoff import pick, run_detector  # noqa: E402


def _samples(tmp_path, n=3):
    out = []
    for i in range(n):
        p = tmp_path / f"{i}_garment.jpg"
        Image.new("RGB", (40, 40), "gray").save(p)
        out.append(Sample(image_path=p, group_id=str(i), garment_type="pants"))
    return out


class Fake:
    name, default_min_score = "fake", 0.3

    def __init__(self):
        self.calls = 0

    def detect(self, image):
        self.calls += 1
        if self.calls == 2:
            raise RuntimeError("boom")
        return [Detection("pants", 0.9, (0, 0, 40, 40))]


def test_one_crash_is_one_failed_item_not_an_aborted_run(tmp_path):
    rows = run_detector("fake", _samples(tmp_path), lambda: Fake(), tmp_path / "cache")
    assert [r["label"] for r in rows] == ["pants", None, "pants"]
    assert rows[1]["error"] == "RuntimeError: boom"


def test_predictions_are_cached_and_reused(tmp_path):
    samples = _samples(tmp_path)
    run_detector("fake", samples, lambda: Fake(), tmp_path / "cache")
    loads = []
    rows = run_detector("fake", samples, lambda: loads.append(1) or Fake(), tmp_path / "cache")
    assert loads == [] and len(rows) == 3
    assert json.loads((tmp_path / "cache" / "det_fake.json").read_text())[0]["id"] == "0"


def test_pick_prefers_the_faster_within_two_points():
    assert pick({"gdino": (0.81, 0.9), "owlv2": (0.80, 0.4)}) == "owlv2"
    assert pick({"gdino": (0.85, 0.9), "owlv2": (0.80, 0.4)}) == "gdino"
