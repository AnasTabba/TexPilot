"""The frozen TextileNet split. Every reported number depends on it, so guard it.

Stdlib only -- runs in CI without the ML stack.
"""

import random

import pytest

from services.vision import taxonomy as tx
from training.textilenet.splits import Record, build_split, class_index


def _rec(name, label, split, sha1=None, source="archive"):
    return Record(
        path=f"fabric/{split}/{label}/{name}",
        label=label,
        split=split,
        source=source,
        sha1=sha1 or f"{split}-{label}-{name}",
    )


def _corpus(n_train=200, n_test=50, labels=("denim", "lace", "vinyl")):
    recs = []
    for lab in labels:
        recs += [_rec(f"tr{i}.jpg", lab, "train") for i in range(n_train)]
        recs += [_rec(f"te{i}.jpg", lab, "test") for i in range(n_test)]
    return recs


def test_class_index_is_imagefolder_order():
    # ImageFolder sorts class dirs alphabetically; baselines and checkpoints rely on it.
    assert list(tx.FABRIC_CLASSES) == sorted(tx.FABRIC_CLASSES)
    assert list(tx.FIBRE_CLASSES) == sorted(tx.FIBRE_CLASSES)
    assert class_index("fabric")["canvas"] == 0
    assert class_index("fibre")["yak"] == 32


def test_val_is_ten_percent_of_train_in_every_class():
    rows, _ = build_split(_corpus(), partition="fabric", val_frac=0.1, seed=0)
    for lab in ("denim", "lace", "vinyl"):
        val = sum(r.split == "val" and r.label == lab for r in rows)
        train = sum(r.split == "train" and r.label == lab for r in rows)
        assert (val, train) == (20, 180)


def test_split_ignores_input_order():
    recs = _corpus()
    shuffled = recs[:]
    random.Random(1).shuffle(shuffled)
    a, _ = build_split(recs, partition="fabric", val_frac=0.1, seed=0)
    b, _ = build_split(shuffled, partition="fabric", val_frac=0.1, seed=0)
    assert a == b


def test_seed_changes_val_membership():
    a, _ = build_split(_corpus(), partition="fabric", val_frac=0.1, seed=0)
    b, _ = build_split(_corpus(), partition="fabric", val_frac=0.1, seed=1)
    assert {r.path for r in a if r.split == "val"} != {r.path for r in b if r.split == "val"}


def test_official_test_set_is_never_touched():
    recs = _corpus()
    # A test image duplicated inside test, and one carrying two labels: both stay,
    # because the published numbers were computed on the test set as shipped.
    recs.append(_rec("dup.jpg", "lace", "test", sha1="test-lace-te0.jpg"))
    recs.append(_rec("multi.jpg", "denim", "test", sha1="test-lace-te1.jpg"))
    rows, _ = build_split(recs, partition="fabric", val_frac=0.1, seed=0)
    assert sorted(r.path for r in rows if r.split == "test") == sorted(
        r.path for r in recs if r.split == "test"
    )


def test_train_copies_of_test_images_are_dropped():
    recs = _corpus()
    leak = _rec("leak.jpg", "denim", "train", sha1="test-lace-te3.jpg")  # label need not match
    rows, stats = build_split([*recs, leak], partition="fabric", val_frac=0.1, seed=0)
    assert leak.path not in {r.path for r in rows}
    assert stats["dropped_train_leaking_into_test"] == 1
    test_hashes = {r.sha1 for r in rows if r.split == "test"}
    assert not any(r.sha1 in test_hashes for r in rows if r.split != "test")


def test_exact_duplicates_within_train_keep_one():
    recs = _corpus()
    recs.append(_rec("copy_of_tr0.jpg", "denim", "train", sha1="train-denim-tr0.jpg"))
    rows, stats = build_split(recs, partition="fabric", val_frac=0.1, seed=0)
    kept = [r for r in rows if r.sha1 == "train-denim-tr0.jpg"]
    assert len(kept) == 1
    assert stats["dropped_train_duplicates"] == 1


def test_tiny_classes_keep_at_least_one_train_image():
    recs = [_rec("only.jpg", "vinyl", "train"), *_corpus(labels=("denim",))]
    recs += [_rec("a.jpg", "plush", "train"), _rec("b.jpg", "plush", "train")]
    rows, _ = build_split(recs, partition="fabric", val_frac=0.1, seed=0)
    assert [r.split for r in rows if r.label == "vinyl"] == ["train"]
    assert sorted(r.split for r in rows if r.label == "plush") == ["train", "val"]


def test_unknown_label_is_rejected():
    with pytest.raises(ValueError, match="not a fabric class"):
        build_split([_rec("x.jpg", "polyester", "train")], partition="fabric")
