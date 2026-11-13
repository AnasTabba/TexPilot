# Incoming-fabric QC build: handoff

Written 13 Nov 2026, ~22:40 PKT. Branch `feat/incoming-fabric-qc` (cut from `main` at
`471b151`). This is **work in progress, not a finished or reviewed system**. Roughly half the
software work is left (an estimate from file inventory and test runs, not a measurement).

Requirements: [design](scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md),
[plan](scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md). Lead decisions that
fix the wire shape: [contract-decisions](scanner/research/qc/contract-decisions.md). Who did
what and which limits were hit: [agent ledger](scanner/research/qc/agent-ledger.md).

## Follow-up verification (14 Nov 2026)

Continuation is on the pushed feature branch. The lead reproduced the focused QC suites and
closed one tenant privacy defect: upload now returns the same 404 for a nonexistent consent
identifier and one belonging to another workspace. This prevents identifier existence disclosure.

Verified in this continuation:

| Command | Result |
|---|---|
| `cd yarnflow && node --test tests/qc-faults.test.mjs` | 29 passed, 0 failed |
| `cd scanner && python3 -m pytest tests/test_qc_*.py -q` | 822 passed, 2 skipped |
| `git diff --check` | clean |

The two skips remain real-checkpoint/release artifact gates. No end-to-end Worker-to-scanner
subprocess test was run, and the larger app, browser and iOS checks have not been rerun in this
continuation. One local read-only scanner API/pipeline audit found no concrete fail-open, auth,
tenant or contract finding. A separate storage/migration audit is pending; this is not independent
integrated QA. This follow-up does not change the review-only release state.

Follow-up storage audit identified three issues. The cross-workspace supplier join is now fixed
and covered by a regression test: `cd yarnflow && node --test tests/qc-store.test.mjs` passed
(18/18 at the time of that run). Request expiry/failure transitions were then hardened to require
the initiating live session and current generation/lease (deadline expiration remains fenced by
generation); new revoked-session regression and deadline race pass. The combined focused command
`cd yarnflow && node --test tests/qc-store.test.mjs tests/qc-faults.test.mjs` passed 48/48.
Rollback/restore after QC writes still lacks an operational tested procedure. Consent privacy fix
was pushed as `ae54356`, supplier-join fix as `fb6e918`; request-state fix is prepared as the next
scoped commit.

The configured Kaggle CLI on the original machine reported MVTec and WFDD jobs COMPLETE and
AITEX preflight ERROR; no jobs were started, cancelled, overwritten or duplicated. Local model
inventory still lacks the QC fault checkpoint; datasets/artifacts and rights evidence remain
unavailable or insufficient for release. This differs from the earlier handoff's statement that
Kaggle CLI/credentials were absent and should be interpreted as a later environment check, not
proof of usable data or release readiness.

## State in one paragraph

The system is built to run in **REVIEW_ONLY** mode and nothing in it can produce an automatic
ACCEPT or HOLD today: there is no trained model bundle, fault checkpoint, calibration profile,
domain manifest, release, dataset, signing identity or Kaggle access on the build machine.
Most pieces are written and have passing tests of their own, but they were written by separate
agents that were cut off mid-task by usage limits, most of that code has **not been read by an
auditor**, and the pieces have **never run together** (no Worker-to-scanner integration test
exists yet). The plan's 65 checkboxes have **not** been ticked.

## Test results (lead's own runs, 13 Nov, this machine)

| Command | Result |
|---|---|
| `cd scanner && ../.venv/bin/python -m pytest tests/test_qc_*.py` | 822 passed, 2 skipped, 0 failed. Skips: real fault checkpoint (G6), real bundle parity (G6/G8) |
| `cd scanner && ../.venv/bin/python -m pytest --continue-on-collection-errors` | 1231 passed, 42 failed, 7 collection errors, 35 skipped. The 42 + 7 are the **pre-existing baseline** (same files as before this work: `test_threads`, `test_marker`, `test_scanner_fault`, `test_fault_*`, `test_ocr_paddle_protocol`, others needing torch/scipy/joblib, which are not installed) |
| `cd scanner && ../.venv/bin/ruff check .` | 8 errors, all pre-existing (`docs/scripts/make_hitl_figures.py`, `tests/test_fault_inpformer.py`); QC files clean |
| `cd yarnflow && npm test` | 879 passed, 0 failed (baseline before this work: 476 passed) |
| `cd yarnflow && npm run typecheck` / `npm run build` | clean / succeeds |
| `xcodebuild build … -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO` | BUILD SUCCEEDED |
| `xcodebuild test … -destination 'platform=iOS Simulator,name=iPhone 17'` | **TEST FAILED** (see iOS below). iPhone 16 named in the plan is not installed |
| `CI=1 npx playwright test e2e/incoming-qc.spec.ts --project=desktop-chromium` | **1 passed, 5 failed** (reported by agent D02; not rerun by the lead) |

Not run at all: Worker-to-scanner integration, GitHub Actions, any real D1/Wrangler migration,
any physical phone, `scripts/qc_benchmark.py`.

## Task-by-task

| Task | State | What exists | What is missing or wrong |
|---|---|---|---|
| T01 contract | Done, tested | `scanner/services/api/qc_schemas.py`, generated `scanner/contracts/qc-v2.schema.json`, shared fixtures `scanner/tests/fixtures/qc-v2/` (53 valid, 96 invalid, 6 hash vectors), JS mirror `yarnflow/server/qc-contract.mjs`, TS `src/qc-types.ts`, Swift `QCTypes.swift` | Swift fixture parity not proven (iOS tests failing). Fixture `layer` labels (schema vs semantic) were assigned by hand and never cross-checked |
| T02 storage | Written, thinly tested, **not audited** | `yarnflow/drizzle/0033_incoming_fabric_qc.sql`, `server/qc-store.mjs` (762 lines), `qc-retention.mjs`, blob claims | Tests are small (17 to 127 lines per file). Not yet proven: concurrent finalisation, rollback on audit failure, each precondition lost mid-inference, interrupted/replayed migration, retention restore drill. No real D1 run |
| T03 policy | Done, tested | `scanner/services/consistency/qc_policy.py`, 90 table tests | Tests were written just after the code, not before. No field for an authority's HOLD criterion, so that gate lives only in the T11 tooling |
| T04a quality/metrology | Written, tests pass, **not audited** | `scanner/services/vision/qc_{imageio,quality,metrology}.py`, image fixtures | T04b physical validation not done (G3). `research/qc/metrology-protocol.md` not verified |
| T05 sample API | Partial, **not audited** | `yarnflow/server/qc.mjs` (272 lines), `qc-service-auth.mjs`, routing in `inventory.mjs` | **Known defect:** upload with a consent id that exists nowhere answers 403, one in another workspace answers 404, so the two are distinguishable; both should be 404. `tests/qc-service-integration.test.mjs` does not exist. Whether every row of the API table is implemented is unverified |
| T06 scanner service | Written, tests pass, **not audited** | `scanner/services/api/qc.py`, `qc_pipeline.py`, `qc_service_auth.py`, `scripts/qc_benchmark.py` | Benchmark never run. Real fault loader not implemented (`fault.py` still raises NotImplementedError; G6) |
| T07 web | Screen written and reachable, **not proven in a browser** | `yarnflow/src/IncomingFabricQC.tsx`, `qc-client.ts`, `qc-drafts.ts`, `qc-reasons.ts`, nav section for all six roles, service-worker allowlist | e2e 1/6 passing. Reported, unverified bug: after a PO/spec change the screen may treat later actions as stale (`sessionGeneration` effect). Urdu text is unreviewed. No axe result |
| T08 iOS | Compiles, **tests fail** | `QCTypes/QCClient/QCCapture/QCWorkflow.swift`, `Localizable.xcstrings`, `Yarnflow.xcodeproj` with three targets | Unit tests: fatal nil-unwrap at `YarnflowTests/QCContractTests.swift:117`, file-protection assertion at line 59. Both UI tests in `QCWorkflowTests.swift` fail. No signing, no device, no VoiceOver evidence |
| T09 data/rights | Written, tests pass, **not audited** | `scanner/training/qc/{manifest,split_audit,references,enrollment,export_guard}.py` | Documents `data-register.md`, `sampling-sop.md`, `enrollment-feasibility.md` not verified to exist or to be free of invented content |
| T10 evaluation | Written, tests pass, **not audited** | `training/qc/{train_manifest,evaluate,ablations}.py`, `scripts/qc_ddp_proof.py` | No real bundle or data; `ddp-proof-manifest.json` and `experiment-register.md` not verified |
| T11 release gate | Written, tests pass, **not audited** | `training/qc/{calibrate,release_gate,workflow_metrics}.py` | Exact-bound arithmetic not independently re-derived by the lead |
| T12 ops | Partial | `yarnflow/server/qc-{monitoring,recalls}.mjs` (13 tests, audited), `scanner/tests/test_qc_parity.py`, `research/qc/operations-runbook.md` | Recall outbox is written but never drained. Suspension is release-wide, not per domain. `tests/qc-faults.test.mjs` exists but injected-fault coverage is unverified. **CI not updated** (`.github/workflows/ci.yml` still scanner-only) |
| T13 study/archive | Documents only | `research/qc/{study-protocol,requirements-proof}.md` | `requirements-proof.md` lists several files as "not present yet" that now exist; refresh it. No `final-report.md` |

## Agents and limits (details in the ledger)

- Claude subagents: stopped twice by the 5-hour usage limit, then not used (owner's instruction).
- Codex (`gpt-6.1-sol`): ten workers; one finished, nine cut off by the ChatGPT usage limit
  after ~15 minutes (resets 14 Nov 00:24 PKT). None of the nine wrote a final report.
- OpenCode: paid models (including every Gemini and the stronger DeepSeek models) refuse with
  "Insufficient balance". `deepseek-v4.1-flash-free` finished three tasks, then four more were
  cut off by "Free usage limit reached" with no file changed.
- Gemini CLI: not installed. **No Gemini agent ran.**
- No independent QA review of the implementation has happened. The plan's "20 reviews" were of
  the documents.

## Next steps, in order

1. Fix the consent-id 403/404 leak in `yarnflow/server/qc.mjs` and the assertion near line 133
   of `tests/qc-faults.test.mjs`.
2. Write `yarnflow/tests/qc-service-integration.test.mjs` (real Worker against the real scanner
   subprocess). Expect contract mismatches here: the two sides have never talked.
3. Deepen T02 storage tests (brief ready: concurrency, rollback, lost preconditions, migration
   replay, retention).
4. Repair iOS tests; repair the e2e spec and the `sessionGeneration` bug; run axe.
5. Read the unaudited code for false-ACCEPT paths, tenant boundaries and auth, in this order:
   `qc.mjs`, `qc-store.mjs`, `qc_pipeline.py`, `qc.py`, `qc_metrology.py`, `release_gate.py`.
6. Add the Yarnflow and integration jobs to CI. Check whether the existing scanner CI job can
   import the QC tests (they need numpy, cv2, Pillow, which are not in the `dev` extras).
7. Independent QA pass, then tick plan checkboxes with evidence and write the evidence report.

Ready-to-use task briefs for steps 1 to 6 were written during the session but live outside the
repository; they are reproduced in the ledger's task descriptions only in summary.

## External gates (unchanged; none approved by code)

G1 factory access and independent sampling; G2 tolerances, risk target, HOLD criterion;
G3 physical calibration and pick-glass reference; G4 rights, consent, retention;
G5 **AITEX defective image with an entirely empty mask: still an open policy decision**, kept
image-level defective and pixel-ineligible, never relabelled or dropped; G6 completed fault
artifacts and real hardware proof; G7 independent sample size and statistics; G8 security,
deployment budget, recovery, signing and device access. Until these exist the system stays
REVIEW_ONLY.

## Not touched

- Kaggle MVTec/WFDD jobs: status could not be checked (no CLI, no credentials). Nothing was
  started, cancelled or queried.
- No production migration, deploy, publish, purchase or external message.
- Existing v1 scanner routes and existing Yarnflow stock, claims and receipt flows: intended to
  be unchanged; `npm test` (all pre-existing tests) passes, but this was not separately audited.
- Left out of this branch on purpose: untracked `app/`, `site-publish/`, `yarn-erp/` (build
  leftovers from older branches) and `project details.md`.
