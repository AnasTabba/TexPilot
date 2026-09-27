"""Bake-off metrics (spec §8.2). Stdlib only."""

from __future__ import annotations

import re
import statistics


def type_accuracy(pred: list[str | None], truth: list[str]) -> float:
    return sum(p == t for p, t in zip(pred, truth, strict=True)) / max(1, len(truth))


def composition_match(pred, truth, tol: float = 1.0) -> bool:
    """Same fibres, each percentage within ``tol`` points. None never matches."""
    if not pred or not truth:
        return False
    a = {f.name: f.pct for f in pred}
    b = {f.name: f.pct for f in truth}
    return a.keys() == b.keys() and all(abs(a[k] - b[k]) <= tol for k in a)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.upper()).strip()


def cer(pred_text: str, truth_text: str) -> float:
    """Character error rate: Levenshtein distance / length of the truth, after upper-casing
    and collapsing whitespace."""
    p, t = _norm(pred_text), _norm(truth_text)
    prev = list(range(len(p) + 1))
    for i, tc in enumerate(t, 1):
        cur = [i]
        for j, pc in enumerate(p, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (pc != tc)))
        prev = cur
    return prev[-1] / max(1, len(t))


def latency(times: list[float]) -> dict:
    qs = statistics.quantiles(times, n=20, method="inclusive") if len(times) > 1 else times * 19
    return {"p50": statistics.median(times), "p95": qs[18]}


def swap_pairs(families: dict[str, str]) -> list[tuple[str, str, bool]]:
    """Each garment with its own label (should not flag) and, for every garment of a
    different family, with that garment's label (should flag). Same-family swaps are
    left out: a cotton label on a linen shirt is not a mislabel we promise to catch."""
    ids = sorted(families)
    pairs = [(g, g, False) for g in ids]
    pairs += [
        (g, lab, True) for g in ids for lab in ids if lab != g and families[lab] != families[g]
    ]
    return pairs


def precision_recall(flagged: list[bool], should: list[bool]) -> tuple[float, float]:
    tp = sum(f and s for f, s in zip(flagged, should, strict=True))
    fp = sum(f and not s for f, s in zip(flagged, should, strict=True))
    fn = sum(s and not f for f, s in zip(flagged, should, strict=True))
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    return precision, recall
