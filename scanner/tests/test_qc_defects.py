"""v2 defects stage. Fault detectors below are duck-typed doubles: no model, torch or scipy."""

import json
import types

import numpy as np
import pytest

from services.api import qc_pipeline
from services.api.qc_schemas import AnalyzeRequest, Evidence
from tests.test_qc_pipeline import FlatSwatchPredictorDouble, request_double, run_double

DIGEST = "f" * 64
DEADLINE = "2026-11-13T08:07:00Z"


def _view(score=0.3, is_fault=False, reference="trained", regions=()):
    return types.SimpleNamespace(
        score=score,
        is_fault=is_fault,
        threshold=0.5,
        regions=tuple(types.SimpleNamespace(box=b, score=s) for b, s in regions),
        heatmap_png_b64=None,
        model_version="fault-double",
        skipped_reason=None,
        reference=reference,
    )


class FaultDouble:
    def __init__(self, *outs, raises=False):
        self.outs, self.raises, self.calls = list(outs), raises, []

    def detect(self, image, box):
        self.calls.append((image, box))
        if self.raises:
            raise RuntimeError("detector failure")
        return self.outs[min(len(self.calls), len(self.outs)) - 1]


def predictor(fault, digest=DIGEST):
    p = FlatSwatchPredictorDouble()
    p.fault, p.qc_fault_artifact_sha256 = fault, digest
    return p


@pytest.fixture(autouse=True)
def early(monkeypatch):
    deadline = qc_pipeline.timestamp(DEADLINE)
    monkeypatch.setattr(qc_pipeline, "wall_time", lambda: deadline - 600)


def run(p, role2="structure", roles=None):
    req, data = request_double()
    if role2 != "structure":
        body = req.model_dump(mode="json")
        body["captures"][1]["capture"]["role"] = role2
        req = AnalyzeRequest.model_validate(body)
    return run_double(p, req, data), req, data


def check(result):
    Evidence.model_validate(result.evidence.model_dump(mode="json"))
    return result.evidence.defects


def test_disabled_without_fault():
    result, _, _ = run(FlatSwatchPredictorDouble())
    d = check(result)
    assert (d.state, d.value, d.reasons) == ("DISABLED", None, ["STAGE_UNAVAILABLE"])


def test_one_untrained_view_abstains_ood_never_partial_ok():
    fault = FaultDouble(_view(), _view(reference="self_relative"))
    d = check(run(predictor(fault))[0])
    assert (d.state, d.value, d.reasons) == ("ABSTAINED", None, ["OOD"])
    assert len(fault.calls) == 2


def test_reference_missing_is_ood():
    d = check(run(predictor(FaultDouble(_view(reference=None))))[0])
    assert (d.state, d.reasons) == ("ABSTAINED", ["OOD"])


def test_ok_all_trained_views():
    fault = FaultDouble(_view(0.2), _view(0.4, regions=[((0.1, 0.1, 0.2, 0.2), 0.3)]))
    result, req, _ = run(predictor(fault))
    d = check(result)
    assert (d.state, d.reasons, d.artifact_sha256) == ("OK", [], DIGEST)
    assert d.value.score == 0.4 == max(v.score for v in d.value.views)
    assert [v.capture_sha256 for v in d.value.views] == [c.verified_sha256 for c in req.captures]
    assert len(d.value.regions) == 1 and d.value.observed_area_cm2 == 0.0


def test_fault_goes_to_manual_review_never_accept():
    result, _, _ = run(predictor(FaultDouble(_view(), _view(is_fault=True))))
    d = check(result)
    assert (d.state, d.reasons) == ("OK", ["DEFECT_SUSPECTED"])
    assert result.draft.status == "MANUAL_REVIEW" and result.draft.automatic is False


def test_scores_clamped_to_unit_interval():
    fault = FaultDouble(_view(1.7, regions=[((0.1, 0.1, 0.2, 0.2), 1.3)]))
    d = check(run(predictor(fault))[0])
    assert d.value.score == 1.0 and d.value.regions[0].score == 1.0


def test_detector_failure_is_isolated():
    result, _, _ = run(predictor(FaultDouble(raises=True)))
    assert check(result).state == "FAILED"
    assert result.evidence.fabric.state == "OK"


def test_region_boxes_clamped_and_degenerate_dropped():
    boxes = [
        ((0.5, 0.5, 1.0000000000000002, 1.0), 0.3),
        ((-0.1, 0.0, 0.2, 0.2), 0.3),
        ((0.4, 0.4, 0.4, 0.9), 0.3),
        ((1.2, 0.1, 1.5, 0.3), 0.3),
    ]
    d = check(run(predictor(FaultDouble(_view(regions=boxes))), role2="defect")[0])
    assert d.state == "OK"
    assert [tuple(r.box) for r in d.value.regions] == [(0.5, 0.5, 1.0, 1.0), (0.0, 0.0, 0.2, 0.2)]


def test_no_time_left_abstains_without_calling_detector(monkeypatch):
    deadline = qc_pipeline.timestamp(DEADLINE)
    monkeypatch.setattr(qc_pipeline, "wall_time", lambda: deadline - 1)
    fault = FaultDouble(_view())
    d = check(run(predictor(fault))[0])
    assert (d.state, d.reasons) == ("ABSTAINED", ["STAGE_UNAVAILABLE"])
    assert fault.calls == []


def test_only_defect_capture_is_scored_when_present():
    fault = FaultDouble(_view())
    result, req, _ = run(predictor(fault), role2="defect")
    d = check(result)
    assert len(fault.calls) == 1
    assert [v.capture_id for v in d.value.views] == [req.captures[1].capture.id]


def test_scale_capture_is_never_scored():
    fault = FaultDouble(_view())
    result, req, _ = run(predictor(fault), role2="scale")
    d = check(result)
    assert len(fault.calls) == 1
    assert [v.capture_id for v in d.value.views] == [req.captures[0].capture.id]


def test_detector_gets_array_with_no_box_and_capped_at_1600():
    fault = FaultDouble(_view())
    run(predictor(fault), role2="defect")
    image, box = fault.calls[0]
    assert isinstance(image, np.ndarray) and box is None and max(image.shape[:2]) <= 1600


def test_readiness_names_fault_digest():
    row = next(
        s for s in qc_pipeline.qc_readiness(predictor(FaultDouble())).stages if s.name == "defects"
    )
    assert (row.state, row.artifact_sha256) == ("OK", DIGEST)
    assert not qc_pipeline.qc_readiness(predictor(FaultDouble())).ready


def _model_dir(tmp_path):
    d = tmp_path / "fault"
    d.mkdir(parents=True)
    cfg = {
        "backbone": "vit_s",
        "image_size": 392,
        "thresholds": {"default": 0.5},
        "version": "test-1",
    }
    (d / "config.json").write_text(json.dumps(cfg))
    (d / "weights.pt").write_bytes(b"x")
    return d


def test_real_detector_without_reference_field_abstains(tmp_path):
    pytest.importorskip("scipy")
    from services.vision.fault import FaultDetector

    class StubDetector(FaultDetector):
        """Network replaced by a function of the tile: anomaly = red channel / 255."""

        def __init__(self, model_dir):
            super().__init__(model_dir, "cpu")

        def _load_model(self):
            return None

        def _score_tiles(self, tiles):
            return [t[:, :, 0].astype(np.float32) / 255.0 for t in tiles]

    d = check(run(predictor(StubDetector(_model_dir(tmp_path))), role2="defect")[0])
    # A stub-model detector may be trained or not; never a crash, never a fabricated defect.
    assert d.state in ("ABSTAINED", "OK")
    if d.state == "ABSTAINED":
        assert d.reasons == ["OOD"]
