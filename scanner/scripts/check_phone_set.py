"""Check the phone photo set while you collect it. See docs/phone-test-set.md.

.venv/bin/python scripts/check_phone_set.py data/phone
"""

from __future__ import annotations

import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.vision.datasets.phone import PHOTO_EXTS, label_family  # noqa: E402
from services.vision.garment import GARMENT_VOCAB  # noqa: E402
from services.vision.taxonomy import FABRIC_CLASSES  # noqa: E402

ROLES = ("_garment", "_label")


def check(root: Path) -> tuple[list[str], dict]:
    root = Path(root)
    problems: list[str] = []
    files = [p for p in root.rglob("*") if p.is_file() and p.name != "ground_truth.csv"]
    for p in files:
        if p.suffix.lower() in (".heic", ".heif"):
            problems.append(f"{p.name}: HEIC photo; set Camera -> Formats -> Most Compatible")
    photos: dict[str, Path] = {}
    for p in sorted(files):
        if p.suffix.lower() not in PHOTO_EXTS:
            continue
        if p.stem in photos:
            first = photos[p.stem].relative_to(root)
            problems.append(f"{p.stem}: two photos with this name ({first}, {p.relative_to(root)})")
        photos.setdefault(p.stem, p)

    seen: Counter = Counter()
    families: Counter = Counter()
    types: Counter = Counter()
    unparsed: list[str] = []
    try:
        with open(root / "ground_truth.csv", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
    except UnicodeDecodeError:
        problems.append("ground_truth.csv is not UTF-8: in Excel, Save As -> CSV UTF-8")
        rows = []
    for n, row in enumerate(rows, 2):  # Excel row numbers: the header is row 1
        row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        gid = row.get("id", "")
        if not gid:
            if any(row.values()):  # a fully blank row is Excel's trailing row: ignore it
                problems.append(f"row {n}: has data but no id")
            continue
        seen[gid] += 1
        if seen[gid] == 2:
            problems.append(f"{gid}: duplicate id")
        if seen[gid] > 1:
            continue
        gtype = row.get("garment_type", "").lower()
        if gtype not in GARMENT_VOCAB:
            problems.append(f"{gid}: garment_type {gtype!r} is not one of the 14")
        else:
            types[gtype] += 1
        fabric = row.get("fabric_structure", "").lower()
        if fabric and fabric not in FABRIC_CLASSES:
            problems.append(f"{gid}: fabric_structure {fabric!r} is not one of the 27")
        family = label_family(row["label_text"]) if row.get("label_text") else None
        if not row.get("label_text"):
            problems.append(f"{gid}: label_text is empty")
        elif family is None:
            unparsed.append(gid)  # a fibre we can't read; left out of scoring, not an error
        else:
            families[family] += 1
        for role in ROLES:
            if f"{gid}{role}" not in photos:
                problems.append(f"{gid}: no {role[1:]} photo")

    for stem, p in photos.items():
        gid = next((stem[: -len(r)] for r in ROLES if stem.endswith(r)), None)
        if gid is None or gid not in seen:
            problems.append(f"{p.name}: photo has no row in ground_truth.csv")

    summary = {
        "garments": len(seen),
        "by_family": dict(families),
        "by_type": dict(types),
        "unparsed": unparsed,
    }
    return problems, summary


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "data/phone")
    problems, summary = check(root)
    print(f"{summary['garments']} garments; families {summary['by_family']}")
    print(f"types {summary['by_type']}")
    for gid in summary["unparsed"]:
        print(f"  ~ {gid}: label_text does not parse. Fine if it is copied exactly as printed;"
              " it is left out of OCR and fibre-family scoring.")  # fmt: skip
    for p in problems:
        print("  -", p)
    print("OK" if not problems else f"{len(problems)} problem(s) to fix")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
