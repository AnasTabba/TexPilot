"""Garment detector backends (spec §4.2). Each imports its heavy dependencies lazily."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import numpy as np

    from services.vision.garment import Detection


class GarmentDetector(Protocol):
    name: str
    default_min_score: float  # τ_det before the bake-off tunes it (spec §4.3)

    def detect(self, image: np.ndarray) -> list[Detection]: ...


def load_detector(name: str, device) -> GarmentDetector:
    if name == "gdino":
        from services.vision.detectors.gdino import GroundingDinoDetector

        return GroundingDinoDetector(device)
    if name == "owlv2":
        from services.vision.detectors.owlv2 import Owlv2Detector

        return Owlv2Detector(device)
    if name == "florence2":
        from services.vision.detectors.florence2 import Florence2Detector

        return Florence2Detector(device)
    raise ValueError(f"unknown garment detector {name!r}; choose 'gdino', 'owlv2' or 'florence2'")
