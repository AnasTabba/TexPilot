"""Florence-2-large weights on a real catalog photo and a rendered label. `pytest -m slow`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


def _label():
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (900, 220), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=40)
    d.text((30, 30), "SHELL: 80% PA 20% EA", fill="black", font=font)
    d.text((30, 120), "LINING: 100% PES", fill="black", font=font)
    return np.asarray(img)


@pytest.fixture(scope="module")
def backends():
    from services.ocr.engines import load_engine
    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    return load_detector("florence2", pick_device()), load_engine("florence2")


def test_detector_and_engine_share_one_model(backends):
    det, engine = backends
    assert det.model is engine.model


def test_detector_finds_a_scoreless_garment_with_sane_boxes(backends):
    if SAMPLE is None:
        pytest.skip("TextileNet not on this machine")
    from services.vision.garment import GARMENT_VOCAB
    from services.vision.imageio import decode_image

    image = decode_image(SAMPLE.read_bytes())
    found = backends[0].detect(image)
    h, w = image.shape[:2]
    assert found, f"florence2 found nothing in {SAMPLE}"
    for d in found:
        assert d.label in GARMENT_VOCAB and d.score is None
        assert 0 <= d.box[0] < d.box[2] <= w and 0 <= d.box[1] < d.box[3] <= h


def test_engine_reads_a_rendered_label_into_its_composition(backends):
    from services.ocr.extract import read_composition

    ex = read_composition(backends[1], _label())
    assert [(f.name, f.pct) for f in ex.fibers] == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.section == "shell" and ex.confidence is None
