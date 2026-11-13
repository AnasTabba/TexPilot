"""Regenerates the QC image fixtures.

Run from scanner/: ``python tests/fixtures/qc-images/generate.py``.

Every file is a real, deterministic image made with Pillow, except the two negatives, which
are deliberately invalid. ``manifest.json`` records each file's SHA-256 and what it is for.
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent


def _texture(w: int, h: int, seed: int = 1) -> Image.Image:
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w]
    base = 120 + 60 * np.sin(x / 3.0) * np.sin(y / 4.0)
    rgb = np.stack([base, base * 0.9, base * 0.8], -1) + rng.normal(0, 6, (h, w, 3))
    rgb[: h // 4, : w // 4] = (220, 30, 30)  # red top-left corner: orientation is checkable
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def _bytes(im: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, fmt, **kw)
    return buf.getvalue()


def build() -> dict[str, tuple[bytes, str]]:
    base = _texture(640, 480)
    exif = Image.Exif()
    exif[0x0112] = 6  # stored rotated; upright needs a 90 degree clockwise turn
    exif[0x8825] = {1: "N", 2: (24.0, 51.0, 0.0), 3: "E", 4: (67.0, 0.0, 0.0)}  # GPS IFD
    jpeg = _bytes(base, "JPEG", quality=92)
    # 5000 x 3400 = 17 MP of one colour: a few kB on disk, over the 16 MP decode limit.
    huge = _bytes(Image.new("L", (5000, 3400), 128), "PNG", optimize=True)
    frames = [_texture(64, 64, s) for s in (1, 2)]
    animated = io.BytesIO()
    frames[0].save(animated, "WEBP", save_all=True, append_images=frames[1:], duration=100)
    return {
        "swatch.jpg": (jpeg, "valid JPEG 640x480"),
        "phone-4032x3024.jpg": (
            _bytes(Image.new("RGB", (4032, 3024), (90, 120, 150)), "JPEG", quality=70),
            "synthetic valid phone-resolution JPEG 4032x3024; never shrink measurement source",
        ),
        "swatch.png": (_bytes(base, "PNG"), "valid PNG 640x480"),
        "swatch.webp": (_bytes(base, "WEBP", quality=90), "valid WebP 640x480"),
        "swatch-exif6.jpg": (
            _bytes(base, "JPEG", quality=92, exif=exif),
            "valid JPEG stored 640x480 with EXIF orientation 6 and a GPS tag; upright is 480x640",
        ),
        "truncated-14.jpg": (jpeg[:14], "negative: JPEG signature, 14 bytes, not decodable"),
        "over-pixel-limit.png": (huge, "negative: 5000x3400 = 17 MP, small on disk"),
        "animated.webp": (animated.getvalue(), "negative: two-frame WebP"),
        "fake.heic": (
            b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 16,
            "negative: HEIC container signature",
        ),
    }


def main() -> None:
    manifest = {}
    for name, (data, note) in build().items():
        (HERE / name).write_bytes(data)
        manifest[name] = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "note": note,
        }
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
