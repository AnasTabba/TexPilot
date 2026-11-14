"""The fail-closed decision table (plan T03, design §4, §15, §21).

Evidence here is built from the shared synthetic contract fixtures. An ACCEPT in this file
shows what the rule does with fully valid evidence under a released domain; it is not a
result from any model, and no such release exists.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from services.api.qc_schemas import (
    DefectValue,
    DomainManifest,
    EvaluationContext,
    Evidence,
    Policy,
    PurchaseSpec,
    Release,
    content_sha256,
)
from services.consistency import qc_policy
from services.consistency.qc_policy import evaluate_qc

FIXTURES = {
    e["name"]: e["value"]
    for e in json.loads(
        (Path(__file__).parent / "fixtures" / "qc-v2" / "valid.json").read_text("utf-8")
    )
}
AUTOMATIC = {"ACCEPT", "HOLD"}


def _set(record: dict, path: str, value) -> None:
    node = record
    *parents, last = path.split(".")
    for p in parents:
        node = node[int(p)] if isinstance(node, list) else node[p]
    node[int(last) if isinstance(node, list) else last] = value


def evidence(base: str = "evidence-synthetic-all-stages-ok", **changes) -> Evidence:
    data = copy.deepcopy(FIXTURES[base])
    if base == "evidence-synthetic-all-stages-ok":
        data["fabric"]["value"]["calibrated_probability"] = 0.97
    for path, value in changes.items():
        _set(data, path.replace("__", "."), value)
    data["manifest_sha256"] = content_sha256(data, exclude=("manifest_sha256", "id", "created_at"))
    return Evidence.model_validate(data)


def off(state: str, *reasons: str) -> dict:
    return {
        "state": state,
        "value": None,
        "reasons": list(reasons),
        "artifact_sha256": None,
        "duration_ms": 1.0,
    }


SPEC = PurchaseSpec.model_validate(FIXTURES["spec-woven-v1"])
REVIEW_ONLY = Policy.model_validate(FIXTURES["policy-review-only"])
AUTO = Policy.model_validate(FIXTURES["policy-automatic"])
ACTIVE = Release.model_validate(FIXTURES["release-active"])
CANDIDATE = Release.model_validate(FIXTURES["release-statistical-candidate"])
DOMAIN = DomainManifest.model_validate(FIXTURES["domain-manifest"])
CONTEXT = EvaluationContext.model_validate(FIXTURES["evaluation-context"])


def at(time: str) -> EvaluationContext:
    return CONTEXT.model_copy(update={"evaluated_at": time, "deadline_at": "2099-01-01T00:00:00Z"})


def released(ev: Evidence, attempt: int = 1, **over):
    args = {"policy": AUTO, "release": ACTIVE, "context": CONTEXT, "domain": DOMAIN, "spec": SPEC}
    args.update(over)
    return evaluate_qc(
        ev,
        args["spec"],
        args["policy"],
        args["release"],
        attempt,
        args["context"],
        domain=args["domain"],
    )


def interval(axis_index: int, low: float, value: float, high: float) -> dict:
    return {
        f"metrology__value__{axis_index}__value": value,
        f"metrology__value__{axis_index}__interval95": [low, high],
    }


# ------------------------------------------------------------------ the released happy path


def test_fully_valid_evidence_in_a_released_domain_is_accepted():
    draft = released(evidence())
    assert (draft.status, draft.reasons, draft.automatic) == ("ACCEPT", [], True)
    assert draft.scope == "INSPECTED_SAMPLE"


def test_review_only_never_decides_even_for_conforming_evidence():
    draft = evaluate_qc(evidence(), SPEC, REVIEW_ONLY, None, 1, CONTEXT, domain=DOMAIN)
    assert (draft.status, draft.automatic) == ("MANUAL_REVIEW", False)
    assert draft.reasons == ["POLICY_UNRELEASED"]
    # ... and a release handed to a review-only policy changes nothing.
    again = evaluate_qc(evidence(), SPEC, REVIEW_ONLY, ACTIVE, 1, CONTEXT, domain=DOMAIN)
    assert again.status == "MANUAL_REVIEW"


def test_review_only_still_reports_nonconformance_evidence_without_holding():
    ev = evidence(**interval(0, 82.0, 84.0, 86.0))
    draft = evaluate_qc(ev, SPEC, REVIEW_ONLY, None, 1, CONTEXT, domain=DOMAIN)
    assert draft.status == "MANUAL_REVIEW"
    assert draft.reasons == ["POLICY_UNRELEASED", "CONSTRUCTION_OUTSIDE_TOLERANCE"]


# ------------------------------------------------------------------ every stage is required


@pytest.mark.parametrize("stage", ["quality", "fabric", "defects", "metrology", "domain"])
@pytest.mark.parametrize("state", ["FAILED", "DISABLED", "NOT_RUN", "ABSTAINED"])
def test_a_stage_that_did_not_produce_evidence_blocks_both_automatic_statuses(stage, state):
    draft = released(evidence(**{stage: off(state, "STAGE_UNAVAILABLE")}))
    assert draft.status == "MANUAL_REVIEW"
    assert "STAGE_UNAVAILABLE" in draft.reasons


def test_a_missing_stage_blocks_hold_as_well_as_accept():
    # Clear nonconformance, but the defect stage is disabled: HOLD is gated like ACCEPT.
    ev = evidence(defects=off("DISABLED", "STAGE_UNAVAILABLE"), **interval(0, 82.0, 84.0, 86.0))
    draft = released(ev)
    assert draft.status == "MANUAL_REVIEW"
    assert set(draft.reasons) == {"STAGE_UNAVAILABLE", "CONSTRUCTION_OUTSIDE_TOLERANCE"}


@pytest.mark.parametrize("stage", ["quality", "fabric", "defects", "metrology", "domain"])
def test_a_reason_on_an_ok_stage_still_blocks_both_automatic_statuses(stage):
    # A stage that ran and still names a blocking reason is not a clean stage.
    draft = released(evidence(**{f"{stage}__reasons": ["OOD"]}))
    assert draft.status == "MANUAL_REVIEW"
    assert "OOD" in draft.reasons


def test_a_capture_fixable_reason_on_an_ok_quality_stage_is_a_recapture():
    draft = released(evidence(quality__reasons=["QUALITY_BLUR"]), 1)
    assert (draft.status, draft.reasons, draft.automatic) == ("RECAPTURE", ["QUALITY_BLUR"], False)


def test_the_stages_unavailable_today_give_manual_review_with_every_reason():
    ev = evidence("evidence-review-only-stages-unavailable")
    draft = evaluate_qc(ev, SPEC, REVIEW_ONLY, None, 1, CONTEXT)
    assert draft.status == "MANUAL_REVIEW"
    assert draft.reasons == [
        "POLICY_UNRELEASED",
        "STAGE_UNAVAILABLE",
        "DOMAIN_UNVALIDATED",
        "QUALITY_BLUR",
    ]


# ------------------------------------------------------------------ release and domain


@pytest.mark.parametrize(
    "over",
    [
        {"release": None},
        {"release": CANDIDATE},
        {"release": ACTIVE.model_copy(update={"state": "SUSPENDED"})},
        {"release": ACTIVE.model_copy(update={"policy_sha256": "0" * 64})},
        {"release": ACTIVE.model_copy(update={"workspace_id": SPEC.workspace_id[:-1] + "9"})},
        {"release": ACTIVE.model_copy(update={"bundle_sha256": "0" * 64})},  # hash no longer fits
        {"policy": AUTO.model_copy(update={"version": "edited"})},  # hash no longer fits
    ],
)
def test_a_missing_unreleased_suspended_or_mismatched_release_gives_review(over):
    draft = released(evidence(), **over)
    assert draft.status == "MANUAL_REVIEW"
    assert "POLICY_UNRELEASED" in draft.reasons


def test_release_expiry_is_inclusive_at_the_instant():
    just_before = released(evidence(), context=at("2027-11-13T07:59:59Z"))
    exactly = released(evidence(), context=at(ACTIVE.expires_at))
    after = released(evidence(), context=at("2027-11-13T08:00:01Z"))
    assert just_before.status == "ACCEPT"
    assert exactly.status == after.status == "MANUAL_REVIEW"
    assert "POLICY_UNRELEASED" in exactly.reasons


def test_evaluation_at_or_after_the_deadline_is_not_decided():
    late = CONTEXT.model_copy(update={"evaluated_at": CONTEXT.deadline_at})
    draft = released(evidence(), context=late)
    assert (draft.status, "EVIDENCE_STALE" in draft.reasons) == ("MANUAL_REVIEW", True)


@pytest.mark.parametrize(
    "over",
    [
        {"domain": None},
        {"domain": DOMAIN.model_copy(update={"defect_accept_below": 0.3})},  # hash no longer fits
        {"domain": DOMAIN.model_copy(update={"construction": "knit"})},
        {
            "domain": DOMAIN.model_copy(update={"effective_labels": ["twill"]})
        },  # PO also allows denim
    ],
)
def test_a_missing_or_mismatched_domain_manifest_gives_review(over):
    draft = released(evidence(), **over)
    assert draft.status == "MANUAL_REVIEW"
    assert "DOMAIN_UNVALIDATED" in draft.reasons


def test_evidence_from_another_domain_or_artifact_is_not_released():
    for change in (
        {"domain_id": "other-domain"},
        {"quality__artifact_sha256": "1" * 64},
        {"metrology__artifact_sha256": "1" * 64},
        {"domain__artifact_sha256": "1" * 64},
        {"domain__value__profile_sha256": "1" * 64},
    ):
        draft = released(evidence(**change))
        assert draft.status == "MANUAL_REVIEW", change
        assert "DOMAIN_UNVALIDATED" in draft.reasons, change


# ------------------------------------------------------------------ specification authority


def test_evidence_bound_to_another_specification_is_stale():
    draft = released(evidence(spec_sha256="2" * 64))
    assert (draft.status, "EVIDENCE_STALE" in draft.reasons) == ("MANUAL_REVIEW", True)


def test_a_specification_whose_hash_does_not_match_its_content_is_a_conflict():
    tampered = SPEC.model_copy(update={"allowed_fabric_labels": ["satin"]})
    draft = released(evidence(), spec=tampered)
    assert (draft.status, "PO_CONFLICT" in draft.reasons) == ("MANUAL_REVIEW", True)


def test_recorded_contradictions_block_automation():
    draft = released(evidence(contradictions=["PO_CONFLICT"]))
    assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["PO_CONFLICT"])


def test_edited_evidence_no_longer_matches_its_manifest():
    ev = evidence()
    tampered = ev.model_copy(update={"contradictions": []})  # same content: still valid
    assert released(tampered).status == "ACCEPT"
    edited = Evidence.model_validate({**ev.model_dump(mode="json"), "domain_id": "lab-woven-1"})
    forged = edited.model_copy(update={"manifest_sha256": "3" * 64})
    assert released(forged).status == "MANUAL_REVIEW"


def test_evidence_from_the_future_beyond_clock_skew_is_stale():
    ok = released(evidence(created_at="2026-11-13T08:07:59Z"))  # within 120 s of 08:06:00
    late = released(evidence(created_at="2026-11-13T08:08:01Z"))
    assert ok.status == "ACCEPT"
    assert (late.status, "EVIDENCE_STALE" in late.reasons) == ("MANUAL_REVIEW", True)


# ------------------------------------------------------------------ fabric and domain stage


def test_unknown_fabric_is_reviewed_and_differs_from_a_missing_head():
    unknown = released(evidence(fabric__value__label=None, fabric__value__unknown=True))
    missing = released(evidence(fabric=off("FAILED", "STAGE_UNAVAILABLE")))
    assert (unknown.status, unknown.reasons) == ("MANUAL_REVIEW", ["UNKNOWN_FABRIC"])
    assert (missing.status, missing.reasons) == ("MANUAL_REVIEW", ["STAGE_UNAVAILABLE"])


def test_out_of_domain_evidence_is_reviewed_even_with_a_confident_known_fabric():
    draft = released(evidence(domain__value__in_domain=False))
    assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["OOD"])


def test_an_uncalibrated_fabric_probability_cannot_be_automated():
    draft = released(evidence(fabric__value__calibrated_probability=None))
    assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["DOMAIN_UNVALIDATED"])


def test_a_confirmed_fabric_mismatch_is_held():
    spec = _respec(allowed_fabric_labels=["denim"])
    draft = released(evidence(spec_sha256=spec.content_sha256), spec=spec)
    assert (draft.status, draft.reasons, draft.automatic) == ("HOLD", ["FABRIC_MISMATCH"], True)


def test_a_label_outside_the_domain_or_taxonomy_is_reviewed_not_held():
    outside = released(evidence(fabric__value__label="canvas"))
    other_taxonomy = released(evidence(fabric__value__taxonomy_version="fabric22"))
    for draft in (outside, other_taxonomy):
        assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["DOMAIN_UNVALIDATED"])


def _respec(**changes) -> PurchaseSpec:
    data = {**SPEC.model_dump(mode="json"), **changes}
    data["content_sha256"] = content_sha256(data, exclude=("content_sha256",))
    return PurchaseSpec.model_validate(data)


# ------------------------------------------------------------------ defects


@pytest.mark.parametrize(
    ("score", "status", "reasons"),
    [
        (0.0, "ACCEPT", []),
        (0.1999, "ACCEPT", []),
        (0.2, "MANUAL_REVIEW", ["DEFECT_SUSPECTED"]),  # lower threshold itself is grey
        (0.5, "MANUAL_REVIEW", ["DEFECT_SUSPECTED"]),
        (0.7999, "MANUAL_REVIEW", ["DEFECT_SUSPECTED"]),
        (0.8, "HOLD", ["DEFECT_SUSPECTED"]),  # upper threshold itself holds
        (1.0, "HOLD", ["DEFECT_SUSPECTED"]),
    ],
)
def test_defect_thresholds_and_their_equalities(score, status, reasons):
    # The aggregate is the largest view, so the record stays self-consistent as the score moves.
    draft = released(
        evidence(
            defects__value__score=score,
            defects__value__views__0__score=score,
            defects__value__views__1__score=score,
        )
    )
    assert (draft.status, draft.reasons) == (status, reasons)


def test_a_defect_score_without_its_released_transform_means_nothing():
    draft = released(evidence(defects__value__score=0.0), domain=None)
    assert draft.status == "MANUAL_REVIEW"


def _without_defect_views(ev: Evidence) -> Evidence:
    """The same evidence with an OK defect stage that holds no view at all.

    The schema demands at least one view, so this record is assembled around validation: the
    policy still has to refuse it, and the manifest is recomputed so staleness is not the reason.
    """
    value = DefectValue.model_construct(score=0.0, regions=[], observed_area_cm2=0.0, views=[])
    stage = ev.defects.model_copy(update={"value": value})
    rewritten = ev.model_copy(update={"defects": stage})
    return rewritten.model_copy(update={"manifest_sha256": rewritten.expected_manifest_sha256()})


def test_a_defect_aggregate_score_below_its_largest_view_is_not_trusted():
    # 0.0 aggregated over a view that saw 1.0 would read as a clean sample.
    draft = released(evidence(defects__value__score=0.0, defects__value__views__1__score=1.0))
    assert draft.status == "MANUAL_REVIEW"
    assert "STAGE_UNAVAILABLE" in draft.reasons


def test_a_defect_aggregate_score_equal_to_its_largest_view_is_accepted():
    # The aggregate is the largest single view; equal to it, and below the accept threshold.
    draft = released(
        evidence(
            defects__value__score=0.1,
            defects__value__views__0__score=0.05,
            defects__value__views__1__score=0.1,
        )
    )
    assert (draft.status, draft.reasons, draft.automatic) == ("ACCEPT", [], True)


def test_an_ok_defect_stage_without_views_is_not_trusted():
    draft = released(_without_defect_views(evidence()))
    assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["STAGE_UNAVAILABLE"])


# ------------------------------------------------------------------ construction tolerance
# PO: ends 72..80 per inch.


@pytest.mark.parametrize(
    ("low", "value", "high", "status", "reasons"),
    [
        (72.0, 76.0, 80.0, "ACCEPT", []),  # touching both limits is inside
        (74.0, 76.0, 78.0, "ACCEPT", []),
        (71.9, 76.0, 80.0, "MANUAL_REVIEW", ["MEASUREMENT_UNCERTAIN"]),  # crosses the lower limit
        (79.0, 80.0, 80.1, "MANUAL_REVIEW", ["MEASUREMENT_UNCERTAIN"]),  # crosses the upper limit
        (80.0, 81.0, 82.0, "MANUAL_REVIEW", ["MEASUREMENT_UNCERTAIN"]),  # touches: not entirely out
        (80.1, 81.0, 82.0, "HOLD", ["CONSTRUCTION_OUTSIDE_TOLERANCE"]),
        (60.0, 65.0, 71.9, "HOLD", ["CONSTRUCTION_OUTSIDE_TOLERANCE"]),
        (60.0, 66.0, 72.0, "MANUAL_REVIEW", ["MEASUREMENT_UNCERTAIN"]),
        (60.0, 76.0, 90.0, "MANUAL_REVIEW", ["MEASUREMENT_UNCERTAIN"]),  # wide: says nothing
    ],
)
def test_density_intervals_against_tolerance(low, value, high, status, reasons):
    draft = released(evidence(**interval(0, low, value, high)))
    assert (draft.status, draft.reasons) == (status, reasons)


def test_tolerances_in_counts_per_cm_are_compared_in_counts_per_inch():
    # 30 per cm = 76.2 per inch; limits 29..31 per cm = 73.66..78.74 per inch.
    density = [d.model_dump(mode="json") for d in SPEC.density]
    density[0].update(unit="count/cm", target=30, lower=29, upper=31)
    spec = _respec(density=density)
    bound = {"spec_sha256": spec.content_sha256}
    inside = released(evidence(**bound, **interval(0, 73.66, 76.2, 78.74)), spec=spec)
    crossing = released(evidence(**bound, **interval(0, 73.6, 76.2, 78.74)), spec=spec)
    assert inside.status == "ACCEPT"
    assert crossing.status == "MANUAL_REVIEW"


def test_measurements_for_the_wrong_construction_are_not_used():
    knit = {"metrology__value__0__axis": "wales", "metrology__value__1__axis": "courses"}
    draft = released(evidence(**knit))
    assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["MEASUREMENT_UNCERTAIN"])


def test_an_expired_calibration_is_not_a_recapture():
    draft = released(evidence(metrology=off("ABSTAINED", "CALIBRATION_EXPIRED")))
    assert (draft.status, draft.reasons) == ("MANUAL_REVIEW", ["CALIBRATION_EXPIRED"])


# ------------------------------------------------------------------ recapture


def failed_check(name: str) -> dict:
    return {f"quality__value__checks__{name}": False}


@pytest.mark.parametrize(
    ("check", "reason"),
    [
        ("blur", "QUALITY_BLUR"),
        ("glare", "QUALITY_GLARE"),
        ("moire", "QUALITY_MOIRE"),
        ("fold", "QUALITY_FOLD"),
        ("framing", "QUALITY_FRAMING"),
        ("resolution", "RESOLUTION_LOW"),
        ("marker_geometry", "SCALE_INVALID"),
    ],
)
def test_each_failed_quality_check_names_what_to_retake(check, reason):
    draft = released(evidence(**failed_check(check)))
    assert (draft.status, draft.reasons, draft.automatic) == ("RECAPTURE", [reason], False)


@pytest.mark.parametrize(("attempt", "status"), [(1, "RECAPTURE"), (2, "RECAPTURE")])
def test_quality_only_failures_recapture_on_attempts_one_and_two(attempt, status):
    assert released(evidence(**failed_check("blur")), attempt).status == status


def test_the_third_quality_failure_escalates_instead_of_looping():
    draft = released(evidence(**failed_check("blur")), 3)
    assert draft.status == "MANUAL_REVIEW"
    assert draft.reasons == ["RECAPTURE_LIMIT", "QUALITY_BLUR"]


def test_a_missing_scale_marker_alone_is_a_recapture():
    draft = released(evidence(metrology=off("ABSTAINED", "SCALE_MISSING")))
    assert (draft.status, draft.reasons) == ("RECAPTURE", ["SCALE_MISSING"])


def test_quality_failure_mixed_with_an_authority_failure_is_reviewed():
    ev = evidence(defects=off("FAILED", "STAGE_UNAVAILABLE"), **failed_check("glare"))
    draft = released(ev)
    assert draft.status == "MANUAL_REVIEW"
    assert draft.reasons == ["STAGE_UNAVAILABLE", "QUALITY_GLARE"]


def test_a_failed_quality_stage_is_not_a_recapture_even_with_a_fixable_reason():
    draft = released(evidence(quality=off("FAILED", "QUALITY_BLUR")))
    assert draft.status == "MANUAL_REVIEW"
    assert draft.reasons == ["STAGE_UNAVAILABLE", "QUALITY_BLUR"]


def test_a_bad_capture_is_retaken_before_any_nonconformance_is_held():
    ev = evidence(**failed_check("blur"), **interval(0, 82.0, 84.0, 86.0))
    assert released(ev).status == "RECAPTURE"


def test_review_only_recapture_is_allowed_only_when_quality_is_the_sole_problem():
    blurry = evidence(**failed_check("blur"))
    alone = evaluate_qc(blurry, SPEC, REVIEW_ONLY, None, 1, CONTEXT, domain=DOMAIN)
    third = evaluate_qc(blurry, SPEC, REVIEW_ONLY, None, 3, CONTEXT, domain=DOMAIN)
    mixed = evaluate_qc(
        evidence(fabric=off("DISABLED", "STAGE_UNAVAILABLE"), **failed_check("blur")),
        SPEC, REVIEW_ONLY, None, 1, CONTEXT, domain=DOMAIN,
    )  # fmt: skip
    assert (alone.status, alone.reasons, alone.automatic) == ("RECAPTURE", ["QUALITY_BLUR"], False)
    assert third.status == "MANUAL_REVIEW" and third.reasons[0] == "RECAPTURE_LIMIT"
    assert mixed.status == "MANUAL_REVIEW"


@pytest.mark.parametrize("attempt", [0, 4, -1])
def test_attempts_outside_one_to_three_are_refused(attempt):
    with pytest.raises(ValueError):
        released(evidence(), attempt)


def test_attempt_must_be_a_real_integer():
    for bad in (True, 1.0, "1"):
        with pytest.raises(TypeError):
            released(evidence(), bad)


# ------------------------------------------------------------------ exhaustive safety sweep


def test_no_single_missing_precondition_ever_yields_an_automatic_status():
    """Remove one precondition at a time from the accepted case: none may stay automatic."""
    removals = {
        "review-only policy": {"policy": REVIEW_ONLY},
        "no release": {"release": None},
        "candidate release": {"release": CANDIDATE},
        "no domain": {"domain": None},
        "expired": {"context": at("2030-01-01T00:00:00Z")},
    }
    for name, over in removals.items():
        assert released(evidence(), **over).status not in AUTOMATIC, name
    for stage in ("quality", "fabric", "defects", "metrology", "domain"):
        for state in ("ABSTAINED", "FAILED", "DISABLED", "NOT_RUN"):
            for reason in ("STAGE_UNAVAILABLE", "QUALITY_BLUR", "OOD", "CALIBRATION_EXPIRED"):
                status = released(evidence(**{stage: off(state, reason)})).status
                assert status not in AUTOMATIC, (stage, state, reason)


def test_the_policy_imports_no_model_database_or_network_code():
    source = Path(qc_policy.__file__).read_text("utf-8")
    for forbidden in ("torch", "numpy", "cv2", "sqlite", "requests", "httpx", "services.vision"):
        assert forbidden not in source, forbidden
