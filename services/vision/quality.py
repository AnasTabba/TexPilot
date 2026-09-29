"""Capture quality of the garment photo, kept with every scan (parent spec §9).

Raw numbers and plain rules for now. The cut-offs that should make the app ask for a
retake come from the phone set (spec §8), not from a guess here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

BLUR_WIDTH = 512  # sharpness is measured at one width, so any phone resolution compares
DARK, BRIGHT = 60, 200  # mean luminance, 0-255
CLIPPED = 0.05  # share of pixels crushed to black or blown to white
# ponytail: fixed framing rules; tune on the phone set with the bake-off records
MIN_AREA = 0.15  # the garment box's share of the frame
EDGE = 0.01  # a box side this close to the frame edge touches it


def capture_quality(image: np.ndarray, box: tuple | None) -> dict:
    """image: RGB uint8; box: the garment's normalised (x0, y0, x1, y1), or None.
    Sharpness and exposure are measured on the garment when there is one: a white wall or
    studio backdrop says nothing about how well the fabric itself was captured."""
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    if box is not None:
        H, W = gray.shape
        x0, y0, x1, y1 = (round(v * s) for v, s in zip(box, (W, H, W, H), strict=True))
        if x1 - x0 >= 8 and y1 - y0 >= 8:
            gray = gray[y0:y1, x0:x1]
    h, w = gray.shape
    small = gray
    if w > BLUR_WIDTH:
        small = cv2.resize(gray, (BLUR_WIDTH, round(h * BLUR_WIDTH / w)), cv2.INTER_AREA)
    blur = float(cv2.Laplacian(small, cv2.CV_64F).var())
    mean = float(gray.mean())
    if (gray >= 250).mean() > CLIPPED or mean > BRIGHT:
        exposure = "over"
    elif (gray <= 5).mean() > CLIPPED or mean < DARK:
        exposure = "under"
    else:
        exposure = "ok"
    return {"blur": round(blur, 1), "exposure": exposure, "framing": _framing(box)}


def _framing(box: tuple | None) -> str | None:
    if box is None:
        return None
    x0, y0, x1, y1 = box
    if (x1 - x0) * (y1 - y0) < MIN_AREA:
        return "too_small"
    touching = sum((x0 <= EDGE, y0 <= EDGE, x1 >= 1 - EDGE, y1 >= 1 - EDGE))
    return "cut_off" if touching >= 2 else "ok"
