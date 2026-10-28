"""Synthetic woven/knit scans with known thread counts and realistic degradations, for the
spec-scan tests (tests/test_threads.py). Not a test module itself."""

import io
import math

import numpy as np
from PIL import Image, ImageFilter

WEAVES = {  # warp-up predicate on (end i, pick j)
    "plain": lambda i, j: (i + j) % 2 == 0,
    "2/1 twill": lambda i, j: (i - j) % 3 != 2,
    "3/1 twill": lambda i, j: (i - j) % 4 != 3,
    "2/2 twill": lambda i, j: (i - j) % 4 < 2,
    "5-satin": lambda i, j: (2 * i - j) % 5 != 0,  # warp-faced 5-end satin (step 2)
    "basket 2x2": lambda i, j: ((i // 2) + (j // 2)) % 2 == 0,
}


def render(
    weave,
    ends,
    picks,
    ppi,
    size=2000,
    angle=0.0,
    jitter=0.0,
    thick=0.0,
    seed=0,
    warp_tone=60,
    weft_tone=210,
    noise=10,
):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size].astype(float)
    a = math.radians(angle)
    x, y = x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)
    ue, up = x * ends / ppi, y * picks / ppi  # position in thread units
    if jitter:  # irregular yarn spacing (slub-ish): smooth random phase drift
        ue = ue + jitter * np.interp(ue, np.arange(-50, 400), rng.normal(0, 1, 450).cumsum() * 0.15)
        up = up + jitter * np.interp(up, np.arange(-50, 400), rng.normal(0, 1, 450).cumsum() * 0.15)
    i, j = np.floor(ue).astype(int), np.floor(up).astype(int)
    warp_up = WEAVES[weave](i, j)
    w_e = 1 + thick * np.sin(i * 1.7)  # thickness variation per yarn
    se = 0.55 + 0.45 * np.clip(np.cos(np.pi * ((ue % 1) - 0.5) / np.clip(w_e, 0.6, 1.4)), 0, 1) ** 2
    sp = 0.55 + 0.45 * np.clip(np.cos(np.pi * ((up % 1) - 0.5)), 0, 1) ** 2
    img = np.where(warp_up, warp_tone * se, weft_tone * sp) + rng.normal(0, noise, (size, size))
    return np.clip(img, 0, 255).astype(np.uint8)


def knit(wales, courses, ppi, size=2000, seed=0):
    """Single jersey face: V-shaped loops, wales vertical, courses stacked."""
    y, x = np.mgrid[0:size, 0:size].astype(float)
    uw, uc = x * wales / ppi, y * courses / ppi
    fx, fy = uw % 1 - 0.5, uc % 1
    leg = np.abs(np.abs(fx) - 0.25 - 0.15 * (fy - 0.5))  # two slanted legs per loop
    img = (
        200
        - 140 * np.exp(-((leg / 0.09) ** 2))
        + np.random.default_rng(seed).normal(0, 8, (size, size))
    )
    return np.clip(img, 0, 255).astype(np.uint8)


def degrade(img, blur=0.0, jpeg=None, light=0.0):
    out = img.astype(float)
    if light:  # uneven lamp: smooth brightness gradient across the bed
        h, w = out.shape
        out *= (1 - light) + light * 2 * (np.mgrid[0:h, 0:w][1] / w)
    pil = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    if blur:
        pil = pil.filter(ImageFilter.GaussianBlur(blur))
    if jpeg:
        buf = io.BytesIO()
        pil.save(buf, "JPEG", quality=jpeg)
        pil = Image.open(io.BytesIO(buf.getvalue()))
    return np.asarray(pil)
