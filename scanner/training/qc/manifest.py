"""Immutable dataset manifest for QC training and evaluation (design §8, plan T09).

A manifest lists every image with its source, licence, hashes, grouping identifiers, mask
eligibility and split. It is written once, hashed, and audited (``split_audit.audit_splits``)
before any training or evaluation reads a file.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Literal

from services.api.qc_schemas import canonical_json, sha256_hex

Split = Literal["train", "validation", "calibration", "release_test"]
SPLITS: tuple[str, ...] = ("train", "validation", "calibration", "release_test")
#: Splits no fitting, early stopping, test-time augmentation tuning or logit export may read.
SEALED_SPLITS: frozenset[str] = frozenset({"calibration", "release_test"})

MaskCategory = Literal[
    "absent",  # no mask file exists for this image
    "empty-defective",  # image labelled defective, mask present and entirely empty
    "valid-clean",  # image labelled normal, explicit validated empty mask
    "valid-defective",  # image labelled defective, mask has defect pixels
    "corrupt",  # unreadable, wrong shape or wrong orientation
    "adjudicated-derived",  # approved union/derivation; every source hash retained
]
MASK_CATEGORIES: tuple[str, ...] = (
    "absent",
    "empty-defective",
    "valid-clean",
    "valid-defective",
    "corrupt",
    "adjudicated-derived",
)
#: Categories whose pixels may enter a pixel-level metric denominator.
PIXEL_ELIGIBLE: frozenset[str] = frozenset(
    {"valid-clean", "valid-defective", "adjudicated-derived"}
)

ImageLabel = Literal["normal", "defective"]
Cohort = Literal["DEVELOPMENT", "CONFIRMATORY", "CHALLENGE"]


@dataclass(frozen=True)
class SourceRecord:
    """One dataset source. ``license`` None means not yet cleared (G4)."""

    name: str
    version: str
    url: str
    license: str | None
    permitted_purposes: tuple[str, ...] = ()
    redistribution_permitted: bool = False
    #: Other sources this one is known or suspected to contain (e.g. a compilation dataset).
    derived_from: tuple[str, ...] = ()
    #: Sources the feature backbone or teacher was pretrained on (disclosure, design §8).
    pretraining_exposure: tuple[str, ...] = ()


@dataclass(frozen=True)
class ManifestItem:
    id: str
    source: str
    image_sha256: str
    split: Split
    image_label: ImageLabel | None
    mask_category: MaskCategory
    mask_sha256: str | None = None  # raw annotation as delivered, never rewritten
    derived_mask_sha256: str | None = None
    mask_source_sha256s: tuple[str, ...] = ()  # every source of an approved union
    path: str | None = None
    feature_sha256: str | None = None
    parent_id: str | None = None  # the image a tile or crop was cut from
    roll_id: str | None = None
    lot_id: str | None = None
    factory_id: str | None = None
    perceptual_hash: str | None = None  # 64-bit hex, for near-duplicate linking
    domain: str | None = None
    cohort: Cohort = "DEVELOPMENT"
    fabric_label: str | None = None
    annotation_version: str = "1"
    selection_id: str | None = None
    plan_sha256: str | None = None
    selection_probability: float | None = None
    face: str | None = None
    location_ref: str | None = None
    supplier_id: str | None = None
    planned_area_cm2: float | None = None
    usable_area_cm2: float | None = None
    area_missingness_reason: str | None = None
    sampling_method: str | None = None


@dataclass(frozen=True)
class DatasetManifest:
    id: str
    version: str
    purpose: str  # e.g. "training", "research", "release-evaluation"
    sources: tuple[SourceRecord, ...]
    items: tuple[ManifestItem, ...]
    extra: dict = field(default_factory=dict)

    def source(self, name: str) -> SourceRecord | None:
        return next((s for s in self.sources if s.name == name), None)

    def sha256(self) -> str:
        return manifest_sha256(self)

    def by_split(self, split: str) -> tuple[ManifestItem, ...]:
        return tuple(i for i in self.items if i.split == split)


def manifest_sha256(manifest: DatasetManifest) -> str:
    """Hash of the whole manifest; any changed, added or removed row changes it."""
    return sha256_hex(canonical_json(asdict(manifest)))


def classify_mask(
    image_label: str | None,
    *,
    mask_present: bool,
    readable: bool = True,
    shape_matches: bool = True,
    orientation_matches: bool = True,
    defect_pixels: int = 0,
    adjudicated_sources: tuple[str, ...] = (),
) -> str:
    """Mask eligibility category from what was observed. Never resizes, rotates or repairs.

    A defective image whose mask is present but empty is ``empty-defective``: unresolved
    (gate G5 for AITEX), not a clean negative.
    """
    if not mask_present:
        return "absent"
    if not readable or not shape_matches or not orientation_matches:
        return "corrupt"
    if isinstance(defect_pixels, bool) or not isinstance(defect_pixels, int) or defect_pixels < 0:
        return "corrupt"
    # Empty defective truth stays unresolved even if a caller supplies derivation lineage.
    if image_label == "defective" and defect_pixels == 0:
        return "empty-defective"
    if adjudicated_sources:
        return "adjudicated-derived"
    if defect_pixels > 0:
        # A normal-labelled image with defect pixels contradicts itself: not usable truth.
        return "valid-defective" if image_label == "defective" else "corrupt"
    return "valid-clean" if image_label == "normal" else "corrupt"


def valid_sha256(value: str | None) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def known_license(value: str | None) -> bool:
    """A non-placeholder registry value, not a legal clearance inferred from a URL."""
    return known_identifier(value) and value.strip().lower() != "other"


def known_identifier(value: str | None) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and not value.strip()
        .casefold()
        .startswith(("unknown", "pending", "not yet collected", "unverified", "none", "n/a"))
    )
