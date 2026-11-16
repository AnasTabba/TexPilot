"""Sealed-manifest enforcement at the training input boundary (design §17, plan T10).

``verify_training_inputs`` runs before a model is constructed and refuses to continue when the
audit is missing or stale, a file or cached feature changed, an unintended id is consumed, the
confirmatory data is truncated, a legacy preliminary CSV is substituted for the manifest, or a
sealed calibration/release row reaches fitting. ``fit_with_guard`` is the only sanctioned way
to call a trainer: the model factory is not invoked until verification passes.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

from services.api.qc_schemas import canonical_json, sha256_hex
from training.qc.manifest import SEALED_SPLITS, DatasetManifest, consent_issues
from training.qc.split_audit import AuditReport, audit_splits

#: Legacy split files that predate the grouped manifest and must not replace it.
LEGACY_INPUT_MARKERS: tuple[str, ...] = ("splits/prelim", "prelim_fabric.csv", "prelim/fabric.csv")


class TrainingInputError(RuntimeError):
    """Raised before model construction; carries machine-readable reasons."""

    def __init__(self, reasons: Iterable[str]) -> None:
        self.reasons = tuple(reasons)
        super().__init__("training inputs refused: " + "; ".join(self.reasons))


@dataclass(frozen=True)
class ConsumptionLog:
    manifest_sha256: str
    audit_sha256: str
    fit_ids: tuple[str, ...]
    validation_ids: tuple[str, ...]
    tta_ids: tuple[str, ...]
    test_export_ids: tuple[str, ...]
    files_verified: int
    features_verified: int


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_training_inputs(
    manifest: DatasetManifest,
    audit: AuditReport,
    *,
    expected_manifest_sha256: str,
    expected_audit_sha256: str,
    root: Path,
    fit_ids: Iterable[str],
    validation_ids: Iterable[str] = (),
    tta_ids: Iterable[str] = (),
    test_export_ids: Iterable[str] = (),
    feature_cache: dict[str, Path] | None = None,
    feature_files: dict[str, Path] | None = None,
    mask_files: dict[str, Path] | None = None,
    input_sources: Iterable[str] = (),
    as_of: str | None = None,
) -> ConsumptionLog:
    """Check everything a trainer is about to read. Raises TrainingInputError on any problem.

    ``feature_cache`` maps item id -> actual cached feature file (never a claimed hash).
    ``mask_files`` maps each raw/derived/lineage hash -> actual annotation file.
    All manifest images and annotations, including sealed rows, are checked for integrity;
    only explicitly logged nonsealed IDs are handed to the trainer.
    ``input_sources`` are the paths the trainer was pointed at (to catch a legacy CSV).
    ``as_of`` is the trusted UTC time consent expiry is evaluated against; bounded consent
    without it is refused.
    """
    reasons: list[str] = []
    actual = manifest.sha256()
    if actual != expected_manifest_sha256:
        reasons.append("MANIFEST_HASH_MISMATCH")
    if not isinstance(audit, AuditReport):
        raise TrainingInputError(["AUDIT_MISSING"])
    audit_hash = sha256_hex(canonical_json(asdict(audit)))
    if audit_hash != expected_audit_sha256:
        reasons.append("AUDIT_HASH_MISMATCH")
    if audit != audit_splits(manifest, as_of=as_of):
        reasons.append("AUDIT_CONTENT_MISMATCH")
    # Consent is checked again at the training boundary, not only during the audit.
    for source in manifest.sources:
        for issue in consent_issues(source, manifest.purpose, as_of):
            reasons.append(f"CONSENT_INVALID:{source.name}:{issue}")
    if audit.manifest_sha256 != actual:
        reasons.append("AUDIT_NOT_FOR_THIS_MANIFEST")
    if not audit.promotable:
        blocking = sorted({f.code for f in audit.findings if f.blocking})
        reasons.append("AUDIT_BLOCKING:" + ",".join(blocking))
    for source in input_sources:
        if any(marker in str(source).replace("\\", "/") for marker in LEGACY_INPUT_MARKERS):
            reasons.append(f"LEGACY_SPLIT_SUBSTITUTED:{source}")

    by_id = {item.id: item for item in manifest.items}
    fit, validation = tuple(fit_ids), tuple(validation_ids)
    tta, exported = tuple(tta_ids), tuple(test_export_ids)
    for consumer, ids, split in (
        ("FIT", fit, "train"),
        ("VALIDATION", validation, "validation"),
        ("TTA", tta, "validation"),
        ("TEST_EXPORT", exported, "validation"),
    ):
        if len(set(ids)) != len(ids):
            reasons.append(f"DUPLICATE_CONSUMED_ID:{consumer}")
        for item_id in ids:
            item = by_id.get(item_id)
            if item is None:
                reasons.append(f"UNINTENDED_ID:{consumer}:{item_id}")
            elif item.split != split:
                code = "SEALED_ROW" if item.split in SEALED_SPLITS else "WRONG_SPLIT"
                reasons.append(f"{code}_IN_{consumer}:{item_id}")
    # The whole train split is consumed: silent truncation changes what was trained on.
    intended_fit = {i.id for i in manifest.items if i.split == "train"}
    if intended_fit - set(fit):
        reasons.append(f"FIT_TRUNCATED:{len(intended_fit - set(fit))}_missing")
    intended_validation = {i.id for i in manifest.items if i.split == "validation"}
    if intended_validation - set(validation):
        reasons.append(f"VALIDATION_TRUNCATED:{len(intended_validation - set(validation))}_missing")

    files = features = 0
    cache = feature_cache or {}
    sealed_ids = {i.id for i in manifest.items if i.split in SEALED_SPLITS}
    extra_cache = sorted(set(cache) - set(fit) - set(validation))
    for item_id in extra_cache:
        code = "SEALED_ROW_IN_FEATURE_CACHE" if item_id in sealed_ids else "EXTRA_FEATURE_ROW"
        reasons.append(f"{code}:{item_id}")

    def verify_file(path, expected, code):
        try:
            candidate = root / Path(path)
            if not candidate.is_file() or _file_sha256(candidate) != expected:
                reasons.append(code)
                return False
        except (OSError, TypeError, ValueError):
            reasons.append(code)
            return False
        return True

    for item in manifest.items:
        item_id = item.id
        if item.path is None:
            reasons.append(f"PATH_MISSING:{item_id}")
        else:
            if verify_file(item.path, item.image_sha256, f"FILE_MISSING_OR_CHANGED:{item_id}"):
                files += 1
        hashes = {
            h
            for h in (item.mask_sha256, item.derived_mask_sha256, *item.mask_source_sha256s)
            if h is not None
        }
        for expected in hashes:
            verify_file(
                (mask_files or {}).get(expected),
                expected,
                f"MASK_MISSING_OR_CHANGED:{item_id}:{expected}",
            )
        if item.feature_sha256 is not None:
            verify_file(
                (feature_files or {}).get(item.feature_sha256),
                item.feature_sha256,
                f"FEATURE_ARTIFACT_MISSING_OR_CHANGED:{item_id}",
            )
        if item_id in (*fit, *validation) and (feature_cache is not None or item.feature_sha256):
            if item.feature_sha256 is None:
                reasons.append(f"FEATURE_CHANGED:{item_id}")
            elif verify_file(
                cache.get(item_id), item.feature_sha256, f"FEATURE_MISSING_OR_CHANGED:{item_id}"
            ):
                features += 1
    if reasons:
        raise TrainingInputError(dict.fromkeys(reasons))
    return ConsumptionLog(actual, audit_hash, fit, validation, tta, exported, files, features)


def fit_with_guard(
    build_model: Callable[[], object],
    fit: Callable[[object, ConsumptionLog], object],
    manifest: DatasetManifest,
    audit: AuditReport,
    **verify_kwargs,
) -> tuple[object, ConsumptionLog]:
    """Verify, then construct, then fit. ``build_model`` is never called on refused inputs."""
    log = verify_training_inputs(manifest, audit, **verify_kwargs)
    model = build_model()
    return fit(model, log), log


REQUIRED_RUN_FIELDS: tuple[str, ...] = (
    "source_commit",
    "dirty_patch_sha256",  # SHA-256 of the exact patch; hash empty bytes for a clean tree
    "upstream_sha",
    "dataset_manifest_sha256s",
    "weights_sha256",
    "environment_lock_sha256",
    "commands",
    "seeds",
    "hardware",
    "global_batch",
    "per_rank_batch",
    "steps_successful",
    "steps_attempted",
    "steps_skipped",
    "wall_time_s",
    "checkpoint_sha256s",
    "losses",
    "peak_memory_bytes",
)
#: Measurements that may honestly be unknown; they must then say so explicitly.
MAY_BE_UNKNOWN: frozenset[str] = frozenset(
    {"wall_time_s", "steps_attempted", "steps_skipped", "hardware", "per_rank_batch"}
)
UNKNOWN = "unknown"


def is_sha256(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def is_commit(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def _whole(value, *, positive=False):
    return type(value) is int and value >= (1 if positive else 0)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


@dataclass(frozen=True)
class ResumeRecord:
    parent_run_sha256: str
    epoch: int
    optimizer_state_sha256: str
    scaler_state_sha256: str
    command: str


def validate_run_record(record: dict) -> tuple[str, ...]:
    """Problems with a run's reproducibility record; empty when complete.

    Every field is present. A missing measurement is the explicit string ``"unknown"``, never
    omitted and never guessed. A resumed run names its parent and is not a new seed. Seeded
    training with cudnn.benchmark is not bitwise reproducible and must not claim to be.
    """
    if not isinstance(record, dict):
        return ("RUN_RECORD_MISSING",)
    problems: list[str] = []
    for name in REQUIRED_RUN_FIELDS:
        if name not in record or record[name] is None or record[name] == "" or record[name] == []:
            problems.append(f"MISSING:{name}")
        elif record[name] == UNKNOWN and name not in MAY_BE_UNKNOWN:
            problems.append(f"UNKNOWN_NOT_ALLOWED:{name}")
    for name in ("source_commit", "upstream_sha"):
        if not is_commit(record.get(name)):
            problems.append(f"UNPINNED:{name}")
    for name in ("dirty_patch_sha256", "weights_sha256", "environment_lock_sha256"):
        if not is_sha256(record.get(name)):
            problems.append(f"UNPINNED:{name}")
    for name in ("dataset_manifest_sha256s", "checkpoint_sha256s"):
        values = record.get(name)
        if not isinstance(values, (list, tuple)) or not values or not all(map(is_sha256, values)):
            problems.append(f"UNPINNED:{name}")
    commands, seeds = record.get("commands"), record.get("seeds")
    if (
        not isinstance(commands, (list, tuple))
        or not commands
        or not all(isinstance(c, str) and c.strip() for c in commands)
    ):
        problems.append("INVALID:commands")
    if not isinstance(seeds, (list, tuple)) or not seeds or not all(map(_whole, seeds)):
        problems.append("INVALID:seeds")
    for name in (
        "global_batch",
        "per_rank_batch",
        "steps_successful",
        "steps_attempted",
        "steps_skipped",
    ):
        value = record.get(name)
        if value == UNKNOWN and name in MAY_BE_UNKNOWN:
            continue
        if not _whole(value, positive=name in ("global_batch", "per_rank_batch")):
            problems.append(f"INVALID:{name}")
    successful, attempted, skipped = (
        record.get(k) for k in ("steps_successful", "steps_attempted", "steps_skipped")
    )
    if (
        all(_whole(v) for v in (successful, attempted, skipped))
        and successful + skipped != attempted
    ):
        problems.append("STEP_COUNTS_INCONSISTENT")
    wall = record.get("wall_time_s")
    if wall != UNKNOWN and (not _finite(wall) or wall < 0):
        problems.append("INVALID:wall_time_s")
    losses = record.get("losses")
    if not isinstance(losses, (tuple, list)) or not losses or not all(map(_finite, losses)):
        problems.append("INVALID:losses")
    peaks = record.get("peak_memory_bytes")
    if not isinstance(peaks, dict) or not peaks or not all(map(_whole, peaks.values())):
        problems.append("INVALID:peak_memory_bytes")
    hardware = record.get("hardware")
    if hardware != UNKNOWN and (
        not isinstance(hardware, dict) or not hardware.get("device") or not hardware.get("driver")
    ):
        problems.append("INVALID:hardware")
    resume = record.get("resumed_from")
    if resume is not None:
        if isinstance(resume, dict):
            try:
                resume = ResumeRecord(**resume)
            except TypeError:
                resume = None
        if not isinstance(resume, ResumeRecord) or not (
            is_sha256(resume.parent_run_sha256)
            and _whole(resume.epoch)
            and is_sha256(resume.optimizer_state_sha256)
            and is_sha256(resume.scaler_state_sha256)
            and isinstance(resume.command, str)
            and resume.command.strip()
        ):
            problems.append("RESUME_RECORD_INCOMPLETE")
        if record.get("counts_as_independent_seed"):
            problems.append("RESUMED_RUN_IS_NOT_A_NEW_SEED")
        if record.get("trajectory_equivalent"):
            problems.append("RESUMED_RUN_IS_NOT_TRAJECTORY_EQUIVALENT")
    if record.get("bitwise_reproducible") and record.get("cudnn_benchmark", True):
        problems.append("BITWISE_CLAIM_WITH_CUDNN_BENCHMARK")
    if record.get("ddp_speedup_claimed") and not record.get("nccl_hardware_report_sha256"):
        problems.append("SPEEDUP_CLAIM_WITHOUT_HARDWARE_PROOF")
    return tuple(problems)


def independent_seed_count(records: Iterable[dict]) -> int:
    """Distinct fresh seeds among complete records; resumed runs never add one."""
    seeds: set[object] = set()
    for record in records:
        if record.get("resumed_from") is None and not validate_run_record(record):
            seeds.update(record["seeds"])
    return len(seeds)
