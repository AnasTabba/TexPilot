"""Process-wide settings for running models on this laptop. Import before torch.

Why the Metal caps: on 2026-09-27 a model job plus browser tabs exhausted the 16 GB
fanless MacBook Air, which froze and had to be force-restarted. With the cap, a runaway
job fails with an out-of-memory error instead. See training/textilenet/governor.py.
"""

from __future__ import annotations

import os

_DEFAULTS = {
    # Cap Metal memory at half the recommended working set (~5 GB of 16 GB). The low
    # watermark must not exceed the high one, or torch refuses every MPS allocation.
    "PYTORCH_MPS_HIGH_WATERMARK_RATIO": "0.5",
    "PYTORCH_MPS_LOW_WATERMARK_RATIO": "0.4",
    # Ops with no Metal kernel (some detector layers) fall back to CPU instead of raising.
    "PYTORCH_ENABLE_MPS_FALLBACK": "1",
    # albumentations phones PyPI on every import, once per DataLoader worker.
    "NO_ALBUMENTATIONS_UPDATE": "1",
}


def configure() -> None:
    for key, value in _DEFAULTS.items():
        os.environ.setdefault(key, value)


def pick_device(name: str = "auto"):
    import torch

    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def to_device(batch, device) -> dict:
    """Move a processor output to ``device``. Metal has no float64, so those become float32."""
    import torch

    out = {}
    for key, value in batch.items():
        if isinstance(value, torch.Tensor):
            if value.dtype == torch.float64:
                value = value.float()
            value = value.to(device)
        out[key] = value
    return out


configure()
