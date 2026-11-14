"""Leakage, rights and mask audit of a dataset manifest (design §8, plan T09).

``audit_splits`` links items that share a parent image, roll, lot, exact image hash or a
near-duplicate perceptual hash into connected components, and reports every component that
spans more than one split. It never moves, relabels or drops an item: it reports, and blocks
promotion when a finding is blocking.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass

from training.qc.manifest import (
    MASK_CATEGORIES,
    PIXEL_ELIGIBLE,
    SPLITS,
    DatasetManifest,
    ManifestItem,
    known_identifier,
    known_license,
    valid_sha256,
)

#: Benchmark sources whose overlap must be audited against each other (design §8).
OVERLAP_SOURCES: frozenset[str] = frozenset({"adnet", "mvtec", "wfdd", "aitex"})
#: Hamming distance at or below which two 64-bit perceptual hashes are linked for review.
NEAR_DUPLICATE_BITS = 4

BLOCKING: frozenset[str] = frozenset(
    {
        "GROUP_SPANS_SPLITS",
        "DUPLICATE_ID",
        "UNKNOWN_SPLIT",
        "LICENSE_UNKNOWN",
        "PURPOSE_NOT_PERMITTED",
        "SOURCE_UNREGISTERED",
        "CHALLENGE_IN_CONFIRMATORY",
        "MASK_LABEL_CONTRADICTION",
        "MASK_CATEGORY_UNKNOWN",
        "DERIVED_MASK_LINEAGE_MISSING",
        "CROSS_SOURCE_OVERLAP_IN_TEST",
        "MASK_EMPTY_DEFECTIVE_UNRESOLVED",
        "MASK_HASH_INVALID",
        "IMAGE_HASH_INVALID",
        "SELECTION_INVALID",
        "SELECTION_INCONSISTENT",
        "EMPTY_MANIFEST",
        "SOURCE_AMBIGUOUS",
        "IMAGE_LABEL_UNKNOWN",
        "AITEX_RELEASE_GATE_OPEN",
    }
)


@dataclass(frozen=True)
class Finding:
    code: str
    message: str
    item_ids: tuple[str, ...] = ()

    @property
    def blocking(self) -> bool:
        return self.code in BLOCKING


@dataclass(frozen=True)
class AuditReport:
    manifest_sha256: str
    findings: tuple[Finding, ...]
    components: tuple[tuple[str, ...], ...]  # connected groups of item ids (size > 1)
    mask_counts: dict[str, int]
    image_level_eligible: tuple[str, ...]
    pixel_eligible: tuple[str, ...]
    image_excluded: dict[str, int]  # reason -> count
    pixel_excluded: dict[str, int]
    #: Defective images with an entirely empty mask: unresolved policy (G5). Kept, image-level
    #: defective, pixel-ineligible, and out of any confirmatory release.
    unresolved_empty_defective: tuple[str, ...]
    confirmatory_release_eligible: tuple[str, ...]
    limitations: tuple[str, ...]
    mask_records: tuple[dict, ...] = ()
    open_gates: tuple[str, ...] = ()
    benchmark_status: str = "NO_DETECTED_OVERLAP"
    submitted_selection_units: int = 0
    confirmatory_selection_units: int = 0

    @property
    def promotable(self) -> bool:
        return not any(f.blocking for f in self.findings)

    def codes(self) -> set[str]:
        return {f.code for f in self.findings}


class _Union:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def join(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def _hamming(a: str, b: str) -> int | None:
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return None


def _area_valid(item: ManifestItem) -> bool:
    planned, usable = item.planned_area_cm2, item.usable_area_cm2
    if (
        isinstance(planned, bool)
        or not isinstance(planned, (int, float))
        or not math.isfinite(planned)
        or planned <= 0
    ):
        return False
    if usable is None:
        return known_identifier(item.area_missingness_reason)
    return (
        not isinstance(usable, bool)
        and isinstance(usable, (int, float))
        and math.isfinite(usable)
        and 0 <= usable <= planned
    )


def _ident(value: str) -> str:
    return value.strip().casefold()


def _components(items: tuple[ManifestItem, ...], near_bits: int) -> _Union:
    union = _Union()
    for item in items:
        union.find(item.id)
    by_key: dict[tuple[str, str], list[str]] = defaultdict(list)
    for item in items:
        # Identifiers are compared as written by people: case and padding do not make a new roll.
        if item.parent_id:
            by_key[("parent", _ident(item.parent_id))].append(item.id)
        # An item that is itself a parent joins its children.
        by_key[("parent", _ident(item.id))].append(item.id)
        if item.roll_id:
            by_key[("roll", _ident(item.roll_id))].append(item.id)
        if item.lot_id:
            by_key[("lot", _ident(item.lot_id))].append(item.id)
        if item.selection_id:
            by_key[("selection", _ident(item.selection_id))].append(item.id)
        if not item.roll_id and not item.lot_id:
            by_key[("unknown-group-source", item.source)].append(item.id)
        by_key[("image", item.image_sha256)].append(item.id)
    for ids in by_key.values():
        for other in ids[1:]:
            union.join(ids[0], other)
    hashed = [i for i in items if i.perceptual_hash]
    for n, a in enumerate(hashed):
        for b in hashed[n + 1 :]:
            distance = _hamming(a.perceptual_hash or "", b.perceptual_hash or "")
            if distance is not None and distance <= near_bits:
                union.join(a.id, b.id)
    return union


def audit_splits(
    manifest: DatasetManifest, *, near_duplicate_bits: int = NEAR_DUPLICATE_BITS
) -> AuditReport:
    if (
        isinstance(near_duplicate_bits, bool)
        or not isinstance(near_duplicate_bits, int)
        or not 0 <= near_duplicate_bits <= 64
    ):
        raise ValueError("near_duplicate_bits must be an integer in [0, 64]")
    items = manifest.items
    findings: list[Finding] = []
    limitations: list[str] = []
    if not items:
        findings.append(Finding("EMPTY_MANIFEST", "No dataset items have been inventoried"))
    if len({s.name for s in manifest.sources}) != len(manifest.sources):
        findings.append(Finding("SOURCE_AMBIGUOUS", "Source register contains duplicate names"))

    counts = Counter(i.id for i in items)
    for item_id, n in sorted(counts.items()):
        if n > 1:
            findings.append(Finding("DUPLICATE_ID", f"{item_id} appears {n} times", (item_id,)))
    for item in items:
        if item.image_label not in ("normal", "defective"):
            findings.append(
                Finding("IMAGE_LABEL_UNKNOWN", f"{item.id}: image truth unknown", (item.id,))
            )
        if item.source.casefold() == "aitex" and item.split == "release_test":
            findings.append(
                Finding(
                    "AITEX_RELEASE_GATE_OPEN",
                    f"{item.id}: AITEX policy gate G5 open; no confirmatory release",
                    (item.id,),
                )
            )
        if not valid_sha256(item.image_sha256):
            findings.append(
                Finding("IMAGE_HASH_INVALID", f"{item.id}: missing raw image hash", (item.id,))
            )
        if item.split not in SPLITS:
            findings.append(
                Finding("UNKNOWN_SPLIT", f"{item.id}: split {item.split!r}", (item.id,))
            )
        if item.mask_category not in MASK_CATEGORIES:
            findings.append(
                Finding("MASK_CATEGORY_UNKNOWN", f"{item.id}: {item.mask_category!r}", (item.id,))
            )

    # Rights: an unknown licence or an unpermitted purpose blocks promotion (G4).
    for name in sorted({i.source for i in items}):
        ids = tuple(i.id for i in items if i.source == name)
        source = manifest.source(name)
        if source is None:
            findings.append(Finding("SOURCE_UNREGISTERED", f"source {name!r} has no record", ids))
            continue
        if not known_license(source.license):
            findings.append(
                Finding("LICENSE_UNKNOWN", f"source {name!r} has no cleared licence (G4)", ids)
            )
        elif manifest.purpose not in source.permitted_purposes:
            findings.append(
                Finding(
                    "PURPOSE_NOT_PERMITTED",
                    f"source {name!r} is not cleared for purpose {manifest.purpose!r} (G4)",
                    ids,
                )
            )
        if source.pretraining_exposure:
            findings.append(
                Finding(
                    "PRETRAINING_EXPOSURE",
                    f"source {name!r}: backbone/teacher exposure to "
                    f"{', '.join(source.pretraining_exposure)} must be disclosed",
                    (),
                )
            )

    union = _components(items, near_duplicate_bits)
    groups: dict[str, list[ManifestItem]] = defaultdict(list)
    for item in items:
        groups[union.find(item.id)].append(item)
    components = tuple(
        tuple(sorted(i.id for i in members)) for members in groups.values() if len(members) > 1
    )
    for members in groups.values():
        ids = tuple(sorted(i.id for i in members))
        splits = sorted({i.split for i in members})
        sources = sorted({i.source for i in members})
        if len(splits) > 1:
            findings.append(
                Finding("GROUP_SPANS_SPLITS", f"linked items span splits {splits}", ids)
            )
        overlap = [s for s in sources if s.lower() in OVERLAP_SOURCES]
        if len(sources) > 1 and overlap:
            sealed = any(i.split in ("calibration", "release_test") for i in members)
            findings.append(
                Finding(
                    "CROSS_SOURCE_OVERLAP_IN_TEST" if sealed else "CROSS_SOURCE_OVERLAP",
                    f"linked items come from several sources {sources}; remove the group from "
                    "test or report the benchmark as contaminated/exploratory",
                    ids,
                )
            )
    # Declared compilations: a source built from another cannot share an evaluation with it
    # without an overlap audit, even when no hash matched.
    present = {i.source for i in items}
    for source in manifest.sources:
        shared = sorted(set(source.derived_from + source.pretraining_exposure) & present)
        if source.name in present and shared:
            affected = tuple(i.id for i in items if i.source in (source.name, *shared))
            sealed = any(
                i.split in ("calibration", "release_test") and i.id in affected for i in items
            )
            findings.append(
                Finding(
                    "CROSS_SOURCE_OVERLAP_IN_TEST" if sealed else "CROSS_SOURCE_OVERLAP",
                    f"source {source.name!r} is derived from {shared}, also present: hash "
                    "matching alone cannot prove these are disjoint",
                    affected,
                )
            )

    if any(i.roll_id is None and i.lot_id is None for i in items):
        limitations.append(
            "Some items have no roll or lot identity: source grouping and de-duplication are a "
            "limitation, not evidence of roll independence."
        )

    image_excluded: Counter[str] = Counter()
    pixel_excluded: Counter[str] = Counter()
    image_ok: list[str] = []
    pixel_ok: list[str] = []
    unresolved: list[str] = []
    confirmatory: list[str] = []
    selections: dict[str, list[ManifestItem]] = defaultdict(list)
    for item in items:
        if item.selection_id:
            selections[item.selection_id].append(item)
    for members in selections.values():
        bindings = {
            (
                i.plan_sha256,
                i.roll_id,
                i.lot_id,
                i.face,
                i.location_ref,
                i.selection_probability,
                i.factory_id,
                i.cohort,
                i.supplier_id,
                i.planned_area_cm2,
                i.sampling_method,
            )
            for i in members
        }
        if len(bindings) > 1:
            findings.append(
                Finding(
                    "SELECTION_INCONSISTENT",
                    "Photos disagree on immutable selection binding",
                    tuple(i.id for i in members),
                )
            )
        if any(i.cohort == "CHALLENGE" for i in members) and any(
            i.split == "release_test" for i in members
        ):
            findings.append(
                Finding(
                    "CHALLENGE_IN_CONFIRMATORY",
                    "Challenge selection remains challenge across all photos",
                    tuple(i.id for i in members),
                )
            )
    for item in items:
        category = item.mask_category
        lineage_ok = True
        if category != "absent" and not valid_sha256(item.mask_sha256):
            lineage_ok = False
            findings.append(
                Finding(
                    "MASK_HASH_INVALID",
                    f"{item.id}: raw annotation hash missing/invalid",
                    (item.id,),
                )
            )
        if category == "valid-clean" and item.image_label == "defective":
            findings.append(
                Finding(
                    "MASK_LABEL_CONTRADICTION",
                    f"{item.id}: a defective image cannot carry a valid-clean mask; an empty "
                    "annotation is not a clean negative",
                    (item.id,),
                )
            )
        if category == "valid-defective" and item.image_label != "defective":
            findings.append(
                Finding(
                    "MASK_LABEL_CONTRADICTION",
                    f"{item.id}: defect pixels on an image not labelled defective",
                    (item.id,),
                )
            )
        if category == "adjudicated-derived" and not (
            valid_sha256(item.derived_mask_sha256)
            and item.mask_source_sha256s
            and all(valid_sha256(h) for h in item.mask_source_sha256s)
            and item.mask_sha256 in item.mask_source_sha256s
        ):
            lineage_ok = False
            findings.append(
                Finding(
                    "DERIVED_MASK_LINEAGE_MISSING",
                    f"{item.id}: a derived mask needs its own hash and every source hash",
                    (item.id,),
                )
            )
        if category == "empty-defective":
            unresolved.append(item.id)
            findings.append(
                Finding(
                    "MASK_EMPTY_DEFECTIVE_UNRESOLVED",
                    f"{item.id}: defective image with an empty mask; gate G5 open. Kept "
                    "as image-level defective, excluded from pixel scoring and from "
                    "confirmatory release.",
                    (item.id,),
                )
            )
        if category == "corrupt":
            findings.append(
                Finding("MASK_CORRUPT", f"{item.id}: mask unreadable or mismatched", (item.id,))
            )

        if item.image_label not in ("normal", "defective"):
            image_excluded["no-image-label"] += 1
        elif category == "corrupt" and item.image_label == "normal":
            # A normal label contradicted by a mask we cannot read is not usable truth.
            image_excluded["corrupt-mask"] += 1
        else:
            image_ok.append(item.id)
        contradiction = (category == "valid-clean" and item.image_label != "normal") or (
            category in ("valid-defective", "empty-defective") and item.image_label != "defective"
        )
        if (
            category in PIXEL_ELIGIBLE
            and lineage_ok
            and not contradiction
            and item.image_label in ("normal", "defective")
        ):
            pixel_ok.append(item.id)
        else:
            pixel_excluded[category] += 1

        if item.split == "release_test":
            probability = item.selection_probability
            selection_ok = (
                known_identifier(item.selection_id)
                and valid_sha256(item.plan_sha256)
                and known_identifier(item.roll_id)
                and known_identifier(item.lot_id)
                and known_identifier(item.factory_id)
                and known_identifier(item.supplier_id)
                and known_identifier(item.sampling_method)
                and _area_valid(item)
                and item.face in ("face", "back")
                and known_identifier(item.location_ref)
                and isinstance(probability, (int, float))
                and not isinstance(probability, bool)
                and math.isfinite(probability)
                and 0 < probability <= 1
            )
            if item.cohort == "CONFIRMATORY" and not selection_ok:
                findings.append(
                    Finding(
                        "SELECTION_INVALID",
                        f"{item.id}: unknown plan/roll/face or sampling binding",
                        (item.id,),
                    )
                )
            if item.cohort == "CHALLENGE":
                findings.append(
                    Finding(
                        "CHALLENGE_IN_CONFIRMATORY",
                        f"{item.id}: a challenge selection cannot enter the release cohort",
                        (item.id,),
                    )
                )
            elif (
                item.cohort == "CONFIRMATORY"
                and item.id in pixel_ok
                and item.image_label is not None
                and selection_ok
            ):
                confirmatory.append(item.id)

    # Candidate lists cannot bypass the audit's blocking decision. Do not silently move rows.
    if any(f.blocking for f in findings):
        confirmatory = []
    return AuditReport(
        manifest_sha256=manifest.sha256(),
        findings=tuple(findings),
        components=tuple(sorted(components)),
        mask_counts={c: sum(1 for i in items if i.mask_category == c) for c in MASK_CATEGORIES},
        image_level_eligible=tuple(image_ok),
        pixel_eligible=tuple(pixel_ok),
        image_excluded=dict(image_excluded),
        pixel_excluded=dict(pixel_excluded),
        unresolved_empty_defective=tuple(unresolved),
        confirmatory_release_eligible=tuple(confirmatory),
        limitations=tuple(limitations),
        mask_records=tuple(
            {
                "item_id": i.id,
                "category": i.mask_category,
                "raw_sha256": i.mask_sha256,
                "derived_sha256": i.derived_mask_sha256,
                "source_sha256s": i.mask_source_sha256s,
            }
            for i in items
        ),
        open_gates=("G5",)
        if unresolved or any(i.source.casefold() == "aitex" for i in items)
        else (),
        benchmark_status="CONTAMINATED_EXPLORATORY"
        if any(f.code.startswith("CROSS_SOURCE_OVERLAP") for f in findings)
        else "NO_DETECTED_OVERLAP",
        submitted_selection_units=len({i.selection_id or union.find(i.id) for i in items}),
        confirmatory_selection_units=len({i.selection_id for i in items if i.id in confirmatory}),
    )
