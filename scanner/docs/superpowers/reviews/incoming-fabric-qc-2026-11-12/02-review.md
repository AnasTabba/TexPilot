# Reviewer 02 — actual architecture and ownership

Recommendation: **revise before implementation**. No P0 found; two P1 integration/contract gaps and two P2 ownership gaps below. This is an independent source review, not a product implementation or release approval.

## Findings

### P1 — Python policy has no invocation across the Worker service boundary

**Evidence:** Plan Architecture assigns policy to scanner and finalization to Worker; Contract ownership defines `evaluate_qc` returning `DecisionDraft`. T03 creates only `scanner/services/consistency/qc_policy.py`; T06 advertises only `run_qc_evidence(...) -> Evidence`, and the endpoint map exposes only evidence/readiness. T05 must return a persisted Decision but receives no draft and has no policy evaluation endpoint or executable policy implementation. Existing `yarnflow/server/scanner-proxy.mjs:2–30` only forwards HTTP; `yarnflow/server/cloudflare.mjs:13–24` similarly cannot call a Python function. This is proposed missing wiring, not an existing v1 defect.

**Correction:** Specify one private analysis contract returning Evidence plus DecisionDraft, with Worker-selected immutable policy/release/attempt inputs and signed request binding; have T06 explicitly invoke T03. Worker validates the candidate binding and rechecks current authorization/spec/release/revision at atomic finalization. Alternatively relocate policy ownership explicitly, but do not duplicate business policy in JS and Python.

**Test assertion:** Real Worker-to-FastAPI integration with a released fixture obtains exactly the Python evaluator's draft and persists it; changing release during inference yields 409 with zero decision/event writes; no route can synthesize ACCEPT from evidence alone. G2/G3/G7/G8 still gate enabling automatic mode independently of this integration test.

### P1 — Frozen wire contract omits the concurrency token required by every analysis client

**Evidence:** Design §3 `Sample` (lines 60–63) has capture_attempt but no revision, and `Decision` (80–83) also lacks revision. Plan Contract ownership says persistence adds revision, endpoint map requires expected_revision and returns current revision/history, and T07/T08 signatures require expectedRevision. No QCResult/current-state envelope is defined in T01, despite §3 being authoritative and unknown fields being rejected. Existing optimistic mutation/SQL infrastructure is separate from these proposed contracts: `yarnflow/server/sqlite.mjs:18–32` provides transactional batch, not an implicit revision response. Executors cannot generate identical strict Python/TS/Swift fixtures for the promised interaction from the frozen types.

**Correction:** T01 must define canonical request/result/current-state envelopes, including server revision, capture/spec bindings and history representation, and specify which operations advance revision. Keep capture_attempt separate from concurrency revision. Include initial-create, capture upload, analyze and reload response fixtures before T02/T05/T07 proceed.

**Test assertion:** All three decoders consume the same create/upload/analyze/reload fixtures; two analyses using one revision commit exactly once, the stale request gets 409, reload returns the advanced revision, and an upload retry does not advance attempt/revision twice. This is a software contract gap, not an external authority gate.

### P2 — Flat-swatch task names the protocol file but omits the owning concrete inference implementation

**Evidence:** T06 permits `scanner/services/vision/predictor.py` “only adapter boundary” and demands a real flat-swatch path bypassing garment dependence. Actual `predictor.py:72–86` contains the protocol/stub; the behavior lives in `scanner/services/vision/scanner.py:45–81`. No garment already falls back to whole-image classification (57–61), but detection still executes (53) and `build_scanner` unconditionally loads a detector (123–130). `scanner/services/api/config.py:64–89` builds that concrete scanner and derives model identity from its heads. Thus the baseline already supports no-detection fallback, while a detector-independent startup/inference path still needs concrete ownership. Merely extending the protocol cannot remove detector loading or preserve truthful artifact identity.

**Correction:** Clarify the requirement as detector-independent v2 construction/inference, retain the existing v1 fallback, and explicitly assign the concrete adapter/factory changes to scanner.py/config.py or a dedicated v2 concrete adapter reusing heads/fault primitives. Avoid implementing a second head pipeline inside the API orchestration layer.

**Test assertion:** With garment detector construction and invocation made to raise, the real v2 flat adapter still runs the installed fabric head and reports its artifact hash; v1 retains its current whole-image fallback and wire result. Missing real weights remain an availability/review condition, not a mocked production readiness claim (G6).

### P2 — Deployment entrypoint evidence and API acceptance coverage target the wrong Worker file

**Evidence:** Design §2 traces `worker.mjs -> inventory.mjs -> scanner-proxy.mjs`; actual `yarnflow/server/worker.mjs:1–7` imports inventory only and never imports the proxy. Published entrypoint is `yarnflow/wrangler.jsonc` (`main: server/cloudflare.mjs`), whose lines 13–24 own authenticated v1 forwarding; Vite sends v1 directly to scanner (`yarnflow/vite.config.ts:3–10`). T05 lists worker/inventory/scanner-proxy modifications and T12 deployment modifications name only Modal/CI. Inventory currently parses every ordinary POST as JSON at `inventory.mjs:143–145`, after two explicit multipart exceptions. A v2 capture handler must be inserted before that parse, not attached blindly alongside JSON routes. Routing through inventory can support v2 without changing cloudflare.mjs, but the plan's observed chain and test target do not prove that.

**Correction:** Correct the baseline to distinguish published, embedded-worker and dev entrypoints. Assign pre-JSON authenticated QC multipart dispatch in inventory; test the actual exported cloudflare fetch entrypoint, plus local dev routing. Only modify cloudflare.mjs if the chosen design requires it.

**Test assertion:** A bounded authenticated multipart capture reaches QC unchanged through the published fetch export and local API; anonymous/foreign-origin requests fail before body decode; v1 retains its existing forwarding semantics. G8 hosting/security approval remains external and is not satisfied by route unit tests.

## Inspected paths and limits

Inspected both complete target drafts; source inspected: `scanner/services/vision/{predictor,scanner}.py`, `scanner/services/api/config.py`, `yarnflow/server/{worker,cloudflare,inventory,scanner-proxy,sqlite,erp-utils,d1-bucket,procurement}.mjs`, `yarnflow/scripts/dev-server.mjs`, `yarnflow/vite.config.ts`, `yarnflow/wrangler.jsonc`, and `yarnflow/ios/Yarnflow/{Models,Workflows}.swift`. Searched actual route, auth, migration and native request ownership rather than trusting README. No product tests, installs, GPU/Kaggle actions, purchases or commits were run; evidence is direct source tracing. External physical validation, factory authority, data rights and deployment approval are explicitly pending in G1–G8 and are not reported as missing implementation or silently granted.

Final recommendation: resolve the policy transport and revision schema before freezing T01/T05; update the concrete inference and routing ownership in T06/T05. The proposed separation from stock/receipt/claim writers is appropriate and should remain enforced by the planned side-effect assertions.
