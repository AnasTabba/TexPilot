# TexPilot — agent guide

TexPilot is a **fabric verification scanner** (the M1 deliverable) that later feeds a
garment production planning platform. It is a Final Year Project (IBA, CSE 493/494)
built by a small team in three parallel workstreams.

The scanner photographs a fabric, predicts what is *visible* (structure, surface
treatment, fibre family), reads the care label for what it *claims*, and returns one
of three verdicts: `PASS`, `FLAG`, or `INSUFFICIENT_EVIDENCE`.

## Read first

1. `docs/HANDOFF.md`: current state, decisions, and things that look like bugs but aren't.
2. `README.md`: what the system does and does not claim.
3. `docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md`: the approved design.

The planning-platform spec (`…-garment-planning-platform-design.md`) is **deferred**.
Don't build anything from it.

## Workstreams: find yours

| | Area | Code | Guide |
|---|---|---|---|
| P1 | Vision model, training, evaluation | `services/vision/` | spec §4.1, §5, §8 |
| P2 | OCR, consistency engine, FastAPI serving | `services/ocr/`, `services/consistency/`, `services/api/` | spec §4.2–4.5 |
| P3 | **Phone app / frontend / design** | `app/` | **`app/AGENTS.md`**, then `app/DESIGN.md` and `app/README.md` |

**Frontend, UI or design work happens in `app/`. Read `app/AGENTS.md` before
touching anything there.** It has the stack, structure, hard rules, and the task
board.

## Repo-wide rules

1. **Tests first.** Every behaviour change starts with a failing test.
2. **Never guess on the user's behalf.** When the model or the OCR is unsure, the
   answer is `INSUFFICIENT_EVIDENCE`. Silent fallbacks and default labels are bugs
   here, not conveniences.
3. **`services/api/schemas.py` is the shared contract** between all three
   workstreams. Change it only in a PR that all three review. The app's TypeScript
   types are generated from it (`cd app && npm run gen:api`), and CI fails if they
   drift.
4. **Stay in your lane.** Don't edit another workstream's code as a side effect of
   your task. Report what you need instead.
5. **Grouped splits, always,** and **report the domain** (catalog vs phone) for any
   accuracy number. See `CONTRIBUTING.md`.
6. **Never commit data, models or secrets.** `data/`, checkpoints and `.env*` are
   gitignored; keep it that way.

## Things that look like bugs but are not

Each is pinned by a test. Don't "fix" them (details in `docs/HANDOFF.md` §8):

- Every scan returns `INSUFFICIENT_EVIDENCE`: there is no trained model yet.
- `parse_composition` returns `None` for an unknown fibre instead of skipping it.
- The consistency KB is deliberately asymmetric.
- `Sample.group_id` is required.
- `.gitignore` anchors `/data/` and `/datasets/` to the repo root.

## Commands

```bash
make setup        # Python venv + deps
make test         # Python tests;  make lint  for ruff
make api          # API at http://127.0.0.1:8000/docs
make api-lan      # API reachable from a phone on the same wifi
make app-setup    # app JS deps
make app          # Expo dev server
make app-check    # app typecheck + lint + format + tests
```

## Git

`main` is protected by CI (a Python job and an app job). Branch as
`feat/<area>-<thing>` (e.g. `feat/app-quality-gate`, `feat/vision-dinov2-probe`),
open a PR, and someone else merges it. Commit or push only when asked.
