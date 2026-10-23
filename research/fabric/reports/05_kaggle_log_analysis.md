# TexPilot Fabric — Kaggle Log Report & Failure Analysis

**Audience:** teammates continuing fabric 27-way classification work  
**Date:** 2026-10-20  
**Artifacts:** `research/experiments/kaggle_artifacts/` (metrics, logs, confusion)  
**Registry:** `research/experiments/registry.csv`

---

## 1. Executive summary

| Experiment | Test macro F1 | Test top1 | Balanced acc | Minority recall | Outcome |
|---|---:|---:|---:|---:|---|
| **baseline_vit_tiny** (20 ep) | **0.4662** | **0.6923** | 0.4400 | 0.1634 | Completed (research kernel) |
| **vit_tiny_sqrt_cw** (best @ ep11, test via lean v2) | 0.4630 | 0.6636 | **0.4957** | **0.2556** | Train interrupted; test eval completed |
| vit_tiny_inv_sampler | — | — | — | — | Cancelled after 2 val epochs |
| dinov2 / focal_eff | — | — | — | — | Never reached (session limits) |

**Bottom line:** Class-weighted CE (`sqrt`) did **not** beat baseline on the primary metric (macro F1). It **did** improve minority recall (+0.09) and balanced accuracy (+0.06) at the cost of majority-class F1 and top1. Ops failures (12h cancels, missing checkpoint attach, slow resume I/O) blocked a fair full-grid comparison.

---

## 2. What ran (kernel timeline)

| Kernel | Status | What happened |
|---|---|---|
| `texpilot-fabric-research` | CANCEL (~12h) | Finished smoke + **baseline test**; died mid `vit_tiny_sqrt_cw` (~ep12) |
| `texpilot-fabric-lean` v1 | CANCEL (~12.8h) | Re-ran baseline only to ep15; **no test**; never reached imbalance tags |
| `texpilot-fabric-vit-tiny-sqrt-cw-resume` v1 | ERROR | Checkpoint dataset **not attached** → `AssertionError: checkpoint not found` |
| `texpilot-fabric-vit-tiny-sqrt-cw-resume` v2 | CANCEL | Resumed ep12→13; throughput collapsed to **12–43 img/s** (vs ~120 on research) |
| `texpilot-fabric-lean` v2 | CANCEL | **Succeeded** sqrt_cw test eval (`--epochs 0`); started inv_sampler (2 epochs) then cancelled |

Log excerpts: `kaggle_artifacts/logs/{research,lean_v2,resume}_excerpt.txt`.

---

## 3. Measured results (test set, n=24 628)

### 3.1 Headline metrics

```
baseline_vit_tiny   macroF1=0.4662  top1=0.6923  wF1=0.6796  balAcc=0.4400  minRec=0.1634
vit_tiny_sqrt_cw    macroF1=0.4630  top1=0.6636  wF1=0.6690  balAcc=0.4957  minRec=0.2556
```

Delta (sqrt − baseline): macro F1 **−0.003**, top1 **−0.029**, balAcc **+0.056**, minRec **+0.092**.

### 3.2 Val curves (EMA macro F1)

**Baseline** peaked at ep17 val macro F1 **0.4702** (selected for test).  
**sqrt_cw** peaked at ep11 val macro F1 **0.4581** before cancel; resume ep13 reached **0.4604** val (still below baseline).  
**inv_sampler** (partial): ep0→1 val macro F1 0.278→0.319 with minority recall **0.30→0.38** (early signal: oversampling helps rare classes faster than sqrt CE).

### 3.3 Throughput / cost

| Context | img/s | Notes |
|---|---:|---|
| Research vit_tiny | 100–180 | Healthy T4 session |
| Resume ep12 | **12** | Nested `/kaggle/input/datasets/...` + cold start; ep12 took **8064s** |
| Resume ep13 | 43 | Recovering but too late for 12h budget |
| Lean v2 inv_sampler | 109–171 | Healthy again on fresh session |

**Ops lesson:** A slow epoch can burn an entire GPU session. Prefer fresh short jobs over multi-hour resumes on cold mounts.

---

## 4. Failure modes & weaknesses

### F1 — Operational (blocked learning)

1. **Kaggle 12h soft cancel** repeatedly killed long grids mid-flight.  
2. **Resume v1** pushed before checkpoint dataset was valid → silent drop of dataset source.  
3. **Resume throughput collapse** made finishing ep12–20 infeasible.  
4. **Lean v1 wasted the session** re-training baseline already completed in research.

### F2 — Extreme label imbalance (2316:1)

Train counts (archive): lace 27 787 vs canvas **12**, twill **31**.  
After frozen split: train canvas **11**, twill **28**.

**Symptom:** canvas & twill stay at **F1 = 0.0** under both baseline and sqrt_cw. Macro F1 is dominated by these floors plus other rares.

### F3 — sqrt class-weight does not fix macro F1

Per-class test F1 (selected):

| Class | n_test | baseline F1 | sqrt F1 | Δ |
|---|---:|---:|---:|---:|
| canvas | 4 | 0.000 | 0.000 | 0 |
| twill | 5 | 0.000 | 0.000 | 0 |
| plush | 57 | 0.034 | **0.150** | +0.12 |
| jersey | 228 | 0.187 | **0.235** | +0.05 |
| tulle | 756 | 0.358 | **0.422** | +0.06 |
| neoprene | 60 | **0.633** | 0.414 | **−0.22** |
| lace | 6913 | **0.784** | 0.760 | −0.02 |
| chiffon | 5686 | **0.781** | 0.771 | −0.01 |

sqrt_cw **lifts mid-rare recall** but **hurts head-class precision/F1** enough that macro F1 stagnates or drops. Softmax competition: up-weighting rare classes steals probability mass from lace/chiffon.

### F4 — Systematic confusions (texture lookalikes)

Top baseline confused pairs:

| True → Pred | Rate |
|---|---:|
| twill → denim | 0.60 |
| canvas → chiffon | 0.50 |
| **tulle → lace** | **0.44** |
| taffeta → satin | 0.29 |
| chenille → knit | 0.27 |
| jersey → knit | 0.23 |
| satin → lace | 0.24 |

These are fine-grained fabric aliases, not random errors. Geometry-heavy aug helps orientation but not “sheer vs lace hole pattern.”

### F5 — Metric tension

Selecting on **macro F1** while optimizing CE (even weighted) creates a mismatch: CE still rewards majority tokens by volume. Inverse sampling (seen in lean v2 ep0–1) more aggressively rebalances **gradient frequency**, which is the next lever.

---

## 5. Empirical diagnosis (what to fix first)

| Priority | Failure | Evidence | Fix lever |
|---|---|---|---|
| P0 | Rare classes F1≈0 | canvas/twill | Stronger **oversampling** (inverse / class-balanced sampler) |
| P0 | Macro flat vs baseline | sqrt_cw Δmacro −0.003 | Don’t rely on sqrt CE alone; combine sampler + loss |
| P1 | Head-class regression | lace/chiffon F1 down | Milder weights, or sampler without heavy CE weights |
| P1 | Lookalike confusions | tulle↔lace etc. | Focal loss / harder mining; later: stronger backbone |
| P2 | Session / I/O waste | resume 12 img/s | Short jobs (<1h), workers=4, no long resumes |

---

## 6. Next wave (≤1 hour GPU) — techniques under test

Notebook: `yaseenazhar/texpilot-fabric-fastfix` (see `kaggle/texpilot-fabric-fastfix/`).

Hard wall-clock budget **55 minutes**. Techniques:

1. **Inverse weighted sampler** (addresses F2/F5) — full batches, few epochs.  
2. **Inverse sampler + sqrt class-weighted CE** (combine F3 levers) — only if time remains.  
3. **Focal + effective-number weights** (addresses F4 hard examples) — capped `max-train-steps` if time remains.

Success criteria vs baseline test: **macro F1 > 0.4662** or **minority recall > 0.26 with macro F1 ≥ 0.46**.

---

## 7. How teammates reproduce / inspect

```bash
# Registry
column -s, -t research/experiments/registry.csv | less -S

# Test metrics
jq '.test|{macro_f1,top1,balanced_accuracy,minority_recall}' \
  research/experiments/kaggle_artifacts/baseline_vit_tiny/test_metrics.json
jq '.test|{macro_f1,top1,balanced_accuracy,minority_recall}' \
  research/experiments/kaggle_artifacts/vit_tiny_sqrt_cw/test_metrics.json

# Log excerpts
less research/experiments/kaggle_artifacts/logs/lean_v2_excerpt.txt
```

Frozen split CSV dataset: `yaseenazhar/texpilot-fabric-split`  
Fabric images: `mohammadmahanhamedin/vto-textilenet-fabric`  
Interrupted sqrt_cw ckpt: `yaseenazhar/texpilot-vit-tiny-sqrt-cw-ckpt`

---

## 8. FastFix follow-up

Completed: see **[06_fastfix_results.md](06_fastfix_results.md)**. Inverse sampler (4 ep, 46 min) raised minority recall to **0.405** but dropped macro F1 to **0.3647** (baseline **0.4662**). Pure inverse sampling is not the macro-F1 fix.
