"""Official DeepFashion2 item and cross-domain pair manifests, without fabric labels.

Build locally from licensed archives. Product IDs are scoped to official splits;
positive pairs additionally require matching nonzero style and garment category.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Item:
    path: str
    item_id: str
    split: str
    source: str
    pair_id: int
    style: int
    category_id: int
    bbox: tuple[int, int, int, int]

    @property
    def group_id(self) -> str:
        return f"deepfashion2:{self.split}:{self.pair_id}"

    @property
    def identity(self) -> tuple:
        return self.split, self.pair_id, self.style, self.category_id


def read_items(root: Path, split: str) -> Iterator[Item]:
    if split not in {"train", "validation"}:
        raise ValueError("only official train/validation have item annotations")
    annotations = sorted((root / split / "annos").glob("*.json"))
    if not annotations:
        raise ValueError(f"no annotations in {root / split / 'annos'}")
    for path in annotations:
        image = Path(split) / "image" / f"{path.stem}.jpg"
        if not (root / image).is_file():
            raise ValueError(f"missing image: {image}")
        info = json.loads(path.read_text())
        source, pair_id = info.get("source"), info.get("pair_id")
        if source not in {"shop", "user"} or type(pair_id) is not int or pair_id < 0:
            raise ValueError(f"invalid source/pair_id in {path}")
        items = [(k, v) for k, v in info.items() if k.startswith("item")]
        if not items:
            raise ValueError(f"no clothing items in {path}")
        for item_id, item in sorted(items):
            category, style = item.get("category_id"), item.get("style")
            box = item.get("bounding_box")
            if (
                type(category) is not int
                or not 1 <= category <= 13
                or type(style) is not int
                or style < 0
                or not isinstance(box, list)
                or len(box) != 4
                or any(type(x) is not int for x in box)
                or (
                    (box[0] >= box[2] or box[1] >= box[3])
                    and not (style == 0 and box == [0, 0, 0, 0])
                )
            ):
                raise ValueError(f"invalid item {item_id} in {path}")
            yield Item(
                image.as_posix(), item_id, split, source, pair_id, style, category, tuple(box)
            )


def positive_pairs(items: list[Item]) -> Iterator[tuple[Item, Item]]:
    groups = defaultdict(lambda: {"shop": [], "user": []})
    for item in items:
        if item.style > 0 and item.pair_id > 0:
            groups[item.identity][item.source].append(item)
    for identity in sorted(groups):
        group = groups[identity]
        for shop in group["shop"]:
            for user in group["user"]:
                if shop.path != user.path:
                    yield shop, user


def build_manifests(root: Path, out: Path, data_root: Path = Path("data")) -> dict:
    review_prefix = root.resolve().relative_to(data_root.resolve())
    if out.exists():
        raise ValueError(f"output exists; use a new experiment directory: {out}")
    out.mkdir(parents=True)
    report = {
        "root": str(root.resolve()),
        "fabric_labels": "not_supplied",
        "test_usage": "inventory_only; no test training or model selection",
        "product_ids": "split scoped; styles/categories share one product group",
        "near_duplicate_status": "not_measured",
    }
    for split in ("train", "validation"):
        items = list(read_items(root, split))
        fields = list(Item.__dataclass_fields__) + ["group_id"]
        with (out / f"{split}_items.csv").open("x", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for item in items:
                row = asdict(item) | {"group_id": item.group_id}
                row["bbox"] = json.dumps(row["bbox"])
                writer.writerow(row)
        pair_count, paired_groups = 0, set()
        # A small deterministic review batch covers categories and both domains.
        # These are review candidates, never synthetic fabric ground truth.
        review, per_category, seen_photos = [], Counter(), set()
        with (out / f"{split}_pairs.csv").open("x", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "group_id",
                    "style",
                    "category_id",
                    "shop_path",
                    "shop_item",
                    "shop_bbox",
                    "user_path",
                    "user_item",
                    "user_bbox",
                ]
            )
            for shop, user in positive_pairs(items):
                writer.writerow(
                    [
                        shop.group_id,
                        shop.style,
                        shop.category_id,
                        shop.path,
                        shop.item_id,
                        json.dumps(shop.bbox),
                        user.path,
                        user.item_id,
                        json.dumps(user.bbox),
                    ]
                )
                pair_count += 1
                paired_groups.add(shop.group_id)
                if (
                    split == "train"
                    and per_category[shop.category_id] < 10
                    and shop.path not in seen_photos
                    and user.path not in seen_photos
                ):
                    per_category[shop.category_id] += 1
                    seen_photos.update((shop.path, user.path))
                    for item in (shop, user):
                        review.append(
                            {
                                "path": (review_prefix / item.path).as_posix(),
                                "dataset": "deepfashion2",
                                "group_id": item.group_id,
                                "source_split": split,
                                "domain": item.source,
                                "category_id": item.category_id,
                                "fabric_label": "",
                                "review": "pending",
                                "reviewer": "",
                            }
                        )
        if review:
            with (out / "pilot_review.csv").open("x", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=list(review[0]))
                writer.writeheader()
                writer.writerows(review)
        report[split] = {
            "images": len({i.path for i in items}),
            "items": len(items),
            "products": len({i.group_id for i in items}),
            "images_by_source": dict(Counter({i.path: i.source for i in items}.values())),
            "items_by_category": dict(sorted(Counter(i.category_id for i in items).items())),
            "unknown_style_items": sum(i.style == 0 for i in items),
            "positive_pairs": pair_count,
            "paired_products": len(paired_groups),
        }
        print(split, report[split], flush=True)
    report["test"] = {"images": sum(1 for _ in (root / "test/image").glob("*.jpg"))}
    (out / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build_manifests(args.root, args.out, args.data_root)


if __name__ == "__main__":
    main()
