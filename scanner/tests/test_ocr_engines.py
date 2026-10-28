"""Engine plumbing that needs no OCR model. Stdlib only."""

import pytest

from services.ocr.engines.apple import vision_box_to_pixels
from services.ocr.engines.base import TextLine


def test_vision_boxes_become_top_left_pixel_boxes():
    # Vision: normalised, origin bottom-left. A line in the top quarter of a 200x100 image.
    assert vision_box_to_pixels(0.1, 0.75, 0.5, 0.2, 200, 100) == pytest.approx(
        (20.0, 5.0, 120.0, 25.0)
    )


def test_textline_is_a_plain_value():
    assert TextLine("60% COTTON", 0.9, (0, 0, 1, 1)) == TextLine("60% COTTON", 0.9, (0, 0, 1, 1))
