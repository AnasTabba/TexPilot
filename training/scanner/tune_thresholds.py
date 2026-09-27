"""Pick KB flag thresholds for precision on deliberately mismatched pairs (spec §8.3).

Records come from the bake-off: each is one (garment photo, label) pair with the vision
outputs recorded once. Thresholds are then swept without re-running any model.
"""

from __future__ import annotations

import itertools
import math

from training.scanner.eval_metrics import precision_recall


def _flags(rec: dict, visual: float, family: float, kb_fabrics: dict | None, exempt) -> bool:
    """Mirrors services.consistency.engine.evaluate's flag rules at these thresholds."""
    stated = set(rec["stated"])
    raised = imitation = False
    if rec.get("structure") and kb_fabrics is not None:
        label, conf = rec["structure"]
        entry = kb_fabrics.get(label)
        if entry and conf >= visual:
            raised = not (stated & set(entry["families"]))
            expected, t = entry.get("expected_treatment"), rec.get("treatment")
            if expected and t and t[1] >= visual and t[0] != expected:
                raised = True  # TREATMENT_UNEXPECTED, e.g. printed denim
            imitation = label in exempt  # faux fur/leather: the family head is fooled
    if rec.get("family") and not imitation:
        label, conf = rec["family"]
        if conf >= family and label not in stated:
            raised = True
    return raised


def sweep(
    records: list[dict],
    visual: list[float],
    family: list[float],
    kb_fabrics: dict | None = None,
    exempt: tuple[str, ...] | list[str] = (),
) -> list[dict]:
    rows = []
    for v, f in itertools.product(visual, family):
        flagged = [_flags(r, v, f, kb_fabrics, set(exempt)) for r in records]
        p, r = precision_recall(flagged, [rec["should_flag"] for rec in records])
        rows.append(
            {
                "min_visual_confidence": v,
                "family_min_confidence": f,
                "precision": p,
                "recall": r,
                "flags": sum(flagged),
            }
        )
    return rows


def evidence_grid(confs: list[float], grid: list[float], current: float) -> list[float]:
    """Raise grid values below the lowest observed confidence to it (rounded down): heads
    abstain below their own threshold, so lower values flag the same pairs and choosing
    one would claim ground the data never tested. No observations: keep ``current``."""
    if not confs:
        return [current]
    lo = math.floor(min(confs) * 100) / 100
    return sorted({max(g, lo) for g in grid})


def choose(rows: list[dict], target: float = 0.90) -> dict | None:
    """Lowest thresholds (most recall) whose precision meets the target and that flag at
    least once; None if nothing qualifies."""
    ok = [r for r in rows if r["precision"] >= target and r["flags"] > 0]
    if not ok:
        return None
    return min(
        ok, key=lambda r: (r["min_visual_confidence"] + r["family_min_confidence"], -r["recall"])
    )
