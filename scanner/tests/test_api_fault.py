"""The fault result in the scan API, and the TEXPILOT_FAULT_MODEL fallback. Fakes only."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from services.api import main
from services.api.config import Settings, build_predictor
from services.api.main import app
from services.vision.predictor import FaultOutput, FaultRegion, VisionOutput

client = TestClient(app)
JPEG = b"\xff\xd8\xff\xe0 stub never decodes this"
# Top-level keys of a scan response before the fault change (checked against a snapshot).
PRE_CHANGE_KEYS = {
    "candidates", "capture_quality", "custom", "fibre_family", "flags", "garment", "kb_version",
    "model_version", "scan_id", "stated_composition", "structure", "structure_answer",
    "timestamp", "timings_ms", "treatment", "verdict", "yarn_advice",
}  # fmt: skip


@pytest.fixture
def state():
    saved = dict(main._state)
    yield main._state
    main._state.clear()
    main._state.update(saved)


class FakePredictor:
    def __init__(self, out):
        self.out = out

    def predict(self, image_bytes):
        return self.out


def _scan(**data):
    return client.post("/api/v1/scan", files={"surface_image": ("g.jpg", JPEG, "image/jpeg")},
                       data=data)  # fmt: skip


def test_no_fault_model_gives_the_old_response_plus_a_null_fault(state):
    body = _scan(label_text="60% COTTON 40% POLYESTER").json()
    assert body["fault"] is None
    assert "FAULT_DETECTED" not in {f["code"] for f in body["flags"]}
    assert set(body) == PRE_CHANGE_KEYS | {"fault"}


def test_a_stub_predictor_fault_is_reported_with_a_medium_flag(state):
    fault = FaultOutput(
        score=0.91,
        is_fault=True,
        threshold=0.5,
        regions=(
            FaultRegion((0.5, 0.5, 0.6, 0.6), 0.6),
            FaultRegion((0.2, 0.2, 0.4, 0.4), 0.91, type="hole", type_confidence=0.8),
        ),
        heatmap_png_b64=None,
        model_version="fault-1",
    )
    state["predictor"] = FakePredictor(VisionOutput(None, None, None, fault=fault))
    body = _scan().json()
    assert body["fault"]["is_fault"] is True
    assert body["fault"]["regions"][1]["type"] == "hole"
    [flag] = [f for f in body["flags"] if f["code"] == "FAULT_DETECTED"]
    assert flag == {
        "code": "FAULT_DETECTED",
        "message": "Possible fabric fault: hole (score 0.91)",
        "severity": "medium",
    }


def test_an_untyped_top_region_says_unknown_type(state):
    fault = FaultOutput(0.7, True, 0.5, (FaultRegion((0, 0, 1, 1), 0.7),), None, "fault-1")
    state["predictor"] = FakePredictor(VisionOutput(None, None, None, fault=fault))
    [flag] = [f for f in _scan().json()["flags"] if f["code"] == "FAULT_DETECTED"]
    assert flag["message"] == "Possible fabric fault: unknown type (score 0.70)"


def test_a_skipped_fault_check_adds_no_flag(state):
    fault = FaultOutput(0.0, False, 0.5, (), None, "fault-1", "garment too small")
    state["predictor"] = FakePredictor(VisionOutput(None, None, None, fault=fault))
    body = _scan().json()
    assert body["fault"]["skipped_reason"] == "garment too small"
    assert "FAULT_DETECTED" not in {f["code"] for f in body["flags"]}


# --- config: the fallback needs the real build_scanner, with its loaders faked ---


class _Det:
    name, default_min_score = "fake", 0.3

    def detect(self, image):
        return []


@pytest.fixture
def scanner_env(tmp_path, monkeypatch):
    import services.vision.crop as crop
    import services.vision.detectors as detectors
    import services.vision.heads as heads
    import services.vision.runtime as runtime

    monkeypatch.setattr(runtime, "pick_device", lambda device: "cpu")
    monkeypatch.setattr(detectors, "load_detector", lambda name, device: _Det())
    monkeypatch.setattr(heads, "LinearHeads", lambda bundle, device: SimpleNamespace(
        version="8", custom=[], predict=None))  # fmt: skip
    monkeypatch.setattr(crop, "FabricCropper", lambda patches: None)
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "bundle.json").write_text(json.dumps({"views": "whole"}))
    return {"TEXPILOT_VISION": "scanner", "TEXPILOT_OCR_BACKEND": "none",
            "TEXPILOT_MODEL_BUNDLE": str(bundle)}  # fmt: skip


def test_an_unloadable_fault_model_still_starts_the_scanner(scanner_env, caplog):
    env = {**scanner_env, "TEXPILOT_FAULT_MODEL": "/nonexistent/fault"}
    predictor, version = build_predictor(Settings.from_env(env))
    assert predictor.fault is None
    assert version == "scanner-v8+det=owlv2+ocr=none"
    assert any(r.levelname == "WARNING" and "/nonexistent/fault" in r.getMessage()
               for r in caplog.records)  # fmt: skip


def test_the_fault_version_is_named_only_when_loaded(scanner_env, monkeypatch, tmp_path):
    import services.vision.fault as fault

    monkeypatch.setattr(fault, "FaultDetector", lambda model_dir, device: SimpleNamespace(
        version="fault-1", detect=None))  # fmt: skip
    env = {**scanner_env, "TEXPILOT_FAULT_MODEL": str(tmp_path)}
    predictor, version = build_predictor(Settings.from_env(env))
    assert predictor.fault is not None
    assert version == "scanner-v8+det=owlv2+ocr=none+fault=fault-1"


def test_an_empty_fault_model_variable_means_no_fault_stage():
    assert Settings.from_env({"TEXPILOT_FAULT_MODEL": ""}).fault_model is None
    assert Settings.from_env({}).fault_model is None
