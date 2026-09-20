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
    """Compare vision output against a stated composition."""
    kb = load_kb(kb_path)
    tol = kb["tolerance"]
    version = int(kb["version"])

    # No structure prediction, or no label read -> nothing to cross-check.
    if vision.structure is None or composition is None:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)

    if vision.structure.confidence < tol["min_visual_confidence"]:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)

    entry = kb["fabrics"].get(vision.structure.label)
    if entry is None:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)

    plausible = set(entry["families"])
    stated = _dominant_families(composition, tol["min_component_pct"])
    if not stated:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)

    flags: list[Flag] = []

    if not (stated & plausible):
        flags.append(
            Flag(
                code="COMPOSITION_IMPLAUSIBLE",
                message=(
                    f"Label states {'/'.join(sorted(stated))} but the fabric reads as "
                    f"{vision.structure.label}, which is normally "
                    f"{'/'.join(sorted(plausible))}."
                ),
                severity="high",
            )
        )

    expected = entry.get("expected_treatment")
    if (
        expected
        and vision.treatment is not None
        and vision.treatment.confidence >= tol["min_visual_confidence"]
        and vision.treatment.label != expected
    ):
        flags.append(
            Flag(
                code="TREATMENT_UNEXPECTED",
                message=(
                    f"{vision.structure.label} is normally {expected}, "
                    f"but this reads as {vision.treatment.label}."
                ),
                severity="medium",
            )
        )

    return Verdict("FLAG" if flags else "PASS", tuple(flags), version)
