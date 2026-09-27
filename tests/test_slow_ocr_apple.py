"""Apple Vision on a rendered care label. `pytest -m slow`, macOS only."""

import platform

import pytest

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(platform.system() != "Darwin", reason="Apple Vision is macOS only"),
]


def _label():
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (900, 220), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 40)
    d.text((30, 30), "SHELL: 80% PA 20% EA", fill="black", font=font)
    d.text((30, 120), "LINING: 100% PES", fill="black", font=font)
    return np.asarray(img)


def test_reads_fibre_codes_verbatim_in_reading_order():
    from services.ocr.engines import load_engine

    lines = load_engine("apple").read(_label())
    texts = [line.text for line in sorted(lines, key=lambda ln: ln.box[1])]
    assert texts == ["SHELL: 80% PA 20% EA", "LINING: 100% PES"]
    assert all(line.confidence > 0.5 for line in lines)
