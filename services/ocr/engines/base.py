"""What every OCR engine returns. Stdlib only."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import numpy as np


@dataclass(frozen=True)
class TextLine:
    text: str
    confidence: float  # 0-1
    box: tuple[float, float, float, float]  # pixels (x0, y0, x1, y1), origin top-left


class OcrEngine(Protocol):
    name: str

    def read(self, image: np.ndarray) -> list[TextLine]: ...
