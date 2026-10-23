# FastFix results (≤1 hour retrain)

**Kernel:** `yaseenazhar/texpilot-fabric-fastfix` — **COMPLETE**  
**Wall clock:** 45.9 minutes (under 55-minute budget)  
**Artifacts:** `research/experiments/kaggle_artifacts/fast_inv_sampler/`

Parent analysis: [05_kaggle_log_analysis.md](05_kaggle_log_analysis.md).

---

## What ran

| Order | Tag | Plan | Result |
|---|---|---|---|
| 1 | `fast_inv_sampler` | inverse sampler, 4 epochs, workers=4 | **Completed** (~46 min) |
| 2 | `fast_inv_sqrt` | inv + sqrt CE, 3 ep, max-steps 200 | **SKIP** (9.1 min left) |
| 3 | `fast_focal_eff` | focal + effective, 3 ep, max-steps 200 | **SKIP** (9.1 min left) |

Throughput recovered (128→196 img/s) — no resume I/O pathology.

---

## Test metrics vs baseline

| Metric | baseline_vit_tiny (20 ep) | fast_inv_sampler (4 ep) | Δ |
|---|---:|---:|---:|
| **macro F1** | **0.4662** | 0.3647 | **−0.1015** |
| top1 | **0.6923** | 0.5165 | −0.1758 |
| weighted F1 | 0.6796 | 0.5567 | −0.1229 |
| balanced accuracy | 0.4400 | **0.4966** | +0.0566 |
| minority recall | 0.1634 | **0.4050** | **+0.2416** |

Val EMA macro F1 rose ep0→3: 0.294 → 0.374 (still climbing, but far below baseline’s 0.47).

---

## Empirical read

### What worked
- **Rare-class lever confirmed:** minority recall jumps to 0.405 (best of any completed run).
- **twill** gets non-zero recall (0.20) vs 0.0 under baseline/sqrt_cw.
- Job finished cleanly inside 1 hour with healthy GPU throughput.

### What failed (primary metric)
Inverse sampling **alone** is too aggressive for a short schedule:
- Majority classes (lace/chiffon) are under-visited → top1 collapses to 0.52.
- Macro F1 falls **0.10** below baseline despite better minority recall.
- canvas still F1=0 (only 4 test images; train support still tiny).

### Failure mode pin
| Mode | Evidence |
|---|---|
| **Over-correction from inverse sampler** | minRec ↑↑ while top1/macro ↓↓ |
| **Too few epochs for sampler to settle** | val F1 still rising at ep3; 20-ep baseline had time to rebalance |
| **Budget prevented combo recipes** | inv+sqrt and focal_eff never started |

---

## Implication for next fix (still ≤1h)

Do **not** ship pure inverse sampling for macro F1. Prefer one of:

1. **Milder sampler:** `sqrt` sampler (not inverse) × 5–6 epochs, or inverse with fewer replacement draws.  
2. **Combo with head-class protection:** short inv warmup (1–2 ep) then plain CE fine-tune.  
3. **sqrt class-weighted CE longer** (already have best@ep11; finish remaining epochs in a focused ≤1h resume at healthy img/s).  
4. **Keep baseline as champion** on macro F1 until a recipe beats 0.4662 on test.

---

## Leaderboard (completed test only)

| Rank | Experiment | macro F1 | top1 | minRec |
|---:|---|---:|---:|---:|
| 1 | baseline_vit_tiny | **0.4662** | **0.6923** | 0.1634 |
| 2 | vit_tiny_sqrt_cw | 0.4630 | 0.6636 | 0.2556 |
| 3 | fast_inv_sampler | 0.3647 | 0.5165 | **0.4050** |
