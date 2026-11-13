"""MuSc (xrli-U/MuSc, MIT, zero-shot) behind the bench `Method` protocol.

Transductive: MuSc scores unlabeled test tiles against each other, so `score_tiles` must get all
tiles of a category in one call (bench.py checks the `transductive` attribute). The repo is never
imported at module level: legacy absolute imports are scoped to its checkout.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from ._upstream import upstream_repo

BACKBONE = "ViT-L-14-336"
PRETRAINED = "openai"
FEATURE_LAYERS = [6, 12, 18, 24]  # repo feature_layers [5, 11, 17, 23] + 1
R_LIST = [1, 3, 5]  # LNAMD aggregation degrees (repo configs/musc.yaml r_list)
TOPMIN_MAX = 0.3  # MSM topmin_max (repo make_category_data)
MIN_TILES = 8  # mutual scoring needs a reference set; also the minimum last chunk size


def _chunk_bounds(n: int, chunk: int) -> list[tuple[int, int]]:
    """(start, stop) ranges of at most `chunk` tiles. A last range under MIN_TILES is merged into
    the previous one, so that one can be up to chunk + MIN_TILES - 1 tiles long."""
    bounds = [(s, min(s + chunk, n)) for s in range(0, n, chunk)]
    if len(bounds) > 1 and bounds[-1][1] - bounds[-1][0] < MIN_TILES:
        bounds[-2:] = [(bounds[-2][0], n)]
    return bounds


class MuSc:
    """Zero-shot MuSc anomaly maps (patch-level mutual scoring, one 392x392 map per tile).

    Differences from the repo's make_category_data (configs/musc.yaml, models/musc.py):
    - RsCIN is not applied. The image score is the max of the stitched map, not the class-token
      re-scoring of the repo.
    - img_size 392 (28x28 patches) instead of the repo config's 518. open_clip resizes the OpenAI
      positional embedding from 336 to 392.
    - Tiles are scored in chunks of at most `chunk` (mutual scoring only inside a chunk).
    - No dataset loader: tiles are resized to img_size and normalised with the open_clip
      OpenAI mean/std.
    - Patch features are extracted in batches of `batch_size`, autocast on CUDA only.
    """

    name = "musc"
    transductive = True

    def __init__(
        self,
        repo_dir: str,
        img_size: int = 392,
        chunk: int = 200,
        batch_size: int = 4,
        device: str | None = None,
        seed: int = 42,
    ) -> None:
        if chunk < MIN_TILES:
            raise ValueError(f"chunk must be at least {MIN_TILES}, got {chunk}")
        if batch_size < 1:
            raise ValueError("batch_size must be positive")
        if img_size < 14 or img_size % 14:
            raise ValueError("img_size must be a positive multiple of the backbone patch size 14")
        self.repo_dir = str(Path(repo_dir).resolve())
        self.img_size = img_size
        self.chunk = chunk
        self.batch_size = batch_size
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.seed = seed
        self._model = None

    def fit(self, train: list[np.ndarray]) -> None:
        """Zero-shot: nothing is learned or stored. `train` is ignored."""

    def _amp(self):
        """Autocast on CUDA only, as the repo does for extraction and LNAMD."""
        return torch.autocast(self.device.type, enabled=self.device.type == "cuda")

    def _backbone(self):
        with upstream_repo(self.repo_dir):
            if self._model is None:
                import models.backbone.open_clip as open_clip
                from models.backbone.open_clip.constants import (
                    OPENAI_DATASET_MEAN,
                    OPENAI_DATASET_STD,
                )

                torch.manual_seed(self.seed)
                model, _, _ = open_clip.create_model_and_transforms(
                    BACKBONE, self.img_size, pretrained=PRETRAINED
                )
                self._model = model.to(self.device).eval()
                self._mean = torch.tensor(OPENAI_DATASET_MEAN, device=self.device).view(1, 3, 1, 1)
                self._std = torch.tensor(OPENAI_DATASET_STD, device=self.device).view(1, 3, 1, 1)
            return self._model

    @torch.no_grad()
    def _extract(self, tiles: np.ndarray) -> list[torch.Tensor]:
        """Patch tokens (CLS included) of the feature layers: one (N, 1+P, C) CPU tensor each."""
        model = self._backbone()
        per_layer: list[list[torch.Tensor]] = [[] for _ in FEATURE_LAYERS]
        for s in range(0, len(tiles), self.batch_size):
            x = torch.from_numpy(tiles[s : s + self.batch_size]).to(self.device)
            x = x.permute(0, 3, 1, 2).float().div(255.0)
            if x.shape[-2:] != (self.img_size, self.img_size):
                x = F.interpolate(
                    x,
                    size=(self.img_size, self.img_size),
                    mode="bicubic",
                    align_corners=False,
                    antialias=True,
                )
            x = (x - self._mean) / self._std
            with upstream_repo(self.repo_dir), self._amp():
                _, tokens = model.encode_image(x, FEATURE_LAYERS)
            for layer, t in enumerate(tokens):
                per_layer[layer].append(t.float().cpu())
        return [torch.cat(p) for p in per_layer]

    def _score_chunk(self, tiles: np.ndarray) -> np.ndarray:
        """Mutual scoring of one chunk: (N, 392, 392, 3) uint8 -> (N, 392, 392) float32."""
        with upstream_repo(self.repo_dir):
            from models.modules._LNAMD import LNAMD
            from models.modules._MSM import MSM

            feats = self._extract(tiles)  # one (N, 1+P, C) tensor per layer
            n, dim = feats[0].shape[0], feats[0].shape[-1]
            maps_r = []
            for r in R_LIST:
                lnamd = LNAMD(
                    device=self.device, r=r, feature_dim=dim, feature_layer=FEATURE_LAYERS
                )
                z_layers: list[list[torch.Tensor]] = [[] for _ in FEATURE_LAYERS]
                for s in range(0, n, self.batch_size):
                    patch = [f[s : s + self.batch_size].to(self.device) for f in feats]
                    with torch.no_grad(), self._amp():
                        emb = lnamd._embed(patch)  # (B, P, layers, C) on CPU
                        emb = F.normalize(emb, dim=-1)
                    for layer in range(len(FEATURE_LAYERS)):
                        z_layers[layer].append(emb[:, :, layer, :])
                layer_maps = []
                for layer in range(len(FEATURE_LAYERS)):
                    z = torch.cat(z_layers[layer]).to(self.device)  # (N, P, C)
                    scores = MSM(Z=z, device=self.device, topmin_min=0, topmin_max=TOPMIN_MAX)
                    layer_maps.append(scores.cpu())
                    del z
                    torch.cuda.empty_cache()
                maps_r.append(torch.stack(layer_maps).mean(0))
            del feats
            m = torch.stack(maps_r).mean(0).float()  # (N, P)
            side = int(math.sqrt(m.shape[1]))
            out = F.interpolate(
                m.view(n, 1, side, side), size=self.img_size, mode="bilinear", align_corners=True
            )
            torch.cuda.empty_cache()
            if self.img_size != 392:
                out = F.interpolate(out, size=(392, 392), mode="bilinear", align_corners=False)
            return out[:, 0].numpy().astype(np.float32)

    def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:
        """One float32 map per tile, in input order. All tiles must come from one category call."""
        n = len(tiles)
        if n < MIN_TILES:
            raise ValueError(
                f"MuSc scores tiles against each other and needs at least {MIN_TILES} tiles "
                f"in one call, got {n}"
            )
        if any(t.shape != (392, 392, 3) or t.dtype != np.uint8 for t in tiles):
            raise ValueError("expected 392x392x3 uint8 RGB tiles")
        arr = np.stack(tiles)
        out: list[np.ndarray] = []
        for s, e in _chunk_bounds(n, self.chunk):
            out.extend(self._score_chunk(arr[s:e]))
        return out
