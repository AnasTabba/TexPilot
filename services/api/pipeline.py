"""Wires vision + OCR + consistency into one scan. Spec §3, §5, §7."""

from __future__ import annotations

import logging
import uuid

from services.api.schemas import (
    CaptureQuality,
    CompositionSource,
    FiberComponent,
    FlagModel,
    GarmentPrediction,
    HeadPrediction,
    Outcome,
    ScanResult,
    StatedComposition,
)
from services.consistency.engine import evaluate
from services.ocr.parser import parse_composition
from services.vision.predictor import HeadOutput, Predictor

log = logging.getLogger(__name__)
_REASONS = {
    "NO_LABEL_TEXT": ("NO_LABEL_TEXT", "No composition text found in the label photo."),
    "UNREADABLE": (
        "LABEL_UNREADABLE",
        "Label text was found, but no single valid composition could be read.",
    ),
}


def _head(out: HeadOutput | None) -> HeadPrediction | None:
    if out is None:
        return None
    return HeadPrediction(label=out.label, confidence=out.confidence, topk=out.topk)


def _info(code: str, message: str) -> FlagModel:
    return FlagModel(code=code, message=message, severity="info")


def _read_label(ocr, label_image: bytes, flags: list[FlagModel]):
    from services.ocr.extract import read_composition
    from services.vision.imageio import decode_image

    image = decode_image(label_image)  # UnsupportedImage propagates -> HTTP 422
    try:
        return read_composition(ocr, image)
    except Exception as e:  # noqa: BLE001 -- a failing engine abstains, it does not 500
        log.exception("OCR failed")
        flags.append(_info("COMPONENT_FAILED", f"OCR engine failed: {type(e).__name__}"))
        return None


def stated_composition(label_text, label_image, ocr, notes: list[FlagModel]):
    """(fibres, StatedComposition) from typed label text (wins: a human correction) or a label
    photo read by OCR; explains in ``notes`` when a photo gave nothing usable."""
    if label_text:
        composition = parse_composition(label_text)
        if composition is not None:
            return composition, StatedComposition(
                source=CompositionSource.CARE_LABEL,
                fibers=[FiberComponent(name=c.name, pct=c.pct) for c in composition],
            )
    elif label_image is not None and ocr is not None:
        ex = _read_label(ocr, label_image, notes)
        if ex is not None and ex.fibers:
            return ex.fibers, StatedComposition(
                source=CompositionSource.CARE_LABEL,
                fibers=[FiberComponent(name=c.name, pct=c.pct) for c in ex.fibers],
                ocr_confidence=ex.confidence,
                section=ex.section,
            )
        if ex is not None and ex.reason in _REASONS:
            notes.append(_info(*_REASONS[ex.reason]))
    return None, StatedComposition()


def run_scan(
    predictor: Predictor,
    surface_image: bytes,
    label_text: str | None = None,
    *,
    label_image: bytes | None = None,
    ocr=None,
    model_version: str = "stub-0",
) -> ScanResult:
    vision = predictor.predict(surface_image)
    notes = [_info(n.code, n.message) for n in vision.notes]
    composition, stated = stated_composition(label_text, label_image, ocr, notes)

    verdict = evaluate(vision, composition)
    g = vision.garment
    return ScanResult(
        scan_id=str(uuid.uuid4()),
        verdict=Outcome(verdict.outcome),
        structure=_head(vision.structure),
        treatment=_head(vision.treatment),
        fibre_family=_head(vision.fibre_family),
        garment=None
        if g is None
        else GarmentPrediction(label=g.label, confidence=g.confidence, box=g.box),
        stated_composition=stated,
        capture_quality=CaptureQuality(**vision.quality) if vision.quality else CaptureQuality(),
        candidates=vision.candidates,
        flags=[
            FlagModel(code=f.code, message=f.message, severity=f.severity) for f in verdict.flags
        ]
        + notes,
        model_version=model_version,
        kb_version=str(verdict.kb_version),
    )
