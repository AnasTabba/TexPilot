"""Nearest-patch memory: per class, how close a query's patch tokens sit to stored patches."""

import numpy as np

QUERY_CHUNK = 512  # 512 x 20000 float32 products are about 41 MB


def _unit(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)


class PatchMemory:
    def __init__(self) -> None:
        self.classes: list[str] = []
        self._banks: dict[str, np.ndarray] = {}

    def fit(
        self, tokens_by_class: dict[str, np.ndarray], per_class: int = 20000, seed: int = 2026
    ) -> None:
        rng = np.random.default_rng(seed)
        self.classes = sorted(tokens_by_class)
        self._banks = {}
        for c in self.classes:
            t = np.asarray(tokens_by_class[c])
            if len(t) > per_class:
                t = t[rng.choice(len(t), per_class, replace=False)]
            self._banks[c] = _unit(t)

    def scores(self, tokens: np.ndarray) -> np.ndarray:
        """Per class (in self.classes order): mean over query tokens of the nearest stored-patch
        cosine distance. Lower means closer."""
        q = _unit(tokens)
        out = np.empty(len(self.classes), dtype=np.float64)
        for i, c in enumerate(self.classes):
            bank = self._banks[c]
            nearest = np.empty(len(q), dtype=np.float32)
            for s in range(0, len(q), QUERY_CHUNK):
                sim = q[s : s + QUERY_CHUNK] @ bank.T
                nearest[s : s + QUERY_CHUNK] = 1.0 - sim.max(axis=1)
            out[i] = nearest.mean(dtype=np.float64)
        return out
