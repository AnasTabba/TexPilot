# Incoming-fabric QC v2 data and rights register — T09 / C07

Owner: [unfilled — G1/G4 authority to nominate]
Independent reviewer: [unfilled — G7 authority to nominate]
Signed register reference, version, signature and sealed manifest hash: not yet collected — external gates G4/G7.
This is a protocol and empty register. No dataset, licence clearance, consent, annotation,
calibration cohort, release cohort, trained artifact or signing identity is asserted.
Default operation remains REVIEW_ONLY. No collection, training, export or promotion is
approved by this document or a passing software test.

| Source / proposed purpose | Version, original URL and raw inventory hashes | Licence / permitted purpose / redistribution / notices | Consent / retention / deletion authority | Collection status |
| --- | --- | --- | --- | --- |
| ADNet / bounded defect research | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gates G4/G6 |
| MVTec / benchmark comparison | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gate G4 |
| WFDD / overlap audit | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gate G4 |
| AITEX / image and mask research | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gate G4 | empty-mask policy unresolved — external gate G5 |
| Consented lab rolls / limited lab study | not yet collected — external gate G1 | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gates G1/G4 |
| Factory rolls / confirmatory cohort | not yet collected — external gate G1 | not yet collected — external gate G4 | not yet collected — external gate G4 | not yet collected — external gates G1/G2/G4/G7 |
| Backbone / teacher / external pretraining | not yet collected — external gate G6 | not yet collected — external gate G4 | not yet collected — external gate G4 | exposure audit not yet collected — external gates G4/G7 |

## Manifest and sealing protocol

Inventory every consumed image, mask and feature before cropping or augmentation. Record
source/version/URL, permitted purpose, original byte SHA-256, raw annotation SHA-256,
annotation version, source labels, parent image, roll, lot, factory, supplier, physical selection,
location, face, domain and split. Preserve nulls and explicit missingness rather than inventing
identities. Record the immutable sampling plan hash/probability, method, planned and usable
area and missing-area reason. Missing roll identity permits only conservative source grouping
and deduplication; it never establishes roll independence.

`DatasetManifest.sha256()` hashes canonical serialized contents. Retain the manifest bytes,
audit report and audit hash outside any mutable training staging directory. `audit_splits`
reports without moving, dropping or relabelling records. Parent/roll/lot/selection/exact-hash
and near-duplicate links form transitive components across all four splits: train, validation,
calibration and release_test. Shared group IDs are conservative global identifiers; resolve
homonyms with documented provenance, never by silently adding a dataset prefix. Unknown
groups are conservatively connected within their source. A component spanning splits blocks
promotion. Seal calibration and release separately by group and time; neither enters fitting,
early stopping, threshold tuning, ordinary trainer test-logit exports or new annotation queues.

Audit ADNet against MVTec, WFDD, AITEX and all external training/evaluation sources. Retain
perceptual-hash parameters and a manual provenance/near-duplicate review record (not yet
collected — external gate G7). Disclose teacher/backbone exposure. Exact hashes alone cannot
clear declared compilation overlap. Affected groups must leave evaluation through a newly
versioned, reviewed manifest, or the benchmark must be marked CONTAMINATED_EXPLORATORY;
it cannot support confirmatory release. NO_DETECTED_OVERLAP is only a software finding,
not proof of a completed manual audit. Unknown licence or purpose blocks promotion.

## Mask register and denominator protocol

Serialize each item's category and raw/derived/source hashes in both manifest and audit report.
Raw bytes are immutable. `classify_mask` classifies supplied validation observations; it does
not decode files or attest that a caller actually checked them. The collection/annotation owner
must validate decoding, original dimensions and orientation before supplying those observations.
Wrong shape/orientation or unreadable data is corrupt; never resize or rotate into ground truth.

| Category | Image interpretation | Pixel scoring |
| --- | --- | --- |
| absent | retain source image label if known | excluded; no synthetic clean mask |
| empty-defective | retain defective image label | excluded; G5 open |
| valid-clean | explicit validated clean annotation and normal image label | eligible if raw hash present |
| valid-defective | explicit nonempty defect annotation and defective image label | eligible if raw hash present |
| corrupt | preserve source image label and corrupt annotation provenance; no fabricated repair | excluded |
| adjudicated-derived | preserve raw annotation and approved derivation lineage | eligible only with derived hash and every source hash, including original raw hash |

Approved union authority/protocol and source inventory: not yet collected — external gates
G4/G5/G7. A derived label must not be used to evade the empty-defective category. The report
contains category counts, item IDs, explicit image/pixel exclusions by reason and unresolved
IDs. Reconcile totals with all inventoried rows; excluded observations remain in denominators.

The AITEX defective image with an entirely empty mask remains unresolved: never normal,
never dropped, never given an invented mask, image-level defective and pixel-ineligible.
Gate G5 is open. Pending that external policy, all AITEX confirmatory release use is blocked,
including a subset that happens not to contain the empty-mask item. Preserve the raw empty
mask and predeclare denominator/sensitivity reporting. Tests are synthetic doubles, not a
substitute for inspecting the actual source and obtaining a policy decision.

## Consent, withdrawal and restore protocol

Before any byte collection, signed G4 authority must separately cover operational capture,
operational retention, research, training and each export destination. Operational-only consent
supports manual QC without research participation; opt-out must not prevent ordinary QC.
Unknown/foreign/expired/withdrawn authority blocks research access before staging and again
before training/export. A private export flag and scraper URL grant no rights.

Retention agreement, approved durations, hold policy, backup expiry and purge/withdrawal
owner: not yet collected — external gate G4; owner [unfilled]. The design's provisional
24-hour local drafts / 30-day uploaded research originals / 180-day audit metadata are
proposals only, not collection authority. Minimize faces, labels and business secrets; strip GPS
from derivatives, protect originals, encrypt storage/transport, scope access to workspace and
keep raw images out of logs. Record measured area; never infer roll coverage or four-point
scores without measured area and the authorized scheme.

T02/T12 must supply the protected monotonic withdrawal/deletion ledger and restore-reconcile
proof. Before exposing a restored snapshot or consuming a manifest, reconcile against the
current protected ledger: withdrawn/expired originals, derivatives, features, caches and exports
remain unavailable; retain only permitted hashes/tombstones. Record hold actor/reason/expiry;
a hold cannot grant new research rights. Reconcile local files/WAL, D1 blobs and backups,
then prove expiry. Those storage drills are not implemented by this manifest audit. Signed
proof: not yet collected — external gates G4/G8. Already trained artifact withdrawal or
retraining follows the signed agreement; no automatic unlearning claim.

## Export boundary and legacy exits

`validate_export` inventories every staged path/hash/source plus destination, purpose and
notices in the input manifest. `guarded_export` refuses before invoking its transport unless
every registry entry is unambiguous, its rights/purpose/destination permit redistribution,
applicable validity dates are current and notices are preserved. Time-bounded rights require
an injected trusted UTC check time. Registry verification and byte-to-manifest reconciliation
must occur before calling this boundary; it does not grant rights or scan arbitrary directories.

The existing scripts have not been run or changed. `training/textilenet/retrain_rounds_stage.sh`
lines 16–23 mix sources, features, prelim split and deployed head; line 25 claims CC0-1.0
for the whole snapshot; lines 30–33 and 37 make Kaggle calls. `training/fault/publish_code.sh`
lines 31–35 gather training/services/pyproject.toml, line 50 stages that mixed tree, line 56
labels it "other", and lines 77–80 make Kaggle calls. These exits remain unverified and must
not be reused for QC until the complete staged inventory passes the guard immediately before
any network action. Guard integration in those scripts belongs to their owner. No blanket CC0
may be asserted over mixed rights. No network, Kaggle, installation or training occurred here.
