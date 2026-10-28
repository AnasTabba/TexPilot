# TexPilot

Final Year Project, CSE 493/494 — IBA, School of Mathematics and Computer Science.
Two projects live in this repository:

| Folder | Project | Stack |
|---|---|---|
| [`yarnflow/`](yarnflow/) | **Yarnflow**: the factory app for yarn stock, production, quality and dispatch. A web app on a Cloudflare Worker with D1, plus a native SwiftUI iPhone app in `yarnflow/ios/`. | React, TypeScript, Vite, Cloudflare Workers, Swift |
| [`scanner/`](scanner/) | **TexPilot scanner**: checks that a fabric's look matches what its care label claims, and returns PASS, FLAG or INSUFFICIENT_EVIDENCE. | Python, FastAPI, PyTorch |

Yarnflow's scanner screen calls the scanner's HTTP API (`GET /api/v1/model`, `POST /api/v1/scan`,
`POST /api/v1/spec`). The published site reaches it through the Worker secret `TEXPILOT_API_URL`.
See [`scanner/deployment/README.md`](scanner/deployment/README.md).

## Quick start (each line from the repository root)

```bash
cd yarnflow && npm install && npm run dev     # the app
cd scanner && make setup && make api          # the scanner API at http://127.0.0.1:8000/docs
```

## Milestones

| | When | Deliverable |
|---|---|---|
| M1 | early Nov 2026 | Scanner working on a phone against real garments |
| M2 | late Dec 2026 | Scanner complete, goods-in bridge, tactical MILP solving |
| M3 | Jan 2027 | External Open House |
| M4 | Apr 2027 | Operational CP-SAT, on-device inference, real-conditions validation |
| M5 | May 2027 | Final defence + paper |
