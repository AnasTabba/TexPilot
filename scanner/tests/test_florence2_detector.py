"""Florence-2 phrase grounding -> Detections, with a fake model. No weights."""

import pytest

np = pytest.importorskip("numpy")

from services.vision.detectors.florence2 import CAPTION, TASK, Florence2Detector  # noqa: E402
from services.vision.garment import PROMPTS  # noqa: E402

IMAGE = np.zeros((100, 200, 3), dtype=np.uint8)


class FakeModel:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def run(self, image, task, text=""):
        self.calls.append((task, text))
        return self.answer


def test_grounded_phrases_become_scoreless_canonical_detections():
    model = FakeModel({"bboxes": [[10, 10, 90, 90], [0, 0, 20, 20]], "labels": ["jeans", "person"]})
    [d] = Florence2Detector(None, model=model).detect(IMAGE)
    assert (d.label, d.score, d.box) == ("pants", None, (10.0, 10.0, 90.0, 90.0))
    assert model.calls == [(TASK, CAPTION)]


def test_the_caption_names_every_garment_synonym():
    assert all(p in CAPTION for p in PROMPTS)


def test_boxes_are_clipped_to_the_image_and_empty_ones_dropped():
    answer = {"bboxes": [[-5, -5, 250, 120], [50, 50, 50, 80]], "labels": ["dress", "skirt"]}
    [d] = Florence2Detector(None, model=FakeModel(answer)).detect(IMAGE)
    assert (d.label, d.box) == ("dress", (0.0, 0.0, 200.0, 100.0))


def test_it_is_registered_as_florence2(monkeypatch):
    import services.vision.florence2 as f2
    from services.vision.detectors import load_detector

    fake = FakeModel({"bboxes": [], "labels": []})
    monkeypatch.setattr(f2, "load", lambda device: fake)
    det = load_detector("florence2", "cpu")
    assert det.name == "florence2" and det.model is fake
