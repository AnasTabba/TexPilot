# Human-in-the-loop correction for the TexPilot fabric scanner

Status: DRAFT SKELETON, 31 Oct 2026. Every value marked PENDING is filled only from a saved
result file of the owning agent. A value marked MISSING means that result did not land.
Companion LaTeX section: `docs/texpilot_scanner.tex`, section "Human-in-the-loop correction".

## 1. Motivation

The scanner classifies fabric structure from one whole-garment photo (scanner-v8, 24 classes:
SigLIP-SO400M encoder with LoRA-tuned head, per-class logit bias). A classifier that always
answers produces confident wrong answers, and the project's own design rule is that a wrong
flag costs more than an abstention (see `docs/texpilot_scanner.tex`, "Three non-negotiables").

Two things are measured in the repository already and motivate the design:

- Archive labels are noisy for some classes. In the 1,151-photo human survey
  (`docs/label-check-round2-2026-10-31.md`), the label-right rate is 0% for serge, 24% for
  chenille, 30% for crepe, 36% for flannel, 42% for taffeta/organza/corduroy, and 92% for
  faux_leather. Macro F1 on the raw archive labels is 0.752; on the human-judged subset it is
  0.791; on the conservative subset (n=641) it is 0.886.
- Errors concentrate in visually close pairs, e.g. tulle to lace (9 of 641 verified photos),
  knit to lawn/chiffon, fleece to flannel (`runs/human_verify/round2/confusion_v8.md`).

The question this work answers: when the scanner is unsure, can a human correction be captured
in a form that improves the model, and can we show that improvement honestly?

## 2. Method

### 2.1 Confidence and abstention (Agent 1)

- Temperature scaling per head, fitted on validation by NLL. ECE and reliability diagram reported
  before and after. PENDING: ECE values from `training/textilenet/results/`.
- Abstention threshold tau per head: the lowest confidence at which validation accuracy among
  kept predictions reaches the head's target. Chosen on validation only. Held-out test is scored
  once, after the threshold is fixed. PENDING: the chosen tau values and the target used.
- Reported as a risk-coverage curve: accuracy and macro F1 versus the fraction of photos kept.
  PENDING: coverage at the chosen threshold, accuracy and macro F1 on kept photos.

### 2.2 Correction capture and review queue (Agent 2)

- An "Unsure" result (below tau) is shown to an operator in the Yarnflow UI with the top
  candidates. The operator picks the fabric class or marks "no class fits".
- A correction is stored with: photo reference, model version, predicted class, confidence,
  corrected class, operator identity, timestamp. PENDING: exact schema from
  `docs/agent2-correction-ui.md` in its worktree.
- Corrections enter a review queue. A second person approves or rejects. Only approved
  corrections are eligible for training. PENDING: queue states and approval rule as built.

### 2.3 Simulated-correction retraining protocol (Agent 3)

Real operators are not yet available for a multi-round study, so corrections are simulated
on Kaggle GPUs:

- Pool: abstained or low-confidence photos from the training-side split only. Validation and
  test membership is fixed and never used as a source of corrections.
- Simulated operator: returns the ground-truth class with a stated error rate, or the archive
  label where the archive is trusted. PENDING: error model used and its rate.
- Each round adds the corrected photos to the training set, retrains the head from the same
  initialisation, and scores on the fixed validation set (for selection) and the fixed test set
  (reported once per round).
- Baselines: (a) no correction (same round count, no new rows), (b) random additions of the same
  count from the pool, (c) the same corrections without the abstention filter if that run exists.
  PENDING: which baselines Agent 3 actually ran.
- Selection rule: validation macro F1 first. A round is only reported as an improvement if the
  test macro F1 gain is at least the threshold stated in the project plan (0.005). PENDING: the
  rule as written in Agent 3's summary.

## 3. Results (PENDING; all numbers from saved result files)

### 3.1 Coverage and accuracy (risk-coverage)

PENDING. Figure: `docs/figures/risk_coverage.pdf`. Table: coverage, macro F1, accuracy on kept
photos, abstention rate, per threshold on the test set.

### 3.2 Reliability

PENDING. Figure: `docs/figures/reliability.pdf`. ECE before and after temperature scaling.

### 3.3 Learning curve over correction rounds

PENDING. Figure: `docs/figures/learning_curve.pdf`. Macro F1 first, then accuracy, per round,
with baselines. Test-set value at each round, reported once.

### 3.4 Per-class F1 before and after

PENDING. Figure: `docs/figures/per_class_f1.pdf`. Class support printed beside each bar. Classes
with support below 10 are marked as not reliable.

## 4. Failure cases

Source: `training/textilenet/results/abstain/abstained_test.csv` (Agent 1). Of 4,334 abstained test
photos, 2,221 were wrong if answered. Cross-checked against the human survey
(`runs/human_verify/round2/merged.csv`): 147 of the wrong abstentions are among the 1,151 survey photos.
Of those 147, 103 were judged "out" (excluded as disputed or unclear), 23 "keep" (archive label confirmed),
and 21 "fix:<class>" (judges proposed a different label, 13 of them "fix:knit").

Lighting and blur were checked on 300 wrong and 300 correct abstentions (archive photos, not phone photos):
median Laplacian variance 484 vs 469, median brightness 173 vs 170. Neither separates the errors, so
lighting/blur is not a supported failure category on this set. Phone blur is untested (no phone data).

| # | Category | File (under data/) | True | Pred | Conf | Survey verdict | Diagnosis |
|---|---|---|---|---|---:|---|---|
| 1 | sheer confusable pair | fabric/test/tulle/577642_imaterial.jpeg | tulle | lace | 0.461 | keep | Bridal gown: tulle skirt under a beaded bodice. The bodice reads as lace. Genuine model error from whole-garment framing. |
| 2 | sheer confusable pair | fabric/test/organza/584572_l1_imaterial.jpeg | organza | lace | 0.450 | keep | Strapless gown with layered sheer tiers and a ruched bodice. Organza and lace look alike at photo scale. Genuine model error. |
| 3 | non-garment / multi-garment image | fabric/test/knit/4327-...-knitting-pattern-...jpg | knit | lawn | 0.164 | keep | Knitting-pattern booklet cover with two models and text. Label is right, the photo has no single fabric close-up. Abstaining was correct; the answered class was wrong at very low confidence. |
| 4 | multi-fabric outfit | fabric/test/knit/955770_imaterial.jpeg | knit | gingham | 0.197 | keep | Knit vest over a gingham check shirt. Whole-photo view weights the check shirt, not the labelled vest. Genuine failure of the whole-photo view. |
| 5 | mixed-fabric garment | fabric/test/satin/518295_l1_imaterial.jpeg | satin | lace | 0.585 | keep | Red chemise: satin body with black lace panels and trim. Lace is the most visible texture. Label refers to the main fabric; the ambiguity is real. |
| 6 | archive label noise | fabric/test/chenille/virgos-lounge-blush-tulle-skirt-...jpg | chenille | lace | 0.364 | out | Filename says tulle skirt. Photo shows a sequined mesh dress, not chenille. The archive label is wrong; the model answer is not a fair error. |
| 7 | judge-corrected label (contested) | fabric/test/chenille/chenille-sweaters.jpg | chenille (archive) | denim | 0.348 | fix:knit | Photo shows a dark rib-knit sweater with dark jeans. Knit is the visible fabric, so the archive label is wrong. The fix is plausible but comes from one judge, and Zuhair picks knit for 40% of corrections (see round-2 doc), so the judge's knit choice is not independently confirmed. |
| 8 | close pair, near threshold | fabric/test/fleece/53265_imaterial.jpeg | fleece | flannel | 0.649 | keep | Red brushed robe, fabric surface reads as flannel. Just below tau 0.665, so the abstention is marginal. Genuine near-threshold case. |

Summary of the eight: five are model errors (1, 2, 4, 5, 8; 5 is a mixed-fabric garment and 8 is a
near-threshold case), three involve label or photo problems (3, 6, 7), and none is a phone-blur case. Several of the wrong-abstention
cases sit in the sheer pairs (tulle/organza/chiffon/lace), consistent with the confusion counts in
`runs/human_verify/round2/confusion_v8.md` (tulle to lace, 9 of 641 verified photos).

## 5. Threats to validity and limitations

1. Simulated, not real, workers. Simulated corrections are drawn from ground truth or an
   assumed error model. Real operators will disagree with each other (the round-2 survey found
   the replacement class is unreliable: two judges who both said "no" chose the same class only
   36% of the time).
2. Label noise. The verified subset is a conservative selection: photos the judges disputed or
   marked unclear are excluded, and only "label confirmed yes" or "both humans agree on the fix"
   are kept. Scores on that subset are therefore optimistic relative to the full archive. The
   0.603 floor (counting excluded photos as wrong) is reported alongside.
3. Small and biased test set. Several classes have very few verified photos (twill 3, chenille 12,
   crepe 16). Serge has zero verified photos and is excluded from verified-set macro F1. Macro F1
   on these classes moves a lot with one photo.
4. Domain shift. Training and archive test are catalogue and shop photos. The phone test set
   (`docs/phone-test-set.md`) has not been collected: `data/phone/` does not exist. No phone-domain
   result is reported here. Calibration and the threshold may not transfer to phone photos.
5. Threshold chosen on validation. The abstention threshold is set on validation only; the
   reported coverage is a single operating point, not a guarantee for future data.
6. Calibration drift after retraining. A retrained head has new logits. Temperature and tau are
   refit per round, but this adds a moving part. PENDING: whether the per-round tau changed and by how much.
7. Selection on test. Earlier rounds in this project selected a model by looking at test numbers,
   which the project rules forbid. Only validation is used for selection here; test is reported
   once per round as PENDING.
8. Single factory data. Correction pools come from one team and one set of archive photos.
   Generalisation to other factories or operators is not tested.
9. Encoder dependency. Custom heads run on the v8 encoder. A changed encoder requires retraining
   the dependent heads before serving.
10. Reviewer independence. The importer records reviewer identity but cannot prove that a
    reviewer is human or qualified. The approval step is a process control, not a verified
    guarantee.

## 6. Reproduction

PENDING: command lines for each figure script (`docs/scripts/make_hitl_figures.py`) and the
Kaggle notebook versions used by Agent 3.
