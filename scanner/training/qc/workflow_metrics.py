"""Whole-selection any-ACCEPT endpoints and descriptive cluster bootstrap (T11).

These functions measure recorded decisions; they never decide fabric disposition. Reference
truth follows each decision's frozen specification. Correlated observations have one vote in
the exact-risk counts; bootstrap intervals are descriptive, never binomial certification.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Literal

from training.qc.manifest import normalise_identifier

Truth = Literal["CONFORMING", "NONCONFORMING", "UNDETERMINED"]


@dataclass(frozen=True)
class DecisionEvent:
    selection_id: str
    independent_group_id: str
    sample_id: str
    spec_sha256: str
    status: str
    automatic: bool
    capture_attempt: int
    sequence: int


@dataclass(frozen=True)
class Reference:
    selection_id: str
    truth_by_spec: dict[str, Truth]
    release_eligible: bool = False
    # Preregistered prevalence/secondary-estimand spec; defaults to first frozen decision spec.
    primary_spec_sha256: str | None = None


@dataclass(frozen=True)
class UnitOutcome:
    selection_id: str
    independent_group_id: str
    enrolled: int
    accepted: int
    failure: int
    undetermined_accept: int
    held: int
    hold_on_conforming: int
    hold_on_nonconforming: int
    final_status: str | None
    final_state_failure: int
    completed: bool
    capture_sets: int
    spec_versions: int
    reference_nonconforming: int | None
    missing_reason: str | None = None
    eligible: bool = True
    hold_undetermined: int = 0
    fabric_reference_label: str | None = None
    fabric_predicted_label: str | None = None


def reduce_workflow(events: Iterable[DecisionEvent], reference: Reference | None) -> UnitOutcome:
    """Reduce all linked samples/retries once, preserving every historical ACCEPT exposure.

    For an enrolled selection without events use unfinished_unit: its identity and missing
    reason cannot be inferred from an empty list.
    """
    rows = sorted(set(events), key=lambda e: e.sequence)
    if not rows:
        raise ValueError("empty workflow: use unfinished_unit with enrollment and missing reason")
    if len({e.selection_id for e in rows}) != 1 or len({e.independent_group_id for e in rows}) != 1:
        raise ValueError("workflow must contain exactly one selection and independent group")
    if len({e.sequence for e in rows}) != len(rows):
        raise ValueError("conflicting workflow sequence")
    for e in rows:
        if not all((e.selection_id, e.independent_group_id, e.sample_id, e.spec_sha256)):
            raise ValueError("workflow identities are required")
        if e.status not in {"ACCEPT", "HOLD", "RECAPTURE", "MANUAL_REVIEW"}:
            raise ValueError("unknown recorded decision status")
        if type(e.automatic) is not bool or e.automatic != (e.status in {"ACCEPT", "HOLD"}):
            raise ValueError("recorded status/automatic mismatch")
        if type(e.capture_attempt) is not int or not 1 <= e.capture_attempt <= 3:
            raise ValueError("family capture attempt must be 1..3")
        if type(e.sequence) is not int or e.sequence < 1:
            raise ValueError("sequence must be a positive integer")
    if any(a.capture_attempt > b.capture_attempt for a, b in zip(rows, rows[1:], strict=False)):
        raise ValueError("family capture attempts cannot reset")
    if reference is not None:
        if reference.selection_id != rows[0].selection_id:
            raise ValueError("reference belongs to another selection")
        if any(
            t not in {"CONFORMING", "NONCONFORMING", "UNDETERMINED"}
            for t in reference.truth_by_spec.values()
        ):
            raise ValueError("unknown reference truth")

    def truth(spec: str) -> Truth:
        if reference is None or reference.release_eligible is not True:
            return "UNDETERMINED"
        return reference.truth_by_spec.get(spec, "UNDETERMINED")

    accepts = [truth(e.spec_sha256) for e in rows if e.status == "ACCEPT"]
    holds = [truth(e.spec_sha256) for e in rows if e.status == "HOLD"]
    final = rows[-1]
    primary_spec = (reference.primary_spec_sha256 if reference else None) or rows[0].spec_sha256
    primary = truth(primary_spec)
    completed = final.status != "RECAPTURE"
    return UnitOutcome(
        rows[0].selection_id,
        rows[0].independent_group_id,
        1,
        int(bool(accepts)),
        int("NONCONFORMING" in accepts),
        int("UNDETERMINED" in accepts),
        int(bool(holds)),
        int("CONFORMING" in holds),
        int("NONCONFORMING" in holds),
        final.status,
        int(final.status == "ACCEPT" and truth(final.spec_sha256) == "NONCONFORMING"),
        completed,
        len({e.capture_attempt for e in rows}),
        len({e.spec_sha256 for e in rows}),
        None if primary == "UNDETERMINED" else int(primary == "NONCONFORMING"),
        None if completed else "WORKFLOW_UNFINISHED",
        True,
        int("UNDETERMINED" in holds),
    )


def unfinished_unit(
    selection_id: str,
    independent_group_id: str,
    missing_reason: str = "NOT_YET_COLLECTED",
    *,
    eligible: bool = False,
) -> UnitOutcome:
    """Missing/excluded/abandoned selections remain enrolled, with their recorded reason."""
    if not selection_id or not independent_group_id or not missing_reason.strip():
        raise ValueError("unfinished selection needs identity and missing reason")
    return UnitOutcome(
        selection_id,
        independent_group_id,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        None,
        0,
        False,
        0,
        0,
        None,
        missing_reason,
        eligible,
    )


def unique_outcomes(outcomes: Iterable[UnitOutcome]) -> list[UnitOutcome]:
    """Idempotent repeated rows do not add submissions, captures, or independent units."""
    by_selection: dict[str, UnitOutcome] = {}
    for row in outcomes:
        if not row.selection_id or not row.independent_group_id or row.enrolled != 1:
            raise ValueError("invalid enrolled selection")
        if row.selection_id in by_selection and row != by_selection[row.selection_id]:
            raise ValueError("conflicting selection outcomes: reduce the whole family first")
        for flag in (
            row.accepted,
            row.failure,
            row.undetermined_accept,
            row.held,
            row.hold_on_conforming,
            row.hold_on_nonconforming,
            row.final_state_failure,
            row.hold_undetermined,
        ):
            if type(flag) is not int or flag not in (0, 1):
                raise ValueError("outcome flags must be 0 or 1")
        if (row.failure or row.undetermined_accept or row.final_state_failure) and not row.accepted:
            raise ValueError("accept failure without an ACCEPT")
        if (
            row.hold_on_conforming or row.hold_on_nonconforming or row.hold_undetermined
        ) and not row.held:
            raise ValueError("hold reference without a HOLD")
        if not row.completed and not row.missing_reason:
            raise ValueError("unfinished selection missing reason")
        if row.final_status == "ACCEPT" and not row.accepted:
            raise ValueError("final ACCEPT without an ACCEPT decision")
        if row.final_status == "HOLD" and not row.held:
            raise ValueError("final HOLD without a HOLD decision")
        by_selection[row.selection_id] = row
    return sorted(by_selection.values(), key=lambda r: (r.independent_group_id, r.selection_id))


def group_key(independent_group_id: str) -> str:
    """The same physical roll written differently is one independent group, never two."""
    return normalise_identifier(independent_group_id)


@dataclass(frozen=True)
class CohortCounts:
    enrolled_units: int
    independent_groups: int
    accepted_independent_units: int
    failures: int
    undetermined_accepts: int
    conservative_failures: int
    final_state_failures: int
    held_independent_units: int
    holds_on_conforming: int
    holds_on_nonconforming: int
    nonconforming_groups: int
    accepted_nonconforming_groups: int
    completed_units: int
    capture_sets: int
    dependent_units_collapsed: int
    automatic_independent_units: int = 0
    conforming_groups: int = 0
    undetermined_reference_groups: int = 0
    undetermined_holds: int = 0
    final_state_accepted_groups: int = 0


def aggregate(outcomes: Iterable[UnitOutcome]) -> CohortCounts:
    rows = unique_outcomes(outcomes)
    grouped: dict[str, list[UnitOutcome]] = defaultdict(list)
    for row in rows:
        grouped[group_key(row.independent_group_id)].append(row)
    totals = defaultdict(int)
    for members in grouped.values():
        accepted = any(m.accepted for m in members)
        failed = any(m.failure for m in members)
        unknown = any(m.undetermined_accept for m in members)
        held = any(m.held for m in members)
        hold_c = any(m.hold_on_conforming for m in members)
        hold_u = any(m.hold_undetermined for m in members)
        nonconforming = any(m.reference_nonconforming == 1 for m in members)
        undetermined = any(m.reference_nonconforming is None for m in members)
        totals["accepted"] += accepted
        totals["failure"] += failed
        totals["unknown"] += unknown
        totals["conservative"] += failed or unknown
        totals["final_accept"] += any(m.final_status == "ACCEPT" for m in members)
        totals["final_fail"] += any(m.final_state_failure for m in members)
        totals["held"] += held
        totals["hold_c"] += hold_c
        # A mixed/undetermined HOLD cluster is never a precision success.
        totals["hold_n"] += (
            held
            and not hold_c
            and not hold_u
            and all(m.hold_on_nonconforming for m in members if m.held)
        )
        totals["nonconforming"] += nonconforming
        totals["accepted_nonconforming"] += nonconforming and accepted
        totals["automatic"] += accepted or held
        totals["conforming"] += not nonconforming and not undetermined
        totals["undetermined"] += undetermined
        totals["hold_u"] += hold_u
    t = totals
    return CohortCounts(
        len(rows),
        len(grouped),
        t["accepted"],
        t["failure"],
        t["unknown"],
        t["conservative"],
        t["final_fail"],
        t["held"],
        t["hold_c"],
        t["hold_n"],
        t["nonconforming"],
        t["accepted_nonconforming"],
        sum(r.completed for r in rows),
        sum(r.capture_sets for r in rows),
        len(rows) - len(grouped),
        t["automatic"],
        t["conforming"],
        t["undetermined"],
        t["hold_u"],
        t["final_accept"],
    )


def _ratio(x: int, n: int) -> float | None:
    return x / n if n else None


def descriptive_metrics(outcomes: Iterable[UnitOutcome]) -> dict[str, float | None]:
    rows = unique_outcomes(outcomes)
    c = aggregate(rows)
    eligible = [r for r in rows if r.eligible]
    labels = {r.fabric_reference_label for r in rows if r.fabric_reference_label is not None}
    f1 = []
    for label in sorted(labels):
        tp = sum(r.fabric_reference_label == label == r.fabric_predicted_label for r in rows)
        fp = sum(
            r.fabric_reference_label is not None
            and r.fabric_reference_label != label
            and r.fabric_predicted_label == label
            for r in rows
        )
        fn = sum(
            r.fabric_reference_label == label and r.fabric_predicted_label != label for r in rows
        )
        f1.append(2 * tp / (2 * tp + fp + fn))
    return {
        "false_accept": _ratio(c.failures, c.accepted_independent_units),
        "accept_given_nonconforming": _ratio(
            c.accepted_nonconforming_groups, c.nonconforming_groups
        ),
        "prevalence": _ratio(c.nonconforming_groups, c.conforming_groups + c.nonconforming_groups),
        "hold_precision": _ratio(c.holds_on_nonconforming, c.held_independent_units),
        "selective_coverage": _ratio(
            sum(bool(r.accepted or r.held) for r in eligible), len(eligible)
        ),
        "accept_coverage": _ratio(sum(r.accepted for r in eligible), len(eligible)),
        "all_submission_coverage": _ratio(sum(bool(r.accepted or r.held) for r in rows), len(rows)),
        "review_rate": _ratio(sum(r.final_status == "MANUAL_REVIEW" for r in rows), len(rows)),
        "recapture_rate": _ratio(
            sum(r.capture_sets > 1 or r.final_status == "RECAPTURE" for r in rows), len(rows)
        ),
        "fabric_macro_f1": sum(f1) / len(f1) if f1 else None,
    }


@dataclass(frozen=True)
class Interval:
    point: float | None
    lower: float | None
    upper: float | None
    undefined_replicates: int
    seed: int
    replicates: int
    confidence: float
    method: str = "descriptive cluster bootstrap percentile"


def grouped_uncertainty(
    outcomes: Iterable[UnitOutcome], *, seed: int, replicates: int = 2000, confidence: float = 0.95
) -> dict[str, Interval]:
    if type(seed) is not int or type(replicates) is not int or replicates < 2:
        raise ValueError("bootstrap requires an integer seed and at least two replicates")
    if not isinstance(confidence, (int, float)) or not 0 < confidence < 1:
        raise ValueError("bootstrap confidence must be between zero and one")
    rows = unique_outcomes(outcomes)
    points = descriptive_metrics(rows)
    groups: dict[str, list[UnitOutcome]] = defaultdict(list)
    for row in rows:
        groups[group_key(row.independent_group_id)].append(row)
    keys = sorted(groups)
    draws: dict[str, list[float]] = {key: [] for key in points}
    rng = random.Random(seed)
    for _ in range(replicates):
        sample = []
        for draw in range(len(keys)):
            key = rng.choice(keys)
            sample.extend(
                replace(r, selection_id=f"{draw}:{r.selection_id}", independent_group_id=str(draw))
                for r in groups[key]
            )
        for key, value in descriptive_metrics(sample).items():
            if value is not None:
                draws[key].append(value)
    result = {}
    for key, point in points.items():
        values = sorted(draws[key])
        tail = (1 - confidence) / 2
        result[key] = Interval(
            point,
            values[math.floor(tail * (len(values) - 1))] if values else None,
            values[math.ceil((1 - tail) * (len(values) - 1))] if values else None,
            replicates - len(values),
            seed,
            replicates,
            confidence,
        )
    return result
