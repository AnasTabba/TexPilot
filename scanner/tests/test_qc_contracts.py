"""The QC v2 contract (plan T01): shapes, units, hashing and the shared fixtures.

The same ``fixtures/qc-v2`` files are decoded by the Yarnflow Worker and web client
(``yarnflow/tests/qc-contract.test.mjs``, ``qc-types.test.ts``) and the iPhone app
(``QCContractTests.swift``).
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from services.api import qc_schemas as qc
from services.api.qc_schemas import (
    CONTRACT_TYPES,
    PurchaseSpec,
    canonical_json,
    content_sha256,
    normalize_density,
    parse_qc_spec,
    sha256_hex,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "qc-v2"


def load(name: str) -> list[dict]:
    return json.loads((FIXTURES / name).read_text("utf-8"))


VALID, INVALID, CANONICAL = load("valid.json"), load("invalid.json"), load("canonical.json")
BY_NAME = {e["name"]: e["value"] for e in VALID}


# ------------------------------------------------------------------ the checked-in artefacts


def test_the_checked_in_schema_is_exactly_what_the_models_generate():
    checked_in = (ROOT / "contracts" / "qc-v2.schema.json").read_text("utf-8")
    assert checked_in == qc.schema_text(), "run: python -m services.api.qc_schemas > contracts/..."


def test_the_checked_in_fixtures_are_exactly_what_the_builder_writes(tmp_path):
    before = {
        n: (FIXTURES / n).read_bytes() for n in ("valid.json", "invalid.json", "canonical.json")
    }
    subprocess.run([sys.executable, str(FIXTURES / "build.py")], check=True, capture_output=True)
    after = {n: (FIXTURES / n).read_bytes() for n in before}
    assert after == before


def test_every_contract_type_has_a_valid_fixture_and_the_schema_lists_it():
    assert {e["type"] for e in VALID} == set(CONTRACT_TYPES)
    schema = qc.contract_schema()
    assert set(schema["x-types"]) == set(CONTRACT_TYPES) <= set(schema["$defs"])


# ------------------------------------------------------------------ shared fixtures


@pytest.mark.parametrize("case", VALID, ids=[e["name"] for e in VALID])
def test_valid_fixture_decodes_and_round_trips(case):
    model = CONTRACT_TYPES[case["type"]].model_validate(case["value"])
    assert model.model_dump(mode="json") == case["value"]
    again = CONTRACT_TYPES[case["type"]].model_validate_json(json.dumps(case["value"]))
    assert again == model


@pytest.mark.parametrize("case", INVALID, ids=[e["name"] for e in INVALID])
def test_invalid_fixture_is_rejected(case):
    assert case["layer"] in ("schema", "semantic")
    with pytest.raises(ValidationError):
        CONTRACT_TYPES[case["type"]].model_validate(case["value"])


def test_validation_errors_do_not_have_to_be_shown_raw():
    """Callers build ErrorEnvelope from codes; nothing here needs the offending input."""
    try:
        PurchaseSpec.model_validate({**BY_NAME["spec-woven-v1"], "secret": "PIN 2468"})
    except ValidationError as e:
        safe = [(err["type"], err["loc"]) for err in e.errors(include_input=False)]
        assert safe == [("extra_forbidden", ("secret",))]
        assert all("input" not in err for err in e.errors(include_input=False))


# ------------------------------------------------------------------ units


def test_counts_per_cm_convert_by_exactly_2_54():
    assert normalize_density(30, "count/cm") == 30 * 2.54 == 76.2
    assert normalize_density(76, "count/in") == 76.0
    assert normalize_density(0, "count/cm") == 0.0
    assert qc.CM_PER_INCH == 2.54


@pytest.mark.parametrize("unit", ["count/m", "per inch", "epi", "", "COUNT/IN", "count/10cm", None])
def test_any_other_unit_is_an_error_never_a_guess(unit):
    with pytest.raises(ValueError):
        normalize_density(76, unit)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, -1, "76", None, True])
def test_non_finite_negative_or_non_numeric_density_is_refused(value):
    with pytest.raises(ValueError):
        normalize_density(value, "count/in")


def test_no_default_tolerance_is_invented():
    spec = dict(BY_NAME["spec-woven-v1"])
    density = [dict(spec["density"][0]), spec["density"][1]]
    del density[0]["lower"]
    with pytest.raises(ValidationError):
        PurchaseSpec.model_validate({**spec, "density": density})


# ------------------------------------------------------------------ strictness


def test_nan_and_infinity_are_rejected_in_python_and_on_the_wire():
    spec = BY_NAME["spec-woven-v1"]
    for bad in (math.nan, math.inf):
        density = [{**spec["density"][0], "target": bad}, spec["density"][1]]
        with pytest.raises(ValidationError):
            PurchaseSpec.model_validate({**spec, "density": density})
    wire = json.dumps(spec).replace('"target": 76', '"target": NaN', 1)
    assert "NaN" in wire
    with pytest.raises(ValidationError):
        PurchaseSpec.model_validate_json(wire)


def test_types_are_not_coerced():
    spec = BY_NAME["spec-woven-v1"]
    for field, bad in (("version", "1"), ("version", True), ("version", 1.5)):
        with pytest.raises(ValidationError):
            PurchaseSpec.model_validate({**spec, field: bad})
    draft = BY_NAME["draft-accept"]
    with pytest.raises(ValidationError):
        qc.DecisionDraft.model_validate({**draft, "automatic": 1})


def test_records_are_immutable():
    spec = PurchaseSpec.model_validate(BY_NAME["spec-woven-v1"])
    with pytest.raises(ValidationError):
        spec.version = 2


def test_a_v1_verdict_is_not_a_v2_status():
    for v1 in ("PASS", "FLAG", "INSUFFICIENT_EVIDENCE"):
        with pytest.raises(ValidationError):
            qc.DecisionDraft.model_validate({**BY_NAME["draft-accept"], "status": v1})


def test_unknown_fabric_and_a_missing_head_are_different_records():
    unknown = BY_NAME["evidence-fabric-unknown"]["fabric"]
    missing = BY_NAME["evidence-review-only-stages-unavailable"]["fabric"]
    assert (unknown["state"], unknown["value"]["unknown"], unknown["value"]["label"]) == (
        "OK",
        True,
        None,
    )
    assert unknown["value"]["candidates"], "diagnostic candidates are kept"
    assert (missing["state"], missing["value"]) == ("DISABLED", None)


def test_identical_boxes_on_different_captures_keep_their_owners():
    regions = BY_NAME["evidence-synthetic-all-stages-ok"]["defects"]["value"]["regions"]
    assert regions[0]["box"] == regions[1]["box"]
    assert regions[0]["capture_id"] != regions[1]["capture_id"]


def test_the_uncalibrated_classifier_exposes_no_calibrated_probability():
    fabric = BY_NAME["evidence-synthetic-all-stages-ok"]["fabric"]["value"]
    assert fabric["calibrated_probability"] is None
    assert all(set(c) == {"label", "raw_score"} for c in fabric["candidates"])


# ------------------------------------------------------------------ hashing


@pytest.mark.parametrize("case", CANONICAL, ids=[e["name"] for e in CANONICAL])
def test_canonical_json_and_hash_vectors(case):
    assert canonical_json(case["value"]) == case["canonical"]
    assert sha256_hex(case["canonical"]) == case["sha256"]
    assert json.loads(case["canonical"]) == case["value"]


def test_canonical_json_is_independent_of_key_order_and_number_spelling():
    assert canonical_json({"a": 1.0, "b": [2, 3.50]}) == canonical_json({"b": [2.0, 3.5], "a": 1})
    assert canonical_json({"a": 1.0}) == '{"a":1}'


@pytest.mark.parametrize("bad", [math.nan, math.inf, {1: "a"}, object(), b"bytes"])
def test_canonical_json_refuses_what_cannot_be_hashed_identically(bad):
    with pytest.raises((TypeError, ValueError)):
        canonical_json(bad)


def test_record_hashes_cover_content_and_exclude_only_themselves():
    for name, model, excluded in (
        ("spec-woven-v1", qc.PurchaseSpec, ("content_sha256",)),
        ("policy-review-only", qc.Policy, ("sha256",)),
        ("domain-manifest", qc.DomainManifest, ("sha256",)),
        ("release-active", qc.Release, ("sha256", "state")),
    ):
        record = model.model_validate(BY_NAME[name])
        field = excluded[0]
        assert getattr(record, field) == content_sha256(record, exclude=excluded), name
    evidence = qc.Evidence.model_validate(BY_NAME["evidence-review-only-stages-unavailable"])
    assert evidence.manifest_sha256 == evidence.expected_manifest_sha256()


def test_a_release_keeps_its_hash_when_only_its_state_changes():
    candidate = BY_NAME["release-statistical-candidate"]
    suspended = qc.Release.model_validate({**candidate, "state": "SUSPENDED"})
    assert suspended.sha256 == suspended.expected_sha256() == candidate["sha256"]


@pytest.mark.parametrize(
    "alias",
    ["A n a s", "Anas\u200b", " ANAS ", "\uff21\uff4e\uff41\uff53"],
    ids=["spaced", "zero-width-space", "surrounding-space", "fullwidth"],
)
def test_a_release_rejects_aliases_of_the_approver_as_independent(alias):
    base = BY_NAME["release-statistical-candidate"]
    with pytest.raises(ValidationError):
        qc.Release.model_validate({**base, "approved_by": "Anas", "independent_signatory": alias})


def test_a_release_rejects_an_independent_signatory_with_no_name_left():
    base = BY_NAME["release-statistical-candidate"]
    with pytest.raises(ValidationError):
        qc.Release.model_validate(
            {**base, "approved_by": "Anas", "independent_signatory": "\u200b \u200b"}
        )


def test_a_release_accepts_a_genuinely_different_signatory():
    base = BY_NAME["release-statistical-candidate"]
    release = qc.Release.model_validate(
        {**base, "approved_by": "Anas", "independent_signatory": "Bilal"}
    )
    assert (release.approved_by, release.independent_signatory) == ("Anas", "Bilal")


def test_parse_qc_spec_checks_the_content_hash():
    spec = BY_NAME["spec-woven-v1"]
    assert parse_qc_spec(spec).version == 1
    with pytest.raises(ValueError, match="content_sha256"):
        parse_qc_spec({**spec, "allowed_fabric_labels": ["satin"]})


def test_a_new_spec_version_is_a_new_record_not_an_edit():
    v1, v2 = BY_NAME["spec-woven-v1"], BY_NAME["spec-woven-v2-supersedes"]
    assert (v1["id"], v2["supersedes_version"]) == (v2["id"], v1["version"])
    assert v1["content_sha256"] != v2["content_sha256"]


# ------------------------------------------------------------------ limits and errors


def test_engineering_limits_match_the_design():
    assert (qc.MAX_ORIGINALS_PER_SET, qc.MAX_ORIGINAL_BYTES, qc.MAX_SET_BYTES) == (
        4,
        12 * 2**20,
        48 * 2**20,
    )
    assert (qc.MAX_DECODED_PIXELS, qc.ASSERTION_TTL_S, qc.REQUEST_DEADLINE_S) == (
        16_000_000,
        30,
        60,
    )
    assert (qc.MAX_FUTURE_SKEW_S, qc.MAX_CAPTURE_SETS) == (120, 3)
    assert qc.ASSERTION_TTL_S < qc.REQUEST_DEADLINE_S


def test_only_capacity_unavailable_and_deadline_errors_are_retryable():
    retryable = {code for code, (_, retry) in qc.ERROR_STATUS.items() if retry}
    assert retryable == {"CAPACITY_LIMIT", "SERVICE_UNAVAILABLE", "DEADLINE_EXCEEDED"}
    assert {code: status for code, (status, _) in qc.ERROR_STATUS.items()} == {
        "UNAUTHENTICATED": 401,
        "FORBIDDEN": 403,
        "NOT_FOUND": 404,
        "MALFORMED_REQUEST": 400,
        "METHOD_NOT_ALLOWED": 405,
        "CONFLICT": 409,
        "PAYLOAD_TOO_LARGE": 413,
        "UNSUPPORTED_MEDIA": 415,
        "VALIDATION_FAILED": 422,
        "CAPACITY_LIMIT": 429,
        "SERVICE_UNAVAILABLE": 503,
        "DEADLINE_EXCEEDED": 504,
        "INTERNAL_ERROR": 500,
    }


def test_capture_fixable_reasons_are_exactly_the_quality_and_scale_ones():
    assert {
        "QUALITY_BLUR",
        "QUALITY_GLARE",
        "QUALITY_MOIRE",
        "QUALITY_FOLD",
        "QUALITY_FRAMING",
        "SCALE_MISSING",
        "SCALE_INVALID",
        "RESOLUTION_LOW",
    } == qc.CAPTURE_FIXABLE


def test_taxonomy_scope_is_named_not_conflated():
    """Weave/style labels and fibre are different things: the spec lists fabric labels under a
    named taxonomy version and carries no fibre composition or GSM field at all."""
    fields = set(PurchaseSpec.model_fields)
    assert {"allowed_fabric_labels", "taxonomy_version"} <= fields
    assert not {"composition", "fibre", "fiber", "gsm", "weight"} & fields
