# Incoming fabric QC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a stationary, sample-scoped, PO-version-bound fabric QC workflow with central fabric classification, defect evidence and validated construction measurement, defaulting to review-only.

**Architecture:** Yarnflow Worker owns tenant identity, immutable PO/sample/audit persistence and finalization; scanner owns typed learned/physical evidence and pure deterministic policy. Web and Swift clients display server decisions; existing arrival acceptance and v1 scanner semantics remain separate.

**Tech Stack:** Existing FastAPI/Pydantic/PyTorch/OpenCV/NumPy, Cloudflare Worker/D1 and local SQLite adapters, React/TypeScript, SwiftUI/URLSession; no dependency additions assumed.

**Spec:** [Design](../specs/2026-11-12-incoming-fabric-qc-design.md). Repository paths below are root-relative; Create means proposed, Modify means observed existing. This is a plan, not implemented behavior or permission to run training/deployment.

## Global Constraints

- Automatic ACCEPT and HOLD only inside independently released validated domains; default REVIEW_ONLY.
- No RGB fibre composition/GSM inference, whole-roll acceptance, ERP expansion, financial/dispatch side effects, or continuous tracking default.
- Fabric classifier remains central; ongoing fault jobs remain untouched.
- Preserve existing dirty changes, v1 clients, inventory quantities and all existing audit data.
- External G1–G8 gates in the design require named evidence and authority; no invented approval.
- Documentation authoring does not install, purchase, deploy, commit or start GPU jobs.

## Review Focus

1. Concurrent PO/release change during inference: finalization returns 409 and commits no stale decision (T05).
2. Missing, disabled or failing stage with an earlier clean result: review/error, never reused ACCEPT (T03/T06).
3. High-frequency printed pattern or camera lens switch: invalid metrology and explicit recapture/review (T04).
4. Offline tenant switch and late network completion: purge drafts and ignore foreign/stale evidence (T07/T08).
5. Correlated tiles or duplicate datasets: cannot inflate independent release sample count (T09/T11).

## Ownership and transition map

Existing readers/writers are traced in design §2. v1 scan/spec write diagnostic scanner SQLite; v2 writes only authoritative tenant QC tables via Worker, with scanner returning evidence/drafts and Worker binding final IDs/revisions. Existing quality.mjs/receiving.mjs stock/claim writers are never called by this workflow. Existing web Scanner/SpecScan and native legacy workflow remain supported throughout backend-first expand/deploy/client transition; automation stays disabled until both required clients and gates pass. Additive migrations preserve old readers; rollback turns automation off and reverts application with additive tables retained, never restores over later writes without reconciliation. No contraction is authorized.

## Contract ownership

Design §§3 and14–21 are authoritative for named types/statuses/reasons; canonical JSON Schema will live at `scanner/contracts/qc-v2.schema.json` (Create). Pydantic models in `scanner/services/api/qc_schemas.py`, TypeScript in `yarnflow/src/qc-types.ts`, Swift in `yarnflow/ios/Yarnflow/QCTypes.swift` are checked against identical fixtures, not separate policy implementations. Policy `evaluate_qc(evidence: Evidence, spec: PurchaseSpec, policy: Policy, release: Release | None, attempt: int, context: EvaluationContext) -> DecisionDraft` returns draft only; persistence adds UUID/time/revision. Policy includes mode REVIEW_ONLY|AUTOMATIC, version and required stages; Release binds immutable artifact/taxonomy/preprocessing/calibration/domain/spec compatibility, expiry, risk evidence and authority signatures. DecisionDraft contains status, reasons, automatic and scope only; clients cannot submit it as authoritative.

## Endpoint map (proposed)

Worker `/api/qc/v2`: POST `/specs` confirms PurchaseSpec candidate (purchase_manager); GET `/specs/:id?version=N`; POST `/samples` creates Sample (quality_inspector); POST `/capture-sets/:setId/captures` uploads bounded original (attempt allocated only on atomic set close); POST `/samples/:id/capture-sets`, POST `/capture-sets/:setId/close` and GET `/requests/:request_id` follow design§17–18; POST `/samples/:id/analyze` with expected_revision and a closed capture_set_id returns persisted Decision+Evidence; GET `/samples/:id` returns current revision/history; POST `/samples/:id/adjudications` accepts `{expected_revision, outcome:'CONFORMING'|'NONCONFORMING'|'UNDETERMINED', reason, reference_ids}` (supervisor); POST `/releases` and `/releases/:id/suspend` (admin plus independent signatory evidence). All mutations require Idempotency-Key and current session/CSRF authorization. No client workspace/automatic/release choice. Scanner private POST `/api/v2/qc/analyze` consumes validated captures/spec/domain/policy/release/attempt assertion, invokes T03 and returns Evidence+DecisionDraft+signed-input binding; private GET `/api/v2/qc/readiness` reports every required artifact/stage. HTTP statuses/error envelope follow design §3; analyze 60s deadline, no durable decision after server deadline or audit failure; client timeout after timely commit resolves via idempotency/reload. Async job queue is a later measured latency fallback, not required infrastructure for demo.

## Milestones and dependency DAG

T01→T02→T03; T01→T04; T02+T03+T04a→T05→T06→T07; T05+T06→T08. T09 starts after T01, T10 after T09 and completed existing jobs, T11 after T04b+T09+T10, T12 after T05–T08+T11, T13 after T12. Nov29 demo critical path T01–T03+T04a→T05→T06→T07 review-only lab slice; T04b demonstrates reference comparison without authorizing density automation. T08 and production hardening finish Dec; T09 Nov–Jan; T10 Feb; T11 Mar; T12 Apr; T13 May2027. Missing factory/compute/statistical gates narrows final output to a truthful lab/review-only system.

### T01: Freeze contracts, taxonomy and source authority

**Window:** 12–16 Nov. **Files:** Create scanner/contracts/qc-v2.schema.json; scanner/tests/fixtures/qc-v2/{valid,invalid}.json; scanner/services/api/qc_schemas.py; yarnflow/src/qc-types.ts; yarnflow/ios/Yarnflow/QCTypes.swift.

**Interfaces:** Consumes design §3; produces canonical types and fixtures for every downstream task. Produces `parse_qc_spec(payload: dict) -> PurchaseSpec; normalize_density(value: float, unit: str) -> float`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_contracts.py` cases with these exact assertions: Exact 2.54 conversion; reject NaN, reversed intervals, unknown enums/fields, unsupported units, empty required axes and contradictory provenance; same valid/invalid fixtures decoded identically by all three clients. Document taxonomy overlap aliases and UNKNOWN rather than conflating weave and fibre.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_contracts.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `parse_qc_spec(payload: dict) -> PurchaseSpec; normalize_density(value: float, unit: str) -> float` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T02: Add tenant immutable storage with safe migration

**Window:** 14–18 Nov. **Files:** Create yarnflow/server/qc-store.mjs; yarnflow/drizzle/0033_incoming_fabric_qc.sql (reserve number after rechecking current maximum); yarnflow/tests/qc-store.test.mjs; yarnflow/tests/qc-migration.test.mjs.

**Interfaces:** Consumes T01; produces qc_* tables, idempotency and atomic finalization for T05. Produces `createSampleEvaluation(db, authContext, input, now) -> Promise<QCResult>; finalizeQC(db, authContext, result, expectedRevision, now) -> Promise<Decision>`.

- [ ] **Step 1 — Pin failing proof:** Add `yarnflow/tests/qc-store.test.mjs` cases with these exact assertions: Composite tenant FKs reject cross-workspace references; concurrent finalization commits one revision; audit insertion failure rolls back decision; replay same key/body returns same ID, changed body 409; populated old DB and old readers survive interrupted migration/replay and app rollback. Snapshot restore must include matching blobs and reconcile later writes.
- [ ] **Step 2 — Confirm red:** Run `node --test tests/qc-store.test.mjs tests/qc-migration.test.mjs` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `createSampleEvaluation(db, authContext, input, now) -> Promise<QCResult>; finalizeQC(db, authContext, result, expectedRevision, now) -> Promise<Decision>` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T03: Implement fail-closed pure policy

**Window:** 16–19 Nov. **Files:** Create scanner/services/consistency/qc_policy.py; scanner/tests/test_qc_policy.py.

**Interfaces:** Consumes T01; produces policy callable for T06 with no model or DB imports. Produces `evaluate_qc(evidence: Evidence, spec: PurchaseSpec, policy: Policy, release: Release | None, attempt: int, context: EvaluationContext) -> DecisionDraft`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_policy.py` cases with these exact assertions: Table-test every ordered rule in design §4: disabled/missing stage cannot ACCEPT/HOLD; REVIEW_ONLY always review; valid released all-inside intervals ACCEPT, confirmed outside HOLD, crossing review; equality boundaries inclusive; gray defect thresholds review; quality-only failures attempts 1/2 recapture and 3 review; mixed authority/quality failure review; unknown/OOD and expired release review.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_policy.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `evaluate_qc(evidence: Evidence, spec: PurchaseSpec, policy: Policy, release: Release | None, attempt: int, context: EvaluationContext) -> DecisionDraft` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T04: Validate capture and physical metrology

**Window:** T04a interface/abstaining adapter by17Nov; T04b physical baseline through28Nov and Jan validation. **Files:** Create scanner/services/vision/qc_metrology.py; scanner/services/vision/qc_quality.py; scanner/tests/test_qc_metrology.py; scanner/tests/test_qc_quality.py; scanner/research/qc/metrology-protocol.md; Modify scanner/services/vision/{marker,threads,quality}.py only where reusable primitives need correction.

**Interfaces:** Consumes T01; produces versioned quality/metrology evidence and physical report; G3 needed for automation. Produces `measure_construction(image, profile: CalibrationProfile, reference: ScaleReference) -> Stage[list[Measurement]]; assess_qc_quality(image, profile) -> Stage[QualityValue]`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_metrology.py` cases with these exact assertions: Synthetic known scale/orientation checks plus blinded physical registered pick-glass trials; marker print error, lens change, homography residual, missing marker, blur/glare/moire/folds/printed grids and harmonics must abstain. Measure interval coverage and repeatability on held-out rolls; no EXIF or typed dpi authority. Preserve originals and forbid arrival shrink.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_metrology.py tests/test_qc_quality.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `measure_construction(image, profile: CalibrationProfile, reference: ScaleReference) -> Stage[list[Measurement]]; assess_qc_quality(image, profile) -> Stage[QualityValue]` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T05: Authenticate and route sample API

**Window:** 18–21 Nov. **Files:** Create yarnflow/server/qc.mjs; yarnflow/server/qc-service-auth.mjs; yarnflow/tests/qc-api.test.mjs; Modify yarnflow/server/{inventory,scanner-proxy}.mjs; test actual cloudflare.mjs fetch and local dev-server routing; worker.mjs only if embedded entrypoint requires change.

**Interfaces:** Consumes T01/T02/T03/T04a; produces endpoint map above; inference outside transaction, final checks inside. Produces `handleQC(request, env, authContext) -> Promise<Response | null>; issueQCAssertion(authContext, payloadHash, requestId, now) -> Promise<string>`.

- [ ] **Step 1 — Pin failing proof:** Add `yarnflow/tests/qc-api.test.mjs` cases with these exact assertions: 401/403/404 tenant rules for every endpoint; body limits before decoding; fixed upstream and redirect rejection; no forged workspace/automatic fields; current portal_role mapping; expired/tampered audience/body assertions; stale PO/release during inference 409 with zero decision writes; duplicate uploads do not consume attempts twice. Assert unchanged stock/claims/receipts before/after every decision.
- [ ] **Step 2 — Confirm red:** Run `node --test tests/qc-api.test.mjs` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `handleQC(request, env, authContext) -> Promise<Response | null>; issueQCAssertion(authContext, payloadHash, requestId, now) -> Promise<string>` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T06: Wire private evidence service and readiness

**Window:** 22–23 Nov. **Files:** Create scanner/services/api/qc.py; scanner/services/api/qc_pipeline.py; scanner/tests/test_qc_api.py; scanner/tests/test_qc_pipeline.py; Modify scanner/services/api/{main,config}.py; scanner/services/vision/{predictor,scanner,fault}.py for detector-independent concrete factory and selected fault loader/export adapter.

**Interfaces:** Consumes T01/T03/T04a/T05; produces private evidence endpoint and truthful readiness; does not change legacy v1 semantics. Produces `run_qc_analysis(captures: list[ValidatedCapture], spec: PurchaseSpec, domain: DomainManifest, predictor: Predictor, policy: Policy, release: Release | None, attempt: int, context: EvaluationContext) -> AnalysisCandidate; qc_readiness() -> Readiness`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_pipeline.py` cases with these exact assertions: Real classifier flat-swatch adapter bypasses garment requirement; stages independent with explicit unavailable values; fault exception/disabled artifact produces no automation; no v1 PASS coercion; bounded decode/deadline; assertions required; readiness pins all hashes; persistence/service timeout never reuses prior result.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_api.py tests/test_qc_pipeline.py tests/test_api.py tests/test_spec_api.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `run_qc_analysis(captures: list[ValidatedCapture], spec: PurchaseSpec, domain: DomainManifest, predictor: Predictor, policy: Policy, release: Release | None, attempt: int, context: EvaluationContext) -> AnalysisCandidate; qc_readiness() -> Readiness` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T07: Build guided accessible web sample workflow

**Window:** 24–26 Nov integration;27–28Nov rehearsal. **Files:** Create yarnflow/src/{IncomingFabricQC.tsx,qc-client.ts,qc-drafts.ts,qc-reasons.ts}; yarnflow/tests/qc-client.test.ts; yarnflow/e2e/incoming-qc.spec.ts; Modify yarnflow/src/LiveApp.tsx, main.tsx, public/sw.js, scripts/prepare-offline.mjs, playwright.config.ts and actual navigation/roles owners.

**Interfaces:** Consumes T05/T06; produces Nov29 review-only thin slice. Use existing navigation ownership after tracing, not invented route library. Produces `analyzeSample(sampleId: string, captureSetId: string, expectedRevision: number, key: string, signal: AbortSignal) -> Promise<QCResult>; clearQCDrafts(workspaceId: string) -> Promise<void>`.

- [ ] **Step 1 — Pin failing proof:** Add `yarnflow/tests/qc-client.test.ts` cases with these exact assertions: Choose PO frozen version/roll/location; display actual classifier/unknown, defect list, density interval, sample scope and reason. Late result after edit ignored; no cached green status; original hashes survive upload; offline drafts never decisions; retry 1/2/4 sec only retryable errors; workspace/logout purges; Urdu RTL/units, keyboard/axe/status text and third recapture escalation. No existing arrival acceptance API called.
- [ ] **Step 2 — Confirm red:** Run `npm run typecheck && node --experimental-strip-types --test tests/qc-client.test.ts && npm run build && CI=1 npx playwright test e2e/incoming-qc.spec.ts` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `analyzeSample(sampleId: string, captureSetId: string, expectedRevision: number, key: string, signal: AbortSignal) -> Promise<QCResult>; clearQCDrafts(workspaceId: string) -> Promise<void>` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T08: Implement separate native capture integration

**Window:** Dec. **Files:** Create yarnflow/ios/Yarnflow/{QCClient,QCCapture,QCWorkflow}.swift; yarnflow/ios/YarnflowTests/QCContractTests.swift; Modify yarnflow/ios/Yarnflow/{Models,Workflows}.swift.

**Interfaces:** Consumes T01/T05/T06; produces iOS v2; if test target/scheme absent add one explicitly, do not claim native CI from web checks. Produces `QCClient.analyze(sampleID: UUID, captureSetID: UUID, expectedRevision: Int, idempotencyKey: UUID) async throws -> QCResult`.

- [ ] **Step 1 — Pin failing proof:** Add `yarnflow/ios/YarnflowTests/QCContractTests.swift` cases with these exact assertions: Codable fixture parity, authenticated Worker path, camera/Photos denial, original preservation, protected draft expiry and Keychain credentials; account switch purge and stale-result rejection; VoiceOver/Urdu on real phone. Existing direct model URL is legacy only; no production arbitrary upstream.
- [ ] **Step 2 — Confirm red:** Run `xcodebuild -list -project ios/Yarnflow.xcodeproj; then xcodebuild test with the listed shared scheme and installed simulator destination recorded in evidence` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `QCClient.analyze(sampleID: UUID, captureSetID: UUID, expectedRevision: Int, idempotencyKey: UUID) async throws -> QCResult` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T09: Seal grouped dataset and rights manifests

**Window:** Nov–Jan. **Files:** Create scanner/training/qc/{manifest,split_audit}.py; scanner/tests/test_qc_split_audit.py; scanner/research/qc/{data-register,sampling-sop}.md.

**Interfaces:** Consumes T01; produces sealed train/val/calibration/release manifests and documented independent grouping for T10/T11. Produces `audit_splits(manifest: DatasetManifest) -> AuditReport`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_split_audit.py` cases with these exact assertions: Parent/roll/lot/duplicate connected components never span splits; ADNet/MVTec/WFDD/AITEX cross-source overlap flagged; unknown licenses block promotion; defective empty AITEX masks remain unresolved/excluded release not relabeled normal. Blinded reference disagreement retained. Capture consent, research purpose, retention/deletion and backup expiry are explicit G4 gates.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_split_audit.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `audit_splits(manifest: DatasetManifest) -> AuditReport` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T10: Reproduce central classifier and bounded defect evidence

**Window:** Feb, only after current jobs. **Files:** Create scanner/training/qc/{train_manifest,evaluate}.py; scanner/tests/test_qc_training.py; scanner/research/qc/experiment-register.md; Extend existing training/textilenet and fault adapters instead of new model zoo.

**Interfaces:** Consumes T09; produces reproducible bundle/reference evaluation, no promise training success or budget. Produces `evaluate_bundle(bundle: Bundle, manifest: DatasetManifest) -> EvaluationReport`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_training.py` cases with these exact assertions: Record commit+dirty hash, pinned upstream/dataset/weights/env, seeds and exact commands/hardware. Fabric known-label macro-F1/per-class/unknown plus per-domain coverage; fault image/pixel evidence with valid-mask denominators. Two-process gradient equivalence and real NCCL utilization are separate proof; no speedup from local tests. Inventory completed ongoing runs read-only; new GPU runs require quota/authorization and measured cap.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_training.py tests/test_textilenet_splits.py tests/test_fault_data.py tests/test_fault_dinomaly_ddp.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `evaluate_bundle(bundle: Bundle, manifest: DatasetManifest) -> EvaluationReport` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T11: Calibrate and independently gate release

**Window:** Mar. **Files:** Create scanner/training/qc/{calibrate,release_gate}.py; scanner/tests/test_qc_release_gate.py; scanner/research/qc/release-protocol.md.

**Interfaces:** Consumes T04b/T09/T10; produces signed statistical candidate (unactivatable until T12 target proof/G8) or explicit failed gate with REVIEW_ONLY fallback. Produces `false_accept_upper(failures: int, accepted_independent_units: int, alpha: float) -> float; evaluate_release(report: ReleaseReport, authority: Authority) -> GateResult`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_release_gate.py` cases with these exact assertions: Zero/zero gives no release; 0/298 upper >.01 and 0/299 <=.01 at alpha=.05; all failures upper1; alpha family allocation and fixed stopping; duplicate correlated tiles cannot raise n; calibration/release disjoint; sparse domains review-only. Report both false-accept estimands, HOLD precision, all-submission/selective coverage, grouped uncertainty and F1. Independent QC signatory and authority risk target required, not inferred from illustrative 1%.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_release_gate.py -q` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `false_accept_upper(failures: int, accepted_independent_units: int, alpha: float) -> float; evaluate_release(report: ReleaseReport, authority: Authority) -> GateResult` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T12: Prove serving, security, rollback and recovery

**Window:** Apr. **Files:** Create scanner/scripts/qc_benchmark.py; scanner/tests/test_qc_parity.py; yarnflow/tests/qc-faults.test.mjs; scanner/research/qc/operations-runbook.md; Modify scanner/deployment/modal_scanner.py; .github/workflows/ci.yml.

**Interfaces:** Consumes T05–T08/T11; produces tested deployment cost sheet and incident SOP; no deployment or purchase during planning. Produces `benchmark_bundle(bundle: Bundle, captures: list[Capture], target: TargetProfile) -> BenchmarkReport`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/tests/test_qc_parity.py` cases with these exact assertions: Cold/warm p50/p95, RSS/capacity/429/deadlines actual CPU; ONNX/INT8 optional measured score/density/region and decision parity near thresholds. Inject DB/blob/audit failure, service credential mismatch, corrupt/oversize images, release revoke, clock expiry, replay and tenant leaks. Backup restore to isolated target plus later-write reconciliation; rollback predecessor and domain kill switch keep old records immutable. Add web CI explicitly; native macOS runner gate only after scheme proof.
- [ ] **Step 2 — Confirm red:** Run `pytest tests/test_qc_parity.py -q; node --test tests/qc-faults.test.mjs (from yarnflow); npm test; npm run typecheck; npm run build` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `benchmark_bundle(bundle: Bundle, captures: list[Capture], target: TargetProfile) -> BenchmarkReport` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

### T13: Conduct SOP study and archive final evidence

**Window:** May2027. **Files:** Create scanner/research/qc/{study-protocol,requirements-proof,final-report}.md.

**Interfaces:** Consumes T12 and G1–G8; produces dissertation and reproducible final review-only or narrow-domain system. Produces `assemble_evidence(requirements: list[Requirement], artifacts: list[Artifact]) -> EvidenceIndex (documentation procedure, no runtime service)`.

- [ ] **Step 1 — Pin failing proof:** Add `scanner/research/qc/requirements-proof.md` cases with these exact assertions: Consented counterbalanced manual/assisted tasks, nondeveloper operators, pick-glass groundtruth, Urdu/a11y and scope-comprehension/overtrust; report recruitment limits/time/error/confidence intervals. Archive model/data rights manifests, negative results, source/env commands and unresolved external gates; final automation scope matches actual release proof.
- [ ] **Step 2 — Confirm red:** Run `Run recorded T01–T12 verification commands in their stated repositories; verify artifact checksums and requirement links` from scanner for Python, yarnflow for Node/web (root for cross-project commands); missing proposed modules/tests must fail, existing baseline failures recorded separately without overwriting shared work.
- [ ] **Step 3 — Implement owning boundary:** Implement `assemble_evidence(requirements: list[Requirement], artifacts: list[Artifact]) -> EvidenceIndex (documentation procedure, no runtime service)` in the stated owning file; follow design contracts and existing adapters. No automatic acceptance until all external gates pass.
- [ ] **Step 4 — Confirm green:** Repeat Step 2 AND the Mandatory per-task gate below; require all named assertions and baseline compatibility checks pass; attach command, environment and result to evidence index. Physical/statistical/manual checks require signed reports, never substitute synthetic tests.
- [ ] **Step 5 — Review checkpoint:** Review only this task's diff and evidence; future executor may commit only owned implementation files after authorization, never sweep preexisting dirty files into a commit. Planning session creates no commits.

## Requirements → tasks → proof matrix

| Requirement | Tasks | Required proof |
|---|---|---|
| Scope/novelty/sample-only/no side effects | T01,T05,T07,T10,T11,T13 | side-effect snapshot invariant (T05), four-arm ablations (T10/T11) and scope-comprehension study (T13) |
| Exact statuses/types/reasons/provenance/PO units | T01,T03,T05 | cross-language fixtures, ordered policy table and stale-version tests |
| Central fabric taxonomy/F1/unknown | T01,T06,T10,T11 | flat-swatch integration, per-label/per-domain report and unknown challenge |
| Defects/ADNet/AITEX integrity | T06,T09,T10 | unavailable-stage tests, source overlap audit, mask denominator report |
| Geometry/FFT/quality/metrology | T04,T11 | physical pick-glass uncertainty/coverage and pattern challenge report |
| Sampling/groundtruth/selective risk | T09,T11 | independently grouped cohort, exact one-sided bound and authority signature |
| Licenses/consent/retention/privacy | T09,T12 | clearance register, deletion and backup-expiry drill |
| Reproducibility/DDP/resources | T10,T12 | pinned bundle, gradient equivalence, hardware proof, measured budget |
| Auth/tenancy/errors/concurrency/audit | T02,T05,T06,T12 | API matrix, crash/replay/finalization and threat tests |
| Migration/backups/mixed versions | T02,T12 | populated replay/old reader tests, isolated consistent restore drill |
| Web/native/offline/stale/cache/Urdu/a11y | T07,T08 | Playwright/axe, Codable/native real-phone/VoiceOver evidence |
| CPU/export/quantization/deployment | T12 | measured target benchmark and threshold-adjacent decision parity |
| Monitoring/drift/rollback/active learning | T09,T11,T12 | suspend/revoke drill, immutable recalls, random audited sampling probabilities |
| Demo/final/study/traceability | T07,T13 | dated review-only demo and requirements evidence archive |

## Writing-plans self-review

Draft self-review performed: design §§1–13 mapped above; shared types central in §3/schema; every task names files/signatures/proof and red/green/checkpoint steps; five Review Focus classes each assigned. Physical authority, rights, independent sampling, pending AITEX policy, hardware/quota and factory access remain explicit G1–G8 gates with safe fallbacks. Reviewer findings and final self-review updates are recorded in the linked ledger; documentation validation is not product-test execution.

## Integrated acceptance details from reviews 01–04

- T01/T02: implement design §14 QCResult/revision/selection contracts in identical fixtures; two concurrent analyzes commit once; create/upload/reload return actual revision; same upload retry increments neither revision nor attempt. Missing/excluded selections survive disabled fault and reproduce all-submission denominators.
- T01/T06: effective v8 class order equals head_a fabric24; fabric22 scope switch invalidates release; canvas or distinct jersey PO cannot auto-decide. Completed low-confidence/OOD retains diagnostic candidates with unknown=true, null authoritative label; missing/failed head differs. Removed-bias calibration fixture cannot expose calibrated_probability.
- T05/T06: actual Worker→FastAPI integration invokes Python policy and persists its bound draft; revoke release mid-request gives409/no writes. Authenticated multipart dispatch occurs before inventory's generic JSON parse; published cloudflare fetch and local dev-server tests preserve bytes, refuse anonymous/origin failures before decode and retain v1 semantics.
- T06/T10: detector construction/invocation raising must not prevent real v2 fabric head execution. Implement actual selected-format fault.py loader (currently NotImplementedError), config/architecture/preprocessing/hash compatibility; real checkpoint produces finite map and evaluation/serving scores and boxes agree. Missing artifact stays unavailable, never mock readiness.
- T01/T06/T07: two identical-coordinate boxes on different captures preserve ownership through all clients; missing required view prevents clean automation; overlapping views never inflate area.
- T09/T10: serialize mask eligibility categories absent/empty-defective/valid-clean/valid-defective/corrupt/adjudicated-derived, raw/derived hashes and explicit image/pixel exclusion counts; corrupt/wrong-shape/orientation never silently resized into valid truth. Approved unions retain every source hash; pending defective-empty remains image-level defective/pixel-ineligible.
- T10: Create scanner/training/qc/ablations.py, scanner/tests/test_qc_ablations.py. `evaluate_arms(manifest: ArmManifest, cohort: DatasetManifest) -> ArmComparison` returns exactly four named arms sharing cohort/full-reference labels, calibration-only thresholds and paired grouped coverage bounds. Missing arm/release-cohort fit fails. Classifier-blind defect fixture shows reduced risk/coverage, while production disabled-stage policy remains fail-closed. T11 owns independent confirmation; no winning-arm test-set selection.
- T10: fixed label universe/support table; unconditional argmax F1 plus deployed F1 counting known-label abstentions as misses, separately named conditional F1/coverage and unknown precision/recall. Absent class means insufficient support, not full-universe target attainment. Fabric22 and fabric24/27 scores cannot be silently substituted. Transductive models identify cohort/hash/chunking and cannot release without stationary-compatible protocol.

## Integrated acceptance details from reviews 05/06/08

- T01/T03: define EvaluationContext, CalibrationProfile, ScaleReference, AxisRegistration and ResearchReference schemas from design §15; fixtures preserve immutable hashes/ROI/transforms/uncertainty lineage. Metrology empty, missing picks, duplicate ends, wrong construction axis or point outside interval rejects/reviews. Explicit missing/failed domain Stage blocks automatic statuses.
- T03/T05: inject UTC clock; identical hashes before expiry versus exactly at expiry differ safely. Advance clock across release/calibration expiry during inference:409, no automatic decision/event write; suspension similarly rechecked at commit.
- T04: registered asymmetric swatch rotated 0/90/180 degrees retains physical ends/picks; absent selvedge/registration reviews regardless of PO fit. Changing capture/ROI/calibration/transform invalidates evidence; unrelated scale image cannot authorize another ROI. Retain geometry from QC adapter rather than legacy marker scalar-only result.
- T04: perspective far-side fabric fails source-direction resolution despite sharp marker; digital upsampling cannot fix it. Inject off-marker distortion leaving fitted corners intact and detect using independent field reference. Printed half/double harmonics with agreeing FFT/bandpass still abstain without yarn identity; never fall back to FFT after independent contradiction.
- T01/T02/T09: immutable selection includes probability, cohort designation and plan hash, area missingness and factory binding; unknown plan/roll/face inconsistent references fail; challenge selection cannot enter confirmatory cohort; repeat photos remain one submitted unit.
- T09: Create scanner/contracts/qc-research-reference.schema.json and scanner/tests/test_qc_references.py; `validate_reference(record: ResearchReference, selection: SamplingSelection) -> ReferenceEligibility` requires distinct observers, blinded timestamps, qualification and raw counts/lengths/units; wrong sample/spec/location, same observer twice, missing raw counts, unblinded label or unresolved disagreement fails release eligibility. T11 consumes eligibility and preserves undetermined/excluded denominators.

## Integrated acceptance details from review07 and source verification

- T06/T11: fixed multi-view logits plus merge/drop produce identical offline/serving sample probability and threshold equality; capture-role/aggregation/transform change invalidates calibration/release. High classification accuracy with construction-failing accepted samples fails QC risk gate.
- T11: Create scanner/training/qc/workflow_metrics.py and scanner/tests/test_qc_workflow_metrics.py; `reduce_workflow(events: list[DecisionEvent], reference: Reference) -> UnitOutcome` uses any-ACCEPT endpoint. ACCEPT→HOLD on nonconforming reference counts accepted1/failure1; three captures count one unit; unfinished units remain enrolled denominator and capture burden is separate.
- T10/T11: four paired arms report risk bounds and grouped coverage differences; no noninferiority/no-risk-increase claim from separate bounds. Missing authority HOLD error criterion fails automatic HOLD release; HOLD-all-conforming fixture cannot advertise useful coverage.
- T04/T13: primary standards catalog scope/edition verified as in design§16; authorized full-text and factory-selected grading remain external before compliance claims. Four-point/40-point is not an implicit feature.

## Integrated acceptance details from reviews09–13

- T01/T02/T05 (before Nov29 capture): define ConsentAuthority/CaptureSet/Adjudication/POCandidate/AuthenticationContext and new envelope fields in canonical schema. Consent check precedes byte staging; unknown/foreign/expired/withdrawn or research-only permission yields no blob. Signed operational-only permits QC, never research. Fake register validates enforcement, not legal adequacy.
- T02: Create yarnflow/server/qc-retention.mjs and yarnflow/tests/qc-retention.test.mjs; `applyQCRetention(db, bucket, now) -> Promise<RetentionReport>` tombstones authorized expired originals/derivatives, preserves metadata and audited holds, excludes training and enforces restore reconciliation. Inject clock/purge/hold/withdrawal/old-backup tests; legacy ScanStore spy records zero v2 calls. Never delete merely because GC sees a live reference: governed purge uses explicit retention event.
- T09/T10: Create scanner/training/qc/export_guard.py and scanner/tests/test_qc_export_guard.py; `validate_export(staged: ExportManifest, rights: RightsRegistry) -> ExportEligibility` runs before existing retrain_rounds_stage.sh/fault publish_code.sh reuse. Fake Kaggle transport sees zero calls for unknown/forbidden export and required notices preserved; no blanket CC0 without complete rights.
- T10: train_manifest must verify all files/features/audit hashes and intended IDs before model construction; deleted/changed input, extra release cache row, legacy CSV substitution and truncation fail; calibration/release sentinels never reach fit/early stop/TTA/test export. Resumed run requires parent/epoch/optimizer/scaler/command, cannot count as new seed.
- T10: Create scanner/scripts/qc_ddp_proof.py: `verify_ddp_proof(upstream: Path, expected_sha: str, report: Path) -> None`; command `python scripts/qc_ddp_proof.py --manifest research/qc/ddp-proof-manifest.json` checks pinned actual upstream from bundle, runs named two-rank numerical test with DINOMALY_REPO set and fails skipped/missing/wrong SHA. Separately require real production-loop NCCL/AMP report before DDP speedup claim; missing hardware proof remains G6.
- T04/T06: own v2 decoder in scanner/services/vision/qc_imageio.py, preserve4032×3024 bounded EXIF-upright source and transformations; every classifier/fault derivative records resize. Unvalidated1600/six-tile reduction reviews; keep v1 defaults.
- T02/T05/T06: signed deadline_at covers cold start; held inference released after deadline commits zero; expired execution replay cannot commit. Drop response after timely commit, same key returns exact existing revision. T11 statistical candidate cannot activate without T12 matching target operations/parity evidence; precision/preprocess change invalidates proof.
- T01/T02/T05: explicit capture-set create/upload/close endpoints from design§17; restart between overview and structure uploads reloads exact IDs/roles/hashes, incomplete set rejects analysis, two concurrent closes allocate one attempt, repeated file/close consumes no revision.
- T05/T06: namespaced early error boundaries tested through actual Cloudflare fetch/ASGI for missing DB/session, origin, malformed JSON/multipart, oversize, unsupported method, timeout and unhandled exception. Assert request_id/schema/retryability and no sensitive input, preserve v1 fixtures.
- T01/T02/T05: corrected OCR candidate reload retains raw doc/page/span/unit/confidence/correction reason; later immutable version preserves prior. Append UNDETERMINED then CONFORMING adjudication, reload both actors/references while model decision unchanged; stale append409. Admin override missing interventionReason rejects, both reasons persist separately; sales/dispatch cannot override.
- T01/T02/T05: fresh proof5min proposed/security gated; old admin session cannot promote, wrong actor/workspace/session/body/expiry/replay fails, valid proof succeeds once. Logout/PIN reset invalidates. Pause inference then logout/reset/deactivate/change role/expire session, including race immediately before DB batch: zero decision/success event writes. Fresh session may explicitly retry; scanner never receives browser cookie.

## Integrated acceptance details from reviews14–18

- T02: explicit additive unique PO parent index, composite spec-version/sample/evidence/release FKs; populated same-tenant inserts pass, foreign-parent inserts fail, PRAGMA foreign_key_check empty and old readers work through local and actual Wrangler/D1 runner. Existing maximum0032 observed; recheck before0033 reservation. Reuse SQL aborting-assertion pattern; forced zero-row guard produces zero evidence/decision/audit/pointer/idempotent-success writes even if release/auth changes after preliminary read.
- T02/T05/T12: Create qc_blob_claims and qc_idempotency lifecycle fields in additive migration; race GC claim/reference acquisition under barriers on filesystem and D1 fallback, inject each crash/deletion failure. Either reference wins and bytes retained or GC wins and no reference publish; retry cleanup safe. Request lease/generation prevents stale worker finalization; crash recovers without permanent lock.
- T05/T06: Create scanner/tests/fixtures/qc-images/ with genuinely decodable JPEG/PNG/WebP hashes, EXIF rotation, signature-valid truncated14-byte negative and compressed over-pixel-limit image. Worker→actual ASGI decode→blob readback preserves originals/ROI orientation; sentinel422/no decision, pixel oversize413/no model invocation, corrupt/missing readback blocks finalization. Mock learned stages unavailable, never fabricated readiness.
- T07: memory-only draft caps/expiry from design§18, warning before reload loss; prove no original/sensitive metadata in localStorage/IndexedDB/Cache Storage. At24h upload blocked and URLs purged; replacement/quota/expiry/logout clean resources. LiveApp actor/workspace/session-generation and BroadcastChannel: two-tab offline logout/login new actor, deferred response,401/workspace switch all hide prior status and send zero old uploads.
- T07: build current source before Playwright; CI=1 prevents unrelated server reuse. Wait for production service-worker controller; load private preview via img, inspect Cache Storage, logout/offline cannot recover bytes; upgrade cleans obsolete caches, public shell still offline. Build generator literal replacement remains valid. Create public static-shell allowlist tests.
- T01/T04/T07/T08: acquisition metadata fixture with identical hash but unknown lens/changed zoom/focus/missing required observation never automates. Imported/reencoded/canvas mode review-only until separate physical profile.
- T08: Create ios/Yarnflow.xcodeproj/project.pbxproj, shared scheme Yarnflow, unit target YarnflowTests and UI target YarnflowUITests; Modify ios/Info.plist, scripts/build.sh, Yarnflow/{Models,Workflows,YarnflowApp}.swift. Use actual AppStore cookie-session acquisition/isolated URLSession not fabricated bearer: empty jar→Worker login→correct-actor upload; expiry/cancel/revocation/account switch pause/purge safely. Fixed native Origin behavior needs G8 integration proof.
- T08 commands from yarnflow: `xcodebuild -list -project ios/Yarnflow.xcodeproj`; `xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,name=iPhone 16'` after confirming installed destination (record actual replacement if unavailable); `xcodebuild build -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`. Device installation requires separately available authorized signing/device, no purchase. Create ios/Yarnflow/Localizable.xcstrings and ios/YarnflowUITests/QCWorkflowTests.swift; every Reason/state reviewed English/Urdu, RTL ID/unit order, maximum Dynamic Type, region list and VoiceOver device report distinct from Codable proof.
- T12: Create yarnflow/server/qc-monitoring.mjs, qc-recalls.mjs, tests/qc-monitoring.test.mjs, qc-recalls.test.mjs; extend cloudflare.mjs scheduled and existing notify owner. `evaluateQCMonitoring(db, protocol, now) -> Promise<Incident[]>`; `recallQCDecisions(db, incident, now) -> Promise<RecallReport>`. Approved normal/shifted/sparse/missing-audit streams assert exact affected-domain suspension/incident, unaffected domains retained, replay restart idempotent. No protocol/ops proof means no activation. More than100 historical decisions/two tenants: exhaustive recall pagination, no unrelated recalls, no in-flight commit, one intended-recipient notice/incident, failed delivery retries and visible ack, old decisions immutable.
- T02/T09/T12: protected monotonic deletion ledger survives old restore; snapshot→withdraw/delete→isolated restore→reconcile keeps bytes/features unavailable and permitted hashes/tombstones interpretable, backup expiry enforced, holds per signed policy. Test actual D1-contained blob and local WAL/files; zero legacy ScanStore writes; existing ERP audit UPDATE/DELETE still fail.

## Integrated acceptance details from review19

- T04a produces frozen metrology/quality interfaces and truthful abstention adapter17Nov; T05 integrates only after this artifact18–21Nov. T04b signed physical report is later prerequisite for automatic release. T06 demo checkpoint22–23Nov demonstrates central real classifier if installed, correct unavailable defect and review-only persist/reload; actual fault serving-loader parity remains final milestone byFeb, never marked done by missing-artifact abstention. T07 integration24–26Nov and integrated rehearsal27–28Nov precede29Nov.
- T06 early `qc_benchmark.py` bounded probe (move creation from T12 into T06; T12 extends/repeats) records existing local hardware/max capture set/cold warm/wall CPU/RSS/two-request contention;60s deadline/failure presentation and no late writes. No queue or paid serving assumed. T12 final candidate activation still requires target proof/G8.
- T09 Create scanner/research/qc/enrollment-feasibility.md and tests/test_qc_enrollment.py; `required_enrollment(accepted_required: int, acceptance_fraction: float, attrition_fraction: float) -> int` uses ceiling and rejects zero/out-of-range fractions.299/.30 yields997 before attrition; lower coverage/independence/more alpha allocation cannot reduce requirement. Worksheet due15Dec,31Jan domain/no-release checkpoint and31Mar projected cohort completion; zero authorized rate or infeasible date→explicit review-only. Names/authority supplied by G1/G2/G4/G7, not invented.

## Pre-final-review author self-review

Repeated writing-plans checks after initial19 integration: all design requirements map to T01–T13 plus numbered acceptance refinements; one Python policy signature now includes EvaluationContext, one private analysis boundary returns bound evidence+draft, closed capture_set_id replaces ad hoc capture lists in public analyze. Demo dependency split T04a/T04b and candidate-versus-activation split T11/T12 eliminate earlier schedule cycles. Refinements are mandatory additions to owning tasks, not optional work or shipped claims. Final reviewer20 will examine integrated buildability; final document validation follows its correction pass.

## Final integration corrections from review20

- T01/T02/T05: Sample predecessor and family/spec recovery contract is design§20; extend same fixtures withv1 decision→confirmv2→pausedv1 analyze409/no writes→new linked sample under currentv2. Cross-sample/spec evidence fails; historical bindings immutable/readable, complete roundtrip in Python/TS/Swift; attempts stay family-scoped. Add `createSampleEvaluation(db, authContext, input, now) -> Promise<QCResult>` to qc-store.mjs and handleQC POST samples.
- T07/T08: stale-spec UI offers explicit linked evaluation under current confirmed spec, displays both histories and requires recapture; preserves family attempt budget/selection identity, clears stale success. No hidden mutable Sample.spec_version.
- T09/T11: reference records resolve applicable spec; workflow reducer traverses family and any-ACCEPT history. Fixture ACCEPTv1(nonconforming v1 reference)→HOLDv2 counts one accepted independent unit/failure; never inflate n with changed PO version. Separate specification-change accounting from retrospective model errors.

## Mandatory per-task gates (Step4 includes these)

All commands below are **future implementation acceptance commands**, not tests run while authoring this plan. Run Python from scanner and Node/web/native from yarnflow. All newly created named tests must collect and execute; missing file or skipped required assertion is failure. Record command/environment, collected/executed counts/skips and result. A passing focused command cannot replace the separately listed physical, security, rights or hardware evidence. For each task deliberately failing one integrated regression must make this gate nonzero before restoring it.

| Task | Additional mandatory red/green command | Non-command evidence / gate |
|---|---|---|
| T01 | `pytest tests/test_qc_contracts.py -q`; `npm run typecheck` in yarnflow; shared Codable fixture cases under T08 | canonical valid/invalid create/upload/close/reload/spec-family fixtures |
| T02 | `node --test tests/qc-store.test.mjs tests/qc-migration.test.mjs tests/qc-retention.test.mjs tests/qc-blob-claims.test.mjs` | actual D1 and populated local migration/replay, restore/purge/tombstone drill, G4/G8 |
| T03 | `pytest tests/test_qc_policy.py -q` | complete policy mutation table incl absent OOD/axes/clock |
| T04a/T04b | `pytest tests/test_qc_metrology.py tests/test_qc_quality.py tests/test_qc_imageio.py -q` | T04a abstaining adapter by17Nov; T04b blinded physical/uncertainty/axis/source-support report and G3 |
| T05 | `node --test tests/qc-api.test.mjs tests/qc-service-integration.test.mjs` | real Worker→ASGI subprocess service fixture, no fake trained results; rights/session/deadline/spec-family races |
| T06 | `pytest tests/test_qc_api.py tests/test_qc_pipeline.py tests/test_qc_imageio.py tests/test_qc_serving_loader.py tests/test_api.py tests/test_spec_api.py -q` | early local bounded benchmark, real supported checkpoint parity if artifact available; absent loader proof means final artifact submilestone blocked |
| T07 | `npm run typecheck && node --experimental-strip-types --test tests/qc-client.test.ts tests/qc-drafts.test.ts tests/qc-cache.test.mjs && npm run build && CI=1 npx playwright test e2e/incoming-qc.spec.ts` | controlled built service-worker tests, two-tab session race, fluent Urdu and real phone accessibility |
| T08 | `xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,name=iPhone 16'`; generic device build as specified above | actual installed destination recorded if different; Codable/UI/native login and authorized signed-device VoiceOver/camera proof; G8 signing/device prerequisite |
| T09 | `pytest tests/test_qc_split_audit.py tests/test_qc_references.py tests/test_qc_enrollment.py -q` | sealed groups, source overlap, sampling feasibility, rights/consent G1/G4/G5 |
| T10 | `pytest tests/test_qc_training.py tests/test_qc_ablations.py tests/test_qc_export_guard.py tests/test_textilenet_splits.py tests/test_fault_data.py tests/test_fault_dinomaly_ddp.py -q`; `python scripts/qc_ddp_proof.py --manifest research/qc/ddp-proof-manifest.json` | pinned mandatory no-skip numerical proof; authorized real NCCL production report distinct; resume/consumed-ID logs and compute cap |
| T11 | `pytest tests/test_qc_release_gate.py tests/test_qc_workflow_metrics.py -q` | independent statistical candidate, frozen thresholds/grouped cohort, G2/G7; no activation yet |
| T12 | `pytest tests/test_qc_parity.py -q`; `node --test tests/qc-faults.test.mjs tests/qc-monitoring.test.mjs tests/qc-recalls.test.mjs tests/qc-retention.test.mjs tests/qc-blob-claims.test.mjs tests/qc-service-integration.test.mjs`; `npm test && npm run typecheck && npm run build` | actual target parity/cost/credential/recovery/monitoring and G8, independent G1–G7 as applicable |
| T13 | rerun recorded T01–T12 applicable gates against archived bundle; verify hashes/index | signed SOP/user study, negative/inconclusive results, honest final scope |

**Additional file ownership fixed by this table:** T02 creates yarnflow/tests/qc-blob-claims.test.mjs; T04 creates scanner/tests/test_qc_imageio.py; T05 creates yarnflow/tests/qc-service-integration.test.mjs; T06 creates scanner/tests/test_qc_serving_loader.py; T07 creates yarnflow/tests/{qc-drafts.test.ts,qc-cache.test.mjs}. Table commands include files added by earlier integration sections. Test service subprocess must use an ephemeral local port and isolated temporary DB/blob directories and terminate cleanly; no deployed endpoint, external account or active model job is touched by local integration proof.

## Final requirements traceability additions

| Refinement | Owning tasks | Proof |
|---|---|---|
| Revised-spec immutable sample family | T01,T02,T05,T07,T08,T11 |v1 paused409; linkedv2 reload; any-ACCEPT/family attempt regression |
| Consent/export/purge/recovery | T01,T02,T05,T09,T10,T12 | pre-byte permission rejection, fake-export zero calls, monotonic tombstone restore |
| Source resolution/physical axis/OOD/clock | T01,T03,T04,T06 | exact axis and explicit executed-domain fixtures, injected clock/source-resolution challenges |
| Monitoring/recalls/session/GC races | T02,T05,T07,T08,T12 | mandatory command table plus signed operational protocol and isolated restore |
| Statistical endpoint/ablation/DDP/feasibility | T09,T10,T11 | all added tests mandatory, no-skip proof, paired report and independent candidate |

## Final author self-review

After review20: scope/spec coverage checked against all20 numbered reviews and design§§1–20; revised-spec transition no longer contradicts immutable sample/spec binding; same policy/service/public analyze signatures reused; all integrated test paths now in mandatory owning-task gates; all five Review Focus classes pinned. Plan is comparable in size to design and contains decisions/signatures/proof rather than full implementation bodies. No actionable documentation P0/P1 remains. External G1–G8 and native physical signing/access are honest gates with review-only/lab fallback; document completion does not assert future product tests or approvals passed.

T01 additionally freezes exact auxiliary types and engineering limits in design§21; T03 tests all five required stages and defect threshold equalities; T05/T06 enforce streamed bytes/pixels/single-frame MIME, assertion TTL/skew/generation and global429; T07/T08 show explicit unsupported-media acquisition guidance. These limits are engineering starting points, never substitutes for validated physical domain thresholds.

Final auth ownership: AuthenticationContext wraps current member plus initiating session identity/epoch; handleQC, assertion generation and finalizeQC consume that context. No detached stale member object can authorize finalization. `createSampleEvaluation` is the single public sample-create helper for initial and linked evaluations, not an additional competing mutable-sample API.
