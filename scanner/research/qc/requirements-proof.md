# Incoming-fabric QC v2 requirements evidence index

> 14 Nov 2026: this index still records no test results and its file inventory predates
> `qc-r01.test.mjs` and migration `0034`.

State: implemented, external evidence missing. This index maps the plan's 14 requirements
matrix rows and five final traceability additions. It records file presence, proposed
verification commands and remaining evidence; **it records no test results**. The lead
integrator owns execution results and the final archive. Presence does not establish
assertion completeness, successful collection, native validation or release authority.
Concurrent workers may change this inventory; re-list before final integration.

## Inventory used for this index

Read-only directory inventory performed with `ls scanner/tests`, `ls yarnflow/tests` and
`rg --files scanner/tests yarnflow/tests`. Paths below are repository-root relative.
Existing QC Python test files at authoring:

```text
scanner/tests/test_qc_ablations.py
scanner/tests/test_qc_api.py
scanner/tests/test_qc_contracts.py
scanner/tests/test_qc_enrollment.py
scanner/tests/test_qc_export_guard.py
scanner/tests/test_qc_imageio.py
scanner/tests/test_qc_metrology.py
scanner/tests/test_qc_parity.py
scanner/tests/test_qc_pipeline.py
scanner/tests/test_qc_policy.py
scanner/tests/test_qc_quality.py
scanner/tests/test_qc_references.py
scanner/tests/test_qc_release_gate.py
scanner/tests/test_qc_serving_loader.py
scanner/tests/test_qc_split_audit.py
scanner/tests/test_qc_training.py
scanner/tests/test_qc_workflow_metrics.py
```

Existing Yarnflow QC tests: `yarnflow/tests/qc-api.test.mjs`,
`yarnflow/tests/qc-faults.test.mjs`, `yarnflow/tests/qc-types.test.ts`.
Relevant existing legacy tests: `scanner/tests/test_api.py`, `test_spec_api.py`,
`test_textilenet_splits.py`, `test_fault_data.py`, `test_fault_dinomaly_ddp.py`;
`yarnflow/tests/audit.test.mjs`, `migrations.test.mjs`, `quality.test.mjs`,
`claims.test.mjs`, `stock.test.mjs`, `scanner-proxy.test.mjs`.
Legacy tests are compatibility context, not substitutes for missing QC invariants.

Planned Yarnflow test files **not present yet** at this inventory:
`tests/qc-store.test.mjs`, `qc-migration.test.mjs`, `qc-retention.test.mjs`,
`qc-blob-claims.test.mjs`, `qc-service-integration.test.mjs`, `qc-monitoring.test.mjs`,
`qc-recalls.test.mjs`, `qc-client.test.ts`, `qc-drafts.test.ts`, `qc-cache.test.mjs`.
All these paths are under `yarnflow/`; no command for them is represented as existing proof.
`scanner/scripts/qc_benchmark.py`, `scanner/scripts/qc_ddp_proof.py` and
`scanner/research/qc/ddp-proof-manifest.json` were also not present yet when inspected.

Commands in the table are to be run from `scanner/` for Python and `yarnflow/` for
Node/web. Every Python command uses the existing `../.venv/bin/python`; no installation
or network is authorized. Type stripping is only used for the existing TypeScript tests.
These are verification instructions, not statements that a command was executed or passed.
Allowed state labels are: implemented, tests present / implemented, external evidence
missing / blocked by Gn / not present yet. A row's state describes its remaining closure;
listed partial software evidence does not override a blocker.

## Requirements → tasks → proof matrix

| Requirement | Owning tasks | Test files / commands that prove the software part | External evidence still required | Gate (G1–G8) | State |
|---|---|---|---|---|---|
| Scope/novelty/sample-only/no side effects | T01,T05,T07,T10,T11,T13 | Existing: `../.venv/bin/python -m pytest tests/test_qc_contracts.py tests/test_qc_ablations.py tests/test_qc_release_gate.py -q`; `node --test tests/qc-api.test.mjs`. Snapshot API assertions must be audited. Client tests not present yet: `yarnflow/tests/qc-client.test.ts`. | Four-arm risk-bounded paired coverage report; sample-scope comprehension study with non-developers; side-effect snapshot archive | G1,G2,G7 | blocked by G1 |
| Exact statuses/types/reasons/provenance/PO units | T01,T03,T05 | Existing: `../.venv/bin/python -m pytest tests/test_qc_contracts.py tests/test_qc_policy.py -q`; `node --experimental-strip-types --test tests/qc-types.test.ts`; `node --test tests/qc-api.test.mjs`. Storage stale-version proof not present yet: `yarnflow/tests/qc-store.test.mjs`. | Factory PO/tolerance authority, complete Swift fixture roundtrip and signed authority evidence; no inference of compliance from fixtures | G2,G8 | not present yet |
| Central fabric taxonomy/F1/unknown | T01,T06,T10,T11 | Existing: `../.venv/bin/python -m pytest tests/test_qc_contracts.py tests/test_qc_pipeline.py tests/test_qc_training.py tests/test_qc_release_gate.py -q`. | Real flat-swatch classifier identity; fixed taxonomy support and unconditional/deployed/conditional F1; unknown/OOD challenges; calibrated serving aggregation and independent per-domain confirmation | G2,G6,G7 | blocked by G6 |
| Defects/ADNet/AITEX integrity | T06,T09,T10 | Existing: `../.venv/bin/python -m pytest tests/test_qc_serving_loader.py tests/test_qc_split_audit.py tests/test_qc_training.py tests/test_fault_data.py -q`; legacy fault test requires unavailable dependencies. | Real compatible artifact/loader and serving-score/box proof; source overlap, raw/derived mask eligibility denominators; AITEX empty-defective decision and rights clearance | G4,G5,G6 | blocked by G6 |
| Geometry/FFT/quality/metrology | T04,T11 | Existing: `../.venv/bin/python -m pytest tests/test_qc_metrology.py tests/test_qc_quality.py tests/test_qc_imageio.py tests/test_qc_release_gate.py -q`. | Blinded pick-glass readings/uncertainty; physical ends/picks registration; source-direction resolution, independent distortion/harmonic/yarn identity and validated device profiles; authorized standards/reference method | G1,G2,G3 | blocked by G3 |
| Sampling/groundtruth/selective risk | T09,T11 | Existing: `../.venv/bin/python -m pytest tests/test_qc_references.py tests/test_qc_split_audit.py tests/test_qc_enrollment.py tests/test_qc_workflow_metrics.py tests/test_qc_release_gate.py -q`. | Independent complete-workflow any-ACCEPT cohort, double-blinded references, grouped support/one-sided bound and signed risk/HOLD utility criteria; incomplete enrollments retained | G1,G2,G4,G7 | blocked by G7 |
| Licenses/consent/retention/privacy | T09,T12 | Existing: `../.venv/bin/python -m pytest tests/test_qc_export_guard.py tests/test_qc_split_audit.py -q`; `node --test tests/qc-api.test.mjs tests/qc-faults.test.mjs`. Retention/restore tests not present yet: `yarnflow/tests/qc-retention.test.mjs`. | Signed rights/consent/purpose/destination/retention register; withdrawal, deletion-ledger and backup-expiry drill including derivatives/features | G1,G4,G5,G8 | blocked by G4 |
| Reproducibility/DDP/resources | T10,T12 | Existing: `../.venv/bin/python -m pytest tests/test_qc_training.py tests/test_qc_ablations.py tests/test_textilenet_splits.py tests/test_fault_dinomaly_ddp.py -q`. DDP proof script/manifest not present yet; numerical test dependencies unavailable here. | Pinned actual upstream/bundle, no-skip numerical proof, separate real NCCL/AMP production-loop report, consumed-ID/resume lineage, authorized measured compute/storage budget | G4,G6,G8 | blocked by G6 |
| Auth/tenancy/errors/concurrency/audit | T02,T05,T06,T12 | Existing: `../.venv/bin/python -m pytest tests/test_qc_api.py tests/test_qc_pipeline.py -q`; `node --test tests/qc-api.test.mjs tests/qc-faults.test.mjs tests/audit.test.mjs`. QC store/blob claims/service integration tests not present yet: `yarnflow/tests/qc-store.test.mjs`, `qc-blob-claims.test.mjs`, `qc-service-integration.test.mjs`. | Real Worker→ASGI boundary, current-session/deadline/revoke races, credential suitability/rotation and threat review; no cookie to scanner | G8 | not present yet |
| Migration/backups/mixed versions | T02,T12 | Existing compatibility context: `node --test tests/migrations.test.mjs tests/audit.test.mjs`. QC populated migration/restore tests not present yet: `yarnflow/tests/qc-migration.test.mjs`, `qc-store.test.mjs`, `qc-retention.test.mjs`, `qc-blob-claims.test.mjs`. | Actual D1-contained blob and local SQLite WAL/file restore, later-write reconciliation and monotonic ledger replay; old readers/additive rollback; recovery objectives | G4,G8 | not present yet |
| Web/native/offline/stale/cache/Urdu/a11y | T07,T08 | Existing: `node --experimental-strip-types --test tests/qc-types.test.ts`; `npm run typecheck` checks integration types only. Client/draft/cache tests not present yet: `yarnflow/tests/qc-client.test.ts`, `qc-drafts.test.ts`, `qc-cache.test.mjs`; those are not UI/device proof. | Built service-worker/two-tab session races, Playwright/axe evidence, actual native login/camera/Codable/UI build, authorized signed device, fluent Urdu/RTL and VoiceOver/Dynamic Type report | G1,G3,G8 | not present yet |
| CPU/export/quantization/deployment | T12 | Existing: `../.venv/bin/python -m pytest tests/test_qc_parity.py -q`; real bundle test explicitly skipped for G6/G8. Benchmark script not present yet: `scanner/scripts/qc_benchmark.py`. | Actual cold/warm p50/p95, CPU/RSS/contention429/deadline target proof; optional export score/density/region/status and risk parity; cost/credential/deployment approval | G6,G7,G8 | blocked by G6 |
| Monitoring/drift/rollback/active learning | T09,T11,T12 | Existing partial checks: `../.venv/bin/python -m pytest tests/test_qc_policy.py tests/test_qc_release_gate.py -q`; `node --test tests/qc-faults.test.mjs`. Monitoring/recall tests not present yet: `yarnflow/tests/qc-monitoring.test.mjs`, `qc-recalls.test.mjs`. | Approved counters/denominators/probabilities/cadence/support/freshness/detection delay; domain suspension, exhaustive immutable recall/outbox drill; predecessor compatibility; rights-safe active learning | G2,G4,G7,G8 | not present yet |
| Demo/final/study/traceability | T07,T13 | Existing software evidence is indexed here, including `../.venv/bin/python -m pytest tests/test_qc_parity.py -q`; no test proves a conducted study. Rerun archived T01–T12 commands below; final evidence archive not present yet. | Consented dated review-only demonstration; signed SOP, counterbalanced non-developer study with CIs/recruitment limits/negative results; final scope equals actual approvals | G1,G2,G3,G4,G5,G6,G7,G8 | blocked by G1 |

## Final requirements traceability additions

| Requirement | Owning tasks | Test files / commands that prove the software part | External evidence still required | Gate (G1–G8) | State |
|---|---|---|---|---|---|
| Revised-spec immutable sample family | T01,T02,T05,T07,T08,T11 | Existing: `../.venv/bin/python -m pytest tests/test_qc_contracts.py tests/test_qc_policy.py tests/test_qc_workflow_metrics.py -q`; `node --test tests/qc-api.test.mjs`. Store/client tests not present yet: `yarnflow/tests/qc-store.test.mjs`, `qc-client.test.ts`. | Integrated paused-v1→409/no-write, explicit linked-v2 recapture/reload, complete native history; one selection/family attempt budget; independent spec-aware any-ACCEPT reference | G1,G2,G7,G8 | not present yet |
| Consent/export/purge/recovery | T01,T02,T05,T09,T10,T12 | Existing: `../.venv/bin/python -m pytest tests/test_qc_contracts.py tests/test_qc_export_guard.py -q`; `node --test tests/qc-api.test.mjs tests/qc-faults.test.mjs`. Retention/blob tests not present yet: `yarnflow/tests/qc-retention.test.mjs`, `qc-blob-claims.test.mjs`. | Pre-byte rejection and fake-export zero-call enforcement review; signed legal rights; actual old-snapshot→withdraw/delete→restore ledger replay with no bytes/features resurrected | G4,G5,G8 | blocked by G4 |
| Source resolution/physical axis/OOD/clock | T01,T03,T04,T06 | Existing: `../.venv/bin/python -m pytest tests/test_qc_contracts.py tests/test_qc_policy.py tests/test_qc_metrology.py tests/test_qc_quality.py tests/test_qc_imageio.py tests/test_qc_pipeline.py tests/test_qc_api.py -q`. | Physical axis/source-resolution/profile challenges, executed domain assessment and calibration artifact, injected clock at expiry, original-raster proof; no unvalidated resizing fallback | G3,G6,G8 | blocked by G3 |
| Monitoring/recalls/session/GC races | T02,T05,T07,T08,T12 | Existing partial boundary: `node --test tests/qc-api.test.mjs tests/qc-faults.test.mjs`. Not present yet: `yarnflow/tests/qc-monitoring.test.mjs`, `qc-recalls.test.mjs`, `qc-retention.test.mjs`, `qc-blob-claims.test.mjs`, `qc-service-integration.test.mjs`, `qc-client.test.ts`, `qc-drafts.test.ts`, `qc-cache.test.mjs`. | Signed monitoring protocol; actual D1/filesystem barriers/crashes/GC, session revocation at batch, isolated restore; exhaustive tenant recall pagination and delivery/ack evidence | G4,G8 | not present yet |
| Statistical endpoint/ablation/DDP/feasibility | T09,T10,T11 | Existing: `../.venv/bin/python -m pytest tests/test_qc_enrollment.py tests/test_qc_references.py tests/test_qc_split_audit.py tests/test_qc_training.py tests/test_qc_ablations.py tests/test_qc_workflow_metrics.py tests/test_qc_release_gate.py tests/test_fault_dinomaly_ddp.py -q`. Pinned DDP proof script/manifest not present yet. | Authorized independent enrollment feasibility, frozen grouped paired arms and any-ACCEPT risk accounting, HOLD criterion, no-skip pinned numerical proof and separate NCCL report, independent statistical candidate | G1,G2,G4,G6,G7 | blocked by G7 |

## Gate register and honest fallback

| Gate | Evidence still required | Authority placeholder | Fallback |
|---|---|---|---|
| G1 | Factory access, independent sampling, QC SOP/study recruitment; not yet collected | project lead/factory QC [unfilled] | consented lab-only REVIEW_ONLY; participant counts/dates to be set under G1 |
| G2 | Tolerances, sampling plan, ACCEPT risk and HOLD utility/error criteria; not yet collected | factory QC/risk owner [unfilled] | REVIEW_ONLY |
| G3 | Traceable physical calibration, pick-glass and profile/axis/uncertainty validation; not yet collected | metrology lead [unfilled] | no automated density |
| G4 | Rights, consent, retention/withdrawal/export/backup policy; not yet collected | data steward/legal [unfilled] | no unauthorized collection, training, export or purge |
| G5 | AITEX empty-defective-mask decision; not yet collected | dataset authority [unfilled] | exclude unresolved annotations from confirmatory release; preserve denominators |
| G6 | Actual trained fault artifact, compatible loader/export/target and real NCCL proof; not yet collected | training/ML owner [unfilled] | unavailable stages, REVIEW_ONLY, no performance/speedup claim |
| G7 | Independent grouped cohort, frozen risk bounds and signatures; not yet collected | independent QC/statistics [unfilled] | no automatic ACCEPT or HOLD |
| G8 | Security/auth/storage/deployment budget/recovery/monitoring/signing sign-off; not yet collected | app/security owner [unfilled] | local REVIEW_ONLY only |

No gate is approved by this index. Empty support or missing labels cannot imply zero risk.
Any-ACCEPT over the full permitted family workflow is the confirmatory endpoint; images,
retries and changed PO versions never inflate independent n. Final-state risk is separate.
Four-arm results require grouped paired coverage uncertainty and independent risk bounds,
not a claim of noninferiority. HOLD needs its explicit approved error/utility criterion.

## Evidence assembly procedure (T13)

1. Freeze source revision plus an explicit manifest of all owned/dirty integration files,
   schema/shared fixtures, policy, model/bundle/taxonomy, transformations, calibration,
   domain and release hashes. Never invent a bundle identity; mark absent material
   not present yet / blocked by its external gate. Record environment versions, actual
   hardware and command working directories without credentials or private image data.
2. Re-list test directories and reconcile every table row with its actual assertions.
   Run the plan's T01–T12 mandatory gates in their repositories against the frozen archive;
   record exact command, exit code, collected/executed/pass/fail/skip/deselected counts and
   reasons in the lead's execution log. Missing files and skipped required assertions are
   incomplete proof. `tests/test_qc_parity.py`'s explicit G6/G8 real-bundle skip is a missing
   external result, never target parity proof. Do not substitute synthetic OK stages.
3. T12's Node gate remains `node --test tests/qc-faults.test.mjs tests/qc-monitoring.test.mjs
   tests/qc-recalls.test.mjs tests/qc-retention.test.mjs tests/qc-blob-claims.test.mjs
   tests/qc-service-integration.test.mjs`, followed separately by `npm test`,
   `npm run typecheck`, `npm run build` once all named files exist. Tests currently absent
   above must be supplied by their owners. Native project/device commands and built
   Playwright/accessibility gates are recorded separately by T07/T08 owners; typechecking
   does not substitute for them. Do not install anything or execute network tools here.
4. Record known baseline dependency failures separately: `test_threads.py`, `test_marker.py`,
   `test_scanner_fault.py`, `test_fault_*.py`, `test_ocr_paddle_protocol.py` require missing
   torch/scipy/joblib in this environment. Do not edit those tests or claim unexecuted
   numerical/real-checkpoint assertions. Synthetic tests only establish their stated logic.
5. Attach external signed source/rights manifests, consent-safe physical/statistical/study
   reports, target benchmark and cost sheet, incident/rollback/restore/deletion-ledger and
   monitoring proof. Verify artifact SHA-256 against retained permitted bytes; if bytes
   were purged, retain the authorized tombstone and report replay unavailable. Apply
   deletion-ledger/withdrawal constraints to the archive and future restores too.
6. Attach negative and inconclusive results, recruitment/compute/access limitations and
   dated demonstration evidence only when actually collected. Independent reviewer checks
   requirement links, artifact hashes, gate signatures/expiry and final scope. Final report
   stays review-only/lab-only unless every required independent authority and matching
   release proof exists. `final-report.md` is outside this worker's ownership.

Companion templates: [operations and recovery](operations-runbook.md) and
[consented study](study-protocol.md). Neither is an executed drill or signed study.
