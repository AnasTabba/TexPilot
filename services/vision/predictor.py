"""Vision inference boundary.

The API depends on ``Predictor``, never on a concrete model, so the service runs
end-to-end from day one and P3 is not blocked waiting on P1's checkpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class HeadOutput:
    label: str
    confidence: float
    topk: list[tuple[str, float]]


@dataclass(frozen=True)
class VisionOutput:
    structure: HeadOutput | None
    treatment: HeadOutput | None
    fibre_family: HeadOutput | None


@runtime_checkable
class Predictor(Protocol):
    def predict(self, image_bytes: bytes) -> VisionOutput: ...


class StubPredictor:
    """Returns nothing, so every scan abstains.

    This is the correct placeholder: abstention is a real verdict in this system
    (spec 3), not an error path, so a model-less service is honest rather than
    broken. Replace with the trained model -- do not make this one guess.
    """

    def predict(self, image_bytes: bytes) -> VisionOutput:  # noqa: ARG002
        return VisionOutput(structure=None, treatment=None, fibre_family=None)
