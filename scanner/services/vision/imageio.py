"""Decode uploaded images the same way everywhere: upright, RGB, bounded size."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from services.vision.errors import UnsupportedImage

#: Detectors resize to ~800-1000 px and the heads to 224; nothing needs 12 MP.
MAX_SIDE = 1600


def decode_image(
    data: bytes, max_side: int = MAX_SIDE, *, min_side: int | None = None
) -> np.ndarray:
    """HxWx3 uint8 RGB, rotated upright per EXIF, longest side at most ``max_side``."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)  # phones store rotation as a tag, not pixels
            if min_side is not None and min(im.size) < min_side:
                raise UnsupportedImage(
                    "The photo is too small to read. Take it again closer and sharper."
                )
            if im.mode in ("RGBA", "LA") or "transparency" in im.info:
                rgba = im.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                im = Image.alpha_composite(background, rgba).convert("RGB")
            else:
                im = im.convert("RGB")
            if max(im.size) > max_side:
                im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            return np.asarray(im).copy()
    except Image.DecompressionBombError as e:
        # Not an OSError: uncaught it became a 500, which the app's queue retries forever.
        raise UnsupportedImage(f"image too large to decode safely: {e}") from e
    except UnsupportedImage:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise UnsupportedImage(f"cannot decode image: {e}") from e
