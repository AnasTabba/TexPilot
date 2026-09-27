"""Which models the API loads, chosen by environment. Stdlib only."""

import pytest

from services.api.config import Settings, build_ocr, build_predictor
from services.vision.predictor import StubPredictor


def test_defaults_are_the_stub_without_ocr():
    s = Settings.from_env({})
    assert (s.vision, s.ocr) == ("stub", "none")
    predictor, version = build_predictor(s)
    assert isinstance(predictor, StubPredictor) and version == "stub-0"
    assert build_ocr(s) is None


def test_scanner_mode_defaults_to_grounding_dino_and_apple_vision():
    s = Settings.from_env({"TEXPILOT_VISION": "scanner"})
    assert (s.detector, s.ocr) == ("gdino", "apple")


def test_unknown_vision_mode_fails_at_startup():
    with pytest.raises(ValueError, match="TEXPILOT_VISION"):
        build_predictor(Settings.from_env({"TEXPILOT_VISION": "magic"}))
