"""RT-DETRv2-R50 fine-tuned on Fashionpedia's garments. Spec §4.2, backend B.

The checkpoint comes from training/detector/run_cloud.sh on the rented GPU; copy its
runs/rtdetr/best/ folder here as models/rtdetr-fashionpedia/. Real scores, so τ_det applies.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from services.vision.garment import Detection, to_detections
from services.vision.runtime import to_device

CHECKPOINT = Path("models/rtdetr-fashionpedia")


class RtDetrDetector:
    name = "rtdetr"
    default_min_score = 0.30

    def __init__(self, device, checkpoint: Path | None = None, threshold: float = 0.10):
        checkpoint = Path(checkpoint or CHECKPOINT)
        if not checkpoint.exists():
            raise FileNotFoundError(
                f"{checkpoint} is missing: train backend B on the GPU box "
                "(training/detector/run_cloud.sh) and copy runs/rtdetr/best/ here"
            )
        import torch
        from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = RTDetrImageProcessor.from_pretrained(checkpoint)
        self.model = RTDetrV2ForObjectDetection.from_pretrained(checkpoint).eval().to(device)
        self.threshold = threshold

    def detect(self, image: np.ndarray) -> list[Detection]:
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(images=Image.fromarray(image), return_tensors="pt")
        with self._no_grad():
            outputs = self.model(**to_device(inputs, self.device))
        res = self.processor.post_process_object_detection(
            outputs, threshold=self.threshold, target_sizes=[(h, w)]
        )[0]
        names = [self.model.config.id2label[int(i)] for i in res["labels"]]
        return to_detections(names, res["scores"].tolist(), res["boxes"].tolist(), w, h)
