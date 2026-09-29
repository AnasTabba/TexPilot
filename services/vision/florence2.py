"""Florence-2-large, shared by the garment detector and the OCR engine (spec §4.2, §5.1).

One model per (checkpoint, device), held weakly: the API loading both backends pays for
one model, and the bake-off dropping a backend frees it.
"""

from __future__ import annotations

import weakref
from typing import TYPE_CHECKING

from services.vision.runtime import to_device

if TYPE_CHECKING:
    import numpy as np

MODEL_ID = "florence-community/Florence-2-large"
NUM_BEAMS = 3  # the model card's setting; the bake-off measures what it costs
MAX_NEW_TOKENS = 1024


class Florence2:
    def __init__(self, device, model_id: str = MODEL_ID):
        import torch
        from transformers import AutoProcessor, Florence2ForConditionalGeneration

        self._no_grad = torch.no_grad
        self.device = device
        # Half precision on the GPU: ~1.5 GB instead of 3 GB on a 16 GB laptop.
        self.dtype = torch.float32 if str(device) == "cpu" else torch.float16
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = (
            Florence2ForConditionalGeneration.from_pretrained(model_id, dtype=self.dtype)
            .eval()
            .to(device)
        )

    def run(self, image: np.ndarray, task: str, text: str = "") -> dict:
        """One Florence-2 task on an RGB array; the processor's parsed answer, in pixels."""
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(
            text=task + text, images=Image.fromarray(image), return_tensors="pt"
        )
        inputs = to_device(inputs, self.device)
        with self._no_grad():
            ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"].to(self.dtype),
                max_new_tokens=MAX_NEW_TOKENS,
                num_beams=NUM_BEAMS,
                do_sample=False,
            )
        raw = self.processor.batch_decode(ids, skip_special_tokens=False)[0]
        return self.processor.post_process_generation(raw, task=task, image_size=(w, h))[task]


_shared: weakref.WeakValueDictionary = weakref.WeakValueDictionary()


def load(device, model_id: str = MODEL_ID) -> Florence2:
    key = (model_id, str(device))
    model = _shared.get(key)
    if model is None:
        model = _shared[key] = Florence2(device, model_id)
    return model
