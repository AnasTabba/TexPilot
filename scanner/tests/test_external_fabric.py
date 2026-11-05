import csv
import hashlib
import json

import pytest

from training.textilenet.external_fabric import index_deepfashion2, merge_reviewed
from training.textilenet.splits import Record

pytest.importorskip("PIL.Image")


def write_review(root, rows):
    path = root / "review.csv"
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return path


def candidate(root, **changes):
    from PIL import Image

    Image.new("RGB", (16, 16), "red").save(root / "external.jpg")
    row = dict(
        path="external.jpg",
        dataset="deepfashion2",
        group_id="train:7",
        source_split="train",
        fabric_label="denim",
        review="approved",
        reviewer="textile-expert",
    )
    return row | changes


def test_index_preserves_identity_and_does_not_invent_fabric_labels(tmp_path):
    (tmp_path / "train/annos").mkdir(parents=True)
    (tmp_path / "train/image").mkdir()
    row = candidate(tmp_path)
    (tmp_path / "train/image/000001.jpg").write_bytes((tmp_path / row["path"]).read_bytes())
    (tmp_path / "train/annos/000001.json").write_text(
        json.dumps(
            {
                "source": "shop",
                "pair_id": 7,
                "item1": {"category_id": 1, "style": 2, "bounding_box": [0, 0, 16, 16]},
            }
        )
    )
    rows = index_deepfashion2(tmp_path, tmp_path)
    assert rows[0]["group_id"] == "train:7"
    assert rows[0]["fabric_label"] == ""
    assert rows[0]["review"] == "pending"
    assert rows[0]["category_ids"] == "1"


def test_merge_keeps_benchmark_unchanged_and_adds_only_approved_training(tmp_path):
    row = candidate(tmp_path)
    base = [Record("held.jpg", "denim", "test", "archive", "a" * 40)]
    merged, report = merge_reviewed(base, write_review(tmp_path, [row]), tmp_path, ["denim"])
    assert merged[:1] == base
    assert merged[1].split == "train"
    assert merged[1].source == "external:deepfashion2:train:7"
    assert report["added_by_class"] == {"denim": 1}


@pytest.mark.parametrize(
    "changes",
    [
        {"source_split": "test"},
        {"source_split": "val"},
        {"fabric_label": "short sleeve top"},
        {"reviewer": ""},
        {"group_id": ""},
        {"path": "../outside.jpg"},
    ],
)
def test_invalid_approved_rows_fail_closed(tmp_path, changes):
    path = write_review(tmp_path, [candidate(tmp_path, **changes)])
    with pytest.raises(ValueError):
        merge_reviewed([], path, tmp_path, ["denim"])


def test_hash_overlap_excludes_whole_product_group(tmp_path):
    row = candidate(tmp_path)
    digest = hashlib.sha1((tmp_path / "external.jpg").read_bytes()).hexdigest()
    base = [Record("held.jpg", "denim", "val", "archive", digest)]
    merged, report = merge_reviewed(base, write_review(tmp_path, [row]), tmp_path, ["denim"])
    assert merged == base
    assert report["excluded"][0]["reason"] == "group_overlaps_benchmark"


def test_unapproved_overlap_also_blocks_approved_sibling(tmp_path):
    from PIL import Image

    row = candidate(tmp_path)
    digest = hashlib.sha1((tmp_path / "external.jpg").read_bytes()).hexdigest()
    Image.new("RGB", (16, 16), "blue").save(tmp_path / "sibling.jpg")
    sibling = row | {"path": "sibling.jpg"}
    pending = row | {"review": "pending", "reviewer": ""}
    base = [Record("held.jpg", "denim", "test", "archive", digest)]
    merged, report = merge_reviewed(
        base, write_review(tmp_path, [pending, sibling]), tmp_path, ["denim"]
    )
    assert merged == base
    assert report["excluded"][-1]["reason"] == "group_overlaps_benchmark"


def test_pending_model_suggestions_are_never_training_labels(tmp_path):
    row = candidate(tmp_path, review="pending", reviewer="", fabric_label="denim")
    merged, report = merge_reviewed([], write_review(tmp_path, [row]), tmp_path, ["denim"])
    assert merged == []
    assert report["excluded"][0]["reason"] == "not_approved"


def test_duplicate_content_with_conflicting_labels_is_rejected(tmp_path):
    row = candidate(tmp_path)
    second = row | {"group_id": "train:8", "fabric_label": "lace"}
    with pytest.raises(ValueError, match="conflicting"):
        merge_reviewed([], write_review(tmp_path, [row, second]), tmp_path, ["denim", "lace"])
