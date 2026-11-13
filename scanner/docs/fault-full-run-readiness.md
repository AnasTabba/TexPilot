# Fault full-run readiness — 2026-11-12

Decision: **conditional GO for one Dinomaly ViT-B precision per dataset; NO-GO for launching the current bench_a1 as a full run.** No jobs were pushed or code uploaded during this review. This is a source/artifact review, not proof that a full dataset fits in RAM or finishes in 12 hours.

## Evidence and provenance

Artifact directory (ephemeral; retain a private copy before deleting scratch space):
`/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/7465821c-727f-422e-b6d5-83704616dd8a/scratchpad/agents/vitb-timing/`.

`v5/log.txt`, both `v5/results/*.json`, and `measurements.json` record a Tesla T4, torch 2.11.0+cu130, timm 1.0.30, 300 iterations, batch size 16, carpet only, 4,032 train tiles and 117 test images / 1,872 test tiles. The source checkout under sibling `dinomaly-research/repo` has HEAD `1f252be03a918789b19848f0ca37166e7c28dada`, matching bench_a2 PIN. Reviewed real upstream `dinomaly_mvtec_uni.py`, `models/uad.py`, `models/vision_transformer.py`, and `utils.py`.

| Measurement | FP32 | AMP |
|---|---:|---:|
| Fit loop seconds/iteration | 2.502001 | 1.232407 |
| Training loop, 300 iterations (seconds) | 750.600 | 369.722 |
| Evaluation including calibration/metrics (seconds) | 246.874 | 103.954 |
| Peak allocated GPU GiB | 8.753 | 7.370 |
| Image AUROC | 0.9670947030 | 0.9689004815 |
| Pixel AUROC | 0.9856508577 | 0.9856795857 |
| AUPRO | 0.9703641348 | 0.9705522476 |

Image AUROC difference is +0.18058 percentage points; pixel AUROC +0.002873 points. This supports a pilot agreement criterion of absolute difference <=0.5 percentage points for each AUROC, provided the coordinator accepts that criterion. It does not establish full-training equivalence or repeat-seed variance. Both pilot rows contain 28 good and 89 defect images. Zero observed false alarms has an upper 95% bound of 123.44 per 1,000 good images: it does not validate deployment FAR 0.5%.

## Dinomaly findings and change

Wrapper architecture, target layers, fusion, initialization, StableAdamW parameters, 100-step warmup, 10,000-step budget, hard-mining schedule and gradient clipping match the pinned unified upstream script. Encoder is explicitly frozen/eval. Upstream linear attention uses unnormalized einsum contractions; preserving its attention calculation in FP32 under AMP is necessary and already present. GradScaler unscales before clipping. CPU AMP remains disabled.

Proven defect: permanently adding repo_dir to sys.path cannot displace another upstream repository's cached `models`, `utils` or `optimizers`. A focused regression failed before integration. Dinomaly now uses the shared `_upstream.upstream_repo` scope for model construction, fit and scoring; this scopes runtime lazy imports and restores caller modules/path on success and error. The other reviewer owns that helper and its reentrant-cache fix. No kernel or bench files were edited by this reviewer.

Methodological differences from official results remain intentional: seed 2026 rather than 1; random tile minibatches rather than shuffled image epochs; native-resolution overlapping tiles rather than resize 448 / crop 392; maximum stitched image score rather than official top-1% score; custom calibration split and pixel metric implementation. These are benchmark results, not reproduction of the paper's headline metrics.

## Exact launch gates

1. Set and inspect a private kernel snapshot with exactly one selected DATASET and one Dinomaly METHOD/precision, SMOKE=False, MODE=unified, ITERS=10000. Current bench_a2 defaults to MVTec AMP (AMP=True); verify the packaged snapshot rather than assuming its settings match an earlier pilot. Do not concatenate FP32 and AMP training in one 12-hour session. Re-run the pilot if architecture, batch size, image/tile geometry, AMP guard, source dependencies or GPU materially change.
2. Treat 12 hours as a hard session ceiling. Measured loop extrapolation alone is 6.950 hours FP32 or 3.423 hours AMP. Existing estimates (MVTec 7.313/3.614 h, WFDD 7.072/3.505 h, AITEX 7.046/3.475 h, FP32/AMP) are extrapolations, not measured full runs. Require setup + tiling + training + dataset-scaled calibration/inference/metrics + artifact finalization <=10 hours to retain a two-hour margin. Reject an estimate with missing dataset counts. Training in unified mode occurs once per dataset; per-category mode multiplies the fit cost.
3. Verify indexed category and split counts before fitting; all rows must have only the requested dataset, training/calibration must contain only good images and disjoint paths, test must be nonempty with both labels for meaningful image AUROC, expected defect masks must exist. MVTec full scope here is the five textures carpet/grid/leather/tile/wood, not all 15 MVTec classes. No category may silently disappear due to absent train/calib data. Verify WFDD's discovered layout and AITEX mask unions against actual mounted data.
4. Compute the full training tile count and available host RAM before allocation. `_train_tiles` retains every uint8 tile (460,992 bytes each, plus arrays/list overhead); `_evaluate` retains full-resolution stitched maps and masks for a category before downsampling. GPU peak from carpet does not establish host-RAM safety for full WFDD/AITEX. Require a measured/category-derived RAM bound below the runtime's available memory with headroom, and projected evaluation cost within gate 2.
5. Confirm the uploaded private code version contains the reviewed Dinomaly and shared helper, and that the loaded code root resolves exactly once. Record code archive SHA256, dataset versions, upstream commit, package versions, GPU, all run settings and downloaded weight SHA256 alongside results/logs. Both metadata files currently mount all three source datasets; loaders select one, so this is logical dataset isolation, not least-privilege mounting. For physical one-dataset isolation, remove unrelated dataset sources from each launch snapshot.
6. Require CUDA availability and expected GPU; reject nonfinite loss/maps or missing metrics. Pilot AMP has finite recorded metrics and preserved attention FP32; AMP success is not evidence of 10,000 successful optimizer updates (GradScaler can skip overflowed steps). Investigate scaler collapse or repeated skipped updates if observed during full training.
7. Keep kernel and code-dataset visibility private. Current metadata is private with GPU and internet enabled. `cleanup` removes repo clones and known weight extensions from working/checkpoint cache locations, but does not prove removal of every external cache, `.bin` weight, extracted source archive or symlink target. Inspect final output recursively before relying on privacy/artifact integrity; keep result JSON, log and provenance, and exclude model weights/private training images. The downloaded ViT-B file in v5 was 346,393,545 bytes with SHA256 `73182a088cf94833c94b1666d1c99e02fe87e2007bff57b564fb6206e25dba71`. Current downloader logs digest and checks size, without an independently trusted expected digest; certificate-clock workaround is recorded in logs. Do not treat size alone as integrity verification.
8. Validate output rows against expected categories, dataset/method/mode, finite required metrics and a SUCCESS log; preserve phase timings externally because `bench.py` persists only row arrays. Keep precision/run identity in separate report inputs: both pilot JSONs use method `dinomaly_vitb`, and existing `rendered-results.md` incorrectly pools the two carpet rows as two categories. Compare the individual files above, not that pooled report.

## bench_a1 and metric caveats

Current bench_a1 has SMOKE=True, forcing MVTec and only MuSc/PatchCore; DATASET and full METHODS are ignored until SMOKE=False. Therefore it is not ready for a full run as configured. The timing/kernel owner was sent these findings directly. Full-run readiness of MuSc/anomalib is owned by their reviewer; Dinomaly timing cannot budget those methods. `pip install anomalib` is unpinned, so a future environment can differ from smoke evidence.

`bench.py` separates fit/calibration/test and groups by (dataset, category), fitting unified training once and calibrating each category. Calibration uses tile maxima whereas test uses maxima of averaged stitched maps; the nominal 0.5% FAR is not an image-level guarantee. Pixel metrics downsample masks/maps to maximum side 256 using nearest neighbor and use a 201-threshold approximate AUPRO up to FPR 0.3. Unmasked defects are excluded from pixel metrics and must be counted rather than silently interpreted as normal pixels. No perturbation runs are enabled by either kernel, so full runs do not provide robustness evidence.

## Verification and limits

Focused Dinomaly + INPFormer + benchmark tests passed: **40 passed** (5.91 seconds), with DINOMALY_REPO pointing to the real pinned checkout. Ruff passed for the two owned Python files and git diff --check passed. Its lightweight model tests use stand-ins; local missing skimage/tabulate trigger documented fake utils/optimizer fallbacks. The existing AMP overflow regression is CPU autocast, while v5 artifacts provide actual T4 runtime evidence before the import-scope-only change. Import collision regression must pass alongside the shared helper's reentrancy tests before packaging. Live Kaggle status was not independently queried: this shell has no Kaggle CLI/package; use the timing owner's authenticated read-only status evidence. No full GPU fit, full-data RAM proof, full-kernel rerun or private output inventory was performed in this review.


## Combined review: A2 is independent of A1 (2026-11-12 follow-up)

Read together with [baseline wrapper review](fault-baseline-wrapper-review.md) and [INPFormer/import review](fault-inpformer-import-review.md). **A1 validation does not block A2 Dinomaly.** Conditional GO means A2 may proceed once its own launch gates above are met; it is not an unconditional launch approval or a claim those gates have already been measured for all datasets.

The dependency trace is concrete: `bench_a2/run.py` imports common helpers, `bench.run_benchmark`, and `methods.dinomaly.Dinomaly`; the methods package initializer is empty. It does not construct or import MuSc, PatchCore, Reverse Distillation or INPFormer. Shared `bench.py` has no eager import of these wrappers. A2 checks CUDA, selects exactly one dataset with `load_samples(dataset, SMOKE)`, downloads only its selected Dinomaly backbone, and fits once in unified mode. Thus no anomalib/Lightning installation or MuSc reference-set policy is needed for this execution path. A private A2 code archive may contain other wrapper files without importing them.

| Remaining finding | Blocks A1 | Blocks A2 Dinomaly |
|---|---|---|
| MuSc calibration sets below eight tiles | Yes, for affected categories until an explicit reference policy is chosen | No; Dinomaly calibration is independent inference and has no eight-tile minimum |
| MuSc full-category stacking / pairwise MSM GPU memory unmeasured | Yes, requires its own bounds/pilot | No MSM or CLIP extraction occurs in A2; A2's own tile-storage/evaluation RAM bounds still apply |
| Real anomalib/Lightning fit/score tests skipped locally | Yes, validate actual baseline environment before claiming readiness | No; A2 does not import either package |
| INPFormer gradient/count/checkpoint fixes | Relevant to future INPFormer execution | No INPFormer construction in A2 |
| Shared upstream import helper and benchmark contract | Required wherever used | Yes; package `_upstream.py` and pass Dinomaly/helper regressions on the final source snapshot |
| Dataset indexing, train/calib/test separation, metric semantics, output privacy | Yes | Yes; independently satisfy gates 3–8 for each selected A2 dataset |

Concrete A2 disposition: MVTec AMP has the strongest pilot evidence, from carpet; five-texture full-data counts and memory/runtime bounds are still required. WFDD and AITEX need their own indexed category/split/tile/mask inventory and host-RAM/evaluation bounds; the same fixed 10,000-step model fit time does not establish their full-data feasibility. Fewer than eight good calibration tiles is acceptable to Dinomaly mathematically, but small calibration sets make a 99.5th-percentile threshold weak evidence for FAR and must be disclosed. Empty calibration remains a benchmark skip and must not silently reduce expected category coverage.

The combined regression owner (`ctx_347bdd8605f9`) owns final test aggregation; this follow-up changes documentation only and does not supersede their final snapshot results. Do not wait for A1's absent-package integration tests to start a separately validated A2 session, and do not transfer A2's timing/memory evidence to A1. No push, upload, dependency install, or live job mutation was performed.
