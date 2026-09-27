"""Real SAM 2.1 weights on a real photo. `pytest -m slow`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


def test_sam_mask_is_non_empty_and_inside_the_image():
    if SAMPLE is None:
        pytest.skip("TextileNet not on this machine")
    from services.vision.imageio import decode_image
    from services.vision.runtime import pick_device
    from services.vision.segment import Sam2Segmenter

    img = decode_image(SAMPLE.read_bytes())
    h, w = img.shape[:2]
    box = (w * 0.1, h * 0.1, w * 0.9, h * 0.9)
    mask = Sam2Segmenter(pick_device()).segment(img, box)
    assert mask.shape == (h, w) and mask.dtype == bool
    assert mask.sum() >= 0.2 * (0.8 * w) * (0.8 * h)
