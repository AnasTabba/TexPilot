# Incoming-fabric QC v2: lead contract decisions

Lead integration owner's binding decisions for every implementer. The design and plan
(`docs/superpowers/specs|plans/2026-11-12-incoming-fabric-qc*.md`) remain the requirements; this
file only fixes what they left open so parallel work meets at one wire shape. Paths are
repository-root relative.

## Source of truth

- `scanner/services/api/qc_schemas.py` is the executable contract. `scanner/contracts/qc-v2.schema.json`
  is generated from it (`python -m services.api.qc_schemas`); a test fails on drift. Do not edit
  the JSON by hand, and do not change `qc_schemas.py` without telling the lead (shared contract).
- `scanner/tests/fixtures/qc-v2/{valid,invalid}.json`: `[{name, type, value, layer}]` where `type`
  is a key of `CONTRACT_TYPES` and `layer` is `schema` (the JSON Schema alone rejects it) or
  `semantic` (a cross-field rule rejects it). Python, the Worker (`server/qc-contract.mjs`),
  TypeScript and Swift all run the same two files.
- Canonical JSON / hashing: `canonical_json` (sorted keys by UTF-16 unit, no whitespace,
  ECMAScript number text) and `sha256_hex` in `qc_schemas.py`; `server/qc-contract.mjs` exports
  the identical `canonicalJson` / `sha256Hex`. `content_sha256` of a record excludes its own hash
  field (`PurchaseSpec.content_sha256`, `Policy.sha256`, `DomainManifest.sha256`,
  `Release.sha256` + `state`). `Evidence.manifest_sha256` excludes `manifest_sha256`, `id`,
  `created_at`. Image hashes are always the raw uploaded bytes.

## Authority split

- Worker (Yarnflow) owns identity, tenancy, persistence, idempotency, finalisation. Scanner owns
  evidence and the one policy evaluator `evaluate_qc` (Python). No policy logic in JS, TS or
  Swift. The Worker applies one fail-closed clamp, not a policy: a draft with `automatic=true`
  is refused (502-class `SERVICE_UNAVAILABLE`, nothing committed) unless the Worker itself
  selected an ACTIVE, unexpired, unsuspended release and an AUTOMATIC policy for that request.
- Default policy is REVIEW_ONLY. `QCResult.mode` states it on every response.
- Recapture under REVIEW_ONLY: allowed. RECAPTURE is not an automatic status
  (`automatic=false`); asking for a sharper photo is not a decision about the fabric. So
  REVIEW_ONLY never yields ACCEPT/HOLD, and yields RECAPTURE only for quality-only
  capture-fixable failures on attempts 1-2 (attempt 3 -> MANUAL_REVIEW + RECAPTURE_LIMIT).
  Any unavailable/failed/disabled required stage alongside a quality failure is "mixed" ->
  MANUAL_REVIEW, with the quality reason still listed so the operator sees what to fix.

## Private service wire (Worker -> scanner)

- `POST /api/v2/qc/analyze`, multipart: part `request` = UTF-8 JSON of `AnalyzeRequest`; one file
  part per capture named `capture_<capture.id>`.
- Header `X-QC-Assertion: v1.<b64url(claims JSON)>.<b64url(HMAC-SHA256(key, "v1." + b64url(claims)))>`,
  claims = `AssertionClaims`; `payload_sha256` = SHA-256 of the exact `request` part bytes.
  Shared key in env `TEXPILOT_QC_SERVICE_KEY` (scanner) / `QC_SERVICE_KEY` (Worker), key id in
  `TEXPILOT_QC_SERVICE_KID` / `QC_SERVICE_KID` (default `qc-local-1`). No key configured ->
  scanner answers 503, Worker answers 503; never an unauthenticated call. Scanner rejects:
  missing/garbled (403), wrong kid/aud/signature (403), `now >= exp` or `iat > now + 120` (403),
  payload hash mismatch (403), `deadline_at` passed (504), workspace/request mismatch with the
  body's `context` (403).
- `GET /api/v2/qc/readiness` -> `Readiness` (same assertion header, `payload_sha256` of empty
  bytes).
- Response 200 = `AnalysisCandidate`. Errors = `ErrorEnvelope` with the HTTP status from
  `ERROR_STATUS`. One in-flight analysis at a time; excess -> 429 `CAPACITY_LIMIT`.
- The scanner never writes the legacy ScanStore for v2 and keeps nothing after responding.
- Optional provider proxy bearer (`TEXPILOT_API_TOKEN`) stays a separate `Authorization` header.

## Public Worker API (`/api/qc/v2`, JSON unless stated)

Every mutation needs a signed-in session, same-origin `Origin`, and an `Idempotency-Key` header
(UUID). Errors are always `ErrorEnvelope`. Responses are `Cache-Control: no-store`.

| Method & path | Who | Body -> result |
|---|---|---|
| GET `/status` | any signed-in | `{schema_version, mode, automation:{enabled:false, missing_gates:[...]}, readiness: Readiness\|null, scanner:'CONNECTED'\|'UNAVAILABLE', limits, role, can:{confirm_spec,create_sample,capture,adjudicate,manage_release}}` |
| GET `/purchase-orders` | any signed-in | `{items:[{purchase_order_id, reference, supplier_name, status, current_spec:{id,version,confirmed_at,construction}\|null}]}` |
| POST `/specs` | purchase_manager (admin with `interventionReason`) | `{purchase_order_id, expected_spec_version:number\|null, construction, allowed_fabric_labels, taxonomy_version, density:[{axis,unit,target,lower,upper,candidate:{...}\|null}], confirmation_reason, interventionReason?}` -> 201 `PurchaseSpec` |
| GET `/specs/:id?version=N` | any signed-in | `{spec: PurchaseSpec, current: boolean, versions:[n...]}` |
| GET `/consent-authorities` | any signed-in | `{items: ConsentAuthority[]}` (currently valid first) |
| POST `/consent-authorities` | admin | register a signed-register reference -> 201 `ConsentAuthority` |
| POST `/selections` | quality_inspector (admin with reason) | `{purchase_order_id, plan_version, plan_sha256, randomization_seed, draw_index, selection_probability, cohort, independent_group_id, lot_ref, roll_ref, location_ref, face, planned_area_cm2, method}` -> 201 `SamplingSelection` |
| POST `/samples` | quality_inspector (admin with reason) | `{selection_id, spec_id, spec_version, predecessor_sample_id, expected_predecessor_revision, reason, disposition?:'SELECTED'\|'MISSING'\|'EXCLUDED', exclusion_reason?}` -> 201 `QCResult` |
| GET `/samples?purchase_order_id=` | any signed-in | `{items:[{sample_id, roll_ref, location_ref, spec_version, revision, status:DecisionStatus\|null, disposition, created_at}]}` |
| GET `/samples/:id` | any signed-in | `QCResult` |
| POST `/samples/:id/capture-sets` | quality_inspector | `{expected_revision}` -> 201 `QCResult` |
| POST `/capture-sets/:setId/captures` | quality_inspector | multipart: `meta` JSON `{capture_id, role, expected_revision, sha256, taken_at, device_profile_id, calibration_id, consent_record_id, attestation: AcquisitionAttestation}` + file `original` -> 201 `QCResult` |
| POST `/capture-sets/:setId/close` | quality_inspector | `{expected_revision}` -> `QCResult` |
| POST `/samples/:id/analyze` | quality_inspector | `{expected_revision, capture_set_id}` -> `QCResult`, or 202 `{schema_version, request_id, state:'IN_PROGRESS', status_url}` when the same key is already running |
| GET `/requests/:request_id` | the actor who started it | `{schema_version, request_id, state:'IN_PROGRESS'\|'COMPLETED'\|'EXPIRED'\|'FAILED', result: QCResult\|null, error: ErrorBody\|null}` |
| GET `/captures/:id/original` | any signed-in, same workspace | image bytes, `private,no-store`; 404 foreign, 410-as-404 `PURGED` |
| POST `/samples/:id/adjudications` | supervisor (admin with `interventionReason`) | `{expected_revision, outcome, reason, reference_ids, supersedes_id, interventionReason?}` -> 201 `QCResult` |
| POST `/reauth` | admin | `{pin, payload_sha256}` -> `{proof, expires_at}` (5 min, single use, bound to session/actor/workspace/payload) |
| GET `/releases` | any signed-in | `{items: Release[], active_release_id}` |
| POST `/releases` | admin + fresh proof | registers a `STATISTICAL_CANDIDATE` only |
| POST `/releases/:id/activate` | admin + fresh proof | refused (403 `POLICY_UNRELEASED`) unless every gate in `env.QC_AUTOMATION_GATES` (JSON `{G1..G8: sha256}`) is present and the release carries operations + monitoring hashes |
| POST `/releases/:id/suspend` | admin (no proof: containment is immediate) | `{reason}` -> `Release` |

Role mapping: operator = `quality_inspector`; reviewer = `supervisor`; owner = `admin`;
`purchase_manager` confirms PO facts; `sales_manager` and `dispatch` are read-only. Workspace is
always taken from the session; a `workspace_id` in a request body is an unknown field (422).
Foreign-tenant objects are 404.

Revision rules: sample revision starts at 0; +1 for each new capture-set create, each new
capture upload, each close, each committed decision, each adjudication. Idempotent replays
change nothing. `attempt` is allocated at close and counts across the whole selection family
(max 3).

## Stage truthfulness (what the scanner may claim today)

No trained bundle, fault artifact, calibration profile, domain manifest or release exists in
this repository or on this machine (verified 13 Nov 2026). Therefore:

- `fabric`: DISABLED + STAGE_UNAVAILABLE under the stub predictor; with a real predictor the
  flat-swatch adapter runs the structure head without the garment detector, and
  `calibrated_probability` stays `null` (scanner-v8/head_a calibration does not match the served
  logits, design §14).
- `defects`: DISABLED + STAGE_UNAVAILABLE until `fault.py` can load a real artifact (G6).
- `metrology`: ABSTAINED unless a validated `CalibrationProfile` + `ScaleReference` +
  `AxisRegistration` + domain metrology validation are all present and unexpired (G3).
- `domain`: DISABLED + DOMAIN_UNVALIDATED until a released assessment artifact exists.
- `quality`: runs the engineering heuristics it has; a check with no validated detector makes
  the stage ABSTAINED (reasons list what was detected), never a silent pass.
- Test doubles that produce OK stages live only under `tests/` and are named as doubles.

## Not in this build (external gates, unchanged)

G1 factory access, G2 tolerances/risk authority, G3 physical calibration, G4 rights/consent,
G5 AITEX empty-mask policy, G6 fault artifacts + hardware proof, G7 independent statistics,
G8 security/deployment/signing sign-off. No gate is approved by code.
