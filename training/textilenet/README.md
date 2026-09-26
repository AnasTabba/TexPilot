# TextileNet benchmark

Beat the published TextileNet baselines (fabric 67.32 / fibre 53.32 top-1) with
pretrained backbones and a modern fine-tuning recipe. Numbers land in `results.md`.

The baselines trained ResNet-18 / ViT-Tiny **from scratch**, without input
normalisation, with a cosine schedule that never finished decaying, and picked their
checkpoint on the test set. `train.py` fixes all four: timm pretrained weights,
albumentations (heavy geometry, light colour), AdamW + layer-wise lr decay, a full
warmup-cosine schedule, mixup/cutmix, label smoothing, EMA, and selection on a val
carve-out only.

## Files

| File | Does |
|---|---|
| `prepare_data.py` | download / extract the seed archives, scrape the manifests, freeze the split |
| `splits.py` | the split rules: official train/test, stratified 10% val, train-side dedup (tested) |
| `train.py` | fine-tune one model on one partition with one seed |
| `probe.py` | frozen-backbone linear probe; cheap enough for a laptop |
| `aggregate.py` | seeds → mean ± std vs baselines → `results.md`, best checkpoints |
| `run_all.sh` | the whole benchmark on a CUDA box, stage by stage |

## The data, and why the split is a file

TextileNet is **two disjoint halves**: Google Drive seed archives (12 + 14 GB, already
in `train/` and `test/`) and the upstream `json/*_{train,test}.json` manifests, which
must be scraped from 2023 URLs. Only the scraped half suffers link rot.

`prepare_data.py index` hashes and decodes every file, drops train images
byte-identical to a test image, carves out val, and writes `data/splits/<p>.csv`. That
CSV **is** the split. It refuses to overwrite itself without `--force`, and it should be
copied — not rebuilt — onto any other machine: a re-scrape a week later recovers a
different set of URLs. `train.py` drops rows missing on disk and says how many.

## Run it

Locally (M-series Mac: data prep and the linear probe, not full fine-tuning):

```bash
make setup-ml
for p in fabric fibre; do
  python -m training.textilenet.prepare_data download --partition $p   # resumable
  python -m training.textilenet.prepare_data extract  --partition $p --delete-archive
  python -m training.textilenet.prepare_data scrape   --partition $p   # test first; resumable
  python -m training.textilenet.prepare_data index    --partition $p
done
python -m training.textilenet.probe --partition fabric                 # ~1 h on an M3
```

On a rented GPU (one A100/H100, ≥16 vCPU, ≥150 GB disk):

```bash
git clone <repo> && cd TexPilot && git checkout feat/vision-textilenet-train
scp -r laptop:FYP/data/splits data/         # ship the frozen split first
training/textilenet/run_all.sh setup
training/textilenet/run_all.sh data         # hours; resumable
training/textilenet/run_all.sh gate         # ConvNeXt V2-B, fabric, seed 0
training/textilenet/run_all.sh train        # everything else; skips finished runs
training/textilenet/run_all.sh probe
training/textilenet/run_all.sh report       # -> results.md, checkpoints/<p>_best.pt
```

If Drive refuses the archive download on the cloud box ("quota exceeded"), `rsync`
`data/raw/*.tar.gz` from the laptop instead.

Budget, 30 epochs, one A100: roughly 2–4 h per (model, partition, seed) for the Base
models and well under 1 h for ViT-Tiny, so ~50–60 GPU-hours for the full grid of
4 models × 2 partitions × 3 seeds. Cut `SEEDS` or `MODELS` to spend less.

## Single runs and ablations

```bash
python -m training.textilenet.train --partition fabric --model convnextv2_base --seed 0
python -m training.textilenet.train --partition fibre  --model dinov2_vitb14 --seed 1
python -m training.textilenet.train --partition fibre  --model convnextv2_base \
    --sampler sqrt --tag convnextv2_base_sqrtsampler                  # imbalance ablation
python -m training.textilenet.train --partition fabric --model convnextv2_base_384 \
    --batch-size 32                                                  # 384 px
python -m training.textilenet.train --partition fabric --model convnextv2_base \
    --probe-epochs 3 --tag convnextv2_base_2stage                    # LP then FT
# smoke test (seconds, any device):
python -m training.textilenet.train --partition fabric --model vit_tiny \
    --limit-per-class 8 --epochs 1 --max-train-steps 2 --workers 0 --out /tmp/smoke
```

Presets: `convnextv2_base`, `convnextv2_base_384`, `dinov2_vitb14`, `eva02_base`,
`vit_tiny`; any other timm model name also works.
