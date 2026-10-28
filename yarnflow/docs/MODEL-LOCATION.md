# Trained model artifact investigation — 24 October 2026

The user asked to find the ready model on main and check newer commits. Read-only Git fetches were made; existing training changes were not replaced or merged.

## Findings

- `origin/main`: `d6fa46b216b25144b0cd8388e53a94139a871a42`, 29 September 2026, **Make scanner-v2 the default: it beats v1 on every head**. Local main already matches this commit. It contains the Python pipeline and measured results, not the model bundle.
- A full fetch found `origin/cursor/push-reports-05-06`: `d610eefd4bdd8ff2d772807ced8cdadd96164a9b`, 23 October 2026. This adds exactly two Markdown reports: `research/fabric/reports/05_kaggle_log_analysis.md` and `06_fastfix_results.md`. It does not add checkpoints or a deployment.
- The reports refer to Kaggle kernels `yaseenazhar/texpilot-fabric-research` and `yaseenazhar/texpilot-fabric-fastfix`, and dataset `yaseenazhar/texpilot-vit-tiny-sqrt-cw-ckpt`. Direct browser visits to these references did not expose downloadable artifacts in the current session; the research kernel and checkpoint dataset explicitly showed “We can't find that page.” This does not establish whether the outputs are private, removed or renamed.
- Main's `.gitignore` deliberately excludes `models/`, training `runs/`, `.pt`, `.pth` and related weight formats. No model-bundle history, GitHub release assets or Actions model artifacts were returned.
- Searches of the checkout, Codex worktrees, Downloads, Documents, Trash, Torch/Hugging Face caches and the macOS file index did not locate `heads.safetensors`, `bundle.json` or a scanner-v2 archive. An unrelated ResNet-50 backbone cache is not a trained TexPilot model and was not used.

## Recovery path

The original training machine's `models/scanner-v2/`, or the Kaggle owner's saved notebook Output/Versions, is the next source to inspect. Recover the complete metadata and checkpoint together. The newer reports explicitly retain `baseline_vit_tiny` as champion; the interrupted sqrt checkpoint or newer inverse-sampler run must not silently replace it.

Once the bundle is available, the prepared launcher and camera client can use the real main-branch model without another UI rewrite. Until then the app correctly says **Model not connected** and never substitutes sample classifications.
