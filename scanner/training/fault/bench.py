"""Benchmark a fault-detection method: fit on train tiles, threshold on calib good tiles at
FAR 0.5 %, then image and pixel metrics on test images. Images are held one category at a time."""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
from PIL import Image

from training.fault.data import Sample
from training.fault.metrics import image_metrics, operating_point, pixel_metrics, threshold_at_far
from training.fault.perturb import PERTURBATIONS
from training.fault.tiles import load_rgb, stitch, tile_boxes

TILE = 392
OVERLAP = 0.25
FAR = 0.005
SEED = 2026
MODES = ("per_category", "unified")


class Method(Protocol):
    name: str

    def fit(self, train: list[np.ndarray]) -> None: ...

    def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:  # one H×W map per tile
        ...


def _tiles(img: np.ndarray) -> tuple[list[np.ndarray], list[tuple[int, int, int, int]]]:
    h, w = img.shape[:2]
    boxes = tile_boxes(h, w, TILE, OVERLAP)
    tiles = []
    for x0, y0, x1, y1 in boxes:
        t = img[y0:y1, x0:x1]
        if t.shape[:2] != (TILE, TILE):
            shrink = t.shape[0] > TILE or t.shape[1] > TILE
            interp = cv2.INTER_AREA if shrink else cv2.INTER_LINEAR
            t = cv2.resize(t, (TILE, TILE), interpolation=interp)
        tiles.append(np.ascontiguousarray(t))
    return tiles, boxes


def _train_tiles(samples: list[Sample]) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    for s in samples:
        out += _tiles(load_rgb(s.path))[0]
    return out


def _calib_threshold(method: Method, samples: list[Sample]) -> float:
    tile_max: list[float] = []
    if getattr(method, "transductive", False):  # all calib tiles of the category in one call
        tiles = [t for s in samples for t in _tiles(load_rgb(s.path))[0]]
        tile_max = [float(np.max(m)) for m in method.score_tiles(tiles)]
    else:
        for s in samples:
            tiles, _ = _tiles(load_rgb(s.path))
            tile_max += [float(np.max(m)) for m in method.score_tiles(tiles)]
    return threshold_at_far(np.array(tile_max), FAR)


def _mask(sample: Sample, h: int, w: int) -> np.ndarray:
    out = np.zeros((h, w), np.uint8)
    if sample.mask is None:
        return out
    for path in sample.mask.split(";"):  # several masks mean their union
        m = (np.asarray(Image.open(path).convert("L")) > 127).astype(np.uint8)
        if m.shape != (h, w):
            m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
        out |= m
    return out


def _score_test(
    method: Method, test: list[Sample], perturbation: str | None
) -> Iterator[tuple[Sample, tuple[int, int], list, list[np.ndarray], float, int]]:
    """Yield (sample, (h, w), tile boxes, tile maps, latency ms, tile count) per test image.
    A transductive method scores all test tiles in one call; latency is that call per image."""
    rng = np.random.default_rng(SEED)

    def load(sample: Sample) -> tuple[Sample, tuple[int, int], list[np.ndarray], list]:
        img = load_rgb(sample.path)
        if perturbation is not None:
            img = PERTURBATIONS[perturbation](img, rng)
        tiles, boxes = _tiles(img)
        return sample, img.shape[:2], tiles, boxes

    if getattr(method, "transductive", False):
        loaded = [load(s) for s in test]
        if not loaded:
            return
        t0 = time.perf_counter()
        flat = method.score_tiles([t for _, _, tiles, _ in loaded for t in tiles])
        ms = (time.perf_counter() - t0) * 1000.0 / len(loaded)
        i = 0
        for s, hw, tiles, boxes in loaded:
            yield s, hw, boxes, flat[i : i + len(tiles)], ms, len(tiles)
            i += len(tiles)
        return
    for s0 in test:
        s, hw, tiles, boxes = load(s0)
        t0 = time.perf_counter()
        tile_maps = method.score_tiles(tiles)
        yield s, hw, boxes, tile_maps, (time.perf_counter() - t0) * 1000.0, len(tiles)


def _evaluate(
    method: Method,
    key: tuple[str, str],
    test: list[Sample],
    threshold: float,
    perturbation: str | None,
    mode: str,
) -> dict:
    has_real_mask = any(s.mask is not None for s in test)
    unmasked_defects = sum(1 for s in test if s.label == 1 and s.mask is None)
    scores: list[float] = []
    labels: list[int] = []
    maps: list[np.ndarray] = []
    masks: list[np.ndarray] = []
    latencies: list[float] = []
    tile_counts: list[int] = []
    for s, (h, w), boxes, tile_maps, ms, n_tiles in _score_test(method, test, perturbation):
        latencies.append(ms)
        tile_counts.append(n_tiles)
        stitched = stitch(tile_maps, boxes, h, w)
        scores.append(float(stitched.max()))
        labels.append(s.label)
        if has_real_mask and not (s.label == 1 and s.mask is None):
            maps.append(stitched)
            masks.append(_mask(s, h, w))

    if unmasked_defects:
        print(
            f"WARNING: {key[0]}/{key[1]}: {unmasked_defects} defect image(s) had no mask; "
            "excluded from pixel metrics"
        )
    y, s_arr = np.array(labels), np.array(scores)
    im = image_metrics(y, s_arr)
    if has_real_mask:
        px = pixel_metrics(masks, maps)
    else:
        px = {"pixel_auroc": None, "pixel_ap": None, "aupro": None}
    op = operating_point(y, s_arr, threshold)
    return {
        "dataset": key[0],
        "category": key[1],
        "method": method.name,
        "mode": mode,
        "perturbation": perturbation,
        "auroc": im["auroc"],
        "ap": im["ap"],
        "pixel_auroc": px["pixel_auroc"],
        "pixel_ap": px["pixel_ap"],
        "aupro": px["aupro"],
        "f1": op["f1"],
        "recall": op["recall"],
        "precision": op["precision"],
        "false_alarms_per_1000": op["false_alarms_per_1000"],
        "fa_ci95": op["fa_ci95"],
        "n_good": op["n_good"],
        "n_defect": op["n_defect"],
        "threshold": threshold,
        "latency_ms": float(np.mean(latencies)) if latencies else None,
        "tiles_per_image": float(np.mean(tile_counts)) if tile_counts else None,
    }


def run_benchmark(
    method: Method,
    samples: list[Sample],
    out_json: Path,
    perturbation: str | None = None,
    mode: str = "per_category",
) -> dict:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    if perturbation is not None and perturbation not in PERTURBATIONS:
        raise ValueError(f"unknown perturbation {perturbation!r}")

    groups: dict[tuple[str, str], dict[str, list[Sample]]] = {}
    for s in samples:
        parts = groups.setdefault((s.dataset, s.category), {"train": [], "calib": [], "test": []})
        parts[s.split].append(s)

    valid: list[tuple[str, str]] = []
    for key, parts in groups.items():
        if parts["train"] and parts["calib"]:
            valid.append(key)
        else:
            print(f"WARNING: skipping {key[0]}/{key[1]}: no train or no calib samples")

    timing = {"load_tile_seconds": 0.0, "fit_seconds": 0.0,
              "evaluation_seconds": 0.0, "train_tiles": 0, "test_images": 0, "test_tiles": 0}

    def fit(train_samples):
        started = time.perf_counter()
        tiles = _train_tiles(train_samples)
        timing["load_tile_seconds"] += time.perf_counter() - started
        timing["train_tiles"] += len(tiles)
        started = time.perf_counter()
        method.fit(tiles)
        timing["fit_seconds"] += time.perf_counter() - started

    if mode == "unified" and valid:
        fit([s for key in valid for s in groups[key]["train"]])

    rows: list[dict] = []
    for key in valid:
        parts = groups[key]
        if mode == "per_category":
            fit(parts["train"])
        started = time.perf_counter()
        threshold = _calib_threshold(method, parts["calib"])
        row = _evaluate(method, key, parts["test"], threshold, perturbation, mode)
        rows.append(row)
        timing["evaluation_seconds"] += time.perf_counter() - started
        timing["test_images"] += len(parts["test"])
        timing["test_tiles"] += round((row["tiles_per_image"] or 0) * len(parts["test"]))

    out_json = Path(out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(rows, indent=2))
    return {"rows": rows, "timing": timing}
