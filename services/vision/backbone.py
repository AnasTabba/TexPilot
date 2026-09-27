"""DINOv2 features exactly as the heads were trained on them. Spec §6.2."""

from __future__ import annotations

import numpy as np

TIMM_NAME = "vit_base_patch14_dinov2.lvd142m"
IMG_SIZE = 224
CROP_PCT = 0.875


def pool_features(model, x):
    """[CLS ; mean(patch tokens)] for ViTs (the DINOv2 linear-eval feature); pooled
    pre-logits for other backbones."""
    tokens = model.forward_features(x)
    if tokens.ndim == 3:
        import torch

        prefix = getattr(model, "num_prefix_tokens", 1)
        return torch.cat([tokens[:, 0], tokens[:, prefix:].mean(1)], dim=1)
    return model.forward_head(tokens, pre_logits=True)


def preprocess(
    view: np.ndarray, mean, std, img_size: int = IMG_SIZE, crop_pct: float = CROP_PCT
) -> np.ndarray:
    """HWC uint8 -> CHW float32. Shorter side to img_size/crop_pct, centre crop, normalise:
    the same as the albumentations eval transform the cached features used (pinned by
    tests/test_scanner_backbone.py)."""
    import cv2

    h, w = view.shape[:2]
    target = int(round(img_size / crop_pct))
    scale = target / min(h, w)
    nh, nw = max(target, int(round(h * scale))), max(target, int(round(w * scale)))
    resized = cv2.resize(view, (nw, nh), interpolation=cv2.INTER_LINEAR)
    y0, x0 = (nh - img_size) // 2, (nw - img_size) // 2
    crop = resized[y0 : y0 + img_size, x0 : x0 + img_size].astype(np.float32) / 255.0
    crop = (crop - np.asarray(mean, np.float32)) / np.asarray(std, np.float32)
    return np.ascontiguousarray(crop.transpose(2, 0, 1))
