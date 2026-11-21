"""Pin honest artifact readiness. The fault serving path exists (config._load_fault); real
parity on WFDD images is evidenced in docs/results.md, but the images are not in the repo (G6)."""

import json

import pytest

from services.api import config, qc_pipeline
from services.vision.fault import FaultDetector


def test_missing_fault_artifact_is_not_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("TEXPILOT_FAULT_MODEL", str(tmp_path / "absent"))
    ready = qc_pipeline.qc_readiness()
    assert not ready.ready
    row = next(s for s in ready.stages if s.name == "defects")
    assert row.state == "DISABLED" and row.artifact_sha256 is None
    with pytest.raises(FileNotFoundError):
        FaultDetector(tmp_path / "absent", "cpu")


def test_present_but_unloadable_fault_artifact_never_means_ready(tmp_path, monkeypatch):
    (tmp_path / "weights.pt").write_bytes(b"unloadable-artifact-test-double")
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "version": "unloadable-test-double",
                "backbone": "test-double",
                "image_size": 392,
                "thresholds": {"default": 0.5},
            }
        )
    )
    monkeypatch.setenv("TEXPILOT_FAULT_MODEL", str(tmp_path))
    with pytest.raises(Exception):  # noqa: B017 -- any load failure; the bytes are not a checkpoint
        FaultDetector(tmp_path, "cpu")
    assert not qc_pipeline.qc_readiness().ready
    assert next(s for s in qc_pipeline.qc_readiness().stages if s.name == "defects").state != "OK"


def test_flat_swatch_factory_does_not_construct_a_garment_detector(monkeypatch, tmp_path):
    def heads_loader_double(_settings):
        from tests.test_qc_pipeline import FlatSwatchPredictorDouble

        return FlatSwatchPredictorDouble()

    monkeypatch.setattr(config, "_load_qc_heads", heads_loader_double)
    monkeypatch.setattr(config, "build_predictor", lambda _: pytest.fail("v1 factory invoked"))
    predictor = config.build_qc_predictor(config.Settings(vision="scanner", bundle=tmp_path))
    assert predictor.qc_artifact_sha256 == "a" * 64


def test_selected_head_loader_bypasses_raising_detector_and_binds_scope(monkeypatch, tmp_path):
    from services.vision import detectors, heads, runtime
    from services.vision.taxonomy import FABRIC_CLASSES
    from tests.test_qc_pipeline import run_double

    class StructureModelDouble:
        meta = {"threshold": 0.5}

        def __init__(self, *_):
            self.classes = tuple(
                c for c in FABRIC_CLASSES if c not in {"canvas", "plush", "jersey"}
            )

        def probs(self, views):
            import numpy as np

            assert len(views) == 1
            values = np.zeros(len(self.classes))
            values[self.classes.index("twill")] = 1.0
            return values

    def raising_detector_double(*_):
        raise AssertionError("garment detector construction must never run")

    monkeypatch.setattr(detectors, "load_detector", raising_detector_double)
    monkeypatch.setattr(heads, "FineTunedHead", StructureModelDouble)
    monkeypatch.setattr(runtime, "pick_device", lambda _: "cpu-device-double")
    (tmp_path / "bundle.json").write_text(json.dumps({"structure_model": {"dir": "head_a"}}))
    (tmp_path / "head_a").mkdir()
    (tmp_path / "head_a/head.json").write_text("{}")
    weights = tmp_path / "head_a/model.safetensors"
    weights.write_bytes(b"local-weights-artifact-double")
    settings = config.Settings(vision="scanner", bundle=tmp_path)
    predictor = config.build_qc_predictor(settings)
    result = run_double(predictor)
    assert result.evidence.fabric.value.label == "twill"
    assert result.evidence.fabric.value.calibrated_probability is None
    assert result.evidence.fabric.value.taxonomy_version == "fabric24-head_a"
    first_hash = predictor.qc_artifact_sha256
    weights.write_bytes(b"changed-weights-artifact-double")
    assert config.build_qc_predictor(settings).qc_artifact_sha256 != first_hash


def test_missing_local_encoder_refuses_before_any_model_or_download(monkeypatch, tmp_path):
    from services.vision import heads

    (tmp_path / "bundle.json").write_text(json.dumps({"structure_model": {"dir": "head_a"}}))
    (tmp_path / "head_a").mkdir()
    (tmp_path / "head_a/head.json").write_text('{"pool":"probe"}')
    (tmp_path / "head_a/probe.safetensors").write_bytes(b"probe-artifact-double")
    monkeypatch.setattr(heads, "FineTunedHead", lambda *_: pytest.fail("model loader invoked"))
    with pytest.raises(FileNotFoundError):
        config.build_qc_predictor(config.Settings(vision="scanner", bundle=tmp_path))


@pytest.mark.skip(
    reason="Needs WFDD images (Drive only); parity evidenced in docs/results.md"
)
def test_real_checkpoint_evaluation_serving_score_and_box_parity():
    """Requires the selected-format loader, real weights, preprocessing and target proof."""


def _fault_settings(tmp_path):
    return config.Settings(vision="scanner", bundle=tmp_path, fault_model=tmp_path / "fault")


def _heads_predictor(monkeypatch):
    from tests.test_qc_pipeline import FlatSwatchPredictorDouble

    base = qc_pipeline.FlatSwatchPredictor(
        FlatSwatchPredictorDouble().heads, "a" * 64, "fabric24-head_a"
    )
    monkeypatch.setattr(config, "_load_qc_heads", lambda _s: base)
    return base


def test_fault_model_loads_with_digest_that_tracks_config_bytes(monkeypatch, tmp_path):
    _heads_predictor(monkeypatch)
    (tmp_path / "fault").mkdir()
    cfg = tmp_path / "fault/config.json"
    cfg.write_text("{}")
    monkeypatch.setattr(config, "_load_fault", lambda s: object())
    p = config.build_qc_predictor(_fault_settings(tmp_path))
    assert p.fault is not None and len(p.qc_fault_artifact_sha256) == 64
    first = p.qc_fault_artifact_sha256
    cfg.write_text('{"a": 1}')
    assert config.build_qc_predictor(_fault_settings(tmp_path)).qc_fault_artifact_sha256 != first


def test_fault_loader_failure_keeps_fabric_heads(monkeypatch, tmp_path):
    base = _heads_predictor(monkeypatch)

    def boom(_s):
        raise ImportError("no torch")

    monkeypatch.setattr(config, "_load_fault", boom)
    p = config.build_qc_predictor(_fault_settings(tmp_path))
    assert p.fault is None and p.heads is base.heads and p.qc_artifact_sha256 == "a" * 64


def test_unset_fault_model_never_calls_loader(monkeypatch, tmp_path):
    _heads_predictor(monkeypatch)
    monkeypatch.setattr(config, "_load_fault", lambda _s: pytest.fail("loader invoked"))
    p = config.build_qc_predictor(config.Settings(vision="scanner", bundle=tmp_path))
    assert p.fault is None


def test_readiness_with_fault_digest_is_ok_but_not_ready():
    p = qc_pipeline.FlatSwatchPredictor(
        None, "a" * 64, "t", fault=object(), qc_fault_artifact_sha256="d" * 64
    )
    ready = qc_pipeline.qc_readiness(p)
    row = next(s for s in ready.stages if s.name == "defects")
    assert (row.state, row.artifact_sha256) == ("OK", "d" * 64) and not ready.ready
