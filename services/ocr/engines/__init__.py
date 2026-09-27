"""OCR engines. Spec §5.1. Heavy imports stay inside each backend."""

from __future__ import annotations

from services.ocr.engines.base import OcrEngine, TextLine

__all__ = ["OcrEngine", "TextLine", "load_engine"]


def load_engine(name: str) -> OcrEngine:
    if name == "apple":
        from services.ocr.engines.apple import AppleVisionEngine

        return AppleVisionEngine()
    if name == "paddle":
        from services.ocr.engines.paddle import PaddleEngine

        return PaddleEngine()
    raise ValueError(f"unknown OCR engine {name!r}; week 1 ships 'apple' and 'paddle'")
