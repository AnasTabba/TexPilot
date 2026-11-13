# Reviewer 17 — QA, integration and fault injection

Recommendation: **revise before implementation**. No P0 found. The findings concern proposed contracts and acceptance proof; they do not assert that unimplemented v2 behavior is already shipped. No product files changed, dependency installs, training, deployment or purchases performed.

## Findings

### P1 — Capture-set closure has no executable request contract

**Evidence:** Design `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md:188` says attempts count submitted capture sets, with atomic set closure. Plan `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md`, Endpoint map, instead says POST `/samples/:id/captures` uploads a bounded original and allocates an attempt; analyze takes ordered capture IDs. Neither specifies a set identifier, closure request/flag, expected revision for upload, nor how partial overview/structure/scale uploads become one submitted set. Actual reusable upload code `yarnflow/server/photos.mjs:16-26` handles one file and returns its digest, with no set lifecycle. This matters because the third attempt escalates to MANUAL_REVIEW: a faithful endpoint implementation can spend three attempts on the three required views, while a different implementation spends one.

**Correction:** T01/T02/T05 must define one authoritative submission operation: upload individual immutable captures without allocating attempts, then atomically seal an explicitly enumerated set (analyze may own sealing). Specify expected revision, set identity/hash, roles, partial-set handling and idempotency identity. State exactly which operation increments attempt and revision; update endpoint text to agree with §14.

**Test assertion:** Upload three views in arbitrary order, fail/retry the second upload, restart client and seal once: attempt=1, with the documented revision increments. Two concurrent seals of the same set return the same submission; changed membership under the same key gives409; a missing required view never produces a complete set or automatic status. A genuine second/third set increments attempt once each, independent of file count.

### P1 — Timeout guarantee lacks a commit boundary and restartable request state

**Evidence:** Plan Endpoint map promises a 60s analyze deadline and “no durable decision on timeout”; design §9 (`...design.md:145`) also promises observable request state/retryable job with the same ID. Its proposed tables list idempotency and decision events, but no defined in-progress request state, lease, fencing token or request-status contract. Existing `yarnflow/server/scanner-proxy.mjs:13-24` forwards without a deadline or cancellation signal, and `scanner/services/api/main.py:82-95` executes synchronous inference inside an async route. These existing mechanisms do not establish cancellation or prevent late completion. A timeout racing finalization, or a lost response after commit, cannot safely be treated as proof of no durable decision.

**Correction:** Specify the linearization point. Before commit, an expired/cancelled request must be fenced from finalization by durable deadline/state checks; after commit, transport failure means outcome unknown and retry/reload resolves the committed idempotent result. Define minimal durable in-progress/completed/expired request state in `qc_idempotency` (no queue required), ownership/recovery after process death and how clients distinguish inference deadline from response loss. Do not promise rollback of a committed decision merely because delivery timed out.

**Test assertion:** Pause inference past60s then release it: no late decision/event write. Crash before inference return and retry same key: no permanent in-progress lock. Commit successfully, drop response, retry/reload: exactly one decision/event and original ID/revision. Race deadline with finalization under controlled clock/barriers and assert exactly one documented outcome, never timeout followed by an untracked ACCEPT. Run through Worker→private FastAPI, not only mocked fetch.

### P2 — Existing upload fixture cannot prove the planned image/decode integration

**Evidence:** T05/T06 require real Worker→FastAPI integration and bounded decode; T12 requires corrupt/oversize-image injection. Actual common fixture `yarnflow/tests/portal-fixture.mjs:11-12` deliberately supplies only14 JPEG-shaped bytes, not a decodable image; its bucket is a process-local Map (`:23-28`). `yarnflow/server/photos.mjs:20-26` and `scanner/services/api/uploads.py:25-44` check signatures, not successful decode. Reusing the established ERP fixture for a nominal “valid upload” and stubbing evidence can pass routing/persistence tests while never exercising real decoder dimensions, orientation, checksums or physical ROI bindings. The plan does not name the required real-image fixture corpus or separate its success path from this sentinel.

**Correction:** Add explicit T05/T06 fixture ownership: tiny genuinely decodable JPEG/PNG/WebP with pinned original hashes, an EXIF-rotated image, signature-valid truncated image, and a small compressed file whose declared pixel dimensions exceed the bound. Keep the14-byte sentinel as a negative case. Require at least one actual Python decode/evidence path through the authenticated Worker adapter and persisted original bytes; no trained artifact is needed to prove decoding, and missing models must remain unavailable.

**Test assertion:** The14-byte sentinel fails decode with sanitized422 and creates no decision; real fixtures preserve original hash/dimensions and apply orientation consistently to ROIs/overlays. Oversize pixels return413 before model invocation; malformed files never become stage OK or count as clean fabric. Bucket readback checksum equals uploaded original, with injected missing/corrupt readback blocking finalization.

## Inspected paths and proof limits

Read both complete draft documents, with targeted line inspection of contracts, endpoints and integrated amendments. Inspected actual source: `scanner/services/api/{main,uploads}.py`, `scanner/deployment/modal_scanner.py`; `yarnflow/server/{sqlite,d1-bucket,scanner-proxy,photos,cloudflare}.mjs`; `yarnflow/tests/{portal-fixture,quality,migrations}.mjs`; `yarnflow/package.json`, `yarnflow/public/sw.js`, `yarnflow/scripts/prepare-offline.mjs`, `yarnflow/ios/scripts/build.sh`, iOS file inventory, and `.github/workflows/ci.yml`. Existing test inventory was searched; review assertions above are proposed proof, not executed v2 tests. Existing migration tests use local SQLite, and actual D1/R2 recovery remains a separate integration gate rather than inferred parity.

## External authority gates

G1–G8 remain necessary and are not satisfied by any synthetic or integration test in this review. Factory risk/tolerance approval, physical metrology validation, rights/consent, independent release statistics and recovery/budget signoff remain external evidence. The three corrections can be specified and locally tested without authorizing collection, GPU jobs or automation; retain REVIEW_ONLY until the separately documented gates pass.
