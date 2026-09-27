"""Calibrated linear heads on DINOv2 features. Spec §6.

Below its threshold a head returns None: the scan abstains rather than guess.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from services.vision import runtime  # noqa: F401 -- Metal caps set before torch is imported
from services.vision.predictor import HeadOutput, VisionOutput

HEAD_NAMES = ("structure", "treatment", "fibre_family")


@dataclass(frozen=True)
class HeadSpec:
    classes: tuple[str, ...]
    weight: np.ndarray  # (C, D) float32, applies to raw (unstandardised) features
    bias: np.ndarray  # (C,)
    temperature: float
    threshold: float


def softmax(logits: np.ndarray, t: float = 1.0) -> np.ndarray:
    z = logits / t
    z = z - z.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def apply_head(features: np.ndarray, spec: HeadSpec, k: int = 5) -> HeadOutput | None:
    """Features (V, D) of one garment's views -> calibrated prediction, or None if unsure."""
    probs = softmax(features @ spec.weight.T + spec.bias, spec.temperature).mean(0)
    i = int(probs.argmax())
    if probs[i] < spec.threshold:
        return None
    topk = [(spec.classes[j], float(probs[j])) for j in np.argsort(-probs, kind="stable")[:k]]
    return HeadOutput(spec.classes[i], float(probs[i]), topk)


def save_bundle(out_dir: Path, meta: dict, specs: dict[str, HeadSpec]) -> None:
    from safetensors.numpy import save_file

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tensors = {}
    heads_meta = dict(meta.get("heads", {}))
    for name, s in specs.items():
        tensors[f"{name}.weight"] = np.ascontiguousarray(s.weight, np.float32)
        tensors[f"{name}.bias"] = np.ascontiguousarray(s.bias, np.float32)
        heads_meta[name] = {
            **heads_meta.get(name, {}),
            "classes": list(s.classes),
            "temperature": float(s.temperature),
            "threshold": float(s.threshold),
        }
    save_file(tensors, str(out_dir / "heads.safetensors"))
    (out_dir / "bundle.json").write_text(json.dumps({**meta, "heads": heads_meta}, indent=1))


def load_bundle(bundle_dir: Path) -> tuple[dict, dict[str, HeadSpec]]:
    from safetensors.numpy import load_file

    bundle_dir = Path(bundle_dir)
    meta = json.loads((bundle_dir / "bundle.json").read_text())
    tensors = load_file(str(bundle_dir / "heads.safetensors"))
    specs = {
        name: HeadSpec(
            tuple(h["classes"]),
            tensors[f"{name}.weight"],
            tensors[f"{name}.bias"],
            float(h["temperature"]),
            float(h["threshold"]),
        )
        for name, h in meta["heads"].items()
    }
    return meta, specs


class LinearHeads:
    """The FabricHeads unit: views -> VisionOutput. Missing heads (e.g. treatment) are None."""

    def __init__(self, bundle_dir: Path, device):
        import timm
        import torch

        self.meta, self.specs = load_bundle(bundle_dir)
        self.version = int(self.meta["version"])
        bb = self.meta["backbone"]
        self.mean, self.std = bb["mean"], bb["std"]
        self.img_size, self.crop_pct = bb["img_size"], bb["crop_pct"]
        self.device, self._torch = device, torch
        self.half = device.type in ("mps", "cuda")
        model = (
            timm.create_model(
                bb["timm_name"], pretrained=True, num_classes=0, img_size=bb["img_size"]
            )
            .eval()
            .to(device)
        )
        self.model = model.half() if self.half else model

    def predict(self, views: list[np.ndarray]) -> VisionOutput:
        from services.vision.backbone import pool_features, preprocess

        x = np.stack(
            [preprocess(v, self.mean, self.std, self.img_size, self.crop_pct) for v in views]
        )
        t = self._torch.from_numpy(x).to(self.device)
        with self._torch.no_grad():
            f = pool_features(self.model, t.half() if self.half else t).float().cpu().numpy()
        out = {n: (apply_head(f, self.specs[n]) if n in self.specs else None) for n in HEAD_NAMES}
        return VisionOutput(**out)
