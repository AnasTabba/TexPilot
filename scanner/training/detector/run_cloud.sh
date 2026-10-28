#!/usr/bin/env bash
# Backend B: RT-DETRv2-R50 fine-tuned on Fashionpedia's 14 garment classes, on one CUDA box.
# Spec §4.2 (B), §8.2. Every stage is resumable.
#
#   training/detector/run_cloud.sh setup    venv + pinned deps (+ pycocotools)
#   training/detector/run_cloud.sh data     Fashionpedia: 3.6 GB photos + 0.56 GB annotations
#   training/detector/run_cloud.sh smoke    200 photos, 1 epoch: check before spending GPU hours
#   training/detector/run_cloud.sh train    the full run; resumes from runs/rtdetr/last.pt
#   training/detector/run_cloud.sh report   the test mAP, and the folder to copy to the Mac
#
# Knobs (env): EPOCHS, BATCH, WORKERS
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PY=${PY:-.venv/bin/python}
EPOCHS=${EPOCHS:-12}
BATCH=${BATCH:-16}
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu)
WORKERS=${WORKERS:-$(( NPROC > 16 ? 16 : NPROC ))}
D=data/fashionpedia
S3=https://s3.amazonaws.com/ifashionist-dataset
mkdir -p runs/logs

fetch() {  # url dest -- resumable, and skipped once complete
  [ -f "$2" ] && return
  curl -fL -C - -o "$2.part" "$1" && mv "$2.part" "$2"
}

case "${1:-}" in
  setup)
    python3 -m venv .venv
    $PY -m pip install -q --upgrade pip
    $PY -m pip install -q -e . -r training/detector/requirements.txt
    $PY -c "import torch, pycocotools; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
    ;;
  data)
    mkdir -p "$D/annotations" "$D/images"
    for f in instances_attributes_train2020.json instances_attributes_val2020.json; do
      fetch "$S3/annotations/$f" "$D/annotations/$f"
    done
    for z in train2020 val_test2020; do
      if [ ! -f "$D/images/.$z.done" ]; then
        fetch "$S3/images/$z.zip" "$D/$z.zip"
        $PY -m zipfile -e "$D/$z.zip" "$D/images" && rm "$D/$z.zip" && touch "$D/images/.$z.done"
      fi
    done
    echo "photos: $(find "$D/images" -name '*.jpg' | wc -l)"
    ;;
  smoke)
    $PY -m training.detector.train_rtdetr --limit 200 --epochs 1 --batch-size "$BATCH" \
      --workers "$WORKERS" --out runs/rtdetr-smoke 2>&1 | tee runs/logs/rtdetr-smoke.log
    ;;
  train)
    $PY -m training.detector.train_rtdetr --epochs "$EPOCHS" --batch-size "$BATCH" \
      --workers "$WORKERS" --out runs/rtdetr 2>&1 | tee -a runs/logs/rtdetr.log
    ;;
  report)
    $PY -c "import json; m = json.load(open('runs/rtdetr/metrics.json')); \
print(json.dumps({k: m[k] for k in ('domain', 'n', 'holdout_best_map', 'test_val2020')}, indent=1))"
    echo "Copy runs/rtdetr/best/ (about 170 MB) to the Mac as models/rtdetr-fashionpedia/, e.g."
    echo "  scp -r <gpu-box>:<repo>/runs/rtdetr/best <repo on the Mac>/models/rtdetr-fashionpedia"
    ;;
  *)
    sed -n '2,11p' "$0"; exit 2
    ;;
esac
