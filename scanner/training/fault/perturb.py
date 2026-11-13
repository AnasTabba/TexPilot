"""Factory-floor perturbations for robustness tests. Input and output: HxWx3 RGB uint8."""

from __future__ import annotations

from collections.abc import Callable

import cv2
import numpy as np

Perturb = Callable[[np.ndarray, np.random.Generator], np.ndarray]


def _to_uint8(x: np.ndarray) -> np.ndarray:
    # Clip before cast so overflow saturates at 255 instead of wrapping.
    return np.clip(np.rint(x), 0, 255).astype(np.uint8)


def _scale(img: np.ndarray, factors: tuple[float, float, float]) -> np.ndarray:
    return _to_uint8(img.astype(np.float32) * np.asarray(factors, dtype=np.float32))


def _gauss_blur(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    return _to_uint8(cv2.GaussianBlur(img, (0, 0), sigmaX=2))


def _motion_blur(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    kernel = np.zeros((9, 9), dtype=np.float32)
    kernel[4, :] = 1.0 / 9.0
    return _to_uint8(cv2.filter2D(img.astype(np.float32), -1, kernel))


def _jpeg30(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 30])
    if not ok:
        raise ValueError("JPEG encode failed")
    decoded = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)


def _noise(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    return _to_uint8(img.astype(np.float32) + rng.normal(0.0, 8.0, img.shape))


# Channel order is RGB, so index 0 is red and index 2 is blue.
PERTURBATIONS: dict[str, Perturb] = {
    "brightness_up": lambda img, rng: _scale(img, (1.3, 1.3, 1.3)),
    "brightness_down": lambda img, rng: _scale(img, (0.7, 0.7, 0.7)),
    "warm": lambda img, rng: _scale(img, (1.1, 1.0, 0.9)),
    "cool": lambda img, rng: _scale(img, (0.9, 1.0, 1.1)),
    "gauss_blur": _gauss_blur,
    "motion_blur": _motion_blur,
    "jpeg30": _jpeg30,
    "noise": _noise,
}
