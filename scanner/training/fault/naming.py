"""Defect-type naming: abstaining balanced logistic regression on frozen-backbone features."""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler

SEED = 2026
TARGET_PRECISION = 0.90


class NamingModel:
    """Standardiser + classifier + confidence cut. Rows below the cut come back as None."""

    def __init__(
        self,
        classes: list[str],
        scaler: StandardScaler,
        clf: LogisticRegression,
        threshold: float,
        val_precision: float,
        val_coverage: float,
    ) -> None:
        self.classes = classes
        self.scaler = scaler
        self.clf = clf
        self.threshold = threshold
        self.val_precision = val_precision
        self.val_coverage = val_coverage

    def predict(self, feats: np.ndarray) -> list[tuple[str | None, float]]:
        proba = self.clf.predict_proba(self.scaler.transform(np.asarray(feats, dtype=float)))
        best = proba.argmax(axis=1)
        top = proba[np.arange(len(best)), best]
        return [
            (self.classes[int(b)] if p >= self.threshold else None, float(p))
            for b, p in zip(best, top, strict=True)
        ]


def _pick_threshold(top: np.ndarray, correct: np.ndarray) -> tuple[float, float, float]:
    """Smallest cut with answered precision >= TARGET_PRECISION; else the best-precision cut.

    Returns (threshold, precision, coverage) measured on the val rows.
    """
    best: tuple[float, float, float] | None = None
    # ponytail: O(n^2) scan over val cuts, fine for a few thousand val rows
    for cut in np.unique(top):
        answered = top >= cut
        prec = float(correct[answered].mean())
        cov = float(answered.mean())
        if prec >= TARGET_PRECISION:
            return float(cut), prec, cov
        if best is None or prec > best[1]:
            best = (float(cut), prec, cov)
    assert best is not None  # top is never empty when val is non-empty
    return best


def fit_naming(features: np.ndarray, labels: list[str], groups: list[str]) -> NamingModel:
    """Fit on a group-disjoint 80 % split, choose the cut on the other 20 % (val)."""
    x = np.asarray(features, dtype=float)
    y = np.asarray(labels, dtype=object)
    g = np.asarray(groups, dtype=object)
    if x.ndim != 2 or not (len(x) == len(y) == len(g)):
        raise ValueError("features must be 2-D with one label and one group per row")

    classes = sorted(set(labels))
    thin = [c for c in classes if len({gr for gr in g[y == c]}) < 2]
    if thin:
        raise ValueError(
            f"need at least 2 groups per class to split by group; too few for: {thin}"
        )

    fit_idx, val_idx = next(
        GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(x, y, g)
    )
    if set(y[fit_idx]) != set(classes):
        raise ValueError("group split left a class out of the fit part; add more groups per class")
    if len(val_idx) == 0:
        raise ValueError("group split left no validation rows; add more groups")

    scaler = StandardScaler().fit(x[fit_idx])
    clf = LogisticRegression(class_weight="balanced", max_iter=2000)
    clf.fit(scaler.transform(x[fit_idx]), y[fit_idx])

    proba = clf.predict_proba(scaler.transform(x[val_idx]))
    top = proba.max(axis=1)
    correct = clf.classes_[proba.argmax(axis=1)] == y[val_idx]
    threshold, precision, coverage = _pick_threshold(top, correct)
    return NamingModel(classes, scaler, clf, threshold, precision, coverage)
