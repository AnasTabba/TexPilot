# TexPilot

Fabric verification scanner and garment production planning platform.
Final Year Project, CSE 493/494 — IBA, School of Mathematics and Computer Science.

---

## What it does

Point a phone at a fabric. The app checks that **what it looks like** is consistent
with **what its care label claims** — and flags the mismatches.

```
camera ─┬─ surface photo ──> vision model ──> structure, treatment, fibre family
        └─ care label ─────> OCR + parser ──> stated composition
                                     │
                              consistency check
                                     ▼
                  PASS │ FLAG(reason) │ INSUFFICIENT_EVIDENCE
```

That verdict becomes the goods-in QC step of the production planning platform:
fabric arrives against a PO, an operator scans it, and a verified receipt is
written to inventory with its dye lot.

## What it does *not* do

**It does not predict fibre composition from a photograph.** Fibre is a molecular
property — cotton, modal, viscose and lyocell are all cellulose and are visually
identical. Real fibre identification needs a burn test, a microscope, or FTIR/NIR
spectroscopy. The care label exists precisely because the information is not visible.

The numbers back this up: TextileNet's 33-class fibre partition tops out at **53.3%**
top-1 with a ViT. A model can beat chance by correlation — *chunky knit → wool* — but
that shortcut collapses on the case anyone actually cares about: silk vs polyester
satin, where both are satin.

So we predict what *is* visible:

| Head | Predicts | Classes | Honest ceiling |
|---|---|---|---|
| A | Fabric structure | 27 | beat TextileNet's ViT at 67.3% |
| B | Surface treatment | 4 | new — no public baseline |
| C | Fibre **family** | 4 | ~80%+ |

Head C is why this works. Collapsing 33 fibre classes into cellulosic / protein /
synthetic / blend turns an unwinnable problem into a winnable one, because families
*are* visually separable even though their members are not. Exact composition comes
from the label, by OCR, at 100% accuracy.

**Abstention is a real verdict.** A scanner forced to always answer produces confident
wrong answers, and those are what get it switched off at a QC desk. `INSUFFICIENT_EVIDENCE`
is a feature — argue for it, don't hide it.

## Quick start

```bash
make setup     # ~20s, no torch
make test      # everything should pass
make api       # http://127.0.0.1:8000/docs
```

Try it:

```bash
curl -s -F "surface_image=@any.jpg" \
        -F "label_text=60% COTTON 40% POLYESTER" \
     http://127.0.0.1:8000/api/v1/scan | python3 -m json.tool
```

It will return `INSUFFICIENT_EVIDENCE` with the composition parsed correctly — there
is no trained model yet, so the service abstains. That is the intended behaviour of
the base, not a broken build.

## Where to start

Read `docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md` first.
Then pick a lane:

### P1 — Vision  (`services/vision/`)
Already here: label spaces (`taxonomy.py`, validated at import), the dataset adapter
boundary (`datasets/base.py`), the `Predictor` protocol the API depends on.

1. `make check-data` — verify TextileNet is still downloadable **before** anything
   depends on it. The repo is from 2023 and re-scrapes image URLs.
2. Implement `datasets/textilenet.py` against `FabricDataset`.
3. Baseline: DINOv2 ViT-B/14 frozen features + a linear probe per head. Minutes to
   train, and it gets a demo working.
4. Replace `StubPredictor`. Do not make it guess when unsure — return `None` heads.

### P2 — OCR, consistency, serving  (`services/ocr/`, `services/consistency/`, `services/api/`)
Already here: the composition parser and fibre normaliser (both tested), the
plausibility KB, the flag engine, the FastAPI app and wire contract.

1. Extend `_CODEBOOK` from `fiber_codebook.csv` once the dataset is downloaded.
2. Real OCR backend behind `TEXPILOT_OCR_BACKEND` — start with PaddleOCR server-side.
3. Accept a `label_image` upload instead of `label_text`.
4. Scan persistence (spec §9) — every scan is audit evidence *and* accumulating
   phone-domain training data.

### P3 — Frontend  (`app/`)
One Expo codebase for the **iOS app, Android app and website**. The website serves
the scanner, a supervisor dashboard (`/dashboard`) and a landing page (`/`).

The scanner works end-to-end against the API:
- camera with a framing guide
- care-label entry
- submit
- all three verdicts rendered
- history

API types are generated from `services/api/schemas.py`. The scanner core
(`app/src/scanner/`) is kept embeddable for later use in other sites and services.
Start with `make app-setup && make app`.

The task board is in `app/README.md`. Headline items:
1. **Capture-quality gating on-device** (T2) — blur (variance of Laplacian), exposure,
   framing. Reject bad captures before upload. This is the cheapest accuracy win in
   the whole project and it is product work, not ML.
2. Offline queue (T5).
3. Care-label photo + OCR (T3), with P2.

## Milestones

| | When | Deliverable |
|---|---|---|
| M1 | early Nov 2026 | Scanner working on a phone against real garments |
| M2 | late Dec 2026 | Scanner complete, goods-in bridge, tactical MILP solving |
| M3 | Jan 2027 | External Open House |
| M4 | Apr 2027 | Operational CP-SAT, on-device inference, real-conditions validation |
| M5 | May 2027 | Final defence + paper |

## Open risks

1. **Phone-photo data collection is unresolved.** The self-collected set is a
   swappable evaluation adapter — if it materialises, the catalog→phone accuracy drop
   is the headline result; if not, we report catalog numbers with a stated limitation.
   Nothing else branches on it.
2. **TextileNet link rot — confirmed, and it bites.** `prepare_data.py` re-scrapes
   images from their 2023 source URLs, ~73% of which point at `contestimg.wish.com`.
   Measured 2026-09-20: only **~37-45%** of sampled fabric URLs and **~65%** of fibre
   URLs still return an image; most of the rest are HTTP 500. The UCL OneDrive
   mirrors in TextileNet's README are dead (403).
   **Plan the training set around the self-contained Google Drive seed zips** and
   treat anything the scraper recovers as a bonus. Re-measure with `make check-data`.
3. **FabricsCompositionDataset may be CC BY-NC**, which would block the M5 paper.
   Verify before relying on it.

## Datasets

| Source | Used for |
|---|---|
| [TextileNet](https://github.com/hahashu/TextileNet) | Heads A and C training |
| [FabricsCompositionDataset](https://huggingface.co/datasets/lilCode/FabricsCompositionDataset) | fibre codebook, Head B weak labels, real fabric attributes |
| [MIT fabric-from-video](https://people.csail.mit.edu/klbouman/pw/projects/materialproperties/dataset.html) | **not used** — measures bending stiffness from motion under wind; cited in limitations only |

Data lives in `data/` and is gitignored. Never commit it.

## Docs

- `docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md` — scanner (M1)
- `docs/superpowers/specs/2026-09-20-garment-planning-platform-design.md` — planning platform (M2–M4)
- `CONTRIBUTING.md` — workflow and house rules
