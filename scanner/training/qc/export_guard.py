"""Rights check that runs before any dataset or code leaves this machine (design §17, T09/T10).

The existing ``training/textilenet/retrain_rounds_stage.sh`` stamps a blanket CC0 licence on a
mixed staging folder and ``training/fault/publish_code.sh`` exports a mixed tree as "other";
neither checks rights. Both are legacy, unverified exits. A QC export goes through
``guarded_export`` instead: every staged file is inventoried with its hash, source, notices,
purpose and destination, and the transport is called only when every file is cleared.
A private-dataset flag or a scraper URL is not rights clearance.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath

from training.qc.manifest import known_license, valid_sha256


@dataclass(frozen=True)
class StagedFile:
    path: str
    sha256: str
    source: str  # key into the rights registry
    notices: tuple[str, ...] = ()  # licence/attribution notices travelling with the file


@dataclass(frozen=True)
class ExportManifest:
    destination: str  # e.g. "kaggle:owner/dataset"
    purpose: str  # e.g. "training", "research"
    declared_license: str  # what the export metadata will claim
    files: tuple[StagedFile, ...]
    private: bool = True


@dataclass(frozen=True)
class RightsEntry:
    source: str
    license: str | None  # None: not cleared
    permitted_purposes: tuple[str, ...] = ()
    permitted_destinations: tuple[str, ...] = ()
    redistribution_permitted: bool = False
    required_notices: tuple[str, ...] = ()
    consent_withdrawn: bool = False
    valid_from: str | None = None
    expires_at: str | None = None


@dataclass(frozen=True)
class RightsRegistry:
    entries: tuple[RightsEntry, ...]
    evaluated_at: str | None = None  # injected trusted UTC, never the file's own timestamp

    def get(self, source: str) -> RightsEntry | None:
        return next((e for e in self.entries if e.source == source), None)


@dataclass(frozen=True)
class ExportEligibility:
    allowed: bool
    reasons: tuple[str, ...]
    inventory: tuple[tuple[str, str, str], ...]  # (path, sha256, source)


def validate_export(staged: ExportManifest, rights: RightsRegistry) -> ExportEligibility:
    reasons: list[str] = []
    if len({e.source for e in rights.entries}) != len(rights.entries):
        reasons.append("RIGHTS_REGISTRY_AMBIGUOUS")
    if not staged.files:
        reasons.append("EMPTY_EXPORT")
    seen: set[str] = set()
    licences: set[str] = set()
    for file in staged.files:
        if (
            not file.path
            or PurePosixPath(file.path).is_absolute()
            or ".." in PurePosixPath(file.path).parts
        ):
            reasons.append(f"STAGED_PATH_INVALID:{file.path}")
        if file.path in seen:
            reasons.append(f"DUPLICATE_PATH:{file.path}")
        seen.add(file.path)
        if not valid_sha256(file.sha256):
            reasons.append(f"HASH_MISSING:{file.path}")
        entry = rights.get(file.source)
        if entry is None or not known_license(entry.license):
            reasons.append(f"RIGHTS_UNKNOWN:{file.path}")
            continue
        licences.add(entry.license)
        if entry.valid_from is not None or entry.expires_at is not None:
            try:
                now = _utc(rights.evaluated_at)
                if entry.valid_from is not None and now < _utc(entry.valid_from):
                    reasons.append(f"RIGHTS_NOT_YET_VALID:{file.path}")
                if entry.expires_at is not None and now >= _utc(entry.expires_at):
                    reasons.append(f"RIGHTS_EXPIRED:{file.path}")
                if (
                    entry.valid_from is not None
                    and entry.expires_at is not None
                    and _utc(entry.valid_from) >= _utc(entry.expires_at)
                ):
                    reasons.append(f"RIGHTS_TIME_INVALID:{file.path}")
            except (ValueError, TypeError):
                reasons.append(f"RIGHTS_TIME_UNKNOWN:{file.path}")
        if entry.consent_withdrawn is not False:
            reasons.append(f"CONSENT_WITHDRAWN:{file.path}")
        if staged.purpose not in entry.permitted_purposes:
            reasons.append(f"PURPOSE_NOT_PERMITTED:{file.path}")
        if entry.redistribution_permitted is not True:
            reasons.append(f"REDISTRIBUTION_NOT_PERMITTED:{file.path}")
        if staged.destination not in entry.permitted_destinations:
            reasons.append(f"DESTINATION_NOT_PERMITTED:{file.path}")
        missing = [n for n in entry.required_notices if n not in file.notices]
        if missing:
            reasons.append(f"NOTICE_MISSING:{file.path}")
    # One licence label over files with different rights is a false statement about some.
    if licences and licences != {staged.declared_license}:
        reasons.append("BLANKET_LICENSE_MISMATCH")
    return ExportEligibility(
        allowed=not reasons,
        reasons=tuple(dict.fromkeys(reasons)),
        inventory=tuple((f.path, f.sha256, f.source) for f in staged.files),
    )


def _utc(value: str | None) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z", value
    ):
        raise ValueError("trusted UTC rights check time required")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class ExportRefused(RuntimeError):
    def __init__(self, eligibility: ExportEligibility) -> None:
        super().__init__("export refused: " + ", ".join(eligibility.reasons))
        self.eligibility = eligibility


def guarded_export(
    staged: ExportManifest,
    rights: RightsRegistry,
    transport: Callable[[ExportManifest], object],
) -> object:
    """Call ``transport`` only for a fully cleared export. A refusal makes zero network calls."""
    eligibility = validate_export(staged, rights)
    if not eligibility.allowed:
        raise ExportRefused(eligibility)
    return transport(staged)
