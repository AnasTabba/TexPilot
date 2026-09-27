"""Temperature scaling, calibration error and abstain thresholds. Spec §6.3. numpy only."""

from __future__ import annotations

import math

import numpy as np

from services.vision.heads import softmax

NEVER = 1.01  # a threshold no confidence reaches: abstain on everything


def nll(logits: np.ndarray, y: np.ndarray, t: float) -> float:
    p = softmax(logits, t)
    return float(-np.log(p[np.arange(len(y)), y] + 1e-12).mean())


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    """T minimising validation NLL; golden-section search over log T in [log 0.05, log 20]."""
    lo, hi = math.log(0.05), math.log(20.0)
    g = (math.sqrt(5) - 1) / 2
    a, b = hi - g * (hi - lo), lo + g * (hi - lo)
    fa, fb = nll(logits, y, math.exp(a)), nll(logits, y, math.exp(b))
    for _ in range(60):
        if fa < fb:
            hi, b, fb = b, a, fa
            a = hi - g * (hi - lo)
            fa = nll(logits, y, math.exp(a))
        else:
            lo, a, fa = a, b, fb
            b = lo + g * (hi - lo)
            fb = nll(logits, y, math.exp(b))
    return math.exp((lo + hi) / 2)


def ece(probs: np.ndarray, y: np.ndarray, bins: int = 15) -> float:
    conf = probs.max(1)
    correct = probs.argmax(1) == y
    total = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(total)


def abstain_threshold(conf: np.ndarray, correct: np.ndarray, target: float) -> tuple[float, float]:
    """Lowest τ whose kept predictions (conf ≥ τ) are at least ``target`` accurate.

    Tied confidences stay together: a cut can only fall between distinct values.
    Returns (τ, coverage); (NEVER, 0.0) if no τ meets the target."""
    order = np.argsort(-conf, kind="stable")
    c_sorted, ok_sorted = conf[order], correct[order].astype(float)
    cumacc = np.cumsum(ok_sorted) / np.arange(1, len(ok_sorted) + 1)
    group_ends = np.nonzero(np.append(c_sorted[1:] != c_sorted[:-1], True))[0]
    good = group_ends[cumacc[group_ends] >= target]
    if good.size == 0:
        return NEVER, 0.0
    k = int(good.max())
    return float(c_sorted[k]), (k + 1) / len(c_sorted)
