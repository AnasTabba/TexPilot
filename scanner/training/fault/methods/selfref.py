"""Zero-shot self-reference fault scoring.

Woven and knit fabric repeats a texture, so a defect is a patch that does not look like the
other patches of the same photo. Each patch is scored by how far it is from its most similar
patches elsewhere in the tile, using frozen DINOv2 tokens. Nothing is trained on the fabric.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

TILE = 392
GRID = 28  # 392 / 14 patches per side
ENCODER = "vit_base_patch14_reg4_dinov2.lvd142m"
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def self_reference_map(tokens, grid=GRID, k=5, radius=3, normalize=True):
    """tokens: torch.Tensor (L, P, D) = L layers of P=grid*grid patch tokens for ONE tile.
    Returns torch.Tensor (grid, grid) float32: higher = more unlike the rest of the tile."""
    L, P, _ = tokens.shape
    if grid * grid != P:
        raise ValueError(f"expected {grid * grid} patch tokens, got {P}")

    idx = torch.arange(P, device=tokens.device)
    rows, cols = idx // grid, idx % grid
    cheb = torch.maximum((rows[:, None] - rows[None]).abs(), (cols[:, None] - cols[None]).abs())
    excluded = cheb <= radius  # includes the patch itself
    if int((~excluded).sum(1).min()) < k:
        raise ValueError(f"radius {radius} leaves fewer than k={k} candidates for some patch")

    d = torch.zeros(P, dtype=torch.float32, device=tokens.device)
    for layer in range(L):
        f = F.normalize(tokens[layer].float(), dim=-1)
        sim = (f @ f.T).masked_fill(excluded, float("-inf"))
        d += (1.0 - sim.topk(k, dim=1).values.mean(1)) / L

    if normalize:
        med = d.median()
        mad = (d - med).abs().median()
        d = (d - med) / (1.4826 * mad + 1e-6)
    return d.reshape(grid, grid).float()


class SelfReference:
    name = "selfref_vitb"

    def __init__(
        self,
        encoder_file=None,
        device=None,
        layers=(5, 8, 11),
        k=5,
        radius=3,
        normalize=True,
        batch_size=16,
    ):
        self.encoder_file = None if encoder_file is None else Path(encoder_file)
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        self.device = torch.device(device)
        self.layers = tuple(layers)
        self.k = k
        self.radius = radius
        self.normalize = normalize
        self.batch_size = batch_size
        self._model = None

    def fit(self, train):
        """Zero-shot: nothing is learned from the fabric."""
        return None

    def _build(self):
        import timm

        kwargs = {"pretrained": True, "num_classes": 0, "img_size": TILE}
        if self.encoder_file is not None:
            kwargs["pretrained_cfg_overlay"] = {"file": str(self.encoder_file)}
        model = timm.create_model(ENCODER, **kwargs).to(self.device).eval()
        if self.device.type == "cuda":
            model = model.half()
        return model

    def _tokens(self, x):
        """x: (B, 3, TILE, TILE) normalised tensor -> (B, L, P, D) patch tokens, float."""
        if self._model is None:
            self._model = self._build()
        if self.device.type == "cuda":
            x = x.half()
        with torch.no_grad():
            feats = self._model.forward_intermediates(
                x,
                indices=list(self.layers),
                norm=False,
                output_fmt="NLC",
                intermediates_only=True,
            )
        return torch.stack([f.float() for f in feats], dim=1)

    def score_tiles(self, tiles):
        for t in tiles:
            if t.shape != (TILE, TILE, 3):
                raise ValueError(f"SelfReference expects {TILE}x{TILE}x3 tiles")
        if not tiles:
            return []
        mean = torch.tensor(IMAGENET_MEAN, device=self.device).view(1, 3, 1, 1)
        std = torch.tensor(IMAGENET_STD, device=self.device).view(1, 3, 1, 1)
        out: list[np.ndarray] = []
        for start in range(0, len(tiles), self.batch_size):
            batch = tiles[start : start + self.batch_size]
            x = torch.from_numpy(np.stack(batch)).to(self.device)
            x = x.permute(0, 3, 1, 2).float().div_(255.0)
            x = (x - mean) / std
            tokens = self._tokens(x)
            for tok in tokens:
                m = self_reference_map(tok, k=self.k, radius=self.radius, normalize=self.normalize)
                up = F.interpolate(
                    m[None, None], size=(TILE, TILE), mode="bilinear", align_corners=False
                )
                out.append(up[0, 0].float().cpu().numpy())
        return out
