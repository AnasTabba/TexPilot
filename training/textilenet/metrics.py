"""Classification metrics from logits. numpy only; shared by train, probe and aggregate."""

from __future__ import annotations

import numpy as np


def topk_accuracy(logits: np.ndarray, y: np.ndarray, k: int) -> float:
    k = min(k, logits.shape[1])
    topk = np.argpartition(-logits, k - 1, axis=1)[:, :k]
    return float((topk == y[:, None]).any(axis=1).mean())


def confusion_matrix(y: np.ndarray, pred: np.ndarray, n_classes: int) -> np.ndarray:
    """Rows are true classes, columns predictions."""
    return np.bincount(y * n_classes + pred, minlength=n_classes**2).reshape(n_classes, n_classes)


def summarize(logits: np.ndarray, y: np.ndarray, classes: list[str], n_pairs: int = 15) -> dict:
    """Top-1/5, macro-F1, per-class recall/precision/F1, and the most-confused pairs.

    Macro-F1 averages over classes present in ``y``: a class absent from the evaluated
    set (possible after link rot) has no defined recall and is reported, not averaged.
    """
    n = len(classes)
    pred = logits.argmax(1)
    cm = confusion_matrix(y, pred, n)
    tp = np.diag(cm).astype(float)
    support = cm.sum(1)
    predicted = cm.sum(0)
    with np.errstate(divide="ignore", invalid="ignore"):
        recall = np.where(support > 0, tp / support, np.nan)
        precision = np.where(predicted > 0, tp / predicted, 0.0)
        f1 = np.where(
            (precision + np.nan_to_num(recall)) > 0,
            2 * precision * recall / (precision + recall),
            0.0,
        )
    present = support > 0

    rates = np.where(support[:, None] > 0, cm / np.maximum(support[:, None], 1), 0.0)
    np.fill_diagonal(rates, 0)
    pairs = []
    for flat in np.argsort(-rates, axis=None)[:n_pairs]:
        i, j = divmod(int(flat), n)
        if cm[i, j] == 0:
            break
        pairs.append(
            {
                "true": classes[i],
                "pred": classes[j],
                "count": int(cm[i, j]),
                "rate": round(float(rates[i, j]), 4),
            }
        )

    return {
        "n": int(len(y)),
        "top1": topk_accuracy(logits, y, 1),
        "top5": topk_accuracy(logits, y, 5),
        "macro_f1": float(np.nanmean(np.where(present, f1, np.nan))),
        "classes_absent": [c for c, p in zip(classes, present, strict=True) if not p],
        "per_class": {
            c: {
                "support": int(support[i]),
                "recall": _f(recall[i]),
                "precision": _f(precision[i]),
                "f1": _f(f1[i]),
            }
            for i, c in enumerate(classes)
        },
        "confused_pairs": pairs,
        "confusion_matrix": cm.tolist(),
    }


def _f(x: float) -> float | None:
    return None if np.isnan(x) else round(float(x), 4)
