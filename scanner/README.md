# TexPilot scanner

Fabric verification: the vision, OCR, fault and consistency service behind Yarnflow's scanner.
Run every command below from this `scanner/` folder.

## What it does

One photo of a garment or fabric, and optionally its care label, goes in. Out come:

| Answer | Model | Notes |
|---|---|---|
| Fabric structure (twill, jersey, lawn, ...) | SigLIP 2 so400m + LoRA "Head A" (`models/scanner-v8`) | abstains below its threshold |
| Garment type, finish, blend, local fabric name | linear heads on the same encoder (`models/custom/`) | one encoder pass for all heads |
| Composition group (cotton, polyester, nylon, cotton/polyester, viscose, linen, wool, acrylic) | `models/custom/mix` | answers only above its threshold; otherwise the app asks for the care label |
| Stated composition | OCR of the care label + strict parser (`services/ocr/`) | the label always wins over the photo |
| Fabric fault | Dinomaly on DINOv2 (`models/fault-wfdd-v1`) | heat map plus fault regions |
| Verdict | consistency rules (`services/consistency/`) | PASS, FLAG(reason) or INSUFFICIENT_EVIDENCE |

```
photo ──> garment detector (OWLv2) ──> encoder ──> heads ─────────┐
      └─> fault model (tiles, heat map) ──────────────────────────┤
label ──> OCR ──> composition parser ──> consistency check ───────┴──> ScanResult
```

**Abstention is a real answer.** A scanner forced to always answer produces confident wrong
answers. Every head returns nothing below the threshold that gave 90% accuracy on validation data.

**A photo cannot prove fibre content.** Cotton, viscose and lyocell are all cellulose. The
composition head names the group a photo can suggest. Exact percentages come only from the label.

## Fault check

The fault model learned "normal" from the four WFDD fabrics. On those fabrics a fixed
threshold (0.118) decides. On any other fabric the whole anomaly map is raised, so each photo is
judged against its own level instead: a fault is a spot 7.5 robust deviations above the photo's
median (`max_map_median` and `relative_z` in `models/fault-wfdd-v1/config.json`). See
`services/vision/fault.py`.

The result's `reference` field says which rule judged the photo: `trained` (fixed threshold, WFDD-like
fabric) or `self_relative` (other fabric). The scan page says "check by eye" for `self_relative`.
The Incoming QC (v2) `defects` stage runs the fault model on flat-swatch captures. It answers only on
`trained` fabric; otherwise it abstains (`OOD`), and it is disabled when the fault model is not installed.
Real-upload scripts (`scripts/real_uploads.py`, `label_sheet.py`, `eval_real_set.py`) measure answer
coverage on the stored uploads and score human labels; see `docs/results.md`. They write only to `runs/`.

## Results

Measured numbers, with their test sets and evidence files, are in [`docs/results.md`](docs/results.md).

## Quick start

```bash
make setup     # no torch
make test
make api       # http://127.0.0.1:8000/docs, stub predictor
```

The real scanner (any machine; Apple Silicon or an NVIDIA GPU is fastest):

```bash
make setup-ml          # once, large download
make models            # once, ~2.3 GB of trained models from the team Drive
make api-scanner       # serves on :8000 (base encoders download from the Hugging Face Hub on first start)
```

Label OCR uses Apple Vision, so it runs only on macOS. On Windows or Linux the scanner starts
without OCR; pass the label text in `label_text` instead.

```bash
curl -s -F "surface_image=@any.jpg" -F "label_text=60% COTTON 40% POLYESTER" \
     http://127.0.0.1:8000/api/v1/scan | python3 -m json.tool
```

Yarnflow reaches a running scanner through the Worker secret `TEXPILOT_API_URL`; see
[`deployment/README.md`](deployment/README.md).

## Layout

| Folder | Contents |
|---|---|
| `services/api/` | FastAPI app, wire schemas, scan store (`data/scans/`) |
| `services/vision/` | detector, encoder heads, custom heads, fault check, QC metrology |
| `services/ocr/` | OCR engines, composition parser, fibre names (English and Urdu) |
| `services/consistency/` | plausibility knowledge base and verdict rules |
| `training/` | training and Kaggle kernels for every installed model |
| `scripts/` | serving, demo and evaluation entry points |
| `research/qc/` | incoming-fabric QC protocols and registers |
| `docs/` | results, report (`texpilot_scanner.tex`), demo script, design spec |

Models, data and runs are gitignored. Never commit them.

## Datasets

| Source | Used for |
|---|---|
| [TextileNet](https://github.com/hahashu/TextileNet) | structure and fibre-family heads |
| Shopify store catalogues (`training/textilenet/shop_scrape.py`) | garment, finish, blend, local fabric and composition heads; labels from each product's own page |
| [WFDD](https://www.kaggle.com/datasets/hodinhtrieu/the-woven-fabric-defect-detection-wfdd) | fault model training and test |
| MVTec AD, AITEX | fault benchmarks |
