"""Florence-2 <OCR_WITH_REGION> -> TextLines, with a fake model. No weights."""

import pytest

np = pytest.importorskip("numpy")

from services.ocr.engines.base import TextLine  # noqa: E402
from services.ocr.engines.florence2 import TASK, Florence2Engine  # noqa: E402
from services.ocr.extract import extract  # noqa: E402

IMAGE = np.zeros((220, 900, 3), dtype=np.uint8)


class FakeModel:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def run(self, image, task, text="", **generate):
        self.calls.append((task, text, generate))
        return self.answer


def test_regions_become_axis_aligned_lines_without_confidence():
    model = FakeModel({"quad_boxes": [[30, 30, 400, 32, 399, 70, 29, 68]],
                       "labels": ["SHELL: 80% PA 20% EA"]})  # fmt: skip
    assert Florence2Engine(model=model).read(IMAGE) == [
        TextLine("SHELL: 80% PA 20% EA", None, (29.0, 30.0, 400.0, 70.0))
    ]
    assert model.calls == [(TASK, "", {"no_repeat_ngram_size": 0})]  # labels repeat per language


def test_blank_regions_are_dropped():
    model = FakeModel({"quad_boxes": [[0] * 8, [0, 0, 10, 0, 10, 10, 0, 10]],
                       "labels": ["  ", "100% COTTON"]})  # fmt: skip
    assert [ln.text for ln in Florence2Engine(model=model).read(IMAGE)] == ["100% COTTON"]


def test_its_lines_parse_into_a_composition_with_no_confidence():
    model = FakeModel({"quad_boxes": [[30, 30, 400, 30, 400, 70, 30, 70],
                                      [30, 120, 300, 120, 300, 160, 30, 160]],
                       "labels": ["SHELL: 80% PA 20% EA", "LINING: 100% PES"]})  # fmt: skip
    ex = extract(Florence2Engine(model=model).read(IMAGE))
    assert [(f.name, f.pct) for f in ex.fibers] == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.confidence is None


@pytest.mark.parametrize("device", ["cpu", "cpu:0", "auto"])
def test_the_api_gives_detector_and_engine_one_shared_model(monkeypatch, device):
    # build_predictor hands the detector pick_device(s.device); build_ocr must land on the
    # same cache key, or the API loads Florence-2 twice.
    pytest.importorskip("torch")
    import weakref

    import services.vision.florence2 as f2
    from services.api.config import Settings, build_ocr
    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    monkeypatch.setattr(f2, "Florence2", lambda device, model_id=f2.MODEL_ID: FakeModel({}))
    monkeypatch.setattr(f2, "_shared", weakref.WeakValueDictionary())
    s = Settings(vision="scanner", detector="florence2", ocr="florence2", device=device)
    det = load_detector(s.detector, pick_device(s.device))
    assert build_ocr(s).model is det.model
