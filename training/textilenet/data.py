"""Loading TextileNet images from the frozen split. No timm or albumentations import.

The transform is injected (albumentations in train.py), so this module is testable
with torch + PIL alone.
"""

from __future__ import annotations

import random
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFile
from torch.utils.data import Dataset

from training.textilenet.splits import Record, read_csv

ImageFile.LOAD_TRUNCATED_IMAGES = True  # some TextileNet JPEGs are cut short


class TextileDataset(Dataset):
    """(transformed image, class index) for split rows. ``transform(image=HWC uint8)``."""

    def __init__(
        self,
        rows: list[Record],
        data_root: Path,
        labels: dict[str, int],
        transform: Callable,
        decode_size: int,
    ):
        self.paths = [str(data_root / r.path) for r in rows]
        self.targets = [labels[r.label] for r in rows]
        self.transform = transform
        self.decode_size = decode_size

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, i: int):
        return self.transform(image=self.load(i))["image"], self.targets[i]

    def load(self, i: int) -> np.ndarray:
        with Image.open(self.paths[i]) as im:
            # JPEG draft decodes at 1/2..1/8 scale when the file is far larger than we
            # need; the result is never smaller than decode_size on either side.
            im.draft("RGB", (self.decode_size, self.decode_size))
            return np.asarray(im.convert("RGB"))


def seed_worker(_: int) -> None:
    """DataLoader worker_init_fn: seed numpy, random and the albumentations RNG."""
    seed = torch.initial_seed() % 2**32
    np.random.seed(seed)
    random.seed(seed)
    info = torch.utils.data.get_worker_info()
    tf = getattr(info.dataset, "transform", None)
    if hasattr(tf, "set_random_seed"):  # albumentations >= 2 keeps its own RNG
        tf.set_random_seed(seed)


def load_rows(
    split_csv: Path, data_root: Path, limit_per_class: int = 0
) -> dict[str, list[Record]]:
    """Split rows by split name, dropping (and announcing) rows missing on disk."""
    rows = read_csv(split_csv)
    missing = [r for r in rows if not (data_root / r.path).exists()]
    if missing:
        by_split = dict(Counter(r.split for r in missing))
        print(
            f"WARNING: {len(missing)} split rows missing on disk, dropped: {by_split}. "
            "Test-set size now differs from the frozen split; results.md records it."
        )
        gone = {r.path for r in missing}
        rows = [r for r in rows if r.path not in gone]
    out = {s: [r for r in rows if r.split == s] for s in ("train", "val", "test")}
    if limit_per_class:  # smoke tests / quick local runs only
        for split, rs in out.items():
            kept, per_label = [], Counter()
            for r in rs:
                per_label[r.label] += 1
                if per_label[r.label] <= limit_per_class:
                    kept.append(r)
            out[split] = kept
    return out
