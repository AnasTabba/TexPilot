"""Wires vision + OCR + consistency into one scan. Spec section 3."""

from __future__ import annotations

import uuid

from services.api.schemas import (
    CompositionSource,
    FiberComponent,
    FlagModel,
    HeadPrediction,
    Outcome,
    ScanResult,
    StatedComposition,
)
from services.consistency.engine import evaluate
from services.ocr.parser import parse_composition
from services.vision.predictor import HeadOutput, Predictor


def _head(out: HeadOutput | None) -> HeadPrediction | None:
    if out is None:
        return None
    return HeadPrediction(label=out.label, confidence=out.confidence, topk=out.topk)


def run_scan(
    predictor: Predictor,
    surface_image: bytes,
    label_text: str | None = None,
    model_version: str = "stub-0",
) -> ScanResult:
    vision = predictor.predict(surface_image)

    composition = parse_composition(label_text) if label_text else None
    stated = StatedComposition()
    if composition is not None:
        stated = StatedComposition(
            source=CompositionSource.CARE_LABEL,
            fibers=[FiberComponent(name=c.name, pct=c.pct) for c in composition],
        )

    verdict = evaluate(vision, composition)

    return ScanResult(
        scan_id=str(uuid.uuid4()),
        verdict=Outcome(verdict.outcome),
        structure=_head(vision.structure),
        treatment=_head(vision.treatment),
        fibre_family=_head(vision.fibre_family),
        stated_composition=stated,
        flags=[
            FlagModel(code=f.code, message=f.message, severity=f.severity) for f in verdict.flags
        ],
        model_version=model_version,
        kb_version=str(verdict.kb_version),
    )
