"""Calibration that matches serving, fitted only on the calibration cohort (design §14, §16; T11).

The score that is calibrated is the *served capture-set score*: the same views, the same class
merge/drop mapping, the same logit bias and temperature, the same aggregation. A cached
per-image confidence is not sample QC calibration.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from services.api.qc_schemas import canonical_json, sha256_hex
from training.qc.release_gate import false_accept_upper


@dataclass(frozen=True)
class CalibrationBinding:
    """Everything a calibration is valid for. Change any field and the calibration, and any
    release built on it, is invalid."""

    weights_sha256: str
    logit_bias_sha256: str
    temperature: float
    label_scope: tuple[str, ...]  # effective ordered labels of the served head
    merge_map: tuple[tuple[str, str], ...]  # (source label, served label)
    dropped_labels: tuple[str, ...]
    preprocessing_sha256: str
    capture_roles: tuple[str, ...]
    aggregation: str  # e.g. "mean-probability"
    cohort_sha256: str
    source_labels: tuple[str, ...] = ()
    view_selection_sha256: str = ""

    def sha256(self) -> str:
        return sha256_hex(canonical_json(self.__dict__))


def assert_binding(binding: CalibrationBinding, expected_sha256: str) -> None:
    """Refuse stale calibration; callers must compare the actually served binding."""
    if binding.sha256() != expected_sha256:
        raise ValueError("calibration binding does not match serving")


def _valid_hash(value: str) -> bool:
    return (
        isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)
    )


def _softmax(logits: Sequence[float]) -> list[float]:
    top = max(logits)
    exps = [math.exp(v - top) for v in logits]
    total = sum(exps)
    return [e / total for e in exps]


def sample_probabilities(
    view_logits: Sequence[Sequence[float]],
    source_labels: Sequence[str],
    binding: CalibrationBinding,
    logit_bias: Sequence[float] | None = None,
    *,
    view_roles: Sequence[str] = (),
    view_selection_sha256: str = "",
) -> dict[str, float]:
    """Sample-level probabilities over the served label scope from per-view source logits.

    Shared transform for calibration and future serving integration. The current v2
    adapter has no matched calibration and must retain calibrated_probability=None.
    Dropped classes are removed before the softmax; merged classes sum their probabilities;
    views are averaged in probability space (the only aggregation implemented).
    """
    hashes = (
        binding.weights_sha256,
        binding.logit_bias_sha256,
        binding.preprocessing_sha256,
        binding.cohort_sha256,
        binding.view_selection_sha256,
    )
    if not all(_valid_hash(h) for h in hashes):
        raise ValueError("calibration requires content hashes for every input artifact")
    if binding.aggregation != "mean-probability":
        raise ValueError(f"unsupported aggregation {binding.aggregation!r}")
    if len(view_logits) == 0:
        raise ValueError("at least one view is required")
    if (
        tuple(source_labels) != binding.source_labels
        or not source_labels
        or len(set(source_labels)) != len(source_labels)
    ):
        raise ValueError("source label order does not match calibration")
    if (
        tuple(view_roles) != binding.capture_roles
        or len(view_roles) != len(view_logits)
        or view_selection_sha256 != binding.view_selection_sha256
    ):
        raise ValueError("capture roles/view selection do not match calibration")
    if any(role not in {"overview", "structure", "defect", "scale"} for role in view_roles):
        raise ValueError("unknown capture role")
    if (
        isinstance(binding.temperature, bool)
        or not isinstance(binding.temperature, (int, float))
        or not math.isfinite(binding.temperature)
        or binding.temperature <= 0
    ):
        raise ValueError("temperature must be finite and positive")
    if not binding.label_scope or len(set(binding.label_scope)) != len(binding.label_scope):
        raise ValueError("served label scope must be nonempty and unique")
    merge = dict(binding.merge_map)
    if len(merge) != len(binding.merge_map) or not set(merge) <= set(source_labels):
        raise ValueError("invalid class merge mapping")
    if not set(binding.dropped_labels) <= set(source_labels):
        raise ValueError("unknown dropped class")
    keep = [i for i, name in enumerate(source_labels) if name not in binding.dropped_labels]
    if not keep or {merge.get(source_labels[i], source_labels[i]) for i in keep} != set(
        binding.label_scope
    ):
        raise ValueError("class mapping does not cover exactly the served scope")
    if logit_bias is None or len(logit_bias) != len(source_labels):
        raise ValueError("the actual served bias vector is required, including explicit zero bias")
    bias = list(logit_bias)
    if any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in bias
    ):
        raise ValueError("bias must be finite")
    if sha256_hex(canonical_json(bias)) != binding.logit_bias_sha256:
        raise ValueError("logit bias differs from calibration binding")
    totals = dict.fromkeys(binding.label_scope, 0.0)
    for logits in view_logits:
        if len(logits) != len(source_labels):
            raise ValueError("every view needs one logit per source label")
        if any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in logits
        ):
            raise ValueError("logits must be finite")
        transformed = [(logits[i] + bias[i]) / binding.temperature for i in keep]
        if not all(math.isfinite(v) for v in transformed):
            raise ValueError("logit transform overflow")
        probs = _softmax(transformed)
        for i, p in zip(keep, probs, strict=True):
            served = merge.get(source_labels[i], source_labels[i])
            if served not in totals:
                raise ValueError(f"label {served!r} is outside the served scope")
            totals[served] += p
    return {name: value / len(view_logits) for name, value in totals.items()}


def assert_disjoint(calibration_groups: Sequence[str], release_groups: Sequence[str]) -> None:
    shared = sorted(set(calibration_groups) & set(release_groups))
    if shared:
        raise ValueError(f"calibration and release cohorts share groups: {shared[:5]}")


@dataclass(frozen=True)
class ThresholdFit:
    threshold: float | None  # None: no threshold meets the risk target (zero coverage)
    accepted_groups: int
    failures: int
    upper_bound: float | None
    coverage: float
    fitted_on: str  # always "calibration"
    cohort_sha256: str


def fit_accept_threshold(
    scores: Sequence[float],
    nonconforming: Sequence[bool],
    groups: Sequence[str],
    *,
    risk_target: float,
    alpha: float,
    cohort_sha256: str,
    cohort_role: str,
) -> ThresholdFit:
    """Largest-coverage threshold t (accept when score >= t) whose exact upper bound on
    P(nonconforming | accept) meets ``risk_target``, counting one unit per group.

    Refuses anything but the calibration cohort. An infeasible target returns threshold None
    and zero coverage: a valid, reportable result.
    """
    if cohort_role != "calibration":
        raise ValueError("thresholds are fitted on the calibration cohort only")
    if not (len(scores) == len(nonconforming) == len(groups)):
        raise ValueError("scores, nonconforming and groups must align")
    if not _valid_hash(cohort_sha256):
        raise ValueError("calibration cohort hash is required")
    if (
        isinstance(risk_target, bool)
        or not isinstance(risk_target, (int, float))
        or not 0 < risk_target < 1
    ):
        raise ValueError("risk_target must be supplied and between zero and one")
    false_accept_upper(0, 0, alpha)  # validates alpha even for an empty cohort
    if any(
        isinstance(s, bool)
        or not isinstance(s, (int, float))
        or not math.isfinite(s)
        or not 0 <= s <= 1
        for s in scores
    ):
        raise ValueError("scores must be finite probabilities")
    if any(type(b) is not bool for b in nonconforming) or any(not g for g in groups):
        raise ValueError("explicit boolean truth and independent groups are required")
    # Calibration uses the same any-ACCEPT group exposure as the confirmatory workflow.
    unit: dict[str, tuple[float, bool]] = {}
    for score, bad, group in zip(scores, nonconforming, groups, strict=True):
        high, any_bad = unit.get(group, (-math.inf, False))
        unit[group] = (max(high, score), any_bad or bool(bad))
    best: ThresholdFit | None = None
    for threshold in sorted({score for score, _ in unit.values()}):
        accepted = [bad for score, bad in unit.values() if score >= threshold]
        upper = false_accept_upper(sum(accepted), len(accepted), alpha)
        if upper <= risk_target and (best is None or len(accepted) > best.accepted_groups):
            best = ThresholdFit(
                threshold,
                len(accepted),
                sum(accepted),
                upper,
                len(accepted) / len(unit),
                "calibration",
                cohort_sha256,
            )
    return best or ThresholdFit(None, 0, 0, None, 0.0, "calibration", cohort_sha256)


@dataclass(frozen=True)
class CalibrationSample:
    """Raw multi-view logits generated by the bound serving recipe, never image confidence.

    Generation/weights/preprocess provenance must be verified by the T10 manifest adapter;
    this module checks the score recipe and hashes all supplied raw inputs in its output.
    """

    selection_id: str
    independent_group_id: str
    view_logits: tuple[tuple[float, ...], ...]
    view_roles: tuple[str, ...]
    view_selection_sha256: str
    score_label: str
    reference_nonconforming: bool


@dataclass(frozen=True)
class BoundThresholdFit:
    binding_sha256: str
    inputs_sha256: str
    fit: ThresholdFit

    def sha256(self) -> str:
        from dataclasses import asdict

        return sha256_hex(canonical_json(asdict(self)))


def fit_sample_threshold(
    samples: Sequence[CalibrationSample],
    binding: CalibrationBinding,
    logit_bias: Sequence[float],
    *,
    serving_binding_sha256: str,
    risk_target: float,
    alpha: float,
    cohort_role: str,
) -> BoundThresholdFit:
    """Calibration entry point: execute the bound sample transform before threshold fitting.

    fit_accept_threshold is a statistical primitive, not a calibration artifact. Only this
    wrapper records the serving binding and raw sample inputs alongside the fitted threshold.
    A calibration fit is exploratory; only a disjoint independent release cohort can confirm it.
    """
    from dataclasses import asdict

    assert_binding(binding, serving_binding_sha256)
    scores, truth, groups = [], [], []
    seen: dict[str, str] = {}
    for sample in samples:
        if not sample.selection_id or not sample.independent_group_id:
            raise ValueError("calibration samples require selection and group identities")
        if (
            seen.setdefault(sample.selection_id, sample.independent_group_id)
            != sample.independent_group_id
        ):
            raise ValueError("selection cannot change independent group")
        probabilities = sample_probabilities(
            sample.view_logits,
            binding.source_labels,
            binding,
            logit_bias,
            view_roles=sample.view_roles,
            view_selection_sha256=sample.view_selection_sha256,
        )
        if sample.score_label not in probabilities:
            raise ValueError("score label outside calibrated scope")
        scores.append(probabilities[sample.score_label])
        truth.append(sample.reference_nonconforming)
        groups.append(sample.independent_group_id)
    fit = fit_accept_threshold(
        scores,
        truth,
        groups,
        risk_target=risk_target,
        alpha=alpha,
        cohort_sha256=binding.cohort_sha256,
        cohort_role=cohort_role,
    )
    inputs_sha256 = sha256_hex(canonical_json([asdict(s) for s in samples]))
    return BoundThresholdFit(binding.sha256(), inputs_sha256, fit)
