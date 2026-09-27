"""OWLv2-B, zero-shot garment detection. Spec §4.2, backend A2."""

from __future__ import annotations

import numpy as np

from services.vision.garment import PROMPTS, Detection, to_detections
from services.vision.runtime import to_device

MODEL_ID = "google/owlv2-base-patch16-ensemble"


class Owlv2Detector:
    name = "owlv2"
    # OWLv2 scores run lower than Grounding DINO's; 0.15 until the bake-off tunes it.
    default_min_score = 0.15

    def __init__(self, device, model_id: str = MODEL_ID, threshold: float = 0.10):
        import torch
        from transformers import Owlv2ForObjectDetection, Owlv2Processor

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = Owlv2Processor.from_pretrained(model_id)
        self.model = Owlv2ForObjectDetection.from_pretrained(model_id).eval().to(device)
        self.queries = [f"a photo of a {p}" for p in PROMPTS]
        self.threshold = threshold

    def detect(self, image: np.ndarray) -> list[Detection]:
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(
            text=[self.queries], images=Image.fromarray(image), return_tensors="pt"
        )
        with self._no_grad():
            outputs = self.model(**to_device(inputs, self.device))
        side = max(h, w)  # OWLv2 pads to a square at the bottom/right; boxes live in that frame
        res = self.processor.post_process_grounded_object_detection(
            outputs,
            threshold=self.threshold,
            target_sizes=[(side, side)],
            text_labels=[self.queries],
        )[0]
        return to_detections(
            res["text_labels"], res["scores"].tolist(), res["boxes"].tolist(), w, h
        )
