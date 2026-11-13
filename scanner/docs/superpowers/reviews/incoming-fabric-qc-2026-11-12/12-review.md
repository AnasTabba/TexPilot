# Reviewer 12 — API/schema/errors

Recommendation: revise the contracts before implementing T01/T05/T06. No P0 found; two P1 and two P2 contract gaps below. This is a source/document review, not evidence that proposed v2 exists or passes tests.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (§§2–15).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (endpoint map, T01–T13 and integrated acceptance details).
- `scanner/services/api/{main,schemas,uploads}.py`.
- `yarnflow/server/{cloudflare,inventory,scanner-proxy,erp-utils}.mjs`.
- `yarnflow/src/scanner-client.ts`; `yarnflow/ios/Yarnflow/Workflows.swift`.

## Findings

### P1 — Capture-set completion has no wire operation or recoverable representation

**Evidence:** Plan line 40 says POST captures uploads an original and allocates an attempt. Design line 188 instead says attempts count complete capture sets, not individual files, and a selected set closes atomically. Neither contract specifies a set ID, required members, completion flag/operation, or which request closes it. The same line defines the common create/upload/reload QCResult without any captures or capture-set metadata; before inference its evidence is null. Consequently reload cannot discover uploaded captures, their roles/hashes or whether a set was closed. Existing `yarnflow/server/inventory.mjs:123–141` implements individual inspection-photo uploads, not this proposed multi-view invariant; it cannot supply missing semantics.

**Correction:** Specify one concrete upload/set protocol in T01 and the endpoint map: stable set and capture identifiers, membership/roles, expected revision, atomic close point, and attempt allocation only on first successful close. Include captures and set state in the reload/upload response (or specify an authenticated retrieval endpoint). Do not leave closure to inferred file count or client dialog lifetime.

**Test assertion:** Upload overview and structure separately, restart the client between uploads, reload their exact IDs/hashes/roles, then close once: attempt increases exactly once. Retrying either file or close changes neither attempt nor revision; an incomplete set cannot analyze; two concurrent closes allocate one attempt.

### P1 — Required v2 error envelope does not own failures before QC dispatch

**Evidence:** Design line 95 promises the typed envelope for authentication, CSRF, validation, service/audit failures and deadlines. Actual published entrypoint `yarnflow/server/cloudflare.mjs:15` sends non-v1 paths through inventory. `inventory.mjs:100–111` can fail for absent DB, method, origin or session before a future handleQC call; `inventory.mjs:290–293` serializes these as `{error:string}`. Actual FastAPI `scanner/services/api/main.py` uses ordinary HTTPException and default request validation; its legacy handlers must stay unchanged. T05/T06 name endpoint auth and schema tests but do not explicitly assign a v2 boundary formatter for these early/default failures. Adding only a formatter inside handleQC cannot satisfy the advertised contract.

**Correction:** Give the entire v2 namespace a scoped error boundary covering pre-dispatch failures and FastAPI request-validation/unhandled exceptions, preserving v1/ERP formats. Define bounded machine error codes and retryability mapping, including malformed JSON/multipart and unsupported method; do not expose raw Pydantic input or exception text. Bind request_id before authorization/parsing.

**Test assertion:** Through actual Cloudflare fetch and ASGI entrypoints, assert envelope/schema/request_id and correct retryable for missing DB/session, wrong Origin, malformed JSON, missing multipart field, oversize stream, timeout and unexpected exception; assert sensitive inputs absent and existing v1 error fixtures unchanged.

### P2 — Frozen PO provenance cannot encode required import evidence

**Evidence:** Design line 107 requires source file/page/span, raw OCR span/confidence and document hash, plus a reason for new versions. The authoritative `Provenance` at lines 49–51 contains only source/id/version/actor/time/image hash; `PurchaseSpec` at lines 55–59 has no import reference, confirmation reason or structured OCR candidate. Plan T01 line 52 asks to preserve contradictory provenance while unknown fields are rejected (design line 37). Existing `scanner/services/api/schemas.py:51–55` stores normalized stated composition only and does not provide the new construction-PO audit schema.

**Correction:** Define bounded document/candidate provenance and spec-confirmation input schemas, retaining document hash, page/span, raw value/unit, confidence, candidate/correction lineage and reason. Distinguish server-derived PurchaseSpec response fields from writable confirmation fields. Assign persistence and fixture coverage to T01/T02/T05.

**Test assertion:** Confirm a corrected OCR candidate, reload the immutable spec, and recover both raw candidate and confirmed value with document/page/span/hash and correction reason. Missing required provenance or forged confirming actor/workspace rejects; a later version leaves the first intact.

### P2 — Common reload response cannot represent human adjudication history

**Evidence:** Plan line 40 exposes adjudication POST with outcome/reference IDs; design lines 103 and 145 require separate append-only human adjudications and immutable model decisions. But QCResult at design line 188 returns only sample/evidence/decision/history of Decision/revision. DecisionStatus cannot represent CONFORMING/NONCONFORMING/UNDETERMINED. No adjudication GET or response schema is specified. Existing native `yarnflow/ios/Yarnflow/Workflows.swift:76–78` is a v1-only result reader and supplies no existing v2 adjudication retrieval behavior.

**Correction:** Define Adjudication and its immutable actor/time/reason/reference linkage, and return adjudications from authenticated reload or a specified history endpoint. Keep automated Decision history separate; define whether current human disposition is derived from latest adjudication and how corrections supersede it.

**Test assertion:** Append UNDETERMINED then CONFORMING under successive revisions; a fresh client reloads both with references and actor/time, preserves the original automated decision unchanged, and a stale adjudication request returns409 without another event.

## Authority and proof boundaries

These are proposed contract/task gaps, not claims of shipped v2 vulnerabilities. G1–G8 remain explicit external gates: documentation, schema tests and an admin role cannot authorize physical calibration, independent statistical release, consent/rights, AITEX policy, factory sampling or deployment spending. Fixing the above can support a review-only implementation; it cannot justify automatic ACCEPT/HOLD. No product files changed and no jobs, installation or purchase performed; verification was direct source tracing only.
