"""The printed TexPilot card: a phone photo becomes a measurable scan.

A phone photo has no fixed scale and is taken at an angle. Laid flat on the fabric, the
card's ArUco marker (printed MARKER_MM wide) gives both: its four corners fix the plane, so
the photo is rectified to a straight-down view at a known pixels-per-inch, and the threads
can then be counted as on a flatbed scan (services/vision/threads.py).

The rectified view keeps the photo's own orientation, not the card's: the card may lie at any
angle, the phone is held along the selvedge as a scan is placed on the glass.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MARKER_MM = 30.0
CARD_ID = 7  # DICT_4X4_50
#: Left out around the marker, in marker widths: the card's white border and its shadow.
CARD_MARGIN = 0.5
#: A tilt this steep stretches the far side of the photo past any useful resolution.
MAX_STRETCH = 4.0


@dataclass(frozen=True)
class Card:
    gray: np.ndarray  # the fabric beside the card, rectified, at ``ppi``
    ppi: float
    box: tuple[int, int, int, int]  # x0, y0, x1, y1 of ``gray`` in the rectified photo
    marker_box: tuple[int, int, int, int]  # the left-out card area, same frame


def _largest_rect(mask: np.ndarray) -> tuple[int, int, int, int]:
    """The largest all-True axis-aligned rectangle (x0, y0, x1, y1): histogram-stack method."""
    heights = np.zeros(mask.shape[1] + 1, int)  # last column stays 0 and flushes the stack
    best = (0, (0, 0, 0, 0))
    for r, row in enumerate(mask):
        heights[:-1] = np.where(row, heights[:-1] + 1, 0)
        stack: list[tuple[int, int]] = []
        for c, h in enumerate(heights):
            start = c
            while stack and stack[-1][1] >= h:
                s, sh = stack.pop()
                if sh * (c - s) > best[0]:
                    best = (sh * (c - s), (s, r - sh + 1, c, r + 1))
                start = s
            stack.append((start, h))
    return best[1]


def find_card(gray: np.ndarray, marker_mm: float = MARKER_MM, cell: int = 8) -> Card | None:
    """The fabric beside the card, straightened and at a known ppi; None without the card."""
    import cv2

    if gray.ndim == 3:
        gray = cv2.cvtColor(gray, cv2.COLOR_RGB2GRAY)
    gray = np.ascontiguousarray(gray, np.uint8)
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    corners, ids, _ = cv2.aruco.ArucoDetector(dictionary, params).detectMarkers(gray)
    if ids is None or CARD_ID not in ids.ravel():
        return None
    quad = corners[list(ids.ravel()).index(CARD_ID)][0].astype(np.float32)  # TL, TR, BR, BL
    side = float(np.mean(np.linalg.norm(quad - np.roll(quad, -1, 0), axis=1)))
    square = np.float32([[0, 0], [side, 0], [side, side], [0, side]])
    H = cv2.getPerspectiveTransform(quad, square)

    # Turn the card's frame back to the photo's: the photo's x axis at the card stays x.
    c = quad.mean(0)
    a, b = cv2.perspectiveTransform(np.float32([[c, c + (1, 0)]]), H)[0]
    t = -np.arctan2(b[1] - a[1], b[0] - a[0])
    H = np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]]) @ H

    h, w = gray.shape
    edge = cv2.perspectiveTransform(np.float32([[[0, 0], [w, 0], [w, h], [0, h]]]), H)[0]
    (x0, y0), (x1, y1) = edge.min(0), edge.max(0)
    if (x1 - x0) * (y1 - y0) > MAX_STRETCH * w * h:
        return None
    H = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]]) @ H
    size = (int(np.ceil(x1 - x0)), int(np.ceil(y1 - y0)))
    flat = cv2.warpPerspective(gray, H, size, flags=cv2.INTER_LINEAR)
    valid = cv2.warpPerspective(np.ones_like(gray), H, size, flags=cv2.INTER_NEAREST) > 0

    m = cv2.perspectiveTransform(quad[None], H)[0]
    pad = CARD_MARGIN * side
    mx0, my0 = np.maximum(np.floor(m.min(0) - pad), 0).astype(int)
    mx1, my1 = np.ceil(m.max(0) + pad).astype(int)
    valid[my0:my1, mx0:mx1] = False

    # Largest all-fabric rectangle, found on cells of ``cell`` px (a cell counts only if whole).
    gh, gw = valid.shape[0] // cell, valid.shape[1] // cell
    cells = valid[: gh * cell, : gw * cell].reshape(gh, cell, gw, cell).all(axis=(1, 3))
    x0, y0, x1, y1 = (v * cell for v in _largest_rect(cells))
    if x1 <= x0 or y1 <= y0:
        return None
    return Card(
        gray=flat[y0:y1, x0:x1],
        ppi=side / (marker_mm / 25.4),
        box=(x0, y0, x1, y1),
        marker_box=(int(mx0), int(my0), int(mx1), int(my1)),
    )
