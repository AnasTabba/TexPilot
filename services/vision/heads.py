"""Calibrated heads: linear heads on DINOv2 features, and optionally a fine-tuned Head A.
Spec §6, §10 (week 5).

Below its threshold a head returns None: the scan abstains rather than guess.
"""

from __future__ import annotations

import json
import os
import time
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


def timm_classifier(
    timm_name: str, n_classes: int, img_size: int, pretrained: bool = False, weights_file=None
):
    """The classifier training.textilenet.train builds: ViT-style models are made at the
    training size (their position embeddings are resampled to it), CNNs take any size.
    ``weights_file`` loads the pretrained weights from disk instead of the Hugging Face Hub."""
    import timm

    kwargs = {"img_size": img_size} if timm_name.startswith(("vit_", "eva", "deit", "beit")) else {}
    if weights_file is not None:
        kwargs["pretrained_cfg_overlay"] = {"file": str(weights_file)}
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
        # A product scope (head.json "scope"): dropped classes can't be answered, merged ones add
        # into their target. ``self._scope`` maps the model's classes onto the answerable ones.
        # Per-class logit bias tuned on val for macro F1 at export (head.json "class_bias").
        self._bias = np.asarray(self.meta.get("class_bias", 0.0), np.float32)
        self._scope = None
        if scope := self.meta.get("scope"):
            merge, drop = scope.get("merge", {}), set(scope.get("drop", []))
            kept = tuple(c for c in self.classes if c not in drop and c not in merge)
            self._scope = np.zeros((len(self.classes), len(kept)), np.float32)
            for i, c in enumerate(self.classes):
                if c not in drop:
                    self._scope[i, kept.index(merge.get(c, c))] = 1.0
            self.classes = kept
        self.device, self._torch = device, torch
        self.half = device.type in ("mps", "cuda")
        m, self.probe = self.meta, None
        if m.get("pool") == "probe":
            local = head_dir / "encoder.safetensors"  # shipped when the Hub is slow to reach
            if "encoder_id" in m and not local.exists():  # a tuned encoder: the public one is wrong
                raise FileNotFoundError(f"{m['encoder_id']} needs its weights in {local}")
            model = timm_classifier(
                m["timm_name"], 0, m["img_size"], True, local if local.exists() else None
            )
            w = load_file(str(head_dir / "probe.safetensors"))
            w = {k.removeprefix("probe."): v for k, v in w.items()}
            if "weight" in w:  # linear
                self.probe = torch.nn.Linear(*w["weight"].shape[::-1])
            else:  # small MLP: Linear, GELU, Dropout, Linear (training/textilenet/head_search.py)
                self.probe = torch.nn.Sequential(
                    torch.nn.Linear(*w["0.weight"].shape[::-1]),
                    torch.nn.GELU(),
                    torch.nn.Dropout(0.0),
                    torch.nn.Linear(*w["3.weight"].shape[::-1]),
                )
            self.probe.load_state_dict(w)
            self.probe = self.probe.eval().to(device)
        else:
            model = timm_classifier(m["timm_name"], len(self.classes), m["img_size"])
            model.load_state_dict(load_file(str(head_dir / "model.safetensors")))
        # Halve before moving: a 400M-parameter encoder must not sit on the GPU in fp32 first.
        model = model.eval().half() if self.half else model.eval()
        self.model = model.to(device)

    @property
    def encoder_id(self) -> str:
        """Names the encoder weights: the timm name, plus a LoRA digest when tuned."""
        return self.meta.get("encoder_id", self.meta["timm_name"])

    def predict(self, views: list[np.ndarray]) -> HeadOutput | None:
        return decide(self.probs(views), self.classes, self.meta["threshold"])

    def probs(self, views: list[np.ndarray]) -> np.ndarray:
        if self.probe is not None:
            return self.probs_from_features(self.features(views))
        p = softmax(
            self._run(lambda t: self.model(t), views) + self._bias, self.meta["temperature"]
        )
        return self._scoped(p).mean(0)

    def features(self, views: list[np.ndarray]) -> np.ndarray:
        """A probe head's pooled encoder features (V, D): shared with the heads a factory
        teaches on the same encoder (services/vision/custom.py)."""
        from services.vision.backbone import pool_features

        return self._run(lambda t: pool_features(self.model, t), views)

    def probs_from_features(self, features: np.ndarray) -> np.ndarray:
        with self._torch.no_grad():
            logits = self.probe(self._torch.from_numpy(features).to(self.device)).cpu().numpy()
        return self._scoped(softmax(logits + self._bias, self.meta["temperature"])).mean(0)

    def _scoped(self, p: np.ndarray) -> np.ndarray:
        """Per-view probabilities over the answerable classes, renormalised after a drop."""
        if self._scope is None:
            return p
        q = p @ self._scope
        return q / q.sum(-1, keepdims=True)

    def _run(self, fn, views: list[np.ndarray]) -> np.ndarray:
        """``fn`` on the preprocessed views: fp16 on a GPU, and for good in fp32 once fp16
        overflows (DINOv3 does)."""
        from services.vision.backbone import preprocess

        m = self.meta
        x = np.stack(
            [preprocess(v, m["mean"], m["std"], m["img_size"], m["crop_pct"]) for v in views]
        )
        t = self._torch.from_numpy(x).to(self.device)
        while True:
            with self._torch.no_grad():
                out = fn(t.half() if self.half else t.float()).float().cpu().numpy()
            if np.isfinite(out).all() or not self.half:
                return out
            self.model, self.half = self.model.float(), False


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

    custom_encoder: FineTunedHead | None = None  # an earlier Head A, for heads taught on it

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
        self.custom = []  # heads the factory taught on Head A's encoder (services/vision/custom.py)
        if self.structure_model is not None and self.structure_model.probe is not None:
            from services.vision.custom import load_custom_heads

            root = Path(os.environ.get("TEXPILOT_CUSTOM_HEADS", "models/custom"))
            self.custom = load_custom_heads(root, self.structure_model.encoder_id)
            # Heads taught on an earlier Head A keep answering after an upgrade: its encoder runs
            # as a second pass (TEXPILOT_CUSTOM_ENCODER=models/scanner-v7/head_a) until re-taught.
            if src := os.environ.get("TEXPILOT_CUSTOM_ENCODER"):
                enc = FineTunedHead(Path(src), device)
                if enc.encoder_id != self.structure_model.encoder_id:
                    self.custom_encoder = enc
                    self.custom += load_custom_heads(root, enc.encoder_id)

    def predict(self, views: list[np.ndarray]) -> VisionOutput:
        from services.vision.backbone import pool_features, preprocess

        x = np.stack(
            [preprocess(v, self.mean, self.std, self.img_size, self.crop_pct) for v in views]
        )
        clock = time.perf_counter()
        t = self._torch.from_numpy(x).to(self.device)
        with self._torch.no_grad():
            f = pool_features(self.model, t.half() if self.half else t).float().cpu().numpy()
        probs = {n: head_probs(f, self.specs[n]) for n in HEAD_NAMES if n in self.specs}
        timings = {"fibre_model": round(1000 * (time.perf_counter() - clock), 1)}
        clock = time.perf_counter()
        classes = {n: self.specs[n].classes for n in probs}
        features = None
        if self.structure_model is not None:  # the fine-tuned Head A replaces the linear one
            if self.structure_model.probe is not None:  # one encoder pass, shared with custom
                features = self.structure_model.features(views)
                probs["structure"] = self.structure_model.probs_from_features(features)
            else:
                probs["structure"] = self.structure_model.probs(views)
            classes["structure"] = self.structure_model.classes
            timings["fabric_model"] = round(1000 * (time.perf_counter() - clock), 1)
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
        custom, by_encoder = {}, {}
        if features is not None:
            by_encoder[self.structure_model.encoder_id] = features
            if self.custom_encoder is not None:
                clock = time.perf_counter()
                by_encoder[self.custom_encoder.encoder_id] = self.custom_encoder.features(views)
                timings["taught_model"] = round(1000 * (time.perf_counter() - clock), 1)
        for head in (h for h in self.custom if h.encoder in by_encoder):
            p = head.probs(by_encoder[head.encoder])
            custom[head.name] = decide(p, head.classes, head.threshold)
            if custom[head.name] is None:
                candidates[head.name] = closest(p, head.classes)
        return VisionOutput(**out, candidates=candidates, custom=custom, timings_ms=timings)
