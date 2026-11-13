"""Builds the shared QC v2 contract fixtures: valid.json, invalid.json, canonical.json.

    cd scanner && python tests/fixtures/qc-v2/build.py

Every value here is a synthetic contract example (hashes are SHA-256 of ``fixture-<name>``,
people are ``user-*``). None of it is a measurement, a model result or an approval. Python,
the Yarnflow Worker, TypeScript and Swift all decode these same files.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from services.api.qc_schemas import (  # noqa: E402
    CONTRACT_TYPES,
    canonical_json,
    content_sha256,
    sha256_hex,
)

HERE = Path(__file__).parent


def h(name: str) -> str:
    return sha256_hex(f"fixture-{name}")


def u(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


WS, WS2 = u(1), u(2)
SPEC, SEL, SAMPLE, SAMPLE2, SET, CONSENT = u(10), u(20), u(30), u(31), u(40), u(50)
CAP_O, CAP_S, CAP_K = u(60), u(61), u(62)
EVID, DEC, ADJ, ADJ2, REL, REQ, AXIS = u(70), u(80), u(90), u(91), u(100), u(110), u(120)
T0, T1, T2, T9 = (
    "2026-11-13T08:00:00Z",
    "2026-11-13T08:05:00Z",
    "2026-11-13T08:06:00Z",
    "2027-11-13T08:00:00Z",
)


def prov(source="PO_CONFIRMED", **extra):
    base = {
        "source": source,
        "source_id": "po-doc-1",
        "source_version": "1",
        "actor_id": "user-purchase",
        "observed_at": T0,
        "image_sha256": None,
        "document_sha256": None,
        "page": None,
        "span": None,
        "raw_value": None,
        "raw_unit": None,
        "ocr_confidence": None,
        "candidate_id": None,
        "corrects_id": None,
    }
    return {**base, **extra}


def density(axis, unit, target, lower, upper, **p):
    return {
        "axis": axis,
        "unit": unit,
        "target": target,
        "lower": lower,
        "upper": upper,
        "provenance": prov(**p),
    }


def hashed(record: dict, field: str, exclude: tuple[str, ...]) -> dict:
    record[field] = content_sha256(record, exclude=exclude)
    return record


def spec(version=1, **over):
    s = {
        "schema_version": "2",
        "id": SPEC,
        "version": version,
        "workspace_id": WS,
        "purchase_order_id": "po-0001",
        "content_sha256": "",
        "construction": "woven",
        "allowed_fabric_labels": ["twill", "denim"],
        "taxonomy_version": "fabric24-head_a",
        "density": [
            density(
                "ends",
                "count/in",
                76,
                72,
                80,
                document_sha256=h("po-pdf"),
                page=1,
                span=[120, 131],
                raw_value="76",
                raw_unit="ends/inch",
                ocr_confidence=0.91,
                candidate_id=u(200),
            ),
            density("picks", "count/in", 68.5, 65, 72),
        ],
        "confirmed_by": "user-purchase",
        "confirmed_at": T0,
        "supersedes_version": None if version == 1 else version - 1,
    }
    s.update(over)
    return hashed(s, "content_sha256", ("content_sha256",))


SPEC_V1 = spec()
SPEC_V2 = spec(2, allowed_fabric_labels=["twill"])
SPEC_KNIT = spec(
    construction="knit",
    density=[
        density("wales", "count/cm", 14, 13, 15),
        density("courses", "count/cm", 20, 18.5, 21),
    ],
)

SELECTION = {
    "id": SEL,
    "workspace_id": WS,
    "purchase_order_id": "po-0001",
    "plan_version": "lab-plan-1",
    "plan_sha256": None,
    "randomization_seed": None,
    "draw_index": None,
    "selection_probability": None,
    "cohort": "OPERATIONAL",
    "independent_group_id": "roll-R17",
    "lot_ref": "LOT-22",
    "roll_ref": "R17",
    "location_ref": "3 m from start, centre",
    "face": "face",
    "planned_area_cm2": 100,
    "method": "operator-chosen",
    "created_by": "user-inspector",
    "created_at": T0,
}
SELECTION_CONFIRMATORY = {
    **SELECTION,
    "id": u(21),
    "plan_sha256": h("plan"),
    "randomization_seed": "seed-20261113",
    "draw_index": 4,
    "selection_probability": 0.125,
    "cohort": "CONFIRMATORY",
    "method": "randomised-location",
}


def sample(**over):
    s = {
        "schema_version": "2",
        "id": SAMPLE,
        "workspace_id": WS,
        "purchase_order_id": "po-0001",
        "spec_id": SPEC,
        "spec_version": 1,
        "lot_ref": "LOT-22",
        "roll_ref": "R17",
        "location_ref": "3 m from start, centre",
        "sample_plan_version": "lab-plan-1",
        "capture_attempt": 0,
        "revision": 0,
        "predecessor_sample_id": None,
        "selection_id": SEL,
        "face": "face",
        "planned_area_cm2": 100,
        "usable_area_cm2": None,
        "sampling_method": "operator-chosen",
        "independent_group_id": "roll-R17",
        "disposition": "SELECTED",
        "exclusion_reason": None,
        "created_by": "user-inspector",
        "created_at": T0,
    }
    s.update(over)
    return s


def attestation(image, mode="WEB_CAMERA", **over):
    a = {
        "image_sha256": image,
        "capture_mode": mode,
        "device_model": None,
        "lens_id": None,
        "zoom_factor": None,
        "focus_mode": None,
        "exposure_mode": None,
        "resolution": [4032, 3024],
        "orientation": 1,
        "processing": None,
        "captured_at": T1,
    }
    a.update(over)
    return a


def capture(cid, role, name, **over):
    att = attestation(h(name))
    c = {
        "id": cid,
        "sample_id": SAMPLE,
        "capture_set_id": SET,
        "original_sha256": h(name),
        "role": role,
        "taken_at": T1,
        "device_profile_id": "unprofiled",
        "calibration_id": None,
        "width": 4032,
        "height": 3024,
        "preprocessing_version": "qc-imageio-1",
        "consent_record_id": CONSENT,
        "byte_size": 3_481_220,
        "media_type": "image/jpeg",
        "original_state": "AVAILABLE",
        "attestation_sha256": content_sha256(att),
    }
    c.update(over)
    return c


CAPTURES = [
    capture(CAP_O, "overview", "overview"),
    capture(CAP_S, "structure", "structure"),
    capture(CAP_K, "scale", "scale"),
]
SET_OPEN = {
    "id": SET,
    "sample_id": SAMPLE,
    "state": "OPEN",
    "required_roles": ["overview", "structure", "scale"],
    "capture_ids": [CAP_O],
    "revision": 2,
    "attempt": None,
}
SET_CLOSED = {
    **SET_OPEN,
    "state": "CLOSED",
    "capture_ids": [CAP_O, CAP_S, CAP_K],
    "revision": 5,
    "attempt": 1,
}
CONSENT_REC = {
    "id": CONSENT,
    "version": 1,
    "workspace_id": WS,
    "authority_evidence_sha256": h("consent-register"),
    "operational_capture": True,
    "operational_retention_days": 30,
    "research_use": False,
    "training_use": False,
    "export_destinations": [],
    "valid_from": T0,
    "expires_at": T9,
    "withdrawn_at": None,
}


def stage(state, value=None, reasons=(), artifact=None, ms=1.5):
    return {
        "state": state,
        "value": value,
        "reasons": list(reasons),
        "artifact_sha256": artifact,
        "duration_ms": ms,
    }


def evidence(**over):
    e = {
        "schema_version": "2",
        "id": EVID,
        "sample_id": SAMPLE,
        "capture_ids": [CAP_O, CAP_S, CAP_K],
        "spec_sha256": SPEC_V1["content_sha256"],
        "domain_id": None,
        "domain": stage("DISABLED", reasons=["DOMAIN_UNVALIDATED"]),
        "fabric": stage("DISABLED", reasons=["STAGE_UNAVAILABLE"]),
        "defects": stage("DISABLED", reasons=["STAGE_UNAVAILABLE"]),
        "metrology": stage("ABSTAINED", reasons=["DOMAIN_UNVALIDATED"]),
        "quality": stage("ABSTAINED", reasons=["STAGE_UNAVAILABLE", "QUALITY_BLUR"]),
        "contradictions": [],
        "manifest_sha256": "",
        "created_at": T2,
    }
    e.update(over)
    return hashed(e, "manifest_sha256", ("manifest_sha256", "id", "created_at"))


def measurement(axis, value, low, high, cap=CAP_S, name="structure"):
    return {
        "capture_id": cap,
        "capture_sha256": h(name),
        "source_roi": [0.25, 0.25, 0.75, 0.75],
        "calibration_sha256": h("calibration"),
        "geometry_artifact_sha256": h("geometry"),
        "uncertainty_report_sha256": h("uncertainty"),
        "axis_registration_id": AXIS,
        "axis": axis,
        "unit": "count/in",
        "value": value,
        "interval95": [low, high],
        "reference_id": "card-A",
        "method_version": "qc-metrology-1",
    }


def views():
    return [
        {
            "capture_id": cid,
            "capture_sha256": h(name),
            "transform_id": "identity",
            "score": score,
            "observed_area_cm2": None,
        }
        for cid, name, score in ((CAP_O, "overview", 0.02), (CAP_S, "structure", 0.04))
    ]


# A fully populated record. Synthetic: it exists so every client can decode an OK stage,
# not because any model produced it.
EVIDENCE_REVIEW = evidence()
EVIDENCE_FULL = evidence(
    domain_id="lab-woven-1",
    domain=stage(
        "OK",
        {"in_domain": True, "assessment_version": "ood-1", "profile_sha256": h("profile")},
        artifact=h("ood-artifact"),
    ),
    fabric=stage(
        "OK",
        {
            "label": "twill",
            "taxonomy_version": "fabric24-head_a",
            "calibrated_probability": None,
            "unknown": False,
            "candidates": [
                {"label": "twill", "raw_score": 4.2},
                {"label": "denim", "raw_score": 2.5},
            ],
        },
        artifact=h("bundle"),
    ),
    defects=stage(
        "OK",
        {
            "score": 0.04,
            "regions": [
                {
                    "capture_id": CAP_O,
                    "transform_id": "identity",
                    "box": [0.1, 0.1, 0.2, 0.2],
                    "score": 0.02,
                    "label": None,
                },
                {
                    "capture_id": CAP_S,
                    "transform_id": "identity",
                    "box": [0.1, 0.1, 0.2, 0.2],
                    "score": 0.04,
                    "label": None,
                },
            ],
            "observed_area_cm2": 0,
            "views": views(),
        },
        artifact=h("fault"),
    ),
    metrology=stage(
        "OK",
        [measurement("ends", 76.2, 74.9, 77.5), measurement("picks", 68.1, 66.8, 69.4)],
        artifact=h("metrology"),
    ),
    quality=stage(
        "OK",
        {
            "checks": {
                "blur": True,
                "glare": True,
                "moire": True,
                "fold": True,
                "framing": True,
                "resolution": True,
                "marker_geometry": True,
            }
        },
        artifact=h("quality-thresholds"),
    ),
)
EVIDENCE_UNKNOWN = evidence(
    fabric=stage(
        "OK",
        {
            "label": None,
            "taxonomy_version": "fabric24-head_a",
            "calibrated_probability": None,
            "unknown": True,
            "candidates": [{"label": "twill", "raw_score": 0.4}],
        },
        artifact=h("bundle"),
    )
)

DRAFT_REVIEW = {
    "status": "MANUAL_REVIEW",
    "reasons": ["POLICY_UNRELEASED", "STAGE_UNAVAILABLE", "DOMAIN_UNVALIDATED", "QUALITY_BLUR"],
    "automatic": False,
    "scope": "INSPECTED_SAMPLE",
}
DRAFT_RECAPTURE = {**DRAFT_REVIEW, "status": "RECAPTURE", "reasons": ["QUALITY_BLUR"]}
DRAFT_ACCEPT = {"status": "ACCEPT", "reasons": [], "automatic": True, "scope": "INSPECTED_SAMPLE"}
DRAFT_HOLD = {**DRAFT_ACCEPT, "status": "HOLD", "reasons": ["CONSTRUCTION_OUTSIDE_TOLERANCE"]}


def decision(draft=DRAFT_REVIEW, **over):
    d = {
        **draft,
        "schema_version": "2",
        "id": DEC,
        "sample_id": SAMPLE,
        "evidence_id": EVID,
        "spec_id": SPEC,
        "spec_version": 1,
        "revision": 6,
        "policy_version": "review-only-1",
        "release_id": None,
        "evaluated_at": T2,
    }
    d.update(over)
    return d


DECISION = decision()
DECISION_ACCEPT = decision(DRAFT_ACCEPT, release_id=REL, policy_version="automatic-1")
ADJUDICATION = {
    "id": ADJ,
    "sample_id": SAMPLE,
    "revision": 7,
    "outcome": "UNDETERMINED",
    "reason": "Pick glass count needed before a finding.",
    "reference_ids": [],
    "actor_id": "user-supervisor",
    "created_at": T2,
    "supersedes_id": None,
    "intervention_reason": None,
}
ADJUDICATION2 = {
    **ADJUDICATION,
    "id": ADJ2,
    "revision": 8,
    "outcome": "CONFORMING",
    "reason": "Pick glass: 76 ends, 68 picks at the registered location.",
    "reference_ids": ["pickglass-2026-11-13-01"],
    "supersedes_id": ADJ,
}
FAMILY = {
    "selection_id": SEL,
    "predecessor_sample_id": None,
    "successor_sample_ids": [],
    "attempts_used": 0,
    "attempts_max": 3,
    "spec_is_current": True,
    "current_spec_version": 1,
}
RESULT_CREATED = {
    "schema_version": "2",
    "mode": "REVIEW_ONLY",
    "sample": sample(),
    "captures": [],
    "capture_sets": [],
    "evidence": None,
    "decision": None,
    "history": [],
    "adjudications": [],
    "current_human_disposition": None,
    "recalled_decision_ids": [],
    "family": FAMILY,
    "revision": 0,
}
RESULT_UPLOADING = {
    **RESULT_CREATED,
    "sample": sample(revision=2),
    "captures": [CAPTURES[0]],
    "capture_sets": [SET_OPEN],
    "revision": 2,
}
RESULT_CLOSED = {
    **RESULT_CREATED,
    "sample": sample(revision=5, capture_attempt=1, disposition="SUBMITTED"),
    "captures": CAPTURES,
    "capture_sets": [SET_CLOSED],
    "family": {**FAMILY, "attempts_used": 1},
    "revision": 5,
}
RESULT_DECIDED = {
    **RESULT_CLOSED,
    "sample": sample(revision=8, capture_attempt=1, disposition="SUBMITTED"),
    "evidence": EVIDENCE_REVIEW,
    "decision": DECISION,
    "history": [DECISION],
    "adjudications": [ADJUDICATION, ADJUDICATION2],
    "current_human_disposition": ADJUDICATION2,
    "revision": 8,
}
RESULT_STALE = {
    **RESULT_DECIDED,
    "family": {
        **FAMILY,
        "attempts_used": 1,
        "successor_sample_ids": [SAMPLE2],
        "spec_is_current": False,
        "current_spec_version": 2,
    },
}
RESULT_LINKED = {
    **RESULT_CREATED,
    "sample": sample(id=SAMPLE2, spec_version=2, predecessor_sample_id=SAMPLE, capture_attempt=1),
    "family": {
        **FAMILY,
        "predecessor_sample_id": SAMPLE,
        "attempts_used": 1,
        "current_spec_version": 2,
    },
}
RESULT_MISSING = {
    **RESULT_CREATED,
    "sample": sample(disposition="MISSING", exclusion_reason="Roll not found at the dock."),
}

POLICY = hashed(
    {
        "schema_version": "2",
        "version": "review-only-1",
        "sha256": "",
        "mode": "REVIEW_ONLY",
        "required_stages": ["quality", "fabric", "defects", "metrology", "domain"],
        "max_capture_sets": 3,
    },
    "sha256",
    ("sha256",),
)
POLICY_AUTO = hashed(
    {**POLICY, "version": "automatic-1", "mode": "AUTOMATIC"}, "sha256", ("sha256",)
)
DOMAIN = hashed(
    {
        "id": "lab-woven-1",
        "version": "1",
        "sha256": "",
        "construction": "woven",
        "effective_labels": ["twill", "denim"],
        "taxonomy_sha256": h("taxonomy"),
        "required_roles": ["overview", "structure", "scale"],
        "profile_sha256s": [h("profile")],
        "preprocessing_sha256": h("preprocessing"),
        "score_transform_sha256": h("score-transform"),
        "unknown_assessment_sha256": h("ood-artifact"),
        "quality_thresholds_sha256": h("quality-thresholds"),
        "metrology_validation_sha256": h("metrology"),
        "defect_accept_below": 0.2,
        "defect_hold_at_or_above": 0.8,
    },
    "sha256",
    ("sha256",),
)


def release(state="STATISTICAL_CANDIDATE", **over):
    r = {
        "id": REL,
        "version": "candidate-1",
        "sha256": "",
        "workspace_id": WS,
        "state": state,
        "domain_sha256": DOMAIN["sha256"],
        "policy_sha256": POLICY_AUTO["sha256"],
        "bundle_sha256": h("bundle"),
        "calibration_sha256": h("calibration"),
        "statistics_report_sha256": h("statistics"),
        "operations_proof_sha256": None,
        "monitoring_protocol_sha256": None,
        "authority_record_sha256": h("authority"),
        "approved_by": "user-admin",
        "independent_signatory": "external-qc-signatory",
        "expires_at": T9,
        "predecessor_release_id": None,
    }
    r.update(over)
    return hashed(r, "sha256", ("sha256", "state"))


RELEASE = release()
RELEASE_ACTIVE = release(
    "ACTIVE", operations_proof_sha256=h("operations"), monitoring_protocol_sha256=h("monitoring")
)
CONTEXT = {
    "evaluated_at": T2,
    "clock_source": "WORKER_UTC",
    "deadline_at": "2026-11-13T08:07:00Z",
    "calibration_records_sha256": h("calibration-records"),
    "capture_binding_sha256": h("capture-binding"),
    "request_id": REQ,
    "request_generation": 1,
}
PROFILE = {
    "id": "iphone-main-1x",
    "version": "1",
    "sha256": h("profile"),
    "device_profile_id": "iphone-main-1x",
    "lens_id": "wide",
    "resolution": [4032, 3024],
    "focus_mode": "locked",
    "distance_mm": [180, 220],
    "lighting_protocol_sha256": h("lighting"),
    "processing_sha256": h("processing"),
    "distortion_model_sha256": h("distortion"),
    "source_resolution_limits_sha256": h("resolution-limits"),
    "uncertainty_model_sha256": h("uncertainty"),
    "reference_ids": ["card-A"],
    "valid_from": T0,
    "expires_at": T9,
}
REFERENCE = {
    "id": "card-A",
    "sha256": h("card-A"),
    "dimensions_mm": [50, 50],
    "uncertainty_mm": [0.1, 0.1],
    "traceability_report_sha256": h("traceability"),
    "print_verification_sha256": h("print-verification"),
}
AXIS_REG = {
    "id": AXIS,
    "capture_id": CAP_S,
    "capture_sha256": h("structure"),
    "physical_indicator": "SELVEDGE",
    "provenance": prov("OPERATOR", source_id="selvedge-mark", actor_id="user-inspector"),
    "origin_xy": [0.5, 0.5],
    "direction_xy": [0, 1],
    "transform_sha256": h("transform"),
}


def validated(cap, name, **over):
    att = attestation(h(name))
    v = {
        "capture": cap,
        "original_storage_reference": f"qc/{WS}/{cap['id']}",
        "verified_sha256": h(name),
        "acquisition_attestation_sha256": content_sha256(att),
        "attestation": att,
        "geometry_artifact_sha256": None,
        "calibration": None,
        "reference": None,
        "axis_registration": None,
    }
    v.update(over)
    return v


VALIDATED = [
    validated(CAPTURES[0], "overview"),
    validated(CAPTURES[1], "structure", axis_registration=AXIS_REG),
    validated(CAPTURES[2], "scale"),
]
READINESS = {
    "schema_version": "2",
    "ready": False,
    "bundle_sha256": None,
    "stages": [
        {
            "name": "quality",
            "state": "ABSTAINED",
            "artifact_sha256": None,
            "reasons": ["STAGE_UNAVAILABLE"],
        },
        {
            "name": "fabric",
            "state": "DISABLED",
            "artifact_sha256": None,
            "reasons": ["STAGE_UNAVAILABLE"],
        },
        {
            "name": "defects",
            "state": "DISABLED",
            "artifact_sha256": None,
            "reasons": ["STAGE_UNAVAILABLE"],
        },
        {
            "name": "metrology",
            "state": "ABSTAINED",
            "artifact_sha256": None,
            "reasons": ["DOMAIN_UNVALIDATED"],
        },
        {
            "name": "domain",
            "state": "DISABLED",
            "artifact_sha256": None,
            "reasons": ["DOMAIN_UNVALIDATED"],
        },
    ],
}
BINDING = {
    "spec_sha256": SPEC_V1["content_sha256"],
    "policy_sha256": POLICY["sha256"],
    "release_sha256": None,
    "capture_sha256s": [h("overview"), h("structure"), h("scale")],
    "attempt": 1,
    "expected_revision": 5,
    "request_id": REQ,
    "request_generation": 1,
    "deadline_at": CONTEXT["deadline_at"],
}
CANDIDATE = {"evidence": EVIDENCE_REVIEW, "draft": DRAFT_REVIEW, "binding": BINDING}
ANALYZE = {
    "schema_version": "2",
    "sample_id": SAMPLE,
    "workspace_id": WS,
    "spec": SPEC_V1,
    "policy": POLICY,
    "release": None,
    "domain": None,
    "attempt": 1,
    "expected_revision": 5,
    "context": CONTEXT,
    "captures": VALIDATED,
}
CLAIMS = {
    "kid": "qc-local-1",
    "aud": "texpilot-scanner-qc",
    "iat": 1794556800,
    "exp": 1794556830,
    "nonce": "0123456789abcdef0123456789abcdef",
    "request_id": REQ,
    "request_generation": 1,
    "workspace_id": WS,
    "actor_id": "user-inspector",
    "payload_sha256": h("payload"),
    "deadline_at": CONTEXT["deadline_at"],
}
ERROR = {
    "schema_version": "2",
    "error": {
        "code": "CONFLICT",
        "reasons": ["PO_VERSION_STALE"],
        "retryable": False,
        "request_id": REQ,
    },
}

VALID: list[tuple[str, str, dict]] = [
    ("provenance-confirmed", "Provenance", prov()),
    (
        "provenance-ocr-candidate",
        "Provenance",
        SPEC_V1["density"][0]["provenance"] | {"source": "OCR_CANDIDATE"},
    ),
    ("density-count-per-inch", "DensitySpec", SPEC_V1["density"][0]),
    ("density-limit-equals-target", "DensitySpec", density("picks", "count/cm", 27, 27, 27)),
    ("spec-woven-v1", "PurchaseSpec", SPEC_V1),
    ("spec-woven-v2-supersedes", "PurchaseSpec", SPEC_V2),
    ("spec-knit-count-per-cm", "PurchaseSpec", SPEC_KNIT),
    ("selection-operational", "SamplingSelection", SELECTION),
    ("selection-confirmatory", "SamplingSelection", SELECTION_CONFIRMATORY),
    ("sample-created", "Sample", sample()),
    ("sample-linked-evaluation", "Sample", RESULT_LINKED["sample"]),
    ("sample-missing", "Sample", RESULT_MISSING["sample"]),
    ("attestation-web-unobserved", "AcquisitionAttestation", attestation(h("overview"))),
    (
        "attestation-native-observed",
        "AcquisitionAttestation",
        attestation(
            h("structure"),
            "NATIVE_CAMERA",
            device_model="iPhone17,1",
            lens_id="wide",
            zoom_factor=1,
            focus_mode="locked",
            exposure_mode="locked",
            processing="none",
        ),
    ),
    ("capture-overview", "Capture", CAPTURES[0]),
    ("capture-purged-tombstone", "Capture", {**CAPTURES[1], "original_state": "PURGED"}),
    ("capture-set-open", "CaptureSet", SET_OPEN),
    ("capture-set-closed", "CaptureSet", SET_CLOSED),
    ("consent-operational-only", "ConsentAuthority", CONSENT_REC),
    ("evidence-review-only-stages-unavailable", "Evidence", EVIDENCE_REVIEW),
    ("evidence-synthetic-all-stages-ok", "Evidence", EVIDENCE_FULL),
    ("evidence-fabric-unknown", "Evidence", EVIDENCE_UNKNOWN),
    ("draft-manual-review", "DecisionDraft", DRAFT_REVIEW),
    ("draft-recapture", "DecisionDraft", DRAFT_RECAPTURE),
    ("draft-accept", "DecisionDraft", DRAFT_ACCEPT),
    ("draft-hold", "DecisionDraft", DRAFT_HOLD),
    ("decision-manual-review", "Decision", DECISION),
    ("decision-automatic-accept", "Decision", DECISION_ACCEPT),
    ("adjudication-undetermined", "Adjudication", ADJUDICATION),
    ("adjudication-supersedes", "Adjudication", ADJUDICATION2),
    (
        "adjudication-admin-intervention",
        "Adjudication",
        {
            **ADJUDICATION,
            "actor_id": "user-admin",
            "intervention_reason": "Supervisor absent today.",
        },
    ),
    ("result-created", "QCResult", RESULT_CREATED),
    ("result-upload-in-progress", "QCResult", RESULT_UPLOADING),
    ("result-set-closed", "QCResult", RESULT_CLOSED),
    ("result-decided-with-adjudications", "QCResult", RESULT_DECIDED),
    ("result-spec-stale", "QCResult", RESULT_STALE),
    ("result-linked-evaluation", "QCResult", RESULT_LINKED),
    ("result-missing-selection", "QCResult", RESULT_MISSING),
    ("policy-review-only", "Policy", POLICY),
    ("policy-automatic", "Policy", POLICY_AUTO),
    ("domain-manifest", "DomainManifest", DOMAIN),
    ("release-statistical-candidate", "Release", RELEASE),
    ("release-active", "Release", RELEASE_ACTIVE),
    ("evaluation-context", "EvaluationContext", CONTEXT),
    ("calibration-profile", "CalibrationProfile", PROFILE),
    ("scale-reference", "ScaleReference", REFERENCE),
    ("axis-registration", "AxisRegistration", AXIS_REG),
    ("validated-capture-with-axis", "ValidatedCapture", VALIDATED[1]),
    ("readiness-nothing-available", "Readiness", READINESS),
    ("analysis-candidate-review", "AnalysisCandidate", CANDIDATE),
    ("analyze-request", "AnalyzeRequest", ANALYZE),
    ("assertion-claims", "AssertionClaims", CLAIMS),
    ("error-conflict", "ErrorEnvelope", ERROR),
]


def mut(base: dict, path: str, value, *, delete=False) -> dict:
    out = copy.deepcopy(base)
    node = out
    parts = path.split(".")
    for p in parts[:-1]:
        node = node[int(p)] if isinstance(node, list) else node[p]
    last = int(parts[-1]) if isinstance(node, list) else parts[-1]
    if delete:
        del node[last]
    else:
        node[last] = value
    return out


S, X = "schema", "semantic"
INVALID: list[tuple[str, str, dict, str]] = [
    ("spec-unknown-field", "PurchaseSpec", {**SPEC_V1, "automatic": True}, S),
    ("spec-client-workspace-not-uuid", "PurchaseSpec", mut(SPEC_V1, "workspace_id", "mine"), S),
    ("spec-unsupported-unit", "PurchaseSpec", mut(SPEC_V1, "density.0.unit", "count/m"), S),
    ("spec-unknown-construction", "PurchaseSpec", mut(SPEC_V1, "construction", "nonwoven"), S),
    ("spec-negative-lower", "PurchaseSpec", mut(SPEC_V1, "density.0.lower", -1), S),
    ("spec-zero-target", "PurchaseSpec", mut(SPEC_V1, "density.0.target", 0), S),
    ("spec-density-as-text", "PurchaseSpec", mut(SPEC_V1, "density.0.target", "76"), S),
    ("spec-empty-axes", "PurchaseSpec", mut(SPEC_V1, "density", []), S),
    (
        "spec-missing-confirmation",
        "PurchaseSpec",
        mut(SPEC_V1, "confirmed_by", None, delete=True),
        S,
    ),
    ("spec-no-allowed-labels", "PurchaseSpec", mut(SPEC_V1, "allowed_fabric_labels", []), S),
    (
        "spec-reversed-limits",
        "PurchaseSpec",
        mut(mut(SPEC_V1, "density.0.lower", 80), "density.0.upper", 72),
        X,
    ),
    ("spec-target-outside-limits", "PurchaseSpec", mut(SPEC_V1, "density.0.target", 90), X),
    ("spec-duplicate-ends", "PurchaseSpec", mut(SPEC_V1, "density.1.axis", "ends"), X),
    ("spec-knit-axis-on-woven", "PurchaseSpec", mut(SPEC_V1, "density.1.axis", "courses"), X),
    (
        "spec-unconfirmed-ocr-value",
        "PurchaseSpec",
        mut(SPEC_V1, "density.0.provenance.source", "OCR_CANDIDATE"),
        X,
    ),
    ("spec-v2-without-predecessor", "PurchaseSpec", mut(SPEC_V2, "supersedes_version", None), X),
    ("spec-v1-with-predecessor", "PurchaseSpec", mut(SPEC_V1, "supersedes_version", 1), X),
    (
        "spec-duplicate-labels",
        "PurchaseSpec",
        mut(SPEC_V1, "allowed_fabric_labels", ["twill", "twill"]),
        X,
    ),
    ("provenance-reversed-span", "Provenance", prov(span=[9, 2]), X),
    ("sample-attempt-over-limit", "Sample", sample(capture_attempt=4), S),
    ("sample-unknown-disposition", "Sample", sample(disposition="ACCEPTED"), S),
    ("sample-excluded-without-reason", "Sample", sample(disposition="EXCLUDED"), X),
    ("sample-selected-with-reason", "Sample", sample(exclusion_reason="none"), X),
    (
        "selection-zero-probability",
        "SamplingSelection",
        {**SELECTION_CONFIRMATORY, "selection_probability": 0},
        S,
    ),
    ("selection-unknown-cohort", "SamplingSelection", {**SELECTION, "cohort": "PILOT"}, S),
    ("capture-heic", "Capture", {**CAPTURES[0], "media_type": "image/heic"}, S),
    ("capture-over-byte-limit", "Capture", {**CAPTURES[0], "byte_size": 12 * 1024 * 1024 + 1}, S),
    (
        "capture-uppercase-hash",
        "Capture",
        {**CAPTURES[0], "original_sha256": h("overview").upper()},
        S,
    ),
    ("capture-over-pixel-limit", "Capture", {**CAPTURES[0], "width": 5000, "height": 4000}, X),
    ("capture-set-open-with-attempt", "CaptureSet", {**SET_OPEN, "attempt": 1}, X),
    ("capture-set-closed-without-attempt", "CaptureSet", {**SET_CLOSED, "attempt": None}, X),
    (
        "capture-set-duplicate-capture",
        "CaptureSet",
        {**SET_CLOSED, "capture_ids": [CAP_O, CAP_O]},
        X,
    ),
    (
        "capture-set-five-captures",
        "CaptureSet",
        {**SET_CLOSED, "capture_ids": [u(n) for n in range(60, 65)]},
        S,
    ),
    (
        "consent-zero-retention",
        "ConsentAuthority",
        {**CONSENT_REC, "operational_retention_days": 0},
        S,
    ),
    ("evidence-ok-stage-without-value", "Evidence", mut(EVIDENCE_FULL, "fabric.value", None), X),
    (
        "evidence-ok-stage-without-artifact",
        "Evidence",
        mut(EVIDENCE_FULL, "quality.artifact_sha256", None),
        X,
    ),
    (
        "evidence-disabled-stage-with-value",
        "Evidence",
        mut(
            EVIDENCE_REVIEW,
            "fabric",
            {**EVIDENCE_FULL["fabric"], "state": "DISABLED", "reasons": ["STAGE_UNAVAILABLE"]},
        ),
        X,
    ),
    (
        "evidence-failed-stage-without-reason",
        "Evidence",
        mut(EVIDENCE_REVIEW, "defects", stage("FAILED")),
        X,
    ),
    ("evidence-unknown-stage-state", "Evidence", mut(EVIDENCE_REVIEW, "fabric.state", "PASS"), S),
    (
        "evidence-unknown-reason",
        "Evidence",
        mut(EVIDENCE_REVIEW, "fabric.reasons", ["LOOKS_FINE"]),
        S,
    ),
    (
        "evidence-missing-domain-stage",
        "Evidence",
        mut(EVIDENCE_REVIEW, "domain", None, delete=True),
        S,
    ),
    ("evidence-metrology-empty-list", "Evidence", mut(EVIDENCE_FULL, "metrology.value", []), X),
    (
        "evidence-metrology-missing-picks",
        "Evidence",
        mut(EVIDENCE_FULL, "metrology.value", [measurement("ends", 76.2, 74.9, 77.5)]),
        X,
    ),
    (
        "evidence-metrology-duplicate-ends",
        "Evidence",
        mut(EVIDENCE_FULL, "metrology.value.1.axis", "ends"),
        X,
    ),
    (
        "evidence-metrology-mixed-construction",
        "Evidence",
        mut(EVIDENCE_FULL, "metrology.value.1.axis", "courses"),
        X,
    ),
    (
        "evidence-metrology-point-outside-interval",
        "Evidence",
        mut(EVIDENCE_FULL, "metrology.value.0.value", 80),
        X,
    ),
    (
        "evidence-metrology-negative-interval",
        "Evidence",
        mut(EVIDENCE_FULL, "metrology.value.0.interval95", [-1, 77.5]),
        S,
    ),
    (
        "evidence-metrology-foreign-capture",
        "Evidence",
        mut(EVIDENCE_FULL, "metrology.value.0.capture_id", u(999)),
        X,
    ),
    (
        "evidence-fabric-unknown-with-label",
        "Evidence",
        mut(EVIDENCE_UNKNOWN, "fabric.value.label", "twill"),
        X,
    ),
    (
        "evidence-fabric-known-without-label",
        "Evidence",
        mut(EVIDENCE_FULL, "fabric.value.label", None),
        X,
    ),
    (
        "evidence-fabric-probability-over-one",
        "Evidence",
        mut(EVIDENCE_FULL, "fabric.value.calibrated_probability", 1.2),
        S,
    ),
    (
        "evidence-region-degenerate-box",
        "Evidence",
        mut(EVIDENCE_FULL, "defects.value.regions.0.box", [0.2, 0.1, 0.2, 0.2]),
        X,
    ),
    (
        "evidence-region-box-outside-unit",
        "Evidence",
        mut(EVIDENCE_FULL, "defects.value.regions.0.box", [0.1, 0.1, 1.2, 0.2]),
        S,
    ),
    (
        "evidence-region-without-evaluated-view",
        "Evidence",
        mut(EVIDENCE_FULL, "defects.value.regions.0.capture_id", CAP_K),
        X,
    ),
    (
        "evidence-quality-missing-check",
        "Evidence",
        mut(EVIDENCE_FULL, "quality.value.checks.moire", None, delete=True),
        S,
    ),
    (
        "evidence-quality-extra-check",
        "Evidence",
        mut(EVIDENCE_FULL, "quality.value.checks.colour", True),
        S,
    ),
    ("draft-accept-not-automatic", "DecisionDraft", {**DRAFT_ACCEPT, "automatic": False}, X),
    ("draft-review-marked-automatic", "DecisionDraft", {**DRAFT_REVIEW, "automatic": True}, X),
    ("draft-hold-without-reason", "DecisionDraft", {**DRAFT_HOLD, "reasons": []}, X),
    ("draft-v1-pass-status", "DecisionDraft", {**DRAFT_ACCEPT, "status": "PASS"}, S),
    ("draft-whole-roll-scope", "DecisionDraft", {**DRAFT_REVIEW, "scope": "ROLL"}, S),
    ("decision-automatic-without-release", "Decision", {**DECISION_ACCEPT, "release_id": None}, X),
    ("adjudication-unknown-outcome", "Adjudication", {**ADJUDICATION, "outcome": "ACCEPT"}, S),
    ("adjudication-empty-reason", "Adjudication", {**ADJUDICATION, "reason": ""}, S),
    ("result-decision-without-evidence", "QCResult", {**RESULT_DECIDED, "evidence": None}, X),
    ("result-revision-mismatch", "QCResult", {**RESULT_DECIDED, "revision": 3}, X),
    (
        "result-decision-for-other-spec-version",
        "QCResult",
        {
            **RESULT_DECIDED,
            "decision": {**DECISION, "spec_version": 2},
            "history": [{**DECISION, "spec_version": 2}],
        },
        X,
    ),
    ("result-decision-missing-from-history", "QCResult", {**RESULT_DECIDED, "history": []}, X),
    (
        "result-foreign-capture",
        "QCResult",
        {**RESULT_CLOSED, "captures": [{**CAPTURES[0], "sample_id": SAMPLE2}]},
        X,
    ),
    ("result-missing-mode", "QCResult", mut(RESULT_CREATED, "mode", None, delete=True), S),
    (
        "policy-missing-domain-stage",
        "Policy",
        {**POLICY, "required_stages": ["quality", "fabric", "defects", "metrology"]},
        S,
    ),
    (
        "policy-duplicate-stage",
        "Policy",
        {**POLICY, "required_stages": ["quality", "fabric", "defects", "metrology", "metrology"]},
        X,
    ),
    ("policy-four-capture-sets", "Policy", {**POLICY, "max_capture_sets": 4}, S),
    (
        "domain-thresholds-equal",
        "DomainManifest",
        {**DOMAIN, "defect_accept_below": 0.5, "defect_hold_at_or_above": 0.5},
        X,
    ),
    ("domain-threshold-over-one", "DomainManifest", {**DOMAIN, "defect_hold_at_or_above": 1.5}, S),
    ("release-self-signed", "Release", {**RELEASE, "independent_signatory": "User-Admin"}, X),
    (
        "release-active-without-operations-proof",
        "Release",
        {**RELEASE_ACTIVE, "operations_proof_sha256": None},
        X,
    ),
    ("release-unknown-state", "Release", {**RELEASE, "state": "APPROVED"}, S),
    ("context-client-clock", "EvaluationContext", {**CONTEXT, "clock_source": "CLIENT"}, S),
    (
        "context-local-time",
        "EvaluationContext",
        {**CONTEXT, "evaluated_at": "2026-11-13T13:06:00+05:00"},
        S,
    ),
    ("profile-expired-before-valid", "CalibrationProfile", {**PROFILE, "expires_at": T0}, X),
    ("profile-reversed-distance", "CalibrationProfile", {**PROFILE, "distance_mm": [220, 180]}, X),
    ("axis-direction-not-unit", "AxisRegistration", {**AXIS_REG, "direction_xy": [0.5, 0.5]}, X),
    (
        "validated-capture-hash-mismatch",
        "ValidatedCapture",
        {**VALIDATED[0], "verified_sha256": h("other")},
        X,
    ),
    (
        "validated-capture-foreign-axis",
        "ValidatedCapture",
        {**VALIDATED[0], "axis_registration": AXIS_REG},
        X,
    ),
    ("readiness-ready-without-artifacts", "Readiness", {**READINESS, "ready": True}, X),
    ("readiness-stage-omitted", "Readiness", {**READINESS, "stages": READINESS["stages"][:4]}, S),
    (
        "readiness-stages-out-of-order",
        "Readiness",
        {**READINESS, "stages": READINESS["stages"][::-1]},
        X,
    ),
    (
        "analyze-two-capture-sets",
        "AnalyzeRequest",
        mut(ANALYZE, "captures.0.capture.capture_set_id", u(41)),
        X,
    ),
    ("analyze-foreign-workspace-spec", "AnalyzeRequest", {**ANALYZE, "workspace_id": WS2}, X),
    ("analyze-attempt-four", "AnalyzeRequest", {**ANALYZE, "attempt": 4}, S),
    ("claims-wrong-audience", "AssertionClaims", {**CLAIMS, "aud": "texpilot-scanner"}, S),
    ("claims-lifetime-over-30s", "AssertionClaims", {**CLAIMS, "exp": CLAIMS["iat"] + 31}, X),
    ("claims-expiry-before-issue", "AssertionClaims", {**CLAIMS, "exp": CLAIMS["iat"]}, X),
    ("error-unknown-code", "ErrorEnvelope", mut(ERROR, "error.code", "TEAPOT"), S),
    ("error-leaks-detail", "ErrorEnvelope", mut(ERROR, "error.detail", "Traceback ..."), S),
]

CANONICAL_VALUES = [
    ("empty-object", {}),
    ("key-order", {"b": 1, "a": 2, "aa": 3, "B": 4}),
    (
        "numbers",
        [0, -0.0, 1.0, 2.54, 0.1, 1e21, 1e-7, 0.000001, 123456789.125, 100, 68.5, 1e20, -3.25],
    ),
    ("text", {"ur": "معائنہ", "quote": 'a"b\\c', "control": "line\nbreak\ttab", "emoji": "🧵"}),
    ("nested", {"z": [True, False, None, {"y": [], "x": {}}]}),
    ("spec", SPEC_V1),
]


def dump(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    names = [n for n, *_ in VALID] + [n for n, *_ in INVALID]
    assert len(set(names)) == len(names), "fixture names must be unique"
    assert {t for _, t, *_ in VALID + [(a, b, c) for a, b, c, _ in INVALID]} <= set(CONTRACT_TYPES)
    dump(
        HERE / "valid.json",
        [{"name": n, "type": t, "value": v, "layer": None} for n, t, v in VALID],
    )
    dump(
        HERE / "invalid.json",
        [{"name": n, "type": t, "value": v, "layer": layer} for n, t, v, layer in INVALID],
    )
    dump(
        HERE / "canonical.json",
        [
            {
                "name": n,
                "value": v,
                "canonical": canonical_json(v),
                "sha256": sha256_hex(canonical_json(v)),
            }
            for n, v in CANONICAL_VALUES
        ],
    )
    print(f"{len(VALID)} valid, {len(INVALID)} invalid, {len(CANONICAL_VALUES)} canonical")


if __name__ == "__main__":
    main()
