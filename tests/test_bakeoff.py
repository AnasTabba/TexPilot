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
    assert json.loads((tmp_path / "cache" / "det_fake.json").read_text())["rows"][0]["id"] == "0"


def test_pick_prefers_the_faster_within_two_points():
    assert pick({"gdino": (0.81, 0.9), "owlv2": (0.80, 0.4)}) == "owlv2"
    assert pick({"gdino": (0.85, 0.9), "owlv2": (0.80, 0.4)}) == "gdino"


def test_a_grown_set_is_recomputed_not_served_stale(tmp_path):
    samples = _samples(tmp_path, n=3)
    run_detector("fake", samples[:2], lambda: Fake(), tmp_path / "cache")
    rows = run_detector("fake", samples, lambda: Fake(), tmp_path / "cache")
    assert [r["id"] for r in rows] == ["0", "1", "2"]


def test_a_backend_that_never_answered_cannot_win_on_speed():
    from training.scanner.bakeoff import row_latency

    alive = row_latency([{"seconds": 1.2}])["p50"]
    dead = row_latency([{"seconds": None}, {"seconds": None}])["p50"]
    assert pick({"gdino": (0.015, alive), "owlv2": (0.0, dead)}) == "gdino"


def test_ocr_is_scored_only_where_the_label_parses_and_was_photographed(tmp_path):
    from training.scanner.bakeoff import ocr_scorable

    p = tmp_path / "x.jpg"
    samples = [
        Sample(image_path=p, group_id="a", label_text="100% COTTON", label_image_path=p),
        Sample(image_path=p, group_id="b", label_text="100% LUREX", label_image_path=p),
        Sample(image_path=p, group_id="c", label_text="100% COTTON"),
    ]
    scorable, unparsed, no_photo = ocr_scorable(samples)
    assert [s.group_id for s in scorable] == ["a"] and unparsed == ["b"] and no_photo == ["c"]


def test_ocr_score_has_exact_match_read_rate_and_character_error_rate(tmp_path):
    from training.scanner.bakeoff import score_ocr

    p = tmp_path / "x.jpg"
    scorable = [
        Sample(image_path=p, group_id=g, label_text="80% PA 20% EA", label_image_path=p)
        for g in "ab"
    ]
    rows = [
        {"id": "a", "fibres": [["nylon", 80.0], ["elastane_spandex", 20.0]],
         "text": "80% PA 20% EA", "seconds": 1.0, "error": None},
        {"id": "b", "fibres": None, "text": None, "seconds": 3.0, "error": None},
    ]  # fmt: skip
    got = score_ocr(rows, scorable)
    assert got["exact"] == 0.5 and got["read_rate"] == 0.5
    assert got["cer"] == pytest.approx(0.5)  # one perfect read, one empty
    assert got["p50"] == 2.0 and got["failures"] == 0


def test_main_writes_a_report_end_to_end_with_fake_backends(tmp_path, monkeypatch):
    import services.ocr.engines as engines
    import services.vision.detectors as detectors
    import services.vision.runtime as runtime
    import services.vision.scanner as scanner
    from services.ocr.engines.base import TextLine
    from services.vision.predictor import HeadOutput, VisionOutput
    from training.scanner.bakeoff import main

    phone = tmp_path / "phone"
    phone.mkdir()
    (phone / "ground_truth.csv").write_text(
        "id,garment_type,label_text,fabric_structure,photographer,phone_model,notes\n"
        "001_AT,pants,100% COTTON,denim,AT,x,\n"
        "002_AT,pants,100% LUREX,,AT,x,\n"
    )
    for gid in ("001_AT", "002_AT"):
        for role in ("garment", "label"):
            Image.new("RGB", (40, 40), "gray").save(phone / f"{gid}_{role}.jpg")

    class Engine:
        def read(self, image):
            return [TextLine("100% COTTON", 0.9, (0, 0, 100, 8))]

    class Scan:
        def predict(self, data):
            return VisionOutput(
                HeadOutput("denim", 0.9, []), None, HeadOutput("cellulosic", 0.95, [])
            )

    monkeypatch.setattr(runtime, "pick_device", lambda *a: "cpu")
    monkeypatch.setattr(detectors, "load_detector", lambda n, d: Fake())
    monkeypatch.setattr(engines, "load_engine", lambda n: Engine())
    monkeypatch.setattr(scanner, "build_scanner", lambda *a, **k: Scan())
    out = tmp_path / "out"
    assert main(["--phone", str(phone), "--detectors", "gdino", "--ocr", "apple",
                 "--out", str(out)]) == 0  # fmt: skip
    md = (out / "bakeoff.md").read_text()
    assert "domain: phone, n = 2 garments" in md
    assert "Scored on 1 garments. Excluded: 1 whose typed label doesn't parse" in md
    assert "| apple | 1.000 | 1.000 | 0.000 |" in md
    assert "**Views (spec §8.3):" in md and "## KB thresholds" in md
