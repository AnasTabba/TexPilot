"""OCR engines. Spec §5.1. Heavy imports stay inside each backend."""

from __future__ import annotations

from services.ocr.engines.base import OcrEngine, TextLine

__all__ = ["OcrEngine", "TextLine", "load_engine"]


def load_engine(name: str, device="auto") -> OcrEngine:
    """``device`` matters only to engines on torch (Florence-2); pass the API's setting so
    a Florence-2 engine shares the Florence-2 detector's model."""
    if name == "apple":
        from services.ocr.engines.apple import AppleVisionEngine

        return AppleVisionEngine()
    if name == "paddle":
        from services.ocr.engines.paddle import PaddleEngine

        return PaddleEngine()
    if name == "florence2":
        from services.ocr.engines.florence2 import Florence2Engine

        return Florence2Engine(device)
    raise ValueError(f"unknown OCR engine {name!r}; choose 'apple', 'paddle' or 'florence2'")
