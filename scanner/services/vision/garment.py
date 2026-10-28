"""Garment vocabulary and choosing the garment a photo is about. Spec §4.1, §4.3.

Stdlib only: every detector backend maps its raw output through here.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

Box = tuple[float, float, float, float]  # pixels (x0, y0, x1, y1), origin top-left

#: The fabric garments among Fashionpedia's apparel classes -> prompt synonyms.
GARMENT_VOCAB: dict[str, tuple[str, ...]] = {
    "shirt_blouse": ("shirt", "blouse"),
    "top_tshirt_sweatshirt": ("t-shirt", "top", "sweatshirt", "hoodie"),
    "sweater": ("sweater", "jumper", "pullover"),
    "cardigan": ("cardigan",),
    "jacket": ("jacket", "blazer"),
    "vest": ("vest", "waistcoat"),
    "pants": ("pants", "trousers", "jeans"),
    "shorts": ("shorts",),
    "skirt": ("skirt",),
    "coat": ("coat", "overcoat"),
    "dress": ("dress", "gown"),
    "jumpsuit": ("jumpsuit", "overalls"),
    "cape": ("cape", "poncho"),
    "scarf": ("scarf", "shawl", "dupatta"),
}
PROMPTS: tuple[str, ...] = tuple(s for synonyms in GARMENT_VOCAB.values() for s in synonyms)


@dataclass(frozen=True)
class Detection:
    label: str  # a GARMENT_VOCAB key
    score: float | None  # None when the backend produces no scores (Florence-2)
    box: Box


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


# Longest first, so "sweatshirt" and "tshirt" are tried before "shirt".
_SYNONYMS = sorted(
    ((_norm(s), garment) for garment, synonyms in GARMENT_VOCAB.items() for s in synonyms),
    key=lambda pair: -len(pair[0]),
)


def canonical(phrase: str) -> str | None:
    """Canonical garment named in a detector's text label, or None if it names none."""
    key = _norm(phrase)
    if not key:
        return None
    for synonym, garment in _SYNONYMS:
        if synonym in key:
            return garment
    return None


def to_detections(labels, scores, boxes, width: float, height: float) -> list[Detection]:
    """Raw backend output -> Detections: canonical labels, boxes clipped to the image,
    unmapped labels and empty boxes dropped."""
    out: list[Detection] = []
    for label, score, (x0, y0, x1, y1) in zip(labels, scores, boxes, strict=True):
        garment = canonical(label)
        if garment is None:
            continue
        box = (
            max(0.0, float(x0)),
            max(0.0, float(y0)),
            min(float(width), float(x1)),
            min(float(height), float(y1)),
        )
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        out.append(Detection(garment, None if score is None else float(score), box))
    return out


def choose_primary(
    dets: list[Detection], width: float, height: float, min_score: float = 0.30
) -> Detection | None:
    """rank = score x sqrt(area fraction) x (1 - 0.5 x centre distance). Spec §4.3.

    Scoreless detections count as score 1 and skip the threshold. Ties keep the first."""
    cx, cy = width / 2, height / 2
    half_diagonal = math.hypot(cx, cy)
    best, best_rank = None, -1.0
    for d in dets:
        if d.score is not None and d.score < min_score:
            continue
        x0, y0, x1, y1 = d.box
        area = (x1 - x0) * (y1 - y0) / (width * height)
        distance = math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy) / half_diagonal
        rank = (1.0 if d.score is None else d.score) * math.sqrt(area) * (1 - 0.5 * distance)
        if rank > best_rank:
            best, best_rank = d, rank
    return best
