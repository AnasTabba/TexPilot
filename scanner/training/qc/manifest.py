"""Immutable dataset manifest for QC training and evaluation (design §8, plan T09).

A manifest lists every image with its source, licence, hashes, grouping identifiers, mask
eligibility and split. It is written once, hashed, and audited (``split_audit.audit_splits``)
before any training or evaluation reads a file.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime
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
class ConsentAuthority:
    """A consent grant a source may need before training, audit or export (design §16)."""

    authority_id: str
    source: str
    permitted_purposes: tuple[str, ...] = ()
    withdrawn_at: str | None = None
    expires_at: str | None = None


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
    #: True when the source is personal/factory data that requires a consent authority.
    consent_required: bool = False
    #: Consent grants for this source; every use needs one that is current and permitted.
    consent: tuple[ConsentAuthority, ...] = ()


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


def normalise_identifier(value: str | None) -> str:
    """Canonical form for every human-written identifier (roll, lot, parent, source, person).

    The same physical roll must not become two rolls because of case, padding, Unicode
    compatibility forms, format characters or a different spacing character.
    """
    if not isinstance(value, str):
        return ""
    text = unicodedata.normalize("NFKC", value)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf" and not ch.isspace())
    return text.casefold()


#: Explicit "I do not know" markers; a real identifier may contain one of these words.
PLACEHOLDER_IDENTIFIERS: frozenset[str] = frozenset(
    normalise_identifier(v)
    for v in (
        "-",
        "?",
        "n/a",
        "na",
        "nil",
        "none",
        "null",
        "pending",
        "tba",
        "tbc",
        "tbd",
        "to be confirmed",
        "to be determined",
        "undecided",
        "undefined",
        "unknown",
        "unverified",
        "not yet collected",
        "not collected",
    )
)

#: Licence identifiers cleared for governed use (SPDX ids plus named bespoke grants).
APPROVED_LICENSES: frozenset[str] = frozenset(
    normalise_identifier(v)
    for v in (
        "0BSD",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "CC-BY-4.0",
        "CC-BY-SA-4.0",
        "CC-BY-ND-4.0",
        "CC-BY-NC-4.0",
        "CC-BY-NC-SA-4.0",
        "CC0-1.0",
        "CDLA-Permissive-2.0",
        "CDLA-Sharing-1.0",
        "DL-DE-BY-2.0",
        "Etalab-2.0",
        "MIT",
        "MPL-2.0",
        "ODbL-1.0",
        "ODC-By-1.0",
    )
)


def known_license(value: str | None) -> bool:
    """Only an explicitly approved licence identifier is a cleared licence (G4)."""
    return normalise_identifier(value) in APPROVED_LICENSES


def known_identifier(value: str | None) -> bool:
    """An explicit, non-placeholder identity. A word inside a real id is not a placeholder."""
    key = normalise_identifier(value)
    return bool(key) and key not in PLACEHOLDER_IDENTIFIERS


def _utc(value: str) -> datetime:
    if (
        not isinstance(value, str)
        or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z", value) is None
    ):
        raise ValueError("trusted UTC timestamp required")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def consent_issues(source: SourceRecord, purpose: str, as_of: str | None = None) -> tuple[str, ...]:
    """Why this source may not be used for ``purpose``; empty only for a current grant.

    A source that declares it needs consent must present an authority for it. Missing,
    foreign, withdrawn, expired, undated-with-bounds or purpose-limited grants reject.
    """
    if not source.consent:
        return ("CONSENT_MISSING",) if source.consent_required else ()
    problems: list[str] = []
    for authority in source.consent:
        issues: list[str] = []
        if normalise_identifier(authority.source) != normalise_identifier(source.name):
            issues.append("CONSENT_FOREIGN")
        if not known_identifier(authority.authority_id):
            issues.append("CONSENT_ID_INVALID")
        if authority.withdrawn_at is not None:
            issues.append("CONSENT_WITHDRAWN")
        if normalise_identifier(purpose) not in {
            normalise_identifier(p) for p in authority.permitted_purposes
        }:
            issues.append("CONSENT_PURPOSE_NOT_PERMITTED")
        if authority.expires_at is not None:
            try:
                if as_of is None:
                    issues.append("CONSENT_TIME_UNKNOWN")
                elif _utc(as_of) >= _utc(authority.expires_at):
                    issues.append("CONSENT_EXPIRED")
            except (TypeError, ValueError):
                issues.append("CONSENT_TIME_UNKNOWN")
        # One current, permitted grant is enough; otherwise every stated problem blocks.
        if not issues:
            return ()
        problems.extend(issues)
    return tuple(dict.fromkeys(problems))
