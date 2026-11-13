"""Crops and patch pooling for the look-alike fabric texture head."""

import numpy as np
import torch
from PIL import Image

GEM_P = 3.0


def crops(img: np.ndarray, n: int = 5, size: int = 392) -> list[np.ndarray]:
    """Centre crop, then the four corners, each size x size at native scale.
    An image smaller than size in either dimension is resized up so its short side is size."""
    h, w = img.shape[:2]
    if min(h, w) < size:
        s = size / min(h, w)
        img = np.asarray(Image.fromarray(img).resize((round(w * s), round(h * s)), Image.BILINEAR))
        h, w = img.shape[:2]
    corners = [
        ((h - size) // 2, (w - size) // 2),
        (0, 0),
        (0, w - size),
        (h - size, 0),
        (h - size, w - size),
    ]
    return [img[y : y + size, x : x + size] for y, x in corners][:n]


def pool_tokens(tokens: torch.Tensor) -> torch.Tensor:
    """(batch, patches, dim) or (patches, dim) -> (batch, 3*dim) or (3*dim,).
    Concatenates mean, max and GeM (p=3) over the patch axis."""
    mean = tokens.mean(dim=-2)
    mx = tokens.amax(dim=-2)
    gem = tokens.clamp(min=1e-6).pow(GEM_P).mean(dim=-2).pow(1.0 / GEM_P)
    return torch.cat([mean, mx, gem], dim=-1)
