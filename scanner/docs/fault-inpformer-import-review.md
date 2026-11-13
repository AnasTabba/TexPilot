# INPFormer and upstream import review

Reviewed the dirty checkout in place; no resets, commits, external pushes, or edits to other reviewers' method/bench/Kaggle files.

## Sources and behavior

Real clones live under `/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/7465821c-727f-422e-b6d5-83704616dd8a/scratchpad/agents/`: `inpformer-research/repo`, `dinomaly-research/repo`, and `musc-research/MuSc`.
INPFormer HEAD is `17d265381d9b323a2ef6e05aab0665a85edebe84`.

- [Official INPFormer training](https://github.com/luow23/INP-Former/blob/17d265381d9b323a2ef6e05aab0665a85edebe84/INP_Former_Multi_Class.py#L68-L149): wrapper matches small/base dimensions, target layers 2–9, two fused feature groups, one MLP bottleneck, one prototype parameter bank, one aggregation block, eight prototype decoder blocks, initialization, StableAdamW settings, loss plus 0.2 guidance loss, clipping and scheduler. Large encoders are deliberately unsupported.
- [Encoder](https://github.com/luow23/INP-Former/blob/17d265381d9b323a2ef6e05aab0665a85edebe84/models/vit_encoder.py): absolute imports include `dinov1`, `dinov2`, `beit`; weight paths depend on cwd. Wrapper resolves repo paths before entering repo cwd and restores cwd on failures.
- [Loss and maps](https://github.com/luow23/INP-Former/blob/17d265381d9b323a2ef6e05aab0665a85edebe84/utils.py#L125-L168): copied functions avoid dependency-heavy utility imports. One numerical correction below is explicitly documented in code.
- Local `training/fault/bench.py`: Method receives good training tiles and returns one map per test tile; wrapper normalizes uint8 RGB 392-square tiles, returns float32 392-square maps, and handles fewer training tiles than batch size. Per-iteration sampling differs from upstream epoch/drop-last sampling as documented in wrapper. Existing stand-in tests cover fit/score/checkpoint round trip; clone test assembles actual modules and runs a real forward pass with an untrained stub encoder, without loading weights.

## Proven failures and corrections

1. **Process-global upstream import collision.** `_add_repo`/`_use_repo` only change `sys.path`; Python first consults `sys.modules`. Real INPFormer `models.uad` remains cached after Dinomaly is prepended; `from models.uad import ViTill` then raises ImportError. Real MuSc `models` pins its package search path, making INPFormer's `models.uad` unavailable even when INPFormer is first on `sys.path`. These tests execute real package/model code, without training. INPFormer and Dinomaly also both supply `utils`, `optimizers`, and `dataset`; parametrized tests resolve their actual source specs, install the normal pre-execution cache entry, and prove cached origins survive path changes. The latter tests intentionally do not execute dependency-heavy utility/dataset bodies. MuSc supplies `utils` as a package, not `dataset`/`optimizers`; collision ownership follows the shared name, not every repository having every name.

   Added one shared helper, `training/fault/methods/_upstream.py::upstream_repo(repo_dir)`. It temporarily activates each resolved checkout's cached module tree, restores prior modules and path on success/error, and serializes cooperating contexts using an RLock. Roots cover `models`, `utils`, `optimizers`, `dataset`, `datasets`, `dinov1`, `dinov2`, `beit`, `aug_funcs`, and `flops_profiler`. Same-repo nesting preserves module identity. INPFormer uses it at encoder, model-class and optimizer import boundaries. Its actual assembled forward path has no lazy upstream imports; encoder construction and cwd changes are inside the shared context.

   This belongs at the legacy repository import boundary, not the benchmark, package-order hacks, or permanent deletion of another method's modules. Sent exact integration instructions to coordinator, MuSc owner and Dinomaly owner: import `upstream_repo` and scope upstream imports plus runtime calls containing lazy imports; remove permanent path insertion. They own their integration files. No claim that this lock controls arbitrary unrelated third-party imports/cwd changes in other threads; concurrent non-cooperating code needs process isolation. Full model pickling outside the context is also unsupported; wrapper saves tensor state dictionaries.

2. **Finite zero loss, NaN gradient.** Regression with identical positive encoder/decoder feature maps fails before correction: `point_dist / mean_dist` becomes 0/0, the backward hook fills every reconstruction gradient with NaN although scalar loss is zero. Guard only a zero denominator with one; all nonzero-distance mathematics is unchanged. Regression proves finite gradients after correction.

3. **Invalid training counts and incomplete checkpoint diagnostics.** Reject nonpositive iteration/batch/prototype counts before model construction; previously zero iterations could silently produce an untrained fitted model, and zero batch size failed late. Save prototype count and reject incompatible loads before building a costly encoder; old checkpoints default to the historical six prototypes. The frozen encoder is rebuilt from the named pretrained backbone, as before; matching external pretrained weights remain necessary.

## Proof and limits

Focused command: `cd scanner && OMP_NUM_THREADS=1 python3 -m pytest tests/test_fault_inpformer.py`: **18 passed in 3.10s**.
Tests cover real clone wiring/forward, actual model/package collision, real source-spec collisions, isolated restore on error, cached identity and nesting, fit/score/save/load, prototype metadata, invalid counts, numerical gradient regression, and encoder failure cleanup.

Nearest gate attempted: `tests/test_fault_inpformer.py tests/test_fault_bench.py`. Bench collection fails in the existing Python 3.10 SciPy installation: `_spropack.cpython-310-darwin.so` fails `dlopen` with a zero-fill `__thread_bss` offset error. Direct Dinomaly uad execution hits the same sklearn/SciPy dependency failure; collision tests therefore execute INPFormer uad and MuSc models, and resolve Dinomaly uad without executing its unrelated dependencies. No dependency packages were changed. No pretrained download, GPU training, accuracy claim, or Kaggle push was performed. Those remain outside this no-training review.
