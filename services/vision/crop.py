"""Classifier views from a garment mask. Spec §4.6.

The masked crop mimics TextileNet's white-background product photos, which is what the
heads were trained on. Texture patches are close-ups from well inside the garment.
"""

from __future__ import annotations

import numpy as np

WHITE = 255


def masked_crop(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        raise ValueError("empty mask")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = image[y0:y1, x0:x1].copy()
    crop[~mask[y0:y1, x0:x1]] = WHITE
    h, w = crop.shape[:2]
    side = max(h, w)
    out = np.full((side, side, 3), WHITE, dtype=image.dtype)
    oy, ox = (side - h) // 2, (side - w) // 2
    out[oy : oy + h, ox : ox + w] = crop
    return out


def patch_boxes(
    mask: np.ndarray, n: int = 3, side_frac: float = 0.25, erode_frac: float = 0.05
) -> list[tuple[int, int, int]]:
    """Up to ``n`` non-overlapping squares (y0, x0, side) wholly inside the mask eroded by
    ``erode_frac`` of the garment's short side. Deepest positions are taken first."""
    from scipy import ndimage

    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return []
    short = min(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1)
    side, margin = int(side_frac * short), int(erode_frac * short)
    if side < 8:
        return []
    # Chessboard distance to the nearest non-garment pixel (the image border counts as
    # outside). A square of half-side r centred on p fits iff that distance > r.
    dist = ndimage.distance_transform_cdt(np.pad(mask, 1), metric="chessboard")[1:-1, 1:-1]
    free = dist >= side // 2 + margin + 1
    boxes: list[tuple[int, int, int]] = []
    while len(boxes) < n and free.any():
        cy, cx = np.unravel_index(np.argmax(np.where(free, dist, -1)), dist.shape)
        boxes.append((int(cy) - side // 2, int(cx) - side // 2, side))
        free[max(0, cy - side) : cy + side + 1, max(0, cx - side) : cx + side + 1] = False
    return boxes


def texture_patches(
    image: np.ndarray,
    mask: np.ndarray,
    n: int = 3,
    side_frac: float = 0.25,
    erode_frac: float = 0.05,
) -> list[np.ndarray]:
    return [
        image[y0 : y0 + s, x0 : x0 + s].copy()
        for y0, x0, s in patch_boxes(mask, n, side_frac, erode_frac)
    ]


class FabricCropper:
    def __init__(self, patches: bool = False):
        self.patches = patches

    def views(self, image: np.ndarray, mask: np.ndarray) -> list[np.ndarray]:
        views = [masked_crop(image, mask)]
        if self.patches:
            views += texture_patches(image, mask)
        return views
