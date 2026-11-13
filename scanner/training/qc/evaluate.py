"""Bundle evaluation and serving-parity arithmetic (design §7, §11, §14; plan T10/T12).

The metric functions are pure and run anywhere. ``evaluate_bundle`` needs a real bundle on
disk and a predictor that loads it; on a machine without the bundle it raises
``BundleUnavailable`` naming gate G6 rather than reporting numbers.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from training.qc.manifest import DatasetManifest
from training.qc.split_audit import audit_splits
from training.qc.train_manifest import validate_run_record, verify_training_inputs


class BundleUnavailable(RuntimeError):
    """The trained artifact is not on this machine (external gate G6)."""


@dataclass(frozen=True)
class Bundle:
    path: Path
    weights_file: str
    weights_sha256: str
    taxonomy_version: str
    label_universe: tuple[
        str, ...
    ]  # fixed before evaluation, never the labels that happen to appear
    preprocessing_sha256: str
    manifest_sha256: str = ""
    audit_sha256: str = ""
    run_record: dict | None = None


@dataclass(frozen=True)
class FabricMetrics:
    label_universe: tuple[str, ...]
    support: dict[str, int]
    insufficient_support: tuple[str, ...]  # classes absent from the cohort
    unconditional_macro_f1: float | None  # forced argmax, no abstention
    deployed_macro_f1: float | None  # abstention on a known label counts as a miss
    conditional_macro_f1: float | None  # only where the model answered
    coverage: float | None
    per_class: dict[str, dict[str, float]]
    confusion: dict[str, dict[str, int]]
    unknown_precision: float | None
    unknown_recall: float | None
    full_universe_attained: bool  # False whenever any class lacks support
    support_status: str


def _f1(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1


def _macro(truth: Sequence[str], predicted: Sequence[str | None], labels: Sequence[str]):
    per: dict[str, dict[str, float]] = {}
    for label in labels:
        tp = sum(t == label and p == label for t, p in zip(truth, predicted, strict=True))
        fp = sum(t != label and p == label for t, p in zip(truth, predicted, strict=True))
        fn = sum(t == label and p != label for t, p in zip(truth, predicted, strict=True))
        precision, recall, f1 = _f1(tp, fp, fn)
        per[label] = {"precision": precision, "recall": recall, "f1": f1}
    return (sum(v["f1"] for v in per.values()) / len(per) if per else None), per


def fabric_metrics(
    truth: Sequence[str | None],
    argmax: Sequence[str],
    answered: Sequence[str | None],
    label_universe: Sequence[str],
) -> FabricMetrics:
    """``truth`` None = reference says out-of-taxonomy (UNKNOWN). ``argmax`` is the forced top
    class; ``answered`` is what the deployed head returned (None = abstained/unknown)."""
    if not (len(truth) == len(argmax) == len(answered)):
        raise ValueError("truth, argmax and answered must align")
    universe = tuple(label_universe)
    if not universe or len(set(universe)) != len(universe):
        raise ValueError("the fixed label universe must be nonempty and unique")
    if any(a not in universe for a in argmax) or any(
        a is not None and a not in universe for a in answered
    ):
        raise ValueError("predictions must belong to the fixed label universe")
    known = [i for i, t in enumerate(truth) if t is not None]
    if any(truth[i] not in universe for i in known):
        raise ValueError("a reference label is outside the fixed label universe")
    support = {label: sum(truth[i] == label for i in known) for label in universe}
    present = [label for label in universe if support[label] > 0]
    kt = [truth[i] for i in known]
    unconditional, _ = _macro(kt, [argmax[i] for i in known], universe)
    deployed, per = _macro(kt, [answered[i] for i in known], universe)
    answered_idx = [i for i in known if answered[i] is not None]
    conditional, _ = (
        _macro([truth[i] for i in answered_idx], [answered[i] for i in answered_idx], universe)
        if answered_idx
        else (None, {})
    )
    confusion: dict[str, dict[str, int]] = {}
    for i in known:
        row = confusion.setdefault(str(truth[i]), Counter())
        row[answered[i] if answered[i] is not None else "UNKNOWN"] += 1
    said_unknown = [i for i, a in enumerate(answered) if a is None]
    truly_unknown = [i for i, t in enumerate(truth) if t is None]
    hit = sum(1 for i in said_unknown if truth[i] is None)
    return FabricMetrics(
        label_universe=universe,
        support=support,
        insufficient_support=tuple(label for label in universe if support[label] == 0),
        unconditional_macro_f1=unconditional,
        deployed_macro_f1=deployed,
        conditional_macro_f1=conditional,
        coverage=len(answered_idx) / len(known) if known else None,
        per_class=per,
        confusion={k: dict(v) for k, v in confusion.items()},
        unknown_precision=hit / len(said_unknown) if said_unknown else None,
        unknown_recall=hit / len(truly_unknown) if truly_unknown else None,
        full_universe_attained=len(present) == len(universe),
        support_status="supported" if len(present) == len(universe) else "insufficient support",
    )


@dataclass(frozen=True)
class FaultDenominators:
    image_level: int
    image_defective: int
    image_normal: int
    pixel_eligible: int
    pixel_excluded: dict[str, int]
    unresolved_empty_defective: int  # G5: image-level defective, pixel-ineligible
    image_excluded: dict[str, int]


def fault_denominators(manifest: DatasetManifest, split: str) -> FaultDenominators:
    """Which items may enter image-level and pixel-level fault metrics. Reports every
    exclusion; never turns an empty defective mask into a clean negative."""
    items = [i for i in manifest.items if i.split == split]
    audit = audit_splits(manifest)
    labelled = [i for i in items if i.id in audit.image_level_eligible]
    excluded = Counter(i.mask_category for i in items if i.id not in audit.pixel_eligible)
    return FaultDenominators(
        image_level=len(labelled),
        image_defective=sum(i.image_label == "defective" for i in labelled),
        image_normal=sum(i.image_label == "normal" for i in labelled),
        pixel_eligible=sum(i.id in audit.pixel_eligible for i in items),
        pixel_excluded=dict(excluded),
        unresolved_empty_defective=excluded.get("empty-defective", 0),
        image_excluded=dict(
            Counter(
                "no-image-label" if i.image_label is None else "corrupt-mask"
                for i in items
                if i.id not in audit.image_level_eligible
            )
        ),
    )


@dataclass(frozen=True)
class FaultPrediction:
    item_id: str
    image_score: float
    pixel_truth: tuple[bool, ...] | None = None
    pixel_scores: tuple[float, ...] | None = None
    pixel_valid: tuple[bool, ...] | None = None


@dataclass(frozen=True)
class FaultMetrics:
    image_count: int
    image_f1: float | None
    pixel_count: int
    pixel_f1: float | None
    denominators: FaultDenominators
    audit_blocking: tuple[str, ...]


def fault_metrics(
    manifest, split, predictions, *, image_threshold, pixel_threshold, exploratory=False
):
    """Score at frozen thresholds; excluded annotations never contribute pixel negatives.

    References and valid/ignore bits must come from hash-verified annotations, not the model.
    Geometry validation happens before flattening; this arithmetic never resizes truth.
    """
    import math

    items = [i for i in manifest.items if i.split == split]
    by_id = {p.item_id: p for p in predictions}
    if len(by_id) != len(predictions) or set(by_id) != {i.id for i in items}:
        raise ValueError("fault predictions must cover the exact intended IDs")
    if not all(math.isfinite(t) and 0 <= t <= 1 for t in (image_threshold, pixel_threshold)):
        raise ValueError("fault thresholds must be finite probabilities")
    audit = audit_splits(manifest)
    if not audit.promotable and not exploratory:
        raise ValueError("fault manifest audit is blocking")
    image_truth, image_answer, pixel_truth, pixel_answer = [], [], [], []
    for item in items:
        p = by_id[item.id]
        if not math.isfinite(p.image_score) or not 0 <= p.image_score <= 1:
            raise ValueError("non-finite or out-of-range fault score")
        if item.id in audit.image_level_eligible:
            image_truth.append(item.image_label == "defective")
            image_answer.append(p.image_score >= image_threshold)
        if item.id not in audit.pixel_eligible:
            continue
        if (
            p.pixel_truth is None
            or p.pixel_scores is None
            or p.pixel_valid is None
            or not (len(p.pixel_truth) == len(p.pixel_scores) == len(p.pixel_valid) > 0)
        ):
            raise ValueError("eligible masks need aligned truth/scores/valid pixels")
        for truth, score, valid in zip(p.pixel_truth, p.pixel_scores, p.pixel_valid, strict=True):
            if (
                type(truth) is not bool
                or type(valid) is not bool
                or not (math.isfinite(score) and 0 <= score <= 1)
            ):
                raise ValueError("invalid pixel reference or score")
            if valid:
                pixel_truth.append(truth)
                pixel_answer.append(score >= pixel_threshold)

    def binary_f1(truth, answers):
        return (
            _f1(
                sum(t and a for t, a in zip(truth, answers, strict=True)),
                sum(not t and a for t, a in zip(truth, answers, strict=True)),
                sum(t and not a for t, a in zip(truth, answers, strict=True)),
            )[2]
            if truth
            else None
        )

    return FaultMetrics(
        len(image_truth),
        binary_f1(image_truth, image_answer),
        len(pixel_truth),
        binary_f1(pixel_truth, pixel_answer),
        fault_denominators(manifest, split),
        tuple(sorted({f.code for f in audit.findings if f.blocking})),
    )


@dataclass(frozen=True)
class EvaluationReport:
    bundle_weights_sha256: str
    manifest_sha256: str
    split: str
    fabric: FabricMetrics | None
    fault: FaultDenominators
    per_domain_coverage: dict[str, float]
    taxonomy_version: str
    fault_metrics: FaultMetrics | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def evaluate_bundle(
    bundle: Bundle,
    manifest: DatasetManifest,
    *,
    split: str = "validation",
    predict: Callable[[Bundle, Sequence[str]], Sequence[tuple[str, str | None]]] | None = None,
    feature_cache: dict[str, Path] | None = None,
    feature_files: dict[str, Path] | None = None,
    mask_files: dict[str, Path] | None = None,
    fault_predict: Callable | None = None,
    image_threshold: float | None = None,
    pixel_threshold: float | None = None,
) -> EvaluationReport:
    """Evaluate a real bundle on one manifest split.

    ``predict(bundle, item_ids)`` returns (forced argmax label, deployed answer or None) per
    item. There is no built-in predictor: without the trained weights and a loader for them
    this raises ``BundleUnavailable`` (G6). The sealed release split is refused here; release
    evaluation goes through ``release_gate``.
    """
    if not isinstance(bundle, Bundle):
        raise BundleUnavailable("real bundle not yet collected (external gate G6)")
    weights = bundle.path / bundle.weights_file
    if not weights.is_file():
        raise BundleUnavailable(f"no trained weights at {weights} (external gate G6)")
    if _sha256(weights) != bundle.weights_sha256:
        raise BundleUnavailable("the weights on disk do not match the pinned hash (G6)")
    if split not in ("train", "validation"):
        raise ValueError("sealed calibration/release splits never enter ordinary evaluation")
    if predict is None:
        raise BundleUnavailable("no predictor supplied for this bundle format (G6)")
    if bundle.run_record is None or validate_run_record(bundle.run_record):
        raise BundleUnavailable("bundle reproducibility record incomplete (external gate G6)")
    if not isinstance(manifest, DatasetManifest):
        raise BundleUnavailable("dataset manifest not yet collected (external gate G6)")
    if (
        manifest.extra.get("taxonomy_version") != bundle.taxonomy_version
        or tuple(manifest.extra.get("label_universe", ())) != bundle.label_universe
    ):
        raise ValueError("taxonomy version and ordered label universe must match the bundle")
    if (
        manifest.sha256() not in bundle.run_record["dataset_manifest_sha256s"]
        or bundle.run_record["weights_sha256"] != bundle.weights_sha256
    ):
        raise BundleUnavailable("bundle record does not bind weights/dataset (G6)")
    verify_training_inputs(
        manifest,
        audit_splits(manifest),
        expected_manifest_sha256=bundle.manifest_sha256,
        expected_audit_sha256=bundle.audit_sha256,
        root=bundle.path,
        fit_ids=tuple(i.id for i in manifest.by_split("train")),
        validation_ids=tuple(i.id for i in manifest.by_split("validation")),
        feature_cache=feature_cache,
        feature_files=feature_files,
        mask_files=mask_files,
    )
    items = [i for i in manifest.items if i.split == split]
    if not items:
        raise ValueError("evaluation split has no items")
    labelled = [i for i in items if i.fabric_label is not None or i.cohort == "CHALLENGE"]
    outputs = list(predict(bundle, [i.id for i in labelled]))
    if len(outputs) != len(labelled):
        raise ValueError("the predictor must answer every item exactly once")
    fabric = (
        fabric_metrics(
            [i.fabric_label for i in labelled],
            [o[0] for o in outputs],
            [o[1] for o in outputs],
            bundle.label_universe,
        )
        if labelled
        else None
    )
    by_domain: dict[str, list[bool]] = {}
    for item, (_, answer) in zip(labelled, outputs, strict=True):
        by_domain.setdefault(item.domain or "unspecified", []).append(answer is not None)
    faults = None
    if fault_predict is not None:
        if image_threshold is None or pixel_threshold is None:
            raise ValueError("frozen fault thresholds must be supplied")
        faults = fault_metrics(
            manifest,
            split,
            tuple(fault_predict(bundle, [i.id for i in items])),
            image_threshold=image_threshold,
            pixel_threshold=pixel_threshold,
        )
    return EvaluationReport(
        bundle_weights_sha256=bundle.weights_sha256,
        manifest_sha256=manifest.sha256(),
        split=split,
        fabric=fabric,
        fault=fault_denominators(manifest, split),
        per_domain_coverage={k: sum(v) / len(v) for k, v in sorted(by_domain.items())},
        taxonomy_version=bundle.taxonomy_version,
        fault_metrics=faults,
        notes=()
        if faults is not None
        else ("Fault scores not collected: denominators only (G6).",),
    )


@dataclass(frozen=True)
class ParityCase:
    case_id: str
    defect_score: float
    densities: tuple[float, ...]  # counts per inch, fixed axis order
    fabric_label: str | None
    regions: tuple[tuple[float, float, float, float], ...]
    status: str  # decision status under the frozen policy


@dataclass(frozen=True)
class ParityReport:
    cases: int
    max_score_error: float
    max_density_error: float
    classification_agreement: float
    region_agreement: float
    status_changes: tuple[str, ...]
    threshold_adjacent_changes: tuple[str, ...]
    promotable: bool
    reasons: tuple[str, ...]


def _iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    w = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    h = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - w * h
    return w * h / union if union > 0 else 0.0


def compare_parity(
    reference: Sequence[ParityCase],
    candidate: Sequence[ParityCase],
    *,
    thresholds: Sequence[float],
    adjacency: float,
    region_iou: float = 0.5,
) -> ParityReport:
    """FP32/PyTorch reference versus an exported or quantised candidate on the same cases.

    Any decision-status change blocks promotion; a change on a case whose reference score lies
    within ``adjacency`` of a released threshold is listed separately because it needs
    independent recalibration, not a tolerance. ``adjacency`` is a required input.
    """
    ref = {c.case_id: c for c in reference}
    cand = {c.case_id: c for c in candidate}
    if not ref or set(ref) != set(cand):
        raise ValueError("reference and candidate must cover the same non-empty case set")
    score_error = density_error = 0.0
    same_label = region_pairs = region_hits = 0
    changed: list[str] = []
    adjacent: list[str] = []
    for case_id in sorted(ref):
        r, c = ref[case_id], cand[case_id]
        if len(r.densities) != len(c.densities):
            raise ValueError(f"{case_id}: density axes differ")
        score_error = max(score_error, abs(r.defect_score - c.defect_score))
        density_error = max(
            density_error, *(abs(a - b) for a, b in zip(r.densities, c.densities, strict=True)), 0.0
        )
        same_label += r.fabric_label == c.fabric_label
        region_pairs += max(len(r.regions), len(c.regions))
        region_hits += sum(any(_iou(a, b) >= region_iou for b in c.regions) for a in r.regions)
        if r.status != c.status:
            changed.append(case_id)
            if any(abs(r.defect_score - t) <= adjacency for t in thresholds):
                adjacent.append(case_id)
    reasons = []
    if changed:
        reasons.append("DECISION_STATUS_CHANGED")
    if adjacent:
        reasons.append("THRESHOLD_ADJACENT_CHANGE_NEEDS_RECALIBRATION")
    return ParityReport(
        cases=len(ref),
        max_score_error=score_error,
        max_density_error=density_error,
        classification_agreement=same_label / len(ref),
        region_agreement=region_hits / region_pairs if region_pairs else 1.0,
        status_changes=tuple(changed),
        threshold_adjacent_changes=tuple(adjacent),
        promotable=not reasons,
        reasons=tuple(reasons),
    )
