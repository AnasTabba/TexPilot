# Reviewer 06 — fail-closed decision policy

Recommendation: **revise before implementation/promotion**. No P0 found. The proposed default REVIEW_ONLY and gated HOLD are sound, but the authoritative contract and policy acceptance tests leave the following P1 fail-open paths insufficiently specified. This is a source/document review, not evidence that v2 is implemented or physically validated.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (§§2–13)
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (contract ownership, endpoint map, T01–T13)
- `scanner/services/consistency/engine.py`
- `scanner/services/api/{pipeline,config,main,spec}.py`
- `scanner/services/vision/{predictor,scanner,quality,threads}.py`

## Findings

### P1 — An OK metrology list need not cover the PO axes exactly

**Evidence:** Design lines 52–59 and 70–79 type density and metrology as arrays; line 86 requires only non-null schema-valid OK values. Line 94 accepts when “entire uncertainty intervals inside all tolerances,” but does not require a one-to-one measurement for every required axis, forbid duplicate axes, or require the reported value to lie inside its interval. Design line 102 requires woven ends/picks or knit wales/courses in the PO; plan T01 line 52 tests empty *required axes* but neither T01 nor T03 line 76 asserts measurement-set completeness. Existing `scanner/services/vision/threads.py:30–38` explicitly permits one/both counts to be None; existing `scanner/services/api/spec.py:182–185` exposes rounded point estimates/spread, not validated intervals. The proposed adapter therefore cannot assume existing measurement output already satisfies this invariant.

**Failure case:** Valid two-axis woven PO plus `metrology={state:OK,value:[]}` or only one in-tolerance axis can satisfy a vacuous/per-present-measurement all-inside implementation. Duplicate ends measurements can similarly conceal a missing picks measurement. These payloads have no expressly forbidden shape in the authoritative types.

**Correction:** Specify construction-specific unique PO axes and exact required-axis coverage in successful metrology, with canonical units, valid reference/method binding, and `0 <= interval.low <= value <= interval.high`. Missing/duplicate/wrong-construction axes must prevent both automatic statuses; invalid serialized shapes should fail validation, while unavailable observations should use an explicit abstained stage.

**Test assertion:** Starting from an ACCEPT fixture, delete picks, empty the list, duplicate ends, substitute courses, and place value outside its interval; each must fail validation or yield MANUAL_REVIEW, never ACCEPT/HOLD. Complete valid ends/picks still accepts.

### P1 — OOD absence has no explicit required execution state

**Evidence:** Design line 94 makes OOD a blocker and line 112 requires testing an OOD detector; however Evidence at lines 72–79 has no OOD stage or required OOD result. `fabric` has only label, probability, unknown; an empty reasons/contradictions array can mean either in-domain or never checked. Plan T03 line 76 tests positive unknown/OOD, while T06 lines 110–112 does not explicitly require OOD execution/readiness. Actual `scanner/services/vision/predictor.py:89–99` derives unknown from an abstaining classifier's candidates, and `VisionOutput` at lines 54–69 has no separate OOD result. Legacy confidence/unknown therefore is not proof of a successful domain check.

**Failure case:** An adapter emits a confident known label with `unknown=false` and never runs domain/OOD assessment; all four declared stages are OK and no OOD reason is emitted, permitting automation under a released manifest despite missing required OOD evidence.

**Correction:** Define an explicit versioned OOD/domain-assessment stage or a mandatory equivalent discriminated result inside fabric, including successful in-domain result versus FAILED/DISABLED/NOT_RUN and the released artifact binding. If a release intentionally relies on a combined classifier/unknown detector, specify that combined check and its validated operating domain explicitly; do not infer successful evaluation from absence of OOD reasons.

**Test assertion:** A confident known-label fixture with absent/disabled/failed domain assessment must never ACCEPT/HOLD; only an executed, release-compatible assessment can clear the gate. Readiness must distinguish an absent detector from an executed in-domain result.

### P1 — Pure policy lacks an explicit evaluation-time input for expiry

**Evidence:** Plan line 36 explicitly gives Release an expiry and policy returns a DecisionDraft without time; T03 lines 74–76 requires a pure `evaluate_qc(evidence,spec,policy,release,attempt)` and an expired-release test. Design lines 92–94 also calls the evaluator pure and requires expired-calibration handling. There is no `now`/evaluation context input; Evidence has `created_at` (line 79), Capture carries only calibration ID (lines 64–67), and persistence adds decision time afterward (plan line 36). Finalization is required to recheck spec/release/capture hashes (design line 138, T05 line 100), but hash equality does not detect time expiry while inference is running.

**Failure case:** Unchanged signed release/calibration expires between evidence production and finalization. Evaluating at evidence creation time accepts an expired authorization; consulting wall clock inside the function violates the promised deterministic/pure boundary. T05's “stale release” test can pass with only a version/hash change and miss this case.

**Correction:** Add a server-supplied immutable evaluation context with evaluation time and resolved calibration validity/bindings, or explicitly assign all temporal authorization to the finalizing authority with a typed validated context consumed by policy. Define expiry boundary (`now >= expires_at`), future timestamps, and clock ownership. Finalization must revalidate current release suspension/expiry and calibration validity at commit time, not solely matching hashes.

**Test assertion:** With identical evidence/release hashes, evaluate immediately before and at expiry using injected times; at/after expiry cannot automate. Advance the clock across release or calibration expiry during inference and assert zero automatic decision commits (409/review according to the chosen explicit contract). Suspension must likewise invalidate an unchanged artifact bundle.

## Existing behavior versus proposal and external gates

Existing `scanner/services/consistency/engine.py:79–131` decides composition plausibility; `scanner/services/api/pipeline.py:130–153` appends fault flags after that verdict. `scanner/services/api/config.py:73–84` can start without a failed optional fault model, and `scanner/services/api/main.py:98–110` returns a verdict after save failure. These are existing v1 semantics, not v2 implementation defects to silently change: the draft correctly requires a separate fail-closed v2 boundary and no PASS-to-ACCEPT coercion (T06).

G1–G8 remain external authority/evidence gates, not approvals this review grants. Synthetic policy fixtures cannot establish physical calibration, rights, independent risk bounds, sampling authority, or security signoff. After correcting the contract/tests above, implement and demonstrate the default review-only path first; automated ACCEPT and HOLD remain unavailable until the named gates and release evidence actually pass.

## Proof and limitations

Read-only source tracing and line-numbered inspection established the findings; no product files changed and no installation, GPU/Kaggle job, deployment, purchase, or commit performed. No proposed v2 tests were executed because this deliverable reviews the draft rather than implementing its missing modules. Only this review document is owned by reviewer 06.
