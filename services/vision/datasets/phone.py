"""The team's phone photo set (spec §8.1) as a FabricDataset. Domain: phone.

Layout: <root>/ground_truth.csv plus photos anywhere under <root>, named
<id>_garment.<ext> and <id>_label.<ext>. See docs/phone-test-set.md.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from services.ocr.engines.base import TextLine
from services.ocr.extract import extract
from services.vision.datasets.base import FabricDataset, Sample
from services.vision.taxonomy import family_of

PHOTO_EXTS = (".jpg", ".jpeg", ".png")
MIN_COMPONENT_PCT = 15.0  # same floor as the consistency KB


def typed_composition(label_text: str):
    """A typed label (lines separated by ' / ' or newlines) through the same extractor
    OCR output goes through, so ground truth and predictions are parsed identically."""
    lines = [
        TextLine(t.strip(), 1.0, (0.0, 10.0 * i, 100.0, 10.0 * i + 8))
        for i, t in enumerate(re.split(r"\s+/\s+|[\r\n]+", label_text))
        if t.strip()
    ]
    return extract(lines).fibers


def label_family(label_text: str) -> str | None:
    """Dominant fibre family of a typed label; 'blend' when two or more families each
    reach 15%; None when the text does not parse."""
    fibers = typed_composition(label_text)
    if not fibers:
        return None
    families = set()
    for f in fibers:
        if f.pct < MIN_COMPONENT_PCT:
            continue
        try:
            families.add(family_of(f.name))
        except KeyError:
            return None
    if not families:
        return None
    return families.pop() if len(families) == 1 else "blend"


class PhoneDataset(FabricDataset):
    domain = "phone"

    def __init__(self, root: Path):
        self.root = Path(root)
        photos = {p.stem: p for p in self.root.rglob("*") if p.suffix.lower() in PHOTO_EXTS}
        self.samples: list[Sample] = []
        self.missing: list[str] = []
        self.duplicates: list[str] = []  # repeated ids; the first row is kept
        seen: set[str] = set()
        with open(self.root / "ground_truth.csv", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
                gid = row.get("id", "")
                if not gid:
                    continue
                if gid in seen:
                    self.duplicates.append(gid)
                    continue
                seen.add(gid)
                garment = photos.get(f"{gid}_garment")
                if garment is None:
                    self.missing.append(gid)
                    continue
                text = row.get("label_text") or None
                self.samples.append(
                    Sample(
                        image_path=garment,
                        group_id=gid,
                        fabric=(row.get("fabric_structure") or "").lower() or None,
                        fibre_family=label_family(text) if text else None,
                        garment_type=(row.get("garment_type") or "").lower() or None,
                        label_image_path=photos.get(f"{gid}_label"),
                        label_text=text,
                    )
                )

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Sample:
        return self.samples[idx]
