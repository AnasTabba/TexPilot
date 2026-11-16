# R04: independent re-attack of the R01 fixes (incoming-fabric QC v2)

Date: 14 Nov 2026. Reviewer: R04, an independent reviewer who did not write the fixes. Repo `main` at 128bb74 plus the uncommitted working tree that was present at the start (`scanner/training/textilenet/prepare_data.py`, two untracked `scanner/docs/fault-a2-*` folders). No existing file was edited, committed or pushed. The throwaway tests lived in `yarnflow/tests/_r04_tmp/` and `scanner/tests/_r04_tmp/` and both folders are deleted; their full code is reproduced in Appendix A so this report can be rerun.

## How to read the tests

Each attack is a test that asserts the SECURE behaviour. A failing test is a bypass, and the printed `[F*]` line is what the code actually did. `[F*]` lines are copied from the real output in Appendix B. Some lines of the raw output were hidden by the terminal display used during the review, so every line quoted below was taken from the saved output files, not from a summary.

Limits: the Worker was exercised through `yarnflow/server/qc-store.mjs` functions on the node:sqlite double from `yarnflow/tests/qc-store.test.mjs` (`fixtureDouble`), not through the HTTP route in `qc.mjs` and not against real D1. Storage-level tampering was modelled by dropping the release immutability trigger, which only a database administrator can do. The Python policy was exercised directly with `evaluate_qc`; no scanner process was run.

## Baseline

```
$ cd yarnflow && node --test tests/qc-r01.test.mjs
ℹ tests 6
ℹ pass 6
ℹ fail 0

$ cd scanner && ../.venv/bin/python -m pytest tests/test_qc_policy.py -q -p no:cacheprovider
103 passed in 0.23s
```

## Verdicts

| # | Finding | Verdict | Attacks (held / bypassed) | Proven bypasses |
|---|---|---|---|---|
| 1 | Worker clamp needs five OK stages | BYPASSED at claim level. The clamp itself holds; the Worker stores automatic drafts that contradict their own signed evidence | 15 held, 4 bypassed | B1 |
| 2 | Nested capture ids and hashes must be signed | BYPASSED for five measurement fields the Worker never signs | 6 held, 5 bypassed | B3 |
| 3 | Clock read after every await | BYPASSED by a documented residual only. Between readings, nothing is written (held). A release that lapses during the commit batch still commits | 3 held, 1 residual reproduced, 1 informational | B5 (documented) |
| 4 | Old decision stops being current after new captures | HELD | 5 held | 0 |
| 5 | Aggregate defect score must equal the largest view | BYPASSED at policy level (threshold edge within 1e-9); the Worker does not check the aggregate at all | 8 held, 1 bypassed in Python, 1 Worker gap shown under B1 | B2, B1 |
| 6 | Fabric and defect artifact hashes; domain bound to release | BYPASSED at Worker level: domain and policy hashes are not bound to the release. Python checks held | 11 held, 2 bypassed | B4 |
| 7 | Reasons on OK stages block automation; attempt 3; review-only | HELD | 14 held | 0 |

Proven new bypasses: **4** (B1 to B4). Documented residual reproduced: **1** (B5). Counted automatic-decision bypasses by the brief's rule: B1 (stores wrong automatic ACCEPT), B2 (stores automatic ACCEPT at a threshold edge), B5 (stores automatic ACCEPT after lapse). B3 and B4 are stored unsigned or unbound automatic evidence.

Important context: today's pipeline cannot yet produce an automatic decision at all. `scanner/services/api/qc_pipeline.py:184` sets the defects stage to `unavailable`, and `:187` sets the domain stage to `DISABLED`. The real pipeline therefore never produces an automatic draft: the Python policy turns the disabled domain stage into a review, and the Worker's clamp (`qc-store.mjs:577-580`) is never reached with an automatic draft from it. Severities below describe what happens once any automatic path exists or when the scanner is replaced.

## Findings

### Finding 1: Worker clamp requires five OK stages

Attacks tried (all in `r04-f1-clamp.test.mjs`, which is in Appendix A): missing stage key; stage null; `reasons` undefined; `reasons` null; `reasons` as a string; extra stage key; state `ok` in lowercase; OK stage with a value of null; OK stage with a null artifact hash; OK stage carrying `OOD` (non-fixable); OK stage carrying `QUALITY_BLUR` (fixable); `automatic` as `1` and as `"true"`; `HOLD` automatic with no reasons; `MANUAL_REVIEW` marked automatic; and, as the bypass attempts, forged automatic drafts whose signed evidence contradicts the decision.

Results: the first 15 attacks were refused with `SERVICE_UNAVAILABLE` and no rows were written (held). Order: `checkCandidate` runs the JSON-schema check (`qc-store.mjs:561`) before the clamp (`:577`), and the schema check refuses every shape attack. The clamp's own rule held.

The four forged drafts were stored (bypassed, B1).

Output (from `final-f1-clamp.txt`):
```
[F1] missing stage key (quality): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.quality is required; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: missing stage key (quality) (98.357ms)
[F1] stage null (defects): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.defects must be object; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: stage null (defects) (86.322166ms)
[F1] reasons undefined (quality): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.quality.reasons must be array; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: reasons undefined (quality) (95.429958ms)
[F1] reasons null (fabric): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.fabric.reasons must be array; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: reasons null (fabric) (93.282583ms)
[F1] reasons a string (metrology): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.metrology.reasons must be array; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: reasons a string (metrology) (89.496584ms)
[F1] extra stage key: refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.extra_stage is not an allowed field; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: extra stage key (89.272541ms)
[F1] state lowercase ok (fabric): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.fabric.state is not an allowed value; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: state lowercase ok (fabric) (88.446375ms)
[F1] OK stage with a reason the clamp must see (domain, OOD): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner proposed an automatic status while a required evidence stage is not OK. Nothing was recorded.; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: OK stage with a reason the clamp must see (domain, OOD) (85.450583ms)
[F1] OK stage with fixable reason (quality, QUALITY_BLUR): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner proposed an automatic status while a required evidence stage is not OK. Nothing was recorded.; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: OK stage with fixable reason (quality, QUALITY_BLUR) (85.875292ms)
[F1] OK stage with value null (defects): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.defects an OK stage needs a value and the artifact that produced it; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: OK stage with value null (defects) (85.294833ms)
[F1] OK stage with artifact null (metrology): refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.evidence.metrology an OK stage needs a value and the artifact that produced it; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses: OK stage with artifact null (metrology) (85.077583ms)
[F1] automatic=1: refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.draft.automatic must be boolean; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
[F1] automatic="true": refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.draft.automatic must be boolean; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses automatic as a truthy non-boolean (1 and "true") (169.397125ms)
[F1] HOLD automatic, reasons []: refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.draft every status except ACCEPT states at least one reason; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
[F1] MANUAL_REVIEW marked automatic: refused SERVICE_UNAVAILABLE ["STAGE_UNAVAILABLE"] The scanner answer is not a valid analysis: AnalysisCandidate.draft automatic is true exactly for ACCEPT and HOLD; rows_written={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F1 refuses automatic HOLD with no reasons and automatic MANUAL_REVIEW (169.52125ms)
[F1] ACCEPT automatic, defect view 0.9 >= hold 0.8: STORED status=ACCEPT automatic=true release_id=4a01d663-a72e-4dcf-b7e9-79010602188b; rows_written={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F1/F5 Worker stores an automatic ACCEPT whose signed defect view is above the hold threshold (86.235125ms)
[F1] ACCEPT automatic, aggregate 0.0, view 0.3 (accept_below 0.2): STORED status=ACCEPT automatic=true release_id=17f1c13b-f1a7-432b-b1a8-b2a0389c7870; rows_written={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F1/F5 Worker stores an automatic ACCEPT whose aggregate is not the largest view (86.588834ms)
[F1] ACCEPT automatic, fabric denim vs allowed twill: STORED status=ACCEPT automatic=true release_id=12f8d790-1433-46cc-8bb8-c2692d2f4efa; rows_written={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F1 Worker stores an automatic ACCEPT whose fabric label is outside the PO allowed labels (85.442167ms)
[F1] ACCEPT automatic, blur check false: STORED status=ACCEPT automatic=true release_id=9493a5e0-d443-44d9-83c3-c0a41193d045; rows_written={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F1 Worker stores an automatic ACCEPT whose quality stage has a failed check (86.278834ms)
[F1] control clean ACCEPT: STORED status=ACCEPT automatic=true release_id=85b4b816-9fbe-406e-84cb-3db7f164f2b2; rows_written={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✔ R04-F1 control: a clean automatic ACCEPT is stored (86.297958ms)
ℹ pass 14
ℹ fail 4
✖ R04-F1/F5 Worker stores an automatic ACCEPT whose signed defect view is above the hold threshold (86.235125ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic ACCEPT with defect view 0.9 (hold threshold 0.8)
✖ R04-F1/F5 Worker stores an automatic ACCEPT whose aggregate is not the largest view (86.588834ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic ACCEPT with aggregate 0.0 under view 0.3
✖ R04-F1 Worker stores an automatic ACCEPT whose fabric label is outside the PO allowed labels (85.442167ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic ACCEPT for fabric denim
✖ R04-F1 Worker stores an automatic ACCEPT whose quality stage has a failed check (86.278834ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic ACCEPT with blur=false
```

**B1. Worker stores automatic ACCEPT that contradicts its own signed evidence**

- Severity: High against the claim "no wrong automatic ACCEPT/HOLD can be stored". Latent today (see context above).
- Location: `yarnflow/server/qc-store.mjs:559-582`. The binding check (`:564-566`) and evidence checks (`:567-573`) compare identifiers and hashes only. The clamp (`:577-580`) looks at stage states only. Nothing re-derives the decision from the signed evidence. `finalizeQC` (`:589-631`) then writes whatever `candidate.draft` says (`:602-603`). The Python policy is the only place that compares a defect score with its thresholds, the fabric label with the PO, or the quality checks, and the Worker never runs it.
- Expected: the Worker refuses an automatic ACCEPT whose signed evidence fails a rule the Worker can check: defect score or largest view at or above `defect_accept_below`, fabric label outside `spec.allowed_fabric_labels`, any quality check false, or aggregate not equal to the largest view.
- Actual: all four forged drafts were stored as `status=ACCEPT automatic=true` with a release id.
- Suggested fix: the Worker must check the ACCEPT-level invariants it can see from data it already holds (the domain thresholds are in `prepared.domain`; the labels are in `prepared.request.spec`; the quality checks and the aggregate are in the evidence). Keep the Python policy as the decision authority, but make a Worker-side ACCEPT refusal table that mirrors the policy's ACCEPT preconditions and is covered by a shared golden fixture run in both languages. For HOLD, require the cited reason to be supported by a stage value.

### Finding 2: Nested capture ids and hashes must be signed originals

Attacks tried (`r04-f2-nested.test.mjs`): uppercase hex in a view `capture_sha256`; uppercase capture id in a measurement; two views for one capture; duplicate `capture_ids`; extra `capture_sha256` on a defect region; a measurement pairing one capture's id with another capture's hash; and, as bypass attempts, unsigned values in `geometry_artifact_sha256`, `calibration_sha256`, `uncertainty_report_sha256`, `axis_registration_id` and `reference_id`.

Schema coverage check (run during the review): all 45 `$defs` in `scanner/contracts/qc-v2.schema.json` set `additionalProperties: false`, so no hidden nested field can be smuggled in. The Python `Strict` base sets `extra="forbid"` too.

Results: the six identifier and pairing attacks were refused (held). The five unsigned measurement fields were stored.

Output (from `final-f2-nested.txt`):
```
[F2] measurement.geometry_artifact_sha256 forged: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F2 refuses an unsigned measurement.geometry_artifact_sha256 (no geometry artifact was signed) (95.798ms)
[F2] measurement.calibration_sha256 forged: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F2 refuses an unsigned measurement.calibration_sha256 (signed calibration is null) (87.783542ms)
[F2] measurement.uncertainty_report_sha256 forged: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F2 refuses an unsigned measurement.uncertainty_report_sha256 (86.429125ms)
[F2] measurement.axis_registration_id forged: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F2 refuses an unsigned measurement.axis_registration_id (signed axis_registration is null) (86.199083ms)
[F2] measurement.reference_id forged: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F2 refuses an unsigned measurement.reference_id (87.302875ms)
[F2] defect view capture_sha256 uppercase: refused SERVICE_UNAVAILABLE The scanner answer is not a valid analysis: AnalysisCandidate.evidence.defects.value.views[0].capture_sha256 has an invalid format rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F2 refuses uppercase hex in a view capture_sha256 (86.044042ms)
[F2] measurement capture_id uppercase: refused SERVICE_UNAVAILABLE The scanner answer is not a valid analysis: AnalysisCandidate.evidence.metrology.value[0].capture_id has an invalid format rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F2 refuses an uppercase capture_id in a measurement (85.7035ms)
[F2] duplicate defect view: refused SERVICE_UNAVAILABLE The scanner answer is not a valid analysis: AnalysisCandidate.evidence.defects.value one defect view per capture rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F2 refuses two defect views for one capture (85.399333ms)
[F2] evidence.capture_ids duplicated: refused SERVICE_UNAVAILABLE The scanner answer is not a valid analysis: AnalysisCandidate.evidence a measurement must belong to this evidence's captures rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F2 refuses duplicate evidence.capture_ids (85.829125ms)
[F2] region carries an unsigned capture_sha256: refused SERVICE_UNAVAILABLE The scanner answer is not a valid analysis: AnalysisCandidate.evidence.defects.value.regions[0].capture_sha256 is not an allowed field rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F2 refuses an extra capture_sha256 on a defect region (85.264292ms)
[F2] measurement pairs capture 0 with capture 1 hash: refused SERVICE_UNAVAILABLE The scanner evidence cites an original that was not signed. rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F2 refuses a measurement whose capture_sha256 is the signed hash of a different capture (86.121375ms)
[F2] control: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✔ R04-F2 control: the signed pairing is stored (86.193041ms)
ℹ pass 7
ℹ fail 5
✖ R04-F2 refuses an unsigned measurement.geometry_artifact_sha256 (no geometry artifact was signed) (95.798ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic evidence citing geometry artifact aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
✖ R04-F2 refuses an unsigned measurement.calibration_sha256 (signed calibration is null) (87.783542ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic evidence citing an unsigned calibration hash
✖ R04-F2 refuses an unsigned measurement.uncertainty_report_sha256 (86.429125ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic evidence citing an unsigned uncertainty report
✖ R04-F2 refuses an unsigned measurement.axis_registration_id (signed axis_registration is null) (86.199083ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic evidence citing an unsigned axis registration
✖ R04-F2 refuses an unsigned measurement.reference_id (87.302875ms)
  AssertionError [ERR_ASSERTION]: BYPASS: stored automatic evidence citing an unlisted reference card
```

**B3. Automatic evidence cites measurement hashes and ids the Worker never signed**

- Severity: Medium. Provenance, not the numeric decision. Latent: `qc-store.mjs:548` and `:552` sign `geometry_artifact_sha256: null`, `calibration: null`, `axis_registration: null` for every capture, and `calibration_records_sha256` is the hash of `[]`. The Worker signs `calibration: null` for every capture, so no calibrated measurement can reach the scanner through this path today.
- Location: `yarnflow/server/qc-store.mjs:569-573` checks only `capture_id` and `capture_sha256`. `scanner/services/api/qc_schemas.py:601-611` (class `Measurement`) also carries `geometry_artifact_sha256`, `calibration_sha256`, `uncertainty_report_sha256`, `axis_registration_id` and `reference_id`. None of them is compared with anything the Worker signed.
- Expected: each of these fields must be null, or equal to a value the Worker signed for that capture; `reference_id` must come from a signed reference list.
- Actual: all five stored in an automatic ACCEPT with `qc_evidence`, `qc_decisions` and `qc_decision_events` each incremented by one.
- Suggested fix: extend the citation check to these fields against the signed `ValidatedCapture` (`geometry_artifact_sha256`, `calibration`, `axis_registration`, `reference`). Until calibration is signed, refuse automatic when any measurement carries a non-null value in those fields.

### Finding 3: Commit-time clock is read after every await

Attacks tried (`r04-f3-clock.test.mjs`): release expiring exactly at the fresh reading (held: CONFLICT, no rows); release expiring 1 ms after the fresh reading (control: commits); deadline reached at the second reading (held: DEADLINE_EXCEEDED, no rows, request EXPIRED); a plain number passed instead of a clock function (informational); and a release that lapses while the commit batch is running (bypassed, residual).

Awaits between the fresh reading and the batch: I checked `qc-store.mjs:599` to `:624`. The only `await` in that range is at `:600`, on the refusal branch for a passed deadline, which throws. No `await` sits on the success path between the fresh reading and `await db.batch(batch)` at `:624`. Every production caller passes a function: the only production caller is `qc.mjs:171` (`() => nowOf(env)`). Callers in the test suites pass `f.now` (a number), which the function accepts silently (`qc-store.mjs:591`).

Output (from `final-f3-clock.txt`):
```
✔ R04-F3 release expiring exactly at the fresh reading writes nothing (94.231791ms)
✔ R04-F3 release expiring 1 ms after the fresh reading is still a valid commit (control) (87.619833ms)
✔ R04-F3 deadline reached at the second reading writes nothing and expires the request (85.513666ms)
[F3] number clock: real Date.now()=2026-11-14T14:00:06.897Z > release expires_at=2026-11-14T14:00:06.866Z; finalize with number 2026-11-14T14:00:06.861Z -> COMMITTED automatic=true status=ACCEPT
✔ R04-F3 a number instead of a clock function: stale constant (API hazard, production passes a function) (117.939958ms)
[F3] lapse during batch: DB time 2026-11-14T14:00:36.980Z > expires 2026-11-14T14:00:36.979Z; result=COMMITTED automatic=true status=ACCEPT; rows written={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F3 KNOWN RESIDUAL: release lapses while the commit batch is running (86.454834ms)
ℹ pass 4
ℹ fail 1
✖ R04-F3 KNOWN RESIDUAL: release lapses while the commit batch is running (86.454834ms)
  AssertionError [ERR_ASSERTION]: RESIDUAL: committed "ACCEPT" although the release lapsed before the batch ran
```

**B5. Release lapses while the commit batch runs (documented residual)**

- Severity: Low. The window is the batch duration in milliseconds, and it requires the lapse to fall inside it. The R01 fix documents this residual (`qc-store.mjs:598`, handoff "What changed on 14 Nov", R01-3). I reproduced it so the residual is measured, not assumed.
- Location: the guards compare `expires_at` with `fresh` (`qc-store.mjs:613-615`), and the batch runs later (`:624`) with no database clock.
- Expected: no ACCEPT once the release has lapsed at the moment of the write.
- Actual: `COMMITTED automatic=true status=ACCEPT`, while DB time was 1 ms past `expires_at`.
- Suggested fix: require the release to be valid for the request's remaining deadline plus a margin (`expires_at > fresh + MAX_BATCH_MS`), or compare with a timestamp the database itself supplies (`strftime('%s','now')` in the guard).

Observation (not counted): a number passed as the clock silently commits an automatic ACCEPT after the real release lapse (`[F3] number clock: ... COMMITTED automatic=true`). Production passes a function, so this is an API hazard, not a live bypass. A one-line `typeof now === 'function'` assertion at `qc-store.mjs:591` removes it.

### Finding 4: Old decision stops being current after new captures

Attacks tried (`r04-f4-decision.test.mjs`): addCapture into the closed old set after a new set exists; createCaptureSet while a set is open; a race between `finalizeQC` for set A and `createCaptureSet` on the same sample; a stale finalize for set A after a new set exists; a linked successor after a spec revision, with a capture attempt on the predecessor.

Results: all five held. The new set nulls `current_decision_id` (`qc-store.mjs:415`); the old set cannot take captures (`:444`); the race ends with exactly one winner and the invariant (open set implies no current decision) holds; a stale finalize refuses with CONFLICT; the successor starts with a null pointer, and the predecessor refuses new captures (PO_VERSION_STALE, `:408`).

Output (from `final-f4-decision.txt`):
```
[F4] addCapture to closed old set after new set: CONFLICT current=null
✔ R04-F4 after a decision, a new capture set clears current and the old set cannot take captures (96.105792ms)
✔ R04-F4 createCaptureSet refuses while a set is open, and an open set never sits beside a current decision (88.61075ms)
[F4] race outcomes: CONFLICT / ok; openSets=1 current=null
✔ R04-F4 race: finalize of set A and createCaptureSet on the same sample cannot leave a current decision beside an open set (86.98975ms)
✔ R04-F4 an old set analysed under a stale revision cannot re-point current after a new set exists (87.70525ms)
[F4] successor current=null; predecessor current=00307c31-e0a0-4890-92ef-f54f0cd6ac3a (decision 00307c31-e0a0-4890-92ef-f54f0cd6ac3a); predecessor listSamples status=MANUAL_REVIEW
✔ R04-F4 linked successor under a new spec: predecessor cannot take captures and successor starts with no decision (98.334333ms)
ℹ pass 5
ℹ fail 0
```

Observation (not a bypass): after a spec revision and a linked successor, the predecessor still shows its earlier decision as `current` (`listSamples` status `MANUAL_REVIEW`). That decision was made under the older spec, and the design keeps decisions per spec version, so this is history, not a stale automatic result. Not counted.

### Finding 5: Aggregate defect score must be the largest view

Policy attacks (`test_r04_policy.py`): aggregate equal to the largest view at the accept boundary (held); aggregate 2e-9 below the largest view (held, STAGE_UNAVAILABLE); aggregate 5e-10 below a view at exactly `defect_accept_below` (BYPASSED); a view above the hold threshold with a matching aggregate (held, HOLD); NaN and infinity (held, refused at the schema because `allow_inf_nan=False` and the JSON hash refuses them); a view from a capture outside the evidence (held); empty views (held); empty regions (held, no effect on the decision).

Worker attacks: the forged ACCEPT with aggregate 0.0 under a view of 0.3 was stored (B1). Non-finite values should also be refused on the Worker side by `violation()` (`qc-contract.mjs:133`, read in the code; no Worker-side NaN test was written).

**B2. Automatic ACCEPT when a view sits exactly on the accept boundary and the aggregate is within 1e-9 below it**

- Severity: Medium. Requires an aggregate that differs from the largest view by less than 1e-9. No `DefectValue` producer exists in the repository yet (grep of `scanner/services` finds only the schema), so this is latent.
- Location: `scanner/services/consistency/qc_policy.py:181` accepts `math.isclose(score, max(views), abs_tol=1e-9)`, and then `:185-188` tests the thresholds against `score` (the aggregate), not against the largest view.
- Expected: a view at or above `defect_accept_below` is a grey-zone review (`DEFECT_SUSPECTED`, inclusive lower bound).
- Actual: `ACCEPT True []`. The view at 0.2 was skipped because the aggregate, 0.2 - 5e-10, is below the threshold.
- Suggested fix: test the thresholds against `top = max(v.score for v in views)`, not against `score`. Keep the tolerance only as the consistency check between `score` and `top`.

Output (from `final-policy.txt`):
```
..F5 abs_tol edge actual: ACCEPT True []
        print("F5 abs_tol edge actual:", d.status, d.automatic, d.reasons)
E       AssertionError: BYPASS: automatic ACCEPT []
FAILED tests/_r04_tmp/test_r04_policy.py::test_f5_abs_tol_edge_view_at_accept_boundary_must_not_be_automatic_accept
1 failed, 31 passed in 0.14s
```

### Finding 6: Fabric and defect artifact hashes; domain bound to the release

Policy side (held): domain `None` (review); each stage's artifact hash mismatch for quality, fabric, defects, metrology and domain (review with `DOMAIN_UNVALIDATED`); a recomputed domain manifest that the release does not name (review); a domain with a stale sha256 (review); an OK stage with a null artifact hash (refused at the schema). The policy checks `domain.sha256` and `release.domain_sha256` (`qc_policy.py:111-119`).

Worker side: the clamp requires `prepared.domain` and `evidence.domain_id === domain.id` (`qc-store.mjs:578`). Those held (no-domain refusal, domain-id mismatch refusal). But the Worker never compares `contentSha256(prepared.domain)` with `release.domain_sha256`, nor `contentSha256(prepared.policy)` with `release.policy_sha256`. `activeRelease` (`qc-store.mjs:234-237`) parses `domain_json` and `policy_json` without any hash check, and `finalizeQC`'s release guard (`:613-615`) compares only the release id, state, expiry and release sha256.

**B4. Worker stores an automatic ACCEPT under a domain manifest or policy that the release does not name**

- Severity: Low. Defence in depth. It needs a database write that bypasses the release immutability trigger `qc_releases_transition` (`yarnflow/drizzle/0033_incoming_fabric_qc.sql:55-56`). That trigger is the only control on `domain_json` and `policy_json` after registration, so if it is dropped or missed by a migration, nothing else catches the change. The honest scanner would refuse this (the Python policy returns review, shown by `test_f6_domain_manifest_recomputed_but_not_bound_to_release_is_review`), so exploiting it needs a faulty or replaced scanner as well.
- Expected: the Worker refuses automatic when `contentSha256(domain, HASH_EXCLUDES.DomainManifest) !== release.domain_sha256` or the same check fails for the policy.
- Actual: both stored as automatic ACCEPT.
- Suggested fix: in `finalizeQC` (or `prepareAnalysis`), assert the three equalities (`domain.sha256 == recomputed == release.domain_sha256`, and the policy equivalent) and include the two hashes in the commit guard at `:613-615`.

Output (from `final-f6-binding.txt`):
```
[F6] control: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✔ R04-F6 control: consistent release, domain and policy are stored automatically (97.544292ms)
[F6] prepared.domain.sha256=0352100c1e98 release.domain_sha256=ce791e71a01a
[F6] domain manifest not bound to release: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F6 refuses automatic when release.domain_sha256 does not match the stored domain manifest (90.592917ms)
[F6] prepared.policy.sha256=7b69039bc815 release.policy_sha256=c02807381009
[F6] policy not bound to release: STORED automatic=true status=ACCEPT rows={"qc_evidence":1,"qc_decisions":1,"qc_decision_events":1}
✖ R04-F6 refuses automatic when release.policy_sha256 does not match the stored policy (87.6185ms)
[F6] no domain manifest: refused SERVICE_UNAVAILABLE The scanner proposed an automatic status without a released domain. Nothing was recorded. rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F6 refuses automatic when the release carries no domain manifest (87.060208ms)
[F6] domain id mismatch: refused SERVICE_UNAVAILABLE The scanner proposed an automatic status without a released domain. Nothing was recorded. rows={"qc_evidence":0,"qc_decisions":0,"qc_decision_events":0}
✔ R04-F6 refuses automatic when evidence.domain_id names another domain (86.170333ms)
ℹ pass 3
ℹ fail 2
✖ R04-F6 refuses automatic when release.domain_sha256 does not match the stored domain manifest (90.592917ms)
  AssertionError [ERR_ASSERTION]: BYPASS: automatic ACCEPT stored with a domain manifest whose hash the release does not name
✖ R04-F6 refuses automatic when release.policy_sha256 does not match the stored policy (87.6185ms)
  AssertionError [ERR_ASSERTION]: BYPASS: automatic ACCEPT stored under a policy the release does not name
```

### Finding 7: Reasons on OK stages block automation; attempt 3; review-only

Attacks tried (`test_r04_policy.py`): a capture-fixable reason on an ABSTAINED fabric, defects or domain stage (all held: MANUAL_REVIEW with STAGE_UNAVAILABLE, because only quality and metrology are recapturable, `qc_policy.py:46`); the metrology control (held: RECAPTURE); a fixable reason on an OK stage of each of the five kinds (held: not automatic); a fixable reason at attempt 3 (held: MANUAL_REVIEW with RECAPTURE_LIMIT); four non-fixable reasons on an OK defects stage (held: review); and a review-only policy with an OK defects stage at score 0.95 and a reason on it (held: never automatic, never HOLD).

Results: all held. The policy never lets REVIEW_ONLY produce ACCEPT or HOLD because `_check_authority` always adds `POLICY_UNRELEASED` in that mode (`qc_policy.py:98-100`).

Output (from `final-policy.txt`): the policy results are in the same file as Finding 5 above; every `test_f7_*` case shows PASSED.

## Unproven suspicions

These were not reproduced and are not counted as findings.

- The Worker does not check `RECAPTURE_LIMIT`: a RECAPTURE draft at attempt 3 may be stored. I tried to reproduce it by setting the set's attempt to 3 in the test database, but the closed-set trigger refused the write (`qc: a closed capture set is frozen`). Not reproduced; not counted. The Python side refuses it (`qc_policy.py:246-247`, held).
- `FabricValue`, `QualityValue`, `DefectRegion` and `DefectView` carry `observed_area_cm2` or label values with no hash. I did not test whether any of them can change a decision without a signed binding. Not tested.
- The JS validator and the Python models were compared only for `additionalProperties` and for the cross-field rules named in Finding 1 and Finding 2. I did not run a full constraint-by-constraint parity check.

## Appendix A: reproduction code

All files are complete. To rerun, recreate the two folders, copy each file in, and run the commands in Appendix B. The Python test imports `services.*` from `scanner/`, so run it from there.

### A.1 yarnflow/tests/_r04_tmp/r04-helpers.mjs

```js
// R04 throwaway helpers. Copies of the R01 test doubles (not exported by the R01 file).
import { fixtureDouble, uploadedDouble, analysisDouble, activeReleaseDouble, doubleRecord, idemDouble, isCode, countsDouble } from '../qc-store.test.mjs';
import * as store from '../../server/qc-store.mjs';
import { contentSha256, HASH_EXCLUDES, violation, sha256Hex } from '../../server/qc-contract.mjs';

export { fixtureDouble, uploadedDouble, analysisDouble, activeReleaseDouble, doubleRecord, idemDouble, isCode, countsDouble, store, contentSha256, HASH_EXCLUDES, violation, sha256Hex };
export const STAGES = ['quality', 'fabric', 'defects', 'metrology', 'domain'];
export const serviceUnavailable = error => error.code === 'SERVICE_UNAVAILABLE';

export function allOkEvidence(prepared, at) {
  const evidence = doubleRecord('evidence-synthetic-all-stages-ok'), captures = prepared.request.captures;
  const ids = captures.map(c => c.capture.id), shas = captures.map(c => c.verified_sha256), pick = i => ({ capture_id: ids[i % ids.length], capture_sha256: shas[i % shas.length] });
  evidence.id = crypto.randomUUID();
  evidence.sample_id = prepared.sample.id;
  evidence.spec_sha256 = prepared.spec.content_sha256;
  evidence.capture_ids = ids;
  evidence.domain_id = prepared.domain?.id ?? null;
  evidence.created_at = new Date(at).toISOString();
  evidence.metrology.value = evidence.metrology.value.map(measurement => ({ ...measurement, ...pick(Math.min(1, ids.length - 1)) }));
  evidence.defects.value.views = evidence.defects.value.views.map((view, i) => ({ ...view, ...pick(i) }));
  evidence.defects.value.regions = evidence.defects.value.regions.map((region, i) => ({ ...region, capture_id: ids[i % ids.length] }));
  return evidence;
}

export async function rehash(evidence) {
  // A value that cannot be canonicalised (undefined) keeps its stale manifest: the Worker must refuse it on shape anyway.
  try { evidence.manifest_sha256 = await contentSha256(evidence, HASH_EXCLUDES.Evidence); } catch { /* stale on purpose */ }
  return evidence;
}

export async function candidateDouble(prepared, started, evidence, automatic = false, draftOverride = null) {
  await rehash(evidence);
  const draft = draftOverride ?? (automatic ? { status: 'ACCEPT', reasons: [], automatic: true, scope: 'INSPECTED_SAMPLE' } : doubleRecord('draft-manual-review'));
  return {
    evidence, draft,
    binding: { spec_sha256: prepared.spec.content_sha256, policy_sha256: prepared.policy.sha256, release_sha256: prepared.release?.sha256 ?? null, capture_sha256s: prepared.request.captures.map(c => c.verified_sha256),
      attempt: prepared.set.attempt, expected_revision: prepared.sample.revision, request_id: started.request_id, request_generation: started.generation, deadline_at: prepared.request.context.deadline_at },
  };
}

/** Full automatic setup: active release, uploaded + closed set, analysis begun. */
export async function automaticSetup() {
  const f = await fixtureDouble();
  const release = await activeReleaseDouble(f);
  const u = await uploadedDouble(f), a = await analysisDouble(f, u);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), true);
  return { f, release, u, a };
}
```

### A.2 yarnflow/tests/_r04_tmp/r04-f1-clamp.test.mjs (Finding 1, B1)

```js
// R04 finding 1: Worker clamp must refuse automatic drafts unless five stages are OK with no reasons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSetup, allOkEvidence, candidateDouble, rehash, countsDouble, store, serviceUnavailable, STAGES, doubleRecord } from './r04-helpers.mjs';

async function attempt(name, mutate, { automatic = true, draft = null, expect = 'refuse' } = {}) {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = allOkEvidence(a.prepared, f.now);
  mutate(ev);
  const candidate = await candidateDouble(a.prepared, a.started, ev, automatic, draft);
  let refused = null, stored = null;
  try { await store.checkCandidate(candidate, a.prepared); } catch (error) { refused = error; }
  if (!refused) {
    try { stored = await store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now); } catch (error) { refused = error; }
  }
  const after = countsDouble(f);
  const summary = refused ? `refused ${refused.code} ${JSON.stringify(refused.reasons)} ${refused.message}` : `STORED status=${stored.status} automatic=${stored.automatic} release_id=${stored.release_id}`;
  console.log(`[F1] ${name}: ${summary}; rows_written=${JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - before[k]])))}`);
  f.sql.close();
  return { refused, stored, after, before };
}

const clampCases = [
  ['missing stage key (quality)', ev => { delete ev.quality; }],
  ['stage null (defects)', ev => { ev.defects = null; }],
  ['reasons undefined (quality)', ev => { ev.quality.reasons = undefined; }],
  ['reasons null (fabric)', ev => { ev.fabric.reasons = null; }],
  ['reasons a string (metrology)', ev => { ev.metrology.reasons = 'none'; }],
  ['extra stage key', ev => { ev.extra_stage = structuredClone(ev.quality); }],
  ['state lowercase ok (fabric)', ev => { ev.fabric.state = 'ok'; }],
  ['OK stage with a reason the clamp must see (domain, OOD)', ev => { ev.domain.reasons = ['OOD']; }],
  ['OK stage with fixable reason (quality, QUALITY_BLUR)', ev => { ev.quality.reasons = ['QUALITY_BLUR']; }],
  ['OK stage with value null (defects)', ev => { ev.defects.value = null; }],
  ['OK stage with artifact null (metrology)', ev => { ev.metrology.artifact_sha256 = null; }],
];

for (const [name, mutate] of clampCases) {
  test(`R04-F1 refuses: ${name}`, async () => {
    const r = await attempt(name, mutate);
    assert.ok(r.refused, `expected refusal, stored ${JSON.stringify(r.stored)}`);
    assert.equal(r.after.qc_decisions, r.before.qc_decisions);
  });
}

test('R04-F1 refuses automatic as a truthy non-boolean (1 and "true")', async () => {
  for (const value of [1, 'true']) {
    const r = await attempt(`automatic=${JSON.stringify(value)}`, () => {}, { draft: { status: 'ACCEPT', reasons: [], automatic: value, scope: 'INSPECTED_SAMPLE' } });
    assert.ok(r.refused, `automatic=${JSON.stringify(value)} stored ${JSON.stringify(r.stored)}`);
  }
});

test('R04-F1 refuses automatic HOLD with no reasons and automatic MANUAL_REVIEW', async () => {
  const hold = await attempt('HOLD automatic, reasons []', () => {}, { draft: { status: 'HOLD', reasons: [], automatic: true, scope: 'INSPECTED_SAMPLE' } });
  assert.ok(hold.refused, 'HOLD with no reasons must be refused');
  const review = await attempt('MANUAL_REVIEW marked automatic', () => {}, { draft: { status: 'MANUAL_REVIEW', reasons: ['OOD'], automatic: true, scope: 'INSPECTED_SAMPLE' } });
  assert.ok(review.refused, 'MANUAL_REVIEW marked automatic must be refused');
});

// ---- Residual of finding 1 (scanner-authored decision contradicting its own signed evidence) ----
// The clamp checks stage states only. These drafts pass it. Expected: the Worker refuses a draft
// its own signed evidence contradicts. Actual: stored as automatic.
test('R04-F1/F5 Worker stores an automatic ACCEPT whose signed defect view is above the hold threshold', async () => {
  const r = await attempt('ACCEPT automatic, defect view 0.9 >= hold 0.8', ev => {
    ev.defects.value.score = 0.9; ev.defects.value.views[0].score = 0.9;
  });
  assert.ok(r.refused, `BYPASS: stored automatic ${r.stored?.status} with defect view 0.9 (hold threshold 0.8)`);
});

test('R04-F1/F5 Worker stores an automatic ACCEPT whose aggregate is not the largest view', async () => {
  const r = await attempt('ACCEPT automatic, aggregate 0.0, view 0.3 (accept_below 0.2)', ev => {
    ev.defects.value.score = 0.0; ev.defects.value.views[0].score = 0.3;
  });
  assert.ok(r.refused, `BYPASS: stored automatic ${r.stored?.status} with aggregate 0.0 under view 0.3`);
});

test('R04-F1 Worker stores an automatic ACCEPT whose fabric label is outside the PO allowed labels', async () => {
  const r = await attempt('ACCEPT automatic, fabric denim vs allowed twill', ev => {
    ev.fabric.value.label = 'denim'; ev.fabric.value.candidates = [{ label: 'denim', raw_score: 4.0 }];
  });
  assert.ok(r.refused, `BYPASS: stored automatic ${r.stored?.status} for fabric denim`);
});

test('R04-F1 Worker stores an automatic ACCEPT whose quality stage has a failed check', async () => {
  const r = await attempt('ACCEPT automatic, blur check false', ev => { ev.quality.value.checks.blur = false; });
  assert.ok(r.refused, `BYPASS: stored automatic ${r.stored?.status} with blur=false`);
});

test('R04-F1 control: a clean automatic ACCEPT is stored', async () => {
  const r = await attempt('control clean ACCEPT', () => {});
  assert.ok(r.stored && r.stored.automatic === true && r.stored.status === 'ACCEPT', JSON.stringify(r.refused));
});
```

### A.3 yarnflow/tests/_r04_tmp/r04-f2-nested.test.mjs (Finding 2, B3)

```js
// R04 finding 2: every nested capture id/hash in evidence must be a signed original.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSetup, allOkEvidence, candidateDouble, countsDouble, store } from './r04-helpers.mjs';

async function attempt(name, mutate, { draftAutomatic = true } = {}) {
  const { f, u, a } = await automaticSetup();
  const ev = allOkEvidence(a.prepared, f.now);
  mutate(ev, a.prepared);
  const candidate = await candidateDouble(a.prepared, a.started, ev, draftAutomatic);
  const before = countsDouble(f);
  let outcome;
  try { outcome = { stored: await store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now) }; }
  catch (error) { outcome = { refused: `${error.code} ${error.message}` }; }
  const rows = Object.fromEntries(Object.entries(countsDouble(f)).map(([k, v]) => [k, v - before[k]]));
  console.log(`[F2] ${name}: ${outcome.refused ? 'refused ' + outcome.refused : `STORED automatic=${outcome.stored.automatic} status=${outcome.stored.status}`} rows=${JSON.stringify(rows)}`);
  f.sql.close();
  return outcome;
}

const SIGNED_CAPTURE = (prepared, i) => prepared.request.captures[i].capture.id;
const UNSIGNED = 'a'.repeat(64);

test('R04-F2 refuses an unsigned measurement.geometry_artifact_sha256 (no geometry artifact was signed)', async () => {
  const r = await attempt('measurement.geometry_artifact_sha256 forged', (ev) => { ev.metrology.value[0].geometry_artifact_sha256 = UNSIGNED; });
  assert.ok(r.refused, `BYPASS: stored automatic evidence citing geometry artifact ${UNSIGNED}`);
});

test('R04-F2 refuses an unsigned measurement.calibration_sha256 (signed calibration is null)', async () => {
  const r = await attempt('measurement.calibration_sha256 forged', (ev) => { ev.metrology.value[0].calibration_sha256 = 'b'.repeat(64); });
  assert.ok(r.refused, 'BYPASS: stored automatic evidence citing an unsigned calibration hash');
});

test('R04-F2 refuses an unsigned measurement.uncertainty_report_sha256', async () => {
  const r = await attempt('measurement.uncertainty_report_sha256 forged', (ev) => { ev.metrology.value[1].uncertainty_report_sha256 = 'c'.repeat(64); });
  assert.ok(r.refused, 'BYPASS: stored automatic evidence citing an unsigned uncertainty report');
});

test('R04-F2 refuses an unsigned measurement.axis_registration_id (signed axis_registration is null)', async () => {
  const r = await attempt('measurement.axis_registration_id forged', (ev) => { ev.metrology.value[0].axis_registration_id = '00000000-0000-4000-8000-0000000000ee'; });
  assert.ok(r.refused, 'BYPASS: stored automatic evidence citing an unsigned axis registration');
});

test('R04-F2 refuses an unsigned measurement.reference_id', async () => {
  const r = await attempt('measurement.reference_id forged', (ev) => { ev.metrology.value[0].reference_id = 'card-unlisted'; });
  assert.ok(r.refused, 'BYPASS: stored automatic evidence citing an unlisted reference card');
});

test('R04-F2 refuses uppercase hex in a view capture_sha256', async () => {
  const r = await attempt('defect view capture_sha256 uppercase', (ev, prepared) => { ev.defects.value.views[0].capture_sha256 = prepared.request.captures[0].verified_sha256.toUpperCase(); });
  assert.ok(r.refused, 'uppercase hash accepted');
});

test('R04-F2 refuses an uppercase capture_id in a measurement', async () => {
  const r = await attempt('measurement capture_id uppercase', (ev, prepared) => { ev.metrology.value[0].capture_id = prepared.request.captures[1].capture.id.toUpperCase(); });
  assert.ok(r.refused, 'uppercase capture id accepted');
});

test('R04-F2 refuses two defect views for one capture', async () => {
  const r = await attempt('duplicate defect view', (ev) => { ev.defects.value.views.push(structuredClone(ev.defects.value.views[0])); });
  assert.ok(r.refused, 'duplicate view accepted');
});

test('R04-F2 refuses duplicate evidence.capture_ids', async () => {
  const r = await attempt('evidence.capture_ids duplicated', (ev) => { ev.capture_ids = [ev.capture_ids[0], ev.capture_ids[0], ev.capture_ids[2]]; });
  assert.ok(r.refused, 'duplicate capture_ids accepted');
});

test('R04-F2 refuses an extra capture_sha256 on a defect region', async () => {
  const r = await attempt('region carries an unsigned capture_sha256', (ev) => { ev.defects.value.regions[0].capture_sha256 = 'd'.repeat(64); });
  assert.ok(r.refused, 'extra nested hash on region accepted');
});

test('R04-F2 refuses a measurement whose capture_sha256 is the signed hash of a different capture', async () => {
  const r = await attempt('measurement pairs capture 0 with capture 1 hash', (ev, prepared) => {
    ev.metrology.value[0].capture_id = prepared.request.captures[0].capture.id;
    ev.metrology.value[0].capture_sha256 = prepared.request.captures[1].verified_sha256;
  });
  assert.ok(r.refused, 'mismatched id/hash pair accepted');
});

test('R04-F2 control: the signed pairing is stored', async () => {
  const r = await attempt('control', () => {});
  assert.ok(r.stored, JSON.stringify(r));
});
```

### A.4 yarnflow/tests/_r04_tmp/r04-f3-clock.test.mjs (Finding 3, B5 and the number-clock observation)

```js
// R04 finding 3: commit-time checks must use a fresh clock reading, and nothing may be written when a precondition has lapsed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSetup, countsDouble, store, isCode, fixtureDouble, activeReleaseDouble, uploadedDouble, analysisDouble, candidateDouble, allOkEvidence } from './r04-helpers.mjs';

const expiresOf = release => Date.parse(release.expires_at);

test('R04-F3 release expiring exactly at the fresh reading writes nothing', async () => {
  const { f, release, u, a } = await automaticSetup();
  const before = countsDouble(f);
  let calls = 0; const clock = () => (++calls === 1 ? f.now : expiresOf(release));
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, clock), isCode('CONFLICT'));
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('R04-F3 release expiring 1 ms after the fresh reading is still a valid commit (control)', async () => {
  const { f, release, u, a } = await automaticSetup();
  let calls = 0; const clock = () => (++calls === 1 ? f.now : expiresOf(release) - 1);
  const decision = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, clock);
  assert.equal(decision.automatic, true);
  f.sql.close();
});

test('R04-F3 deadline reached at the second reading writes nothing and expires the request', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  let calls = 0; const clock = () => (++calls === 1 ? f.now : a.started.deadline_at);
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, clock), isCode('DEADLINE_EXCEEDED'));
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('R04-F3 a number instead of a clock function: stale constant (API hazard, production passes a function)', async () => {
  // Release lapses 5 ms after prepare; the caller passes the prepare-time number. Real time has passed expiry by the commit.
  const f = await fixtureDouble();
  const release = await activeReleaseDouble(f, 5), u = await uploadedDouble(f), a = await analysisDouble(f, u);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), true);
  await new Promise(r => setTimeout(r, 30));
  const realNow = Date.now(), expires = expiresOf(release);
  let outcome;
  try { outcome = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now); } catch (error) { outcome = error; }
  console.log(`[F3] number clock: real Date.now()=${new Date(realNow).toISOString()} > release expires_at=${release.expires_at}; finalize with number ${new Date(f.now).toISOString()} -> ${outcome.code ? outcome.code : 'COMMITTED automatic=' + outcome.automatic + ' status=' + outcome.status}`);
  f.sql.close();
});

test('R04-F3 KNOWN RESIDUAL: release lapses while the commit batch is running', async () => {
  const { f, release, u, a } = await automaticSetup();
  const before = countsDouble(f);
  let dbTime = f.now; const clock = () => f.now; // both in-process readings see the pre-lapse time
  const db = { prepare: (...args) => f.env.DB.prepare(...args), batch: async statements => { dbTime = expiresOf(release) + 1; return f.env.DB.batch(statements); } };
  let outcome;
  try { outcome = await store.finalizeQC(db, f.ctx, a, u.result.revision, clock); } catch (error) { outcome = error; }
  const after = countsDouble(f);
  console.log(`[F3] lapse during batch: DB time ${new Date(dbTime).toISOString()} > expires ${release.expires_at}; result=${outcome.code ?? 'COMMITTED automatic=' + outcome.automatic + ' status=' + outcome.status}; rows written=${JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - before[k]])))}`);
  f.sql.close();
  assert.ok(outcome.code === 'CONFLICT', `RESIDUAL: committed ${JSON.stringify(outcome.status ?? outcome.code)} although the release lapsed before the batch ran`);
});
```

### A.5 yarnflow/tests/_r04_tmp/r04-f4-decision.test.mjs (Finding 4, all held)

```js
// R04 finding 4: a new capture set (or any new evidence) must not leave an old decision current.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSetup, store, doubleRecord, idemDouble, sha256Hex, countsDouble, fixtureDouble, uploadedDouble, analysisDouble, candidateDouble, allOkEvidence } from './r04-helpers.mjs';

const currentOf = (f, sampleId) => f.sql.prepare('SELECT current_decision_id FROM qc_samples WHERE id=?').get(sampleId).current_decision_id;
const openSets = (f, sampleId) => f.sql.prepare("SELECT COUNT(*) AS n FROM qc_capture_sets WHERE sample_id=? AND state='OPEN'").get(sampleId).n;

async function captureInput(f, setId, role, expectedRevision) {
  const bytes = new Uint8Array([9, 9, 9, role.length]), hash = await sha256Hex(bytes);
  const attestation = { ...doubleRecord('attestation-web-unobserved'), image_sha256: hash };
  return { capture_set_id: setId, meta: { capture_id: crypto.randomUUID(), role, expected_revision: expectedRevision, sha256: hash, taken_at: new Date(f.now).toISOString(), device_profile_id: 'test-double-device', calibration_id: null, consent_record_id: f.consent.id, attestation }, bytes, width: 100, height: 100, mediaType: 'image/jpeg' };
}

test('R04-F4 after a decision, a new capture set clears current and the old set cannot take captures', async () => {
  const { f, u, a } = await automaticSetup();
  const decision = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now);
  const sample = u.result.sample.id;
  assert.equal(currentOf(f, sample), decision.id);
  const rev = (await store.loadResult(f.env.DB, f.workspaceId, sample, f.now)).revision;
  await store.createCaptureSet(f.env.DB, f.ctx, { sample_id: sample, expected_revision: rev, idem: await idemDouble('/capture-sets', { sample_id: sample, expected_revision: rev }) }, f.now);
  assert.equal(currentOf(f, sample), null);
  const before = countsDouble(f);
  const input = await captureInput(f, u.set.id, 'overview', (await store.loadResult(f.env.DB, f.workspaceId, sample, f.now)).revision);
  let outcome; try { outcome = await store.addCapture(f.env.DB, f.env.BUCKET, f.ctx, input, f.now); } catch (error) { outcome = error; }
  console.log(`[F4] addCapture to closed old set after new set: ${outcome.code ?? 'stored'} current=${currentOf(f, sample)}`);
  assert.ok(outcome.code === 'CONFLICT', `old set accepted a capture: ${outcome.code ?? 'stored'}`);
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('R04-F4 createCaptureSet refuses while a set is open, and an open set never sits beside a current decision', async () => {
  const { f, u, a } = await automaticSetup();
  await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now);
  const sample = u.result.sample.id, rev = (await store.loadResult(f.env.DB, f.workspaceId, sample, f.now)).revision;
  const first = await store.createCaptureSet(f.env.DB, f.ctx, { sample_id: sample, expected_revision: rev }, f.now);
  assert.equal(first.body.decision, null);
  const again = await store.createCaptureSet(f.env.DB, f.ctx, { sample_id: sample, expected_revision: first.body.revision }, f.now).catch(e => e);
  assert.equal(again.code, 'CONFLICT');
  assert.ok(openSets(f, sample) === 1 && currentOf(f, sample) === null);
  f.sql.close();
});

test('R04-F4 race: finalize of set A and createCaptureSet on the same sample cannot leave a current decision beside an open set', async () => {
  const { f, u, a } = await automaticSetup();
  const sample = u.result.sample.id, rev = u.result.revision;
  const results = await Promise.allSettled([
    store.finalizeQC(f.env.DB, f.ctx, a, rev, f.now),
    store.createCaptureSet(f.env.DB, f.ctx, { sample_id: sample, expected_revision: rev }, f.now),
  ]);
  const summary = results.map(r => (r.status === 'fulfilled' ? 'ok' : r.reason.code)).join(' / ');
  console.log(`[F4] race outcomes: ${summary}; openSets=${openSets(f, sample)} current=${currentOf(f, sample)}`);
  assert.ok(!(openSets(f, sample) > 0 && currentOf(f, sample) !== null), 'open set beside a current decision');
  f.sql.close();
});

test('R04-F4 an old set analysed under a stale revision cannot re-point current after a new set exists', async () => {
  const { f, u, a } = await automaticSetup();
  const sample = u.result.sample.id, rev = u.result.revision;
  await store.createCaptureSet(f.env.DB, f.ctx, { sample_id: sample, expected_revision: rev }, f.now).catch(e => e);
  const late = await store.finalizeQC(f.env.DB, f.ctx, a, rev, f.now).catch(e => e);
  assert.ok(late.code === 'CONFLICT', `stale finalize: ${late.code ?? 'committed'}`);
  assert.equal(currentOf(f, sample), null);
  f.sql.close();
});

test('R04-F4 linked successor under a new spec: predecessor cannot take captures and successor starts with no decision', async () => {
  const f = await fixtureDouble();
  const u = await uploadedDouble(f), a = await analysisDouble(f, u);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), false);
  const decision = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now);
  const predecessor = u.result.sample.id;
  await store.confirmSpec(f.env.DB, f.manager, { ...f.specInput, expected_spec_version: 1 }, f.now);
  const v2 = (await store.getSpec(f.env.DB, f.workspaceId, f.spec.id)).spec;
  const pre = await store.loadResult(f.env.DB, f.workspaceId, predecessor, f.now);
  const linked = await store.createSampleEvaluation(f.env.DB, f.ctx, { selection_id: f.selection.id, spec_id: v2.id, spec_version: v2.version, predecessor_sample_id: predecessor, expected_predecessor_revision: pre.revision, reason: 'spec revised' }, f.now);
  const successorId = linked.sample_id ?? linked.sample?.id ?? (await store.listSamples(f.env.DB, f.workspaceId)).find(s => s.spec_version === v2.version).sample_id;
  console.log(`[F4] successor current=${currentOf(f, successorId)}; predecessor current=${currentOf(f, predecessor)} (decision ${decision.id}); predecessor listSamples status=${(await store.listSamples(f.env.DB, f.workspaceId)).find(s => s.sample_id === predecessor).status}`);
  assert.equal(currentOf(f, successorId), null);
  await assert.rejects(store.createCaptureSet(f.env.DB, f.ctx, { sample_id: predecessor, expected_revision: pre.revision }, f.now), e => e.code === 'CONFLICT');
  f.sql.close();
});
```

### A.6 yarnflow/tests/_r04_tmp/r04-f6-binding.test.mjs (Finding 6, B4)

```js
// R04 finding 6 (Worker side): does the Worker bind the domain manifest and policy hashes to the release?
// The stored release row carries domain_json and policy_json beside the release JSON that holds domain_sha256 / policy_sha256.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSetup, allOkEvidence, candidateDouble, countsDouble, store, contentSha256, HASH_EXCLUDES } from './r04-helpers.mjs';

async function tamperRow(f, releaseId, column, mutate, exclude) {
  // Models a DB administrator: the immutability trigger is dropped before the write (no code path does this).
  f.sql.exec('DROP TRIGGER IF EXISTS qc_releases_transition');
  const row = JSON.parse(f.sql.prepare(`SELECT ${column} AS v FROM qc_releases WHERE id=?`).get(releaseId).v);
  mutate(row);
  row.sha256 = await contentSha256(row, exclude);
  f.sql.prepare(`UPDATE qc_releases SET ${column}=? WHERE id=?`).run(JSON.stringify(row), releaseId);
  return row;
}

async function run(name, f, u, a) {
  const before = countsDouble(f);
  let outcome;
  try { outcome = { stored: await store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate: a.candidate }, u.result.revision, f.now) }; }
  catch (error) { outcome = { refused: `${error.code} ${error.message}` }; }
  const rows = Object.fromEntries(Object.entries(countsDouble(f)).map(([k, v]) => [k, v - before[k]]));
  console.log(`[F6] ${name}: ${outcome.refused ? 'refused ' + outcome.refused : `STORED automatic=${outcome.stored.automatic} status=${outcome.stored.status}`} rows=${JSON.stringify(rows)}`);
  return outcome;
}

test('R04-F6 control: consistent release, domain and policy are stored automatically', async () => {
  const { f, u, a } = await automaticSetup();
  const out = await run('control', f, u, a);
  assert.ok(out.stored?.automatic === true);
  f.sql.close();
});

test('R04-F6 refuses automatic when release.domain_sha256 does not match the stored domain manifest', async () => {
  const { f, release, u, a } = await automaticSetup();
  // Storage-level change (DB write): domain JSON is replaced by a self-consistent manifest with a looser hold threshold.
  await tamperRow(f, release.id, 'domain_json', d => { d.defect_accept_below = 0.99; d.defect_hold_at_or_above = 0.995; }, HASH_EXCLUDES.DomainManifest);
  // The Worker re-reads the release for the commit. Candidate is the scanner's automatic ACCEPT for this evidence.
  a.prepared = await (await import('./r04-helpers.mjs')).store.prepareAnalysis(f.env.DB, f.env.BUCKET, f.ctx, { sample_id: u.result.sample.id, capture_set_id: u.set.id, expected_revision: u.result.revision }, a.started, f.now);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), true);
  console.log(`[F6] prepared.domain.sha256=${a.prepared.domain.sha256.slice(0, 12)} release.domain_sha256=${a.prepared.release.domain_sha256.slice(0, 12)}`);
  const out = await run('domain manifest not bound to release', f, u, a);
  assert.ok(out.refused, `BYPASS: automatic ${out.stored?.status} stored with a domain manifest whose hash the release does not name`);
  f.sql.close();
});

test('R04-F6 refuses automatic when release.policy_sha256 does not match the stored policy', async () => {
  const { f, release, u, a } = await automaticSetup();
  await tamperRow(f, release.id, 'policy_json', p => { p.version = 'automatic-tampered'; }, HASH_EXCLUDES.Policy);
  a.prepared = await (await import('./r04-helpers.mjs')).store.prepareAnalysis(f.env.DB, f.env.BUCKET, f.ctx, { sample_id: u.result.sample.id, capture_set_id: u.set.id, expected_revision: u.result.revision }, a.started, f.now);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), true);
  console.log(`[F6] prepared.policy.sha256=${a.prepared.policy.sha256.slice(0, 12)} release.policy_sha256=${a.prepared.release.policy_sha256.slice(0, 12)}`);
  const out = await run('policy not bound to release', f, u, a);
  assert.ok(out.refused, `BYPASS: automatic ${out.stored?.status} stored under a policy the release does not name`);
  f.sql.close();
});

test('R04-F6 refuses automatic when the release carries no domain manifest', async () => {
  const { f, release, u, a } = await automaticSetup();
  f.sql.exec('DROP TRIGGER IF EXISTS qc_releases_transition');
  f.sql.prepare('UPDATE qc_releases SET domain_json=? WHERE id=?').run('null', release.id);
  a.prepared = await (await import('./r04-helpers.mjs')).store.prepareAnalysis(f.env.DB, f.env.BUCKET, f.ctx, { sample_id: u.result.sample.id, capture_set_id: u.set.id, expected_revision: u.result.revision }, a.started, f.now);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), true);
  const out = await run('no domain manifest', f, u, a);
  assert.ok(out.refused, 'automatic stored with no domain');
  f.sql.close();
});

test('R04-F6 refuses automatic when evidence.domain_id names another domain', async () => {
  const { f, u, a } = await automaticSetup();
  const ev = allOkEvidence(a.prepared, f.now); ev.domain_id = 'other-domain';
  a.candidate = await candidateDouble(a.prepared, a.started, ev, true);
  const out = await run('domain id mismatch', f, u, a);
  assert.ok(out.refused, 'automatic stored for another domain');
  f.sql.close();
});
```

### A.7 scanner/tests/_r04_tmp/test_r04_policy.py (Findings 5, 6, 7; B2)

```python
"""R04 re-attack of the R01 policy fixes (throwaway; deleted after the review).

Each test asserts the SECURE expectation. A failing assertion is a bypass; the printed
actual value is the evidence.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from services.api.qc_schemas import (
    DomainManifest,
    EvaluationContext,
    Evidence,
    Policy,
    PurchaseSpec,
    Release,
    content_sha256,
)
from services.consistency.qc_policy import evaluate_qc

FIXTURES = {
    e["name"]: e["value"]
    for e in json.loads(
        (Path(__file__).resolve().parents[1] / "fixtures" / "qc-v2" / "valid.json").read_text("utf-8")
    )
}
SPEC = PurchaseSpec.model_validate(FIXTURES["spec-woven-v1"])
AUTO = Policy.model_validate(FIXTURES["policy-automatic"])
REVIEW_ONLY = Policy.model_validate(FIXTURES["policy-review-only"])
ACTIVE = Release.model_validate(FIXTURES["release-active"])
DOMAIN = DomainManifest.model_validate(FIXTURES["domain-manifest"])
CONTEXT = EvaluationContext.model_validate(FIXTURES["evaluation-context"])
AUTOMATIC = {"ACCEPT", "HOLD"}


def raw(**changes) -> dict:
    """Fixture evidence with dotted or '__' paths changed, manifest re-hashed."""
    data = copy.deepcopy(FIXTURES["evidence-synthetic-all-stages-ok"])
    data["fabric"]["value"]["calibrated_probability"] = 0.97
    for path, value in changes.items():
        node = data
        *parents, last = path.replace("__", ".").split(".")
        for p in parents:
            node = node[int(p)] if isinstance(node, list) else node[p]
        node[int(last) if isinstance(node, list) else last] = value
    data["manifest_sha256"] = content_sha256(data, exclude=("manifest_sha256", "id", "created_at"))
    return data


def decide(data: dict, attempt: int = 1, policy=AUTO, release=ACTIVE, domain=DOMAIN):
    return evaluate_qc(Evidence.model_validate(data), SPEC, policy, release, attempt, CONTEXT, domain=domain)


def abstained(*reasons: str) -> dict:
    return {"state": "ABSTAINED", "value": None, "reasons": list(reasons), "artifact_sha256": None, "duration_ms": 1.0}


# ---------------------------------------------------------------- control
def test_control_all_ok_is_accept():
    d = decide(raw())
    assert (d.status, d.automatic) == ("ACCEPT", True), d


# ---------------------------------------------------------------- finding 5: aggregate defect score
def test_f5_control_aggregate_equal_to_max_view_at_accept_boundary_is_review():
    # views max = 0.2 = defect_accept_below (inclusive grey zone) -> must NOT be an automatic ACCEPT
    d = decide(raw(**{"defects.value.score": 0.2, "defects.value.views.0.score": 0.2}))
    assert d.status == "MANUAL_REVIEW" and "DEFECT_SUSPECTED" in d.reasons, d


def test_f5_abs_tol_edge_view_at_accept_boundary_must_not_be_automatic_accept():
    # aggregate is 5e-10 under the largest view; isclose(abs_tol=1e-9) accepts it, and the
    # threshold is then tested against the aggregate, so the view at 0.2 is silently skipped.
    d = decide(raw(**{"defects.value.score": 0.2 - 5e-10, "defects.value.views.0.score": 0.2}))
    print("F5 abs_tol edge actual:", d.status, d.automatic, d.reasons)
    assert not (d.status == "ACCEPT" and d.automatic), f"BYPASS: automatic {d.status} {d.reasons}"
    assert d.status == "MANUAL_REVIEW", d


def test_f5_abs_tol_outside_tolerance_is_review():
    d = decide(raw(**{"defects.value.score": 0.2 - 2e-9, "defects.value.views.0.score": 0.2}))
    assert d.status == "MANUAL_REVIEW" and "STAGE_UNAVAILABLE" in d.reasons, d


def test_f5_view_above_hold_with_matching_aggregate_is_hold_not_accept():
    d = decide(raw(**{"defects.value.score": 0.85, "defects.value.views.0.score": 0.85}))
    assert (d.status, d.automatic) == ("HOLD", True) and d.reasons == ["DEFECT_SUSPECTED"], d


def test_f5_nan_and_inf_scores_never_reach_policy():
    # Non-finite values cannot be hashed, so the manifest is left as-is: the schema must refuse on its own.
    for bad in (float("nan"), float("inf"), -float("inf")):
        for path in (("defects", "value", "score"), ("defects", "value", "views", 0, "score")):
            data = copy.deepcopy(FIXTURES["evidence-synthetic-all-stages-ok"])
            node = data
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = bad
            with pytest.raises(ValidationError):
                Evidence.model_validate(data)


def test_f5_view_from_a_capture_outside_the_evidence_is_refused():
    with pytest.raises(ValidationError):
        Evidence.model_validate(raw(**{"defects.value.views.0.capture_id": "00000000-0000-4000-8000-0000000000ff"}))


def test_f5_empty_views_is_refused_at_schema_level():
    with pytest.raises(ValidationError):
        Evidence.model_validate(raw(**{"defects.value.views": []}))


# ---------------------------------------------------------------- finding 6: artifact hashes / domain binding
def test_f6_domain_none_is_review_even_with_active_release():
    d = decide(raw(), domain=None)
    assert d.status == "MANUAL_REVIEW" and not d.automatic, d


@pytest.mark.parametrize(
    "path",
    [
        "defects.artifact_sha256",
        "fabric.artifact_sha256",
        "quality.artifact_sha256",
        "metrology.artifact_sha256",
        "domain.artifact_sha256",
    ],
)
def test_f6_each_stage_artifact_hash_mismatch_is_review(path):
    d = decide(raw(**{path: "f" * 64}))
    assert not d.automatic, f"{path}: BYPASS {d.status} {d.reasons}"
    assert "DOMAIN_UNVALIDATED" in d.reasons, d


def test_f6_domain_manifest_recomputed_but_not_bound_to_release_is_review():
    # Attacker-style: a domain with a different defect artifact and a self-consistent sha256,
    # which the (unchanged) release does not name.
    changed = DOMAIN.model_dump()
    changed["defect_artifact_sha256"] = "e" * 64
    changed.pop("sha256")
    changed["sha256"] = content_sha256(changed, exclude=("sha256",))
    other = DomainManifest.model_validate(changed)
    d = decide(raw(**{"defects.artifact_sha256": "e" * 64}), domain=other)
    assert not d.automatic, f"BYPASS: {d.status} {d.reasons}"


def test_f6_domain_with_stale_sha256_is_review():
    changed = DOMAIN.model_dump()
    changed["fabric_artifact_sha256"] = "d" * 64  # sha256 left stale
    other = DomainManifest.model_validate(changed)
    d = decide(raw(), domain=other)
    assert not d.automatic and "DOMAIN_UNVALIDATED" in d.reasons, d


def test_f6_ok_stage_without_artifact_hash_is_refused():
    data = raw()
    data["defects"]["artifact_sha256"] = None
    data["manifest_sha256"] = content_sha256(data, exclude=("manifest_sha256", "id", "created_at"))
    with pytest.raises(ValidationError):
        Evidence.model_validate(data)


# ---------------------------------------------------------------- finding 7: reasons on OK stages / recapture
@pytest.mark.parametrize("stage", ["fabric", "defects", "domain"])
def test_f7_capture_fixable_reason_on_non_recapturable_abstained_stage_is_not_recapture(stage):
    d = decide(raw(**{stage: abstained("QUALITY_BLUR")}))
    print(f"F7 {stage} ABSTAINED+QUALITY_BLUR actual:", d.status, d.reasons)
    assert d.status == "MANUAL_REVIEW", f"{stage}: {d.status} {d.reasons}"


def test_f7_control_metrology_abstained_fixable_is_recapture():
    d = decide(raw(metrology=abstained("SCALE_MISSING")))
    assert d.status == "RECAPTURE" and not d.automatic, d


@pytest.mark.parametrize("stage", ["fabric", "defects", "domain", "metrology"])
def test_f7_capture_fixable_reason_on_ok_stage_is_not_accept_or_hold(stage):
    d = decide(raw(**{f"{stage}.reasons": ["QUALITY_BLUR"]}))
    assert not d.automatic, f"{stage} OK+QUALITY_BLUR: BYPASS {d.status} {d.reasons}"


def test_f7_attempt_three_with_fixable_reason_is_review_not_recapture():
    d = decide(raw(**{"quality.reasons": ["QUALITY_BLUR"]}), attempt=3)
    assert d.status == "MANUAL_REVIEW" and "RECAPTURE_LIMIT" in d.reasons, d


@pytest.mark.parametrize("reason", ["OOD", "PATTERN_AMBIGUOUS", "CALIBRATION_EXPIRED", "STAGE_UNAVAILABLE"])
def test_f7_non_fixable_reason_on_ok_stage_is_review(reason):
    d = decide(raw(**{"defects.reasons": [reason]}))
    assert d.status == "MANUAL_REVIEW" and not d.automatic, d


def test_f7_review_only_with_ok_stage_reason_never_automatic_and_never_hold():
    data = raw(**{"defects.value.score": 0.95, "defects.value.views.0.score": 0.95, "defects.reasons": ["PATTERN_AMBIGUOUS"]})
    d = decide(data, policy=REVIEW_ONLY, release=None, domain=DOMAIN)
    assert not d.automatic and d.status != "HOLD", d


def test_f5_empty_regions_do_not_change_the_decision():
    # Regions are not an input to the decision: emptying them must leave the ACCEPT unchanged.
    d = decide(raw(**{"defects.value.regions": []}))
    assert (d.status, d.automatic) == ("ACCEPT", True), d
```

## Appendix B: commands and raw summary output

```
$ cd yarnflow && node --test tests/_r04_tmp/r04-f1-clamp.test.mjs      # ℹ pass 14 / ℹ fail 4
$ cd yarnflow && node --test tests/_r04_tmp/r04-f2-nested.test.mjs     # ℹ pass 7 / ℹ fail 5
$ cd yarnflow && node --test tests/_r04_tmp/r04-f3-clock.test.mjs      # ℹ pass 4 / ℹ fail 1
$ cd yarnflow && node --test tests/_r04_tmp/r04-f4-decision.test.mjs   # ℹ pass 5 / ℹ fail 0
$ cd yarnflow && node --test tests/_r04_tmp/r04-f6-binding.test.mjs    # ℹ pass 3 / ℹ fail 2
$ cd scanner && ../.venv/bin/python -m pytest tests/_r04_tmp/test_r04_policy.py -p no:cacheprovider
1 failed, 31 passed in 0.14s   (the failure is B2)
```

The baseline suites were unchanged: `node --test tests/qc-r01.test.mjs` gave 6/6, and `pytest tests/test_qc_policy.py` gave 103 passed.
