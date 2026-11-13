"""Four-arm offline ablation (design §14, §16; plan T10).

Classifier-only, classifier+defects, classifier+metrology and full gated fusion are compared on
the *same* cohort against the same full-reference nonconformance endpoint, each at its own
preallocated risk bound, with thresholds fitted on calibration data only. The claim this can
support is a risk-bounded paired coverage gain. It cannot show "no risk increase" or
non-inferiority, and it never selects a winner on a confirmatory cohort. Reduced arms are
research only: production policy still requires every stage.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from training.qc.manifest import DatasetManifest
from training.qc.release_gate import false_accept_upper
from training.qc.split_audit import audit_splits
from training.qc.train_manifest import is_sha256

ARMS: tuple[str, ...] = (
    "classifier-only",
    "classifier+defects",
    "classifier+metrology",
    "full-fusion",
)
REFERENCE_ARM = "classifier-only"


@dataclass(frozen=True)
class ArmSpec:
    name: str
    thresholds_sha256: str
    fitted_on: str  # must be "calibration"
    fit_cohort_sha256: str
    alpha: float  # this arm's preallocated one-sided alpha
    fit_ids: tuple[str, ...] = ()
    transductive: bool = False
    transductive_cohort_sha256: str | None = None
    chunks: tuple[tuple[str, ...], ...] = ()


@dataclass(frozen=True)
class ArmManifest:
    arms: tuple[ArmSpec, ...]
    risk_target: float  # supplied by the authority or declared exploratory; never defaulted
    bootstrap_seed: int
    bootstrap_resamples: int = 2000
    calibration: DatasetManifest | None = None
    outcomes: tuple[CohortUnit, ...] = ()
    cohort_sha256: str = ""
    endpoint: str = "full-reference-nonconformance"


@dataclass(frozen=True)
class CohortUnit:
    unit_id: str
    independent_group_id: str
    reference_nonconforming: bool | None  # None: undetermined, never counted clean
    accepted_by: frozenset[str]  # arms that automatically accepted this unit
    evaluated_by: frozenset[str] = frozenset()  # distinguishes abstention from missing output


@dataclass(frozen=True)
class ArmCohort:
    sha256: str
    designation: str  # "DEVELOPMENT" | "CALIBRATION" | "CONFIRMATORY"
    units: tuple[CohortUnit, ...]


@dataclass(frozen=True)
class ArmResult:
    name: str
    accepted_groups: int
    failures: int  # includes accepted units with an undetermined reference
    risk_upper: float
    risk_met: bool
    coverage: float
    coverage_gain_vs_reference: float
    coverage_gain_interval95: tuple[float, float]
    conclusion: str  # "GAIN" | "LOSS" | "INCONCLUSIVE" | "REFERENCE" | "RISK_NOT_MET"


@dataclass(frozen=True)
class ArmComparison:
    cohort_sha256: str
    groups: int
    arms: tuple[ArmResult, ...]
    winner: None  # never selected here
    claim: str
    notes: tuple[str, ...]
    exploratory: bool = True  # no automatic release authority from an ablation
    transductive_protocols: dict = field(default_factory=dict)


def _by_group(units: tuple[CohortUnit, ...]) -> dict[str, dict[str, tuple[bool, bool]]]:
    """group -> arm -> (accepted, failed). Dependent units collapse to one vote."""
    out: dict[str, dict[str, tuple[bool, bool]]] = {}
    for unit in units:
        row = out.setdefault(unit.independent_group_id, {a: (False, False) for a in ARMS})
        for arm in ARMS:
            if arm in unit.accepted_by:
                accepted, failed = row[arm]
                row[arm] = (True, failed or unit.reference_nonconforming is not False)
    return out


def evaluate_arms(manifest: ArmManifest, cohort: DatasetManifest) -> ArmComparison:
    """Compare frozen outcomes, never fit or select an arm on the supplied cohort.

    Outcome rows use the same complete independent full-reference endpoint for all arms.
    Missing workflows stay in the denominator as explicit no-accept outcomes; missing arm
    execution or missing full reference is an error, not evidence of a clean unit.
    """
    if not isinstance(cohort, DatasetManifest) or cohort.sha256() != manifest.cohort_sha256:
        raise ValueError("evaluation cohort must match its predeclared manifest hash")
    if manifest.endpoint != "full-reference-nonconformance":
        raise ValueError("all arms require full-reference nonconformance labels")
    if type(manifest.bootstrap_resamples) is not int or manifest.bootstrap_resamples < 2:
        raise ValueError("paired bootstrap requires at least two resamples")
    if type(manifest.bootstrap_seed) is not int:
        raise ValueError("paired bootstrap seed must be an integer")
    names = [a.name for a in manifest.arms]
    if sorted(names) != sorted(ARMS) or len(names) != len(ARMS):
        raise ValueError(f"exactly these four arms are required: {', '.join(ARMS)}")
    if not 0.0 < manifest.risk_target < 1.0:
        raise ValueError("risk_target must be supplied, strictly between 0 and 1")
    calibration = manifest.calibration
    if (
        calibration is None
        or not calibration.items
        or any(i.split != "calibration" for i in calibration.items)
    ):
        raise ValueError("threshold fitting requires an actual calibration-only manifest")
    sources = {s.name: s for s in (*calibration.sources, *cohort.sources)}
    combined = DatasetManifest(
        "ablation-audit",
        "1",
        cohort.purpose,
        tuple(sources.values()),
        (*calibration.items, *cohort.items),
    )
    audit = audit_splits(combined)
    if not audit.promotable:
        raise ValueError("calibration/evaluation leakage or blocking cohort audit")
    cal_ids = {i.id for i in calibration.items}
    evaluation_ids = {i.id for i in cohort.items}
    transductive_protocols = {}
    for arm in manifest.arms:
        if not is_sha256(arm.thresholds_sha256):
            raise ValueError(f"{arm.name}: threshold artifact hash is required")
        if arm.fitted_on != "calibration":
            raise ValueError(f"{arm.name}: thresholds must be fitted on calibration data only")
        if arm.fit_cohort_sha256 == cohort.sha256():
            raise ValueError(f"{arm.name}: thresholds were fitted on the evaluation cohort")
        if (
            arm.fit_cohort_sha256 != calibration.sha256()
            or set(arm.fit_ids) != cal_ids
            or (len(arm.fit_ids) != len(cal_ids))
        ):
            raise ValueError(f"{arm.name}: exact intended calibration IDs/hash required")
        if not 0.0 < arm.alpha < 1.0:
            raise ValueError(f"{arm.name}: alpha must be preallocated")
        if arm.transductive:
            chunk_ids = [i for chunk in arm.chunks for i in chunk]
            if (
                arm.transductive_cohort_sha256 != cohort.sha256()
                or not arm.chunks
                or any(not chunk for chunk in arm.chunks)
                or set(chunk_ids) != evaluation_ids
                or len(chunk_ids) != len(evaluation_ids)
            ):
                raise ValueError(
                    f"{arm.name}: transductive cohort hash and exact chunking required"
                )
            transductive_protocols[arm.name] = (arm.transductive_cohort_sha256, arm.chunks)
    units = manifest.outcomes
    if {u.unit_id for u in units} != evaluation_ids or len(units) != len(evaluation_ids):
        raise ValueError("outcomes must cover the exact intended cohort IDs")
    for unit in units:
        if type(unit.reference_nonconforming) is not bool:
            raise ValueError("each unit needs a full-reference nonconformance label")
        if unit.evaluated_by != frozenset(ARMS):
            raise ValueError("every arm must execute on every unit")
        if not unit.unit_id or not unit.independent_group_id:
            raise ValueError("each outcome needs a unit and independent group ID")
    # Manifest-linked dependent images cannot claim different independent votes.
    group_ids = {u.unit_id: u.independent_group_id for u in units}
    for component in audit.components:
        ids = {group_ids[i] for i in component if i in group_ids}
        if len(ids) > 1:
            raise ValueError("linked cohort rows must share an independent group")
    unknown = {a for u in units for a in u.accepted_by} - set(ARMS)
    if unknown:
        raise ValueError(f"cohort names unknown arms: {sorted(unknown)}")
    groups = _by_group(units)
    if not groups:
        raise ValueError("the cohort has no units")
    keys = sorted(groups)
    total = len(keys)

    def coverage(sample: list[str], arm: str) -> float:
        return sum(groups[g][arm][0] for g in sample) / len(sample)

    rng = random.Random(manifest.bootstrap_seed)
    draws = [
        [keys[rng.randrange(total)] for _ in range(total)]
        for _ in range(manifest.bootstrap_resamples)
    ]
    results: list[ArmResult] = []
    reference_accepted = sum(groups[g][REFERENCE_ARM][0] for g in keys)
    reference_failures = sum(groups[g][REFERENCE_ARM][1] for g in keys)
    reference_alpha = next(a.alpha for a in manifest.arms if a.name == REFERENCE_ARM)
    reference_met = (
        reference_accepted > 0
        and false_accept_upper(reference_failures, reference_accepted, reference_alpha)
        <= manifest.risk_target
    )
    confirmatory = any(i.cohort == "CONFIRMATORY" for i in cohort.items)
    for spec in sorted(manifest.arms, key=lambda a: ARMS.index(a.name)):
        accepted = sum(groups[g][spec.name][0] for g in keys)
        failures = sum(groups[g][spec.name][1] for g in keys)
        upper = false_accept_upper(failures, accepted, spec.alpha)
        met = accepted > 0 and upper <= manifest.risk_target
        gain = coverage(keys, spec.name) - coverage(keys, REFERENCE_ARM)
        diffs = sorted(coverage(d, spec.name) - coverage(d, REFERENCE_ARM) for d in draws)
        low = diffs[int(0.025 * (len(diffs) - 1))]
        high = diffs[int(0.975 * (len(diffs) - 1))]
        if spec.name == REFERENCE_ARM:
            conclusion = "REFERENCE"
        elif confirmatory:
            conclusion = "DESCRIPTIVE_ONLY"
        elif not met:
            conclusion = "RISK_NOT_MET"
        elif not reference_met:
            conclusion = "INCONCLUSIVE"
        elif low > 0:
            conclusion = "GAIN"
        elif high < 0:
            conclusion = "LOSS"
        else:
            conclusion = "INCONCLUSIVE"
        results.append(
            ArmResult(
                spec.name,
                accepted,
                failures,
                upper,
                met,
                accepted / total,
                gain,
                (low, high),
                conclusion,
            )
        )
    notes = ["Each arm has its own risk bound; separate bounds do not establish non-inferiority."]
    if confirmatory:
        notes.append("Confirmatory cohort: descriptive only, no arm may be selected from it.")
    if not next(r for r in results if r.name == REFERENCE_ARM).risk_met:
        notes.append(
            "The reference arm does not meet the risk target: gains are not at matched risk."
        )
    if transductive_protocols:
        notes.append(
            "Transductive methods are exploratory; stationary-compatible authorization "
            "and sample-alone versus unrelated-cohort sensitivity remain external."
        )
    return ArmComparison(
        cohort_sha256=cohort.sha256(),
        groups=total,
        arms=tuple(results),
        winner=None,
        claim="risk-bounded paired coverage gain",
        notes=tuple(notes),
        transductive_protocols=transductive_protocols,
    )
