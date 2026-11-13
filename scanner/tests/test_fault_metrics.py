"""Fault-detection metrics: image/pixel scores, AUPRO, operating point, paired bootstrap."""

import json

import numpy as np
import pytest

from training.fault.metrics import (
    image_metrics,
    operating_point,
    paired_bootstrap_f1,
    pixel_metrics,
    threshold_at_far,
)


def _blob_masks(rng: np.random.Generator, n: int = 4, size: int = 128) -> list[np.ndarray]:
    masks = []
    for _ in range(n):
        m = np.zeros((size, size), dtype=np.uint8)
        y, x = rng.integers(10, size - 30, size=2)
        m[y : y + 20, x : x + 20] = 1
        masks.append(m)
    return masks


def test_perfect_scores_auroc_1():
    r = image_metrics(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9]))
    assert r["auroc"] == pytest.approx(1.0)
    assert r["ap"] == pytest.approx(1.0)


def test_all_good_labels_gives_none():
    r = image_metrics(np.array([0, 0, 0]), np.array([0.1, 0.5, 0.9]))
    assert r == {"auroc": None, "ap": None}


def test_aupro_of_mask_map_is_near_one():
    rng = np.random.default_rng(2026)
    masks = _blob_masks(rng)
    maps = [m.astype(np.float32) for m in masks]
    r = pixel_metrics(masks, maps)
    assert r["aupro"] >= 0.99


def test_aupro_of_random_noise_is_low():
    rng = np.random.default_rng(2026)
    masks = _blob_masks(rng)
    maps = [rng.random(m.shape).astype(np.float32) for m in masks]
    r = pixel_metrics(masks, maps)
    assert r["aupro"] < 0.5


def test_pixel_metrics_all_empty_masks_gives_none():
    rng = np.random.default_rng(2026)
    masks = [np.zeros((64, 64), dtype=np.uint8) for _ in range(3)]
    maps = [rng.random((64, 64)).astype(np.float32) for _ in range(3)]
    assert pixel_metrics(masks, maps) == {"pixel_auroc": None, "pixel_ap": None, "aupro": None}


def test_pixel_metrics_255_masks_match_01_masks():
    rng = np.random.default_rng(2026)
    masks = _blob_masks(rng)
    maps = [m.astype(np.float32) for m in masks]
    assert pixel_metrics([m * 255 for m in masks], maps) == pixel_metrics(masks, maps)


def test_trapezoid_falls_back_when_numpy_lacks_trapezoid(monkeypatch):
    from training.fault import metrics as metrics_mod

    x = np.linspace(0.0, 1.0, 11)
    y = x**2
    expected = float(np.sum((y[1:] + y[:-1]) / 2.0 * np.diff(x)))

    monkeypatch.delattr(np, "trapezoid", raising=False)  # simulate NumPy 1.26

    assert metrics_mod._trapezoid(y, x) == pytest.approx(expected)
    rng = np.random.default_rng(2026)
    masks = _blob_masks(rng)
    r = metrics_mod.pixel_metrics(masks, [m.astype(np.float32) for m in masks])
    assert r["aupro"] >= 0.99


def test_threshold_at_far():
    thr = threshold_at_far(np.arange(1000, dtype=float), far=0.005)
    assert thr == pytest.approx(994.005, abs=1.0)


def test_operating_point_zero_false_alarms_ci():
    labels = np.array([0] * 1000 + [1] * 10)
    scores = np.concatenate([np.zeros(1000), np.ones(10)])
    r = operating_point(labels, scores, thr=0.5)
    assert r["false_alarms_per_1000"] == 0
    assert 3.0 < r["fa_ci95"][1] < 3.8
    assert r["fa_ci95"][0] == 0
    assert r["recall"] == 1.0
    assert r["n_good"] == 1000 and r["n_defect"] == 10


def test_operating_point_false_alarm_rate_and_ci_contains_it():
    labels = np.array([0] * 200 + [1] * 50)
    scores = np.concatenate([np.r_[np.ones(10), np.zeros(190)], np.ones(50)])
    r = operating_point(labels, scores, thr=0.5)
    assert r["false_alarms_per_1000"] == pytest.approx(50.0)
    lo, hi = r["fa_ci95"]
    assert lo < 50.0 < hi


def test_operating_point_no_good_images_gives_none_fa():
    r = operating_point(np.ones(5, dtype=int), np.arange(5, dtype=float), thr=2.0)
    assert r["false_alarms_per_1000"] is None
    assert r["fa_ci95"] is None
    assert r["recall"] == pytest.approx(0.4)


def test_operating_point_no_defects_gives_none_recall():
    r = operating_point(np.zeros(5, dtype=int), np.arange(5, dtype=float), thr=10.0)
    assert r["recall"] is None
    assert r["false_alarms_per_1000"] == 0


def test_operating_point_no_defects_gives_none_f1():
    labels = np.zeros(5, dtype=int)
    scores = np.array([0.1, 0.2, 0.3, 0.4, 0.9])
    r = operating_point(labels, scores, thr=0.5)
    assert r["recall"] is None
    assert r["f1"] is None


def test_paired_bootstrap_identical_predictions():
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, size=60)
    pred = rng.integers(0, 2, size=60)
    groups = np.repeat(np.arange(12), 5)
    r = paired_bootstrap_f1(y, pred, pred, groups, n=200)
    assert r["delta"] == 0
    assert r["ci95"][0] <= 0 <= r["ci95"][1]


def test_paired_bootstrap_clearly_better_b_is_positive():
    y = np.array([0, 1] * 100)
    groups = np.repeat(np.arange(40), 5)
    pred_a = np.zeros_like(y)  # always "good": macro-F1 well below 1
    pred_b = y.copy()
    r = paired_bootstrap_f1(y, pred_a, pred_b, groups, n=300)
    assert r["delta"] > 0
    assert r["ci95"][0] > 0


def test_outputs_are_json_serialisable_plain_types():
    rng = np.random.default_rng(2026)
    masks = _blob_masks(rng)
    maps = [m.astype(np.float32) + 0.1 * rng.random(m.shape) for m in masks]
    labels = np.array([0, 1, 0, 1, 1])
    scores = np.array([0.1, 0.9, 0.2, 0.7, 0.4])
    y = np.array([0, 1, 0, 1, 1, 0, 1, 0, 1, 1])
    p = np.array([0, 1, 1, 1, 0, 0, 1, 0, 1, 0])
    groups = np.arange(10)
    results = [
        image_metrics(labels, scores),
        pixel_metrics(masks, maps),
        operating_point(labels, scores, thr=0.5),
        paired_bootstrap_f1(y, p, y, groups, n=20),
        {"thr": threshold_at_far(np.arange(100, dtype=float))},
    ]
    for r in results:
        json.dumps(r)
        for v in r.values():
            items = v if isinstance(v, list) else [v]
            for item in items:
                assert item is None or type(item) in (float, int)
