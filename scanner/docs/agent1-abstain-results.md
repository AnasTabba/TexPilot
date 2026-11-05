# Agent 1: abstain threshold and confidence for the fabric head (fabric24, head A)

Scope: the deployed head A (`models/scanner-v8/head_a`, 24 archive classes). Evaluated on cached
logits only (`runs/codex_f1_20261027/task1_baseline/baseline_logits.npz`). Those logits reproduce
the stored macro F1 exactly (val 0.758505, test 0.766591), so no image or encoder was touched and
no GPU was used. Every choice was made on validation. Test was evaluated once per pre-chosen
operating point.

## Headline

- Confidence: temperature-scaled max softmax (the served rule). Kept over margin and entropy: see below.
- Served threshold 0.6697 vs the validation-chosen 0.6653 at a 90% answered-accuracy target. They are
  essentially the same, so `models/scanner-v8/head_a/head.json` is unchanged.
- Trade-off on held-out test (macro F1 on answered leads; floor = abstentions counted as wrong):

| Operating point (val target) | val tau | test coverage | test abstain | test acc (answered) | test macro F1 (answered) | test macro F1 floor (abstain = wrong) |
|---|---:|---:|---:|---:|---:|---:|
| No abstain (deployed logits) | 0 | 1.000 | 0.000 | 0.822 | 0.767 | 0.767 |
| 0.85 | 0.452 | 0.949 | 0.051 | 0.846 | 0.800 | 0.766 |
| **0.90 (primary)** | **0.665** | **0.822** | **0.178** | **0.895** | **0.854** | **0.706** |
| 0.95 | 0.879 | 0.616 | 0.384 | 0.949 | 0.913 | 0.618 |

Read it as: abstaining at the 0.90 point lifts answered accuracy from 0.82 to 0.89 and answered macro
F1 from 0.77 to 0.85. It costs 0.06 of macro F1 once abstentions count as wrong.
Of the 4,334 abstained test images, 2,113 were correct and 2,221 wrong.

Full sweep (201 thresholds, both splits): `training/textilenet/results/abstain/sweep.csv`.
Selected test points (coverage / acc / macro F1 answered / floor):

| tau | coverage | acc | macro F1 answered | floor |
|---:|---:|---:|---:|---:|
| 0.30 | 0.991 | 0.828 | 0.778 | 0.770 |
| 0.50 | 0.927 | 0.856 | 0.812 | 0.754 |
| 0.70 | 0.799 | 0.902 | 0.861 | 0.698 |
| 0.80 | 0.716 | 0.927 | 0.885 | 0.664 |
| 0.90 | 0.575 | 0.956 | 0.923 | 0.593 |

## Calibration

- Temperature fitted on val NLL: T = 0.828. The served T is 0.8249. Test NLL is 0.6103 for both, so
  refitting does not help. Keep the served T.
- Test ECE: 0.0567 uncalibrated (T=1) to 0.0214 (T fitted on val). Reliability diagram:
  `training/textilenet/results/abstain/reliability.png`.
- Caveat: the ECE of 0.0173 recorded in head.json was computed with the class bias that was later
  removed. The served no-bias check gives 0.0213.

## Confidence choice

Validation AURC (lower is better): maxprob 0.05905, margin 0.05808, neg-entropy 0.06151.
A paired bootstrap of the margin-minus-maxprob AURC difference on val gives mean -0.00095,
95% CI [-0.00151, -0.00045], so margin is slightly better beyond resampling noise. Test AURC shows the
same small gap (margin 0.05801 vs maxprob 0.05874).
**Kept max-prob anyway:** the served rule is a max-prob threshold in `services/vision/heads.decide`.
Switching to margin changes the served rule and needs its own calibration, for about 0.001 AURC.
Margin is a candidate if the served rule is ever rebuilt.

## Served-configuration check

Served T and threshold on the no-bias logits give test coverage 0.8201, acc 0.8952, macro F1
answered 0.8540. head.json's recorded test numbers (coverage 0.8106, acc 0.8924) were computed with the
class bias. The "Mac check" in the head A notes (82.3% answered at 89.9%, 2,000 photos) is close to these no-bias numbers (82.0% at 89.5%).

## Per-class abstain rate (test, primary 0.90 point)

Highest: twill 1.00 (n=5, never answered), tulle 0.497 (n=756), serge 0.458 (n=120), crepe 0.410
(n=227), organza 0.330 (n=588), vinyl 0.326 (n=46).
Lowest: faux_fur 0.077 (n=1154), faux_leather 0.086 (n=325), denim 0.109 (n=1691), chiffon 0.117 (n=5673).
Full table: `training/textilenet/results/abstain/per_class_abstain_test.csv`.
Twill has no answer at 0.90, so macro F1 on answered silently drops it. The abstain-as-wrong floor is
the honest number for that reason.

## Exposure (inference path and API)

- `services/vision/predictor.py`: `structure_answer(VisionOutput) -> {label, confidence, unknown} | None`.
  It is built from the existing structure head and its `candidates`. Nothing in inference is duplicated.
- `services/api/schemas.py`: additive `StructureAnswer` model and `ScanResult.structure_answer`.
  The existing `structure` field keeps its null-on-abstain behaviour.
- `services/api/pipeline.py`: sets `structure_answer`.
- The live scanner is not restarted. The new field appears only after a restart. Restart command is in
  NEXT_SESSION.md.

## Files

- Evaluation: `training/textilenet/abstain_eval.py` (run `python -m training.textilenet.abstain_eval`).
- Results: `training/textilenet/results/abstain/`
  - `summary.json`: all numbers, including bootstrap, calibration, operating points, served check
  - `sweep.csv`: threshold sweep, both splits
  - `per_class_abstain_test.csv`
  - `abstained_test.csv`: 4,334 abstained test images, with true label, predicted label, confidence and
    `correct`. Filter `correct=False` for the wrong abstentions.
  - `risk_coverage.png`, `reliability.png`
- Helpers: `training/scanner/calibration.py` (`confidences`, `aurc`); existing `abstain_threshold`,
  `fit_temperature`, `ece` reused.
- Tests: `tests/test_fabric_abstain.py` (6 tests: decide threshold, AURC hand-check, confidence,
  structure_answer cases). Passes with `tests/test_scanner_calibration.py`, `test_scanner_predictor.py`,
  `test_scanner_heads.py`, `test_api.py`.

## Not done

- Nothing committed or pushed. `models/scanner-v8/head_a/head.json` is unchanged.
- yarn-erp not touched.
- Risk-coverage uses only the logits of one seed (the packaged seed 0). The 3-seed spread is not
  included here.
