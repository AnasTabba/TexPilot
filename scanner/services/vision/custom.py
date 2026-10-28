"""Heads a factory teaches the scanner itself, e.g. its wash types, from its own labelled
photos (training/scanner/teach.py).

Each is a linear layer on the pooled features of the Head A encoder, so it costs no extra
pass through the encoder. They live outside the immutable bundles, in models/custom/<name>/,
and load only on the encoder they were taught on. Like the built-in heads they abstain below a
threshold set, when taught, for 90% accuracy on the factory's own photos (cross-validated).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from services.vision.heads import HEAD_NAMES, decide, softmax
from services.vision.predictor import HeadOutput


@dataclass(frozen=True)
class CustomHead:
    name: str
    classes: tuple[str, ...]
    weight: np.ndarray  # (C, D) on the raw pooled features: the standardisation is folded in
    bias: np.ndarray
    threshold: float
    encoder: str  # encoder_id of the Head A it was taught on (FineTunedHead.encoder_id)
    report: dict = field(default_factory=dict)  # photos per class, cross-validated accuracy

    @property
    def digest(self) -> str:
        """Short content hash: a stored scan says which teaching of a head answered it."""
        h = hashlib.sha256(self.weight.tobytes() + self.bias.tobytes())
        return h.hexdigest()[:8]

    def probs(self, features: np.ndarray) -> np.ndarray:
        return softmax(features @ self.weight.T + self.bias).mean(0)

    def predict(self, features: np.ndarray) -> HeadOutput | None:
        return decide(self.probs(features), self.classes, self.threshold)

    def save(self, root: Path) -> Path:
        from safetensors.numpy import save_file

        d = Path(root) / self.name
        d.mkdir(parents=True, exist_ok=True)
        save_file(
            {"weight": self.weight.astype(np.float32), "bias": self.bias.astype(np.float32)},
            str(d / "head.safetensors"),
        )
        meta = dict(classes=list(self.classes), threshold=self.threshold, encoder=self.encoder)
        (d / "head.json").write_text(json.dumps(meta | {"report": self.report}, indent=1))
        return d


def load_custom_heads(root: Path, encoder: str) -> list[CustomHead]:
    """The heads under ``root`` taught on ``encoder``; others would read meaningless features."""
    from safetensors.numpy import load_file

    heads = []
    for path in sorted(Path(root).glob("*/head.json")) if Path(root).is_dir() else []:
        meta = json.loads(path.read_text())
        name = path.parent.name
        if meta["encoder"] != encoder or name in HEAD_NAMES:
            continue
        w = load_file(str(path.parent / "head.safetensors"))
        heads.append(
            CustomHead(
                name,
                tuple(meta["classes"]),
                w["weight"],
                w["bias"],
                float(meta["threshold"]),
                encoder,
                meta.get("report", {}),
            )
        )
    return heads
