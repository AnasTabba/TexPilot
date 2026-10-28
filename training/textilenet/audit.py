"""Reproducible class-frequency and exact-leakage audit for a frozen TextileNet split.

Usage: python -m training.textilenet.audit --partition fabric \
    --split-csv data/splits/fabric.csv --data-root data --out runs/audit/fabric.json

This does not infer near-duplicates, labels or image quality from filenames. Those
require a separate image-level review. It never modifies the frozen split.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from training.textilenet.splits import PARTITIONS, Record, read_csv


def _split_summary(rows: list[Record], classes: tuple[str, ...]) -> dict:
    counts = Counter(row.label for row in rows)
    values = [counts[label] for label in classes]
    present = [value for value in values if value]
    n = sum(values)
    entropy = -sum((value / n) * math.log(value / n) for value in present) if n else None
    return {
        "n": n,
        "class_counts": {label: counts[label] for label in classes},
        "absent_classes": [label for label in classes if not counts[label]],
        "majority_minority_ratio": max(present) / min(present) if present else None,
        "entropy_normalized": entropy / math.log(len(classes))
        if entropy is not None and len(classes) > 1
        else None,
    }


def audit_records(rows: list[Record], data_root: Path | None, classes: tuple[str, ...]) -> dict:
    """Audit manifest counts and byte-identical cross-split hashes without touching data."""
    unknown = sorted({row.label for row in rows} - set(classes))
    if unknown:
        raise ValueError(f"unknown labels: {unknown}")
    by_hash: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        if row.sha1:
            by_hash[row.sha1].add(row.split)
    return {
        "total_rows": len(rows),
        "sources": dict(sorted(Counter(row.source for row in rows).items())),
        "splits": {
            split: _split_summary([row for row in rows if row.split == split], classes)
            for split in ("train", "val", "test")
        },
        "missing_files": sorted(
            row.path
            for row in rows
            if data_root is not None and not (data_root / row.path).is_file()
        ),
        "cross_split_sha1": [
            {"sha1": sha1, "splits": sorted(splits)}
            for sha1, splits in sorted(by_hash.items())
            if len(splits) > 1
        ],
        "near_duplicate_status": "not_measured",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--partition", choices=tuple(PARTITIONS), required=True)
    parser.add_argument("--split-csv", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.split_csv.is_file():
        parser.error(f"frozen split not found: {args.split_csv}; obtain the dataset first")
    report = audit_records(read_csv(args.split_csv), args.data_root, PARTITIONS[args.partition])
    report.update({"partition": args.partition, "split_csv": str(args.split_csv)})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"wrote {args.out}: {report['total_rows']} rows, "
        f"{len(report['missing_files'])} missing files"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
