"""Florence-2-large phrase grounding, zero-shot garment detection. Spec §4.2, backend C.

No scores: every detection reports None, which the primary-garment rank counts as 1 and
which skips the detection threshold (spec §4.3).
"""

from __future__ import annotations

import numpy as np

from services.vision.garment import PROMPTS, Detection, to_detections

TASK = "<CAPTION_TO_PHRASE_GROUNDING>"
CAPTION = ", ".join(PROMPTS)


class Florence2Detector:
    name = "florence2"
    default_min_score = 0.30  # never applied: every score is None

    def __init__(self, device, model=None):
        if model is None:
            from services.vision.florence2 import load

            model = load(device)
        self.model = model

    def detect(self, image: np.ndarray) -> list[Detection]:
        h, w = image.shape[:2]
        res = self.model.run(image, TASK, CAPTION)
        return to_detections(res["labels"], [None] * len(res["labels"]), res["bboxes"], w, h)
