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


def test_repeated_reads_do_not_leak_image_buffers():
    # Final review, Important #6: NSData made per read is autoreleased, and uvicorn's thread
    # never drains a pool, so each read kept ~4 MB for the server's life. Measured in a
    # fresh process: peak RSS growth over 40 reads of a 1600 px label photo.
    import subprocess
    import sys

    code = """
import resource, numpy as np
from services.ocr.engines import load_engine
engine = load_engine("apple")
# Photo-like (incompressible) pixels: a real label photo is ~4-6 MB as PNG, not a few KB.
img = np.random.default_rng(0).integers(0, 256, (1200, 1600, 3), dtype=np.uint8)
for _ in range(5):
    engine.read(img)
before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
for _ in range(40):
    engine.read(img)
print((resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - before) / 1e6)
"""
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-400:]
    grew_mb = float(r.stdout.strip().splitlines()[-1])
    assert grew_mb < 80, f"peak RSS grew {grew_mb:.0f} MB over 40 reads"
