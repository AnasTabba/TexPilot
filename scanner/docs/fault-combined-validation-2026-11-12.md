# Fault combined wrapper validation — 12 November 2026

Read-only aggregation of wrapper-reviewer fixes (INPFormer/import isolation, MuSc/anomalib baselines, Dinomaly). No shared-venv installs, no GPU jobs, no edits outside this report.

## Environment

- Interpreter: `/Users/anastabba/Documents/iba/sem7/FYP/.venv/bin/python` (Python 3.10.10, macOS 27 arm64)
- Packages: numpy 2.2.6, torch 2.14.0 (CUDA false), timm 1.0.30, scipy 1.14.1, scikit-learn 1.7.2, Pillow 12.3.0, pytest 9.1.1
- Absent in `.venv`: `anomalib`, `skimage`, `tabulate`
- Dinomaly checkout used when noted: `/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/7465821c-727f-422e-b6d5-83704616dd8a/scratchpad/agents/dinomaly-research/repo`
- Reviewer dispatches settled before this run: Dinomaly `ctx_db2a568d3a1a` (+ follow-up `ctx_8c3ca448ee85`), INPFormer `ctx_5809a71c02e4`, baselines `ctx_6b86820fcb72`

## Reproducible command

From `scanner/`:

```sh
DINOMALY_REPO=/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/7465821c-727f-422e-b6d5-83704616dd8a/scratchpad/agents/dinomaly-research/repo \
OMP_NUM_THREADS=1 \
../.venv/bin/python -m pytest \
  tests/test_fault_dinomaly.py \
  tests/test_fault_inpformer.py \
  tests/test_fault_musc.py \
  tests/test_fault_anomalib_methods.py \
  tests/test_fault_bench.py \
  tests/test_fault_bench_a1.py \
  -q -rs -o addopts=''
```

Result on this machine: **74 passed, 2 skipped, 0 failed** in ~6.0s (14 warnings: missing `skimage`/`tabulate` → Dinomaly fixture uses documented fakes for repo `utils`/`optimizers`).

Without `DINOMALY_REPO`: **67 passed, 9 skipped, 0 failed** (~5.1s). The seven extra skips are clone-gated Dinomaly tests (`set DINOMALY_REPO to the Dinomaly clone folder`).

### Per-file inventory (76 collected)

| File | Collected | With `DINOMALY_REPO` | Without |
|---|---:|---|---|
| `test_fault_dinomaly.py` | 12 | 12 passed | 5 passed, 7 skipped |
| `test_fault_inpformer.py` | 18 | 18 passed | 18 passed |
| `test_fault_musc.py` | 13 | 13 passed | 13 passed |
| `test_fault_anomalib_methods.py` | 12 | 10 passed, 2 skipped | same |
| `test_fault_bench.py` | 10 | 10 passed | 10 passed |
| `test_fault_bench_a1.py` | 11 | 11 passed | 11 passed |

Skips that remain with `DINOMALY_REPO` set:

- `test_patchcore_fit_and_score_on_kaggle` / `test_reverse_distillation_fit_and_score_on_kaggle`: `could not import 'anomalib': No module named 'anomalib'`

## SciPy dylib vs baseline bench (environment limitation)

INPFormer review (`scanner/docs/fault-inpformer-import-review.md`) reported bench collection failing on Python 3.10 SciPy via `_spropack.cpython-310-darwin.so` `dlopen` (`__DATA/__thread_bss` zero-fill offset). Reproduced here on Framework/`PATH` `python3` (`/Library/Frameworks/Python.framework/Versions/3.10/bin/python3`), which shares that broken site-packages SciPy; importing `sklearn` pulls the bad `_spropack`.

The project `.venv` SciPy 1.14.1 loads cleanly (`scipy.special._ufuncs` and `sklearn.metrics.roc_auc_score` succeed), so `test_fault_bench.py` and the combined suite collect and pass under `../.venv/bin/python`. Baseline reviewer’s bench pass and INPFormer reviewer’s dylib failure are the same host with different interpreters—not a wrapper regression.

## Genuine failures

None in the focused combined suite under `.venv`. No owner escalation for failing tests.

## Blockers / remaining gaps (not suite failures)

1. Real anomalib/Lightning fit/score still unproven locally (package absent; do not install into shared `.venv` from this task).
2. Dinomaly clone tests with `DINOMALY_REPO` use fakes when `skimage`/`tabulate` are missing; not full upstream `utils`/`optimizers` import.
3. No local CUDA; GPU training/smoke remains Kaggle-side.
4. Full-run tile RAM / 10k-iter stability / private kernel pushes are outside this validation (see `fault-full-run-readiness.md` and `kaggle-vitb-timing-2026-11-12.md`).
