"""Detector B before and without its trained checkpoint. No models."""

import pytest


def test_without_a_trained_checkpoint_it_says_how_to_get_one(tmp_path):
    from services.vision.detectors.rtdetr import RtDetrDetector

    with pytest.raises(FileNotFoundError, match="run_cloud.sh"):
        RtDetrDetector("cpu", checkpoint=tmp_path / "missing")


def test_it_is_registered_as_rtdetr(tmp_path, monkeypatch):
    import services.vision.detectors.rtdetr as rtdetr
    from services.vision.detectors import load_detector

    monkeypatch.setattr(rtdetr, "CHECKPOINT", tmp_path / "missing")
    with pytest.raises(FileNotFoundError, match="missing"):
        load_detector("rtdetr", "cpu")
