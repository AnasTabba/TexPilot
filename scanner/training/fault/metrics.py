"""Fault-detection metrics: image and pixel scores, AUPRO, operating point, paired bootstrap.

All functions return plain Python floats, ints or None so results serialise with json.dumps.
"""

from __future__ import annotations

import cv2
import numpy as np
from scipy import ndimage, stats
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score

MAX_SIDE = 256
FPR_LIMIT = 0.3


def image_metrics(labels: np.ndarray, scores: np.ndarray) -> dict:
    labels = np.asarray(labels).astype(int)
    scores = np.asarray(scores, dtype=float)
    if np.unique(labels).size < 2:
        return {"auroc": None, "ap": None}
    return {
        "auroc": float(roc_auc_score(labels, scores)),
        "ap": float(average_precision_score(labels, scores)),
    }


def _downsample(arr: np.ndarray) -> np.ndarray:
    # Nearest-neighbour for both masks and maps: a map equal to its mask stays equal to it.
    h, w = arr.shape
    s = max(h, w)
    if s <= MAX_SIDE:
        return arr
    scale = MAX_SIDE / s
    return cv2.resize(
        arr, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_NEAREST
    )


def _trapezoid(y: np.ndarray, x: np.ndarray) -> float:
    # np.trapezoid is NumPy 2.0+; np.trapz exists on NumPy 1.26 and 2.x.
    fn = getattr(np, "trapezoid", None)
    if fn is None:
        fn = np.trapz
    return float(fn(y, x))


def _aupro(masks: list[np.ndarray], maps: list[np.ndarray]) -> float | None:
    region_scores: list[np.ndarray] = []
    good_scores: list[np.ndarray] = []
    for m, s in zip(masks, maps, strict=True):
        m = m.astype(bool)
        good_scores.append(s[~m])
        labeled, n = ndimage.label(m)
        for i in range(1, n + 1):
            region_scores.append(s[labeled == i])
    if not region_scores or not good_scores or sum(g.size for g in good_scores) == 0:
        return None
    good = np.concatenate(good_scores)
    all_scores = np.concatenate([s.ravel() for s in maps])
    thresholds = np.linspace(all_scores.min(), all_scores.max(), 201)
    fpr = np.array([(good > t).mean() for t in thresholds])
    overlap = np.array([np.mean([(r > t).mean() for r in region_scores]) for t in thresholds])
    grid = np.linspace(0.0, FPR_LIMIT, 301)
    # Best per-region overlap achievable at each FPR budget (curve is non-decreasing in FPR).
    curve = np.array([overlap[fpr <= g + 1e-12].max(initial=0.0) for g in grid])
    return _trapezoid(curve, grid) / FPR_LIMIT


def pixel_metrics(masks: list[np.ndarray], maps: list[np.ndarray]) -> dict:
    masks = [_downsample((np.asarray(m) > 0).astype(np.uint8)) for m in masks]
    maps = [_downsample(np.asarray(s, dtype=np.float32)) for s in maps]
    y = np.concatenate([m.ravel() for m in masks])
    s = np.concatenate([x.ravel() for x in maps])
    if np.unique(y).size < 2:
        pixel_auroc = pixel_ap = None
    else:
        pixel_auroc = float(roc_auc_score(y, s))
        pixel_ap = float(average_precision_score(y, s))
    return {"pixel_auroc": pixel_auroc, "pixel_ap": pixel_ap, "aupro": _aupro(masks, maps)}


def threshold_at_far(good_scores: np.ndarray, far: float = 0.005) -> float:
    return float(np.quantile(np.asarray(good_scores, dtype=float), 1.0 - far))


def _clopper_pearson(k: int, n: int, alpha: float = 0.05) -> tuple[float, float]:
    lo = 0.0 if k == 0 else float(stats.beta.ppf(alpha / 2, k, n - k + 1))
    hi = 1.0 if k == n else float(stats.beta.ppf(1 - alpha / 2, k + 1, n - k))
    return lo, hi


def operating_point(labels, scores, thr: float) -> dict:
    labels = np.asarray(labels).astype(int)
    pred = np.asarray(scores, dtype=float) > thr
    is_defect = labels == 1
    tp = int(np.sum(pred & is_defect))
    fp = int(np.sum(pred & ~is_defect))
    fn = int(np.sum(~pred & is_defect))
    n_good = int(np.sum(~is_defect))
    n_defect = int(np.sum(is_defect))

    recall = tp / n_defect if n_defect else None
    precision = tp / (tp + fp) if tp + fp else None
    denom = 2 * tp + fp + fn
    f1 = 2 * tp / denom if denom and n_defect else None

    if n_good:
        fa = 1000.0 * fp / n_good
        lo, hi = _clopper_pearson(fp, n_good)
        fa_ci95 = [1000.0 * lo, 1000.0 * hi]
    else:
        fa, fa_ci95 = None, None
    return {
        "recall": None if recall is None else float(recall),
        "precision": None if precision is None else float(precision),
        "f1": None if f1 is None else float(f1),
        "false_alarms_per_1000": None if fa is None else float(fa),
        "fa_ci95": fa_ci95,
        "n_good": n_good,
        "n_defect": n_defect,
    }


def paired_bootstrap_f1(y, pred_a, pred_b, groups, n: int = 1000, seed: int = 2026) -> dict:
    y = np.asarray(y)
    pred_a = np.asarray(pred_a)
    pred_b = np.asarray(pred_b)
    groups = np.asarray(groups)
    labels = np.unique(y)

    def macro_f1(idx: np.ndarray, pred: np.ndarray) -> float:
        return float(f1_score(y[idx], pred[idx], labels=labels, average="macro", zero_division=0))

    all_idx = np.arange(len(y))
    delta = macro_f1(all_idx, pred_b) - macro_f1(all_idx, pred_a)

    uniq = np.unique(groups)
    rows_of = {g: np.flatnonzero(groups == g) for g in uniq}
    rng = np.random.default_rng(seed)
    deltas = np.empty(n)
    for i in range(n):
        chosen = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([rows_of[g] for g in chosen])
        deltas[i] = macro_f1(idx, pred_b) - macro_f1(idx, pred_a)
    lo, hi = np.percentile(deltas, [2.5, 97.5])
    return {"delta": float(delta), "ci95": [float(lo), float(hi)]}
