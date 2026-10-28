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


def test_vision_section_reports_n_and_chooses_thresholds_from_the_data(tmp_path, monkeypatch):
    import json

    import services.vision.scanner as scanner
    from training.scanner.bakeoff import vision_section

    labels = {"1": "100% COTTON", "2": "100% POLYESTER", "3": "100% WOOL"}
    reads = {"1": "cellulosic", "2": "synthetic", "3": "protein"}  # every head is right
    samples = []
    for (gid, text), colour in zip(labels.items(), ("red", "green", "blue"), strict=True):
        p = tmp_path / f"{gid}_garment.jpg"
        Image.new("RGB", (20, 20), colour).save(p)  # distinct bytes, so the fake can tell
        samples.append(Sample(image_path=p, group_id=gid, label_text=text))

    class ByPhoto:
        def predict(self, data):
            gid = next(s.group_id for s in samples if s.image_path.read_bytes() == data)
            return VisionOutput(None, None, HeadOutput(reads[gid], 0.93, []))

    monkeypatch.setattr(scanner, "build_scanner", lambda *a, **k: ByPhoto())
    md = "\n".join(vision_section(samples, "gdino", tmp_path, "cpu", tmp_path))
    assert "Domain: phone; n = 3 correct-label and 3 swapped-label pairs." in md
    best = json.loads((tmp_path / "thresholds.json").read_text())["best"]
    assert best["family_min_confidence"] == 0.93 and best["precision"] == 1.0


def test_vision_cache_is_redone_for_a_new_bundle(tmp_path):
    p = tmp_path / "1_garment.jpg"
    Image.new("RGB", (20, 20)).save(p)
    samples, loads = [Sample(image_path=p, group_id="1")], []

    def loader():
        loads.append(1)
        return FakeScanner()

    run_vision("crop", samples, loader, tmp_path / "c", meta={"bundle": "models/scanner-v1"})
    run_vision("crop", samples, loader, tmp_path / "c", meta={"bundle": "models/scanner-v2"})
    assert len(loads) == 2


def test_a_component_crash_inside_the_scanner_is_a_failure_not_an_abstention(tmp_path):
    from services.vision.predictor import Note

    class OutOfMemory:
        def predict(self, data):
            note = Note("COMPONENT_FAILED", "heads: RuntimeError: MPS out of memory")
            return VisionOutput(None, None, None, notes=(note,))

    p = tmp_path / "1_garment.jpg"
    Image.new("RGB", (20, 20)).save(p)
    [row] = run_vision("crop", [Sample(image_path=p, group_id="1")], OutOfMemory, tmp_path / "c")
    assert "MPS out of memory" in row["error"]


def test_threshold_records_carry_the_treatment_head_for_the_treatment_flag():
    rows = [{"id": "a", "structure": ["denim", 0.9], "treatment": ["printed", 0.9],
             "family": None, "error": None}]  # fmt: skip
    [rec] = threshold_records(rows, {"a": "cellulosic"})
    assert rec["treatment"] == ["printed", 0.9]
