"""PaddleOCR end to end through the worker. `pytest -m slow`; needs `make setup-paddle`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow


def test_paddle_reads_a_rendered_label():
    if not Path(".venv-paddle/bin/python").exists():
        pytest.skip("run `make setup-paddle` first")
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    from services.ocr.engines import load_engine

    img = Image.new("RGB", (700, 120), "white")
    ImageDraw.Draw(img).text(
        (20, 30),
        "80% PA 20% EA",
        fill="black",
        font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 44),
    )
    engine = load_engine("paddle")
    try:
        texts = " ".join(line.text for line in engine.read(np.asarray(img)))
    finally:
        engine.close()
    assert "80%" in texts and "PA" in texts
