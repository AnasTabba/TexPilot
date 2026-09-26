#!/usr/bin/env bash
# TextileNet benchmark, end to end, on one CUDA box. Every stage is resumable.
#
#   training/textilenet/run_all.sh setup    venv + pinned deps
#   training/textilenet/run_all.sh data     download, extract, scrape, index (skips a frozen split)
#   training/textilenet/run_all.sh gate     ConvNeXt V2-B on fabric, seed 0 -- check before spending more
#   training/textilenet/run_all.sh train    every model x partition x seed (skips finished runs)
#   training/textilenet/run_all.sh probe    frozen DINOv2 linear probe, both partitions
#   training/textilenet/run_all.sh report   results.md + best checkpoint per partition
#
# Knobs: PARTITIONS, MODELS, SEEDS, BATCH, EPOCHS, WORKERS (env vars).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PY=${PY:-.venv/bin/python}
PARTITIONS=${PARTITIONS:-"fabric fibre"}
MODELS=${MODELS:-"convnextv2_base dinov2_vitb14 eva02_base vit_tiny"}
SEEDS=${SEEDS:-"0 1 2"}
BATCH=${BATCH:-128}
EPOCHS=${EPOCHS:-30}
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu)
WORKERS=${WORKERS:-$(( NPROC > 16 ? 16 : NPROC ))}
mkdir -p runs/logs

run() {  # partition model seed
  local p=$1 m=$2 s=$3
  if [ -f "runs/$p/$m/seed$s/test_metrics.json" ]; then echo "done: $p/$m/seed$s"; return; fi
  echo "=== $p/$m/seed$s ($(date))"
  $PY -m training.textilenet.train --partition "$p" --model "$m" --seed "$s" \
    --batch-size "$BATCH" --epochs "$EPOCHS" --workers "$WORKERS" --resume \
    2>&1 | tee -a "runs/logs/$p-$m-seed$s.log"
}

case "${1:-}" in
  setup)
    python3 -m venv .venv
    $PY -m pip install -q --upgrade pip
    $PY -m pip install -q -e . -r training/textilenet/requirements.txt
    $PY -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
    ;;
  data)
    for p in $PARTITIONS; do
      if [ ! -d "data/$p/train" ]; then
        $PY -m training.textilenet.prepare_data download --partition "$p"
        $PY -m training.textilenet.prepare_data extract --partition "$p" --delete-archive
      fi
      $PY -m training.textilenet.prepare_data scrape --partition "$p" --workers 64
      if [ -f "data/splits/$p.csv" ]; then
        echo "data/splits/$p.csv already frozen -- keeping it (rows missing here are dropped and reported)"
      else
        $PY -m training.textilenet.prepare_data index --partition "$p"
      fi
    done
    ;;
  gate)
    run fabric convnextv2_base 0
    echo "Published best fabric top-1: 67.32. Compare the val top-1 above before running 'train'."
    ;;
  train)
    for m in $MODELS; do for p in $PARTITIONS; do for s in $SEEDS; do run "$p" "$m" "$s"; done; done; done
    ;;
  probe)
    for p in $PARTITIONS; do
      $PY -m training.textilenet.probe --partition "$p" --workers "$WORKERS" --batch-size 256 \
        2>&1 | tee -a "runs/logs/$p-probe.log"
    done
    ;;
  report)
    $PY -m training.textilenet.aggregate
    ;;
  *)
    sed -n '2,11p' "$0"; exit 2
    ;;
esac
