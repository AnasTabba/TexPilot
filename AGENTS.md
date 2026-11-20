# Agent guide

Read this first. The original author is not available; you are continuing the project on a
teammate's machine. Work on `main` only. Do not create branches.

## First run (do these in order)

```bash
git pull
# 1. Factory app
cd yarnflow && npm install && npm test && cd ..
# 2. Scanner, light install (no torch, ~20 s)
cd scanner && make setup && make test
# 3. Scanner, real models (large: torch + ~2.3 GB of trained models from Google Drive)
make setup-ml
make models
cd ..
```

Needs: Python 3.10+, Node 24, git, make. On Windows use WSL (make does not run on plain Windows).

`make models` downloads the trained models from the team Drive folder and checks their SHA-256 sums.
If it fails with a Drive quota or permission error, wait an hour and retry, or download the folder by
hand from the link in `scanner/Makefile` (`MODELS_URL`) into `scanner/models/.download/` and rerun the
last three lines of the `models` target.

## Run

```bash
cd scanner && make api-scanner                 # real scanner on :8000 (docs at /docs)
cd yarnflow && npm run dev                     # app; forwards scanner calls to 127.0.0.1:8000
```

`make api` runs the scanner with a stub predictor (no models needed). Label OCR uses Apple Vision,
so on Windows or Linux the scanner runs without OCR; send the label text in `label_text`.

Quick check:

```bash
curl -s -F "surface_image=@any.jpg" -F "label_text=60% COTTON 40% POLYESTER" \
     http://127.0.0.1:8000/api/v1/scan | python3 -m json.tool
```

## Layout

| Path | What |
|---|---|
| `yarnflow/` | Factory app: React + Vite web app, Cloudflare Worker + D1 (`server/`), iPhone app (`ios/`) |
| `scanner/services/` | FastAPI scanner: `api/` (wire contract), `vision/`, `ocr/`, `consistency/` |
| `scanner/training/` | Training code and Kaggle kernels for every installed model |
| `scanner/docs/results.md` | All measured numbers with evidence paths |
| `scanner/models/`, `data/`, `runs/` | Gitignored. Never commit them |

Details: `README.md`, `scanner/README.md`, `yarnflow/README.md`.

## Rules

1. Run `make test` (scanner) and `npm test` (yarnflow) before every push. CI runs both on `main`.
2. Lead every model result with macro F1, then accuracy. Pick on validation, test once, and say plainly
   what did not help.
3. No hardcoded or invented outputs. If the model is unsure it abstains (`INSUFFICIENT_EVIDENCE`);
   the care label always wins over the photo.
4. Split datasets by product or fabric group (`Sample.group_id`), never by image.
5. Say whether a number comes from catalogue photos or phone photos. They are not comparable.
6. `scanner/services/api/schemas.py` is the contract with Yarnflow. Change both sides together.
7. Never write test entries to the live database (`yarnflow-db`). Use `npm run dev` locally.
8. Heavy training goes to a GPU (Kaggle), not a laptop.
9. Short commit messages, straight to `main`, no extra branches.

## Training data (only for retraining)

Training images are not in git. They are in the Drive folder `TexPilot-data` (ask the owner for access):
`fabric.tar.gz`, `fibre.tar.gz`, `scraped.tar.part-*` (19 × 1 GB) and `SHA256SUMS`. Restore into
`scanner/data/`, then check the paths the training script you run expects:

```bash
shasum -a 256 -c SHA256SUMS && cat scraped.tar.part-* | tar -xf - -C scanner/data
tar -xzf fabric.tar.gz -C scanner/data && tar -xzf fibre.tar.gz -C scanner/data
```

## State (21 Nov 2026)

- Installed: scanner-v8 (fabric structure, test macro F1 0.767), 8-group composition head
  (`models/custom/mix`, test macro F1 0.714), fault model `models/fault-wfdd-v1` (WFDD test macro F1 0.871).
- Target: 0.80-0.85 macro F1. Composition is below it; viscose is the weak class (F1 0.39).
- Fault accuracy on real garments is unmeasured (no labelled set). The fault model knows only 4 WFDD
  fabrics; it needs 50-100 good photos per real fabric to retrain.
- Not done: iPhone WebKit e2e run, scanner hosting (`scanner/deployment/README.md`, not deployed).
- The live app reaches a scanner through the Worker secret `TEXPILOT_API_URL`; deploying needs the
  Cloudflare account (`npm run deploy:cloudflare`).
