"""Real detector weights on a real catalog photo. `pytest -m slow`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


@pytest.fixture(scope="module")
def image():
    if SAMPLE is None:
        pytest.skip("TextileNet not on this machine")
    from services.vision.imageio import decode_image

    return decode_image(SAMPLE.read_bytes())


@pytest.mark.parametrize("name", ["gdino", "owlv2"])
def test_detector_finds_a_garment_with_sane_boxes(name, image):
    from services.vision.detectors import load_detector
    from services.vision.garment import GARMENT_VOCAB
    from services.vision.runtime import pick_device

    det = load_detector(name, pick_device())
    found = det.detect(image)
    h, w = image.shape[:2]
    assert found, f"{name} found nothing in {SAMPLE}"
    for d in found:
        assert d.label in GARMENT_VOCAB
        assert 0 <= d.box[0] < d.box[2] <= w and 0 <= d.box[1] < d.box[3] <= h
        assert 0.0 <= d.score <= 1.0


@pytest.mark.parametrize("name", ["gdino", "owlv2", "florence2"])
def test_a_photo_with_no_garment_is_a_list_not_a_crash(name):
    # transformers' Grounding DINO post-processing returns text_labels [''] next to zero
    # scores when nothing passes the threshold; a strict zip then raised, so every
    # garment-free photo crashed instead of abstaining with NO_GARMENT_DETECTED.
    import numpy as np

    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    blank = np.full((480, 640, 3), 255, dtype=np.uint8)
    found = load_detector(name, pick_device()).detect(blank)
    assert isinstance(found, list)
    if name == "gdino":
        assert found == []
