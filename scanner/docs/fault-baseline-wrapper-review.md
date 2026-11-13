# Fault baseline wrapper review

## MuSc, PatchCore, Reverse Distillation — 2026-11-12

Reviewed only `training/fault/methods/musc.py`, `anomalib_methods.py`, their focused tests,
and the benchmark contract. Existing dirty checkout edits were preserved. Shared upstream
import isolation is supplied by the INPFormer reviewer in `_upstream.py`; MuSc uses that
helper rather than independently manipulating process-global import state.

### Source evidence and invariants

Local scratchpad clones under `/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/7465821c-727f-422e-b6d5-83704616dd8a/scratchpad/agents/`:

- `anomalib-research/repo`, commit `1684b8ab316d098beb997e4f2d340262b4c21566`:
  `models/image/patchcore/lightning_model.py` configures Resize + ImageNet Normalize,
  accumulates embeddings in training and performs coreset fitting after the epoch;
  `models/image/reverse_distillation/lightning_model.py` reads input size from the
  preprocessor and constructs randomly initialized bottleneck/decoder parameters.
  `pre_processing/pre_processor.py:on_train_batch_start` applies preprocessing once.
  `engine/engine.py:_TrainerArgumentsCache.update` overwrites trainer arguments with
  model arguments (including PatchCore's `devices=1`).
- Lightning 2.5.6 upstream `src/lightning/pytorch/strategies/single_device.py`, fetched
  from GitHub: `SingleDeviceStrategy(device=...)` owns `root_device` and moves the model
  there. This preserves an explicit CUDA index despite anomalib's `devices=1` override.
- `musc-research/MuSc`, commit `b76b93da8bd3096a99964a96ae29d46f197a0651`:
  `models/musc.py:174-226`, `models/modules/_LNAMD.py`, `_MSM.py`, and
  `models/backbone/open_clip/factory.py` confirm one-based layer indices [6,12,18,24],
  class-token removal inside LNAMD, per-layer normalized embeddings, nearest-reference
  Euclidean distances, 30% smallest-reference averaging, averaging layers and radii
  [1,3,5], and bilinear map interpolation with align_corners=True. The custom open_clip
  factory accepts image size as its second positional argument.
- `bench.py` supplies uint8 RGB 392-square tiles, fits train only, separately scores
  calibration good tiles and held-out test tiles, and derives image scores from the
  maximum of stitched raw maps. MuSc is explicitly transductive; no labels enter its
  mutual reference set. No per-call min/max normalization was added.

### Proven defects fixed

- Anomalib training ignored explicit device selection, and its seed was applied only
  after model construction. Fit now seeds before construction and supplies an explicit
  single-device Lightning strategy when a device is requested; default auto remains.
- MuSc's configurable chunk could be smaller than the eight-tile minimum, bypassing
  the public guard and yielding empty top-k means in upstream MSM. Construction now
  rejects undersized chunks and nonpositive extraction batch sizes.
- Zero LNAMD embeddings divided by zero. `F.normalize` preserves finite zero vectors;
  real upstream LNAMD/MSM regression tests now verify finite zero maps.
- MuSc's configurable image size previously neither resized input nor restored output
  to the benchmark tile dimensions. Inputs now resize before CLIP normalization and
  maps return at 392 square; invalid backbone patch-size multiples are rejected.
- MuSc permanently injected its checkout into sys.path and could reuse another method's
  cached `models` package. Scoped shared import contexts cover backbone construction,
  encode_image, and mutual scoring; regression proof preserves a foreign `models`
  module and the original sys.path after real scoring.

### Proof and limits

Existing `.venv` has torch 2.14.0 and torchvision; anomalib and Lightning are absent.
Focused command:

```sh
PYTHONPATH=scanner .venv/bin/python -m pytest scanner/tests/test_fault_anomalib_methods.py scanner/tests/test_fault_musc.py scanner/tests/test_fault_bench.py -q -ra
```

Selected tests pass; the two real anomalib fit/score integration tests skip because the
package is absent. MuSc tests execute the actual cloned LNAMD and MSM on CPU, including
outlier ranking, ordering, finite zero maps, nondefault resolution, and import isolation.
A fake backbone verifies extraction batches, resizing, normalization and class-token
shape without downloading weights. Anomalib tests verify raw map scale/normalization,
seed-before-construction order, and Engine wiring for CPU and cuda:1 using test doubles.
Focused Ruff checks pass for the four owned Python files. No GPU training, weight
downloads, dependency installs, or Kaggle pushes were performed.

Remaining risks: real anomalib/Lightning training and real MuSc CLIP extraction still
need execution in the pinned benchmark environment. PatchCore's upstream reweighted
image score and MuSc's RsCIN are intentionally not used: benchmark scores are stitched
map maxima. MuSc's chunk-local transductive scores depend on reference composition and
chunk boundaries; all-good calibration and mixed test sets can differ in score scale,
so the fixed-FAR result is not an independent online-detection guarantee. The benchmark
can supply fewer than eight calibration tiles for small categories, which MuSc rejects
explicitly; supporting that case requires a benchmark/reference-policy decision rather
than silently borrowing test data. Full-category tile stacking and pairwise MSM can be
memory intensive; large-data GPU throughput was not measured here. Shared import
isolation only serializes cooperating wrappers, not arbitrary concurrent imports.
