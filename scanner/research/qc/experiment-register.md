# Incoming-fabric QC experiment register — C08 / T10

Status: REVIEW_ONLY. Real bundle, training data, fault checkpoint, calibration profile,
release, signing identity, upstream Dinomaly checkout and production hardware report are
not yet collected / external gates G1–G8. No training or performance result was produced by
this work. Synthetic inputs and process doubles exist only in the two C08 test files; their
scores, hashes, identities and timings are not empirical evidence.

## Read-only inventory and account limitations

Existing Kaggle MVTec/WFDD jobs could not be inspected from this machine: no Kaggle CLI,
no credentials and no account access. Nothing was started, cancelled, restarted, uploaded,
downloaded or purchased. Current job status and quota are unknown. The statements below
describe checked-in documents, not a fresh verification of remote runs or their artifacts.
Historical quota and job statuses in those documents are not current account evidence.

| Existing result document | What it records | What it does not prove |
|---|---|---|
| [fault-a2-results-2026-11-13.md](../../docs/fault-a2-results-2026-11-13.md) | Reports completed single-device MVTec/WFDD benchmark runs, per-category metrics, source/data bindings and remotely retained artifacts. | Artifacts were not re-inspected here. Benchmark results do not establish phone/factory QC risk, release suitability, two-device utilization or DDP speedup. |
| [fault-a2-ddp-2026-11-12.md](../../docs/fault-a2-ddp-2026-11-12.md) | Describes DDP implementation, historical local Gloo gradient/update tests, private snapshot verification and a hardware-proof submission rejected for concurrency. | Local numerical/control-flow proof is separate from a real StableAdamW/AMP/NCCL production-loop report. This document supplies no successful two-GPU utilization/speedup proof for C08. |
| [fault-a2-launch-preflight.md](../../docs/fault-a2-launch-preflight.md) | Records historical preflight requirements, bounded inventories/resource checks, later launch handoffs and the AITEX empty-defective-mask blocker. | Its earlier running/queued/quota observations are historical. It does not independently prove present completion, free quota, DDP speedup, AITEX policy resolution or release permission. |
| [kaggle-vitb-timing-2026-11-12.md](../../docs/kaggle-vitb-timing-2026-11-12.md) | Reports a bounded carpet FP32/AMP pilot and projected full-run budgets; distinguishes a failed pilot from its retry and records baseline preparation. | Pilot timings and estimates do not establish full-dataset stability, host-memory bounds, current quota, factory generalization, DDP throughput or an automatic-release gate. |

## Predeclared execution and integrity protocol

Before a future authorized model construction, `fit_with_guard` must verify the entire
sealed DatasetManifest hash and the canonical SHA-256 of the full AuditReport, recompute
the audit, and verify actual bytes for every original, raw/derived annotation and retained
annotation source. Every declared feature artifact is hash-checked, including sealed
features solely for integrity; they are never delivered to a trainer. `feature_cache` is
an exact item-ID-to-file inventory of per-item training/validation features, not a claimed
digest or an uninspected multi-row archive. `feature_files` and `mask_files` resolve pinned
artifact hashes to actual files for integrity checks. A multi-row cache requires an audited
per-item extraction and inventory before this boundary; there is no supported bypass.

Fit consumes exactly train IDs. Early stopping consumes exactly validation IDs. TTA tuning
and ordinary test-logit export may name validation IDs only; calibration and release IDs
never reach these consumers. Extra cache rows, changed/deleted bytes, legacy preliminary CSV
sources, stale/altered audits and truncated sealed manifests fail before model construction.
Callbacks must honor the returned ConsumptionLog; legacy trainers have not been modified.

Run records carry source commit and SHA-256 of the exact dirty patch (hash empty bytes for
a clean tree), upstream SHA, dataset manifest hashes, weights/checkpoint hashes, environment
lock hash, exact commands, seeds, device/driver, global/per-rank batch, successful/attempted/
skipped updates, losses, wall time and peak memory. Missing permitted measurements explicitly
say `unknown`; no missing measurement is guessed. Resumes require parent-run hash, epoch,
optimizer/scaler-state hashes and exact command, are not trajectory-equivalent, and do not
add an independent seed. Seeded cudnn benchmark execution is not bitwise reproducibility.
Compute authorization, quota, measured cap and actual run records: not yet collected / G6.

## Evaluation and ablation protocol

`evaluate_bundle` verifies actual weights, the run record, dataset/audit hashes and all
inputs before invoking a supplied format-specific predictor. No real predictor/weights
are installed here; absent artifacts fail with G6. Ordinary evaluation refuses sealed
calibration/release splits. A real serving-loader and finite-map/box/score parity check are
not yet collected / G6; the owner of the serving adapter must integrate those artifacts.

Reports bind the ordered effective label universe and taxonomy version. Fabric22 and
fabric24/27 scores are separate experiments; no substitute scope or historic bias-fitted
calibration is accepted. Reports include full support tables and fixed-universe unconditional
argmax macro-F1, deployed macro-F1 with known-label abstentions counted as misses, separately
named conditional macro-F1 and coverage, unknown precision/recall and domain coverage.
An absent class is `insufficient support`, never full-universe target attainment.

Fault metrics preserve image labels and audit exclusions; only eligible masks and valid
pixels enter pixel denominators. No resizing, relabeling or mask repair occurs here.
Unresolved empty-defective annotations stay image-level defective and pixel-ineligible;
their audit is blocking. Explicit exploratory arithmetic retains the blocker in its report
and cannot become release evidence. AITEX resolution: not yet collected / G5.

Four immutable offline arms are `classifier-only`, `classifier+defects`,
`classifier+metrology`, `full-fusion`. `evaluate_arms` consumes one pinned DatasetManifest and
complete per-arm outcomes against one full-reference nonconformance endpoint. Threshold
artifact hashes and exact fitting IDs must bind a separate calibration-only manifest;
connected calibration/evaluation groups fail. Missing arms, outputs, reference labels,
cohort rows or provenance fail. Risk uses independent groups; coverage intervals resample
the same groups jointly across arms with a recorded seed. No winner is selected, and
confirmatory comparisons are descriptive. Separate bounds do not establish noninferiority
or no risk increase. No matched-risk gain is concluded when the reference arm fails risk.
HOLD does not count as useful ACCEPT coverage and receives no authority from this module.
Production required stages and the sole evaluator in `qc_policy.py` remain unchanged.

Transductive/MUSC-style arms must name the exact cohort hash and ordered chunk membership.
Their outputs are exploratory. Sample-alone/unrelated-cohort sensitivity measurements and a
stationary-compatible authorized protocol: not yet collected / G6/G7. No scores invented.

## Mandatory DDP evidence

`scripts/qc_ddp_proof.py --manifest research/qc/ddp-proof-manifest.json` must fail nonzero
with G6 here. That manifest is intentionally absent: none of the real artifacts needed to
populate it truthfully are present. Do not substitute historical prose or synthetic data.

A future manifest must bind `bundle_manifest` + its raw-byte `bundle_manifest_sha256`,
`upstream`, `expected_sha`, `report` + its raw-byte `report_sha256`. Paths are relative to
scanner/ (absolute local paths are also accepted). The bundle's upstream SHA must match
the clean actual checkout. The checker runs exactly
`tests/test_fault_dinomaly_ddp.py::test_two_rank_gradients_and_three_updates_match_upstream_global_batch`
with DINOMALY_REPO set and requires a matching JUnit testcase with no skip/failure/error.
Missing torch/upstream or an unexecuted numerical test is a failure, not a successful gate.

The separate production report must record actual StableAdamW/AMP/NCCL execution on two
distinct devices, both-rank utilization/update counters, command/hardware/driver, batch
sizes, attempted/successful/skipped updates, finite losses, wall time, per-device peak
memory and checkpoint hashes, all bound to the same upstream SHA. A speedup claim needs
separately measured matched single-/two-rank loop times; local Gloo proof never supplies it.
Actual numerical execution and production-loop hardware proof: not yet collected / G6.

No authority, owner approval, deployment readiness or gate closure is established by code.
