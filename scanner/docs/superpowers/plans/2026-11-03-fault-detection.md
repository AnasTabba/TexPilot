# TexPilot Fault Detection + Look-alike Fabric ID — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and benchmark a fabric/garment fault detector (Dinomaly-first), plug it into the v8 scanner and a live phone-camera stream, and test patch-texture features for look-alike fabric ID — with every reported number measured.

**Architecture:** Offline research code in `training/fault/` and `training/fabric_texture/` runs on Kaggle (code shipped as a private Kaggle dataset, data mounted from Kaggle). Results land as JSON, rendered to one Markdown results doc. Serving code adds an optional `fault` stage to `services/vision/scanner.py`, an optional `fault` field to the API, and `scripts/fault_stream.py` for live video.

**Tech Stack:** Python 3.10 (local) / Kaggle Python 3.11+, PyTorch 2.x, timm 1.0, anomalib 2.x (PatchCore, Reverse Distillation, EfficientAD), official Dinomaly repo (Apache-2.0), INP-Former (MIT), MuSc (MIT), DINOv2-registers ViT-B/14 and ViT-S/14, scikit-learn, OpenCV, FastAPI/Pydantic (existing).

**Spec:** `docs/superpowers/specs/2026-11-03-fault-detection-and-fine-grained-fabric-design.md` (read §1b, §1c, §4–§6, §10b, §10c).

## Global Constraints

- Commits: user is sole author — **no `Co-Authored-By` or AI footer lines**. Commit messages plain English.
- Work only in worktree `~/Documents/iba/sem7/FYP-fault` on branch `feat/fault-detection` (from `6228723`). Never touch the main checkout's uncommitted files. Never push to GitHub unless the user says so.
- Code reaches Kaggle as private dataset `anastabba/texpilot-fault-code` (`kaggle datasets version`), not via a GitHub clone.
- Kaggle CLI: `~/.local/kaggle-cli/kaggle-anas` (account `anastabba`); second account `~/.local/kaggle-cli/bin/kaggle` (`yaseenazhar`) for parallel GPU runs. Never print tokens. Download only small result files (`--file-pattern`).
- Mac: no training; heavy local commands under `nice -n 10`. Tests: `.venv/bin/pytest -q` (default excludes `-m slow`); lint `ruff check` (line length 100).
- Seed 2026 everywhere. Tile size 392 px. Calibration set per category: max(10 % of train-good, min(20, half of train-good)) images, seed 2026 (AITEX: per fabric ID). Operating threshold: 99.5th percentile of calibration-good **tile** scores (false-alarm target 0.5 % of good tiles). Never tune on test.
- Jury bar (report pass/miss honestly): AITEX mean image AUROC > 96.5; at frozen threshold ≥ 90 % defective-image recall with ≤ 5 false alarms per 1,000 good images.
- Metrics per dataset × category × method: image AUROC, image AP, pixel AUROC, AUPRO (FPR ≤ 0.3), pixel AP, F1 at frozen threshold, false alarms / 1,000 good with 95 % Clopper–Pearson CI, latency ms/image (T4 and CPU) with tiles per image.
- Part C keep-rule: paired bootstrap (1,000 resamples by product, seed 2026) 95 % CI of macro-F1 difference vs v8 `local_fabric` head > 0. Lead every classification result with macro-F1, then accuracy.
- Scanner fault stage adds ≤ 1.5 s per scan on the Mac; off (env unset) ⇒ responses byte-identical to today.
- Results freeze: 24 Nov 2026. Datasets/licences recorded in the results doc.

## Review Focus

- Grayscale / 16-bit / RGBA images (AITEX is grayscale PNG): must be converted to 3-channel RGB uint8, not crash or mis-normalise → test in Task 2.
- Images smaller than one tile (TILDA 64 px, StitchingNet 224 px): one tile, resized up to 392, map resized back → test in Task 2.
- `TEXPILOT_FAULT_MODEL` set to a missing or broken folder: server still starts, scans still work, note `COMPONENT_FAILED` → test in Task 8.
- A test category with zero defective (or zero good) images: AUROC/AP reported as `null`, run continues → test in Task 3.
- Live camera disconnects or video ends: stream exits cleanly, final summary written, no traceback → test in Task 10.

---

### Task 1: Worktree, code-dataset publisher, dataset index (MVTec layout sets)

**Files:**
- Create: `training/fault/__init__.py`, `training/fault/data.py`, `training/fault/publish_code.sh`
- Test: `tests/test_fault_data.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class Sample: path: str; label: int  # 0 good, 1 defect; mask: str | None; category: str; dataset: str; split: str  # "train" | "calib" | "test"`
- Produces: `def index_mvtec_layout(root: Path, dataset: str, categories: list[str] | None = None) -> list[Sample]` — reads `<cat>/train/good`, `<cat>/test/<type>`, `<cat>/ground_truth/<type>/<stem>_mask.png`; carves `calib` from train-good per category (size per Global Constraints, seed 2026).
- Produces: `def index_aitex(root: Path) -> list[Sample]` — `NODefect_images/<fabric_id>/*` good, `Defect_images/*` defect with `Mask_images/<stem>_mask.png`; category = fabric id (from `nnnn_ddd_ff` → `ff`); per-fabric: 70 % of good → train, calib carved from train, rest good + all defect → test.
- Produces: `def save_index(samples: list[Sample], path: Path) -> None` / `def load_index(path: Path) -> list[Sample]` (CSV).

- [ ] **Step 1:** Create worktree: `git worktree add ~/Documents/iba/sem7/FYP-fault -b feat/fault-detection 6228723`; symlink `.venv` from the main checkout. Verify `.venv/bin/pytest -q` passes there.
- [ ] **Step 2: Write failing tests** in `tests/test_fault_data.py` building tiny fake trees in `tmp_path`:
  - `test_mvtec_layout_counts`: 30 train-good, 5 test-good, 4 test-`hole` with masks ⇒ 15 calib (half of 30, since min(20, 15) = 15 > 10 % = 3), 15 train, test has 9, defect samples have mask paths that exist.
  - `test_calib_is_deterministic`: two calls ⇒ identical calib paths.
  - `test_aitex_groups_by_fabric`: files `0001_002_01.png` etc. ⇒ categories `01`, masks matched by stem.
  - `test_index_roundtrip`: `load_index(save_index(x))` equals x.
- [ ] **Step 3:** Run `.venv/bin/pytest tests/test_fault_data.py -v` ⇒ FAIL (module missing).
- [ ] **Step 4:** Implement `training/fault/data.py`.
- [ ] **Step 5:** Run tests ⇒ PASS.
- [ ] **Step 6:** `publish_code.sh`: copies `training/`, `services/`, `pyproject.toml` into a temp dir with `dataset-metadata.json` (`id: anastabba/texpilot-fault-code`, private) and runs `kaggle-anas datasets version -p <dir> -m "<git short sha>" --dir-mode zip` (or `datasets create` first time). Run it once; verify `kaggle-anas datasets files anastabba/texpilot-fault-code` lists `training`.
- [ ] **Step 7:** Commit `training/fault/ tests/test_fault_data.py` — "Index MVTec-layout and AITEX fault datasets with a fixed calibration split".

### Task 2: Image loading and tiling

**Files:**
- Create: `training/fault/tiles.py`
- Test: `tests/test_fault_tiles.py`

**Interfaces:**
- Produces: `def load_rgb(path: str) -> np.ndarray` (H×W×3 uint8; grayscale/RGBA/16-bit converted).
- Produces: `def tile_boxes(h: int, w: int, size: int = 392, overlap: float = 0.25) -> list[tuple[int, int, int, int]]` — covers the full image; image smaller than `size` in a dimension ⇒ one tile spanning it.
- Produces: `def stitch(maps: list[np.ndarray], boxes, h: int, w: int) -> np.ndarray` — per-pixel max over overlapping tile maps (each map resized to its box).

- [ ] **Step 1: Failing tests:** `test_load_rgb_gray16` (16-bit grayscale PNG ⇒ shape (h,w,3), dtype uint8, values scaled not clipped), `test_load_rgb_rgba`, `test_tiles_cover_wide_strip` (h=256, w=4096 ⇒ every pixel column covered, all boxes inside image), `test_small_image_one_tile` (64×64 ⇒ exactly one box (0,0,64,64)), `test_stitch_max` (two overlapping maps of 1 and 2 ⇒ overlap = 2).
- [ ] **Step 2:** Run ⇒ FAIL. **Step 3:** Implement with PIL + numpy + `cv2.resize`. **Step 4:** Run ⇒ PASS.
- [ ] **Step 5:** Commit — "Tile wide fabric images and stitch anomaly maps".

### Task 3: Metrics and operating point

**Files:**
- Create: `training/fault/metrics.py`
- Test: `tests/test_fault_metrics.py`

**Interfaces:**
- Produces: `def image_metrics(labels: np.ndarray, scores: np.ndarray) -> dict` ⇒ `{"auroc", "ap"}` (`None` when only one class present).
- Produces: `def pixel_metrics(masks: list[np.ndarray], maps: list[np.ndarray]) -> dict` ⇒ `{"pixel_auroc", "pixel_ap", "aupro"}`; AUPRO = area under per-region overlap vs FPR curve up to FPR 0.3, normalised by 0.3 (regions via `scipy.ndimage.label`), maps downsampled to ≤ 256 px long side for speed.
- Produces: `def threshold_at_far(good_scores: np.ndarray, far: float = 0.005) -> float` (quantile `1 - far`).
- Produces: `def operating_point(labels, scores, thr) -> dict` ⇒ `{"recall", "precision", "f1", "false_alarms_per_1000", "fa_ci95": [lo, hi], "n_good", "n_defect"}`; CI = Clopper–Pearson via `scipy.stats.beta`; 0 false alarms ⇒ lo 0, hi per Clopper–Pearson (≈ 3/n).
- Produces: `def paired_bootstrap_f1(y, pred_a, pred_b, groups, n=1000, seed=2026) -> dict` ⇒ `{"delta", "ci95": [lo, hi]}` (macro-F1 of b minus a, resampling groups).

- [ ] **Step 1: Failing tests:** perfect scores ⇒ auroc 1.0; all-good labels ⇒ auroc `None` (no raise); `aupro` of a map equal to the mask ⇒ ≥ 0.99; `threshold_at_far` on `arange(1000)` with far 0.005 ⇒ 994.005 ± 1; operating point with 0 false alarms in 1000 good ⇒ `false_alarms_per_1000 == 0` and `fa_ci95[1]` between 3.0 and 3.8; paired bootstrap of identical predictions ⇒ delta 0 and CI contains 0.
- [ ] **Step 2–4:** fail ⇒ implement (sklearn `roc_auc_score`, `average_precision_score`) ⇒ pass.
- [ ] **Step 5:** Commit — "Fault metrics: AUROC, AUPRO, false alarms with confidence interval, paired bootstrap".

### Task 4: Perturbation suite

**Files:**
- Create: `training/fault/perturb.py`
- Test: `tests/test_fault_perturb.py`

**Interfaces:**
- Produces: `PERTURBATIONS: dict[str, Callable[[np.ndarray, np.random.Generator], np.ndarray]]` with exactly these keys: `brightness_up` (×1.3), `brightness_down` (×0.7), `warm` (R×1.1, B×0.9), `cool` (R×0.9, B×1.1), `gauss_blur` (σ=2), `motion_blur` (horizontal kernel 9), `jpeg30` (JPEG quality 30), `noise` (Gaussian σ=8). All return uint8 RGB of the same shape.

- [ ] **Step 1: Failing tests:** every key keeps shape and dtype; `brightness_up` mean > input mean; `jpeg30` output differs from input; same generator seed ⇒ identical `noise` output.
- [ ] **Step 2–4:** fail ⇒ implement with numpy/OpenCV ⇒ pass. **Step 5:** Commit — "Factory-floor perturbation suite".

### Task 5: Baseline benchmark kernel (A1): MuSc, PatchCore, Reverse Distillation, EfficientAD on WFDD, AITEX, MVTec textures

**Files:**
- Create: `training/fault/bench.py`, `training/fault/methods/__init__.py`, `training/fault/methods/anomalib_methods.py`, `training/fault/methods/musc.py`, `training/fault/kaggle/bench_a1/{run.py,kernel-metadata.json}`
- Test: `tests/test_fault_bench.py`

**Interfaces:**
- Consumes: Task 1 `Sample`, index functions; Task 2 `load_rgb`, `tile_boxes`, `stitch`; Task 3 metrics.
- Produces: `class Method(Protocol): name: str; def fit(self, train: list[np.ndarray]) -> None; def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]  # one H×W map per tile`
- Produces: `def run_benchmark(method: Method, samples: list[Sample], out_json: Path, perturbation: str | None = None) -> dict` — per category: fit on train tiles, calib scores ⇒ threshold, test ⇒ maps (stitched), image score = max of map; writes `{"dataset","category","method","perturbation", metrics..., "threshold", "latency_ms", "tiles_per_image"}` rows. Unified mode = fit once on all categories of a dataset (`mode="unified"`), per-category mode = fit per category (`mode="per_category"`).
- Produces result files: `results/<dataset>__<method>__<mode>.json`.

- [ ] **Step 1: Failing test** `test_run_benchmark_with_fake_method`: a fake `Method` whose map = pixel brightness; synthetic dataset where defects are white squares ⇒ image auroc 1.0, row has all metric keys, threshold came from calib only (assert calib scores used: change test images, threshold unchanged).
- [ ] **Step 2–4:** fail ⇒ implement `bench.py` ⇒ pass.
- [ ] **Step 5:** Wrap anomalib `Patchcore`, `ReverseDistillation`, `EfficientAd` (anomalib 2.x, pinned version recorded in kernel log) and MuSc (clone `xrli-U/MuSc` at a pinned commit; ViT-L-14-336 backbone; zero-shot ⇒ `fit` stores nothing) behind `Method`. Image size 392 for all.
- [ ] **Step 6:** Kernel `bench_a1`: GPU T4, internet on, `dataset_sources`: `anastabba/texpilot-fault-code`, `hodinhtrieu/the-woven-fabric-defect-detection-wfdd`, `nexuswho/aitex-fabric-image-database`, `ipythonx/mvtec-ad` (categories carpet, grid, leather, tile, wood). Writes `results/*.json` + `log.txt` to `/kaggle/working`. Push with `kaggle-anas kernels push`.
- [ ] **Step 7:** On completion fetch `--file-pattern '\.json$|log\.txt'` to `runs/fault/a1/`; controller audits: row counts per dataset/category, no NaN where both classes exist, MuSc MVTec carpet image AUROC within ±1.5 of its README 99.88 (sanity check of our pipeline). If outside, stop and debug before Task 6.
- [ ] **Step 8:** Commit code + `runs/fault/a1/*.json` — "Baseline fault benchmark on WFDD, AITEX, MVTec textures".

### Task 6: Dinomaly + INP-Former kernel (A2), all datasets, ablations, robustness, export

**Files:**
- Create: `training/fault/methods/dinomaly.py`, `training/fault/methods/inpformer.py`, `training/fault/index_extra.py`, `training/fault/kaggle/bench_a2/{run.py,kernel-metadata.json}`, `training/fault/kaggle/layout_probe/{run.py,kernel-metadata.json}`
- Test: `tests/test_fault_index_extra.py`

**Interfaces:**
- Produces: `def index_zju_leaper(root: Path) -> list[Sample]` (categories = the 19 patterns; uses official split files if present under the dataset, else seed-2026 70/30 split per pattern by image id, documented in the result rows as `"split": "ours"`).
- Produces: `def index_realiad_variety(root: Path) -> list[Sample]` (extracts the 7 category zips; uses the dataset's JSON split files from `realiadvariety_jsons.zip`).
- Produces: `def index_itd(root: Path) -> list[Sample]` (MVTec layout; delegates to `index_mvtec_layout`).
- Produces: `def index_stitchingnet(root: Path) -> list[Sample]` (`<fabric>/<n. Class>/*.jpg`; `0. Normal` = good; category = fabric; anomaly mode: train/calib from Normal only, test = held-out Normal + all defect classes, 6:2:2 per fabric, seed 2026).
- Produces: export folder `fault_model/` with `{weights.pt, config.json {"backbone","image_size":392,"thresholds":{dataset:thr},"version"}}` for ViT-B and ViT-S.

- [ ] **Step 1:** `layout_probe` CPU kernel (no GPU) mounting `bnhphan/zju-dataset` and kernel outputs `anastabba/texpilot-get-variety`: prints directory tree (3 levels), split-file names and 3 sample lines of each JSON/XML/TXT. Fetch log; write tiny fixture trees in tests mirroring the real layout.
- [ ] **Step 2: Failing tests** for `index_zju_leaper`, `index_realiad_variety` and `index_stitchingnet` on those fixtures (counts, masks resolved, calib carved, split marked).
- [ ] **Step 3–4:** implement ⇒ pass.
- [ ] **Step 5:** Wrap Dinomaly (official repo, pinned commit, ViT-B/14 reg, 392 px, iterations per the repo's MVTec recipe) and INP-Former (official repo, pinned commit) behind `Method`. Unified mode per dataset.
- [ ] **Step 6:** Kernel `bench_a2` (account `anastabba`, T4): Dinomaly on WFDD, AITEX, MVTec textures, ZJU-Leaper, Real-IAD Variety garment subset, StitchingNet (`hyungjung/stitchingnet-dataset`), ITD (download via `gdown` from the Google Drive link in `SimonThomine/IndustrialTextileDataset` README). Ablations on AITEX + ZJU-Leaper: per-category vs unified; 8-shot and 16-shot good images per category; tiled vs whole image. Robustness: every `PERTURBATIONS` key on WFDD + AITEX test sets with the clean-calibrated threshold. Latency: T4 ms/image and CPU (OpenVINO export, 4 threads) ms/image, ViT-B and ViT-S. Export `fault_model/` (trained on WFDD+AITEX+MVTec textures+ITD good images, unified) for serving.
- [ ] **Step 7:** Kernel `bench_a2_inp` (account `yaseenazhar`, parallel): INP-Former on the same datasets (cut first if GPU quota runs out — spec §10b).
- [ ] **Step 8:** Fetch JSON + `fault_model/` (ViT-S and ViT-B, each < 400 MB) to `runs/fault/a2/` and `models/fault-v1/`. Controller audits: Dinomaly MVTec carpet image AUROC within ±1.5 of paper's 99.8; check jury bar rows.
- [ ] **Step 9:** Commit code + JSON (not weights; add `models/fault-v1/` to the existing model-ignore rules) — "Dinomaly and INP-Former fault benchmark with ablations and robustness".

### Task 7: Defect naming classifier

**Files:**
- Create: `training/fault/naming.py`, `training/fault/kaggle/naming/{run.py,kernel-metadata.json}`
- Test: `tests/test_fault_naming.py`

**Interfaces:**
- Produces: `def fit_naming(features: np.ndarray, labels: list[str], groups: list[str]) -> NamingModel` and `class NamingModel: classes: list[str]; threshold: float; def predict(self, feats: np.ndarray) -> list[tuple[str | None, float]]` (None ⇒ "defect, type unknown"; threshold chosen on val for 90 % precision of answered).
- Data: StitchingNet (10 defect classes, authors' 6:2:2 split), TILDA patches (hole, objects, oil spot, thread error), WFDD grey cloth (contaminated, flecked, line, string), `belkhirnacim/textiledefectdetection` (color, cut, hole, thread, metal_contamination). Features: frozen DINOv2 ViT-S/14 CLS+mean-patch on the defect crop (mask bounding box ×1.5, or whole patch). Model: balanced logistic regression. Report macro-F1 then accuracy per source.

- [ ] **Step 1: Failing tests:** separable synthetic features ⇒ macro-F1 1.0; low-confidence row ⇒ `(None, p)`; threshold never computed from test rows.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass. **Step 5:** Kaggle kernel; fetch `naming_results.json` + `naming_model.joblib` to `runs/fault/naming/`, `models/fault-v1/naming.joblib`.
- [ ] **Step 6:** Commit — "Name defect types with an abstaining classifier".

### Task 8: Scanner fault stage

**Files:**
- Create: `services/vision/fault.py`
- Modify: `services/vision/predictor.py` (add `FaultRegion`, `FaultOutput`; `VisionOutput.fault: FaultOutput | None = None`), `services/vision/scanner.py:22-89` (constructor arg `fault=None`; call after heads), `services/vision/scanner.py:92-109` (`build_scanner(..., fault_dir: Path | None = None)`)
- Test: `tests/test_scanner_fault.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class FaultRegion: box: tuple[float, float, float, float]; score: float; type: str | None = None; type_confidence: float | None = None` (box normalised 0–1).
- Produces: `@dataclass(frozen=True) class FaultOutput: score: float; is_fault: bool; threshold: float; regions: tuple[FaultRegion, ...]; heatmap_png_b64: str | None; model_version: str; skipped_reason: str | None = None`.
- Produces: `class FaultDetector: version: str; def __init__(self, model_dir: Path, device): ...; def detect(self, image: np.ndarray, box: tuple[float, float, float, float] | None) -> FaultOutput`. Crop = garment box (or whole image); ≤ 6 tiles (largest grid of 392 px tiles that fits, else resize crop so it does); regions = connected components of map > threshold, top 5 by score; heatmap = JET overlay PNG at ≤ 512 px long side, base64. Box covering < 15 % of the image ⇒ `FaultOutput(score=0, is_fault=False, …, skipped_reason="garment too small for a close-up fault check")`.
- Scanner: `timings["fault_model"]`; detector exceptions go through `_try(notes, "fault detector", …)` ⇒ `fault=None` + `COMPONENT_FAILED` note.

- [ ] **Step 1: Failing tests** (fakes, no real model): fault stage absent ⇒ `out.fault is None` and timings have no `fault_model`; fake detector returns a fault ⇒ `out.fault.is_fault` and `"fault_model" in out.timings_ms`; fake detector raises ⇒ scan returns, `fault is None`, note `COMPONENT_FAILED` "fault detector failed: …"; `FaultDetector` with `model_dir` missing ⇒ `build_scanner` raises a clear `FileNotFoundError` (caught at config level, Task 9); small-box rule ⇒ `skipped_reason` set.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass. Slow test `tests/test_slow_fault.py` (`@pytest.mark.slow`): real `models/fault-v1` ViT-S on a WFDD good and a defect image ⇒ defect score > good score; elapsed < 1.5 s on the Mac.
- [ ] **Step 5:** Commit — "Optional fault stage in the scanner".

### Task 9: API contract and config

**Files:**
- Modify: `services/api/schemas.py` (add `FaultRegionModel`, `FaultModel`; `ScanResult.fault: FaultModel | None = None`), `services/api/pipeline.py:81-124` (map `vision.fault`; when `is_fault` append flag `FAULT_DETECTED`, severity `"medium"`, message "Possible fabric fault: <type or 'unknown type'> (score <s>)"), `services/api/config.py:35-69` (`Settings.fault_model: Path | None` from env `TEXPILOT_FAULT_MODEL`; `build_predictor` passes it; on load failure log + run without fault stage; `model_version` gains `+fault=<version>`)
- Test: `tests/test_api_fault.py`

- [ ] **Step 1: Failing tests:** env unset ⇒ `ScanResult` JSON has `"fault": null` and no `FAULT_DETECTED` (and all other fields equal to a pre-change snapshot for the stub predictor); stub predictor returning a fault ⇒ `fault.is_fault` true and flag present with severity `medium`; `TEXPILOT_FAULT_MODEL=/nonexistent` ⇒ `build_predictor` still returns a working predictor and `model_version` has no `+fault`.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass; run full `.venv/bin/pytest -q` ⇒ all pass.
- [ ] **Step 5:** Commit — "Expose fault results in the scan API behind TEXPILOT_FAULT_MODEL".

### Task 10: Live stream with confirm-then-alert

**Files:**
- Create: `scripts/fault_stream.py`
- Modify: `services/vision/fault.py` (add `StopLatch`)
- Test: `tests/test_fault_stream.py`

**Interfaces:**
- Produces: `class StopLatch: def __init__(self, k: int = 3, n: int = 5): ...; def update(self, is_fault: bool) -> bool  # True once K of last N are faults; stays True until reset(); def reset(self) -> None`.
- CLI: `scripts/fault_stream.py --source <0|rtsp/http url|video file> --model models/fault-v1/vit_s --every 3 --k 3 --n 5 [--webhook URL] [--log runs/fault/stream/<timestamp>.jsonl] [--show]`. Phone source = IP-camera app URL. Per processed frame: one JSONL row `{t, frame, score, is_fault, latched, latency_ms}`; on latch: console banner + optional webhook POST `{event:"STOP", score, frame, t}` (timeout 2 s, failure logged, never crashes). End of stream / camera lost ⇒ summary row `{frames, processed, alarms, mean_latency_ms, p95_latency_ms}` and exit 0.

- [ ] **Step 1: Failing tests:** `StopLatch(3,5)` with F,T,F,T,T ⇒ latches on 5th update; stays latched on later F; `reset()` clears; stream main on a 20-frame synthetic video file (written with OpenCV in `tmp_path`) and a fake detector ⇒ JSONL has 20/`every` rows + summary, exit code 0; source that cannot be opened ⇒ exit code 2 with message, no traceback.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass.
- [ ] **Step 5:** Manual check (controller, Mac): run on a WFDD defect slideshow video ⇒ alarm latches; on a good-only video ⇒ report false alarms per hour. Save logs under `runs/fault/stream/`.
- [ ] **Step 6:** Commit — "Live fault stream with K-of-N confirmation".

### Task 11: Look-alike fabric texture features (Part C, cut first)

**Files:**
- Create: `training/fabric_texture/__init__.py`, `training/fabric_texture/features.py`, `training/fabric_texture/heads.py`, `training/fabric_texture/kaggle/run.py`, `training/fabric_texture/kaggle/kernel-metadata.json`
- Test: `tests/test_fabric_texture.py`

**Interfaces:**
- Produces: `def crops(img: np.ndarray, n: int = 5, size: int = 392) -> list[np.ndarray]` (centre + 4 corners at native scale; image smaller than size ⇒ resized up).
- Produces: `def pool_tokens(tokens: torch.Tensor) -> torch.Tensor` ⇒ concat(mean, max, GeM p=3) over the patch axis.
- Produces: `class PatchMemory: def fit(self, tokens_by_class: dict[str, np.ndarray], per_class: int = 20000, seed: int = 2026); def scores(self, tokens: np.ndarray) -> np.ndarray  # per class: mean of nearest-patch distances (lower = closer)`.
- Data: Kaggle `texpilot-shop-scrape` with the **same product-level split** as `models/custom/local_fabric` (md5 of `store+product_id` mod 100: <70 train, <85 val, else test; classes = the 17 in its `head.json`). Encoders: scanner-v8 SigLIP2 (`models/scanner-v8/head_a` encoder, as a Kaggle dataset) and DINOv2-reg ViT-B/14.
- Variants (each scored on val, best one on test once): v8 baseline (reproduce 0.6250 test macro-F1 within ±0.01 first — if not reproduced, stop and report), patch-pooled SigLIP2, patch-pooled DINOv2, both concatenated, + PatchMemory scores as extra features, + label cleaning (drop train photos whose 5-fold cross-fitted predicted probability of their own label < 0.05). Head: balanced logistic regression (C grid 0.03/0.1/0.3), crop-averaged probabilities.
- Report: macro-F1 then accuracy; per-class F1; confusion matrix for cambric/khaddar/karandi/lawn/slub; paired bootstrap vs v8; same features scored on `runs/human_verify/round2/verified_conservative.csv` (641 photos; archive fabric classes; head trained on the archive train split from `yaseenazhar/texpilot-fabric-split`).

- [ ] **Step 1: Failing tests:** `crops` returns 5 arrays of 392×392; `pool_tokens` output length 3×dim; `PatchMemory` on two clusters ⇒ a cluster-A token scores closer to A.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass. **Step 5:** Kaggle run (account `yaseenazhar`); fetch `texture_results.json`, per-class CSV, confusion PNG to `runs/fabric_texture/`.
- [ ] **Step 6:** Controller applies the keep-rule. Commit code + results — "Patch-texture features for look-alike fabrics".

### Task 12: Serve the texture head (only if Task 11 passes its keep-rule)

**Files:**
- Modify: `services/vision/backbone.py` (add `patch_tokens(model, x) -> torch.Tensor`), `services/vision/custom.py` (head kind `"texture"`: features = crop-averaged `pool_tokens` from the named encoder), `models/custom/local_fabric/` (new version; previous kept as `models/custom/local_fabric_v8/`)
- Test: `tests/test_custom_heads.py` (extend)

- [ ] **Step 1: Failing test:** a texture-kind head with a fake encoder returns the expected class; existing linear heads unchanged.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass; slow test: real scan of one shop photo per class returns a label; scan latency increase ≤ 1.0 s.
- [ ] **Step 5:** Commit — "Serve the patch-texture fabric head".

### Task 13: Results document and freeze (24 Nov)

**Files:**
- Create: `training/fault/report.py`, `docs/fault-results-2026-11.md`
- Test: `tests/test_fault_report.py`

**Interfaces:**
- Produces: `def render(results_dirs: list[Path]) -> str` — Markdown tables: per dataset × method (image AUROC, pixel AUROC, AUPRO, F1@thr, FA/1000 with CI, ms/image), worst-category rows, ablation tables, robustness drop per perturbation, jury-bar check (PASS/MISS per criterion with the numbers), naming macro-F1, Part C table. Every number from a JSON file; the doc lists the source file per table.

- [ ] **Step 1: Failing test:** two fake JSON rows ⇒ rendered table contains both values and the source file name; a missing metric renders `—`, not `None`.
- [ ] **Step 2–4:** fail ⇒ implement ⇒ pass.
- [ ] **Step 5:** Render `docs/fault-results-2026-11.md`; controller cross-checks 10 random cells against the JSON; add the datasets/licences table and the citations list from the research doc.
- [ ] **Step 6:** Commit — "Fault detection results for the November defence".
