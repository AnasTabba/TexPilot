"""The frozen TextileNet split: official train/test, plus a validation carve-out.

TextileNet ships its own split -- the seed archives have ``train/`` and ``test/``
directories and the scrape manifests are ``*_train.json`` / ``*_test.json``. We keep
it, because it is the only way our test numbers mean anything next to the published
baselines. What we add:

* **val** -- a stratified 10% of train, for model selection and early stopping. The
  baselines selected their checkpoint on the test set; we never touch test until the end.
* **leak removal** -- a train image byte-identical to a test image is dropped from
  train, whatever its label. Test itself is never modified: the published numbers
  were computed on the test set as shipped, duplicates and multi-labelled images
  included, and changing it would make the comparison meaningless.

Stdlib only, so it is tested in CI without the ML stack.
"""

from __future__ import annotations

import csv
import random
from collections import defaultdict
from dataclasses import dataclass, fields, replace
from pathlib import Path

from services.vision.taxonomy import FABRIC_CLASSES, FIBRE_CLASSES

PARTITIONS: dict[str, tuple[str, ...]] = {"fabric": FABRIC_CLASSES, "fibre": FIBRE_CLASSES}


@dataclass(frozen=True, order=True)
class Record:
    path: str  # relative to the data root, posix separators
    label: str
    split: str  # official: "train" | "test"; after build_split also "val"
    source: str  # "archive" | "scraped"
    sha1: str


def class_index(partition: str) -> dict[str, int]:
    """Label -> index, in ImageFolder (alphabetical) order."""
    return {c: i for i, c in enumerate(sorted(PARTITIONS[partition]))}


def build_split(
    records: list[Record], partition: str, val_frac: float = 0.1, seed: int = 0
) -> tuple[list[Record], dict[str, int]]:
    """Official split + stratified val carve-out + train-side dedup. Order-independent."""
    classes = set(PARTITIONS[partition])
    for r in records:
        if r.label not in classes:
            raise ValueError(f"{r.label!r} is not a {partition} class ({r.path})")
        if r.split not in ("train", "test"):
            raise ValueError(f"official split must be train or test, got {r.split!r}")

    records = sorted(records)
    test = [r for r in records if r.split == "test"]
    test_hashes = {r.sha1 for r in test}

    stats = {"dropped_train_leaking_into_test": 0, "dropped_train_duplicates": 0}
    train: list[Record] = []
    seen: set[tuple[str, str]] = set()
    for r in records:
        if r.split != "train":
            continue
        if r.sha1 in test_hashes:
            stats["dropped_train_leaking_into_test"] += 1
        elif (r.sha1, r.label) in seen:
            stats["dropped_train_duplicates"] += 1
        else:
            seen.add((r.sha1, r.label))
            train.append(r)

    by_label: dict[str, list[Record]] = defaultdict(list)
    for r in train:
        by_label[r.label].append(r)

    out: list[Record] = []
    for label in sorted(by_label):
        members = by_label[label]
        random.Random(f"{seed}:{label}").shuffle(members)  # str seeds are stable across runs
        # Every class with >= 2 images gets at least one val and keeps at least one train.
        n_val = round(len(members) * val_frac)
        n_val = min(max(n_val, 1), len(members) - 1) if len(members) >= 2 else 0
        out += [replace(r, split="val") for r in members[:n_val]]
        out += members[n_val:]
    out += test

    stats.update({f"n_{s}": sum(r.split == s for r in out) for s in ("train", "val", "test")})
    return sorted(out, key=lambda r: (r.split, r.label, r.path)), stats


_FIELDS = [f.name for f in fields(Record)]


def write_csv(rows: list[Record], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(_FIELDS)
        w.writerows([getattr(r, k) for k in _FIELDS] for r in rows)


def read_csv(path: Path) -> list[Record]:
    with open(path, newline="") as f:
        return [Record(**row) for row in csv.DictReader(f)]
