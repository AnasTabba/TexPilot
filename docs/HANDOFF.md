# Handoff — where TexPilot stands

**Last updated:** 2026-09-27
**Repo:** https://github.com/AnasTabba/TexPilot (`main`, CI green)
**Next milestone:** M1, ~early Nov 2026 — a working scanner on a phone

Read this first, then `README.md`, then the scanner spec.

---

## 1. State in one paragraph

The scanner's AI is on `main`. The design is
`docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md`; week 1's plan
(`…-scanner-week1-demo.md`) is done and week 2's (`…-scanner-week2-bakeoff.md`) is in progress.

- **Done:** garment detection (Grounding DINO / OWLv2), SAM 2.1 masks, the garment crop,
  calibrated DINOv2 heads, Apple Vision label OCR, the composition extractor and
  `FAMILY_MISMATCH`. The API now accepts a `label_image`. Florence-2 (backend C) is a third
  detector and OCR engine sharing one model.
- **Stub by default:** `make api` still returns `INSUFFICIENT_EVIDENCE` for every scan,
  so the app can build anywhere. `make api-scanner` serves the real models on the M3.
- **First result:** a frozen DINOv2 linear probe already beats the published fabric
  baseline, **72.0% / 94.5%** against 67.3% / 92.1% (§4).
- Nothing has been built for the planning platform beyond its design document.

```bash
make setup && make test
make api                   # http://127.0.0.1:8000/docs
```

---

## 2. What the project is

**TexPilot = a fabric verification scanner + a garment production planning platform.**

The scanner photographs fabric, predicts what it *looks like*, OCRs the care label for
what it *claims*, and flags mismatches. That verdict later becomes the goods-in QC step
of the planning platform.

Two specs live in `docs/superpowers/specs/`. **Only the first is active:**

| Spec | Covers | Status |
|---|---|---|
| `…-fabric-verification-scanner-design.md` | Scanner (M1) | **Active — build this** |
| `…-garment-planning-platform-design.md` | Planning platform (M2–M4) | Designed, deferred. Do not start. |

### Sub-projects

| # | What | Milestone |
|---|---|---|
| 1 | Fabric verification scanner | M1 |
| 2 | Goods-in bridge (scan → `FabricInventory` receipt) | M2 |
| 3 | Planning platform (tactical MILP + operational CP-SAT) | M2–M4 |

### Milestones

| | When | Deliverable |
|---|---|---|
| M1 | early Nov 2026 | Scanner working on a phone, real garments |
| M2 | late Dec 2026 | Scanner complete, goods-in bridge, tactical MILP solving |
| M3 | Jan 2027 | External Open House |
| M4 | Apr 2027 | Operational CP-SAT, on-device inference, real-conditions validation |
| M5 | May 2027 | Final defence + paper |

---

## 3. Decision log

The project changed shape twice. If the two specs look contradictory, this is why.

| # | Decision | Why |
|---|---|---|
| 1 | **Software track**, not research track | Chosen over an algorithm bake-off (MILP vs CP vs GA vs RL). The SRS is a software-track document. |
| 2 | **Garment-specific**, not generic manufacturing | Size curves, sewing lines, learning curve — makes the demo concrete and gives the report a defensible domain contribution. |
| 3 | Fabric master seeded from **real** FabricsComposition attributes | `weight_gsm` feeds material costing directly; stops the dataset chapter saying "entirely invented". |
| 4 | Optimizer indexes **style × colorway**, not size | Sizes share routing, SMV and fabric lay — never scheduled independently. Indexing them multiplies variables ~6× for zero decision value (~6k binaries vs ~36k). |
| 5 | Capacity measured in **standard minutes**, not machine-hours | Operator minutes bind on a sewing line; machine count does not. Departs from SRS §17. |
| 6 | **Two-layer optimizer** — tactical MILP (weekly) → operational CP-SAT (daily) | Keeps both models small and fast; sequence-dependent changeovers and the learning curve are CP-SAT's strength, not MILP's. Chosen over a monolithic MILP and over rolling-horizon-only. |
| 7 | **Elastic-by-construction** infeasibility | Neither HiGHS nor OR-Tools computes an IIS. Slack variables with ranked penalties make the model always feasible, so "infeasible" surfaces as *which constraint broke, by how much* — which is what SRS §25 actually asks for. |
| 8 | **PIVOT: scanner became the MVP**, planning platform demoted to add-on | User's call. M1 is now the scanner, not the optimizer. |
| 9 | **Composition-from-photo dropped** as a goal | Fibre is molecular; cotton/modal/viscose/lyocell are visually identical. TextileNet's fibre ViT tops out at 53.3%. The care label exists precisely because the information isn't visible. |
| 10 | Replaced by **verification**: visual model × OCR cross-check | Predicts only what's visible, reads exact composition off the label, flags mismatches. Defensible accuracy, real compliance problem, publishable. |
| 11 | **Fibre family (4 classes), not fibre (33)** | Families *are* visually separable even though members aren't. Turns a 53%-ceiling problem into one that should clear 80%. |
| 12 | **Abstention is a real verdict** | A scanner forced to always answer produces confident wrong answers, which is what gets it switched off at a QC desk. |
| 13 | **Server-side inference for M1**, on-device at M4 | Six weeks is too short to fight model-conversion toolchains; the SRS already mandates a FastAPI backend. |
| 14 | **Capture = whole garment + label close-up** (was: 10–20 cm fabric close-up) | TextileNet is shopping-site photos of whole garments, so a detected, cut-out garment matches the training data better than a swatch. A close-up still works as a fallback. **App: change shot 1.** |
| 15 | **Three detector and three OCR backends, chosen by bake-off** | Detection: Grounding DINO / OWLv2 (zero-shot), RT-DETR on Fashionpedia (trained), Florence-2. OCR: PaddleOCR / Apple Vision / Florence-2. The team's phone photos decide the defaults; this becomes a comparison chapter for the report. |
| 16 | **Local models only** | Works offline at a QC desk, no per-scan cost, and every model can be explained in the viva. No hosted AI APIs. |
| 17 | **Head C trains 3 families**, not 4 | TextileNet is single-label, so it has no *blend* images; blends come from the label. |
| 18 | **`PA` = polyamide (nylon)**, not acrylic | ISO 2076 / EU Reg. 1007/2011. The old mapping would have misread swimwear labels and raised false flags. |

---

## 4. Verified facts — don't re-derive these

Measured during setup, not assumed.

### TextileNet link rot (this changes the training plan)
- `prepare_data.py` re-scrapes images from 2023 source URLs; **~73% point at `contestimg.wish.com`**, which was gutted in 2024.
- Measured 2026-09-20: **~37–45%** of sampled fabric URLs and **~65%** of fibre URLs still return an image. Most failures are HTTP 500.
- **UCL OneDrive mirrors in TextileNet's README are dead (403).** Google Drive seed zips are alive.
- ⇒ **Build the training set on the seed zips.** Treat scraped images as a bonus.
- ⇒ You will likely train on a **smaller set than the paper used** — state that caveat before claiming you beat 67.3%.
- Re-measure any time: `make check-data`. Exits non-zero below 60% recovery.

### TextileNet layout (verified 2026-09-26, `training/textilenet/`)
- The Drive "seed zips" are really `fabric.tar.gz` (12.8 GB) and `fibre.tar.gz` (14 GB), already split into `train/` and `test/`. They are **disjoint** from the json manifests: the full dataset is archive + scrape, and link rot only hits the scraped half.
- Manifests: fabric 155,393 train / 39,157 test; fibre 227,123 / 56,899. Heavily imbalanced (lace 31.7k vs vinyl 225; cotton 75k vs polyolefin 187). `triacetate_acetate` is absent from the fibre manifests, so it comes from the archive only.
- The archive has byte-identical duplicates (~3% in the classes sampled). `prepare_data.py index` drops train copies of test images and keeps test as shipped.
- The published baseline scripts keep the checkpoint with the best **test** accuracy. Our numbers select on a val carve-out, which is stricter.

### Results so far (catalog domain, preliminary split)
| Model | Fabric top-1 / top-5 | Published best |
|---|---|---|
| Frozen DINOv2 ViT-B/14 + linear probe (3 seeds, ±0.01) | **72.0% / 94.5%** | ViT-Tiny from scratch: 67.3% / 92.1% |

The preliminary split uses archive train images plus all recoverable test images (64% of
the paper's fabric test set). The final split adds the scraped train images when the
scrape finishes. Macro-F1 is 0.48: the rarest classes (canvas, twill) are weak.

### TextileNet's official split leaks
**2,388 fabric and 1,988 fibre training images are byte-identical to test images.** The
published baselines were partly tested on training data. `prepare_data.py index` drops
those copies from train and keeps test as shipped, so our comparison is the stricter one.

### Dataset facts
| Dataset | Reality |
|---|---|
| TextileNet fabric | 27 classes; ViT baseline **67.3%** top-1 / 92.1% top-5 |
| TextileNet fibre | 33 classes; ViT baseline **53.3%** top-1 — the ceiling that motivated the family collapse |
| FabricsComposition | 12,724 images but only **44 distinct fabrics** ⇒ grouped splits mandatory, ~30/7/7 |
| MIT fabric-from-video | 30 fabrics, bending stiffness from motion under wind — **not used**, cited in limitations only |

### Environment
- Apple **M3 / arm64, 16 GB**.
- **SQL Server has no arm64 image** — runs under Rosetta emulation. Azure SQL Edge (the old arm64 option) is retired. Affects sub-project 3, not the scanner.
- Python 3.10.10. No conda/uv. `make setup` builds a venv.
- `.venv` is not committed; `make setup` is ~90s.
- The laptop is a **fanless MacBook Air (16 GB)**. On 2026-09-27 an ML job plus browser tabs
  exhausted its memory, and it froze and had to be force-restarted. Long jobs now go
  through `training/textilenet/governor.py`, which pauses on heat or low memory, and Metal
  memory is capped. Keep it to ≤ 2 loader workers and one heavy job at a time.
- macOS 27 cannot load scipy 1.15.x wheels (dyld), and albumentations imports scipy, so
  scipy is pinned to 1.14.1.
- PaddleOCR 3.7 installs over our OpenCV, so it lives in its own venv (`make setup-paddle`)
  behind a worker process.
- Google Drive rate-limits the TextileNet archives ("Quota exceeded"). A copy in your own
  Drive gets a fresh quota: `prepare_data.py download --drive-id <copy id>`.

---

## 5. Open items

### Blocking nothing yet, but decide soon
1. **Phone photo set: now has a guide, `docs/phone-test-set.md`. Due Oct 4.** About 100 garments from the team's wardrobes: a whole-garment photo plus a label photo each, and one spreadsheet row. It decides the bake-off and gives the headline catalog→phone result. **iPhones: set Camera → Formats → Most Compatible (JPEG).**
2. **FabricsCompositionDataset may be CC BY-NC**, which would block the M5 paper. Verify before depending on it.

### Left to the user, deliberately not done
3. **Repo is PUBLIC.** It was private when first checked. FYP specs are world-readable — a plagiarism exposure as much as a privacy one.
   ```bash
   gh repo edit AnasTabba/TexPilot --visibility private --accept-visibility-change-consequences
   ```
4. **Friend has no collaborator access** (needed to push, not to read):
   ```bash
   gh api -X PUT repos/AnasTabba/TexPilot/collaborators/<username> -f permission=push
   ```

---

## 6. Next actions

### P1 — Vision (`services/vision/`)
Present: `taxonomy.py` (label spaces + 33→4 collapse, validated at import), `datasets/base.py` (adapter boundary), `predictor.py` (`Predictor` protocol + `StubPredictor`).

1. `pip install gdown && gdown <drive-id>` for both seed zips → `data/`.
2. Implement `datasets/textilenet.py` against `FabricDataset`.
3. **DINOv2 ViT-B/14 frozen features + linear probe per head.** Minutes to train, unblocks the demo.
4. Replace `StubPredictor`. Return `None` heads when unsure — never a guess.
5. Build the eval harness reporting per-domain (catalog vs phone) and per-class for `fur`/`leather`/`suede` separately.

### P2 — OCR, consistency, serving
Present and tested: `ocr/parser.py`, `ocr/normalizer.py`, `consistency/kb.yaml` + `engine.py`, `api/`.

1. Extend `_CODEBOOK` from `fiber_codebook.csv` once downloaded.
2. Real OCR backend behind `TEXPILOT_OCR_BACKEND` — PaddleOCR server-side first.
3. Accept a `label_image` upload instead of `label_text`.
4. ~~Scan persistence (spec §9)~~ **done:** with `TEXPILOT_VISION=scanner`, every answered scan is
   kept in `data/scans/` (`scans.sqlite3` plus the photos as `<scan_id>_garment.jpg` /
   `_label.jpg`). `TEXPILOT_SCAN_STORE` sets the folder, or `none` turns it off; stub mode keeps nothing.

### P3 — App (`app/`)
**Changed by decision 14:** shot 1 is now the **whole garment** (laid flat or on a hanger),
not a close-up. Upload **JPEG**: the API answers HEIC, empty or non-image uploads with a
**422 in every mode**, stub included.

**When `feat/app-scaffold` merges into `main`** (the vision work is already there):
- The app branch adds a CI step checking that `src/scanner/api/schema.gen.ts` matches
  `schemas.py`. The app PR must regenerate the types (`cd app && npm run gen:api`) in
  that same PR, or its CI fails.
- The new response fields are additive: `garment`, `stated_composition.section`, and
  flags with `severity: "info"`.
- **`info` flags explain an abstention; they are not mismatches.** Examples are
  `NO_GARMENT_DETECTED`, `NO_LABEL_TEXT`, `LABEL_UNREADABLE` and `COMPONENT_FAILED`.
  Show them apart from "Why it was flagged", which is only for `high` / `medium` flags.
- **`NOT_SAVED`** (info) means the verdict is real but the server couldn't record the scan
  (e.g. a full disk). Show it so the operator knows the scan left no audit record.
- A scan can carry two flags with the same `code` (e.g. `COMPONENT_FAILED` from both
  vision and OCR). **Key flag rows by index, not by `code`.**

1. `npx create-expo-app@latest . --template blank-typescript`
2. Camera capture, two shots: the **whole garment** and the **care label** (decision 14).
3. **Capture-quality gating on-device** — blur (variance of Laplacian), exposure, framing. Reject before upload. Cheapest accuracy win in the project.
4. Offline queue. Don't retry 4xx responses: a 422 will never succeed.
5. Render all three verdicts — the abstain state is a normal outcome, not an error screen.

---

## 7. Take to the advisor

The design deviates from the SRS in eight places. None reduce scope; all need sign-off.

| # | Item |
|---|---|
| 1 | **The scanner isn't in the SRS at all** — no mobile app, no CV anywhere in that document |
| 2 | §23.2 walls ML to forecasting. The CV model is predictive not prescriptive, so the boundary holds — but say it out loud |
| 3 | §24.4 hard constraints vs elastic-by-construction infeasibility |
| 4 | §14/§15/§16/§17 restated in garment vocabulary (size curves, standard minutes, learning curve) |
| 5 | §49's dataset sizing (200–500 products) isn't solvable with §24.1's variables — superseded by ~50 SKUs / 10 lines / 12 weeks |
| 6 | §48 phase order reversed — solver before schema, so M1 has a working algorithm |
| 7 | FabricsComposition licence (CC BY vs BY-NC) |
| 8 | Training on a smaller TextileNet than the published paper, due to link rot |

---

## 8. Things that look like bugs but are not

Your teammate will be tempted to "fix" all four. Each has a test pinning it.

1. **Every scan returns `INSUFFICIENT_EVIDENCE`.** There's no model. `StubPredictor` returns empty heads and the engine abstains. Correct until P1 lands a checkpoint.
2. **`parse_composition` returns `None` on an unknown fibre** instead of skipping it. Skipping `30% ZZZFIBRE` leaves 70% cotton, which sums *close enough* to look valid — a confident wrong composition.
3. **The consistency KB is deliberately asymmetric.** `fleece`→synthetic and `tweed`→protein constrain hard; `jersey`, `knit`, `twill` list every family and therefore never flag. They're constructions any fibre can take; pretending otherwise generates false flags.
4. **`Sample.group_id` is required.** It's what makes a random image-level split over 44 fabrics impossible to write by accident.

Also: `.gitignore` uses `/data/` and `/datasets/` **anchored to the repo root**. Unanchored, `datasets/` matched `services/vision/datasets/` and silently excluded the adapter from the first commit. Don't un-anchor them.

---

## 9. Repo map

```
README.md                  start here after this doc
CONTRIBUTING.md            workflow + house rules
docs/
  HANDOFF.md               this file
  superpowers/specs/       the two designs
services/
  api/          FastAPI app, wire contract, pipeline      (P2)
  vision/       taxonomy, dataset adapters, predictor     (P1)
  ocr/          care-label parsing + fibre normalisation  (P2)
  consistency/  plausibility KB + flag engine             (P2)
app/            React Native client — not scaffolded      (P3)
scripts/        check_textilenet.py, check_phone_set.py, scan_demo.py
tests/          pytest; `-m ''` adds the slow model tests
```

`services/api/schemas.py` is the contract across all three workstreams — change it in a PR all three review.
