#!/usr/bin/env bash
# Stage the Kaggle input for retrain_rounds and push the kernel. Run from the repo root.
#   training/textilenet/retrain_rounds_stage.sh <stage-dir> <kernel-dir>
# The dataset (yaseenazhar/texpilot-retrain-rounds-input) holds a snapshot of the Python
# sources, the frozen prelim split, the v8 fabric feature cache and the installed head.
# <kernel-dir> must contain kernel-metadata.json (training/textilenet/retrain_rounds_kernel-metadata.json)
# and retrain_rounds_kaggle.py.
set -euo pipefail
STAGE=${1:?stage dir}
KERNEL=${2:?kernel dir}
KAGGLE=${KAGGLE:-$HOME/.local/kaggle-cli/bin/kaggle}
FEATS=${FEATS:-runs/codex_f1_20261027/feature_download/feats_v8/fabric/vit_so400m_patch16_siglip_384.v2_webli_384}

rm -rf "$STAGE" && mkdir -p "$STAGE/repo/training/textilenet" "$STAGE/repo/training/scanner" \
  "$STAGE/repo/services" "$STAGE/features" "$STAGE/splits" "$STAGE/deployed/head_a"
cp -R services/. "$STAGE/repo/services/"
find "$STAGE/repo/services" -name __pycache__ -prune -exec rm -rf {} +
touch "$STAGE/repo/training/__init__.py"
cp training/scanner/*.py "$STAGE/repo/training/scanner/"
cp training/textilenet/*.py "$STAGE/repo/training/textilenet/"
cp "$FEATS"/* "$STAGE/features/"
cp data/splits/prelim/fabric.csv "$STAGE/splits/prelim_fabric.csv"
cp models/scanner-v8/head_a/probe.safetensors models/scanner-v8/head_a/head.json "$STAGE/deployed/head_a/"
cat > "$STAGE/dataset-metadata.json" <<JSON
{"title": "texpilot-retrain-rounds-input", "id": "yaseenazhar/texpilot-retrain-rounds-input", "licenses": [{"name": "CC0-1.0"}]}
JSON
{ echo "git_head=$(git rev-parse HEAD)"; shasum -a 256 training/textilenet/retrain_rounds*.py \
  training/scanner/calibration.py services/vision/heads.py tests/test_retrain_rounds.py; } > "$STAGE/SOURCE.txt"

if "$KAGGLE" datasets status yaseenazhar/texpilot-retrain-rounds-input >/dev/null 2>&1; then
  "$KAGGLE" datasets version -p "$STAGE" -m "retrain_rounds snapshot" -r zip
else
  "$KAGGLE" datasets create -p "$STAGE" -r zip
fi
cp training/textilenet/retrain_rounds_kaggle.py "$KERNEL/"
cp training/textilenet/retrain_rounds_kernel-metadata.json "$KERNEL/kernel-metadata.json"
"$KAGGLE" kernels push -p "$KERNEL"
