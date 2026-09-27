"""Cross-checks what the fabric looks like against what its label claims.

Spec section 4.3. The flag rule is deliberately conservative: raise only when the
vision model is confident AND the stated composition is implausible for what it
saw. Everything else passes or abstains.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from pathlib import Path

import yaml

from services.ocr.parser import FiberPct
from services.vision.predictor import VisionOutput
from services.vision.taxonomy import family_of

DEFAULT_KB_PATH = Path(__file__).with_name("kb.yaml")


@dataclass(frozen=True)
class Flag:
    code: str
    message: str
    severity: str  # "high" | "medium"


@dataclass(frozen=True)
class Verdict:
    outcome: str  # PASS | FLAG | INSUFFICIENT_EVIDENCE
    flags: tuple[Flag, ...] = ()
    kb_version: int = 0


@functools.lru_cache(maxsize=4)
def load_kb(path: Path = DEFAULT_KB_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _dominant_families(composition: list[FiberPct], min_pct: float) -> set[str]:
    families: set[str] = set()
    for component in composition:
        if component.pct < min_pct:
            continue
        try:
            families.add(family_of(component.name))
        except KeyError:
            # Unknown fibre: cannot reason about it, so it constrains nothing.
            continue
    return families


def evaluate(
    vision: VisionOutput,
    composition: list[FiberPct] | None,
    kb_path: Path = DEFAULT_KB_PATH,
) -> Verdict:
    """Compare vision output against a stated composition.

    PASS needs the structure check to have run. The family check can only add a flag:
    a confident family that the label does not mention is evidence of a mislabel, but a
    matching family alone is too coarse to vouch for the label.
    """
    kb = load_kb(kb_path)
    tol = kb["tolerance"]
    version = int(kb["version"])

    if composition is None:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)
    stated = _dominant_families(composition, tol["min_component_pct"])
    if not stated:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)

    flags: list[Flag] = []
    structure_checked = False
    s = vision.structure
    entry = kb["fabrics"].get(s.label) if s is not None else None
    if s is not None and entry is not None and s.confidence >= tol["min_visual_confidence"]:
        structure_checked = True
        plausible = set(entry["families"])
        if not (stated & plausible):
            flags.append(
                Flag(
                    code="COMPOSITION_IMPLAUSIBLE",
                    message=(
                        f"Label states {'/'.join(sorted(stated))} but the fabric reads as "
                        f"{s.label}, which is normally {'/'.join(sorted(plausible))}."
                    ),
                    severity="high",
                )
            )
        expected = entry.get("expected_treatment")
        t = vision.treatment
        if (
            expected
            and t is not None
            and t.confidence >= tol["min_visual_confidence"]
            and t.label != expected
        ):
            flags.append(
                Flag(
                    code="TREATMENT_UNEXPECTED",
                    message=f"{s.label} is normally {expected}, but this reads as {t.label}.",
                    severity="medium",
                )
            )

    f = vision.fibre_family
    if f is not None and f.confidence >= tol["family_min_confidence"] and f.label not in stated:
        flags.append(
            Flag(
                code="FAMILY_MISMATCH",
                message=(
                    f"Label states {'/'.join(sorted(stated))} but the fabric reads as {f.label}."
                ),
                severity="medium",
            )
        )

    if flags:
        return Verdict("FLAG", tuple(flags), version)
    return Verdict("PASS" if structure_checked else "INSUFFICIENT_EVIDENCE", kb_version=version)
