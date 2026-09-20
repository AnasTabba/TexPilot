"""Care-label composition parsing.

Spec section 4.2. Handles ``60% COTTON 40% POLYESTER`` and ``COTTON 60%`` orderings,
tolerates OCR noise, and refuses to guess: if the parse does not validate, the
caller gets ``None`` and the scan abstains.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from services.ocr.normalizer import normalize_fiber_name

#: Percentages must sum to 100 within this tolerance. Care labels round.
SUM_TOLERANCE = 2.0

_PCT_FIRST = re.compile(r"(\d{1,3})\s*%\s*([A-Za-z][A-Za-z\s\-]{1,24})")
_NAME_FIRST = re.compile(r"([A-Za-z][A-Za-z\s\-]{1,24}?)\s*[:\-]?\s*(\d{1,3})\s*%")


@dataclass(frozen=True)
class FiberPct:
    name: str
    pct: float


def _collect(text: str) -> list[FiberPct] | None:
    """Best-effort extraction under both orderings; ``None`` if any name is unknown."""
    best: list[FiberPct] = []
    for pattern, pct_group in ((_PCT_FIRST, 1), (_NAME_FIRST, 2)):
        found: list[FiberPct] = []
        for m in pattern.finditer(text):
            name_group = 2 if pct_group == 1 else 1
            canonical = normalize_fiber_name(m.group(name_group))
            if canonical is None:
                # An unrecognised component makes the whole parse untrustworthy:
                # dropping it could let the rest sum to 100 and look valid.
                found = []
                break
            found.append(FiberPct(canonical, float(m.group(pct_group))))
        if len(found) > len(best):
            best = found
    return best or None


def parse_composition(text: str) -> list[FiberPct] | None:
    """Parse a care-label string into a validated composition.

    Returns ``None`` when the text is unparseable, contains an unrecognised fibre,
    or fails the sum check -- never a partial or guessed result.
    """
    if not text or not text.strip():
        return None

    parsed = _collect(text)
    if not parsed:
        return None

    merged: dict[str, float] = {}
    for item in parsed:
        merged[item.name] = merged.get(item.name, 0.0) + item.pct

    total = sum(merged.values())
    if abs(total - 100.0) > SUM_TOLERANCE:
        return None

    return sorted(
        (FiberPct(n, p) for n, p in merged.items()),
        key=lambda f: (-f.pct, f.name),
    )
