"""Load fabric images as RGB uint8, cut them into overlapping tiles, and stitch tile maps back.

Boxes are (x0, y0, x1, y1) in pixels of the full image, x along the width, y along the height.
"""

import cv2
import numpy as np
from PIL import Image


def load_rgb(path: str) -> np.ndarray:
    """Return H x W x 3 uint8. Grayscale, palette, LA and RGBA are converted; 16-bit grayscale is
    scaled by 257 (65535 -> 255) without clipping. Alpha is dropped, not composited."""
    img = Image.open(path)
    if img.mode.startswith("I;16") or img.mode == "I":
        arr = np.asarray(img, dtype=np.float64) / 257.0
        return np.round(arr).clip(0, 255).astype(np.uint8)[..., None].repeat(3, axis=2)
    return np.asarray(img.convert("RGB"), dtype=np.uint8)


def _starts(length: int, size: int, stride: int) -> list[tuple[int, int]]:
    if length <= size:
        return [(0, length)]
    starts = list(range(0, length - size + 1, stride))
    if starts[-1] + size < length:
        starts.append(length - size)
    return [(s, s + size) for s in starts]


def tile_boxes(
    h: int, w: int, size: int = 392, overlap: float = 0.25
) -> list[tuple[int, int, int, int]]:
    """Boxes (x0, y0, x1, y1) that cover the whole h x w image, row by row. Every box lies inside
    the image; the last tile of a row or column is shifted back to end at the edge. A dimension
    smaller than `size` gets one tile spanning it."""
    stride = int(round(size * (1 - overlap)))
    xs = _starts(w, size, stride)
    ys = _starts(h, size, stride)
    return [(x0, y0, x1, y1) for y0, y1 in ys for x0, x1 in xs]


def stitch(maps: list[np.ndarray], boxes, h: int, w: int) -> np.ndarray:
    """Paste each tile map (resized to its box) into an h x w float32 canvas, keeping the per-pixel
    max where tiles overlap. Raises ValueError if any pixel is covered by no tile."""
    out = np.full((h, w), -np.inf, np.float32)
    covered = np.zeros((h, w), bool)
    for m, (x0, y0, x1, y1) in zip(maps, boxes, strict=True):
        resized = cv2.resize(
            np.asarray(m, np.float32), (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR
        )
        region = out[y0:y1, x0:x1]
        np.maximum(region, resized, out=region)
        covered[y0:y1, x0:x1] = True
    if not covered.all():
        raise ValueError("tiles do not cover the image")
    return out
