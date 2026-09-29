"""Detector -> segmenter -> cropper -> heads, as the API's Predictor. Spec §3, §4.

A failing model degrades the scan and says why (COMPONENT_FAILED); it never 500s and
never guesses.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path

from services.vision.garment import choose_primary
from services.vision.imageio import decode_image
from services.vision.predictor import GarmentOutput, Note, VisionOutput
from services.vision.quality import capture_quality

log = logging.getLogger(__name__)


class ScannerPredictor:
    def __init__(self, detector, segmenter, cropper, heads, min_det_score: float | None = None):
        self.detector, self.segmenter, self.cropper, self.heads = (
            detector,
            segmenter,
            cropper,
            heads,
        )
        self.min_det_score = detector.default_min_score if min_det_score is None else min_det_score

    def predict(self, image_bytes: bytes) -> VisionOutput:
        from services.vision.segment import box_mask

        image = decode_image(image_bytes)  # UnsupportedImage propagates -> HTTP 422
        h, w = image.shape[:2]
        notes: list[Note] = []
        dets = self._try(notes, "garment detector", lambda: self.detector.detect(image)) or []
        primary = choose_primary(dets, w, h, self.min_det_score)
        garment = None
        if primary is None:
            notes.append(
                Note("NO_GARMENT_DETECTED", "No garment found; the whole photo was classified.")
            )
            views = [image]
        else:
            x0, y0, x1, y1 = primary.box
            garment = GarmentOutput(primary.label, primary.score, (x0 / w, y0 / h, x1 / w, y1 / h))
            mask = self._try(notes, "segmenter", lambda: self.segmenter.segment(image, primary.box))
            if mask is None:
                mask = box_mask((h, w), primary.box)
            views = self._try(notes, "cropper", lambda: self.cropper.views(image, mask)) or [image]
        heads = self._try(notes, "fabric heads", lambda: self.heads.predict(views))
        try:
            quality = capture_quality(image, garment.box if garment else None)
        except Exception:  # noqa: BLE001 -- a quality number must never cost the scan
            log.exception("capture quality failed")
            quality = None
        out = heads or VisionOutput(None, None, None)
        return replace(out, garment=garment, notes=tuple(notes), quality=quality)

    @staticmethod
    def _try(notes: list[Note], component: str, fn):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 -- a failing model must abstain, not crash
            log.exception("%s failed", component)
            notes.append(Note("COMPONENT_FAILED", f"{component} failed: {type(e).__name__}"))
            return None


def build_scanner(bundle_dir: Path, detector_name: str, device, patches: bool = False):
    from services.vision.crop import FabricCropper
    from services.vision.detectors import load_detector
    from services.vision.heads import LinearHeads
    from services.vision.segment import Sam2Segmenter

    return ScannerPredictor(
        load_detector(detector_name, device),
        Sam2Segmenter(device),
        FabricCropper(patches),
        LinearHeads(bundle_dir, device),
    )
