"""Florence-2-large <OCR_WITH_REGION>. Spec §5.1, engine 3.

Shares the loaded model with the Florence-2 garment detector. Florence-2 gives no
per-line confidence, so lines carry None and the composition's ocr_confidence is null.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from services.ocr.engines.base import TextLine

if TYPE_CHECKING:
    import numpy as np

TASK = "<OCR_WITH_REGION>"


def quad_to_box(q) -> tuple[float, float, float, float]:
    """(x1, y1, ..., x4, y4) -> the axis-aligned box around it."""
    xs, ys = q[0::2], q[1::2]
    return (float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys)))


class Florence2Engine:
    name = "florence2"

    def __init__(self, device="auto", model=None):
        if model is None:
            from services.vision.florence2 import load
            from services.vision.runtime import pick_device

            model = load(pick_device(device))
        self.model = model

    def read(self, image: np.ndarray) -> list[TextLine]:
        # The checkpoint bans repeated 3-grams, but a care label repeats its composition
        # once per language: with the ban, the repeats came back garbled or dropped.
        res = self.model.run(image, TASK, no_repeat_ngram_size=0)
        return [
            TextLine(text.strip(), None, quad_to_box(q))
            for q, text in zip(res["quad_boxes"], res["labels"], strict=True)
            if text.strip()
        ]
