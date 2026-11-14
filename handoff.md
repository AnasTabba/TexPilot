# Incoming-fabric QC build: handoff

Updated 14 Nov 2026, ~18:30 PKT. Everything is on `main` (the `feat/incoming-fabric-qc` branch was
merged and deleted on 14 Nov). **Review-only system; not approved for automatic decisions.**

Requirements: [design](scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md),
[plan](scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md). Wire decisions:
[contract-decisions](scanner/research/qc/contract-decisions.md). Agents and limits:
[agent ledger](scanner/research/qc/agent-ledger.md). Reviews:
[R02 tenant](scanner/research/qc/R02-tenant-review.md),
[R03 unaudited files](scanner/research/qc/R03-unaudited-files-review.md).

## State in one paragraph

The review-only path works end to end in software: an operator picks a PO specification, creates
a sample, uploads originals, closes the set and analyses; the Yarnflow Worker calls the scanner
process, stores a non-automatic decision with its evidence, and the web and iOS clients render it.
Nothing can produce an automatic ACCEPT or HOLD today because no release, model bundle, fault
checkpoint, calibration profile or domain manifest exists. The seven findings of independent
review R01 against the automatic path are fixed with failing-first tests, and the tenant review
R02 found no cross-workspace, role or session break. Automatic mode still must not be enabled:
the external gates below are open and R01's attacks have not been rerun by an independent
reviewer after the fixes.

## Test results (lead's own runs, 14 Nov, after the last commit)

| Command | Result |
|---|---|
| `cd scanner && ../.venv/bin/python -m pytest tests/test_qc_*.py` | 857 passed, 2 skipped, 0 failed. Skips need a real fault checkpoint / bundle (G6, G8) |
| `cd scanner && ../.venv/bin/ruff check services training/qc scripts/qc_*.py tests/test_qc_*.py` | clean |
| `cd yarnflow && npm test` | 961 passed, 0 failed, 0 todo |
| `cd yarnflow && npm run typecheck` / `npm run build` | clean / succeeds |
| `CI=1 npx playwright test e2e/incoming-qc.spec.ts --project=desktop-chromium --retries=0` | 7 passed |
| `swiftc -typecheck yarnflow/ios/Yarnflow/QCTypes.swift` | clean |

Not rerun on 14 Nov: `xcodebuild test` (this machine has no Xcode; the 13 Nov result of 14 unit
and 2 UI tests predates the Swift `DomainManifest` change), the full scanner suite outside
`test_qc_*` (42 failures and 7 collection errors on 13 Nov, all from missing torch/scipy/joblib).
Never run: a real Cloudflare D1 migration, a physical iPhone, `scripts/qc_benchmark.py`.
**GitHub Actions does not start:** every run ends with "The job was not started because your
account is locked due to a billing issue."

## What changed on 14 Nov

| Item | Change |
|---|---|
| R01-1 | `checkCandidate` refuses an automatic draft unless all five stages are OK with no reasons |
| R01-2 | Every nested capture id / hash in evidence must be a signed original |
| R01-3 | `finalizeQC` takes a clock function and re-reads it after every await. Residual: the batch's own duration |
| R01-4 | A new capture set clears `current_decision_id`; history keeps the old decision |
| R01-5 | Policy distrusts a defect aggregate that is not the largest view score |
| R01-6 | `DomainManifest` gains `fabric_artifact_sha256` and `defect_artifact_sha256` (schema, Pydantic, JS, Swift, fixtures); policy checks them. The fabric stage hash no longer contains per-capture data |
| R01-7 | Reasons on an OK stage block automation like any other reason |
| R02-02 | Independent-signatory check compares NFKC, space- and format-stripped identities (Worker and Python) |
| Sampling plans | Plan-bound and CONFIRMATORY/CHALLENGE selections need a `qc_sampling_plans` row listing roll and face (migration `0034`). Plans are inserted by SQL; no registration route yet |
| Fixtures | Invalid examples for `AcquisitionAttestation`, `AnalysisCandidate`, `DensitySpec`, `ScaleReference`; 53 valid / 107 invalid |
| Offline sign-out | A sign-out that could not reach the server is finished on the next start before any workspace request |
| Split audit | Roll, lot, parent and selection identifiers grouped case- and padding-insensitively |

## Known gaps

- **R02-01, left open on purpose:** a PIN lockout does not end an already-open session
  (`inventory.mjs:294`, `qc-store.mjs:127`). Ending sessions on failed PIN attempts would let
  anyone sign a user out by guessing PINs, and the check lives in shared ERP session code.
- R01's attacks were not rerun by an independent reviewer after the fixes; the proof is the new
  tests in `yarnflow/tests/qc-r01.test.mjs` and `scanner/tests/test_qc_policy.py`.
- R03 was run by a small free model and is weak (see the lead's note at its top):
  `qc_metrology.py`, `qc_quality.py` and the `training/qc` tooling still lack a rigorous
  independent audit. The iOS sources and research documents are unaudited.
- Migration `0034` and `0033` have never run on real D1.
- Recall notices are written to an outbox that nothing drains. Suspension is release-wide.
- Stored capture width/height are the encoded values; the scanner is sent EXIF-upright ones.
- The scanner keeps no assertion replay cache (the Worker's request fencing prevents a second commit).
- Urdu text (web and iOS) has had no fluent review. No VoiceOver or real-device evidence.
- `npm ci` reported two dependency advisories (one high, one critical) on 13 Nov; not updated.
- Rollback/restore after QC writes has no tested operational procedure.
- The plan's checkboxes are not ticked and `requirements-proof.md` records no results; this
  handoff is the status of record.

## Task-by-task

| Task | State |
|---|---|
| T01 contract, fixtures | Done; four decoders agree on 53 valid / 107 invalid fixtures |
| T02 storage, migration | Built, tested locally, R01 findings fixed; no real D1 run |
| T03 policy | Built, 100+ tests, R01 findings fixed |
| T04a quality, metrology | Built, tests pass, no rigorous audit. T04b physical validation not done (G3) |
| T05 sample API | Built, integration-proven in review-only mode; sampling-plan gap closed |
| T06 scanner service | Built; benchmark never run; real fault loader absent (G6) |
| T07 web | Built; Playwright 7/7 and axe run by the lead |
| T08 iOS | Compiled and passed simulator tests on 13 Nov; not rerun after the contract change; nothing on a device (G8) |
| T09, T10 tooling | Built, tests pass; no real data or bundle |
| T11 release gate | Built; exact bound recomputed by the lead and correct |
| T12 ops | Monitoring, recalls, parity test, runbook, CI file present; CI blocked by GitHub billing |
| T13 | Protocol documents only; no study, no final report |

## Next steps, in order

1. Unlock GitHub billing and see CI run.
2. Rerun `xcodebuild test` on a machine with Xcode.
3. Independent rerun of R01's attacks and a rigorous audit of metrology/quality/training tooling.
4. Run migrations `0033` and `0034` against a staging D1.
5. External gates G1 to G8; nothing automatic before them.

## Agents and limits (14 Nov session)

Claude acted as lead only (briefs, audits, test reruns, commits). Workers were free OpenCode
models run as `opencode run --standalone --auto -m <model> "<brief>" < /dev/null`.
`deepseek-v4.1-flash-free` finished four briefs and reached its free limit during the fifth and
sixth; `glm-5.3-flash-free` and `minimax-m3.1-flash-free` were already at their limit;
`longcat-2.5-free` did the offline sign-out fix; `nemotron-3.5-lightning-free` did R03. The lead
finished three small pieces directly: the Python signatory validator with fixture regeneration,
the adjudication-guard revert, and the split-audit identifier fix.

## External gates (unchanged; none approved by code)

G1 factory access and independent sampling; G2 tolerances, risk target, HOLD criterion;
G3 physical calibration and pick-glass reference; G4 rights, consent, retention;
G5 **AITEX defective image with an entirely empty mask: still an open policy decision**, kept
image-level defective and pixel-ineligible, never relabelled or dropped; G6 completed fault
artifacts and hardware proof; G7 independent sample size and statistics; G8 security,
deployment budget, recovery, signing and device access.

## Not touched

Kaggle jobs (nothing started, cancelled or queried). No production migration, deploy, publish,
purchase or external message.
