"""Incoming-fabric QC v2 wire contract (design §3, §14-§21).

These models are the executable form of ``scanner/contracts/qc-v2.schema.json``; the checked-in
schema is generated from them (``python -m services.api.qc_schemas``) and a test fails when the
two drift. Yarnflow (``src/qc-types.ts``, ``server/qc-contract.mjs``) and the iPhone app
(``QCTypes.swift``) decode the same fixtures. No business policy lives here: only shapes and the
invariants a record must satisfy to be a record at all.

v1 (``schemas.py``) is untouched. Nothing here maps a v1 PASS to a v2 ACCEPT.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

SCHEMA_VERSION = "2"

# ---------------------------------------------------------------------------- primitive types

Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
_UUID = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
Uuid = Annotated[str, StringConstraints(pattern=_UUID)]
#: UTC RFC 3339, always with the Z suffix (no offsets, no local times).
UtcTime = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$"),
]
Ref = Annotated[str, StringConstraints(min_length=1, max_length=120, pattern=r"^[^\x00-\x1f]+$")]
Text = Annotated[str, StringConstraints(min_length=1, max_length=2000)]
Unit01 = Annotated[float, Field(ge=0.0, le=1.0)]
NonNeg = Annotated[float, Field(ge=0.0)]
SignedUnit = Annotated[float, Field(ge=-1.0, le=1.0)]
#: Strict mode refuses a list where a tuple is declared; JSON arrays are lists.
_as_tuple = BeforeValidator(lambda v: tuple(v) if isinstance(v, list) else v)
Box = Annotated[tuple[Unit01, Unit01, Unit01, Unit01], _as_tuple]

DecisionStatus = Literal["ACCEPT", "HOLD", "RECAPTURE", "MANUAL_REVIEW"]
StageState = Literal["OK", "ABSTAINED", "FAILED", "DISABLED", "NOT_RUN"]
StageName = Literal["quality", "fabric", "defects", "metrology", "domain"]
STAGE_NAMES: tuple[str, ...] = ("quality", "fabric", "defects", "metrology", "domain")
Reason = Literal[
    "QUALITY_BLUR",
    "QUALITY_GLARE",
    "QUALITY_MOIRE",
    "QUALITY_FOLD",
    "QUALITY_FRAMING",
    "SCALE_MISSING",
    "SCALE_INVALID",
    "CALIBRATION_EXPIRED",
    "RESOLUTION_LOW",
    "MEASUREMENT_UNCERTAIN",
    "PATTERN_AMBIGUOUS",
    "OOD",
    "UNKNOWN_FABRIC",
    "PO_UNCONFIRMED",
    "PO_CONFLICT",
    "PO_VERSION_STALE",
    "UNIT_UNSUPPORTED",
    "SPEC_MISSING",
    "STAGE_UNAVAILABLE",
    "DEFECT_SUSPECTED",
    "CONSTRUCTION_OUTSIDE_TOLERANCE",
    "FABRIC_MISMATCH",
    "DOMAIN_UNVALIDATED",
    "POLICY_UNRELEASED",
    "RECAPTURE_LIMIT",
    "EVIDENCE_STALE",
    "AUDIT_UNAVAILABLE",
]
#: Reasons an operator can fix by taking the capture again (design §4).
CAPTURE_FIXABLE: frozenset[str] = frozenset(
    {
        "QUALITY_BLUR",
        "QUALITY_GLARE",
        "QUALITY_MOIRE",
        "QUALITY_FOLD",
        "QUALITY_FRAMING",
        "SCALE_MISSING",
        "SCALE_INVALID",
        "RESOLUTION_LOW",
    }
)
ErrorCode = Literal[
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "MALFORMED_REQUEST",
    "METHOD_NOT_ALLOWED",
    "CONFLICT",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA",
    "VALIDATION_FAILED",
    "CAPACITY_LIMIT",
    "SERVICE_UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "INTERNAL_ERROR",
]
Axis = Literal["ends", "picks", "wales", "courses"]
DensityUnit = Literal["count/in", "count/cm"]
Construction = Literal["woven", "knit"]
CaptureRole = Literal["overview", "structure", "defect", "scale"]
QualityCheck = Literal["blur", "glare", "moire", "fold", "framing", "resolution", "marker_geometry"]
QUALITY_CHECKS: tuple[str, ...] = (
    "blur",
    "glare",
    "moire",
    "fold",
    "framing",
    "resolution",
    "marker_geometry",
)
REQUIRED_AXES: dict[str, frozenset[str]] = {
    "woven": frozenset({"ends", "picks"}),
    "knit": frozenset({"wales", "courses"}),
}

# Engineering limits (design §21). Starting points, not validated acquisition thresholds.
MAX_ORIGINALS_PER_SET = 4
MAX_ORIGINAL_BYTES = 12 * 1024 * 1024
MAX_SET_BYTES = 48 * 1024 * 1024
MAX_DECODED_PIXELS = 16_000_000
ASSERTION_TTL_S = 30
REQUEST_DEADLINE_S = 60
MAX_FUTURE_SKEW_S = 120
MAX_CAPTURE_SETS = 3
CM_PER_INCH = 2.54


class Strict(BaseModel):
    """Unknown fields, non-finite numbers and type coercion ("76" for 76, 1 for true) are all
    rejected; records are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False, strict=True)


# ---------------------------------------------------------------------------- canonical JSON


def _es_number(x: float) -> str:
    """ECMAScript Number::toString, so Python and JavaScript hash the same bytes (RFC 8785)."""
    if isinstance(x, bool):  # bool is an int subclass
        raise TypeError("booleans are not numbers")
    if isinstance(x, int):
        return str(x)
    if not math.isfinite(x):
        raise ValueError("non-finite numbers cannot be hashed")
    if x == 0:
        return "0"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    sign = "-" if x < 0 else ""
    mantissa, _, exp = repr(abs(x)).partition("e")
    digits = mantissa.replace(".", "")
    point = len(mantissa.split(".")[0]) + (int(exp) if exp else 0)  # decimal point position
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    n = len(digits)
    if 0 < point <= 21:
        if n <= point:
            return sign + digits + "0" * (point - n)
        return sign + digits[:point] + "." + digits[point:]
    if -6 < point <= 0:
        return sign + "0." + "0" * (-point) + digits
    e = point - 1
    body = digits[0] + ("." + digits[1:] if n > 1 else "")
    return f"{sign}{body}e{'+' if e >= 0 else '-'}{abs(e)}"


def canonical_json(value: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, ECMAScript numbers, UTF-8 text unescaped.

    ``yarnflow/server/qc-contract.mjs`` implements the same function; the shared fixtures pin
    that both produce identical bytes and therefore identical SHA-256 values.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _es_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(k, str) for k in value):
            raise TypeError("object keys must be strings")
        # UTF-16 code-unit order, as JavaScript sorts strings.
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(f"{canonical_json(k)}:{canonical_json(value[k])}" for k in keys) + "}"
    if isinstance(value, BaseModel):
        return canonical_json(value.model_dump(mode="json"))
    raise TypeError(f"cannot canonicalise {type(value).__name__}")


def sha256_hex(data: bytes | str) -> str:
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def content_sha256(value: Any, *, exclude: tuple[str, ...] = ()) -> str:
    """SHA-256 of the canonical JSON of ``value`` without the named top-level fields."""
    data = value.model_dump(mode="json") if isinstance(value, BaseModel) else dict(value)
    return sha256_hex(canonical_json({k: v for k, v in data.items() if k not in exclude}))


# ---------------------------------------------------------------------------- PO specification


class Provenance(Strict):
    """Where one value came from. OCR is a candidate; a confirmed PO value is authoritative only
    for what was ordered, never for what was observed (design §5, §17)."""

    source: Literal["PO_CONFIRMED", "OCR_CANDIDATE", "OPERATOR", "MODEL", "PHYSICAL_REFERENCE"]
    source_id: Ref
    source_version: Ref
    actor_id: Ref | None
    observed_at: UtcTime
    image_sha256: Sha256 | None
    # PO-candidate import evidence (design §17); all null for non-document sources.
    document_sha256: Sha256 | None = None
    page: Annotated[int, Field(ge=1, le=10_000)] | None = None
    span: (
        Annotated[tuple[Annotated[int, Field(ge=0)], Annotated[int, Field(ge=0)]], _as_tuple] | None
    ) = None
    raw_value: Annotated[str, StringConstraints(max_length=200)] | None = None
    raw_unit: Annotated[str, StringConstraints(max_length=40)] | None = None
    ocr_confidence: Unit01 | None = None
    candidate_id: Uuid | None = None
    corrects_id: Uuid | None = None

    @model_validator(mode="after")
    def _span_ordered(self) -> Provenance:
        if self.span is not None and self.span[0] > self.span[1]:
            raise ValueError("span start must not exceed its end")
        return self


class DensitySpec(Strict):
    axis: Axis
    unit: DensityUnit
    target: Annotated[float, Field(gt=0.0, le=10_000.0)]
    lower: Annotated[float, Field(ge=0.0, le=10_000.0)]
    upper: Annotated[float, Field(ge=0.0, le=10_000.0)]
    provenance: Provenance

    @model_validator(mode="after")
    def _ordered(self) -> DensitySpec:
        if not self.lower <= self.target <= self.upper:
            raise ValueError("density limits must satisfy lower <= target <= upper")
        if self.provenance.source != "PO_CONFIRMED":
            raise ValueError("a specification value must be a confirmed PO value")
        return self


class PurchaseSpec(Strict):
    schema_version: Literal["2"]
    id: Uuid
    version: Annotated[int, Field(ge=1)]
    workspace_id: Uuid
    purchase_order_id: Ref
    content_sha256: Sha256
    construction: Construction
    allowed_fabric_labels: Annotated[list[Ref], Field(min_length=1, max_length=40)]
    taxonomy_version: Ref
    density: Annotated[list[DensitySpec], Field(min_length=2, max_length=2)]
    confirmed_by: Ref
    confirmed_at: UtcTime
    supersedes_version: Annotated[int, Field(ge=1)] | None

    @model_validator(mode="after")
    def _axes(self) -> PurchaseSpec:
        axes = [d.axis for d in self.density]
        if len(set(axes)) != len(axes) or set(axes) != REQUIRED_AXES[self.construction]:
            raise ValueError(
                f"a {self.construction} specification needs exactly "
                f"{sorted(REQUIRED_AXES[self.construction])}"
            )
        if len(set(self.allowed_fabric_labels)) != len(self.allowed_fabric_labels):
            raise ValueError("allowed_fabric_labels must be unique")
        if self.supersedes_version is not None and self.supersedes_version != self.version - 1:
            raise ValueError("a version supersedes exactly the version before it")
        if (self.version == 1) != (self.supersedes_version is None):
            raise ValueError("only version 1 has no predecessor")
        return self

    def expected_sha256(self) -> str:
        return content_sha256(self, exclude=("content_sha256",))


def normalize_density(value: float, unit: str) -> float:
    """Counts per inch from counts per inch or per centimetre: exactly ×2.54, nothing else.

    Any other unit is an error, never a guess (design §5)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("density must be a finite number")
    if value < 0:
        raise ValueError("density cannot be negative")
    if unit == "count/in":
        return float(value)
    if unit == "count/cm":
        return float(value) * CM_PER_INCH
    raise ValueError(f"unsupported density unit {unit!r}")


def parse_qc_spec(payload: dict) -> PurchaseSpec:
    """Validate a stored PurchaseSpec, including that its hash matches its content."""
    spec = PurchaseSpec.model_validate(payload)
    if spec.content_sha256 != spec.expected_sha256():
        raise ValueError("content_sha256 does not match the specification content")
    return spec


# ---------------------------------------------------------------------------- sampling, capture


class SamplingSelection(Strict):
    """One immutable physical selection. Linked re-evaluations share it (design §14, §15, §20)."""

    id: Uuid
    workspace_id: Uuid
    purchase_order_id: Ref
    plan_version: Ref
    plan_sha256: Sha256 | None
    randomization_seed: Ref | None
    draw_index: Annotated[int, Field(ge=0)] | None
    selection_probability: Annotated[float, Field(gt=0.0, le=1.0)] | None
    cohort: Literal["OPERATIONAL", "CONFIRMATORY", "CHALLENGE"]
    independent_group_id: Ref
    lot_ref: Ref
    roll_ref: Ref
    location_ref: Ref
    face: Literal["face", "back", "unknown"]
    planned_area_cm2: Annotated[float, Field(gt=0.0, le=1_000_000.0)]
    method: Ref
    created_by: Ref
    created_at: UtcTime


class Sample(Strict):
    schema_version: Literal["2"]
    id: Uuid
    workspace_id: Uuid
    purchase_order_id: Ref
    spec_id: Uuid
    spec_version: Annotated[int, Field(ge=1)]
    lot_ref: Ref
    roll_ref: Ref
    location_ref: Ref
    sample_plan_version: Ref
    capture_attempt: Annotated[int, Field(ge=0, le=MAX_CAPTURE_SETS)]
    revision: Annotated[int, Field(ge=0)]
    predecessor_sample_id: Uuid | None
    selection_id: Uuid
    face: Literal["face", "back", "unknown"]
    planned_area_cm2: Annotated[float, Field(gt=0.0, le=1_000_000.0)]
    usable_area_cm2: Annotated[float, Field(ge=0.0, le=1_000_000.0)] | None
    sampling_method: Ref
    independent_group_id: Ref
    disposition: Literal["SELECTED", "SUBMITTED", "MISSING", "EXCLUDED"]
    exclusion_reason: Text | None
    created_by: Ref
    created_at: UtcTime

    @model_validator(mode="after")
    def _exclusion(self) -> Sample:
        needs_reason = self.disposition in ("MISSING", "EXCLUDED")
        if needs_reason != (self.exclusion_reason is not None):
            raise ValueError("MISSING and EXCLUDED samples carry a reason; others do not")
        return self


class AcquisitionAttestation(Strict):
    """What the capturing client could observe about how the image was taken (design §18).
    ``null`` means the client could not observe it; an unobservable required field keeps the
    capture out of any validated physical profile."""

    image_sha256: Sha256
    capture_mode: Literal["NATIVE_CAMERA", "WEB_CAMERA", "IMPORTED", "REENCODED", "CANVAS"]
    device_model: Ref | None
    lens_id: Ref | None
    zoom_factor: Annotated[float, Field(gt=0.0, le=100.0)] | None
    focus_mode: Ref | None
    exposure_mode: Ref | None
    resolution: (
        Annotated[tuple[Annotated[int, Field(ge=1)], Annotated[int, Field(ge=1)]], _as_tuple] | None
    )
    orientation: Annotated[int, Field(ge=1, le=8)] | None
    processing: Ref | None
    captured_at: UtcTime


class Capture(Strict):
    id: Uuid
    sample_id: Uuid
    capture_set_id: Uuid
    original_sha256: Sha256
    role: CaptureRole
    taken_at: UtcTime
    device_profile_id: Ref
    calibration_id: Ref | None
    width: Annotated[int, Field(ge=1, le=20_000)]
    height: Annotated[int, Field(ge=1, le=20_000)]
    preprocessing_version: Ref
    consent_record_id: Uuid
    #: Upload size and state of the stored original. PURGED: retention removed the bytes and
    #: this metadata is the tombstone (design §17).
    byte_size: Annotated[int, Field(ge=1, le=MAX_ORIGINAL_BYTES)]
    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    original_state: Literal["AVAILABLE", "PURGED"]
    attestation_sha256: Sha256

    @model_validator(mode="after")
    def _pixels(self) -> Capture:
        if self.width * self.height > MAX_DECODED_PIXELS:
            raise ValueError("capture exceeds the decoded pixel limit")
        return self


class CaptureSet(Strict):
    id: Uuid
    sample_id: Uuid
    state: Literal["OPEN", "CLOSED"]
    required_roles: Annotated[list[CaptureRole], Field(min_length=1, max_length=4)]
    capture_ids: Annotated[list[Uuid], Field(max_length=MAX_ORIGINALS_PER_SET)]
    revision: Annotated[int, Field(ge=0)]
    attempt: Annotated[int, Field(ge=1, le=MAX_CAPTURE_SETS)] | None

    @model_validator(mode="after")
    def _closed(self) -> CaptureSet:
        if (self.state == "CLOSED") != (self.attempt is not None):
            raise ValueError("only a closed capture set has an attempt number")
        if len(set(self.capture_ids)) != len(self.capture_ids):
            raise ValueError("capture_ids must be unique")
        if len(set(self.required_roles)) != len(self.required_roles):
            raise ValueError("required_roles must be unique")
        return self


class ConsentAuthority(Strict):
    """A server-verified reference to a signed consent register entry (design §17). The record
    proves that enforcement has something to check, not that the consent is legally adequate."""

    id: Uuid
    version: Annotated[int, Field(ge=1)]
    workspace_id: Uuid
    authority_evidence_sha256: Sha256
    operational_capture: bool
    operational_retention_days: Annotated[int, Field(ge=1, le=3650)]
    research_use: bool
    training_use: bool
    export_destinations: Annotated[list[Ref], Field(max_length=20)]
    valid_from: UtcTime
    expires_at: UtcTime
    withdrawn_at: UtcTime | None


# ---------------------------------------------------------------------------- evidence stages

T = TypeVar("T")


class Stage(Strict, Generic[T]):
    """One evidence stage. OK means it ran and produced a usable value from a known artifact;
    every other state carries no value and says why (design §3)."""

    state: StageState
    value: T | None
    reasons: Annotated[list[Reason], Field(max_length=12)]
    artifact_sha256: Sha256 | None
    duration_ms: Annotated[float, Field(ge=0.0, le=600_000.0)]

    @model_validator(mode="after")
    def _state(self) -> Stage[T]:
        if self.state == "OK":
            if self.value is None or self.artifact_sha256 is None:
                raise ValueError("an OK stage needs a value and the artifact that produced it")
        else:
            if self.value is not None:
                raise ValueError(f"a {self.state} stage carries no value")
            if not self.reasons:
                raise ValueError(f"a {self.state} stage must say why")
        if len(set(self.reasons)) != len(self.reasons):
            raise ValueError("reasons must be unique")
        return self


class DomainValue(Strict):
    in_domain: bool
    assessment_version: Ref
    profile_sha256: Sha256


class FabricCandidate(Strict):
    label: Ref
    raw_score: Annotated[float, Field(ge=-1e6, le=1e6)]


class FabricValue(Strict):
    """unknown=true: the classifier ran and has no authoritative answer (out of taxonomy or low
    confidence); ``candidates`` are diagnostic only. A head that did not run is a FAILED or
    DISABLED stage, never unknown=true."""

    label: Ref | None
    taxonomy_version: Ref
    calibrated_probability: Unit01 | None
    unknown: bool
    candidates: Annotated[list[FabricCandidate], Field(max_length=10)]

    @model_validator(mode="after")
    def _unknown(self) -> FabricValue:
        if self.unknown != (self.label is None):
            raise ValueError("unknown fabric has a null label, and a known one has a label")
        return self


class DefectRegion(Strict):
    capture_id: Uuid
    transform_id: Ref
    box: Box
    score: Unit01
    label: Ref | None

    @model_validator(mode="after")
    def _box(self) -> DefectRegion:
        x0, y0, x1, y1 = self.box
        if not (x0 < x1 and y0 < y1):
            raise ValueError("box must satisfy x0 < x1 and y0 < y1")
        return self


class DefectView(Strict):
    """Per-view defect record (design §14): which capture, which transform, how much was seen."""

    capture_id: Uuid
    capture_sha256: Sha256
    transform_id: Ref
    score: Unit01
    observed_area_cm2: NonNeg | None


class DefectValue(Strict):
    score: Unit01
    regions: Annotated[list[DefectRegion], Field(max_length=200)]
    #: Sum is never claimed: overlapping views do not add up to physical coverage. This is the
    #: largest single-view area, or 0 when no view has a physical scale.
    observed_area_cm2: NonNeg
    views: Annotated[list[DefectView], Field(min_length=1, max_length=MAX_ORIGINALS_PER_SET)]

    @model_validator(mode="after")
    def _views(self) -> DefectValue:
        seen = {v.capture_id for v in self.views}
        if len(seen) != len(self.views):
            raise ValueError("one defect view per capture")
        if any(r.capture_id not in seen for r in self.regions):
            raise ValueError("every region belongs to an evaluated view")
        return self


class Measurement(Strict):
    capture_id: Uuid
    capture_sha256: Sha256
    source_roi: Box
    calibration_sha256: Sha256
    geometry_artifact_sha256: Sha256
    uncertainty_report_sha256: Sha256
    axis_registration_id: Uuid
    axis: Axis
    unit: Literal["count/in"]
    value: NonNeg
    interval95: Annotated[tuple[NonNeg, NonNeg], _as_tuple]
    reference_id: Ref
    method_version: Ref

    @model_validator(mode="after")
    def _interval(self) -> Measurement:
        low, high = self.interval95
        if not low <= self.value <= high:
            raise ValueError("interval95 must satisfy low <= value <= high")
        x0, y0, x1, y1 = self.source_roi
        if not (x0 < x1 and y0 < y1):
            raise ValueError("source_roi must satisfy x0 < x1 and y0 < y1")
        return self


class QualityChecks(Strict):
    blur: bool
    glare: bool
    moire: bool
    fold: bool
    framing: bool
    resolution: bool
    marker_geometry: bool


class QualityValue(Strict):
    """Each key is true when that check passed. All seven are present; a check that could not
    be evaluated makes the stage ABSTAINED rather than a missing-means-true entry."""

    checks: QualityChecks


class Evidence(Strict):
    schema_version: Literal["2"]
    id: Uuid
    sample_id: Uuid
    capture_ids: Annotated[list[Uuid], Field(min_length=1, max_length=MAX_ORIGINALS_PER_SET)]
    spec_sha256: Sha256
    domain_id: Ref | None
    domain: Stage[DomainValue]
    fabric: Stage[FabricValue]
    defects: Stage[DefectValue]
    metrology: Stage[list[Measurement]]
    quality: Stage[QualityValue]
    contradictions: Annotated[list[Reason], Field(max_length=12)]
    manifest_sha256: Sha256
    created_at: UtcTime

    @model_validator(mode="after")
    def _metrology(self) -> Evidence:
        if self.metrology.state == "OK":
            axes = [m.axis for m in self.metrology.value or []]
            if len(axes) != 2 or len(set(axes)) != 2:
                raise ValueError("an OK metrology stage has exactly one measurement per axis")
            if set(axes) not in (REQUIRED_AXES["woven"], REQUIRED_AXES["knit"]):
                raise ValueError("measurements must be one construction's two axes")
            ids = set(self.capture_ids)
            if any(m.capture_id not in ids for m in self.metrology.value or []):
                raise ValueError("a measurement must belong to this evidence's captures")
        if self.defects.state == "OK" and self.defects.value is not None:
            ids = set(self.capture_ids)
            if any(v.capture_id not in ids for v in self.defects.value.views):
                raise ValueError("a defect view must belong to this evidence's captures")
        return self

    def expected_manifest_sha256(self) -> str:
        return content_sha256(self, exclude=("manifest_sha256", "id", "created_at"))


# ---------------------------------------------------------------------------- decisions


class DecisionDraft(Strict):
    status: DecisionStatus
    reasons: Annotated[list[Reason], Field(max_length=16)]
    automatic: bool
    scope: Literal["INSPECTED_SAMPLE"]

    @model_validator(mode="after")
    def _automatic(self) -> DecisionDraft:
        if self.automatic != (self.status in ("ACCEPT", "HOLD")):
            raise ValueError("automatic is true exactly for ACCEPT and HOLD")
        if self.status != "ACCEPT" and not self.reasons:
            raise ValueError("every status except ACCEPT states at least one reason")
        if len(set(self.reasons)) != len(self.reasons):
            raise ValueError("reasons must be unique")
        return self


class Decision(DecisionDraft):
    schema_version: Literal["2"]
    id: Uuid
    sample_id: Uuid
    evidence_id: Uuid
    spec_id: Uuid
    spec_version: Annotated[int, Field(ge=1)]
    revision: Annotated[int, Field(ge=1)]
    policy_version: Ref
    release_id: Uuid | None
    evaluated_at: UtcTime

    @model_validator(mode="after")
    def _release(self) -> Decision:
        if self.automatic and self.release_id is None:
            raise ValueError("an automatic decision names the release that authorised it")
        return self


class Adjudication(Strict):
    """A human reviewer's recorded finding. Appended, never a rewrite of model evidence, and
    never blinded research truth (design §4, §17)."""

    id: Uuid
    sample_id: Uuid
    revision: Annotated[int, Field(ge=1)]
    outcome: Literal["CONFORMING", "NONCONFORMING", "UNDETERMINED"]
    reason: Text
    reference_ids: Annotated[list[Ref], Field(max_length=20)]
    actor_id: Ref
    created_at: UtcTime
    supersedes_id: Uuid | None
    intervention_reason: Text | None


class Family(Strict):
    """The linked evaluations of one physical selection (design §20)."""

    selection_id: Uuid
    predecessor_sample_id: Uuid | None
    successor_sample_ids: Annotated[list[Uuid], Field(max_length=20)]
    attempts_used: Annotated[int, Field(ge=0, le=MAX_CAPTURE_SETS)]
    attempts_max: Literal[3]
    spec_is_current: bool
    current_spec_version: Annotated[int, Field(ge=1)]


class QCResult(Strict):
    """The one envelope every create / upload / close / analyze / reload returns (design §14)."""

    schema_version: Literal["2"]
    mode: Literal["REVIEW_ONLY", "AUTOMATIC"]
    sample: Sample
    captures: Annotated[list[Capture], Field(max_length=MAX_ORIGINALS_PER_SET * MAX_CAPTURE_SETS)]
    capture_sets: Annotated[list[CaptureSet], Field(max_length=MAX_CAPTURE_SETS + 1)]
    evidence: Evidence | None
    decision: Decision | None
    history: Annotated[list[Decision], Field(max_length=50)]
    adjudications: Annotated[list[Adjudication], Field(max_length=100)]
    current_human_disposition: Adjudication | None
    recalled_decision_ids: Annotated[list[Uuid], Field(max_length=50)]
    family: Family
    revision: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def _consistent(self) -> QCResult:
        if self.revision != self.sample.revision:
            raise ValueError("revision must equal the sample revision")
        if (self.decision is None) != (self.evidence is None):
            raise ValueError("a decision and its evidence are returned together")
        if self.decision is not None:
            if self.decision.sample_id != self.sample.id:
                raise ValueError("the decision belongs to another sample")
            if self.evidence is not None and self.decision.evidence_id != self.evidence.id:
                raise ValueError("the decision is bound to different evidence")
            if (self.decision.spec_id, self.decision.spec_version) != (
                self.sample.spec_id,
                self.sample.spec_version,
            ):
                raise ValueError("the decision is bound to a different specification")
            if not any(d.id == self.decision.id for d in self.history):
                raise ValueError("the current decision must appear in history")
        if any(c.sample_id != self.sample.id for c in self.captures):
            raise ValueError("a capture belongs to another sample")
        return self


# ---------------------------------------------------------------------------- policy, release


class Policy(Strict):
    schema_version: Literal["2"]
    version: Ref
    sha256: Sha256
    mode: Literal["REVIEW_ONLY", "AUTOMATIC"]
    required_stages: Annotated[list[StageName], Field(min_length=5, max_length=5)]
    max_capture_sets: Literal[3]

    @model_validator(mode="after")
    def _stages(self) -> Policy:
        if set(self.required_stages) != set(STAGE_NAMES):
            raise ValueError("a policy requires all five stages")
        return self

    def expected_sha256(self) -> str:
        return content_sha256(self, exclude=("sha256",))


class DomainManifest(Strict):
    id: Ref
    version: Ref
    sha256: Sha256
    construction: Construction
    effective_labels: Annotated[list[Ref], Field(min_length=1, max_length=64)]
    taxonomy_sha256: Sha256
    required_roles: Annotated[list[CaptureRole], Field(min_length=1, max_length=4)]
    profile_sha256s: Annotated[list[Sha256], Field(min_length=1, max_length=20)]
    preprocessing_sha256: Sha256
    score_transform_sha256: Sha256
    unknown_assessment_sha256: Sha256
    quality_thresholds_sha256: Sha256
    metrology_validation_sha256: Sha256
    fabric_artifact_sha256: Sha256
    defect_artifact_sha256: Sha256
    defect_accept_below: Unit01
    defect_hold_at_or_above: Unit01

    @model_validator(mode="after")
    def _thresholds(self) -> DomainManifest:
        if not self.defect_accept_below < self.defect_hold_at_or_above:
            raise ValueError("defect_accept_below must be below defect_hold_at_or_above")
        if len(set(self.required_roles)) != len(self.required_roles):
            raise ValueError("required_roles must be unique")
        return self

    def expected_sha256(self) -> str:
        return content_sha256(self, exclude=("sha256",))


class Release(Strict):
    id: Uuid
    version: Ref
    sha256: Sha256
    workspace_id: Uuid
    state: Literal["STATISTICAL_CANDIDATE", "ACTIVE", "SUSPENDED"]
    domain_sha256: Sha256
    policy_sha256: Sha256
    bundle_sha256: Sha256
    calibration_sha256: Sha256
    statistics_report_sha256: Sha256
    operations_proof_sha256: Sha256 | None
    monitoring_protocol_sha256: Sha256 | None
    authority_record_sha256: Sha256
    approved_by: Ref
    independent_signatory: Ref
    expires_at: UtcTime
    predecessor_release_id: Uuid | None

    @model_validator(mode="after")
    def _authority(self) -> Release:
        if self.approved_by.strip().lower() == self.independent_signatory.strip().lower():
            raise ValueError("the independent signatory must be a different person")
        if self.state == "ACTIVE" and (
            self.operations_proof_sha256 is None or self.monitoring_protocol_sha256 is None
        ):
            raise ValueError("an ACTIVE release needs operations and monitoring proof")
        return self

    def expected_sha256(self) -> str:
        return content_sha256(self, exclude=("sha256", "state"))


class EvaluationContext(Strict):
    evaluated_at: UtcTime
    clock_source: Literal["WORKER_UTC"]
    deadline_at: UtcTime
    calibration_records_sha256: Sha256
    capture_binding_sha256: Sha256
    request_id: Uuid
    request_generation: Annotated[int, Field(ge=1)]


class CalibrationProfile(Strict):
    id: Ref
    version: Ref
    sha256: Sha256
    device_profile_id: Ref
    lens_id: Ref
    resolution: Annotated[
        tuple[Annotated[int, Field(ge=1)], Annotated[int, Field(ge=1)]], _as_tuple
    ]
    focus_mode: Ref
    distance_mm: Annotated[
        tuple[Annotated[float, Field(gt=0.0)], Annotated[float, Field(gt=0.0)]], _as_tuple
    ]
    lighting_protocol_sha256: Sha256
    processing_sha256: Sha256
    distortion_model_sha256: Sha256
    source_resolution_limits_sha256: Sha256
    uncertainty_model_sha256: Sha256
    reference_ids: Annotated[list[Ref], Field(min_length=1, max_length=10)]
    valid_from: UtcTime
    expires_at: UtcTime

    @model_validator(mode="after")
    def _ranges(self) -> CalibrationProfile:
        if self.distance_mm[0] > self.distance_mm[1]:
            raise ValueError("distance_mm must be [near, far]")
        if self.valid_from >= self.expires_at:
            raise ValueError("a calibration profile must be valid before it expires")
        return self


class ScaleReference(Strict):
    id: Ref
    sha256: Sha256
    dimensions_mm: Annotated[
        tuple[Annotated[float, Field(gt=0.0)], Annotated[float, Field(gt=0.0)]], _as_tuple
    ]
    uncertainty_mm: Annotated[tuple[NonNeg, NonNeg], _as_tuple]
    traceability_report_sha256: Sha256
    print_verification_sha256: Sha256


class AxisRegistration(Strict):
    """Which way the fabric runs in this capture, from a physical indicator (design §15)."""

    id: Uuid
    capture_id: Uuid
    capture_sha256: Sha256
    physical_indicator: Literal["SELVEDGE", "WARP_MARK", "QUALIFIED_REGISTRATION"]
    provenance: Provenance
    origin_xy: Annotated[tuple[Unit01, Unit01], _as_tuple]
    direction_xy: Annotated[tuple[SignedUnit, SignedUnit], _as_tuple]
    transform_sha256: Sha256

    @model_validator(mode="after")
    def _direction(self) -> AxisRegistration:
        dx, dy = self.direction_xy
        if not 0.99 <= math.hypot(dx, dy) <= 1.01:
            raise ValueError("direction_xy must be a unit vector")
        return self


class ValidatedCapture(Strict):
    capture: Capture
    original_storage_reference: Ref
    verified_sha256: Sha256
    acquisition_attestation_sha256: Sha256
    attestation: AcquisitionAttestation
    geometry_artifact_sha256: Sha256 | None
    calibration: CalibrationProfile | None
    reference: ScaleReference | None
    axis_registration: AxisRegistration | None

    @model_validator(mode="after")
    def _bound(self) -> ValidatedCapture:
        if self.verified_sha256 != self.capture.original_sha256:
            raise ValueError("verified_sha256 must equal the capture's original hash")
        if self.attestation.image_sha256 != self.capture.original_sha256:
            raise ValueError("the attestation describes a different image")
        if self.axis_registration is not None and (
            self.axis_registration.capture_id != self.capture.id
            or self.axis_registration.capture_sha256 != self.capture.original_sha256
        ):
            raise ValueError("the axis registration describes a different capture")
        return self


class ReadinessStage(Strict):
    name: StageName
    state: StageState
    artifact_sha256: Sha256 | None
    reasons: Annotated[list[Reason], Field(max_length=12)]


class Readiness(Strict):
    """Which stages have usable artifacts. ``ready`` is about artifacts, never released
    authority (design §21)."""

    schema_version: Literal["2"]
    ready: bool
    bundle_sha256: Sha256 | None
    stages: Annotated[list[ReadinessStage], Field(min_length=5, max_length=5)]

    @model_validator(mode="after")
    def _rows(self) -> Readiness:
        if [s.name for s in self.stages] != list(STAGE_NAMES):
            raise ValueError("readiness reports each required stage once, in order")
        usable = all(s.state == "OK" and s.artifact_sha256 for s in self.stages)
        if self.ready != (usable and self.bundle_sha256 is not None):
            raise ValueError("ready is true exactly when every stage has a usable artifact")
        return self


# ---------------------------------------------------------------------------- private service


class AnalysisBinding(Strict):
    spec_sha256: Sha256
    policy_sha256: Sha256
    release_sha256: Sha256 | None
    capture_sha256s: Annotated[list[Sha256], Field(min_length=1, max_length=MAX_ORIGINALS_PER_SET)]
    attempt: Annotated[int, Field(ge=1, le=MAX_CAPTURE_SETS)]
    expected_revision: Annotated[int, Field(ge=0)]
    request_id: Uuid
    request_generation: Annotated[int, Field(ge=1)]
    deadline_at: UtcTime


class AnalysisCandidate(Strict):
    """What the private scanner returns to the Worker. Not a public result: the Worker checks
    the binding and re-checks everything inside finalisation before anything is stored."""

    evidence: Evidence
    draft: DecisionDraft
    binding: AnalysisBinding


class AnalyzeRequest(Strict):
    """The ``request`` part of the Worker -> scanner multipart call. Its exact UTF-8 bytes are
    what the service assertion's ``payload_sha256`` covers; each original travels as the file
    part ``capture_<capture.id>`` and is checked against ``verified_sha256``."""

    schema_version: Literal["2"]
    sample_id: Uuid
    workspace_id: Uuid
    spec: PurchaseSpec
    policy: Policy
    release: Release | None
    domain: DomainManifest | None
    attempt: Annotated[int, Field(ge=1, le=MAX_CAPTURE_SETS)]
    expected_revision: Annotated[int, Field(ge=0)]
    context: EvaluationContext
    captures: Annotated[
        list[ValidatedCapture], Field(min_length=1, max_length=MAX_ORIGINALS_PER_SET)
    ]

    @model_validator(mode="after")
    def _bound(self) -> AnalyzeRequest:
        ids = [c.capture.id for c in self.captures]
        if len(set(ids)) != len(ids):
            raise ValueError("captures must be distinct")
        if any(c.capture.sample_id != self.sample_id for c in self.captures):
            raise ValueError("a capture belongs to another sample")
        if len({c.capture.capture_set_id for c in self.captures}) != 1:
            raise ValueError("captures must come from one closed capture set")
        if self.spec.workspace_id != self.workspace_id:
            raise ValueError("the specification belongs to another workspace")
        if self.release is not None and self.release.workspace_id != self.workspace_id:
            raise ValueError("the release belongs to another workspace")
        return self


class AssertionClaims(Strict):
    """Claims of the short-lived Worker -> scanner service assertion (design §9, §21).

    Wire form ``v1.<base64url(claims JSON)>.<base64url(HMAC-SHA256)>`` in ``X-QC-Assertion``.
    The provider's own proxy credential (``Authorization``) is separate and unchanged."""

    kid: Ref
    aud: Literal["texpilot-scanner-qc"]
    iat: Annotated[int, Field(ge=0)]
    exp: Annotated[int, Field(ge=0)]
    nonce: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]
    request_id: Uuid
    request_generation: Annotated[int, Field(ge=1)]
    workspace_id: Uuid
    actor_id: Ref
    payload_sha256: Sha256
    deadline_at: UtcTime

    @model_validator(mode="after")
    def _ttl(self) -> AssertionClaims:
        if not 0 < self.exp - self.iat <= ASSERTION_TTL_S:
            raise ValueError("an assertion lives at most 30 seconds")
        return self


class ErrorBody(Strict):
    code: ErrorCode
    reasons: Annotated[list[Reason], Field(max_length=12)]
    retryable: bool
    request_id: Ref


class ErrorEnvelope(Strict):
    schema_version: Literal["2"]
    error: ErrorBody


#: HTTP status for each error code, and whether a client may retry it (design §3, §17).
ERROR_STATUS: dict[str, tuple[int, bool]] = {
    "UNAUTHENTICATED": (401, False),
    "FORBIDDEN": (403, False),
    "NOT_FOUND": (404, False),
    "MALFORMED_REQUEST": (400, False),
    "METHOD_NOT_ALLOWED": (405, False),
    "CONFLICT": (409, False),
    "PAYLOAD_TOO_LARGE": (413, False),
    "UNSUPPORTED_MEDIA": (415, False),
    "VALIDATION_FAILED": (422, False),
    "CAPACITY_LIMIT": (429, True),
    "SERVICE_UNAVAILABLE": (503, True),
    "DEADLINE_EXCEEDED": (504, True),
    "INTERNAL_ERROR": (500, False),
}

#: Every named record type, for the schema file and the cross-language fixtures.
CONTRACT_TYPES: dict[str, Any] = {
    "Provenance": Provenance,
    "DensitySpec": DensitySpec,
    "PurchaseSpec": PurchaseSpec,
    "SamplingSelection": SamplingSelection,
    "Sample": Sample,
    "AcquisitionAttestation": AcquisitionAttestation,
    "Capture": Capture,
    "CaptureSet": CaptureSet,
    "ConsentAuthority": ConsentAuthority,
    "Evidence": Evidence,
    "DecisionDraft": DecisionDraft,
    "Decision": Decision,
    "Adjudication": Adjudication,
    "QCResult": QCResult,
    "Policy": Policy,
    "DomainManifest": DomainManifest,
    "Release": Release,
    "EvaluationContext": EvaluationContext,
    "CalibrationProfile": CalibrationProfile,
    "ScaleReference": ScaleReference,
    "AxisRegistration": AxisRegistration,
    "ValidatedCapture": ValidatedCapture,
    "Readiness": Readiness,
    "AnalysisCandidate": AnalysisCandidate,
    "AnalyzeRequest": AnalyzeRequest,
    "AssertionClaims": AssertionClaims,
    "ErrorEnvelope": ErrorEnvelope,
}


def contract_schema() -> dict:
    """The canonical JSON Schema document: one ``$defs`` entry per record type."""
    from pydantic.json_schema import models_json_schema

    _, definitions = models_json_schema(
        [(model, "validation") for model in CONTRACT_TYPES.values()],
        ref_template="#/$defs/{model}",
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://texpilot.local/contracts/qc-v2.schema.json",
        "title": "TexPilot incoming-fabric QC v2",
        "x-schema-version": SCHEMA_VERSION,
        "x-limits": {
            "max_originals_per_set": MAX_ORIGINALS_PER_SET,
            "max_original_bytes": MAX_ORIGINAL_BYTES,
            "max_set_bytes": MAX_SET_BYTES,
            "max_decoded_pixels": MAX_DECODED_PIXELS,
            "assertion_ttl_s": ASSERTION_TTL_S,
            "request_deadline_s": REQUEST_DEADLINE_S,
            "max_future_skew_s": MAX_FUTURE_SKEW_S,
            "max_capture_sets": MAX_CAPTURE_SETS,
        },
        "x-error-status": {k: {"status": s, "retryable": r} for k, (s, r) in ERROR_STATUS.items()},
        "x-capture-fixable": sorted(CAPTURE_FIXABLE),
        "x-types": sorted(CONTRACT_TYPES),
        "$defs": definitions["$defs"],
    }


def schema_text() -> str:
    return json.dumps(contract_schema(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":  # python -m services.api.qc_schemas > contracts/qc-v2.schema.json
    import sys

    sys.stdout.write(schema_text())
