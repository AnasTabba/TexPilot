"""Frozen-backbone features, cached per image rather than per split.

Extracting DINOv2 features for ~150k images takes an hour or more on a laptop GPU.
Keying the cache by image path means a split that grows (say, once the manifest
scrape finishes) only costs the new images. Shards are written atomically, so an
interrupted extraction resumes at the last finished shard.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np


class FeatureCache:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._index: dict[str, tuple[int, int]] = {}  # path -> (shard, row)
        self._shards: dict[int, np.ndarray] = {}
        for paths_file in sorted(self.root.glob("shard_*.paths.txt")):
            k = int(paths_file.name.split("_")[1].split(".")[0])
            if not (self.root / f"shard_{k:05d}.npy").exists():
                continue  # half-written shard from an interrupted run
            for row, path in enumerate(paths_file.read_text().splitlines()):
                self._index[path] = (k, row)

    def missing(self, paths: list[str]) -> list[str]:
        """Paths with no cached feature, in request order."""
        return [p for p in paths if p not in self._index]

    def add(self, paths: list[str], feats: np.ndarray) -> None:
        if len(paths) != len(feats):
            raise ValueError(f"{len(paths)} paths but {len(feats)} feature rows")
        k = 1 + max((s for s, _ in self._index.values()), default=-1)
        tmp = self.root / f"shard_{k:05d}.tmp.npy"
        np.save(tmp, feats.astype(np.float16))
        (self.root / f"shard_{k:05d}.paths.txt").write_text("\n".join(paths))
        tmp.rename(self.root / f"shard_{k:05d}.npy")  # the .npy appearing marks it done
        for row, path in enumerate(paths):
            self._index[path] = (k, row)

    def assemble(self, paths: list[str]) -> np.ndarray:
        """Features for ``paths`` in that order. KeyError names any uncached path."""
        unknown = self.missing(paths)
        if unknown:
            raise KeyError(f"{len(unknown)} paths not cached, e.g. {unknown[0]}")
        rows = [self._index[p] for p in paths]
        for k in {s for s, _ in rows}:
            if k not in self._shards:
                self._shards[k] = np.load(self.root / f"shard_{k:05d}.npy")
        return np.stack([self._shards[k][r] for k, r in rows])
