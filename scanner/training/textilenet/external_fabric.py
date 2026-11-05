"""Index DeepFashion2 for review; append verified external fabric training rows.

No garment-category-to-fabric mapping and no pseudo-label acceptance. The output
uses the existing Record CSV contract; the frozen benchmark is never rewritten.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from training.textilenet.splits import Record, read_csv

REVIEW_FIELDS = (
    "path",
    "dataset",
    "group_id",
    "source_split",
    "domain",
    "category_ids",
    "item_count",
    "fabric_label",
    "review",
    "reviewer",
)


def contained_file(root: Path, relative: str) -> Path:
    path = Path(relative)
    resolved = (root / path).resolve()
    if path.is_absolute() or not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"image path escapes data root: {relative!r}")
    if not resolved.is_file():
        raise ValueError(f"missing image: {relative!r}")
    return resolved


def file_hash(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def index_deepfashion2(root: Path, data_root: Path) -> list[dict]:
    """Inventory official training images, one review row per whole photo.

    pair_id groups all styles/items, conservatively preserving product identity.
    Category IDs describe clothing, and deliberately do not populate fabric_label.
    """
    annotations = sorted((root / "train/annos").glob("*.json"))
    if not annotations:
        raise ValueError(f"no official training annotations under {root / 'train/annos'}")
    rows = []
    for annotation in annotations:
        info = json.loads(annotation.read_text())
        pair_id = info.get("pair_id")
        if type(pair_id) is not int or pair_id <= 0 or info.get("source") not in {"shop", "user"}:
            raise ValueError(f"invalid pair_id/source: {annotation}")
        items = [v for k, v in info.items() if k.startswith("item")]
        if not items or any(
            type(v.get("category_id")) is not int or not 1 <= v["category_id"] <= 13 for v in items
        ):
            raise ValueError(f"invalid clothing categories: {annotation}")
        image = root / "train/image" / f"{annotation.stem}.jpg"
        relative = image.resolve().relative_to(data_root.resolve()).as_posix()
        contained_file(data_root, relative)
        rows.append(
            dict(
                path=relative,
                dataset="deepfashion2",
                group_id=f"train:{pair_id}",
                source_split="train",
                domain=info["source"],
                category_ids=";".join(str(v["category_id"]) for v in items),
                item_count=len(items),
                fabric_label="",
                review="pending",
                reviewer="",
            )
        )
    return rows


def merge_reviewed(
    base: list[Record],
    review_csv: Path,
    data_root: Path,
    classes: list[str],
) -> tuple[list[Record], dict]:
    """Add training examples, excluding entire groups with exact benchmark overlap.

    Provenance is recorded in source. Hashes must exist for every baseline row so
    missing benchmark metadata cannot silently disable the overlap check.
    """
    from PIL import Image

    if not classes or len(set(classes)) != len(classes):
        raise ValueError("class order must be nonempty and unique")
    for row in base:
        if row.split not in {"train", "val", "test"} or len(row.sha1) != 40:
            raise ValueError(f"invalid baseline split/hash: {row.path}")
        try:
            int(row.sha1, 16)
        except ValueError as exc:
            raise ValueError(f"invalid baseline hash: {row.path}") from exc
    with review_csv.open(newline="") as f:
        reader = csv.DictReader(f)
        required = {
            "path",
            "dataset",
            "group_id",
            "source_split",
            "fabric_label",
            "review",
            "reviewer",
        }
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"review CSV requires {sorted(required)}")
        reviews = list(reader)
    candidates, excluded = [], []
    held_hashes = {r.sha1 for r in base if r.split != "train"}
    held_paths = {r.path for r in base if r.split != "train"}
    blocked = set()
    for row in reviews:
        if row["review"] != "approved":
            excluded.append({"path": row["path"], "reason": "not_approved"})
        # Even unapproved siblings must block their product if they overlap eval.
        if not row["dataset"].strip() or not row["group_id"].strip():
            raise ValueError(f"missing dataset/product identity: {row['path']}")
        group = (row["dataset"], row["group_id"])
        image = contained_file(data_root, row["path"])
        digest = file_hash(image)
        if digest in held_hashes or row["path"] in held_paths or row["source_split"] != "train":
            blocked.add(group)
        if row["review"] != "approved":
            continue
        if row["source_split"] != "train":
            raise ValueError(f"external evaluation row cannot train: {row['path']}")
        if row["fabric_label"] not in classes or not row["reviewer"].strip():
            raise ValueError(f"approved row needs a known fabric label and reviewer: {row['path']}")
        with Image.open(image) as im:
            im.verify()
        candidates.append((row, digest, group))

    labels_by_hash = defaultdict(set)
    for record in base:
        labels_by_hash[record.sha1].add(record.label)
    for row, digest, _ in candidates:
        labels_by_hash[digest].add(row["fabric_label"])
    conflicting = {h for h, labels in labels_by_hash.items() if len(labels) > 1}
    if any(digest in conflicting and group not in blocked for _, digest, group in candidates):
        raise ValueError("conflicting fabric labels on identical image content; adjudicate first")

    seen_hashes = {r.sha1 for r in base}
    seen_paths = {r.path for r in base}
    additions = []
    for row, digest, group in candidates:
        reason = None
        if group in blocked:
            reason = "group_overlaps_benchmark"
        elif digest in seen_hashes or row["path"] in seen_paths:
            reason = "duplicate_training_image"
        if reason:
            excluded.append({"path": row["path"], "reason": reason})
            continue
        additions.append(
            Record(
                row["path"], row["fabric_label"], "train", f"external:{group[0]}:{group[1]}", digest
            )
        )
        seen_hashes.add(digest)
        seen_paths.add(row["path"])
    return base + additions, {
        "added": len(additions),
        "added_by_class": dict(Counter(r.label for r in additions)),
        "excluded": excluded,
        "review_sha1": file_hash(review_csv),
        "classes": classes,
        "near_duplicate_status": "not_measured; manual/product overlap review still required",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    index = sub.add_parser("index-deepfashion2")
    index.add_argument("--root", type=Path, required=True)
    merge = sub.add_parser("merge-reviewed")
    merge.add_argument("--base-split", type=Path, required=True)
    merge.add_argument("--review-csv", type=Path, required=True)
    merge.add_argument(
        "--head-json", type=Path, required=True, help="target head's exact class order"
    )
    for command in (index, merge):
        command.add_argument("--data-root", type=Path, default=Path("data"))
        command.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists() or args.out.with_suffix(".audit.json").exists():
        parser.error("output exists; choose a new experiment filename")
    if args.command == "index-deepfashion2":
        rows = index_deepfashion2(args.root, args.data_root)
        fields = REVIEW_FIELDS
        report = None
    else:
        classes = json.loads(args.head_json.read_text())["classes"]
        records, report = merge_reviewed(
            read_csv(args.base_split),
            args.review_csv,
            args.data_root,
            classes,
        )
        rows = [vars(r) for r in records]
        fields = tuple(Record.__dataclass_fields__)
        report["base_split_sha1"] = file_hash(args.base_split)
        report["head_json_sha1"] = file_hash(args.head_json)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    if report is not None:
        report["output_sha1"] = file_hash(args.out)
        with args.out.with_suffix(".audit.json").open("x") as f:
            f.write(json.dumps(report, indent=2) + "\n")
    print(f"wrote {len(rows)} rows to {args.out}")


if __name__ == "__main__":
    main()
