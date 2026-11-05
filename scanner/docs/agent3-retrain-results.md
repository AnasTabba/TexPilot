# Agent 3: simulated worker-correction retraining rounds (fabric24)

Date: 31 Oct 2026. Code: `training/textilenet/retrain_rounds.py` (simulator), `retrain_rounds_report.py` (aggregation and plot), `retrain_rounds_kaggle.py` (Kaggle driver), tests in `tests/test_retrain_rounds.py`. Results: `training/textilenet/results/retrain_rounds/`.

## Headline

- Macro F1 on the archive test set (n = 24,303, the existing benchmark, not a new human-verified set). Mean ± sample std over 3 seeds.
- **Targeted abstain corrections** (lowest-confidence stream items first) reach **0.7395 ± 0.0038** test macro F1 after 10,000 corrections (5 rounds x 2,000), from **0.6223 ± 0.0059** with no corrections. Accuracy 0.8070.
- Random labeling with the same budget reaches **0.6883 ± 0.0045** (accuracy 0.7888). Mixed (abstain + 20% confident-mistake spot checks) reaches **0.7113 ± 0.0104** (accuracy 0.7713).
- Worker noise hurts every strategy. At 10% flipped answers, abstain drops to **0.7127 ± 0.0062**, mixed to 0.6876, random to 0.6350.
- Upper bound: the same head trained on all 84,172 archive train labels reaches **0.7570 ± 0.0034** test macro F1 (accuracy 0.8215). Targeted corrections recover most of that gap with 12% of the labels.
- **Install decision: not installed.** No round model beats the installed head on the validation gate. The installed head scores 0.758505 val macro F1 by exact reproduction; the best round model (abstain, round 5) scores 0.7356 mean, 0.7424 best seed. The all-labels ceiling of this recipe scores 0.7313 val, so the gap to the installed head is partly the recipe, not the corrections.

## What was simulated

| Item | Setting |
|---|---|
| Rows | `data/splits/prelim/fabric.csv`, archive only, fabric24 scope (canvas and plush dropped, jersey merged into knit). Same split and rows as the deployed head; split sha256 `31b14caa...`. |
| Exclusions | 908 train, 80 val, 264 test rows with no cached feature; 16,342 scraped rows (archive-only scope, as for the deployed head); 16 canvas and 258 plush rows. |
| Pool / val / test | 84,172 / 9,373 / 24,303 rows with features. |
| Encoder | Frozen v8 SigLIP so400m LoRA features (cache `texpilot-fabric-feats` on Kaggle). Only the MLP head is retrained each round. |
| Head recipe | Linear 1152→1024, GELU, Dropout 0.2, Linear 1024→24; AdamW lr 3e-3, wd 1e-4, 30 epochs, batch 256, 10% warmup then cosine, label smoothing 0.1. Trained from scratch each round, seeded. |
| Round 0 | 2% stratified subset of the pool (minimum 5 per class), archive labels: 2,000 rows. Shared by all strategies for a given seed. |
| Stream | Train rows nobody has labeled yet. |
| Budget | 2,000 corrections per round, 5 rounds (10,000 total, 12% of the pool). |
| Threshold | Each round, temperature and abstain threshold fitted on validation only, using `training/scanner/calibration.py` (Agent 1's confidence and threshold code, imported, not edited). Target: 90% accuracy among kept predictions. |
| Worker | Answers with the archive label. With probability `noise`, flips to a uniformly random other class. Flip sets are nested across noise levels. |
| Seeds | 0, 1, 2. |

Strategies:

- `none`: no corrections; the round-0 model is reported for every round.
- `random`: uniform sample from the stream.
- `abstain`: lowest model confidence first. Every abstained item (confidence below the threshold) is taken before any confident item.
- `mixed`: 1,600 lowest-confidence items plus 400 confident mistakes per round. The 400 are drawn uniformly from stream items where the confident prediction disagrees with the archive label. That selection uses the true label, so it is an oracle spot-check and an upper bound on what a reviewer could find.

Selection and reporting rules: the round to quote is chosen by validation macro F1 only. Test columns are reported for every round but never used to choose.

## Results: macro F1 first (no worker noise)

Test macro F1 (mean ± std, 3 seeds), accuracy (test top-1, mean), test abstain rate (share of test predictions below the fitted threshold), validation macro F1 (mean). Round r uses the model trained on the corrections from rounds 0 to r-1.

| Round | Corrections used | Strategy | Test macro F1 | Test accuracy | Test abstain rate | Val macro F1 |
|---|---:|---|---|---:|---:|---:|
| 0 | 0 | none (all strategies share this model) | 0.6223 ± 0.0059 | 0.7641 | 0.354 | 0.6182 |
| 1 | 2,000 | random | 0.6496 ± 0.0041 | 0.7708 | 0.330 | 0.6472 |
| 1 | 2,000 | abstain | 0.6866 ± 0.0051 | 0.7820 | 0.331 | 0.6801 |
| 1 | 2,000 | mixed | 0.6621 ± 0.0080 | 0.7452 | 0.463 | 0.6532 |
| 2 | 4,000 | random | 0.6581 ± 0.0115 | 0.7758 | 0.301 | 0.6542 |
| 2 | 4,000 | abstain | 0.7163 ± 0.0112 | 0.7926 | 0.323 | 0.7131 |
| 2 | 4,000 | mixed | 0.6824 ± 0.0070 | 0.7555 | 0.443 | 0.6739 |
| 3 | 6,000 | random | 0.6768 ± 0.0038 | 0.7840 | 0.290 | 0.6713 |
| 3 | 6,000 | abstain | 0.7269 ± 0.0059 | 0.7985 | 0.314 | 0.7150 |
| 3 | 6,000 | mixed | 0.6950 ± 0.0094 | 0.7547 | 0.447 | 0.6864 |
| 4 | 8,000 | random | 0.6856 ± 0.0079 | 0.7861 | 0.288 | 0.6846 |
| 4 | 8,000 | abstain | 0.7376 ± 0.0026 | 0.8036 | 0.290 | 0.7296 |
| 4 | 8,000 | mixed | 0.7075 ± 0.0072 | 0.7623 | 0.446 | 0.6991 |
| 5 | 10,000 | random | 0.6883 ± 0.0045 | 0.7888 | 0.284 | 0.6869 |
| 5 | 10,000 | abstain | **0.7395 ± 0.0038** | **0.8070** | 0.276 | 0.7356 |
| 5 | 10,000 | mixed | 0.7113 ± 0.0104 | 0.7713 | 0.433 | 0.7117 |

Reference rows (same recipe unless stated):

| Model | Val macro F1 | Test macro F1 | Test accuracy |
|---|---:|---:|---:|
| All 84,172 archive train labels, this recipe | 0.7313 ± 0.0116 | 0.7570 ± 0.0034 | 0.8215 |
| Installed head `models/scanner-v8/head_a` (its own probe, parity check) | 0.758505 | 0.766591 | 0.8222 |

The parity check runs the installed probe on the same cached rows. It reproduces the stored `head.json` values exactly (val 0.758505, test 0.766591), so the rows, class order and features match the deployed head.

## Results with worker noise (round 5, 10,000 corrections)

| Strategy | 0% noise | 5% noise | 10% noise |
|---|---:|---:|---:|
| random | 0.6883 ± 0.0045 | 0.6623 ± 0.0095 | 0.6350 ± 0.0084 |
| abstain | 0.7395 ± 0.0038 | 0.7217 ± 0.0124 | 0.7127 ± 0.0062 |
| mixed | 0.7113 ± 0.0104 | 0.6971 ± 0.0122 | 0.6876 ± 0.0066 |

Full per-round noise tables are in `training/textilenet/results/retrain_rounds/summary.csv`. For 5% and 10% noise the validation-selected round for abstain is round 4 (8,000 corrections) for 5% noise.

## Per-class test F1 (round 5, 0% noise, mean over 3 seeds)

Macro F1 gives every class equal weight, so the rare and mid-size classes matter most.

| Class | Test n | None | Random | Abstain | Mixed |
|---|---:|---:|---:|---:|---:|
| twill | 5 | 0.155 | 0.321 | 0.556 | 0.467 |
| serge | 120 | 0.161 | 0.416 | 0.614 | 0.592 |
| crepe | 227 | 0.358 | 0.456 | 0.599 | 0.532 |
| tulle | 756 | 0.347 | 0.408 | 0.432 | 0.420 |
| vinyl | 46 | 0.478 | 0.640 | 0.651 | 0.652 |
| neoprene | 60 | 0.630 | 0.741 | 0.782 | 0.748 |
| lace | 6,906 | 0.816 | 0.829 | 0.836 | 0.791 |
| chiffon | 5,673 | 0.840 | 0.853 | 0.862 | 0.824 |

Twill has 5 test images, so its numbers are noisy. The full 24-class table is in `results/retrain_rounds/runs.jsonl` (field `test_per_class_f1`).

Composition of the 10,000 corrections (seed 0, 0% noise):

| Strategy | Corrections whose label differs from the model's prediction | Most common labels |
|---|---:|---|
| random | 21.9% | lace 2,796, chiffon 2,321, knit 854 |
| abstain | 64.7% | knit 1,344, lace 1,171, chiffon 1,072, satin 893 |
| mixed | 75.3% | lace 1,428, knit 1,285, chiffon 1,158, satin 912 |

## Reading the results honestly

1. **Abstain beats random by about 5 macro-F1 points at the same budget** (0.7395 vs 0.6883, 3 seeds, std under 0.005). The mechanism fits the metric: random sampling mostly labels lace and chiffon, while uncertainty sampling reaches the rare and confusable classes (twill, serge, crepe, neoprene).
2. **Mixed is worse than pure abstain here.** The 400 oracle-chosen confident mistakes per round land disproportionately on large classes, and in this simulator their labels are the archive labels. The mixed rule is still an upper bound: a real reviewer does not know which confident predictions are wrong.
3. **The simulator's "truth" is the archive label.** The label audit (`runs/label_audit`, judged by Claude on thumbnails, not human) suspects about 27% of archive labels are wrong. The sim therefore measures learning from archive labels, not from verified labels. Confident mistakes are where the audit suspects errors most, so the mixed result may partly reflect label noise rather than only model error. Human-verified labels are needed before any real-world claim.
4. **Noise costs more for random than for abstain** at 10% (drop of 0.053 vs 0.027). Random corrections are mostly lace and chiffon, so flipped answers spread over many classes. Only 3 seeds were run, so treat the noise differences as indicative.
5. **The encoder is frozen and saw these training rows.** The v8 features come from an encoder LoRA-trained on the same archive train rows, so the pool is partly memorised. Round-0 quality and the learning curve may be optimistic compared with a fresh encoder. Only the head is retrained, not the encoder.
6. **The head recipe is not the deployed one.** The all-labels ceiling (val 0.7313) sits below the installed head (val 0.7585). Relative comparisons between strategies are valid; absolute levels are about 0.02 to 0.03 below the installed head.
7. **The test set is the existing archive benchmark**, not the human-verified set (that set does not exist yet). It was never used for selection, threshold fitting or training.
8. **Scope.** This is the 24-class archive benchmark. It says nothing about phone photos.

## Install decision

Gate: a round model must beat the installed head on validation macro F1, 0.758505 (verified by the parity check).

- Best round model (abstain, round 5, 0% noise): 0.7356 mean over seeds, 0.7424 best seed. Fails.
- Best round model under noise: lower still.
- All-labels ceiling of this recipe: 0.7313 mean. Fails.

Nothing was installed. No bundle was written and `models/` is unchanged. Serving is unchanged (scanner-v8).

## Reproduce

Environment: repo `.venv` (Python 3.10, numpy, torch, matplotlib). The feature cache is the local copy of the Kaggle `texpilot-fabric-feats` output: `runs/codex_f1_20261027/feature_download/feats_v8/fabric/vit_so400m_patch16_siglip_384.v2_webli_384/`.

```bash
# 1. Simulator tests (numpy, plus one small torch smoke test)
.venv/bin/python -m pytest tests/test_retrain_rounds.py -q

# 2. Full grid: 3 seeds, 3 noise levels, 4 strategies, 5 rounds, 2,000 per round, plus the all-labels ceiling.
#    Defaults match the reported run. Needs a GPU for speed (the Kaggle run used a T4); CPU works but is slow.
.venv/bin/python -m training.textilenet.retrain_rounds \
  --features runs/codex_f1_20261027/feature_download/feats_v8/fabric/vit_so400m_patch16_siglip_384.v2_webli_384 \
  --split-csv data/splits/prelim/fabric.csv \
  --deployed-head models/scanner-v8/head_a \
  --out training/textilenet/results/retrain_rounds

# 3. Aggregate: summary.json, summary.csv, learning_curve.png
.venv/bin/python -m training.textilenet.retrain_rounds_report \
  --runs training/textilenet/results/retrain_rounds
```

The run that produced the reported numbers was on Kaggle, kernel `yaseenazhar/retrain-rounds-v1` (version 5, GPU enabled, private), with input dataset `yaseenazhar/texpilot-retrain-rounds-input`. Staging and launch:

```bash
training/textilenet/retrain_rounds_stage.sh /path/to/stage /path/to/kernel-dir
~/.local/kaggle-cli/bin/kaggle kernels status yaseenazhar/retrain-rounds-v1
~/.local/kaggle-cli/bin/kaggle kernels output yaseenazhar/retrain-rounds-v1 -p <dir>
```

The kernel driver `retrain_rounds_kaggle.py` finds the module inside `/kaggle/input`, so the dataset layout does not need to match exactly.

Real corrections: the manifest shape is `path, round, model_label, model_confidence, human_label, source`, written by the simulator to `manifests/<strategy>_noise<η>_seed<s>.csv` and read by `retrain_rounds.load_manifest` (which rejects unknown classes, duplicate paths, confidences outside [0, 1], and missing columns). The ERP export should write the same columns with `source = worker`. `load_manifest` is wired and tested but not yet connected to a training entry point; that is the next step when real corrections exist.

## Files

- Code: `training/textilenet/retrain_rounds.py`, `training/textilenet/retrain_rounds_report.py`, `training/textilenet/retrain_rounds_kaggle.py`, `training/textilenet/retrain_rounds_stage.sh`, `training/textilenet/retrain_rounds_kernel-metadata.json`, `tests/test_retrain_rounds.py`.
- Results: `training/textilenet/results/retrain_rounds/`
  - `runs.jsonl` / `runs.csv`: one row per (strategy, noise, seed, round), with per-class test F1.
  - `summary.json` / `summary.csv`: mean and std per cell, validation-selected round, deployed parity, all-labels ceiling, exclusions.
  - `manifests/`: correction manifests for every cell (the simulated output in the shared shape).
  - `learning_curve.png`: macro F1 against round and against corrections, all strategies and noise levels.
  - `run_meta.json`, `source_hashes.txt`, `kaggle_kernel_stdout.txt`: provenance.

Field notes: in `runs.jsonl`, `corrections_used` and `n_train_used` describe the model that was evaluated. `corrections_selected_round` and `worker_flipped_round` describe the corrections chosen in that round, which the next model uses. Round 5 selects nothing.
