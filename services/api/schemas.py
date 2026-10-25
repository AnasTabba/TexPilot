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


class GarmentPrediction(BaseModel):
    label: str  # services.vision.garment vocabulary, e.g. "pants"
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)  # None: scoreless detector
    box: tuple[float, float, float, float]  # normalised 0-1 (x0, y0, x1, y1)


class FiberComponent(BaseModel):
    name: str
    pct: float = Field(ge=0.0, le=100.0)


class StatedComposition(BaseModel):
    source: CompositionSource | None = None
    fibers: list[FiberComponent] = []
    ocr_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    section: str | None = None  # e.g. "shell"; None when the label is unsectioned


class FlagModel(BaseModel):
    code: str
    message: str
    severity: str  # "high" | "medium" | "info" (info explains an abstention)


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
    garment: GarmentPrediction | None = None
    stated_composition: StatedComposition = StatedComposition()
    flags: list[FlagModel] = []
    capture_quality: CaptureQuality = CaptureQuality()
    # For heads that abstained (null above): what they were weighing, most likely first.
    # Low-confidence by definition; the verdict never uses them.
    candidates: dict[str, list[tuple[str, float]]] = {}
    # Heads the factory taught itself (e.g. "wash"): null when that head abstained.
    custom: dict[str, HeadPrediction | None] = {}
    # What to order to make this fabric (services.consistency.engine.yarn_advice): the label's
    # blend, then the typical yarn for the named fabric. Empty when the fabric is unknown.
    yarn_advice: list[str] = []
    model_version: str
    kb_version: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SpecDensity(BaseModel):
    """Measured on the scan. Knits: ends = wales, picks = courses."""

    ends_per_inch: float
    picks_per_inch: float
    spread_pct: float  # how much the scan's tiles disagree; high = irregular yarns
    tiles: int
    skew_deg: float


class YarnCount(BaseModel):
    """Cotton count (Ne) ranges; the standard counts are the nearest a spinner sells."""

    warp_ne: tuple[float, float]  # knits: the one yarn
    weft_ne: tuple[float, float] | None = None  # None for weft knits
    warp_standard_ne: int
    weft_standard_ne: int | None = None
    basis: str  # the assumptions behind the range


class SpecResult(BaseModel):
    """POST /api/v1/spec: what to order to make this fabric again. Additive to the contract."""

    spec_id: str
    construction: str  # woven | knit
    dpi: float  # pixels per inch the threads were measured at
    scale_source: str | None = None  # form | file (the scan's dpi) | card (printed marker)
    weave: str | None = None  # e.g. "3/1 twill, right-hand"; None for knits or no clear repeat
    density: SpecDensity
    weight_gsm: float | None = None
    yarn: YarnCount | None = None  # None without a weight
    stated_composition: StatedComposition = StatedComposition()
    yarn_order: list[str] = []
    flags: list[FlagModel] = []
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
