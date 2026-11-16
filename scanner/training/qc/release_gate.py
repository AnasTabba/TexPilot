"""Exact independent-unit statistical gate; never runtime policy or activation (T11).

The caller supplies the sealed sampling/authority records and protected cohort registry. All
first looks consume their cohort before evaluation, including failures. Signature authenticity
and registry access control are external G7/G8 obligations, not assertions made by this code.
"""

from __future__ import annotations

import math
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import Decimal, localcontext
from pathlib import Path

from services.api.qc_schemas import canonical_json, sha256_hex
from training.qc.manifest import normalise_identifier
from training.qc.split_audit import AuditReport
from training.qc.workflow_metrics import (
    CohortCounts,
    Interval,
    UnitOutcome,
    aggregate,
    descriptive_metrics,
    group_key,
    grouped_uncertainty,
    unique_outcomes,
)


def _decimal_cdf(k: int, n: int, p: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 60
        q = 1 - p
        term, total = q**n, Decimal(0)
        for i in range(k + 1):
            total += term
            term = term * (n - i) / (i + 1) * p / q
        return total


def _binomial_cdf(k: int, n: int, p: float) -> float:
    if p <= 0:
        return 1.0
    if p >= 1:
        return float(k >= n)
    lp, lq = math.log(p), math.log1p(-p)
    terms = [
        math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq
        for i in range(k + 1)
    ]
    top = max(terms)
    return min(1.0, math.exp(top) * math.fsum(math.exp(t - top) for t in terms))


def _unit(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 0 < value < 1


def false_accept_upper(failures: int, accepted_independent_units: int, alpha: float) -> float:
    """One-sided Clopper-Pearson upper bound, using only stdlib math.

    n=0 is uninformative (1.0), never release evidence. For x<n solve the decreasing
    binomial tail P(X<=x)=alpha by bisection, with a stable zero-failure closed form.
    """
    x, n = failures, accepted_independent_units
    if type(x) is not int or type(n) is not int or not 0 <= x <= n:
        raise ValueError("need integer 0 <= failures <= accepted_independent_units")
    if not _unit(alpha):
        raise ValueError("alpha must be finite and strictly between zero and one")
    if n == 0 or x == n:
        return 1.0
    if x == 0:
        return -math.expm1(math.log(alpha) / n)
    low, high = x / n, 1.0
    for _ in range(100):
        mid = (low + high) / 2
        if _binomial_cdf(x, n, mid) > alpha:
            low = mid
        else:
            high = mid
    # Float CDF error can leave `high` a few 1e-13 below the exact bound. Refine in 50-digit
    # decimals inside a narrow bracket and return the upper end, so the bound never rounds down.
    lo, hi = (
        Decimal(high) * (1 - Decimal("1e-10")),
        min(Decimal(1), Decimal(high) * (1 + Decimal("1e-10"))),
    )
    for _ in range(50):
        mid = (lo + hi) / 2
        if _decimal_cdf(x, n, mid) > Decimal(alpha):
            lo = mid
        else:
            hi = mid
    return min(1.0, math.nextafter(float(hi), math.inf))


def proportion_lower(successes: int, n: int, alpha: float) -> float:
    return 1 - false_accept_upper(n - successes, n, alpha)


def _hash(value: object) -> bool:
    return (
        isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)
    )


def _time(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("UTC timestamp with Z required")
    return datetime.fromisoformat(value[:-1] + "+00:00")


@dataclass(frozen=True)
class HoldCriterion:
    min_precision: float
    max_conforming_hold_rate: float


@dataclass(frozen=True)
class DomainPlan:
    domain_id: str
    planned_units: int
    accept_alpha: float
    hold_precision_alpha: float | None = None
    hold_rate_alpha: float | None = None
    enrollments: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class ReleasePlan:
    domains: tuple[DomainPlan, ...]
    frozen_at: str
    stopping_rule: str = "FIXED_ONE_LOOK"
    endpoint: str = "ANY_ACCEPT_SELECTION_FAMILY_OWN_FROZEN_SPEC"
    bootstrap_seed: int = 0
    bootstrap_replicates: int = 2000
    #: Sealed decision parameters; every one changes the plan hash when it changes.
    risk_target: float | None = None
    family_alpha: float | None = None
    hold_criterion: HoldCriterion | None = None

    def sha256(self) -> str:
        return sha256_hex(canonical_json(asdict(self)))


@dataclass(frozen=True)
class Authority:
    name: str | None
    risk_target: float | None
    family_alpha: float | None
    independent_signatory: str | None
    sampling_agreement_sha256: str | None
    signed_record_sha256: str | None
    hold_criterion: HoldCriterion | None = None
    plan: ReleasePlan | None = None
    cohort_registry: str | None = None


@dataclass(frozen=True)
class DomainReport:
    domain_id: str
    alpha: float
    counts: CohortCounts
    planned_units: int
    looks: int
    eligible_submitted: int
    all_submitted: int
    conforming_groups: int
    fabric_macro_f1: float | None = None  # checked against raw paired labels if supplied
    outcomes: tuple[UnitOutcome, ...] = ()


@dataclass(frozen=True)
class ReleaseReport:
    release_cohort_sha256: str
    calibration_cohort_sha256: str
    calibration_group_ids: tuple[str, ...]
    release_group_ids: tuple[str, ...]
    domains: tuple[DomainReport, ...]
    thresholds_frozen_at: str
    release_unblinded_at: str
    release_cohort_reused: bool
    calibration_binding_sha256: str
    serving_binding_sha256: str
    reference_records_eligible: bool
    #: The audited manifest and audit this release report is bound to.
    manifest_sha256: str | None = None
    audit_sha256: str | None = None
    audit: AuditReport | None = None
    plan_sha256: str | None = None
    bootstrap_seed: int = 0
    bootstrap_replicates: int = 2000


@dataclass(frozen=True)
class DomainResult:
    domain_id: str
    accept_released: bool
    hold_released: bool
    reasons: tuple[str, ...]
    accepted_independent_units: int
    failures: int
    false_accept_upper: float
    false_accept_point: float | None
    accept_given_nonconforming: float | None
    hold_precision: float | None
    hold_precision_lower: float | None
    conforming_hold_rate_upper: float | None
    selective_coverage: float | None
    accept_coverage: float | None
    all_submission_coverage: float | None
    fabric_macro_f1: float | None
    prevalence: float | None
    useful_coverage: float
    uncertainty: dict[str, Interval]
    counts: CohortCounts
    missing_reasons: tuple[tuple[str, str], ...]
    specification_changed_units: int
    final_state_risk: float | None


@dataclass(frozen=True)
class GateResult:
    state: str
    activatable: bool
    reasons: tuple[str, ...]
    domains: tuple[DomainResult, ...] = field(default_factory=tuple)
    cohort_frozen: bool = False
    mode: str = "REVIEW_ONLY"
    activation_requirements: tuple[str, ...] = ("T12_TARGET_PROOF", "G8")

    @property
    def review_only_domains(self) -> tuple[str, ...]:
        return tuple(
            d.domain_id for d in self.domains if not (d.accept_released or d.hold_released)
        )


def _reserve_cohort(report: ReleaseReport, registry: str) -> bool:
    """Atomic durable first-look claim, before examining results. Never delete a claim.

    Group identity prevents disguising a previously examined cohort with a new content hash.
    Every group used to calibrate or release is claimed in the role it was used, so a group
    spent on calibration can never reappear as a release group (or the reverse) in a later
    look. The registry must be protected, backed up, and shared by every evaluation (G7/G8).
    """
    if not registry or registry == ":memory:" or registry.startswith("file:"):
        raise ValueError("a durable local registry is required")
    path = Path(registry)
    path.parent.mkdir(parents=True, exist_ok=True)
    actual_groups = {group_key(o.independent_group_id) for d in report.domains for o in d.outcomes}
    groups = actual_groups | {group_key(g) for g in report.release_group_ids}
    calibration = {group_key(g) for g in report.calibration_group_ids}
    with sqlite3.connect(str(path), timeout=5) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS cohorts (sha256 TEXT PRIMARY KEY, plan TEXT);
            CREATE TABLE IF NOT EXISTS groups_seen (group_id TEXT PRIMARY KEY, cohort TEXT);
            CREATE TRIGGER IF NOT EXISTS no_cohort_update BEFORE UPDATE ON cohorts
              BEGIN SELECT RAISE(ABORT, 'cohort frozen'); END;
            CREATE TRIGGER IF NOT EXISTS no_cohort_delete BEFORE DELETE ON cohorts
              BEGIN SELECT RAISE(ABORT, 'cohort frozen'); END;
            CREATE TRIGGER IF NOT EXISTS no_group_update BEFORE UPDATE ON groups_seen
              BEGIN SELECT RAISE(ABORT, 'group frozen'); END;
            CREATE TRIGGER IF NOT EXISTS no_group_delete BEFORE DELETE ON groups_seen
              BEGIN SELECT RAISE(ABORT, 'group frozen'); END;
        """)
        db.execute("BEGIN IMMEDIATE")
        reused = db.execute(
            "SELECT 1 FROM cohorts WHERE sha256=?", (report.release_cohort_sha256,)
        ).fetchone()
        # A group already spent on calibration or release is never fresh again.
        for group in sorted((groups | calibration) - {""}):
            reused = (
                reused
                or db.execute("SELECT 1 FROM groups_seen WHERE group_id=?", (group,)).fetchone()
            )
        db.execute(
            "INSERT OR IGNORE INTO cohorts VALUES (?, ?)",
            (report.release_cohort_sha256, report.plan_sha256),
        )
        db.executemany(
            "INSERT OR IGNORE INTO groups_seen VALUES (?, ?)",
            (
                (group, f"release:{report.release_cohort_sha256}")
                for group in sorted(groups - {""})
            ),
        )
        db.executemany(
            "INSERT OR IGNORE INTO groups_seen VALUES (?, ?)",
            (
                (group, f"calibration:{report.calibration_cohort_sha256}")
                for group in sorted(calibration - {""})
            ),
        )
        return not bool(reused)


def evaluate_release(report: ReleaseReport, authority: Authority) -> GateResult:
    """Consume one sealed confirmatory cohort; output at most a statistical candidate.

    Raw whole-family outcomes are required; supplied summaries are verified, never trusted.
    A failed look freezes all its groups even if the model/thresholds/cohort hash change.
    """
    reasons: list[str] = []
    frozen = False
    if not authority.cohort_registry:
        reasons.append("COHORT_REGISTRY_REQUIRED")
    else:
        try:
            fresh = _reserve_cohort(report, authority.cohort_registry)
            frozen = True
            if not fresh:
                reasons.append("RELEASE_COHORT_REUSED")
        except (OSError, ValueError, sqlite3.Error):
            reasons.append("COHORT_REGISTRY_UNAVAILABLE")
    if not _unit(authority.risk_target):
        reasons.append("AUTHORITY_RISK_TARGET_MISSING")
    if not _unit(authority.family_alpha):
        reasons.append("AUTHORITY_ALPHA_MISSING")
    if not (authority.name or "").strip() or not _hash(authority.signed_record_sha256):
        reasons.append("AUTHORITY_SIGNATURE_MISSING")
    if not (authority.independent_signatory or "").strip():
        reasons.append("INDEPENDENT_SIGNATORY_MISSING")
    elif normalise_identifier(authority.name) == normalise_identifier(
        authority.independent_signatory
    ):
        reasons.append("SIGNATORY_NOT_INDEPENDENT")
    if not _hash(authority.sampling_agreement_sha256):
        reasons.append("SAMPLING_AGREEMENT_MISSING")
    if not all(
        _hash(h)
        for h in (
            report.release_cohort_sha256,
            report.calibration_cohort_sha256,
            report.calibration_binding_sha256,
            report.serving_binding_sha256,
        )
    ):
        reasons.append("ARTIFACT_HASH_MISSING")
    actual_groups = {group_key(r.independent_group_id) for d in report.domains for r in d.outcomes}
    release_groups = {group_key(g) for g in report.release_group_ids}
    calibration_groups = {group_key(g) for g in report.calibration_group_ids}
    if calibration_groups & (actual_groups | release_groups):
        reasons.append("CALIBRATION_RELEASE_OVERLAP")
    if report.calibration_cohort_sha256 == report.release_cohort_sha256:
        reasons.append("CALIBRATION_IS_RELEASE_COHORT")
    if not calibration_groups or "" in calibration_groups:
        reasons.append("CALIBRATION_GROUPS_MISSING")
    if actual_groups != release_groups:
        reasons.append("RELEASE_GROUPS_MISMATCH")
    # The gate may not certify a cohort whose independence was never audited: the audit must
    # be present, match its pinned hash, be for this manifest, and be non-blocking. Every
    # correlated component (several selections in one physical group) blocks it.
    audit = report.audit
    if not isinstance(audit, AuditReport):
        reasons.append("AUDIT_MISSING")
    else:
        if not _hash(report.manifest_sha256) or audit.manifest_sha256 != report.manifest_sha256:
            reasons.append("AUDIT_NOT_FOR_THIS_MANIFEST")
        if not _hash(report.audit_sha256):
            reasons.append("AUDIT_HASH_MISSING")
        elif sha256_hex(canonical_json(asdict(audit))) != report.audit_sha256:
            reasons.append("AUDIT_HASH_MISMATCH")
        if not audit.promotable:
            reasons.append(
                "AUDIT_BLOCKING:"
                + ",".join(sorted({f.code for f in audit.findings if f.blocking}))
            )
    if report.release_cohort_reused is not False:
        reasons.append("RELEASE_COHORT_REUSED")
    if report.calibration_binding_sha256 != report.serving_binding_sha256:
        reasons.append("CALIBRATION_DOES_NOT_MATCH_SERVING")
    if report.reference_records_eligible is not True:
        reasons.append("REFERENCE_RECORDS_INELIGIBLE")
    try:
        if _time(report.thresholds_frozen_at) >= _time(report.release_unblinded_at):
            reasons.append("THRESHOLDS_NOT_FROZEN_BEFORE_UNBLINDING")
    except (TypeError, ValueError):
        reasons.append("INVALID_FREEZE_TIME")
    if not report.domains:
        reasons.append("NO_DOMAINS")
    if len({d.domain_id for d in report.domains}) != len(report.domains):
        reasons.append("DUPLICATE_DOMAIN")
    plan = authority.plan
    if plan is None:
        reasons.append("PREDECLARED_PLAN_MISSING")
    else:
        try:
            if (
                plan.sha256() != report.plan_sha256
                or _time(plan.frozen_at) >= _time(report.release_unblinded_at)
                or plan.stopping_rule != "FIXED_ONE_LOOK"
                or plan.endpoint != "ANY_ACCEPT_SELECTION_FAMILY_OWN_FROZEN_SPEC"
                or plan.bootstrap_seed != report.bootstrap_seed
                or plan.bootstrap_replicates != report.bootstrap_replicates
                or plan.risk_target != authority.risk_target
                or plan.family_alpha != authority.family_alpha
                or plan.hold_criterion != authority.hold_criterion
            ):
                reasons.append("PLAN_MISMATCH")
            planned = {d.domain_id: d for d in plan.domains}
            if len(planned) != len(plan.domains) or set(planned) != {
                d.domain_id for d in report.domains
            }:
                reasons.append("PLAN_MISMATCH")
            allocations = []
            for p in plan.domains:
                if not p.domain_id or type(p.planned_units) is not int or p.planned_units < 1:
                    reasons.append("INVALID_PLANNED_UNITS")
                allocations.extend(
                    a
                    for a in (p.accept_alpha, p.hold_precision_alpha, p.hold_rate_alpha)
                    if a is not None
                )
                if not _unit(p.accept_alpha):
                    reasons.append("INVALID_ALPHA_ALLOCATION")
            if (
                any(not _unit(a) for a in allocations)
                or not _unit(authority.family_alpha)
                or math.fsum(allocations) > authority.family_alpha + 1e-15
            ):
                reasons.append("ALPHA_ALLOCATION_EXCEEDS_FAMILY")
            for d in report.domains:
                p = planned.get(d.domain_id)
                actual = {
                    (r.selection_id, group_key(r.independent_group_id)) for r in d.outcomes
                }
                if p is not None and (
                    not p.enrollments
                    or {(sid, group_key(g)) for sid, g in p.enrollments} != actual
                    or len({sid for sid, _ in p.enrollments}) != len(p.enrollments)
                ):
                    reasons.append("ENROLLMENT_MISMATCH")
                if p is None or d.alpha != p.accept_alpha or d.planned_units != p.planned_units:
                    reasons.append("PLAN_MISMATCH")
        except (TypeError, ValueError):
            reasons.append("PLAN_MISMATCH")
    all_rows = []
    for d in report.domains:
        try:
            rows = unique_outcomes(d.outcomes)
            all_rows.extend(rows)
            counts = aggregate(rows)
            if (
                counts != d.counts
                or len(rows) != d.all_submitted
                or sum(r.eligible for r in rows) != d.eligible_submitted
                or counts.conforming_groups != d.conforming_groups
            ):
                reasons.append("COUNTS_MISMATCH")
            f1 = descriptive_metrics(rows)["fabric_macro_f1"]
            if d.fabric_macro_f1 is not None and d.fabric_macro_f1 != f1:
                reasons.append("FABRIC_F1_MISMATCH")
        except (TypeError, ValueError):
            reasons.append("INVALID_WORKFLOW_OUTCOMES")
    # Domains are disjoint preregistered strata, not several evaluations of one family.
    if len({r.selection_id for r in all_rows}) != len(all_rows):
        reasons.append("SELECTION_IN_MULTIPLE_DOMAINS")
    group_domains: dict[str, set[str]] = {}
    for d in report.domains:
        for r in d.outcomes:
            group_domains.setdefault(group_key(r.independent_group_id), set()).add(d.domain_id)
    if any(len(ids) > 1 for ids in group_domains.values()):
        reasons.append("GROUP_IN_MULTIPLE_DOMAINS")
    if (
        type(report.bootstrap_seed) is not int
        or type(report.bootstrap_replicates) is not int
        or report.bootstrap_replicates < 2
    ):
        reasons.append("INVALID_BOOTSTRAP_PLAN")
    if reasons:
        return GateResult("NO_RELEASE", False, tuple(dict.fromkeys(reasons)), cohort_frozen=frozen)

    results = []
    for d in report.domains:
        c = aggregate(d.outcomes)
        p = next(p for p in plan.domains if p.domain_id == d.domain_id)
        n, x = c.accepted_independent_units, c.conservative_failures
        upper = false_accept_upper(x, n, p.accept_alpha)
        why = []
        if type(d.looks) is not int or d.looks != 1:
            why.append("UNPLANNED_INTERIM_LOOK")
        if c.independent_groups != p.planned_units:
            why.append("FIXED_SAMPLE_SIZE_NOT_MET")
        if n == 0:
            why.append("NO_ACCEPTED_UNITS")
        elif upper > authority.risk_target:
            why.append(
                "SPARSE_DOMAIN"
                if false_accept_upper(0, n, p.accept_alpha) > authority.risk_target
                else "RISK_BOUND_ABOVE_TARGET"
            )
        accept_ok = not why
        hold_ok = False
        precision_lower = conforming_upper = None
        rule = authority.hold_criterion
        if rule is None:
            why.append("HOLD_CRITERION_MISSING")
        elif not (_unit(rule.min_precision) and _unit(rule.max_conforming_hold_rate)):
            why.append("HOLD_CRITERION_INVALID")
        elif not (_unit(p.hold_precision_alpha) and _unit(p.hold_rate_alpha)):
            why.append("HOLD_ALPHA_NOT_PREDECLARED")
        else:
            precision_lower = proportion_lower(
                c.holds_on_nonconforming, c.held_independent_units, p.hold_precision_alpha
            )
            # A conforming HOLD under any frozen spec is an error even if primary truth changed.
            conforming_total = max(c.conforming_groups, c.holds_on_conforming)
            conforming_upper = false_accept_upper(
                c.holds_on_conforming, conforming_total, p.hold_rate_alpha
            )
            if c.held_independent_units == 0:
                why.append("NO_HELD_UNITS")
            elif c.undetermined_holds:
                why.append("HOLD_REFERENCE_UNDETERMINED")
            elif precision_lower < rule.min_precision:
                why.append("HOLD_PRECISION_BELOW_CRITERION")
            elif conforming_upper > rule.max_conforming_hold_rate:
                why.append("HOLD_RATE_ON_CONFORMING_ABOVE_CRITERION")
            else:
                hold_ok = accept_ok
        metrics = descriptive_metrics(d.outcomes)
        unique = unique_outcomes(d.outcomes)
        useful = sum(bool((r.accepted and accept_ok) or (r.held and hold_ok)) for r in unique)
        results.append(
            DomainResult(
                d.domain_id,
                accept_ok,
                hold_ok,
                tuple(why),
                n,
                c.failures,
                upper,
                metrics["false_accept"],
                metrics["accept_given_nonconforming"],
                metrics["hold_precision"],
                precision_lower,
                conforming_upper,
                metrics["selective_coverage"],
                metrics["accept_coverage"],
                metrics["all_submission_coverage"],
                metrics["fabric_macro_f1"],
                metrics["prevalence"],
                useful / len(unique) if unique else 0.0,
                grouped_uncertainty(
                    d.outcomes, seed=report.bootstrap_seed, replicates=report.bootstrap_replicates
                ),
                c,
                tuple((r.selection_id, r.missing_reason) for r in unique if r.missing_reason),
                sum(r.spec_versions > 1 for r in unique),
                c.final_state_failures / c.final_state_accepted_groups
                if c.final_state_accepted_groups
                else None,
            )
        )
    released = any(d.accept_released or d.hold_released for d in results)
    return GateResult(
        "STATISTICAL_CANDIDATE" if released else "NO_RELEASE",
        False,
        () if released else ("NO_DOMAIN_MET_THE_GATE",),
        tuple(results),
        frozen,
    )
