"""Blinded physical reference records and their release eligibility (design §15, plan T09).

A ResearchReference is external, signed, schema-bound evidence recorded by a qualified
observer *before* the model result is unblinded. It is not an operational supervisor
adjudication and one can never stand in for the other. ``scanner/contracts/
qc-research-reference.schema.json`` is the wire schema for the record.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, fields
from datetime import datetime
from typing import Literal

from pydantic import TypeAdapter

from services.api.qc_schemas import canonical_json
from training.qc.manifest import known_identifier, valid_sha256

ReferenceStatus = Literal["RAW", "CONSENSUS", "ADJUDICATED", "UNDETERMINED"]
UNITS: frozenset[str] = frozenset({"in", "cm"})
AXES_BY_CONSTRUCTION: dict[str, frozenset[str]] = {
    "woven": frozenset({"ends", "picks"}),
    "knit": frozenset({"wales", "courses"}),
}


@dataclass(frozen=True)
class SelectionRef:
    """The fields of an immutable SamplingSelection that a reference must match."""

    id: str
    sample_ids: tuple[str, ...]  # every linked evaluation of this physical selection
    location_ref: str
    face: str
    spec_sha256s: tuple[str, ...]  # frozen specs the selection was evaluated under
    cohort: str = "CONFIRMATORY"
    plan_sha256: str | None = None
    roll_ref: str | None = None
    sample_spec_sha256s: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ResearchReference:
    id: str
    version: int
    sample_id: str
    selection_id: str
    face: str
    location_ref: str
    spec_sha256: str
    observer_id: str
    qualification_reference: str | None
    observed_at: str  # UTC RFC 3339
    model_unblinded_at: str | None  # None: still blinded
    raw_counts: dict[str, tuple[int, ...]]  # axis -> repeated counts, as written down
    counted_lengths: dict[str, float]  # axis -> length each count was taken over
    units: str  # unit of counted_lengths
    fabric_labels: tuple[str, ...]
    physical_defects: tuple[dict, ...]
    uncertainty: dict[str, float]  # axis -> stated +/- counts per inch
    adjudication_parent_ids: tuple[str, ...]
    status: ReferenceStatus
    construction: str = "woven"
    extra: dict = field(default_factory=dict)
    observations: tuple[ResearchReference, ...] = ()

    def density_per_inch(self, axis: str) -> float:
        counts = self.raw_counts[axis]
        per_unit = (sum(counts) / len(counts)) / self.counted_lengths[axis]
        return per_unit * 2.54 if self.units == "cm" else per_unit


@dataclass(frozen=True)
class ReferenceEligibility:
    record_valid: bool  # this record is a usable observation
    release_eligible: bool  # it can be reference truth for a confirmatory release
    undetermined: bool  # kept in denominators, never counted as clean
    reasons: tuple[str, ...]
    in_denominator: bool = True


def _timestamp(value: str) -> datetime:
    if (
        not isinstance(value, str)
        or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z", value) is None
    ):
        raise ValueError("UTC timestamp required")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _finite(value: object, minimum: float = 0) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and value >= minimum
    )


def _record_reasons(record: ResearchReference, selection: SelectionRef) -> list[str]:
    reasons: list[str] = []
    if record.selection_id != selection.id:
        reasons.append("WRONG_SELECTION")
    if record.sample_id not in selection.sample_ids:
        reasons.append("WRONG_SAMPLE")
    # A family-wide set of spec hashes is insufficient: each sample has one frozen spec.
    if selection.sample_spec_sha256s.get(record.sample_id) != record.spec_sha256:
        reasons.append("WRONG_SPEC")
    if record.location_ref != selection.location_ref or not record.location_ref:
        reasons.append("WRONG_LOCATION")
    if record.face != selection.face or record.face not in ("face", "back"):
        reasons.append("WRONG_FACE")
    if not valid_sha256(record.spec_sha256):
        reasons.append("SPEC_HASH_INVALID")
    if not record.observer_id.strip():
        reasons.append("OBSERVER_MISSING")
    if not known_identifier(record.qualification_reference):
        reasons.append("QUALIFICATION_MISSING")
    try:
        observed = _timestamp(record.observed_at)
        if record.model_unblinded_at is not None and observed >= _timestamp(
            record.model_unblinded_at
        ):
            reasons.append("OBSERVED_AFTER_UNBLINDING")
    except (ValueError, TypeError):
        reasons.append("TIMESTAMP_INVALID")
    if record.units not in UNITS:
        reasons.append("UNIT_UNSUPPORTED")
    axes = AXES_BY_CONSTRUCTION.get(record.construction)
    if axes is None:
        reasons.append("CONSTRUCTION_UNSUPPORTED")
    else:
        for axis in sorted(axes):
            counts = record.raw_counts.get(axis)
            length = record.counted_lengths.get(axis)
            if not counts or any(
                isinstance(c, bool) or not isinstance(c, int) or c < 0 for c in counts
            ):
                reasons.append("RAW_COUNTS_MISSING")
            if not _finite(length) or length == 0:
                reasons.append("COUNTED_LENGTH_MISSING")
            if not _finite(record.uncertainty.get(axis)):
                reasons.append("UNCERTAINTY_MISSING")
        if any(
            set(values) != axes
            for values in (record.raw_counts, record.counted_lengths, record.uncertainty)
        ):
            reasons.append("WRONG_AXIS")
    if not record.fabric_labels or any(not label.strip() for label in record.fabric_labels):
        reasons.append("FABRIC_LABEL_MISSING")
    if record.status not in ("RAW", "CONSENSUS", "ADJUDICATED", "UNDETERMINED"):
        reasons.append("STATUS_INVALID")
    if (
        not record.id
        or isinstance(record.version, bool)
        or not isinstance(record.version, int)
        or record.version < 1
    ):
        reasons.append("IDENTITY_INVALID")
    return reasons


def validate_reference(
    record: ResearchReference,
    selection: SelectionRef,
    parents: tuple[ResearchReference, ...] = (),
) -> ReferenceEligibility:
    """Validate a blinded pair against resolved sample-to-frozen-spec bindings.

    ``SelectionRef`` is the research adapter for SamplingSelection plus its linked samples
    and frozen specs (not present on SamplingSelection itself). Embedded observations make
    the two-argument contract self-contained; the optional parents argument supports the
    interrupted worker's caller interface. No reference is removed from denominators.
    This checks evidence eligibility, never fabric disposition or external gate approval.
    """
    if not isinstance(selection, SelectionRef):
        return ReferenceEligibility(
            False, False, record.status == "UNDETERMINED", ("SELECTION_BINDING_UNRESOLVED",)
        )
    reasons = _record_reasons(record, selection)
    record_valid = not reasons
    undetermined = record.status == "UNDETERMINED"
    if (
        not valid_sha256(selection.plan_sha256)
        or not known_identifier(selection.roll_ref)
        or selection.face not in ("face", "back")
    ):
        reasons.append("SELECTION_INVALID")
    if undetermined:
        reasons.append("REFERENCE_UNDETERMINED")
    if selection.cohort != "CONFIRMATORY":
        reasons.append("NOT_CONFIRMATORY_COHORT")
    if record.status == "RAW":
        reasons.append("SINGLE_OBSERVER")
    elif not undetermined:
        observations = parents or record.observations
        if parents and record.observations and parents != record.observations:
            reasons.append("PARENT_SOURCES_CONFLICT")
        by_id = {p.id: p for p in observations}
        ids = record.adjudication_parent_ids
        if len(ids) != 2 or len(set(ids)) != 2 or set(by_id) != set(ids) or len(observations) != 2:
            reasons.append("PARENT_OBSERVATIONS_MISSING")
        else:
            chosen = [by_id[pid] for pid in ids]
            if len({p.observer_id.strip().casefold() for p in chosen}) != 2:
                reasons.append("OBSERVERS_NOT_DISTINCT")
            valid_parents = True
            for parent in chosen:
                issues = _record_reasons(parent, selection)
                if parent.status != "RAW" or parent.observations or parent.adjudication_parent_ids:
                    issues.append("NOT_RAW")
                if (parent.sample_id, parent.spec_sha256, parent.construction) != (
                    record.sample_id,
                    record.spec_sha256,
                    record.construction,
                ):
                    issues.append("BINDING_MISMATCH")
                # Every observation must precede the earliest recorded unblinding.
                times = [
                    r.model_unblinded_at
                    for r in (record, *chosen)
                    if r.model_unblinded_at is not None
                ]
                try:
                    if times and _timestamp(parent.observed_at) >= min(
                        _timestamp(t) for t in times
                    ):
                        issues.append("OBSERVED_AFTER_UNBLINDING")
                except (ValueError, TypeError):
                    issues.append("TIMESTAMP_INVALID")
                reasons.extend(f"PARENT_{reason}" for reason in issues)
                valid_parents &= not issues
            if valid_parents and record_valid:
                first, second = chosen
                disagreement = any(
                    max(r.density_per_inch(axis) for r in (record, first, second))
                    - min(r.density_per_inch(axis) for r in (record, first, second))
                    > record.uncertainty[axis]
                    for axis in AXES_BY_CONSTRUCTION[record.construction]
                )
                for parent in chosen:
                    disagreement |= parent.fabric_labels != record.fabric_labels or canonical_json(
                        parent.physical_defects
                    ) != canonical_json(record.physical_defects)
                if disagreement:
                    reasons.append("UNRESOLVED_DISAGREEMENT")
        # Adjudication alone never replaces the blinded independent pair. A protocol for
        # resolving physical remeasurement is an external G7 gate, not a supervisor override.
        if record.status == "ADJUDICATED":
            reasons.append("ADJUDICATION_PROTOCOL_UNAPPROVED")
    return ReferenceEligibility(
        record_valid, not reasons, undetermined, tuple(dict.fromkeys(reasons))
    )


def parse_reference(payload: dict) -> ResearchReference:
    """Strict JSON ingestion, preserving raw observations; never verifies an external signature."""
    expected = {f.name for f in fields(ResearchReference)}

    def check_keys(value):
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("reference must contain exactly the schema fields")
        if not isinstance(value["observations"], list) or len(value["observations"]) > 2:
            raise ValueError("reference requires at most two raw observations")
        for parent in value["observations"]:
            if not isinstance(parent, dict) or parent.get("observations"):
                raise ValueError("parent observations must be raw records, not nested consensus")
            check_keys(parent)

    check_keys(payload)
    return TypeAdapter(ResearchReference).validate_json(canonical_json(payload), strict=True)


def reference_schema() -> dict:
    """Closed JSON schema for serialized ResearchReference, including both raw observations."""
    text = {"type": "string", "minLength": 1}
    hash_schema = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
    timestamp = {
        "type": "string",
        "format": "date-time",
        "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$",
    }
    properties = {
        name: text for name in ("id", "sample_id", "selection_id", "location_ref", "observer_id")
    }

    def axis_map(values):
        return {
            "type": "object",
            "minProperties": 2,
            "maxProperties": 2,
            "propertyNames": {"enum": ["ends", "picks", "wales", "courses"]},
            "additionalProperties": values,
        }

    properties.update(
        {
            "version": {"type": "integer", "minimum": 1},
            "face": {"enum": ["face", "back", "unknown"]},
            "spec_sha256": hash_schema,
            "qualification_reference": {"anyOf": [text, {"type": "null"}]},
            "observed_at": timestamp,
            "model_unblinded_at": {"anyOf": [timestamp, {"type": "null"}]},
            "raw_counts": axis_map(
                {"type": "array", "minItems": 1, "items": {"type": "integer", "minimum": 0}}
            ),
            "counted_lengths": axis_map({"type": "number", "exclusiveMinimum": 0}),
            "units": {"enum": ["in", "cm"]},
            "fabric_labels": {"type": "array", "minItems": 1, "uniqueItems": True, "items": text},
            "physical_defects": {"type": "array", "items": {"type": "object"}},
            "uncertainty": axis_map({"type": "number", "minimum": 0}),
            "adjudication_parent_ids": {
                "type": "array",
                "uniqueItems": True,
                "maxItems": 2,
                "items": text,
            },
            "status": {"enum": ["RAW", "CONSENSUS", "ADJUDICATED", "UNDETERMINED"]},
            "construction": {"enum": ["woven", "knit"]},
            "extra": {"type": "object"},
            "observations": {"type": "array", "maxItems": 2, "items": {"$ref": "#"}},
        }
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://texpilot.local/contracts/qc-research-reference.schema.json",
        "title": "Blinded research reference (external signed register)",
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": list(properties),
    }
