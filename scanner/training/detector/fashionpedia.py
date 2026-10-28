"""Fashionpedia (COCO format) restricted to the 14 garment classes. Spec §4.1, §4.2 B.

Accessories and garment parts (shoe, bag, sleeve, pocket, ...) are dropped. A photo left
with no garment stays in as a negative, so the detector learns to say "no garment".
Stdlib only.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from services.vision.garment import GARMENT_VOCAB

CLASSES: tuple[str, ...] = tuple(GARMENT_VOCAB)  # index = the detector's label id

#: Fashionpedia category name -> our class. Matched by name, not by id.
FASHIONPEDIA_TO_VOCAB = {
    "shirt, blouse": "shirt_blouse",
    "top, t-shirt, sweatshirt": "top_tshirt_sweatshirt",
    "sweater": "sweater",
    "cardigan": "cardigan",
    "jacket": "jacket",
    "vest": "vest",
    "pants": "pants",
    "shorts": "shorts",
    "skirt": "skirt",
    "coat": "coat",
    "dress": "dress",
    "jumpsuit": "jumpsuit",
    "cape": "cape",
    "scarf": "scarf",
}
assert set(FASHIONPEDIA_TO_VOCAB.values()) == set(CLASSES)


@dataclass(frozen=True)
class Example:
    image_id: int
    file_name: str
    width: int
    height: int
    boxes: tuple[tuple[float, float, float, float], ...]  # COCO (x, y, w, h), pixels
    labels: tuple[int, ...]  # index into CLASSES


def load(json_path: Path) -> list[Example]:
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    cat = {
        c["id"]: CLASSES.index(FASHIONPEDIA_TO_VOCAB[c["name"]])
        for c in data["categories"]
        if c["name"] in FASHIONPEDIA_TO_VOCAB
    }
    by_image: dict[int, list] = defaultdict(list)
    for a in data["annotations"]:
        x, y, w, h = (float(v) for v in a["bbox"])
        if a["category_id"] in cat and not a.get("iscrowd") and w > 0 and h > 0:
            by_image[a["image_id"]].append(((x, y, w, h), cat[a["category_id"]]))
    return [
        Example(
            im["id"],
            im["file_name"],
            im["width"],
            im["height"],
            tuple(box for box, _ in by_image[im["id"]]),
            tuple(label for _, label in by_image[im["id"]]),
        )
        for im in sorted(data["images"], key=lambda im: im["id"])
    ]


def holdout(examples: list[Example], frac: float = 0.05) -> tuple[list[Example], list[Example]]:
    """(train, held-out) for choosing the checkpoint; the official val set stays the test.
    Decided by a hash of each image id, so reruns and added images never move an image."""

    def held(e: Example) -> bool:
        digest = hashlib.sha1(str(e.image_id).encode()).hexdigest()
        return int(digest, 16) % 1000 < frac * 1000

    return [e for e in examples if not held(e)], [e for e in examples if held(e)]


def to_coco(examples: list[Example]) -> dict:
    """Ground truth in COCO form, with our class ids, for pycocotools."""
    annotations = [
        {
            "image_id": e.image_id,
            "category_id": label,
            "bbox": list(box),
            "area": box[2] * box[3],
            "iscrowd": 0,
        }  # fmt: skip
        for e in examples
        for box, label in zip(e.boxes, e.labels, strict=True)
    ]
    for n, a in enumerate(annotations, 1):
        a["id"] = n
    return {
        "images": [{"id": e.image_id, "width": e.width, "height": e.height} for e in examples],
        "annotations": annotations,
        "categories": [{"id": i, "name": c} for i, c in enumerate(CLASSES)],
    }
