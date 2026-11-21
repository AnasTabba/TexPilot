"""Fabric fault check on the garment crop: tile, score, stitch, regions, heatmap.

``_load_model`` wraps the fault network named by config ``method``: ``dinomaly`` (trained, needs
``weights.pt``) or ``selfref`` (zero-shot, needs only ``encoder_file``). Everything else is tested
with a stub model.
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
#: The trained model learned "normal" from a few fabrics only. On a fabric unlike them its whole map
#: is raised, not one spot, so the fixed threshold flags everything. Config ``max_map_median`` marks
#: such a photo: on 17 Nov 2026 the median map value was 0.030-0.097 on all 444 WFDD test photos
#: (good and defect) and 0.108-0.332 on all 195 real garment scans, every one of which the plain
#: threshold flagged. Those photos are judged against their own level (``relative_z``) instead.
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


def _per_tile(score_tiles):
    """Per-tile callable from a batch scorer. A tile not TILE x TILE is resized to TILE x TILE for
    the network, and its map is resized back to the tile's own (w, h)."""
    import cv2

    def score(tile: np.ndarray) -> np.ndarray:
        h, w = tile.shape[:2]
        if (h, w) != (TILE, TILE):  # a crop side shorter than one tile
            tile = cv2.resize(tile, (TILE, TILE), interpolation=cv2.INTER_LINEAR)
        amap = score_tiles([np.ascontiguousarray(tile)])[0]
        return amap if (h, w) == (TILE, TILE) else cv2.resize(amap, (w, h))

    return score


class FaultDetector:
    def __init__(self, model_dir: Path, device):
        model_dir = Path(model_dir)
        if not model_dir.is_dir():
            raise FileNotFoundError(f"fault model folder not found: {model_dir}")
        if not (model_dir / "config.json").is_file():
            raise FileNotFoundError(f"fault model file missing: {model_dir / 'config.json'}")
        cfg = json.loads((model_dir / "config.json").read_text())
        self.method = str(cfg.get("method", "dinomaly"))
        if self.method not in ("dinomaly", "selfref"):
            raise ValueError(f"unknown fault method: {self.method!r}")
        if self.method == "dinomaly" and not (model_dir / "weights.pt").is_file():
            raise FileNotFoundError(f"fault model file missing: {model_dir / 'weights.pt'}")
        self.model_dir = model_dir
        self.device = device
        self.version = str(cfg["version"])
        if self.method == "dinomaly":
            self.backbone = cfg["backbone"]
        else:
            self.backbone = cfg.get("backbone", "dinov2reg_vit_base_14")
        self.image_size = int(cfg["image_size"])
        thresholds = cfg["thresholds"]
        default = thresholds["default"] if "default" in thresholds else max(thresholds.values())
        self.threshold = float(default)
        gate = cfg.get("max_map_median")
        self.max_map_median = None if gate is None else float(gate)
        self.relative_z = float(cfg.get("relative_z", 7.5))
        self._cfg = cfg
        self.model = self._load_model()

    def _load_model(self):
        """Return a callable: HxWx3 uint8 RGB tile -> HxW float anomaly map (same H, W).

        ``dinomaly``: the folder holds the trained bottleneck and decoder (``weights.pt``) and a
        ``Dinomaly`` checkout at the training pin with the DINOv2 encoder in ``backbones/weights``.
        ``selfref``: no trained weights; ``encoder_file`` is the frozen encoder, ``params`` go to
        ``SelfReference``.
        """
        if self.method == "selfref":
            from training.fault.methods.selfref import SelfReference

            if "encoder_file" not in self._cfg:
                raise ValueError(f"selfref config needs 'encoder_file': {self.model_dir}")
            encoder = self.model_dir / self._cfg["encoder_file"]
            if not encoder.is_file():
                raise FileNotFoundError(f"fault model file missing: {encoder}")
            params = dict(self._cfg.get("params", {}))
            if "layers" in params:
                params["layers"] = tuple(params["layers"])
            net = SelfReference(encoder_file=str(encoder), device=str(self.device), **params)
            return _per_tile(net.score_tiles)

        from training.fault.methods.dinomaly import Dinomaly

        repo = str(self.model_dir / "Dinomaly")
        net = Dinomaly(repo, backbone=self.backbone, device=str(self.device))
        net.load(self.model_dir / "weights.pt")
        return _per_tile(net.score_tiles)

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
        med = float(np.median(amap))
        reference = "trained"
        if self.max_map_median is not None and med > self.max_map_median:
            reference = "self_relative"
            # A fabric unlike the trained ones: the whole map is raised, so judge each spot against
            # this photo's own level instead. A fault is a spot ``relative_z`` robust deviations
            # above the photo's median; 7.5 flags 4.4 % of WFDD good photos (chosen there).
            mad = float(np.median(np.abs(amap - med)))
            thr = med + self.relative_z * 1.4826 * mad

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
            reference=reference,
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
