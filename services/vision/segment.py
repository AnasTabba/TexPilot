"""Garment masks from SAM 2.1-small, and the clean-up rules around them. Spec §4.5."""

from __future__ import annotations

import numpy as np

from services.vision.garment import Box
from services.vision.runtime import to_device

MODEL_ID = "facebook/sam2.1-hiera-small"
#: Below this share of its box, a mask is a failed segmentation, not a garment.
MIN_BOX_FRACTION = 0.20


def box_mask(shape: tuple[int, int], box: Box) -> np.ndarray:
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    mask = np.zeros(shape, bool)
    mask[max(0, y0) : y1, max(0, x0) : x1] = True
    return mask


def clean_mask(
    mask: np.ndarray, box: Box, min_box_fraction: float = MIN_BOX_FRACTION
) -> np.ndarray:
    """Largest connected region, holes filled; the box itself if the region is too small."""
    from scipy import ndimage

    mask = np.asarray(mask, bool)
    labels, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, labels, index=range(1, n + 1))
        mask = ndimage.binary_fill_holes(labels == 1 + int(np.argmax(sizes)))
    x0, y0, x1, y1 = box
    if mask.sum() < min_box_fraction * max(1.0, (x1 - x0) * (y1 - y0)):
        return box_mask(mask.shape, box)
    return mask


class Sam2Segmenter:
    def __init__(self, device, model_id: str = MODEL_ID):
        import torch
        from transformers import Sam2Model, Sam2Processor

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = Sam2Processor.from_pretrained(model_id)
        self.model = Sam2Model.from_pretrained(model_id).eval().to(device)

    def segment(self, image: np.ndarray, box: Box) -> np.ndarray:
        from PIL import Image

        inputs = self.processor(
            images=Image.fromarray(image),
            input_boxes=[[[float(v) for v in box]]],
            return_tensors="pt",
        )
        with self._no_grad():
            out = self.model(**to_device(inputs, self.device), multimask_output=True)
        masks = self.processor.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"])[0]
        best = int(out.iou_scores[0, 0].argmax())  # keep the mask SAM rates best
        return clean_mask(masks[0, best].numpy(), box)
