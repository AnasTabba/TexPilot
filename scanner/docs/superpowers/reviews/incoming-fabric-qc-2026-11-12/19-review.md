# Reviewer 19 — feasibility, timeline, compute and cost

Recommendation: revise the execution schedule before treating the Nov 29 demo or March release as committed milestones. No P0 found. Review-only/lab-only is a valid deliverable; the findings below do not demand automation, purchases, new GPU jobs or invented approvals.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (§§2–12, 14–16).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (DAG, T01–T13, integrated acceptance details).
- `scanner/deployment/modal_scanner.py`, `scanner/deployment/requirements-serving.txt`.
- `scanner/services/vision/fault.py`, `scanner/training/fault/methods/dinomaly.py`, `scanner/training/textilenet/train.py`.
- `yarnflow/server/scanner-proxy.mjs`.
- `scanner/docs/kaggle-vitb-timing-2026-11-12.md`, `scanner/docs/fault-a2-ddp-2026-11-12.md` (historical measurements/status, not live account authority).

## P1 — Demo dependency completion dates contradict the stated DAG

**Evidence:** Plan line 44 requires T04→T05→T06→T07. T04's lab window ends Nov 28 (line 84); T05 ends Nov 22 (96), T06 Nov 23 (108), and T07 Nov 28 (120). T04's stated output includes a physical report and its green step includes blinded physical trials; no separate early interface deliverable permits the downstream tasks to start. Existing `scanner/services/vision/fault.py:3–4` explicitly says the network is not wired and tests use a stub; T06 additionally owns the real loader, so this is substantive integration work rather than merely exposing a completed service. The design permits missing defect evidence at the demo (§12), but the plan does not distinguish optional loader proof from the critical-path contract.

**Correction:** Split T04 into an early frozen interface/lab adapter milestone and later independent physical validation, assigning dates and exact downstream dependencies to each. Define T06 demo completion as truthful availability/abstention plus verified real classifier, with real defect loading conditional on an existing compatible artifact; retain the loader as a separately tracked required final milestone. Recalculate the serial path and reserve an integrated rehearsal before Nov 29 rather than relying on overlapping completion windows.

**Test assertion:** A milestone dependency check must show every required predecessor's named deliverable completed before its consumer's integration checkpoint. The demo acceptance run must persist/reload a review-only result with a deliberately unavailable fault artifact and must never advertise defect readiness or automatic ACCEPT/HOLD.

## P1 — Target-serving feasibility is measured after milestones that rely on it

**Evidence:** Design §11 (line 159) requires warm p95≤15s or queued/pending UX; proposed endpoint map (plan line 40) sets a 60s analyze deadline and calls a queue a later measured fallback. The first explicit target benchmark/cost-sheet task is T12 in April (plan 180–186), after the November web demo, December native integration and March release gate. Actual deployment is CPU=2, memory=12288, scale-to-zero, one container and one concurrent input, with startup timeout240s and function timeout180s (`scanner/deployment/modal_scanner.py:64–77`). Its image includes scanner/custom bundles, not a fault artifact (57–60). Existing fault serving bounds work by downscaling to at most six tiles (`scanner/services/vision/fault.py:17–18,43–48`); preserving high-resolution QC evidence can change that cost. The historical T4 timing report is not a CPU/multiview latency or memory bound.

**Correction:** Move a bounded local/authorized-target cold/warm, maximum-capture-set and two-request contention probe into T06 before T07 integration. Record target, decoded pixels/capture count, model stages, RSS and elapsed wall time; measure again after the final bundle in T12. Define the early fallback concretely: local review-only demo or bounded synchronous failure/pending presentation, with no implied completed queued job. Keep deployment/budget authority G8 external; no paid target is needed to establish that the local demo fits its declared hardware. Do not introduce a queue before measurement just to satisfy a speculative target.

**Test assertion:** The declared demo target completes its representative bounded request within its chosen deadline or displays an explicit recoverable failure without a committed decision; a second request has bounded rejection/wait behavior. Cold start/over-deadline results cannot later commit a decision or appear as cached success. Record measured CPU time and memory rather than substituting GPU pilot numbers or the configured timeout.

## P2 — March confirmatory-study calendar lacks an acquisition feasibility checkpoint

**Evidence:** Design §7 (line 129) correctly derives 299 independently accepted units for the illustrative zero-failure 1%/95% criterion, roughly997 independent submissions at30% ACCEPT coverage before attrition, and more under multiplicity/dependence. T09 spans Nov–Jan, T10 February and T11 March (plan 144,156,168). T11 consumes trained/calibrated results, but no task estimates eligible independent-group arrival rate, reference-observer effort, exclusions, collection duration or a date to choose the already-authorized review-only fallback. Actual `scanner/training/textilenet/train.py:225–227,438–449` records training runs/timing, not factory enrollment or blinded reference throughput; benchmark tiles cannot supply this independent cohort. This is not a missing authority gate: G1/G2/G4/G7 are explicitly external and correctly forbid invented approval.

**Correction:** Add a T09 feasibility worksheet/checkpoint, conditional on consent/access, with distinct calibration and sealed confirmatory cohorts, expected independent units/week, eligibility/attrition and ACCEPT-coverage ranges, blinded double-reference effort, and earliest feasible completion. Link it to T11 and predeclare a deadline to narrow domains or report no release. Collection before the final model may be feasible with appropriate blinding/sealing; do not require waiting until March to discover insufficient independent rolls. Avoid promising997 as a fixed sufficient enrollment count.

**Test assertion:** A worked schedule with the illustrative single-endpoint assumptions and30% coverage requires at least997 independent submissions before attrition; additional alpha allocation or fewer independent units cannot reduce the requirement. Zero authorized recruitment, dependent-roll grouping or projected completion beyond the milestone yields an explicit review-only/insufficient-evidence outcome, not a released domain.

## Boundaries and proof

Existing code is legacy serving/training infrastructure; the v2 workflow and its milestones are proposed. Historical two-active-job reports and15.50GPU-hour balance are not current quota; the draft correctly treats new runs, factory permissions, rights, physical calibration and release authority as external gates. Three classifier seeds are a proposed experimental scope, not an authorization or measured budget; no compute saving or DDP speedup is established by local tests. The real serving requirements file is `scanner/deployment/requirements-serving.txt`, not the shortened path in the design baseline table.

Review performed by source/document inspection only. No installation, product edit, GPU/Kaggle action, deployment, purchase or performance claim was made. Final recommendation: accept the safe review-only research scope, revise the three planning gaps above, and keep automatic release contingent on actual independent evidence and authority.
