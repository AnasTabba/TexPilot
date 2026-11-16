"""Blinded reference test doubles; no qualification or factory truth is asserted."""

import json
from dataclasses import asdict, replace
from pathlib import Path

import pytest

from training.qc.references import ResearchReference, SelectionRef, validate_reference

H = "a" * 64


def selection_double(**changes):
    return replace(
        SelectionRef(
            "selection-double",
            ("sample-double", "sample-v2-double"),
            "location-double",
            "face",
            (H, "b" * 64),
            plan_sha256=H,
            roll_ref="roll-double",
        ),
        sample_spec_sha256s={"sample-double": H, "sample-v2-double": "b" * 64},
        **changes,
    )


def raw_double(name="observer-a-double", **changes):
    values = dict(
        id=name,
        version=1,
        sample_id="sample-double",
        selection_id="selection-double",
        face="face",
        location_ref="location-double",
        spec_sha256=H,
        observer_id=name,
        qualification_reference="qualification-double",
        observed_at="2026-01-01T00:00:00Z",
        model_unblinded_at="2026-01-02T00:00:00Z",
        raw_counts={"ends": (30, 30), "picks": (20, 20)},
        counted_lengths={"ends": 1.0, "picks": 1.0},
        units="in",
        fabric_labels=("fabric-double",),
        physical_defects=(),
        uncertainty={"ends": 0.5, "picks": 0.5},
        adjudication_parent_ids=(),
        status="RAW",
    )
    return ResearchReference(**(values | changes))


def consensus_double(*parents, **changes):
    parents = parents or (raw_double(), raw_double("observer-b-double"))
    return replace(
        raw_double("consensus-double"),
        adjudication_parent_ids=tuple(p.id for p in parents),
        observations=tuple(parents),
        **({"status": "CONSENSUS"} | changes),
    )


def test_two_argument_contract_accepts_two_distinct_qualified_blinded_observers():
    assert validate_reference(consensus_double(), selection_double()).release_eligible


def test_single_observer_kept_in_denominator_but_not_released():
    eligibility = validate_reference(raw_double(), selection_double())
    assert eligibility.record_valid and eligibility.in_denominator
    assert not eligibility.release_eligible


@pytest.mark.parametrize(
    "changes",
    [
        {"observer_id": "observer-a-double"},
        {"qualification_reference": None},
        {"observed_at": "2026-01-02T00:00:00Z"},
        {"observed_at": "invalid"},
        {"raw_counts": {}},
        {"raw_counts": {"ends": (1.5,), "picks": (20,)}},
        {"counted_lengths": {}},
        {"counted_lengths": {"ends": float("inf"), "picks": 1.0}},
        {"units": ""},
        {"sample_id": "wrong"},
        {"spec_sha256": "c" * 64},
        {"location_ref": "wrong"},
        {"sample_id": "sample-v2-double", "spec_sha256": "b" * 64},
        {"spec_sha256": "b" * 64},
        {"face": "back"},
        {"fabric_labels": ("disagree-double",)},
        {"physical_defects": ({"finding": "disagree-double"},)},
    ],
)
def test_invalid_or_inconsistent_second_observer_is_not_release_truth(changes):
    record = consensus_double(raw_double(), raw_double("observer-b-double", **changes))
    result = validate_reference(record, selection_double())
    assert not result.release_eligible
    assert result.in_denominator


def test_fractional_second_before_unblinding_is_compared_as_time_not_text():
    a = raw_double(observed_at="2026-01-01T00:00:00.9Z", model_unblinded_at="2026-01-01T00:00:00Z")
    assert not validate_reference(
        consensus_double(a, raw_double("observer-b-double")), selection_double()
    ).release_eligible


@pytest.mark.parametrize("status", ["CONSENSUS", "ADJUDICATED"])
def test_unresolved_disagreement_never_substituted_by_supervisor(status):
    a, b = raw_double(), raw_double("observer-b-double", raw_counts={"ends": (99,), "picks": (20,)})
    result = validate_reference(
        consensus_double(a, b, status=status) if status != "CONSENSUS" else consensus_double(a, b),
        selection_double(),
    )
    assert not result.release_eligible
    assert "UNRESOLVED_DISAGREEMENT" in result.reasons


def test_undetermined_is_not_clean_and_stays_in_denominator():
    result = validate_reference(replace(raw_double(), status="UNDETERMINED"), selection_double())
    assert result.undetermined and result.in_denominator and not result.release_eligible


@pytest.mark.parametrize(
    "changes",
    [{"plan_sha256": None}, {"roll_ref": None}, {"face": "unknown"}, {"cohort": "CHALLENGE"}],
)
def test_unknown_selection_or_challenge_fails(changes):
    assert not validate_reference(consensus_double(), selection_double(**changes)).release_eligible


def test_superseded_spec_reference_cannot_use_other_samples_binding():
    assert not validate_reference(
        replace(consensus_double(), spec_sha256="b" * 64), selection_double()
    ).release_eligible


def test_research_reference_schema_matches_serialized_record_and_is_closed():
    from training.qc.references import reference_schema

    path = Path(__file__).parents[1] / "contracts/qc-research-reference.schema.json"
    schema = json.loads(path.read_text())
    assert schema == reference_schema()
    assert schema["additionalProperties"] is False
    assert set(asdict(raw_double())) == set(schema["properties"])
    assert schema["properties"]["observations"]["items"] == {"$ref": "#"}


def test_wire_sampling_selection_requires_explicit_frozen_sample_spec_resolution():
    from services.api.qc_schemas import SamplingSelection

    fixtures = json.loads((Path(__file__).parent / "fixtures/qc-v2/valid.json").read_text())
    selection = SamplingSelection.model_validate(
        next(f["value"] for f in fixtures if f["type"] == "SamplingSelection")
    )
    result = validate_reference(consensus_double(), selection)
    assert not result.release_eligible
    assert result.in_denominator
    assert "SELECTION_BINDING_UNRESOLVED" in result.reasons


def test_supplied_blinding_cutoff_applies_to_both_observers():
    early_unblinding = raw_double(model_unblinded_at="2026-01-01T00:00:01Z")
    late_observation = raw_double("observer-b-double", observed_at="2026-01-01T00:00:02Z")
    assert not validate_reference(
        consensus_double(early_unblinding, late_observation), selection_double()
    ).release_eligible


@pytest.mark.parametrize("uncertainty", [float("nan"), float("inf"), -1, True])
def test_missing_or_invalid_uncertainty_cannot_resolve_disagreement(uncertainty):
    record = replace(consensus_double(), uncertainty={"ends": uncertainty, "picks": 0.5})
    assert not validate_reference(record, selection_double()).release_eligible


def test_adjudication_with_agreeing_parents_still_cannot_substitute_for_protocol():
    record = replace(consensus_double(), status="ADJUDICATED")
    assert not validate_reference(record, selection_double()).release_eligible


def test_schema_wire_roundtrip_preserves_both_raw_observers():
    from training.qc.references import parse_reference

    record = consensus_double()
    payload = json.loads(json.dumps(asdict(record)))
    assert parse_reference(payload) == record
    with pytest.raises(ValueError):
        parse_reference(payload | {"operational_override": True})
    payload["observations"][0]["raw_counts"]["ends"] = [1.5]
    with pytest.raises(ValueError):
        parse_reference(payload)


def test_consensus_cannot_hide_disagreement_by_declaring_large_uncertainty():
    from dataclasses import replace

    a = raw_double()
    b = raw_double("observer-b-double", raw_counts={"ends": (99, 99), "picks": (20, 20)})
    c = replace(consensus_double(a, b), uncertainty={"ends": 1000.0, "picks": 0.5})
    assert not validate_reference(c, selection_double()).release_eligible
