"""Wire contract for the scanner API.

Spec section 6. This is the boundary between P1 (vision), P2 (OCR/serving) and
P3 (app) -- change it in a PR that all three review, not unilaterally.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class Outcome(str, Enum):
    PASS = "PASS"
    FLAG = "FLAG"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class CompositionSource(str, Enum):
    CARE_LABEL = "care_label"
    PURCHASE_ORDER = "purchase_order"


class HeadPrediction(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    topk: list[tuple[str, float]] = []


class FiberComponent(BaseModel):
    name: str
    pct: float = Field(ge=0.0, le=100.0)


class StatedComposition(BaseModel):
    source: CompositionSource | None = None
    fibers: list[FiberComponent] = []
    ocr_confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class FlagModel(BaseModel):
    code: str
    message: str
    severity: str


class CaptureQuality(BaseModel):
    blur: float | None = None
    exposure: str | None = None
    framing: str | None = None


class ScanResult(BaseModel):
    scan_id: str
    verdict: Outcome
    structure: HeadPrediction | None = None
    treatment: HeadPrediction | None = None
    fibre_family: HeadPrediction | None = None
    stated_composition: StatedComposition = StatedComposition()
    flags: list[FlagModel] = []
    capture_quality: CaptureQuality = CaptureQuality()
    model_version: str
    kb_version: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
