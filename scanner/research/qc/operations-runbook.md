# Incoming-fabric QC v2 operations protocol

State: implemented, external evidence missing. This is an operating template, not an
operations approval or a record of a drill. All real deployment measurements, identities,
signatures and reports are not yet collected / external gate G8; model/export/hardware
proof is not yet collected / external gate G6. No bundle, calibration profile, dataset,
release or signing identity is available here. Default mode is REVIEW_ONLY. Factory,
rights, physical and statistical authority remain external gates G1–G7.

## Authority and activation record

Fill before any field use: operator owner [unfilled], ML owner [unfilled], security owner
[unfilled], data steward [unfilled], application/recovery owner [unfilled], factory QC
signatory [unfilled], independent statistics signatory [unfilled], on-call contact and
escalation route [unfilled]. Role labels do not identify approved people. SOP signature
and lawful capture/retention consent are not yet collected / external gates G1/G4/G8.

Record workspace, release/domain/policy/bundle/calibration hashes, taxonomy, capture roles,
acquisition profiles, preprocessing/score transforms, target runtime/precision, expiry,
predecessor and G1–G8 evidence hashes. T11 supplies only a STATISTICAL_CANDIDATE. Activation
requires the matching operations_proof_sha256 and monitoring_protocol_sha256, independent
authority and all externally approved gates. A changed runtime/precision/preprocess/profile
invalidates its matching proof. Private readiness describes artifacts, not release authority.
No approved protocol, stale proof or missing evidence means no activation.

## Deployment cost and capacity sheet (unmeasured template)

Provider/region/currency/billing period/target specification: [unfilled]. Quota and
spend authority, spending cap, zero-spend settings and stop mechanism: not yet collected /
external gate G8. No deployment, purchase or free-service availability is assumed.

| Resource | Measured rate | Measured workload/quantity | Calculation to complete |
|---|---|---|---|
| CPU | not measured | not measured | CPU-seconds × approved rate |
| Memory | not measured | not measured | GB-seconds × approved rate |
| GPU, only if separately authorized | not measured | not measured | devices × measured hours × approved rate |
| Database requests/storage | not measured | not measured | requests/bytes × approved rates |
| Original/derivative/blob storage | not measured | not measured | mean original bytes × captures × retained copies; add derivatives |
| Backup and isolated restore space | not measured | not measured | retained snapshots plus working restore/reconciliation space |
| Egress | not measured | not measured | authorized transferred GB × approved rate |
| Monitoring/logs/audit/notification storage | not measured | not measured | measured events and retained bytes × approved rates |
| Total per sample / billing period | not measured | not measured | sum above including retries, failed requests and restore reserve |

Final-target benchmark report fields: exact source/environment/artifact hashes; declared
hardware/OS/runtime/precision; representative bounded originals, source dimensions and
roles; cold/warm sample counts; end-to-end p50/p95; decode/OCR/fabric/defect/quality/metrology
stage durations; CPU/wall time, peak RSS, disk, throughput; two-request contention, 429 and
timeout counts with denominators. Every measured field is currently **not measured**.
Run the planned `scripts/qc_benchmark.py` only once its owning worker supplies it; its presence
alone is not target proof. T06 local probe is separate from T12 final-target proof.

Warm p95 <=15s is the design's proposed objective, not a measured achievement. The current
synchronous server deadline is 60s including cold start. Failure must be recoverable with
no late commit. A client timeout after timely commit is UNKNOWN_OUTCOME: resolve through
the same idempotency key/request lookup, never infer that no decision exists. No queued
completion is promised by the current synchronous service. If budget fails, narrow the
validated capture/model domain or retain local REVIEW_ONLY; do not silently reduce source
resolution for metrology. Any later queue needs its own implementation and proof.

## Export parity and promotion evidence

FP32/PyTorch is the reference; ONNX/INT8 is optional. Record export/operator support,
runtime/precision, transforms and sample manifest hashes. Run identical full permitted
capture/retry/revision workflows on held-out and challenge sets, with predeclared cases
below, at and above score and density boundaries, including uncertainty limits. Evaluate
decisions only through `services/consistency/qc_policy.py`; the parity comparison never
derives ACCEPT/HOLD. Record maximum score and count/in density error, classification/label
agreement, region agreement preserving capture/transform ownership, status equality and
selective-risk bounds. Error tolerances and cohort support must be independently approved,
not copied from synthetic test constants. A single status change, especially adjacent to
a threshold, blocks promotion pending independent validation/recalibration and fresh proof.
Do not assume quantization is faster. The real-bundle test is skipped for G6/G8; synthetic
comparison tests cannot satisfy those gates or G7 risk evidence.

## Kill switch, suspension, recall and predecessor rollback

1. Authorized admin records an immutable incident, reason, affected workspace/domain,
   release/artifact hashes and cutoff. Immediately suspend the affected release through
   `POST /api/qc/v2/releases/:id/suspend` with the normal current session, same-origin and
   idempotency requirements. Containment does not wait for promotion proof. If there is
   no domain-specific control, suspend each release covering that domain; record any wider
   containment. Never invent a domain endpoint or rewrite the policy in a client.
2. Verify `/status` reports REVIEW_ONLY for affected requests and the Worker refuses
   automatic drafts without its own ACTIVE, unexpired, unsuspended release and AUTOMATIC
   policy. Missing/failed/disabled/expired/uncertain/OOD evidence cannot yield ACCEPT or
   HOLD. Test a held in-flight request across suspension: guarded finalization must commit
   no stale decision/event/idempotent success. If the control cannot be verified, isolate
   the v2 service and use manual QC; do not bypass authorization or affect v1.
3. Select recalls exhaustively by tenant, domain, release/artifact and cutoff, including
   historical pages beyond the latest notification window. Append recall/incident validity
   records; original status, evidence, PO binding and evaluation time remain immutable.
   Verify unrelated tenants/domains are unaffected. Notification outbox keys
   `(incident, recipient)` must be idempotent with retry, delivery and acknowledgment state.
   Record recipients for a later authorized drill; this protocol sends no messages.
4. Record predecessor release identity and verify retained bundle, schema/client compatibility,
   hashes, expiry, domain, credentials and all current approvals before selecting it for
   new evaluations. A suspended/expired/missing predecessor cannot be activated. First
   roll application/service back in REVIEW_ONLY with additive tables retained; never run
   a destructive schema downgrade. Actual promotion uses the approved fresh-credential
   procedure and independent evidence. Otherwise remain REVIEW_ONLY.
5. Reload old decisions byte-for-byte and confirm their bindings/history are unchanged.
   New evaluations name the actual selected release/policy. Reprocessing requires an
   explicitly authorized versioned evaluation/job; a changed PO uses a linked new sample,
   retains family attempts, and requires new capture. No old decision is overwritten.

## Incident playbooks (rehearsals not yet collected / external gate G8)

All incidents record detection time/source, actor/role, scope, containment/verification,
evidence references, recovery criteria, residual uncertainty, acknowledgment and independent
closure. Preserve minimal access-controlled audit evidence under signed retention rules;
never copy originals, cookies, PINs or service keys into incident logs.

| Incident | Owner placeholders | Containment | Restoration proof required |
|---|---|---|---|
| Auth breach / service credential mismatch | security [unfilled]; application [unfilled] | Suspend affected releases; revoke compromised sessions/keys, isolate private v2 boundary; preserve sanitized auth audit | Fresh credentials/session epoch; rejected old actor/session/kid/signature/replay; no inference-time revoked-session commit; approved G8 rotation record |
| Cross-tenant lookup | security [unfilled]; data steward [unfilled] | Isolate affected route, suspend exposed scope; investigate all related identifiers using restricted audit | Two-tenant lookup/upload/recall tests and composite FK/finalization checks; foreign objects 404; verified access review |
| Image leak | data steward [unfilled]; security [unfilled] | Restrict affected bytes/exports; invalidate private caches/URLs and access as authorized; apply consent/retention response | No-store and public-shell-only cache proof; permission and tenant checks; derivative/export inventory; ledger-reconciled restore; G4 notification/withdrawal decision |
| Broken marker/profile | metrology [unfilled]; ML [unfilled]; QC [unfilled] | Suspend every affected profile/domain release, retain images only if authorized, route to manual reference | G3 physical reference, source-resolution/lens/axis/distortion/repeatability and uncertainty revalidation; new version/hash and dependent release proof |
| Model drift | ML [unfilled]; independent QC/statistics [unfilled] | Suspend affected domain; append recalls as justified; preserve blinded random audit selection and probabilities; do not raise thresholds | Approved monitoring analysis, frozen candidate and independent G7 confirmation; any recalibration uses new version and serving parity proof |
| Storage exhaustion / DB, blob or audit failure | application/recovery [unfilled]; data steward [unfilled] | Stop admitting v2 captures/analysis if persistence cannot be guaranteed; return recoverable errors; never delete live references by GC convenience | Bounded capacity, matching original readback, atomic DB/audit failure and fenced GC retry proof, consistent restore; no late/partial decisions or ERP changes |

## Backup/restore drill and later-write reconciliation

Drill operator [unfilled], independent verifier [unfilled], authorized retention/hold policy
hash [unfilled], recovery point/time objectives [unfilled]. Recovery times and lost-write
counts: not measured. Drill evidence: not yet collected / external gates G4/G8.

1. Select an isolated target with access disabled. Record snapshot ID, consistent DB point,
   blob manifest/hash set and WAL/checkpoint handling. Exercise both actual D1-contained
   blob storage and local SQLite WAL/files, rather than an assumed object bucket.
2. Keep a separately protected monotonic deletion/consent-withdrawal ledger and cursor
   newer than the snapshot, with integrity and access proof. Create authorized post-snapshot
   writes, withdrawal/purge events and holds in the isolated rehearsal; record their
   sequence. Do not perform destructive production drills from this document.
3. Restore matching DB and bytes into isolation. Reconcile all writes after the snapshot
   using recorded sequence/IDs, revision/idempotency state and blob hashes. Resolve conflicts
   explicitly; never overwrite later writes with an older snapshot. Fence stale in-flight
   request generations; do not replay expired executions into new success.
4. Replay the protected deletion/withdrawal ledger through its current cursor before any
   read, serving, training or export access. Apply purpose restrictions and authorized holds;
   a hold grants no new research rights. Purged originals/derivatives/features stay
   unavailable, with permitted hashes/tombstones interpretable. Verify an old snapshot
   cannot resurrect deleted content. Enforce backup expiry and ledger recovery policy.
5. Check tenant FKs, blob claims/reference acquisition versus GC barriers, failed-delete
   retry/crash points, audit append-only triggers, old readers, immutable histories and
   request replay. Verify v2 writes zero legacy ScanStore rows and causes zero stock,
   receipt, claims, financial or dispatch side effects. Compare restored counts/hashes,
   missing writes, access-denied checks and actual recovery duration to approved objectives.
6. Independent verifier records discrepancies and repeat-drill evidence. Reopen only after
   reconciled-state, deletion-ledger and authorization checks; keep automation REVIEW_ONLY
   until all separate release approvals remain valid. A tabletop is not a restore result.

## MonitoringProtocol template

Protocol version/hash, approving authority, effective/expiry dates, release/domain bindings,
owner and scheduler deployment: [unfilled]; not yet collected / external gates G2/G7/G8.
All cadence, window, minimum support, audit probabilities, trigger criteria, freshness
budgets and maximum detection delays below are **to be approved**, not numeric defaults.

| Signal/counter | Required denominator and strata | Audit/protocol fields |
|---|---|---|
| Required stage state, artifact/stub mismatch | all requested stages by stage/domain/release/profile | state counts, manifest hashes, missing duration/artifact telemetry |
| Persistence/blob/audit failures, admission429 and deadlines | all requests and admitted requests separately; request generation and timely commits | request/timeout/late-attempt counts; no image or secret payloads |
| Recapture and attempts | all enrolled independent selections and submitted capture sets separately | complete workflow attempts; missing/excluded/unfinished reasons; no tile inflation |
| Unknown/OOD and quality/metrology abstention | all submitted selections by supported construction/profile/domain | stage reasons, source resolution and profile coverage/missingness |
| ACCEPT and HOLD coverage | all enrolled independent units including incomplete workflows | any-ACCEPT and final-state outcomes separately; HOLD utility/error criterion required |
| Delayed blinded QC errors | audited accepted independent units and all audit-selected units including missing labels | recorded random selection probability, seed/plan, sampling frame, propensity/weighting and label delay |
| Recall and notification delivery | all affected decisions, intended recipients and outbox entries | paginated completeness, retry/ack state, domain/tenant isolation |

For each row fill counter definition, denominator definition, grouping unit, stratification,
random audit probability (including accepted cases, not just uncertain ones), cadence,
window, minimum support, approved trigger/action, max label delay, max detection delay,
telemetry freshness and sparse-data behavior. Zero support is unavailable, not zero error.
No numeric drift threshold is specified here. Pending, sparse, stale or missing telemetry
cannot support continued automatic authority: record the incident and suspend the affected
domain to REVIEW_ONLY under the approved protocol; missing approved protocol blocks
activation entirely. Do not impute clean audits or silently broaden pooling.

Verify normal/shifted/sparse/missing-audit streams, scheduler restart/replay idempotency,
exact affected-domain suspension and unrelated-domain retention. Separate immediate
finalization suspension checks from scheduler detection latency. Dashboards expose aggregate
tenant-safe metadata only. Consented active-learning material remains outside sealed
confirmation data and requires fresh G4 rights and independent G7 release evidence.
