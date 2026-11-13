"""QC stage integration. All learned outputs below are explicitly predictor doubles."""

import copy
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from services.api import qc_pipeline
from services.api.qc_schemas import AnalyzeRequest, content_sha256, sha256_hex
from services.vision.predictor import HeadOutput, StubPredictor, VisionOutput
from services.vision.qc_imageio import decode_original

FIXTURES = {
    item["name"]: item["value"]
    for item in json.loads((Path(__file__).parent / "fixtures/qc-v2/valid.json").read_text())
}
IMAGES = Path(__file__).parent / "fixtures/qc-images"


def request_double(data=None, filename="swatch.png"):
    """Bind real decodable bytes to synthetic request metadata; never a model artifact."""
    data = (IMAGES / filename).read_bytes() if data is None else data
    body = copy.deepcopy(FIXTURES["analyze-request"])
    body["captures"] = body["captures"][:2]
    for view in body["captures"]:
        view["axis_registration"] = None
        capture = view["capture"]
        capture.update(original_sha256=sha256_hex(data), byte_size=len(data))
        try:
            original = decode_original(data)
            capture.update(width=original.upright_size[0], height=original.upright_size[1])
            capture["media_type"] = original.media_type
        except Exception:
            pass  # negative image test: its metadata cannot substitute for decoding
        view["verified_sha256"] = sha256_hex(data)
        view["attestation"]["image_sha256"] = sha256_hex(data)
        view["attestation"]["resolution"] = [capture["width"], capture["height"]]
        digest = content_sha256(view["attestation"])
        capture["attestation_sha256"] = view["acquisition_attestation_sha256"] = digest
    return AnalyzeRequest.model_validate(body), data


class HeadsDouble:
    def __init__(self, unknown=False):
        self.unknown = unknown
        self.fail = False
        self.views = []

    def predict(self, views):
        self.views = views
        if self.fail:
            raise RuntimeError("private classifier failure")
        if self.unknown:
            return VisionOutput(None, None, None, candidates={"structure": [("twill", 0.2)]})
        return VisionOutput(HeadOutput("twill", 0.99, [("twill", 0.99)]), None, None)


class FlatSwatchPredictorDouble:
    """A real-head-shaped double with a detector that must never be accessed."""

    qc_artifact_sha256 = "a" * 64
    qc_taxonomy_version = "fabric24-head_a"

    def __init__(self, unknown=False):
        self.heads = HeadsDouble(unknown)

    @property
    def detector(self):
        raise AssertionError("v2 must never access the garment detector")

    def predict(self, _):
        raise AssertionError("v2 must never use the v1 pipeline")


def run_double(predictor, req=None, data=None):
    if req is None:
        req, data = request_double()
    batch = qc_pipeline.CaptureBatch.from_request(
        req, {v.capture.id: decode_original(data) for v in req.captures}
    )
    return qc_pipeline.run_qc_analysis(
        batch, req.spec, req.domain, predictor, req.policy, req.release, req.attempt, req.context
    )


def test_flat_swatch_head_bypasses_detector_and_uncalibrated_probability_is_null():
    predictor = FlatSwatchPredictorDouble()
    candidate = run_double(predictor)
    assert candidate.evidence.fabric.state == "OK"
    assert candidate.evidence.fabric.value.label == "twill"
    assert candidate.evidence.fabric.value.calibrated_probability is None
    assert len(predictor.heads.views) == 1  # only the structure view, never overview/scale
    assert candidate.draft.status == "MANUAL_REVIEW" and not candidate.draft.automatic


def test_abstaining_head_has_unknown_and_diagnostic_candidates():
    stage = run_double(FlatSwatchPredictorDouble(unknown=True)).evidence.fabric
    assert stage.state == "OK" and stage.value.unknown and stage.value.label is None
    assert stage.value.candidates[0].label == "twill"
    assert stage.value.calibrated_probability is None


def test_stub_and_unreleased_domain_and_fault_are_truthfully_unavailable():
    ev = run_double(StubPredictor()).evidence
    for name in ("fabric", "defects"):
        stage = getattr(ev, name)
        assert (stage.state, stage.value, stage.reasons) == (
            "DISABLED",
            None,
            ["STAGE_UNAVAILABLE"],
        )
    assert ev.domain.state == "DISABLED" and ev.domain.reasons == ["DOMAIN_UNVALIDATED"]
    assert ev.quality.state == ev.metrology.state == "ABSTAINED"


def test_failed_stage_never_hides_another_and_policy_is_called_exactly_once(monkeypatch):
    original = qc_pipeline.qc_policy.evaluate_qc
    evaluator = Mock(wraps=original)
    monkeypatch.setattr(qc_pipeline.qc_policy, "evaluate_qc", evaluator)
    monkeypatch.setattr(qc_pipeline, "assess_capture_set", Mock(side_effect=RuntimeError("secret")))
    ev = run_double(FlatSwatchPredictorDouble()).evidence
    assert ev.quality.state == "FAILED" and ev.fabric.state == "OK"
    assert ev.metrology.state == "ABSTAINED" and ev.defects.state == "DISABLED"
    assert evaluator.call_count == 1 and evaluator.call_args.kwargs == {"domain": None}


def test_prior_clean_fabric_result_is_never_reused_when_head_later_fails():
    predictor = FlatSwatchPredictorDouble()
    first = run_double(predictor)
    predictor.heads.fail = True
    second = run_double(predictor)
    assert first.evidence.fabric.state == "OK"
    assert second.evidence.fabric.state == "FAILED" and second.evidence.fabric.value is None
    assert second.evidence.id != first.evidence.id
    assert second.draft.status == "MANUAL_REVIEW" and not second.draft.automatic


def test_manifest_hash_and_all_binding_fields_match_request():
    req, _ = request_double()
    candidate = run_double(StubPredictor())
    assert candidate.evidence.manifest_sha256 == content_sha256(
        candidate.evidence, exclude=("manifest_sha256", "id", "created_at")
    )
    binding = candidate.binding
    assert binding.spec_sha256 == req.spec.content_sha256
    assert binding.policy_sha256 == req.policy.sha256 and binding.release_sha256 is None
    assert binding.capture_sha256s == [v.verified_sha256 for v in req.captures]
    assert (binding.attempt, binding.expected_revision) == (req.attempt, req.expected_revision)
    for field in ("request_id", "request_generation", "deadline_at"):
        assert getattr(binding, field) == getattr(req.context, field)


@pytest.mark.parametrize("stage", ["fabric", "defects", "quality", "metrology", "domain"])
def test_readiness_has_all_stages_and_never_claims_stub_is_ready(stage):
    result = qc_pipeline.qc_readiness()
    assert not result.ready and result.bundle_sha256 is None
    assert [s.name for s in result.stages] == [
        "quality",
        "fabric",
        "defects",
        "metrology",
        "domain",
    ]
    row = next(s for s in result.stages if s.name == stage)
    assert row.artifact_sha256 is None and row.state != "OK" and row.reasons
