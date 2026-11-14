# Incoming-fabric QC build: agent ledger

Lead integrator: Claude Code (session of 13 Nov 2026). Rows are only agents that were actually
started. "Limit / failure" is what was observed, not an estimate. Nothing below is an
implementation review until the QA rows say so.

## Follow-up agents (14 Nov 2026)

| Provider / model | Task / scope | Status and result | Limit |
|---|---|---|---|
| Local subagent `gpt-5.6-luna` | Read-only audit of scanner QC API and pipeline | Completed; no concrete fail-open, auth, tenant-isolation, or contract-risk finding in `scanner/services/api/qc.py` and `qc_pipeline.py` | No limit reported |
| Local subagent `gpt-5.6-terra` | Read-only audit of Worker storage and migration | Completed; found cross-tenant supplier-name disclosure at `qc-store.mjs:371`, unauthenticated/stale request state mutation in expiry/failure paths (`qc-store.mjs:192-207`), and no tested rollback/restore procedure after QC writes. Supplier join and request state transitions fixed; combined focused suite passes 48/48. Rollback/restore procedure remains unresolved. | No limit reported |
| OpenCode `opencode/deepseek-v4.1-flash-free` | Read-only handoff consistency audit after three follow-up commits | Running; bounded review requested, no repository edits | Current quota ceiling not exposed; prior handoff records free usage limit reached on earlier tasks |

Lead change: `yarnflow/server/qc.mjs` and `yarnflow/tests/qc-faults.test.mjs` unify missing and
foreign consent identifiers to 404. Focused proof: 29/29 Worker fault tests and 822 scanner QC
tests passed, with 2 artifact-gated skips. These agents did not independently review the integrated
change. Storage findings are actionable and not yet fixed; see latest handoff next steps.

## Provider availability (checked 13 Nov 2026)

| Provider | How checked | Result |
|---|---|---|
| Codex CLI 0.164.0 (`gpt-6.1-sol`, ChatGPT login) | `codex exec` smoke prompt | Available; repository access with `workspace-write` sandbox |
| OpenCode 2.2.1, paid models (GPT, Kimi, Gemini 3.8/4) | `opencode run -m …` smoke prompts | **Unavailable**: "Insufficient balance" on the OpenCode Console account |
| OpenCode `gemini-3.1-pro` | same | **Unavailable**: model deprecated |
| OpenCode free models (`big-pickle`, `beam-free`, `glm-5.3-flash-free`, `deepseek-v4.1-flash-free`) | same | Available; used for bounded read-only reviews only |
| Gemini CLI | `command -v gemini` | **Not installed**; no Gemini worker ran |
| Claude subagents (same model as lead) | Agent tool | Available but share the lead's usage limit; stopped on the user's instruction after two limit interruptions |
| Kaggle CLI / credentials | `command -v kaggle`, `~/.kaggle` | **Absent**: MVTec/WFDD job status could not be checked; no job was started, cancelled or queried |

## Agents

| # | Provider / model | Task | Owned files | Status | Limit / failure | Result | Integration disposition |
|---|---|---|---|---|---|---|---|
| L | Claude (lead) | T01 contract, fixtures, T03 policy, integration, audit | `scanner/services/api/qc_schemas.py`, `scanner/contracts/qc-v2.schema.json`, `scanner/tests/fixtures/qc-v2/`, `scanner/services/consistency/qc_policy.py`, `scanner/tests/test_qc_contracts.py`, `test_qc_policy.py`, `research/qc/contract-decisions.md`, this ledger | In progress | Hit the 5-hour usage limit twice | Contract + policy written; 286 tests in the two files pass | Kept |
| F1 | Claude fork | T04a/T06 scanner evidence | scanner vision/api QC files | Stopped | Usage limit twice; not resumed (user instruction) | Partial: `qc_imageio.py`, `qc_quality.py`, `qc_metrology.py`, two test files | Handed to C01/C02 to finish |
| F2 | Claude fork | T02/T05 Worker backend | yarnflow server QC files | Stopped | Usage limit twice | Partial: migration 0033, `qc-contract.mjs`, `qc-store.mjs` | Handed to C03/C04 |
| F3 | Claude fork | T07 web | yarnflow src QC files | Stopped | Usage limit twice | Partial: `qc-types.ts`, `qc-drafts.ts`, `qc-reasons.ts`, one test | Handed to C05 |
| F4 | Claude fork | T08 iOS | yarnflow/ios QC files | Stopped | Usage limit twice | Partial: `QCTypes.swift`, `QCClient.swift` | Handed to C06 |
| F5 | Claude fork | T09–T13 tooling | scanner/training/qc | Stopped | Usage limit twice | Partial: eleven modules, no tests | Handed to C07–C10 |
| C01 | Codex `gpt-6.1-sol` | T04a quality + metrology | `scanner/services/vision/qc_{imageio,quality,metrology}.py`, their tests, `tests/fixtures/qc-images/` | Interrupted | ChatGPT usage limit at ~21:48 PKT 13 Nov (resets 00:24 PKT 14 Nov); no final report | Files and tests on disk; lead rerun of its tests passes; not yet audited | Pending audit / resume |
| C02 | Codex | T06 private service, readiness, benchmark | `scanner/services/api/qc{,_pipeline,_service_auth}.py`, `main.py`/`config.py` edits, tests, `scripts/qc_benchmark.py` | Interrupted | same limit; no final report | Files on disk; tests pass on lead rerun; benchmark output not captured | Pending audit / resume |
| C03 | Codex | T02 storage + migration | `yarnflow/drizzle/0033…`, `server/qc-{store,contract,retention}.mjs`, tests | Interrupted | same limit; no final report | Files on disk; tests thin (17–127 lines) | Pending audit / resume |
| C04 | Codex | T05 sample API | `yarnflow/server/qc.mjs`, `qc-service-auth.mjs`, routing edits, tests | Interrupted | same limit; no final report | Partial; 1 failing test (foreign consent/release id returns 403, expected 404) | Resume required |
| C05 | Codex | T07 web workflow | `yarnflow/src/qc-*`, `IncomingFabricQC.tsx`, service worker, tests, e2e spec | Interrupted | same ChatGPT usage limit; no final report | Client, drafts, reasons, types, service worker and e2e spec on disk; `IncomingFabricQC.tsx` screen (45 KB) on disk; not yet wired-in check, built or audited | Resume / audit required |
| C06 | Codex | T08 iOS | `yarnflow/ios/**` | Interrupted | same limit; no final report | Swift files and a 70-line pbxproj on disk; no xcodebuild evidence | Resume required |
| C07 | Codex | T09 data/rights tooling | `scanner/training/qc/{manifest,split_audit,references,enrollment,export_guard}.py`, tests, docs | Interrupted | same limit; no final report | Tests on disk and passing on lead rerun; docs not verified | Pending audit |
| C08 | Codex | T10 evaluation/ablation/DDP proof | `scanner/training/qc/{train_manifest,evaluate,ablations}.py`, `scripts/qc_ddp_proof.py`, tests | Interrupted | same limit; no final report | Tests on disk and passing on lead rerun | Pending audit |
| C09 | Codex | T11 release gate | `scanner/training/qc/{calibrate,release_gate,workflow_metrics}.py`, tests | Interrupted | same limit; no final report | Tests on disk and passing on lead rerun | Pending audit |
| C10 | Codex | T12 parity test, T13 documents | `scanner/tests/test_qc_parity.py`, `research/qc/{operations-runbook,study-protocol,requirements-proof}.md` | **Completed** | none | 57 passed, 1 skipped (G6/G8) on lead rerun; documents scanned for invented approvals: none | Kept |
| D01 | OpenCode `deepseek-v4.1-flash-free` | Fix two failing Yarnflow tests | `yarnflow/server/qc.mjs`, `tests/migrations.test.mjs` | **Completed** | none | Foreign release/consent ids -> 404; migration test applies real order. Lead rerun: 43/43 in affected files | Kept. Open: nonexistent consent id still 403 (distinguishable from foreign 404) |
| D02 | OpenCode deepseek free | Connect web screen to navigation | `yarnflow/src/LiveApp.tsx`, `roles.ts` | **Completed** | none | Section added for six roles; draft purge on sign-out/401/cross-tab. Lead rerun: typecheck clean, 879/879, build ok | Kept after lead removed an unrequested admin "Inspections" entry |
| D03 | OpenCode deepseek free | Monitoring + recalls | `yarnflow/server/qc-{monitoring,recalls}.mjs`, tests, one line in `cloudflare.mjs` | **Completed** | none | 13/13 on lead rerun; no built-in thresholds; decisions never mutated | Kept. Open: outbox is not drained; suspension is release-wide |
| D04 | OpenCode deepseek free | Worker->scanner integration test, consent 404 unification | `yarnflow/tests/qc-service-integration.test.mjs`, `server/qc.mjs` | Interrupted | OpenCode "Free usage limit reached" ~22:20 PKT | Integration test file NOT created; no file changed | Not done |
| D05 | OpenCode deepseek free | Browser e2e + stale-session bug | `yarnflow/e2e/incoming-qc.spec.ts`, `src/IncomingFabricQC.tsx` | Interrupted | same limit | No file changed | Not done |
| D06 | OpenCode deepseek free | Deeper storage tests | `yarnflow/tests/qc-{store,migration,blob-claims,retention,contract}.test.mjs` | Interrupted | same limit | No file changed; storage tests remain thin | Not done |
| D08 | OpenCode deepseek free | CI jobs | `.github/workflows/ci.yml` | Interrupted | same limit | No file changed | Not done |
| X1 | (lead, local `xcodebuild`) | iOS build and simulator test run on iPhone 17 simulator (plan named iPhone 16; not installed) | — | Ran 22:20 PKT | — | Generic device build without signing: BUILD SUCCEEDED. Simulator tests: **TEST FAILED** - unit tests hit a fatal nil-unwrap at `QCContractTests.swift:117` and a file-protection assertion at line 59; both UI tests in `QCWorkflowTests.swift` fail | iOS needs repair |

## 14 Nov 2026 (Codex `gpt-6.1-sol` after its limit reset; lead audits)

| # | Provider / model | Task | Owned files | Status | Limit / failure | Result | Integration disposition |
|---|---|---|---|---|---|---|---|
| D04 | Codex | Worker-to-scanner integration test; consent-id 404 | `yarnflow/tests/qc-service-integration.test.mjs`, `server/qc.mjs` | **Completed** | none | 8/8 on lead rerun against the real scanner subprocess; found and fixed EXIF-upright dimension mismatch; missing and foreign consent ids both 404 | Kept; lead read the test and the diff |
| D06 | Codex | Deeper storage tests | `yarnflow/tests/qc-{store,migration,blob-claims,retention,contract}.test.mjs`, `server/qc-store.mjs`, migration 0033 | **Completed** | none | 245 pass, 1 todo on lead rerun; fixed expired requests left IN_PROGRESS and missing composite tenant key on idempotency actor | Kept; tests not yet read line by line by the lead |
| D05 | Codex (first run sandboxed, second without command sandbox) | Browser e2e + web screen fixes | `yarnflow/e2e/incoming-qc.spec.ts`, `src/IncomingFabricQC.tsx`, two test files | **Completed** | first run: Chromium cannot launch inside the Codex sandbox | Agent reports Playwright 6/6 and axe zero serious/critical; **not rerun by the lead** | Kept; lead reran typecheck, npm test, build only |
| D08 | Codex | CI jobs | `.github/workflows/ci.yml` | **Completed** | none | Yarnflow job added; reported provisioning gaps | Superseded by D10 |
| D10 | Codex | CI provisioning | `ci.yml`, `scanner/pyproject.toml` (`qc` extra), `Makefile`, interpreter line of the integration test | **Completed** | none | QC tests installable in CI; integration test honours `QC_PYTHON` and fails on a bad path; found env-var mismatch between `qc_quality.py` and `qc_pipeline.py` | Kept; lead fixed the env-var mismatch (one line). Not run on GitHub |
| D09 | Codex (no command sandbox, simulator) | iOS test repair | `yarnflow/ios/**` | **Completed** | none | Lead rerun on iPhone 17 simulator: 14 unit (1 skipped: physical device), 2 UI, TEST SUCCEEDED | Kept; simulator evidence only |
| R01 | Codex, independent reviewer (read-only brief) | Break the "no wrong automatic ACCEPT/HOLD" claim | none | **Completed** | none | **Claim broken: 7 findings reported as P0**, each with a reproduction (see handoff). Reproductions not rerun by the lead; none fixed | Open: must be fixed before any automatic mode |
| R02 | Codex, independent reviewer | Break tenant isolation / role / session claim | none | Stopped by the lead on the owner's instruction before reporting | — | No report | Not done |
| R01-fix | OpenCode `deepseek-v4.1-flash-free` (two workers), audited by Claude lead | Fix R01 findings 1 to 7 | `qc-store.mjs`, `qc.mjs`, `qc_policy.py`, contract files, tests | **Completed** 14 Nov | free limit reached later | All seven fixed with failing-first tests; lead reran suites | Independent rerun of the attacks still owed |
| R02 | OpenCode `deepseek-v4.1-flash-free`, read-only | Break tenant isolation / role / session claim | report only | **Completed** 14 Nov | none | 0 P0, 0 P1, 2 P2 (`R02-tenant-review.md`); R02-02 fixed, R02-01 left open on purpose | — |
| D07 | OpenCode `deepseek-v4.1-flash-free` | Sampling-plan authority, signatory normalisation (Worker) | `qc-store.mjs`, migration `0034`, tests | **Completed** 14 Nov | free limit at the very end | 961/961 yarnflow tests | No registration route |
| D08 | OpenCode `deepseek-v4.1-flash-free`, finished by Claude lead | Fabric artifact hash, Python signatory rule, invalid fixtures | `qc_pipeline.py`, `qc_schemas.py`, `build.py` | **Completed** 14 Nov | free limit mid-task | Lead wrote the validator and regenerated fixtures | — |
| D09 | OpenCode `longcat-2.5-free` | Offline sign-out reload | `LiveApp.tsx`, e2e | **Completed** 14 Nov | free limit after final run | Playwright 7/7 rerun by lead | — |
| R03 | OpenCode `nemotron-3.5-lightning-free`, read-only | Audit metrology, quality, training tooling | report only | **Completed, weak** 14 Nov | none | One real defect of ten claims (split-audit identifiers), fixed by lead | Rigorous audit still owed |
