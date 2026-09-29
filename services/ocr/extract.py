"""OCR lines from a care-label photo -> one trustworthy composition. Spec §5.3.

Never a guess: a label whose readings disagree, or that only states a lining, is
UNREADABLE; a photo with no composition text is NO_LABEL_TEXT.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

from services.ocr.engines.base import TextLine
from services.ocr.normalizer import fold_text, normalize_fiber_name
from services.ocr.parser import FiberPct, parse_composition

MAIN_SECTIONS = (
    "shell",
    "outer",
    "main",
    "body",
    "self",
    "fabric",
    "tessuto",
    "tissu",
    "tejido",
    "stoff",
    "exterior",
    "exterieur",
    "aussen",
)
OTHER_SECTIONS = (
    "lining",
    "trim",
    "rib",
    "filling",
    "padding",
    "pocketing",
    "contrast",
    "fodera",
    "doublure",
    "forro",
    "futter",
    "garnissage",
    "relleno",
    "imbottitura",
)
_SECTION = re.compile(
    r"^\s*(" + "|".join(MAIN_SECTIONS + OTHER_SECTIONS) + r")\b\s*[:\-]?\s*", re.IGNORECASE
)
_WORDS = re.compile(r"[^\W\d_]+")


@dataclass(frozen=True)
class Extraction:
    fibers: list[FiberPct] | None
    section: str | None = None
    confidence: float | None = None
    reason: str | None = None  # "NO_LABEL_TEXT" | "UNREADABLE" when fibers is None
    text: str | None = None  # the lines the composition was read from, " / "-joined


def _cy(line: TextLine) -> float:
    return (line.box[1] + line.box[3]) / 2


def reading_order(lines: list[TextLine]) -> list[TextLine]:
    """Top to bottom, then left to right. Lines whose centres are within half a line
    height of a row's first line join that row."""
    if not lines:
        return []
    by_y = sorted(lines, key=_cy)
    rows, row = [], [by_y[0]]
    for line in by_y[1:]:
        height = max(1.0, min(row[0].box[3] - row[0].box[1], line.box[3] - line.box[1]))
        if abs(_cy(line) - _cy(row[0])) <= height / 2:
            row.append(line)
        else:
            rows.append(row)
            row = [line]
    rows.append(row)
    return [line for r in rows for line in sorted(r, key=lambda ln: ln.box[0])]


def _looks_like_label(lines: list[TextLine]) -> bool:
    return any(
        "%" in line.text or any(normalize_fiber_name(w) for w in _WORDS.findall(line.text))
        for line in lines
    )


def _split_sections(lines: list[TextLine]) -> list[tuple[str | None, list[TextLine]]]:
    sections: list[tuple[str | None, list[TextLine]]] = [(None, [])]
    for line in lines:
        text = fold_text(line.text)
        m = _SECTION.match(text)
        if m:
            rest = text[m.end() :]
            sections.append(
                (m.group(1).lower(), [replace(line, text=rest)] if rest.strip() else [])
            )
        else:
            sections[-1][1].append(replace(line, text=text))
    return [(name, ls) for name, ls in sections if ls]


def _parse_section(lines):
    """(composition, lines used, agreeing readings, conflict?)."""
    whole = parse_composition(" | ".join(line.text for line in lines))
    if whole:
        return whole, lines, 1, False
    valid = [(c, line) for line in lines if (c := parse_composition(line.text))]
    if not valid:
        return None, [], 0, False
    first = valid[0][0]
    if any(c != first for c, _ in valid[1:]):
        return None, [], 0, True
    return first, [line for _, line in valid], len(valid), False


def extract(lines: list[TextLine]) -> Extraction:
    if not lines or not _looks_like_label(lines):
        return Extraction(None, reason="NO_LABEL_TEXT")
    sections = _split_sections(reading_order(lines))
    main = [s for s in sections if s[0] in MAIN_SECTIONS]
    candidates = main[:1] if main else [s for s in sections if s[0] not in OTHER_SECTIONS]
    for name, section_lines in candidates:
        fibers, used, agreeing, conflict = _parse_section(section_lines)
        if conflict:
            return Extraction(None, reason="UNREADABLE")
        if fibers:
            confs = [line.confidence for line in used]
            confidence = None if None in confs else 1 - (1 - sum(confs) / len(confs)) ** agreeing
            text = " / ".join(line.text.strip() for line in used)
            return Extraction(fibers, section=name, confidence=confidence, text=text)
    return Extraction(None, reason="UNREADABLE")


def _mostly_sideways(lines: list[TextLine]) -> bool:
    """True when most text boxes are taller than wide: the engine read the label rotated,
    and its reading order (hence which composition belongs to which section) is unreliable."""
    tall = sum(1 for ln in lines if (ln.box[3] - ln.box[1]) > (ln.box[2] - ln.box[0]))
    return tall > len(lines) / 2


def read_composition(engine, image) -> Extraction:
    """OCR + extract, retrying at 90°, 180° and 270° when nothing parses. A reading taken
    sideways (mostly tall boxes) is skipped, so a scrambled order never reaches the parser."""
    import numpy as np

    saw_text = False
    for k in range(4):
        lines = engine.read(np.ascontiguousarray(np.rot90(image, k)))
        if lines and _mostly_sideways(lines):
            saw_text = True
            continue
        ex = extract(lines)
        if ex.fibers:
            return ex
        saw_text = saw_text or ex.reason == "UNREADABLE"
    return Extraction(None, reason="UNREADABLE" if saw_text else "NO_LABEL_TEXT")
