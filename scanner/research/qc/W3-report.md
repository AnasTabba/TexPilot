# W3: R04 re-attack fixes (incoming-fabric QC v2)

Date: 16 Nov 2026. Worker W3. Source of findings: `scanner/research/qc/R04-r01-reattack.md`.
Fix site is the one shared gate on each side: `checkCandidate`/`finalizeQC` in
`yarnflow/server/qc-store.mjs` (the HTTP route and `finalizeQC` both route through
`checkCandidate`) and `_check_stages` in `scanner/services/consistency/qc_policy.py`
(reached only through `evaluate_qc`).

## Verdicts

| Finding | Verdict | Test(s) |
|---|---|---|
| 1 — Worker clamp bypassed at claim level (B1) | **fixed** | `qc-r04.test.mjs` B1 tests (4 forged ACCEPT, 2 HOLD, 1 control) + 10 clamp-shape regressions |
| 2 — unsigned nested measurement artifacts (B3) | **fixed** | `qc-r04.test.mjs` 5 `B3 ...` tests + non-automatic control |
| 3 — commit-time clock residual (B5) | **skipped** (documented residual; see below) | — |
| 5 — aggregate defect score vs largest view (B2) | **fixed** | `test_qc_policy.py::test_defect_view_at_accept_boundary_with_lower_aggregate_within_tolerance_is_not_accepted`; Worker: `qc-r04` aggregate + grey-zone tests |
| 6 — fabric/defect artifacts, domain bound to release (B4) | **fixed** | `qc-r04.test.mjs` 5 B4 tests, 5 stage-artifact tests, 2 stored-domain/policy tamper tests, 1 commit-guard test |

### Finding 1 (B1) — fixed

`checkCandidate` now re-derives, from the evidence the Worker itself signed, what an
automatic status may claim (`automaticEvidence`):

- ACCEPT is refused if any defect view reaches `defect_accept_below` (grey zone), the
  aggregate is not the largest view (1e-9), the fabric label is outside the PO's
  `allowed_fabric_labels`, any quality check failed, or any other released-domain /
  released-artifact precondition the Python policy requires fails.
- HOLD is refused unless every cited reason is one the evidence actually shows
  (`FABRIC_MISMATCH`, `DEFECT_SUSPECTED`, `CONSTRUCTION_OUTSIDE_TOLERANCE`) and no
  ACCEPT-blocker is present.
- Non-automatic drafts keep their previous path; the Python policy remains the authority.

### Finding 2 (B3) — fixed

For automatic drafts, each `Measurement` must cite exactly the artifacts the Worker signed
on that `ValidatedCapture` (`geometry_artifact_sha256`, `calibration.sha256`,
`axis_registration.id`, `reference.id`) and an `uncertainty_report_sha256` equal to the
metrology validation the released domain names. The Worker still signs these as `null`
today, so a calibrated measurement can no longer be automatic until signing exists — the
intended fail-closed state.

### Finding 5 (B2) — fixed

`_check_stages` now applies the thresholds to `peak = max(aggregate, largest view)` after
the 1e-9 consistency check, so a view on the accept boundary is a grey-zone review even
when the aggregate is a fraction below it. The Worker mirror applies the same rule. The
policy change was already present in the working tree when W3 started; its red state was
re-verified by reverting the branch locally and restoring it.

### Finding 6 (B4) — fixed

For automatic drafts the Worker now requires
`release.domain_sha256 == domain.sha256 == recomputed content hash`,
`release.policy_sha256 == policy.sha256 == recomputed content hash`, a release of the
request's workspace, and each of the five stage artifacts equal to the artifact the
released domain names. The commit batch additionally re-checks that the release row still
names that domain and policy (`json_extract` in the release guard), so a post-prepare row
change loses the commit instead of writing an automatic decision.

### Finding 3 (B5) — skipped

Documented residual (lapse inside the commit batch), explicitly out of scope per the task.
Not touched, no test added. The separate number-clock API hazard is also left: production
passes a function and enforcing it would change the signature used by unowned suites.

## Red -> green evidence

Failing-first, before the Worker fix (`git` tree at start, only the R04 test file present):

```
$ cd yarnflow && node --test tests/qc-r04.test.mjs
ℹ tests 18   ℹ pass 3   ℹ fail 15      # 15 = B1 (5) + B3 (5) + B4 (5)
```

New tests added after the fix were each shown red by temporarily removing only the line
under test and restoring it:

```
B4 ... fabric stage artifact ................ 1 fail
B4 ... stored domain manifest .............. 1 fail
B4 ... stored policy ....................... 1 fail
B4 commit guard ............................ 1 fail
B2 policy (reverted branch) ................ 1 failed, 103 deselected
```

Final commands and results (after restoration):

```
$ cd yarnflow && npm test
ℹ tests 997   ℹ pass 997   ℹ fail 0

$ cd scanner && ../.venv/bin/python -m pytest tests/test_qc_policy.py -p no:cacheprovider
104 passed in 0.31s
```

## Files changed

- `yarnflow/server/qc-store.mjs` — automatic-evidence refusal table, release domain/policy/
  workspace binding, signed measurement-artifact binding, commit-guard domain/policy
  recheck, header docs.
- `yarnflow/tests/qc-r04.test.mjs` — permanent R04 regressions (B1 clamp/forgery/HOLD,
  B3 artifacts, B4 binding in memory and through stored rows, commit guard).
- `yarnflow/tests/qc-r01.test.mjs` — positive-control evidence now signs the capture
  artifacts and carries conforming fabric/metrology values (the stricter ACCEPT invariant
  is what the control must satisfy; no assertion was weakened).
- `scanner/services/consistency/qc_policy.py` — defect thresholds applied to the peak view
  (B2).
- `scanner/tests/test_qc_policy.py` — B2 regression test.

## Residuals / notes

- Latent today: the pipeline cannot produce an automatic decision (defects stage
  `unavailable`, domain stage `DISABLED`), and the Worker signs `geometry_artifact_sha256`/
  `calibration`/`axis_registration`/`reference` as `null`, so findings 1/2/6 are defences
  for the first automatic path, not live decisions.
- Finding 1 clamp-shape attacks from Appendix A (missing stage, null stage/reasons, extra
  field, lowercase state, null value/artifact) are now permanent regressions; all held
  before and after.
