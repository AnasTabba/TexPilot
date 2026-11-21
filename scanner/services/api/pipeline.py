"""Wires vision + OCR + consistency into one scan. Spec §3, §5, §7."""

from __future__ import annotations

import logging
import re
import time
import uuid

from services.api.schemas import (
    CaptureQuality,
    CompositionSource,
    FaultModel,
    FaultRegionModel,
    FiberComponent,
    FlagModel,
    GarmentPrediction,
    HeadPrediction,
    Outcome,
    ScanResult,
    StatedComposition,
)
from services.consistency.engine import evaluate, yarn_advice
from services.ocr.parser import parse_composition
from services.vision.errors import UnsupportedImage
from services.vision.predictor import FaultOutput, HeadOutput, Predictor, structure_answer

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


def _fault(out: FaultOutput | None) -> FaultModel | None:
    if out is None:
        return None
    return FaultModel(
        score=out.score,
        is_fault=out.is_fault,
        threshold=out.threshold,
        regions=[
            FaultRegionModel(
                box=r.box, score=r.score, type=r.type, type_confidence=r.type_confidence
            )
            for r in out.regions
        ],
        heatmap_png_b64=out.heatmap_png_b64,
        model_version=out.model_version,
        skipped_reason=out.skipped_reason,
        reference=out.reference,
    )


def _fault_flags(out: FaultOutput | None) -> list[FlagModel]:
    if out is None or not out.is_fault:
        return []
    if out.reference == "self_relative":
        message = f"Unusual area: check by eye (score {out.score:.2f})"
        return [FlagModel(code="FAULT_DETECTED", message=message, severity="medium")]
    top = max(out.regions, key=lambda r: r.score, default=None)
    kind = top.type if top is not None and top.type else "unknown type"
    message = f"Possible fabric fault: {kind} (score {out.score:.2f})"
    return [FlagModel(code="FAULT_DETECTED", message=message, severity="medium")]


def _read_label(ocr, label_image: bytes, flags: list[FlagModel]):
    from services.ocr.extract import read_composition
    from services.vision.imageio import decode_image

    try:
        image = decode_image(label_image)
    except UnsupportedImage:
        flags.append(_info("LABEL_UNREADABLE", "The label photo could not be read."))
        return None
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
        main_text = re.split(
            r"\b(?:lining|trim|rib|filling|padding|pocketing|contrast)\b",
            label_text,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        composition = parse_composition(main_text)
        if composition is not None:
            return composition, StatedComposition(
                source=CompositionSource.CARE_LABEL,
                fibers=[FiberComponent(name=c.name, pct=c.pct) for c in composition],
            )
        notes.append(
            _info(
                "LABEL_TEXT_UNREADABLE",
                "The typed label text could not be read as fibre percentages.",
            )
        )
    if label_image is not None and ocr is not None:
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
    start = time.perf_counter()
    vision = predictor.predict(surface_image)
    notes = [_info(n.code, n.message) for n in vision.notes]
    t = time.perf_counter()
    composition, stated = stated_composition(label_text, label_image, ocr, notes)
    timings = dict(vision.timings_ms)
    if label_image is not None and not label_text:
        timings["label_reader"] = round(1000 * (time.perf_counter() - t), 1)
    timings["total"] = round(1000 * (time.perf_counter() - start), 1)

    verdict = evaluate(vision, composition)
    g = vision.garment
    return ScanResult(
        scan_id=str(uuid.uuid4()),
        verdict=Outcome(verdict.outcome),
        structure=_head(vision.structure),
        structure_answer=structure_answer(vision),
        treatment=_head(vision.treatment),
        fibre_family=_head(vision.fibre_family),
        garment=None
        if g is None
        else GarmentPrediction(label=g.label, confidence=g.confidence, box=g.box),
        stated_composition=stated,
        capture_quality=CaptureQuality(**vision.quality) if vision.quality else CaptureQuality(),
        candidates=vision.candidates,
        custom={name: _head(out) for name, out in vision.custom.items()},
        yarn_advice=yarn_advice(composition),
        timings_ms=timings,
        flags=[
            FlagModel(code=f.code, message=f.message, severity=f.severity) for f in verdict.flags
        ]
        + notes
        + _fault_flags(vision.fault),
        fault=_fault(vision.fault),
        model_version=model_version,
        kb_version=str(verdict.kb_version),
    )
