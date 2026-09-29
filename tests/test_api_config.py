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


def test_scans_are_kept_with_the_scanner_and_not_in_stub_mode(tmp_path):
    from services.api.config import build_store

    assert Settings.from_env({}).store == "none"
    assert build_store(Settings.from_env({})) is None
    assert Settings.from_env({"TEXPILOT_VISION": "scanner"}).store == "data/scans"
    s = Settings.from_env({"TEXPILOT_SCAN_STORE": str(tmp_path / "scans")})
    assert build_store(s).root == tmp_path / "scans"  # on in stub mode too, if asked for


def test_the_default_bundle_is_scanner_v2():
    # v2 (final split, +54.7k fabric / +77k fibre scraped train photos) beats v1 on every
    # head: test top-1, coverage at the 90% target, macro-F1 and calibration (docs/results.md).
    from pathlib import Path

    assert Settings.from_env({"TEXPILOT_VISION": "scanner"}).bundle == Path("models/scanner-v2")
