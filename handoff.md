# Incoming-fabric QC build: handoff

Updated 14 Nov 2026, ~15:00 PKT. Branch `feat/incoming-fabric-qc`. **Work in progress, not a
finished or approved system.** Work was stopped on the owner's instruction with one review
unfinished and one review's findings unfixed.

Requirements: [design](scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md),
[plan](scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md). Wire decisions:
[contract-decisions](scanner/research/qc/contract-decisions.md). Every agent, what it owned and
which limit it hit: [agent ledger](scanner/research/qc/agent-ledger.md).

## State in one paragraph

The review-only path works end to end in software: an operator can pick a PO specification,
create a sample, upload originals, close the set and analyse; the Yarnflow Worker calls the
real scanner process, stores a non-automatic decision with its evidence, and the web and iOS
clients render it. Nothing can produce an automatic ACCEPT or HOLD **today** because no
release, model bundle, fault checkpoint, calibration profile or domain manifest exists.
**However, an independent reviewer showed that the automatic path is not yet safe** (seven
findings below): if a release were ever activated, wrong automatic decisions could be stored.
Do not enable automatic mode until those are fixed and re-reviewed. The plan's 65 checkboxes
have not been ticked.

## Test results (lead's own runs on 14 Nov unless marked)

| Command | Result |
|---|---|
| `cd scanner && ../.venv/bin/python -m pytest tests/test_qc_*.py` | 822 passed, 2 skipped, 0 failed. Skips need a real fault checkpoint / bundle (G6, G8) |
| `cd scanner && ../.venv/bin/ruff check services training/qc scripts/qc_*.py tests/test_qc_*.py` | clean |
| `cd scanner && ../.venv/bin/python -m pytest --continue-on-collection-errors` (13 Nov) | 42 failed + 7 collection errors, all **pre-existing** (torch/scipy/joblib not installed); `ruff check .` has 8 pre-existing errors. The scanner CI job on `main` is red for these reasons, independent of this work |
| `cd yarnflow && npm test` | 930 passed, 0 failed, 1 todo (baseline before this work: 476). The todo is the sampling-plan gap below |
| `cd yarnflow && npm run typecheck` / `npm run build` | clean / succeeds |
| `cd yarnflow && node --test tests/qc-service-integration.test.mjs` | 8/8, real scanner subprocess |
| `xcodebuild test … -destination 'platform=iOS Simulator,name=iPhone 17'` | TEST SUCCEEDED: 14 unit (1 skipped: needs a physical device), 2 UI. iPhone 16 named in the plan is not installed |
| `xcodebuild build … 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO` (13 Nov) | BUILD SUCCEEDED |
| `CI=1 npx playwright test e2e/incoming-qc.spec.ts --project=desktop-chromium` | **Agent-reported** 6 passed, axe zero serious/critical. Not rerun by the lead |

Never run: GitHub Actions, a real Cloudflare D1 migration, a physical iPhone, `scripts/qc_benchmark.py`.

## Open findings from independent review R01 (reported as P0; not fixed, reproductions not rerun by the lead)

All need an ACTIVE release to matter, and several need a wrong or hostile scanner response.
They are still required fixes: the Worker and policy are supposed to fail closed on their own.

1. **Worker clamp does not require five OK stages.** `yarnflow/server/qc-store.mjs:557` via
   `qc.mjs:170`: with an active release, a correctly bound ACCEPT draft whose stages are
   ABSTAINED/DISABLED is persisted. An existing API test passes while doing exactly this.
2. **Nested evidence hashes are not checked.** `qc-store.mjs:553`: measurement and defect-view
   `capture_sha256` values are never compared with the signed originals.
3. **Commit-time checks use a timestamp taken before the batch.** `qc-store.mjs:568-586`:
   a release or request deadline that passes during the batch still commits.
4. **An old decision stays current after new captures start.** `qc-store.mjs:262`,
   `IncomingFabricQC.tsx:113`: creating a new capture set keeps `current_decision_id`, and the
   reloaded screen shows the old decision.
5. **Aggregate defect score is trusted.** `qc_policy.py:172`: score 0.0 with a view scoring
   1.0 is accepted; the policy does not check score = max of views.
6. **Fabric and defect artifact hashes are not checked against the release.**
   `qc_policy.py:152,168`. (The lead knew of this gap: the release carries one bundle hash and
   no per-stage artifact list. It needs a contract change.)
7. **Blocking reasons on an OK stage are ignored.** `qc_policy.py:126`: a domain stage with
   state OK and reason OOD still accepts.

R01 also reported what held: ACCEPT without a release, changed spec/policy/release/capture
hashes, attempt, revision, request id, generation or deadline, client-supplied
automatic/status/workspace fields, replay, suspension or expiry before the batch, superseded
spec, attempt reset via linked samples, and v1 PASS as a v2 status were all rejected.

## Other known gaps

- **Tenant/role/session review (R02) was stopped before it reported.** No independent review of
  tenant isolation exists.
- Sampling selections naming an unregistered plan, roll or face are accepted (the one `todo`
  test). Intended fix: refuse CONFIRMATORY/CHALLENGE selections unless the plan is on a
  server-side registered list.
- Shared fixtures have no invalid examples for `AcquisitionAttestation`, `AnalysisCandidate`,
  `DensitySpec`, `ScaleReference`. Fixture `layer` labels were never cross-checked.
- Recall notices are written to an outbox that nothing drains. Suspension is release-wide.
- Stored capture width/height are the encoded values; the scanner is sent EXIF-upright ones.
- Reported by D05: reloading after an **offline** sign-out can restore the still-valid server
  session (`LiveApp.tsx`).
- The scanner keeps no assertion replay cache (same signed request can be re-sent within 30 s;
  the Worker's request fencing prevents a second commit).
- Not read by an independent auditor: `qc_metrology.py`, `qc_quality.py`, the T09/T10 tooling
  under `scanner/training/qc/`, D06's storage tests, the iOS sources, the research documents.
- Urdu text (web and iOS) has had no fluent review. No VoiceOver or real-device evidence.
- T03 policy tests were written just after the code, not before.

## Task-by-task

| Task | State |
|---|---|
| T01 contract, fixtures | Done; Python, JS, TS and Swift decode the same 53 valid / 96 invalid fixtures. Needs change for finding 6 and the fixture gaps |
| T02 storage, migration | Built, deeply tested locally; findings 1 to 4 open; no real D1 run |
| T03 policy | Built, 90 tests; findings 5 to 7 open |
| T04a quality, metrology | Built, tests pass, unaudited. T04b physical validation not done (G3) |
| T05 sample API | Built, integration-proven in review-only mode; sampling-plan gap open |
| T06 scanner service | Built; read in full by the lead, no blocking defect; benchmark never run; real fault loader absent (G6) |
| T07 web | Built, reachable for six roles, builds; e2e and axe agent-reported only |
| T08 iOS | Compiles, simulator tests pass; nothing on a device (G8) |
| T09, T10 tooling | Built, tests pass, unaudited; no real data or bundle |
| T11 release gate | Built; exact bound independently recomputed by the lead and correct |
| T12 ops | Monitoring, recalls, parity test, runbook, CI changes present; CI never run on GitHub |
| T13 | Protocol documents only; `requirements-proof.md` is stale; no final report |

## Next steps, in order

1. Fix R01 findings 1 to 5 and 7 with a failing test first for each; decide the contract
   change for 6 (per-stage artifact hashes in the release or domain manifest).
2. Rerun R01's attacks, then run the tenant/role/session review (R02 brief exists) and fix.
3. Close the sampling-plan gap and the fixture gaps.
4. Rerun Playwright and axe yourself; fix the offline sign-out reload issue.
5. Independent read of the unaudited files listed above.
6. Tick plan checkboxes with evidence, refresh `requirements-proof.md`, write the evidence report.
7. Open a pull request and see CI run for real.

## Agents and limits

Claude subagents stopped by usage limits and not reused. Codex did most of the work in two
sessions (limit hit on 13 Nov after ten parallel workers; three at a time on 14 Nov did not hit
it). OpenCode: only free models worked (`deepseek-v4.1-flash-free` finished three tasks before
its free limit); paid models and every Gemini model refused for insufficient balance. Gemini
CLI not installed: **no Gemini agent ran**. One independent implementation review completed
(R01); the plan's "20 reviews" were of the documents.

## External gates (unchanged; none approved by code)

G1 factory access and independent sampling; G2 tolerances, risk target, HOLD criterion;
G3 physical calibration and pick-glass reference; G4 rights, consent, retention;
G5 **AITEX defective image with an entirely empty mask: still an open policy decision**, kept
image-level defective and pixel-ineligible, never relabelled or dropped; G6 completed fault
artifacts and hardware proof; G7 independent sample size and statistics; G8 security,
deployment budget, recovery, signing and device access.

## Not touched

Kaggle MVTec/WFDD jobs (no CLI or credentials; nothing started, cancelled or queried). No
production migration, deploy, publish, purchase or external message. Untracked `app/`,
`site-publish/`, `yarn-erp/` and `project details.md` are deliberately not in this branch.
