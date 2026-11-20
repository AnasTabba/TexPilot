# TexPilot

Final Year Project, CSE 493/494, IBA (School of Mathematics and Computer Science).

| Folder | What | Stack |
|---|---|---|
| [`yarnflow/`](yarnflow/) | **Yarnflow**, the factory app: yarn and fabric stock, production, quality, sales, dispatch and the scanner screen. Web app on a Cloudflare Worker with D1, plus an iPhone app in `ios/`. | React, TypeScript, Vite, Cloudflare Workers, Swift |
| [`scanner/`](scanner/) | **TexPilot scanner**. Takes one photo, optionally with the care label. Returns the garment, the fabric structure, the composition group and any fabric faults, then checks them against the label: PASS, FLAG or INSUFFICIENT_EVIDENCE. | Python, FastAPI, PyTorch |

Yarnflow calls the scanner's HTTP API (`GET /api/v1/model`, `POST /api/v1/scan`, `POST /api/v1/spec`).
The live app reaches it through the Worker secret `TEXPILOT_API_URL`.

## Quick start

```bash
cd yarnflow && npm install && npm run dev              # the app
cd scanner && make setup-ml && make models && make api-scanner   # the scanner on :8000
```

Full setup, rules and current state: [`AGENTS.md`](AGENTS.md). Measured results:
[`scanner/docs/results.md`](scanner/docs/results.md).

## Current models

| Task | Model | Test macro F1 |
|---|---|---:|
| Fabric structure (24 classes) | SigLIP 2 + LoRA, `scanner-v8` | 0.767 |
| Composition group (8 groups) | linear head, `custom/mix` | 0.714 |
| Fabric fault | Dinomaly on DINOv2, `fault-wfdd-v1` (WFDD) | 0.871 |

These are catalogue or benchmark test sets, not phone photos.
