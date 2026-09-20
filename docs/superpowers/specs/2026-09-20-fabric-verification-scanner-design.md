# Fabric Verification Scanner — Design

**Date:** 2026-09-20
**Project:** TexPilot (FYP, CSE 493/494, IBA SMCS)
**Track:** Software
**Milestone:** M1 (MVP / feasibility demonstrator, ~early Nov 2026)
**Status:** Approved design, pending implementation plan

---

## 1. Context

TexPilot is a two-part system for garment manufacturing:

1. A **fabric verification scanner** — a phone app that photographs a fabric or garment and checks that what it *looks like* is consistent with what its care label *claims*.
2. A **production planning platform** — the MILP/CP-SAT scheduling system specified in `FYP_Industrial_Production_Optimization_SRS.docx` and designed in the companion spec `2026-09-20-garment-planning-platform-design.md`.

The scanner is the MVP and the M1 deliverable. The planning platform is the larger system it eventually feeds.

### Sub-project decomposition

| # | Sub-project | Milestone | Spec |
|---|---|---|---|
| 1 | Fabric Verification Scanner | M1 | this document |
| 2 | Goods-in bridge | M2 | planning-platform spec, §Goods-in |
| 3 | Production planning platform | M2–M4 | `2026-09-20-garment-planning-platform-design.md` |

### Milestone map

| Milestone | Approx. date | Deliverable |
|---|---|---|
| M1 | early Nov 2026 | Scanner working on a phone against real garments |
| M2 | late Dec 2026 | Scanner complete, goods-in bridge, tactical MILP solving |
| M3 | Jan 2027 | Same build, External Open House |
| M4 | Apr 2027 | Operational CP-SAT, on-device inference, real-conditions validation |
| M5 | May 2027 | Final defence + paper |

---

## 2. What this system claims, and what it does not

This section is load-bearing. It exists so the accuracy story survives a viva.

**Fibre composition is a molecular property and is not determinable from an RGB photograph.** Cotton, modal, viscose and lyocell are all cellulose and are visually identical. Real-world fibre identification uses burn tests, microscopy, or FTIR/NIR spectroscopy. The care label exists precisely because the information is not visible.

Evidence from the datasets:

| Dataset | Content | Consequence |
|---|---|---|
| TextileNet fibre (33 cls) | catalog photos | ViT ceiling **53.3%** top-1 |
| TextileNet fabric (27 cls) | catalog photos | ViT **67.3%** top-1 — usable |
| FabricsComposition | 12,724 images, **44 distinct fabrics** | too few samples to train a composition regressor |
| MIT fabric-from-video | 30 fabrics, motion under wind | measures bending stiffness from motion; not applicable to a static scan |

A model can exceed chance on fibre by *correlation* ("chunky knit → wool", "satin drape → polyester") but that shortcut collapses on the case users care about — silk vs polyester satin, where both are satin.

**Therefore:**

- The system **does not** predict exact fibre composition from an image.
- The system **does** predict fabric structure, surface treatment, and coarse fibre family from an image.
- The system **does** read exact composition from the care label via OCR.
- The system's product value is the **cross-check between the two** — detecting mislabelled or misrepresented fabric.

MIT fabric-from-video is **out of scope**. It is retained as a citation for the limitations chapter, not as training data.

---

## 3. Architecture

```
camera ─┬─ capture A: fabric surface (10–20 cm)
        └─ capture B: care label (optional)
                    │  HTTPS multipart
                    ▼  FastAPI
        ┌───────────────┬────────────────┐
        │ Vision svc    │ OCR svc        │
        │ backbone      │ detect → read  │
        │ + 3 heads     │ → parse → norm │
        └───────┬───────┴───────┬────────┘
   structure, treatment,   {cotton: 60, polyester: 40}
    fibre family + conf         │
                └───────┬───────┘
                        ▼
              Consistency engine
              (plausibility KB + calibrated thresholds)
                        ▼
        PASS │ FLAG(reason) │ INSUFFICIENT_EVIDENCE
```

### Three outcomes, not two

`INSUFFICIENT_EVIDENCE` is a first-class verdict, not an error path. A classifier forced to always answer produces confident wrong answers, and confident wrong answers are what make this class of product unusable at a QC desk. Abstention is the mechanism that buys high **precision** on flags, which is the only metric a factory cares about.

Abstention triggers:
- capture quality below threshold (blur, exposure, framing)
- all vision head confidences below `τ_abstain`
- care label unreadable *and* no PO-supplied expected fabric

---

## 4. Components

### 4.1 Vision service

One shared backbone, three heads (multi-task).

| Head | Task | Classes | Label source |
|---|---|---|---|
| A | Fabric structure | 27 | TextileNet fabric partition, direct |
| B | Surface treatment | 4 — printed / piece-dyed / yarn-dyed / undyed | weak labels + hand-labelled subset |
| C | Fibre family | 4 — cellulosic / protein / synthetic / blend | TextileNet fibre, collapsed |

**Head C — the fibre-family collapse.** TextileNet's 33 fibre classes map onto 4 families:

- *cellulosic*: cotton, flax_linen, hemp, jute, ramie, abaca, sisal, viscose_rayon, modal, lyocell, cupro, triacetate_acetate
- *protein*: wool, silk, cashmere, mohair, alpaca, angora, camel, yak, llama, horse_hair, fur, leather, suede, milk_fiber, soybean_fiber

  `milk_fiber` and `soybean_fiber` are regenerated protein (azlon) fibres and group with protein on chemistry. `fur`, `leather` and `suede` are hides rather than spun fibres; grouping them as protein is chemically correct (keratin/collagen) but they are structurally unlike the rest of the family, so their per-class performance is reported separately in evaluation.
- *synthetic*: polyester, nylon, acrylic, elastane_spandex, polyolefin, aramid
- *blend*: multi-family labels where available (FabricsComposition `*_pct` columns)

This converts a 53%-ceiling 33-class problem into a 4-class problem that should clear 80%, because families are visually separable even where their members are not.

**Head B — weak label derivation.** Several TextileNet fabric classes encode treatment by definition:

- yarn-dyed by definition: `gingham`, `chambray`, `denim` (yarn-dyed warp)
- piece-dyed by default: `lace`, `tulle`, `organza`, `chiffon`, `satin`
- remaining classes: hand-label a stratified subset, supplemented by FabricsComposition's `pattern` and `num_colors` columns

**Backbone.** M1 baseline is **DINOv2 ViT-B/14 frozen features + linear probe per head** — strong on texture, trains in minutes on the M3, gets a working demo fast. End-to-end fine-tune (ViT-B/16 or ConvNeXt-T) is the M2 upgrade if evaluation justifies it.

Rationale for multi-task: the three tasks share texture representation, and treatment correlates with structure (gingham implies yarn-dyed), so joint training regularises all three.

### 4.2 OCR service

`detect → recognise → parse → normalise`

- **Recogniser:** Apple Vision / ML Kit on-device (free, strong on printed text); PaddleOCR server-side for cross-platform parity.
- **Parser:** grammar over composition strings — handles `60% COTTON 40% POLYESTER`, `COTTON 60%`, multilingual labels, and OCR noise.
- **Normaliser:** maps supplier shorthand to canonical fibre names using `fiber_codebook.csv` from FabricsCompositionDataset (`PA`→acrylic, `NY`→polyamide, `EA`/`EL`/`Lycra`→elastane, `PES`/`PL`→polyester).
- **Validation:** percentages must sum to 100 ± 2. On failure, return `unreadable` rather than a guess.

### 4.3 Consistency engine

A hand-built plausibility knowledge base, roughly one row per fabric structure, mapping `(structure, treatment) → plausible fibre families`:

```
denim   → cellulosic-dominant, yarn-dyed
fleece  → synthetic
tweed   → protein
velvet  → protein | synthetic | cellulosic
lace    → synthetic | cellulosic
```

**Flag rule:** raise a flag only when `visual_confidence > τ_flag` **AND** the stated composition falls outside the plausible set for the predicted structure. `τ_flag` is tuned for precision, not accuracy.

The KB being hand-built is a design choice, not a shortcut: it is auditable, versioned, and self-explaining — *"flagged: tweed is a wool structure; label states 100% polyester."* That is actionable at a QC desk and mirrors the explainability contract in SRS §27.

### 4.4 Mobile app

React Native (Expo). Responsibilities:

- camera capture with a framing guide for both surface and label shots
- **capture-quality gating**: on-device blur (variance of Laplacian), exposure, and framing checks that reject a bad capture *before* upload
- result presentation including the abstain state
- offline queue: scans taken without connectivity upload when reachable

Capture gating is the cheapest accuracy win available — it is product design, not ML, and it removes the worst inputs from the model's distribution entirely.

### 4.5 Serving

FastAPI, same backend the SRS mandates (§29), so no new infrastructure. **Server-side inference for M1**; on-device (TFLite / Core ML) is an M4 target. Six weeks to M1 is too short to fight model-conversion toolchains, and server-side allows retraining without an app rebuild.

---

## 5. Data

### 5.1 Sources

| Source | Use | Licence |
|---|---|---|
| TextileNet fabric (27 cls) | Head A training | MIT (code) / CC BY (data) |
| TextileNet fibre (33 cls) | Head C training, after family collapse | as above |
| FabricsCompositionDataset | `fiber_codebook.csv` for OCR normalisation; `pattern`/`num_colors` for Head B; real fabric attributes (`weight_gsm`, `thickness_mm`) seeding the planning platform's fabric master | CC BY 4.0 / CC BY-NC 4.0 — **verify before publication** |
| Self-collected phone photos | evaluation only (see 5.3) | own |
| MIT fabric-from-video | **not used**; cited in limitations | — |

### 5.2 Splits

- **TextileNet:** standard class-stratified split.
- **FabricsCompositionDataset: grouped splits by fabric `id`, never random over the 12,724 images.** There are only 44 distinct fabrics; a random image-level split puts the same physical swatch in train and test and makes every reported number fiction. Target ~30 / 7 / 7 fabrics.

### 5.3 The phone-domain evaluation adapter

Team access to physical garments for data collection is **unresolved as of 2026-09-20**. The design does not depend on it.

The self-collected set is implemented as a **swappable dataset adapter behind one interface**, consumed by the same evaluation harness as the catalog data. Two outcomes:

- *It materialises* — the catalog→phone accuracy drop becomes the project's headline result.
- *It does not* — catalog-domain numbers are reported with an explicit, prominent stated limitation.

Nothing else in the system branches on this.

**Self-replenishing corpus.** Every scan in production persists its images, model outputs, verdict, and model version. The deployed app therefore accumulates a phone-domain dataset as a side effect of being used, which partially de-risks the data problem by M4 even if upfront collection fails.

### 5.4 Domain gap strategy

1. **Augmentation simulating phone capture** — specular glare, motion blur, JPEG artifacts, white-balance drift, perspective warp, shadow. Applied regardless of 5.3's outcome.
2. **Capture gating** (§4.4) — remove bad inputs rather than predict on them.
3. **Phone-domain evaluation** (§5.3) — measure what remains.

---

## 6. API contract

```
POST /api/v1/scan
  multipart: surface_image (required)
             label_image   (optional)
             context       (optional: po_id, expected_fabric_id)
  → 200 ScanResult | 202 {scan_id} for async
```

```
GET /api/v1/scan/{scan_id} → ScanResult
```

```jsonc
// ScanResult
{
  "scan_id": "…",
  "verdict": "PASS | FLAG | INSUFFICIENT_EVIDENCE",
  "structure":     { "label": "denim", "confidence": 0.91, "top5": [...] },
  "treatment":     { "label": "yarn_dyed", "confidence": 0.84 },
  "fibre_family":  { "label": "cellulosic", "confidence": 0.88 },
  "stated_composition": {
    "source": "care_label | purchase_order | null",
    "fibers": [ { "name": "cotton", "pct": 98 }, { "name": "elastane", "pct": 2 } ],
    "ocr_confidence": 0.79
  },
  "flags": [ { "code": "COMPOSITION_IMPLAUSIBLE", "message": "…", "severity": "high" } ],
  "capture_quality": { "blur": 0.12, "exposure": "ok", "framing": "ok" },
  "model_version": "…", "kb_version": "…", "timestamp": "…"
}
```

---

## 7. Error handling

| Condition | Behaviour |
|---|---|
| Capture fails quality gate | Rejected on-device; user re-prompted. No upload, no inference. |
| Label image absent | Proceed with vision only. Verdict is `INSUFFICIENT_EVIDENCE` unless a PO-supplied expected fabric is available to check against. |
| OCR unreadable / percentages do not sum | `stated_composition.source = null`, verdict `INSUFFICIENT_EVIDENCE`. Never guess a composition. |
| All head confidences < `τ_abstain` | `INSUFFICIENT_EVIDENCE` |
| Inference service unreachable | Scan queued on-device, uploaded when reachable. |
| Model or KB version mismatch on a stored scan | Stored result retained with its original versions; re-scoring is an explicit batch operation, never implicit. |

---

## 8. Evaluation protocol

| Claim | Metric | Baseline |
|---|---|---|
| Fabric structure | top-1 / top-5, TextileNet fabric | ViT 67.3% / 92.1% |
| Fibre family | top-1, 4-class | none public — establish |
| Surface treatment | macro-F1, 4-class | none public — establish |
| **Domain gap** | accuracy drop catalog → phone | **headline result** |
| OCR | CER + composition exact-match rate | — |
| End-to-end | flag **precision** / recall at a stated abstention rate | — |
| Calibration | ECE, reliability diagram per head | — |

Flag precision is reported *separately* from classification accuracy — they are different claims and conflating them is the most likely way to overstate the system.

**Ground-truth mislabelled samples** are constructed deliberately: pair a garment with a knowingly incorrect label. This is the only way to measure flag precision, and it is cheap.

---

## 9. Persistence

Every scan persists: both images, all head outputs with confidences, parsed composition, verdict, flags, capture-quality metrics, `model_version`, `kb_version`, timestamp, and operator identity where available.

This serves three purposes at once — audit trail (SRS §42), retraining corpus (§5.3), and the goods-in receipt record consumed by sub-project 2.

---

## 10. Team split

| | Owns |
|---|---|
| P1 | vision model, training pipeline, evaluation harness |
| P2 | OCR, parser, normaliser, consistency KB, FastAPI serving |
| P3 | React Native app, capture gating, offline queue, goods-in bridge |

Boundaries are the API contract (§6) and the dataset adapter interface (§5.3). No shared mutable state; all three can work in parallel from week one.

---

## 11. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Self-collected phone data never materialises** | No phone-domain accuracy claim; headline result lost | Adapter is pluggable (§5.3); augmentation + capture gating reduce dependence; production scans self-replenish by M4. Raise in the M1 proposal. |
| 2 | **TextileNet link rot — CONFIRMED 2026-09-20** | Scraped corpus is far smaller than published | ~73% of scrape targets are `contestimg.wish.com`; only ~37-45% of sampled fabric URLs and ~65% of fibre URLs still resolve (most failures are HTTP 500). The UCL OneDrive mirrors are dead (403). **Build the training set on the Google Drive seed zips**, which are self-contained and reachable; treat scraped data as a bonus. Re-measure with `make check-data`. |
| 3 | Catalog→phone domain gap too wide to close | Scanner unusable in real conditions | Measure it early and report it honestly; capture gating narrows the input distribution |
| 4 | Treatment labels (Head B) too noisy from weak supervision | Head B unusable | Hand-label a stratified subset; fall back to 2-class (printed vs not) if 4-class F1 is poor |
| 5 | FabricsComposition licence is CC BY **-NC** | Cannot publish/commercialise | Verify the licence before M5 paper submission; the codebook and attribute use is small and replaceable |
| 6 | SQL Server has no arm64 image; runs under Rosetta on M3 | Slow local dev | Known and accepted; 16 GB is tight with solver + dev server. Affects sub-project 3, not the scanner. |

---

## 12. Deviations from the SRS

The SRS contains no mobile app and no computer vision, and §23.2 restricts ML to demand forecasting. This sub-project sits outside it entirely. Points to raise with the advisor:

| SRS | This design | Rationale |
|---|---|---|
| §23.2 — ML confined to the predictive layer | CV model is a first-class component | The scanner is predictive, not prescriptive; the §23.2 boundary is preserved — no ML makes scheduling decisions |
| No mobile client specified | React Native app | Goods-in inspection happens on a factory floor, not at a desk |
| §49 — dataset entirely synthetic | Fabric master seeded from real FabricsComposition attributes | Strengthens M4 real-conditions validation |

---

## 13. Out of scope for M1

- On-device inference (M4)
- Goods-in bridge to `FabricInventory` (M2, sub-project 2)
- Any planning-platform functionality (sub-project 3)
- Exact composition prediction from image (permanently out of scope — see §2)
