"""Calibrated heads: linear heads on DINOv2 features, and optionally a fine-tuned Head A.
Spec §6, §10 (week 5).

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


def decide(probs: np.ndarray, classes, threshold: float, k: int = 5) -> HeadOutput | None:
    """Calibrated class probabilities -> the answer, or None below the head's threshold."""
    i = int(probs.argmax())
    if probs[i] < threshold:
        return None
    topk = [(classes[j], float(probs[j])) for j in np.argsort(-probs, kind="stable")[:k]]
    return HeadOutput(classes[i], float(probs[i]), topk)


def head_probs(features: np.ndarray, spec: HeadSpec) -> np.ndarray:
    """Features (V, D) of one garment's views -> calibrated class probabilities."""
    return softmax(features @ spec.weight.T + spec.bias, spec.temperature).mean(0)


def apply_head(features: np.ndarray, spec: HeadSpec, k: int = 5) -> HeadOutput | None:
    """Features (V, D) of one garment's views -> calibrated prediction, or None if unsure."""
    return decide(head_probs(features, spec), spec.classes, spec.threshold, k)


def closest(probs: np.ndarray, classes, k: int = 3) -> list[tuple[str, float]]:
    """The k most likely classes, for showing what an abstaining head was weighing.
    Not an answer: the scan's verdict ignores these."""
    return [(classes[j], float(probs[j])) for j in np.argsort(-probs, kind="stable")[:k]]


def timm_classifier(timm_name: str, n_classes: int, img_size: int, pretrained: bool = False):
    """The classifier training.textilenet.train builds: ViT-style models are made at the
    training size (their position embeddings are resampled to it), CNNs take any size."""
    import timm

    kwargs = {"img_size": img_size} if timm_name.startswith(("vit_", "eva", "deit", "beit")) else {}
    return timm.create_model(timm_name, pretrained=pretrained, num_classes=n_classes, **kwargs)


class FineTunedHead:
    """A fine-tuned TextileNet classifier as a scanner head: runs on the garment's views,
    averages calibrated probabilities over them, abstains below its threshold.

    With ``pool: probe`` (training/scanner/export_probe_head.py) it is instead a frozen
    public encoder plus a linear head on its pooled features; only the head is stored."""

    def __init__(self, head_dir: Path, device):
        import torch
        from safetensors.torch import load_file

        head_dir = Path(head_dir)
        self.meta = json.loads((head_dir / "head.json").read_text())
        self.classes = tuple(self.meta["classes"])
        self.device, self._torch = device, torch
        self.half = device.type in ("mps", "cuda")
        m, self.probe = self.meta, None
        if m.get("pool") == "probe":
            model = timm_classifier(m["timm_name"], 0, m["img_size"], pretrained=True)
            w = load_file(str(head_dir / "probe.safetensors"))
            self.probe = torch.nn.Linear(*w["probe.weight"].shape[::-1])
            self.probe.load_state_dict({"weight": w["probe.weight"], "bias": w["probe.bias"]})
            self.probe = self.probe.to(device)
        else:
            model = timm_classifier(m["timm_name"], len(self.classes), m["img_size"])
            model.load_state_dict(load_file(str(head_dir / "model.safetensors")))
        model = model.eval().to(device)
        self.model = model.half() if self.half else model

    def predict(self, views: list[np.ndarray]) -> HeadOutput | None:
        return decide(self.probs(views), self.classes, self.meta["threshold"])

    def probs(self, views: list[np.ndarray]) -> np.ndarray:
        from services.vision.backbone import preprocess

        m = self.meta
        x = np.stack(
            [preprocess(v, m["mean"], m["std"], m["img_size"], m["crop_pct"]) for v in views]
        )
        t = self._torch.from_numpy(x).to(self.device)
        logits = self._logits(t)
        if self.half and not np.isfinite(logits).all():  # fp16 overflow (DINOv3): fp32 for good
            self.model, self.half = self.model.float(), False
            logits = self._logits(t)
        return softmax(logits, m["temperature"]).mean(0)

    def _logits(self, t) -> np.ndarray:
        with self._torch.no_grad():
            t = t.half() if self.half else t.float()
            if self.probe is None:
                return self.model(t).float().cpu().numpy()
            from services.vision.backbone import pool_features

            return self.probe(pool_features(self.model, t).float()).cpu().numpy()


def load_structure_model(bundle_dir: Path, meta: dict, device) -> FineTunedHead | None:
    """The bundle's fine-tuned Head A (training/scanner/install_head_a.py), if it names one."""
    ref = meta.get("structure_model")
    return FineTunedHead(Path(bundle_dir) / ref["dir"], device) if ref else None


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
        self.structure_model = load_structure_model(bundle_dir, self.meta, device)

    def predict(self, views: list[np.ndarray]) -> VisionOutput:
        from services.vision.backbone import pool_features, preprocess

        x = np.stack(
            [preprocess(v, self.mean, self.std, self.img_size, self.crop_pct) for v in views]
        )
        t = self._torch.from_numpy(x).to(self.device)
        with self._torch.no_grad():
            f = pool_features(self.model, t.half() if self.half else t).float().cpu().numpy()
        probs = {n: head_probs(f, self.specs[n]) for n in HEAD_NAMES if n in self.specs}
        classes = {n: self.specs[n].classes for n in probs}
        if self.structure_model is not None:  # the fine-tuned Head A replaces the linear one
            probs["structure"] = self.structure_model.probs(views)
            classes["structure"] = self.structure_model.classes
        out = {n: None for n in HEAD_NAMES}
        candidates = {}
        for n, p in probs.items():
            threshold = (
                self.structure_model.meta["threshold"]
                if n == "structure" and self.structure_model is not None
                else self.specs[n].threshold
            )
            out[n] = decide(p, classes[n], threshold)
            if out[n] is None:
                candidates[n] = closest(p, classes[n])
        return VisionOutput(**out, candidates=candidates)
