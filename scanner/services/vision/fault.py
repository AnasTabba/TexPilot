"""Fabric fault check on the garment crop: tile, score, stitch, regions, heatmap.

The network is not wired yet: ``_load_model`` and the tile contract are the only parts the
Dinomaly export has to supply. Everything else here runs and is tested with a stub model.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from services.vision.predictor import FaultOutput, FaultRegion

TILE = 392
MAX_TILES = 6
OVERLAP = 0.25
#: A garment box covering less of the photo than this is too small for a close-up fault check.
MIN_BOX_FRACTION = 0.15
SMALL_REASON = "garment too small for a close-up fault check"
MAX_REGIONS = 5
HEATMAP_MAX = 512


def _starts(n: int, size: int, stride: int) -> list[int]:
    if n <= size:
        return [0]
    return [*range(0, n - size, stride), n - size]


def tile_boxes(h: int, w: int, size: int = TILE, overlap: float = OVERLAP):
    """(x0, y0, x1, y1) tiles covering an h x w image; a side shorter than ``size`` is one tile."""
    stride = int(size * (1 - overlap))
    return [
        (x, y, min(x + size, w), min(y + size, h))
        for y in _starts(h, size, stride)
        for x in _starts(w, size, stride)
    ]


def _fit_scale(h: int, w: int) -> float:
    """Largest scale (stepping down by 10 %) at which the crop needs at most MAX_TILES tiles."""
    s = 1.0
    while len(tile_boxes(max(1, round(h * s)), max(1, round(w * s)))) > MAX_TILES:
        s *= 0.9
    return s


def _stitch(maps, boxes, h: int, w: int) -> np.ndarray:
    """Per-pixel max over the tile maps; a map of the wrong size is resized to its box."""
    import cv2

    out = np.zeros((h, w), np.float32)
    for m, (x0, y0, x1, y1) in zip(maps, boxes, strict=True):
        m = np.asarray(m, np.float32)
        if m.shape != (y1 - y0, x1 - x0):
            m = cv2.resize(m, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
        out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], m)
    return out


def _heatmap_b64(image: np.ndarray, crop: tuple[int, int, int, int], amap, thr: float) -> str:
    """JET overlay on the whole photo, the map placed where the crop was; <= HEATMAP_MAX px."""
    import cv2

    cx0, cy0, cx1, cy1 = crop
    h, w = image.shape[:2]
    full = np.zeros((h, w), np.float32)
    full[cy0:cy1, cx0:cx1] = cv2.resize(amap, (cx1 - cx0, cy1 - cy0))
    alpha = np.zeros((h, w, 1), np.float32)
    alpha[cy0:cy1, cx0:cx1] = 0.5
    # Scale so the threshold sits mid-colour: 0 = blue, threshold = green, 2x threshold = red.
    u8 = (np.clip(full / max(2 * thr, 1e-6), 0, 1) * 255).astype(np.uint8)
    jet = cv2.cvtColor(cv2.applyColorMap(u8, cv2.COLORMAP_JET), cv2.COLOR_BGR2RGB)
    over = (image * (1 - alpha) + jet * alpha).astype(np.uint8)
    s = min(1.0, HEATMAP_MAX / max(h, w))
    over = cv2.resize(over, (max(1, round(w * s)), max(1, round(h * s))), cv2.INTER_AREA)
    ok, png = cv2.imencode(".png", cv2.cvtColor(over, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError("heatmap PNG encode failed")
    return base64.b64encode(png.tobytes()).decode("ascii")


class FaultDetector:
    def __init__(self, model_dir: Path, device):
        model_dir = Path(model_dir)
        if not model_dir.is_dir():
            raise FileNotFoundError(f"fault model folder not found: {model_dir}")
        for name in ("config.json", "weights.pt"):
            if not (model_dir / name).is_file():
                raise FileNotFoundError(f"fault model file missing: {model_dir / name}")
        cfg = json.loads((model_dir / "config.json").read_text())
        self.device = device
        self.version = str(cfg["version"])
        self.backbone = cfg["backbone"]
        self.image_size = int(cfg["image_size"])
        thresholds = cfg["thresholds"]
        default = thresholds["default"] if "default" in thresholds else max(thresholds.values())
        self.threshold = float(default)
        self.model = self._load_model()

    def _load_model(self):
        """Return a callable: HxWx3 uint8 RGB tile -> HxW float anomaly map (same H, W)."""
        raise NotImplementedError("fault model loader is added with the Dinomaly export")

    def _score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:
        """One HxW anomaly map per tile, same HxW as the tile (the model resizes internally)."""
        return [np.asarray(self.model(t), np.float32) for t in tiles]

    def detect(
        self, image: np.ndarray, box: tuple[float, float, float, float] | None
    ) -> FaultOutput:
        thr = self.threshold
        if box is None:
            box, frac = (0.0, 0.0, 1.0, 1.0), 1.0
        else:
            x0, y0, x1, y1 = (min(1.0, max(0.0, v)) for v in box)
            frac = (x1 - x0) * (y1 - y0)
            box = (x0, y0, x1, y1)
        if frac < MIN_BOX_FRACTION:
            return FaultOutput(0.0, False, thr, (), None, self.version, SMALL_REASON)

        h, w = image.shape[:2]
        bx0, by0, bx1, by1 = box
        cx0 = min(int(round(bx0 * w)), w - 1)
        cy0 = min(int(round(by0 * h)), h - 1)
        cx1 = min(max(int(round(bx1 * w)), cx0 + 1), w)
        cy1 = min(max(int(round(by1 * h)), cy0 + 1), h)
        crop = image[cy0:cy1, cx0:cx1]
        ch, cw = crop.shape[:2]

        s = _fit_scale(ch, cw)
        if s < 1:
            import cv2

            size = (max(1, round(cw * s)), max(1, round(ch * s)))
            crop = cv2.resize(crop, size, interpolation=cv2.INTER_AREA)
        wh, ww = crop.shape[:2]
        boxes = tile_boxes(wh, ww)
        maps = self._score_tiles([crop[y0:y1, x0:x1] for x0, y0, x1, y1 in boxes])
        amap = _stitch(maps, boxes, wh, ww)
        score = float(amap.max())

        # Working-crop pixels -> normalised full-photo coordinates.
        fx, fy = cw / ww, ch / wh

        def to_photo(x0, y0, x1, y1):
            return (
                (cx0 + x0 * fx) / w,
                (cy0 + y0 * fy) / h,
                (cx0 + x1 * fx) / w,
                (cy0 + y1 * fy) / h,
            )

        from scipy import ndimage

        labels, n = ndimage.label(amap > thr)
        regions = []
        for i, sl in enumerate(ndimage.find_objects(labels, max_label=n), start=1):
            region_score = float(amap[sl][labels[sl] == i].max())
            regions.append(
                FaultRegion(
                    to_photo(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop), region_score
                )
            )
        regions.sort(key=lambda r: r.score, reverse=True)

        return FaultOutput(
            score=score,
            is_fault=score > thr,
            threshold=thr,
            regions=tuple(regions[:MAX_REGIONS]),
            heatmap_png_b64=_heatmap_b64(image, (cx0, cy0, cx1, cy1), amap, thr),
            model_version=self.version,
        )


class StopLatch:
    """True once K of the last N updates were faults; stays True until reset()."""

    def __init__(self, k: int = 3, n: int = 5):
        if not 1 <= k <= n:
            raise ValueError(f"need 1 <= k <= n, got k={k} n={n}")
        self.k, self.n = k, n
        self._hist: list[bool] = []
        self._latched = False

    def update(self, is_fault: bool) -> bool:
        self._hist.append(bool(is_fault))
        del self._hist[: -self.n]
        if sum(self._hist) >= self.k:
            self._latched = True
        return self._latched

    def reset(self) -> None:
        self._hist.clear()
        self._latched = False
