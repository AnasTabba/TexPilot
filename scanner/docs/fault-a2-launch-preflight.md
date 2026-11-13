# A2 launch preflight — 2026-11-12

**Disposition: hold launch until the four gates below are closed.** This preflight is complete; full-run preparation is not yet complete. No uploads, pushes, job starts, package installs, shared-kernel edits, or model/data downloads were performed. Only this document was created. Existing timing-worker ownership remains unresolved, so no isolated launch directory was copied from potentially changing shared files.

Reviewed timing, full-run readiness, baseline and INPFormer reviews; traced `bench_a2/run.py` → `common.load_samples` → `bench.run_benchmark` → Dinomaly. A2 imports no baseline wrapper. A1's missing anomalib integration and MuSc reference policy do not block A2. Combined proof coordinated with Cursor `ctx_349520a1b8a2`: [durable validation](fault-combined-validation-2026-11-12.md), **74 passed, 2 skipped, 0 failed**, using project `.venv` and real `DINOMALY_REPO`; the two skips concern anomalib. No redundant suite rerun was needed for this documentation-only task. Clone tests still use documented utility/optimizer fakes when skimage/tabulate are absent; v5 is the actual pre-import-fix T4 execution evidence.

## Read-only Kaggle evidence

CLI: `$HOME/.local/kaggle-cli/kaggle-anas`; observations taken approximately **2026-11-12 15:45–15:50 UTC**. Credentials were neither read nor printed.

- `kernels status anastabba/texpilot-bench-a2`: `KernelWorkerStatus.COMPLETE`.
- `kernels list --mine --page-size 100 --csv`: existing A2 last run `2026-11-12 14:38:38.620000`; no separate full A2 launch entry appeared in the returned inventory. This list is not an account-wide running-job guarantee; recheck target status immediately before any eventual push.
- `kernels files anastabba/texpilot-bench-a2`: `log.txt` (831 bytes), `mvtec__dinomaly_vitb_amp__unified.json` (941), `mvtec__dinomaly_vitb_fp32__unified.json` (944). These are pilot outputs, not proof of a full run.
- `datasets status anastabba/texpilot-fault-code`: `ready`.
- `datasets files anastabba/texpilot-fault-code --page-size 200 --csv`: returned complete listing without a next-page token; fault methods include Dinomaly (10,401 bytes) and old wrappers, **no `training/fault/methods/_upstream.py`**. Timestamp is about 14:37:59 UTC. Therefore the remote snapshot demonstrably lacks the reviewed shared helper; `ready` does not mean source-current.
- Read-only source-dataset file listings resolve all three requested slugs and show expected WFDD `WFDD/grey_cloth/train/good` and AITEX `Mask_images` paths. These partial listings are not a complete indexed inventory or image-header inspection. No dataset version IDs were established by these calls.

## Remaining launch gates and responsible steps

### 1. Freeze and verify the private source snapshot

Resolve old timing-worker ownership with the coordinator before changing shared kernels. Then freeze the reviewed files, retaining the shared helper and Dinomaly import scope plus FP32 LinearAttention2 AMP guard. Current local A2 constants already are `DATASET="mvtec"`, `METHOD="dinomaly_vitb"`, `ITERS=10000`, `AMP=True`, `MODE="unified"`, `SMOKE=False`; they run one unified fit, not FP32 followed by AMP. WFDD and AITEX require independent snapshots selecting their dataset. Reusing the same kernel ID sequentially requires saving each version's provenance and outputs before another push; separate private IDs/directories are easier to audit and must not duplicate a running job.

`publish_code.sh --dry-run` is the existing no-upload staging entry point; it includes training/, services/, pyproject.toml, excludes caches and some Kaggle result paths, and skips files over 5 MB. It does **not** freeze a Git commit, emit a SHA manifest, verify remote bytes, prove privacy, or exclude all unrelated result files (textilenet results are present remotely). Its upload path creates a second staging directory; never assume a dry-run directory is exactly the later uploaded snapshot. After ownership resolves, stage once or compare per-file manifests before upload, inspect actual files, hash the exact archive and critical sources, record private dataset version, then compare mounted source hashes before fit. Never use only the `0248f8a-dirty` message as provenance: fault source is currently untracked.

Local identities observed at 15:50:05 UTC, base HEAD `0248f8aaf98fec9f7581e5368d99345abfe99b68` (dirty/untracked source):

| File relative to scanner/ | SHA-256 |
|---|---|
| training/fault/methods/dinomaly.py | b96b3a93e9c52bce727090caf8f83e44e7c6ce69439919b8d9b1339402651a81 |
| training/fault/methods/_upstream.py | f79b4230f620ab3662cb6b73f74268155e934f837f14380eab8e39b9d5bd7bf3 |
| training/fault/bench.py | 81185a672b16e21a62edd4b5aa2189c5bccdbab6aaad33a00e4a2b65a4546d7f |
| training/fault/kaggle/common.py | ae29b8bc93c3b6e9f8497d6bb96db88500c89aedb82c7ef7027c0dfc2a4b861b |
| training/fault/kaggle/bench_a2/run.py | 8229301c4456e6944bccc13bf9f4fb51d9afd084233024001eb9def2f068c0ec |
| training/fault/publish_code.sh | a353b0066797d568e47a9a08656bbaddf5c14fea98d25784a48aaa9a0b3702cb |

Current metadata is private/GPU/internet and mounts code plus **all three** datasets. Selecting one dataset gives logical isolation; for physical isolation, retain only the selected source dataset and code in each launch metadata. Verify the actual remote visibility and mounted versions; local `is_private=true` alone does not prove the existing code dataset's visibility.

### 2. Produce full indexed split/tile/mask inventory before fitting

Current entrypoint logs total samples only and accepts any nonempty result list. Benchmark silently skips categories lacking train/calibration; it does not enforce expected category coverage, both test labels, or complete masks. Thus current success checks do not close this gate.

Use the **actual mounted** `common.load_samples(dataset, False)`, fixed seed 2026, and `tile_boxes(h,w,392,0.25)` on every image header. Save index CSV and inventory JSON with dataset/version, category, split, label counts, dimensions, tile totals, total pixels, largest image, per-category test pixels, missing/invalid/size-mismatched masks, and multi-mask components/unions. Assert only selected dataset, nonempty train/calib/test for every expected category, good-only train/calib, pairwise disjoint resolved image paths, test good+defect, and all expected defect-mask files. Do not borrow test data for calibration. MVTec scope is exactly carpet/grid/leather/tile/wood; WFDD must match mounted categories; AITEX categories come from fabric filename IDs and need union validation. Record any intentional unmasked exclusions explicitly.

Existing inventory evidence is insufficient: carpet pilot has 4,032 train tiles and 117 test images/1,872 tiles (28 good/89 defect); v4 measured AITEX totals train 49/686 tiles, calib 49/686, test 149/2,085. AITEX category/label/mask counts are absent. MVTec/WFDD aggregate tile numbers below were estimates from supplied counts, not mounted full-index verification. Existing layout_probe samples only three image headers per dataset and caps listings; it cannot supply this complete gate without extension. No local mounted dataset is available in this preflight; closing it requires a separately authorized inventory execution or integration into the eventual full entrypoint before any fit.

### 3. Bound RAM and time against the actual runtime

Measured pilot: Tesla T4, torch 2.11.0+cu130, timm 1.0.30, batch 16; AMP 1.232407 seconds/iteration, GPU allocated peak 7.370 GiB. This is not GPU total/reserved memory or host RSS. Neither v5 logs nor the current entrypoint records `/proc/meminfo`, cgroup memory limit, GPU total/free memory, host RSS or disk free; actual future Kaggle resources/quota cannot be inferred from the API status. `enable_gpu` does not pin the next GPU. Reject CPU fallback; if GPU/dependencies/geometry change materially, refresh pilot evidence.

| Dataset | Conservative training-tile estimate before calibration removal | uint8 tile payload GiB | AMP total point estimate |
|---|---:|---:|---:|
| MVTec five textures | 20,256 | 8.70 | 3.614 h |
| WFDD | 14,628 | 6.28 | 3.505 h |
| AITEX | 686 measured after split | 0.29 | 3.475 h |

Payload is `tiles * 392 * 392 * 3`; array/list overhead and decode/batch/model working sets are extra. Dinomaly stacks only a minibatch, not all tiles into a second tensor. Benchmark's fit-local tile list is released before evaluation and Dinomaly does not retain it, so RAM budget uses the larger training/evaluation phase plus persistent model/runtime overhead, not automatically their sum. Evaluation retains full-resolution float32 stitched maps plus uint8 masks for one category: at least `5 * category_test_pixels` bytes before metric temporaries; `pixel_metrics` additionally converts each full-resolution mask before downsampling, concatenates reduced arrays, sorts for sklearn metrics and allocates AUPRO temporaries. A tile payload alone is not a conservative total-memory upper bound.

Before allocation, capture effective host limit (minimum relevant cgroup limit and physical RAM), current available RAM/RSS, actual GPU total/free/reserved and disk free. Derive category pixel-memory bound from the full inventory, include decoding/stitch/batch/metric/model overhead, and require explicit headroom below available RAM; measure RSS at load/fit/evaluation boundaries. No numerical host safety claim is possible yet. AITEX's wide images and WFDD's actual geometry must be included despite modest image counts.

Timing formula from measured v5, seconds: `10000*1.232407 + 5.368278101 + 33.080815054*(train_tiles/4032) + 103.953771503*(test_tiles/1872) + 60`. The estimates above use test tiles 8,160/1,928/2,085 respectively. Setup allowance 60 s and linear evaluation scaling are point assumptions, not a hard bound; calibration volume, pixel metrics, network/install delays and finalization must be budgeted separately. Require conservative total <=10 h against 12 h ceiling, including a larger sensitivity estimate (even doubling listed totals remains <7.23 h, but that is a scenario, not proof). Confirm current session/quota limit, capture observed throughput, and stop early on nonfinite loss/maps, unexpected counts or resource exhaustion. 300 AMP iterations do not prove 10,000-update stability; GradScaler skipped updates are not currently logged.

### 4. Retain exact provenance and inspect final artifacts

Current code emits `log.txt` plus `results/{dataset}__dinomaly_vitb_amp__unified.json`; Kaggle's file listing may flatten the result basename, so retain original downloaded tree and exact kernel version. It prints torch/timm/GPU/PIN, weight digest, phase times and allocated GPU peak but **does not write a complete provenance file, index, inventory, actual dataset versions, code archive digest, resolved code-root hash, all settings or package lock**. Subprocess output goes to Kaggle console rather than Tee's log; preserve both console/kernel log and `log.txt`.

Required full-run output contract: `log.txt`, captured Kaggle console log, `results/{dataset}__dinomaly_vitb_amp__unified.json` with expected category rows, `provenance.json`, `index.csv`, `inventory.json`, `resource-summary.json`, and a final output file/hash manifest. New JSON/CSV artifacts are executable preparation steps still to implement after ownership resolution, not files already emitted. Provenance must include kernel ID/version, private code dataset version/archive and file SHA256s, each mounted data version, resolved code root, upstream HEAD `1f252be03a918789b19848f0ca37166e7c28dada`, Python/package versions, device/RAM limits, exact settings/seed/tile geometry, and ViT-B weight SHA256 `73182a088cf94833c94b1666d1c99e02fe87e2007bff57b564fb6206e25dba71` (346,393,545 bytes in v5). Treat archive/version mismatches as failure before fit.

Validate expected category set, exact 20-key row schema, finite thresholds/scores and applicable metrics, counts matching inventory, and log completion with full iteration timing. A benchmark result list being nonempty is insufficient. No weights/checkpoints/raw private images should remain in outputs. Existing cleanup removes repos and selected weight suffixes, but not every cache/archive/extension; recursively inspect actual output inventory after completion before retention or sharing. Keep the pilot FP32/AMP JSONs separate because report.py merges their identical method names.

## Ordered handoff

1. Coordinator resolves shared-file ownership; freeze source and use combined proof above, rerunning focused tests only if affected source changes.
2. Prepare independently reviewable private single-dataset entrypoints/metadata implementing inventory, runtime/resource gates and provenance. Inspect exact staged archive; include `_upstream.py` and compare hashes.
3. Close mounted inventory/resource evidence before fitting; if this needs a separate probe, obtain coordinator direction because this task explicitly forbids launch/upload. No duplicate training job is needed to collect headers/resources.
4. Only after gates close, publish reviewed private code, verify its mounted version/hash, recheck no target job running, then execute one authorized AMP 10,000-iteration unified dataset job. Start subsequent datasets only with their own satisfied inventory/resource gates; retain each version's outputs.

Preflight's outstanding executable steps are these four gates; baseline validation is not on A2's critical path. No full-run result or unconditional resource-fit claim is made.

## Concrete preparation follow-up — 2026-11-12 (supersedes initial hold details)

Preparation is now implemented; **no training or probe jobs were started**. Original `bench_a2/run.py` remains SHA256 `8229301c4456e6944bccc13bf9f4fb51d9afd084233024001eb9def2f068c0ec`, unchanged from the initial preflight. Existing private publishing workflow was used for code versions 6 (initial guarded snapshot) and 7 (final version bindings and separate bounded probes); no kernel push occurred. A2 status was COMPLETE before each upload, and the returned owned-kernel inventory had no other A2 full/probe IDs. Recheck immediately before eventual execution.

### Implemented entrypoints

All paths below are relative to `scanner/training/fault/kaggle/`.

| Directory | New private kernel ID | Pinned inputs |
|---|---|---|
| a2_mvtec | anastabba/texpilot-a2-mvtec-amp-10k | anastabba/texpilot-fault-code/7 + ipythonx/mvtec-ad/2 |
| a2_wfdd | anastabba/texpilot-a2-wfdd-amp-10k | anastabba/texpilot-fault-code/7 + hodinhtrieu/the-woven-fabric-defect-detection-wfdd/1 |
| a2_aitex | anastabba/texpilot-a2-aitex-amp-10k | anastabba/texpilot-fault-code/7 + nexuswho/aitex-fabric-image-database/1 |
| a2_mvtec_probe | anastabba/texpilot-a2-mvtec-preflight | same MVTec inputs |
| a2_wfdd_probe | anastabba/texpilot-a2-wfdd-preflight | same WFDD inputs |
| a2_aitex_probe | anastabba/texpilot-a2-aitex-preflight | same AITEX inputs |

Version numbers were read with `datasets status SLUG --format 'json(current_version_number)'`; querying `status` for public datasets returned 404, while selecting only `current_version_number` succeeds. Installed CLI explicitly validates owner/slug/version dataset references. Server binding must still be confirmed in the eventual kernel version receipt because no push was performed here.

Each full entrypoint explicitly declares its dataset, Dinomaly ViT-B, AMP=True, unified, 10,000 iterations, SMOKE=False. Only code and the selected data are mounted. The entrypoint embeds hashes for all 11 transitively used benchmark/method/helper source files; its adjacent `source-manifest.json` records the same identities. The new shared `full_a2.py` owns preparation and validation; existing method, benchmark, shared common helper, publisher and old A2 files were reused without edits.

Probe directories have their own metadata/IDs, internet disabled, force `--preflight-only` even with no command-line arguments, and set a Linux 900-second alarm. They inspect mounted data/resources and write evidence without cloning, installing packages, downloading weights, constructing a model, fitting or scoring. This avoids relying on passing script arguments through Kaggle CLI. Probe `probe-complete.json` is emitted only after all gates pass; failures remain failed jobs. Probes require the pilot T4 GPU to establish the relevant available GPU memory as well as host memory.

### Guard behavior and proof

- Inventory resolves every selected image path and rejects duplicate paths, foreign datasets, invalid labels/splits, non-good train/calibration, missing splits, missing test labels, missing/empty defect masks and mismatched mask geometry. Every AITEX multi-mask component is unioned and validated. Every image header contributes exact geometry and tile totals; per-category split/label/image/tile/mask counts and pixel counts are saved. SHA256 of every selected image/mask binds the actual content. MVTec requires all five textures. WFDD compares loader output against all visible category directories so missing train folders cannot silently remove a category. AITEX's loader enumerates both good/defect fabric IDs, and each must pass the split gate.
- Resource checks read `/proc/meminfo` and cgroup v1/v2 limit/current usage, take the lower available allocation, and reserve 20% headroom. Training bound is twice the uint8 tile payload plus array allowance; evaluation uses `10*category_full_pixels + 256*category_reduced_pixels`, plus largest-image/tile scratch and 4 GiB runtime reserve. Budget uses the maximum training/evaluation phase. The gate reruns after dependency/weight setup; after tile allocation it also requires 4 GiB still available before `fit`. Host peak RSS, GPU free/total and final peak allocated GPU memory are recorded. It requires Tesla T4, >=10 GiB GPU free, >=12 GiB GPU total, >=5 GiB working disk free, and rejects CUDA absence.
- Runtime gate doubles measured AMP loop/load/evaluation costs, includes calibration tile scaling and 30 minutes setup before doubling, and requires <=10 hours. Already elapsed setup is checked again before training. This is an intentionally conservative planning scenario, **not a measured upper bound**. RAM allowance is likewise an engineering envelope, not a proof of every third-party allocation; the bounded probe is still required for actual allocation/geometry evidence, and the full job records observed resource usage. A failed gate must be investigated, not disabled simply to start a job.
- Downloaded ViT-B weight digest must equal the measured v5 digest. Every score map must have correct count/392-square shape and finite values. Persisted result JSON must contain exactly every inventoried category, the exact 20-key schema, matching good/defect counts, selected method/dataset/mode, and nonmissing finite numeric metrics. Final success requires exactly the allowed output files after cleanup; unexpected cached weights, source archives or images cause failure. Final hashes are written to `output-manifest.json`.
- Runtime provenance saves source hashes, resolved code root, declared version-pinned input bindings, selected settings, upstream PIN, Python and key package versions, actual device and weight hash. Bindings describe the prepared metadata; verify actual Kaggle kernel input bindings with its version receipt. Content hashes in `inventory.json` independently identify the data actually read.

Focused reproducible proof from workspace root:

```sh
PYTHONPATH=scanner .venv/bin/python -m pytest \
  scanner/tests/test_fault_a2_launch.py scanner/tests/test_fault_data.py \
  scanner/tests/test_fault_tiles.py scanner/tests/test_fault_bench.py \
  -q -o addopts=''
.venv/bin/ruff check scanner/training/fault/kaggle/full_a2.py \
  scanner/training/fault/kaggle/a2_* scanner/tests/test_fault_a2_launch.py
```

Result: **43 passed in 1.37s; Ruff all checks passed**. New tests cover split/label/path/category/mask failures, union behavior, exact hashes, allocation/time/disk rejection, missing/nonfinite result rejection, private dataset metadata and snapshot identities, and execute each probe main with a mocked runner to prove preflight is forced with a 900-second limit. Nearest data/tile/bench gate passes. Earlier combined wrapper proof remains 74 passed/2 anomalib skips; wrapper files were not changed. `git diff --check` passed.

### Private package verification

`publish_code.sh --dry-run` final staging had **183 files, 24,846,432 bytes**, no >5 MB omissions. Filename and private-key/token-pattern scans passed without printing candidate secrets. Existing publishing includes unrelated source/results from training/services by design; no new credential files or model weights were introduced. Private visibility was checked using downloaded remote metadata (`info.isPrivate=true`), rather than inferred from local metadata.

Final staging manifest SHA256 (canonical sorted JSON mapping paths to SHA256): `8fda5004effaf992d29be4623722fcba00e3d7fac180db5a3b8016b3e58e9111`. Kaggle excludes `dataset-metadata.json` from the downloadable payload, so expected payload is 182 files. Final remote byte comparison and version/archive identity are recorded below after completion.

Critical final source identities:

| File | SHA256 |
|---|---|
| full_a2.py | daf544acc1e03b247cc9e6dc96456a2ac9030da3b2fdb7d56821e8e46e8824b1 |
| a2_mvtec/run.py | be643f2b6968f6d428629b4abf2c57fabd1ad6a147d53d74a3a0bf426a47dccd |
| a2_wfdd/run.py | ecafa3cc4826a55340b5f04234a39b33bcb08efb2747a692e5cce539a43ca949 |
| a2_aitex/run.py | 8a48ccae997a8bf8f0847dd8afb04dc89467604482c19a7bf5f45d40852698aa |

Dinomaly/shared-helper/bench/common identities remain those in the first preflight table, and are enforced by the embedded manifest. A future edit to any enforced source requires regenerating entrypoint manifests and publishing a new code version; these snapshots deliberately reject stale mounted code.

### Remaining concrete launch steps

1. Coordinator reviews this implemented snapshot/resource uncertainty. Run the bounded dataset probe first, after checking its own ID and the full-run ID are absent/not running; a 404 for a new ID means absent, not a failed previous job. Example authorized next command (not executed here):

   ```sh
   "$HOME/.local/kaggle-cli/kaggle-anas" kernels push -p scanner/training/fault/kaggle/a2_mvtec_probe
   ```

2. Retain probe kernel/version receipt and outputs; confirm actual pinned input versions, complete category/mask inventory and actual host/GPU allocation. If server rejects version-qualified references or runtime dependencies/resources differ from the pilot, resolve that evidence before training. No installed package or hardware guess establishes readiness.
3. When probe evidence passes and no duplicate ID is running, push the corresponding full directory, e.g. `kernels push -p scanner/training/fault/kaggle/a2_mvtec`. WFDD/AITEX require their own successful inventory/resource probes. Original `anastabba/texpilot-bench-a2` is preserved.
4. Retain full `log.txt`, Kaggle console log/version receipt, result JSON, provenance, index, inventory, resource summary and output manifest privately. Runtime gates do not prove 10,000-step numerical stability, successful GradScaler updates or quality; these remain measured by the actual full run, with existing nonfinite-loss and new map/metric checks.

Final remote verification: **private code dataset version 7 is ready**, and the version-specific downloaded ZIP matches all **182 payload files byte-for-byte** against final staging; no extra or missing payload files. Downloaded archive SHA256: `c3f4d417b57d1a8c2915c30f95687ed6a304a948f8a0d4e87ad065b9529870b8`. Version-specific CLI inventory includes reviewed `_upstream.py`, Dinomaly, full runner, all full/probe entrypoints and source manifests; remote metadata confirms `isPrivate=true`. No full/probe kernel was pushed.

## Authorized execution follow-up — 2026-11-12, dispatched ctx_8d7c88d5a156

The coordinator reviewed preparation and authorized bounded probes followed by full runs only after each probe passes. Execution receipts and pulled private metadata/source were retained locally during launch verification; raw run artifacts remain with the private Kaggle kernels under the repository's run-output exclusion rule. Aggregate full-run metrics are recorded in [fault-a2-results-2026-11-13.md](fault-a2-results-2026-11-13.md). No source or guard was changed in this follow-up; old bench_a2 identity was untouched.

Initial exact-code status was `ready`, private code **version 7**. Complete owned-kernel listing (100-item page with fewer than 100 returned and no next page) contained none of the six new full/probe IDs. Direct status on nonexistent new IDs returned the CLI's generic permission-denied diagnostic rather than 404; this alone was not taken as absence, and the owned inventory was retained. Both each probe ID and corresponding full ID were checked before each push.

| Dataset | Action | Receipt | Prepared inputs | Actual state at last check |
|---|---|---|---|---|
| MVTec | bounded probe pushed | private `anastabba/texpilot-a2-mvtec-preflight`, version 1 | code/7 + MVTec/2 | RUNNING; artifacts not yet available |
| WFDD | bounded probe pushed | private `anastabba/texpilot-a2-wfdd-preflight`, version 1 | code/7 + WFDD/1 | RUNNING; artifacts not yet available |
| AITEX | queued locally, not pushed | none | code/7 + AITEX/1 | not started to keep at most two jobs in flight |
| All full kernels | no push | none | version-pinned prepared snapshots | not started; probe evidence required |

Both pushes explicitly requested `--accelerator NvidiaTeslaT4 -t 900`; internal alarms also cap probe code at 900 seconds. Returned metadata confirms private=true, GPU enabled, machine_shape=NvidiaTeslaT4, internet=false, and the selected code/data slugs only. Version-specific pulled source matches prepared entrypoints byte-for-byte: MVTec SHA256 `a6bbbfd951db3fd659b4734448a36a3f4c2f7e33937aa70c22b4394bbe8db246`, WFDD `b514ffe82636a3d07003659d8a3e4f7e21b76506747b9e81905252e0ed9dd737`. Server `kernels pull` normalizes `dataset_sources` to unversioned slugs; it therefore cannot independently prove the numerical mounted data versions. Do not misrepresent declared `INPUT_BINDINGS` as an independent server assertion. Code content is enforced by embedded SHA256 before inventory; actual image/mask identities and resolved mounts await probe provenance/inventory. If needed, confirm numerical input-version bindings in Kaggle's version UI before any full push.

Quota evidence at initial probe execution: **GPU 12.19 h used / 17.81 h remaining / 30 h total**, refresh `2026-11-14T00:00:00+00:00`; TPU 20 h remaining. Raw CLI quota JSON is retained. Recheck before every full push and reserve the conservative budget of any concurrent full job against remaining quota, rather than assuming all three doubled runtime envelopes fit 17.81 h simultaneously. No third job was submitted while the two probes remained in flight. Platform acceptance of the two probes is evidence of accepted allocations, not a published account concurrency-limit claim.

Kaggle CLI exposes status queries and `kernels logs --follow`, but no durable completion callback/Orca wake mechanism was established. Bounded live-log follows are used, with no indefinite status loop. The latest exact statuses/timestamps are retained in `probe-status-after-bounded-follow.json`; running jobs must not be repushed simply because artifacts are not ready.

Next supervised continuation:

```sh
KAGGLE="$HOME/.local/kaggle-cli/kaggle-anas"
"$KAGGLE" kernels status anastabba/texpilot-a2-mvtec-preflight/1
"$KAGGLE" kernels status anastabba/texpilot-a2-wfdd-preflight/1
# On COMPLETE, collect only small evidence (and preserve console traceback on ERROR):
"$KAGGLE" kernels output anastabba/texpilot-a2-mvtec-preflight/1 \
  -p scanner/docs/fault-a2-execution-2026-11-12/mvtec-probe-artifacts \
  --file-pattern '(log.txt|inventory.json|index.csv|provenance.json|resource-summary.json|probe-complete.json)$'
```

Repeat collection for WFDD. Inspect all expected categories/splits/labels/mask unions, exact mounted source hashes/version evidence, actual RAM/GPU/disk values and `budget` fields, and `probe-complete.json` before declaring a pass. On ERROR obtain `kernels logs ID/1` and inspect the guard failure; no guard was relaxed here. As a slot becomes free, recheck AITEX probe/full IDs and quota then submit `a2_aitex_probe` with the same accelerator/timeout. After each dataset passes and version evidence is sufficient, independently recheck its full target and quota before pushing its full directory. Full completion/results necessarily require later collection.

### MVTec probe passed and full version 1 launched

MVTec probe version 1 completed successfully and all six evidence artifacts were collected. Mounted source hashes exactly match the reviewed 11-file manifest (including Dinomaly and `_upstream.py`); torch/timm and T4 match pilot. Exact inventory totals are **16,807 train / 1,839 calibration / 7,421 test tiles** (tile images are 840-square, correcting the earlier all-1024 estimate). Every category has good-only disjoint train/calib, both test labels, nonempty validated defect masks, and saved image/mask content hashes. Categories: carpet 252/28 train/calib and 28/89 good/defect test; grid 238/26 and 21/57; leather 221/24 and 32/92; tile 207/23 and 33/84; wood 223/24 and 19/60.

Actual host available **29,134,565,376 bytes**, cgroup limit **32,212,254,720 bytes**, budget **19,844,192,384 bytes**, RSS peak 647,942,144 bytes; GPU free **15,526,068,224 bytes**, total **15,636,037,632 bytes**; disk free 20,940,034,048 bytes. Conservative runtime budget **29,552.36 s = 8.209 h** passes. Probe itself does not allocate the full training tiles or fit a model; the conservative bound and later full-run checks remain necessary.

Following separate full-ID check, complete owned inventory and quota recheck (**17.71 GPU h remaining**), private **anastabba/texpilot-a2-mvtec-amp-10k version 1** was successfully pushed with explicit T4 and **36,000-second timeout**. Server-pulled full source matches local snapshot byte-for-byte; metadata confirms private/T4/internet enabled. Coordinator was notified promptly (`msg_d2510658fabc`). Declared bindings are code/7 + MVTec/2; API metadata normalizes source slugs, with actual code identity independently proven by runtime hashes. No old A2 identity was changed.

### WFDD probe passed; AITEX bounded probe launched

WFDD private probe version 1 completed and its six artifacts were collected and validated against the reviewed code manifest. Categories are **grey_cloth, grid_cloth, pink_flower, yellow_cloth**; exact tiles **13,176 train / 1,452 calibration / 1,776 test**. Split image counts train/calib then test good/defect: grey_cloth 260/28 then 21/59; grid_cloth 1919/213 then 55/55; pink_flower 260/28 then 32/32; yellow_cloth 855/94 then 95/95. All masks passed; one yellow_cloth image is 513x512, all other WFDD images 512-square. Actual host available **30,693,683,200 bytes** against budget **16,460,995,584 bytes**, cgroup limit 30 GiB, disk 20,939,137,024 bytes, RSS peak 646,250,496 bytes. Conservative budget **28,822.85 s = 8.006 h** passes. Complete evidence is under wfdd-probe-artifacts and summarized in validated-probe-summary.json.

With WFDD probe finished and MVTec full still in flight, AITEX probe/full IDs were checked again, owned inventory showed no AITEX target, and quota was **17.70 GPU h remaining**. The prepared private AITEX bounded probe was pushed with T4 and 900-second timeout; receipt is aitex-probe-push.txt. WFDD full launch is held for a free slot while AITEX probe is in flight, keeping at most two jobs active. After that slot frees, a separate WFDD full-ID/status and quota check is still required before its full push. MVTec + WFDD conservative full reservations total **16.215 h**, so a third full conservative reservation would exceed currently remaining quota until actual completed work releases reservations.

Probe provenance currently labels kernel_id with its planned full target (shared runner behavior); use actual probe IDs/version from retained API receipts and pulled metadata, not that field, when auditing the probes. This labeling limitation does not change source/data/resource checks and was not patched mid-run.

### Execution handoff after bounded observation

At the timestamps in `fault-a2-execution-2026-11-12/handoff-status.json`, **MVTec full version 1 is RUNNING**, **AITEX probe version 1 is QUEUED**, and **WFDD full is not created**. The two completed probes are MVTec/WFDD version 1; both passed their recorded guards. AITEX's version-specific pulled source matches prepared bytes and server metadata confirms private/T4/internet disabled, but no AITEX runtime artifacts are available while queued. No job was repushed, no queued job was treated as failed, and no guard was weakened. Bounded CLI live-log follows exposed no output during startup; no durable asynchronous completion notification was established, so this is a supervised running/queued handoff rather than an indefinite polling loop.

Exact next checks are:

```sh
"$HOME/.local/kaggle-cli/kaggle-anas" kernels status anastabba/texpilot-a2-aitex-preflight/1
"$HOME/.local/kaggle-cli/kaggle-anas" kernels status anastabba/texpilot-a2-mvtec-amp-10k/1
```

When AITEX finishes, collect its six small probe evidence files using the command pattern above and inspect the actual gate outcome. If it passes, the next safe full launch is WFDD after independently rechecking `anastabba/texpilot-a2-wfdd-amp-10k`, full owned inventory and quota; MVTec+WFDD conservative reservations fit the last observed 17.70-hour balance, while all three conservative full reservations do not. AITEX full remains pending until a training slot and sufficient unreserved quota are available. A queued AITEX probe is a backend allocation wait, not evidence permitting a duplicate push. Full-run completion/results, actual optimizer stability and final artifact inventory still require later collection.

Note: this execution stage intentionally stops at the explicit running/queued handoff permitted by the task. It does not claim all three full runs launched or that AITEX passed. Report and receipts are durable, no source code changed, and `git diff --check` passed.

## Supervised continuation — ctx_a80bf8c778cb

Read-only status/ownership/quota checks at **2026-11-12 16:12:32–16:12:37 UTC** (raw `continuation-status.json`, `continuation-owned.csv`, `continuation-quota.json` retained):

- AITEX probe **version 1 remains QUEUED**; it was neither repushed nor treated as failed. Probe artifacts cannot yet be validated.
- MVTec full **version 1 remains RUNNING**; status was checked once in this continuation. No completion claim or retry is warranted; no final outputs were collected from an unfinished job.
- WFDD full target and AITEX full target remain absent from the complete owned-kernel inventory. Generic inaccessible-ID status diagnostics are retained alongside that inventory.
- GPU quota now **17.63 h remaining / 12.37 h used**, refresh unchanged. MVTec + WFDD conservative full envelopes sum **16.215 h**, so quota alone permits that pair, but available concurrency has not been established while MVTec runs and the already-submitted AITEX probe is awaiting allocation. A third outstanding GPU job was not submitted to bypass that queue. The third full budget still cannot be reserved concurrently.

No new source edits, uploads or job mutations were made during this continuation. One 45-second bounded AITEX live-log observation was used; no durable Kaggle-to-Orca completion callback is available. Once it ends, the final AITEX status is recorded separately below. This is an external allocation wait, not a guard failure or a completed objective.

Next event: **AITEX probe version 1 transitions from QUEUED/RUNNING to COMPLETE or ERROR**, freeing an outstanding allocation and exposing evidence. Use the exact status command above at a later supervised check (suggest **16:20 UTC**, rather than immediate repeat dispatch); on settlement, collect its small artifacts, preserve console error if any, and validate its masks/splits/resources/source hashes before any AITEX full launch. Recheck WFDD full ID, owned inventory and quota immediately before its prepared full push when a slot is available. MVTec should next be inspected on a meaningful completion/error event or a later scheduled check; expected training is several hours, not minutes. Overall full-run objective remains incomplete until all three full results and final output manifests are collected and validated.

Final bounded-observation check at **2026-11-12 16:13:45 UTC**: AITEX probe **version 1 transitioned to RUNNING** (`aitex-continuation-final-status.txt`), with no logs/artifacts exposed during the bounded follow. MVTec full remains RUNNING at its once-per-continuation observation. Both outstanding GPU jobs are now active, so WFDD full remains ready but not submitted; no duplicate or speculative third allocation was requested. Next supervised check remains approximately **16:20 UTC**, or an actual AITEX completion/error event if one is delivered, followed by evidence collection and safe WFDD launch checks. No launch/error notification was needed in this continuation because no job was launched or failed.

## Parallel productive full runs and AITEX root cause — ctx_e6cab367890e

Independent account/target checks retained in `parallel-*.txt`, `parallel-owned.csv` and `parallel-quota.json` found **MVTec full RUNNING**, **AITEX probe ERROR**, no WFDD full entry in the complete owned inventory, and **17.38 GPU h remaining**. MVTec+WFDD conservative reservations total **16.215 h**, leaving about 1.165 h before consumption adjustments. The failed AITEX probe freed its outstanding slot.

The prepared private **anastabba/texpilot-a2-wfdd-amp-10k version 1** was then successfully pushed with explicit T4 and 36,000-second timeout, using reviewed code/7 and WFDD/1 bindings. Receipt: `wfdd-full-push.txt`; version-specific pulled source/metadata: `wfdd-full-v1/`. Pulled source is byte-identical to the prepared launch, and metadata confirms private/T4. Latest independent status observations showed **both MVTec full v1 and WFDD full v1 RUNNING**. Coordinator received prompt launch notification `msg_9eb55fc2f124`. These are independent dataset fits; no existing job was altered or duplicated, and old bench_a2 was untouched. Completion, optimizer stability and full results remain unverified until later collection.

### AITEX: guard correctly exposed an empty annotation

Probe version 1's collected console (`aitex-probe-artifacts/texpilot-a2-aitex-preflight.log`) shows failure at inventory validation before training:

```text
ValueError: empty defect mask union: 0106_010_03.png
```

Downloaded **only** `Mask_images/0106_010_03_mask.png` from exact source dataset version 1 and decoded with Pillow. It is mode L, 4096x256, 1,136 bytes; every one of **1,048,576 pixels is zero**, extrema [0,0]. SHA256: `2fade062ebde9f8e797bc89038ae7eae1f7753cf2d026bfe1709ed33012b00bf`. Durable histogram/hash evidence: `aitex-empty-mask-evidence.json` (raw private image data is not copied into the report). Complete paginated source-version-1 inventory has 354 files (`aitex-source-file-inventory.json`); the only matching entries are the defect image and this plain mask, with no mask1/mask2 alternative. Therefore neither 0/1 mask encoding nor the loader choosing a plain mask before available mask components explains this failure.

No code defect was demonstrated: the nonempty-defect-mask invariant correctly stopped a label-1 image with an all-background annotation. No guard, threshold, label or sample was changed. Root repair requires a corrected annotation/source version, or an explicit benchmark decision about empty annotations; silently inventing a positive region, relabeling/removing the defect, or treating it as pixel-normal would corrupt the benchmark. AITEX full remains unlaunched and its errored probe was not repushed. Coordinator escalation `msg_1edfc372366b` states the exact corrective decision required. There may be further data issues after this first fail-fast error; no complete AITEX pass is claimed.

### GPU use, TPU and AI credits

- Two independent full notebooks now perform productive dataset fits concurrently. Current Dinomaly selects `torch.device("cuda")` by default and moves one model/batch to that device; it has no DistributedDataParallel/DataParallel or XLA execution. Adding a second device to a notebook does not automatically distribute the workload. No within-notebook multi-GPU speedup is claimed or speculative distribution patch introduced during active runs.
- The installed CLI advertises `NvidiaTeslaT4` as the **T4 x2** accelerator shape. Runtime probes recorded device 0 and its free/total memory, not device count or second-device utilization. Thus hardware bundling may include an unused second device per notebook; exact count/utilization is not independently captured, and two submitted notebooks must not be described as utilizing every provisioned GPU. The existing validated shape is preserved rather than changing hardware mid-run; no additional accelerator was requested solely to attach an idle second device. Future within-notebook parallelism needs a separate supported implementation and validation, not a device-count flag.
- Account `quota` evidence: **TPU 0.00 h used / 20.00 h remaining**, GPU 12.62 h used / 17.38 h remaining. TPU is available but this PyTorch/CUDA/autocast/GradScaler path has no torch_xla backend; TPU allocation would not run this code correctly without a port and a new performance/numerical pilot. It is a different accelerator budget, not an automatic extension of this validated CUDA job.
- Read-only `kaggle benchmarks quota` returned **Daily $0 used / $10 remaining / $10 total**, and **Monthly $0 used / $100 remaining / $100 total** (`ai-credit-quota.txt`). Installed CLI describes this as **Model Proxy AI inference spend quota in USD**. These are hosted model inference credits, not general GPU/TPU notebook compute or a budget for training an arbitrary local ViT. No model-proxy inference requests, credential initialization or credit spending occurred in this task; there is no useful inference-credit operation in the current optimizer/inventory path.

No source code was edited, so no redundant local test suite was run. Validation consisted of live statuses/receipts, source-byte equality, quota and privacy metadata, and exact original-mask decoding plus complete source-file inventory; `git diff --check` passes. Next meaningful events are completion/error of either full run, and coordinator provision of an AITEX annotation/policy resolution. Overall objective remains incomplete until MVTec/WFDD full outputs are collected/validated and AITEX data is resolved and safely run.

## Two-GPU implementation follow-up

See [fault-a2-ddp-2026-11-12.md](fault-a2-ddp-2026-11-12.md): two-rank DDP with global batch/mining/optimizer semantics is implemented, 66 focused tests pass, and private code/9 is published and byte-verified with distinct future full-run IDs. The bounded real T4-pair comparison was rejected by the backend's explicit maximum of two active GPU sessions; it was not created or queued. Both original full v1 jobs remain running and untouched, so real device-use/speedup evidence and any restart decision must wait for a freed session. No AITEX policy or guard changed.
