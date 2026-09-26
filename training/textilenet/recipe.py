"""The parts of the training recipe that decide the numbers. torch + numpy only.

Kept out of train.py so they are unit-tested without timm or albumentations: the
loss, the lr schedule, the class-balance weights, the head lr multiplier, and
prediction with TTA.
"""

from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as F


def lr_at(step: int, total: int, warmup: int, base: float, final: float = 1e-7) -> float:
    """Linear warmup to ``base``, then cosine down to ``final`` at the last step."""
    if step < warmup:
        return base * (step + 1) / warmup
    progress = (step - warmup) / max(1, total - 1 - warmup)
    return final + 0.5 * (base - final) * (1 + math.cos(math.pi * min(1.0, progress)))


def soft_cross_entropy(logits, target, class_weights=None):
    """CE against soft (mixup/smoothed) targets, optionally class-weighted.

    With one-hot targets this is exactly ``F.cross_entropy(logits, y, weight=w)``:
    a weighted mean, normalised by the total weight of the batch.
    """
    logp = F.log_softmax(logits.float(), dim=-1)
    if class_weights is None:
        return -(target * logp).sum(-1).mean()
    per_sample = -(target * class_weights * logp).sum(-1)
    return per_sample.sum() / (target @ class_weights).sum()


def class_balance_weights(targets: list[int], n_classes: int, power: float) -> np.ndarray:
    """Per-class weight count^-power, normalised so the average *sample* weight is 1.

    power 0.5 ("sqrt") softens a 140:1 imbalance (lace vs vinyl) to ~12:1; power 1
    equalises classes completely. Classes absent from ``targets`` get weight 0.
    """
    counts = np.bincount(targets, minlength=n_classes).astype(float)
    w = np.where(counts > 0, np.maximum(counts, 1) ** -power, 0.0)
    return w * len(targets) / (w * counts).sum()


def split_head(groups: list[dict], head_params, head_lr_mult: float) -> list[dict]:
    """Split optimizer groups so the freshly initialised head trains at ``head_lr_mult`` x.

    Groups may already carry an ``lr_scale`` (layer-wise decay); the head's is multiplied.
    """
    head_ids = {id(p) for p in head_params}
    out = []
    for g in groups:
        scale = g.get("lr_scale", 1.0)
        body = [p for p in g["params"] if id(p) not in head_ids]
        head = [p for p in g["params"] if id(p) in head_ids]
        if body:
            out.append({**g, "params": body, "lr_scale": scale})
        if head:
            out.append({**g, "params": head, "lr_scale": scale * head_lr_mult})
    return out


def tta_views(x: torch.Tensor) -> tuple[torch.Tensor, ...]:
    """Identity, hflip and quarter turns: textures have no canonical orientation."""
    return (x, x.flip(3), x.rot90(1, (2, 3)), x.rot90(3, (2, 3)))


@torch.no_grad()
def predict(model, loader, device, amp_ctx, tta: bool, channels_last: bool = False) -> tuple:
    """(scores, targets) as numpy. Scores are logits, or log mean-probs under TTA."""
    model.eval()
    outs, ys = [], []
    for x, y in loader:
        x = x.to(device, non_blocking=True)
        if channels_last:
            x = x.contiguous(memory_format=torch.channels_last)
        with amp_ctx():
            if tta:
                probs = torch.stack([model(v).float().softmax(-1) for v in tta_views(x)])
                out = probs.mean(0).clamp_min(1e-12).log()
            else:
                out = model(x).float()
        outs.append(out.cpu())
        ys.append(y)
    return torch.cat(outs).numpy(), torch.cat(ys).numpy()
