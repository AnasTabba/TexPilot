# Reviewer 07 — statistics, calibration and selective risk

Reviewed 12 November 2026. Independent actual reviewer; source inspection only, no training, deployment, installation or product edits. Recommendation: **revise before executing statistical release work; retain REVIEW_ONLY until external gates pass**. No P0 found.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (especially §§1,3–4,6–8,11).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (T04,T09–T13 and proof matrix).
- `scanner/training/scanner/calibration.py`; `scanner/tests/test_scanner_calibration.py`.
- `scanner/training/textilenet/{abstain_eval,splits,train}.py`.
- `scanner/services/vision/{heads,scanner,predictor}.py`.
- `scanner/training/fault/metrics.py`.

## Findings

### P1 — Calibrate the served capture-set score, not a convenient cached image score

**Evidence:** Design §3 defines one fabric `calibrated_probability` for multiple `capture_ids`; §§4/8 bind calibration/preprocessing artifacts but do not define capture selection, weighting or aggregation. T11 lines 170–176 provides a release-bound function and generic report assertions but no calibration-to-serving equivalence assertion. Actual `services/vision/heads.py:143–168` temperature-scales each view, optionally merges/drops and renormalizes classes, then averages probabilities. Actual `training/textilenet/abstain_eval.py:169–196` fits temperature and evaluates confidence on cached logits; `training/scanner/calibration.py:48–63` chooses a threshold by empirical classification accuracy. Neither existing mechanism establishes calibration of a new stationary multi-capture QC score, and classification accuracy is not construction false-accept risk.

**Correction:** In T06/T11 pin the exact v2 capture roles, view-selection/aggregation, scope mapping and score function in the bundle. Generate calibration inputs through that same evidence path; existing temperature/threshold utilities may remain fitting primitives, not inherited release authority. Scope/aggregation changes invalidate the associated calibration/release.

**Test assertion:** For fixed multi-view logits and a merge/drop mapping, offline calibration-score generation equals serving output, including probability and abstention at equality thresholds; changing aggregation/scope/hash rejects release compatibility. A high-accuracy classifier with construction-failing accepted samples must fail the QC risk gate.

### P1 — Confirmatory endpoint does not specify how recaptures and decision revisions count

**Evidence:** Design §4 line 94 allows up to three submissions per sample; §9 line 138 allows decision revisions; §7 lines 120–122 defines risk conditional on automatic ACCEPT and one predeclared sample per roll. It never says whether the endpoint is first decision, final decision, or any ACCEPT emitted during the allowed workflow. These differ when a sample first ACCEPTs and later HOLDs, or when operators selectively retry. T11 line 172 excludes correlated tiles but does not assert longitudinal decision reduction. Actual `training/scanner/calibration.py:48–63` and `training/textilenet/abstain_eval.py:48–73` operate on flat rows and provide no workflow reducer; grouped splits alone do not resolve this.

**Correction:** Predeclare an operational endpoint and replay the entire permitted capture/retry workflow per selected independent sample. For exposure to an automatic acceptance, a conservative endpoint is any automatic ACCEPT during that workflow, with reference failure counted even if a later revision corrects it. Report final-state performance separately. Count one submission unit per enrolled sample for sample coverage, with attempt-level capture burden reported separately; predeclare handling of incomplete workflows.

**Test assertion:** ACCEPT→HOLD on one nonconforming sample contributes one accepted independent unit and one false acceptance under an any-ACCEPT endpoint; three captures never create three independent units. Retrying easy successes or dropping unfinished samples cannot improve reported all-enrolled coverage or remove an exposed false acceptance.

### P2 — Matched-risk fusion ablation is promised without an executable comparison protocol

**Evidence:** Design §1 promises classifier-only, classifier+defects, classifier+metrology and full fusion at matched acceptance risk with confidence bounds. T10 lines 158–164 asks for component metrics; T11 lines 170–176 asks for release statistics; neither names ablation configurations, paired coverage comparison, threshold-freezing procedure or a noninferiority criterion. The matrix line 206 assigns ablations to T01/T05/T07/T13 rather than the statistical evaluator. Existing `training/textilenet/abstain_eval.py:192–218` compares confidence rankings on validation and uses image bootstrap; `training/fault/metrics.py:125–147` provides grouped paired F1 bootstrap, not paired QC coverage/risk comparison.

**Correction:** Assign the four fixed offline experimental variants to T10/T11, explicitly distinguishing research ablations with missing stages from deployable all-required-stage policy. Choose each operating point on calibration only, freeze before paired confirmatory evaluation, allocate multiplicity as appropriate, and define whether the claim is risk-bounded coverage gain or a formal risk-difference/noninferiority result. Separate per-system risk bounds do not by themselves prove no risk increase.

**Test assertion:** All variants evaluate identical enrolled independent groups; thresholds cannot use release labels; report paired coverage difference with grouped uncertainty and each variant's accepted count/failure upper bound. No variant emits deployable ACCEPT merely because it is a classifier-only research baseline; insufficient power produces an inconclusive claim.

### P2 — Automatic HOLD quality is reported but has no release criterion

**Evidence:** Design §4 line 94 gates HOLD on a released domain and a released threshold; §7 line 120 reports HOLD precision while headline automation coverage counts ACCEPT+HOLD. T11 line 172 requires an authority risk target and false-accept bounds but only reporting of HOLD precision. Thus a release can satisfy accepted-sample safety while flooding conforming samples with erroneous automatic HOLDs and advertising increased automation. Existing `training/fault/metrics.py:83–119` distinguishes false-alarm rate among good samples from precision; neither transfers automatically to composite fabric/metrology HOLD.

**Correction:** Require authority to explicitly approve a HOLD utility/error criterion (or explicitly approve reporting-only HOLD performance), alongside acceptance risk. Report HOLD precision, conforming-sample HOLD rate, sample counts and uncertainty; do not describe increased ACCEPT+HOLD coverage as useful without this qualification. Numeric tolerances remain an external factory authority choice, not a reviewer-invented default.

**Test assertion:** An evaluator with safe ACCEPTs but HOLD on every remaining conforming sample cannot claim useful coverage gain or silently pass an unspecified HOLD criterion; missing required authority criterion yields review-only/failed gate.

## Existing versus proposed and authority gates

Current source offers empirical classifier temperature/abstention utilities and defect operating-point metrics; it does not implement v2 release certification. The design correctly proposes disjoint grouped cohorts, one-sided exact accepted-unit bounds, zero-safe-automation fallback and independent authority: these should be preserved. In particular, the existing defect `_clopper_pearson` is two-sided (`training/fault/metrics.py:87–90`), so it must not be mistaken for T11's proposed one-sided bound; the explicit 298/299 assertion already guards that distinction. Factory risk tolerance, independent-unit justification, reference adjudication, physical validation and independent QC signature require real external evidence; unit tests cannot discharge them.

Review proof: traced actual score aggregation, calibration fitting, split construction and metric denominators against the proposed contracts and task assertions. No product tests were run because the deliverable is this review and the disputed v2 evaluator is proposed. Resolve the two P1 items before sealing the release protocol; resolve or explicitly scope the P2 items before making the research coverage claim.
