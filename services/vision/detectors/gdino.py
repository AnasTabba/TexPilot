"""Grounding DINO-T, zero-shot garment detection. Spec §4.2, backend A1."""

from __future__ import annotations

import numpy as np

from services.vision.garment import PROMPTS, Detection, to_detections
from services.vision.runtime import to_device

MODEL_ID = "IDEA-Research/grounding-dino-tiny"


class GroundingDinoDetector:
    name = "gdino"
    default_min_score = 0.30

    def __init__(
        self,
        device,
        model_id: str = MODEL_ID,
        box_threshold: float = 0.25,
        text_threshold: float = 0.25,
    ):
        import torch
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).eval().to(device)
        # Grounding DINO expects lower-case phrases separated by " . ", ending with " .".
        self.prompt = " . ".join(p.lower() for p in PROMPTS) + " ."
        self.box_threshold, self.text_threshold = box_threshold, text_threshold

    def detect(self, image: np.ndarray) -> list[Detection]:
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(
            images=Image.fromarray(image), text=self.prompt, return_tensors="pt"
        )
        with self._no_grad():
            outputs = self.model(**to_device(inputs, self.device))
        res = self.processor.post_process_grounded_object_detection(
            outputs,
            inputs["input_ids"],
            threshold=self.box_threshold,
            text_threshold=self.text_threshold,
            target_sizes=[(h, w)],
        )[0]
        if not len(res["scores"]):  # nothing passed: transformers then gives text_labels ['']
            return []
        return to_detections(
            res["text_labels"], res["scores"].tolist(), res["boxes"].tolist(), w, h
        )
