from __future__ import annotations

import numpy as np

from training.fault.perturb import PERTURBATIONS

KEYS = {
    "brightness_up",
    "brightness_down",
    "warm",
    "cool",
    "gauss_blur",
    "motion_blur",
    "jpeg30",
    "noise",
}


def _img(seed: int = 2026) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 256, (48, 64, 3), dtype=np.uint8)


def test_key_set_is_exactly_the_eight_names() -> None:
    assert set(PERTURBATIONS) == KEYS


def test_every_key_keeps_shape_and_dtype() -> None:
    img = _img()
    for name, fn in PERTURBATIONS.items():
        out = fn(img, np.random.default_rng(0))
        assert out.shape == img.shape, name
        assert out.dtype == np.uint8, name


def test_brightness_up_increases_mean() -> None:
    img = _img()
    out = PERTURBATIONS["brightness_up"](img, np.random.default_rng(0))
    assert out.mean() > img.mean()


def test_brightness_up_saturates_without_wraparound() -> None:
    img = np.full((8, 8, 3), 250, dtype=np.uint8)
    out = PERTURBATIONS["brightness_up"](img, np.random.default_rng(0))
    assert (out == 255).all()


def test_warm_raises_red_and_lowers_blue() -> None:
    img = _img()
    out = PERTURBATIONS["warm"](img, np.random.default_rng(0))
    assert out[..., 0].mean() > img[..., 0].mean()
    assert out[..., 2].mean() < img[..., 2].mean()


def test_jpeg30_changes_image() -> None:
    img = _img()
    out = PERTURBATIONS["jpeg30"](img, np.random.default_rng(0))
    assert not np.array_equal(out, img)


def test_jpeg30_keeps_red_red() -> None:
    img = np.zeros((32, 32, 3), dtype=np.uint8)
    img[..., 0] = 255
    out = PERTURBATIONS["jpeg30"](img, np.random.default_rng(0))
    assert out[..., 0].mean() > out[..., 1].mean() + 100
    assert out[..., 0].mean() > out[..., 2].mean() + 100


def test_noise_is_deterministic_for_same_seed() -> None:
    img = _img()
    a = PERTURBATIONS["noise"](img, np.random.default_rng(7))
    b = PERTURBATIONS["noise"](img, np.random.default_rng(7))
    assert np.array_equal(a, b)
