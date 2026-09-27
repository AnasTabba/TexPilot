# Scanner AI Pipeline — Design

**Date:** 2026-09-27
**Project:** TexPilot (FYP, CSE 493/494, IBA SMCS)
**Milestone:** M1 (early Nov 2026)
**Status:** Design approved in conversation; written spec pending review
**Parent spec:** `2026-09-20-fabric-verification-scanner-design.md` — this document replaces its vision
and OCR internals (§4.1, §4.2) and adds to §4.3, §6 and §8. The parent's claims (§2),
verdict model (§3) and data rules (§5) still hold.

---

## 1. Goal

Make the scanner's AI work end to end, locally, for the M1 demo. The frontend is built
separately against the API.

- **Shot 1 — the whole garment**, laid flat or on a hanger. Detect the garment, name its
  type, cut it out from the background, and classify fabric structure, surface treatment
  and fibre family.
- **Shot 2 — a close-up of the care label.** Find the text, read it, and parse the stated
  composition.
- The existing consistency engine cross-checks the two: `PASS | FLAG | INSUFFICIENT_EVIDENCE`.

**Constraints**

- Inference runs on the team's Apple M3 laptop (16 GB, MPS). Phones call it over Wi-Fi.
- **Local models only.** No hosted AI APIs: scans must work offline on a factory floor,
  with no per-scan cost, and every model must be explainable in the viva.
- The parent spec's rules stand: no exact fibre composition from an image; abstention is
  a verdict, not an error; never guess on the user's behalf.

**Out of scope for M1:** care-symbol (washing icon) recognition, on-device inference
(M4), capture-quality gating (the app's job), persistence (parent §9).

## 2. Changes to the parent spec

| Parent | This design | Why |
|---|---|---|
| §4.4 capture: 10–20 cm fabric close-up | Whole-garment photo; a close-up still works (fallback, §4.4) | TextileNet is built from shopping-site product photos of whole garments, so a tight garment crop matches the classifier's training data better than a swatch |
| §4.1 Head C: 4 families | Trains 3 (cellulosic / protein / synthetic); API label space stays 4 | TextileNet fibre is single-label, so there are no *blend* images. Blends come from the care label |
| §4.2 normaliser: `PA`→acrylic | `PA`→nylon (polyamide) | ISO 2076 / EU Reg. 1007/2011: PA is polyamide, PAN is acrylic. The old mapping would misread swimwear labels and raise false flags |
| §4.3 engine uses structure + treatment only | Adds `FAMILY_MISMATCH` from Head C | Otherwise Head C is display-only |
| §4.1 backbone: frozen DINOv2 at M1, fine-tune at M2 | Frozen DINOv2 now; Head A switches to the fine-tuned TextileNet benchmark checkpoint when it exists, still inside M1 | The benchmark work (`training/textilenet/`) produces it anyway |

## 3. Architecture

```
shot 1 ─► GarmentDetector ─► Segmenter ─► FabricCropper ─► FabricHeads ─┐
          (A | B | C)         SAM 2.1      views             A structure │
          boxes + type        mask                           B treatment │
                                                             C family    │
shot 2 ─► OcrEngine ─► CompositionExtractor ─► parser + normaliser ─────┤
          (Paddle | Apple | Florence-2)                                  ▼
                                               consistency engine ─► verdict
```

Five units, each with one job and a typed interface (Python `Protocol`s in
`services/vision/` and `services/ocr/`):

```python
class GarmentDetector(Protocol):
    def detect(self, image: np.ndarray) -> list[Detection]: ...
    # Detection(label: str, score: float | None, box: tuple[float, float, float, float])
    # box in pixels (x0, y0, x1, y1); score None when the backend has none (Florence-2)

class Segmenter(Protocol):
    def segment(self, image: np.ndarray, box: Box) -> np.ndarray: ...   # bool mask, HxW

class FabricCropper(Protocol):
    def views(self, image: np.ndarray, mask: np.ndarray | None) -> list[np.ndarray]: ...

class FabricHeads(Protocol):
    def predict(self, views: list[np.ndarray]) -> VisionOutput: ...    # existing type

class OcrEngine(Protocol):
    def read(self, image: np.ndarray) -> list[TextLine]: ...
    # TextLine(text: str, confidence: float, box: Box)
```

`ScannerPredictor` composes them and implements the existing `Predictor` protocol, which
stays the API's only dependency on vision. `StubPredictor` remains for tests and for
running the API without models.

**Code layout** (follows the existing tree):

| Path | Holds |
|---|---|
| `services/vision/garment.py` | `Detection`, `GarmentDetector`, vocabulary, primary-garment selection |
| `services/vision/detectors/{gdino,owlv2,rtdetr,florence2}.py` | detector backends |
| `services/vision/segment.py`, `crop.py` | SAM 2.1 segmenter, cropper |
| `services/vision/heads.py` | bundle loading, calibrated heads, abstention |
| `services/vision/scanner.py` | `ScannerPredictor` |
| `services/ocr/engines/{paddle,apple,florence2}.py` | OCR backends |
| `services/ocr/extract.py` | `CompositionExtractor` |
| `training/scanner/` | head fitting, calibration, Head B labelling tool, detector fine-tune, evaluation and bake-off |

Model backends import their heavy dependencies lazily, so CI (no torch) still imports
every module.

## 4. Garment detection

### 4.1 Vocabulary

The fabric garments among Fashionpedia's 27 apparel categories. Accessories (glasses, hat,
headband, tie, glove, watch, belt, leg warmer, tights, sock, shoe, bag, umbrella) are
dropped.

| Canonical | Prompt synonyms (open-vocabulary backends) |
|---|---|
| `shirt_blouse` | shirt, blouse |
| `top_tshirt_sweatshirt` | t-shirt, top, sweatshirt, hoodie |
| `sweater` | sweater, jumper, pullover |
| `cardigan` | cardigan |
| `jacket` | jacket, blazer |
| `vest` | vest, waistcoat |
| `pants` | pants, trousers, jeans |
| `shorts` | shorts |
| `skirt` | skirt |
| `coat` | coat, overcoat |
| `dress` | dress, gown |
| `jumpsuit` | jumpsuit, overalls |
| `cape` | cape, poncho |
| `scarf` | scarf, shawl, dupatta |

Garment type and fabric are separate outputs: jeans are `pants` + `denim`.

### 4.2 Backends

| | Model (licence) | Scores | Notes |
|---|---|---|---|
| **A1** | Grounding DINO-T `IDEA-Research/grounding-dino-tiny` (Apache-2.0) | yes | zero-shot, prompted with the synonyms |
| **A2** | OWLv2-B `google/owlv2-base-patch16-ensemble` (Apache-2.0) | yes | zero-shot |
| **B** | RT-DETRv2-R50 `PekingU/rtdetr_v2_r50vd` (Apache-2.0), fine-tuned on Fashionpedia train restricted to the vocabulary | yes | trained on the rented GPU alongside the TextileNet benchmark; Apache-2.0 chosen over Ultralytics YOLO (AGPL-3.0) |
| **C** | Florence-2-large `microsoft/Florence-2-large` (MIT), phrase grounding | **no** | reports `confidence: null`; the detection threshold cannot apply |

All four load through Hugging Face `transformers` (one new pinned dependency). Only the
configured backend is loaded at serve time.

### 4.3 Primary garment

Each detection gets `rank = score × sqrt(area_fraction) × (1 − 0.5·d)`, where `d` is the
distance of the box centre from the image centre, normalised to [0, 1]. For C, `score = 1`.
The top-ranked detection with `score ≥ τ_det` is the garment. `τ_det` defaults to 0.30 and
is tuned per backend in the bake-off (§8).

### 4.4 No garment found

The whole frame becomes the single view (the parent spec's close-up mode keeps working),
`garment` is `null`, and the result carries an `info` flag `NO_GARMENT_DETECTED`. Calibrated
abstention (§6.3) guards against junk images.

### 4.5 Segmenter

SAM 2.1-small (`facebook/sam2.1-hiera-small`, Apache-2.0), prompted with the chosen box.
Keep the best of its three masks by predicted IoU, then the largest connected component,
with holes filled. If the mask covers < 20% of its box, segmentation failed: use the box
crop without a mask.

### 4.6 Cropper

1. **Masked garment crop** (default): the mask's bounding box, pixels outside the mask set
   to white, padded to square with white. This mimics TextileNet's white-background
   product photos.
2. **Texture patches** (optional): up to 3 non-overlapping squares, side = 25% of the
   garment's short side, lying entirely inside the mask eroded by 5% of the short side
   (away from seams and edges), at native resolution. If none fit, none are produced.

The heads average softmax probabilities over the views. `crop` vs `crop+patches` is
decided by the bake-off.

## 5. Label reading

### 5.1 OCR engines

| | Engine | Notes |
|---|---|---|
| 1 | PaddleOCR PP-OCRv5 (Apache-2.0) | portable (Linux too), multilingual |
| 2 | Apple Vision `VNRecognizeTextRequest` via PyObjC | macOS only; accurate mode; **language correction off** — it rewrites fibre codes such as `EA`, `PES` into words |
| 3 | Florence-2 `<OCR_WITH_REGION>` | shares the detector C model; no extra memory when C is loaded |

### 5.2 Label detection

In a label close-up, detection is the engine's text-line detection. A presence check follows:
no line containing a `%` or a known fibre word gives the `info` flag `NO_LABEL_TEXT`, and the
composition is unreadable.

### 5.3 CompositionExtractor

1. Sort lines into reading order (top to bottom, then left to right; lines whose vertical
   centres are within half a line height count as one row).
2. Split the text into sections at keywords — main-fabric keywords (`shell`, `outer`, `main`,
   `body`, `self`, `fabric`) and other-part keywords (`lining`, `trim`, `rib`, `filling`,
   `padding`, `pocketing`, `contrast`) — matched case-insensitively, English plus the
   languages added in §5.4.
3. Parse each section with the existing `parse_composition`. If a section fails as a whole
   (typically other-language repeats of the same text), parse it line by line and keep the
   longest valid composition.
4. Choose the main-fabric section; if no section keyword appears, the first valid
   composition not under an other-part keyword. Valid compositions for the chosen section
   that **agree** raise confidence; ones that **disagree** return nothing (unreadable) —
   never a guess.
5. If nothing parses, retry the OCR at 90°, 180° and 270°.
6. `ocr_confidence` = mean confidence of the lines used; `section` records which section
   was read (e.g. `shell`, or `null` when unlabelled).

### 5.4 Normaliser

- Fix `pa` → `nylon`. Parent spec §4.2 is corrected in the same commit as this spec.
- Add common non-English fibre names seen on high-street labels (e.g. `coton`, `baumwolle`,
  `algodón`, `cotone`, `poliéster`, `poliestere`, `elastan`, `elastano`, `laine`, `wolle`,
  `lana`, `soie`, `seide`, `seta`, `lin`, `leinen`, `lino`, `viscosa`, `viskose`, `nylon`,
  `poliamida`, `poliammide`, `acrílico`, `acrilico`), roughly 30 entries, each covered by a test.
- Unknown words still make the parse fail: the existing no-guess rule is unchanged.

### 5.5 Priority

If the request carries typed `label_text`, it wins over OCR: it is a human correction.

## 6. Fabric heads

### 6.1 Training data

| Head | Classes | Data |
|---|---|---|
| A structure | 27 | TextileNet fabric, frozen split (`data/splits/fabric.csv`) |
| C fibre family | 3 trained (4 in the API) | TextileNet fibre relabelled through `FIBRE_TO_FAMILY`; fur/leather/suede reported separately |
| B treatment | 4 | weak labels (yarn-dyed: gingham, chambray, denim; piece-dyed: lace, tulle, organza, chiffon, satin) + hand labels for *printed* and *undyed* |

**Head B ships only when ≥ 100 hand-labelled images per class exist.** The plan includes a
labelling tool (`training/scanner/label_treatment.py`: shows each image, records one
keypress). Until then Head B returns `None` and the treatment check stays off. That is the
honest state, not a gap. If 4-class macro-F1 on val is below 0.5, fall back to 2-class
printed / not-printed (parent risk #4).

### 6.2 Model

1. **Now:** frozen DINOv2 ViT-B/14 (`vit_base_patch14_dinov2.lvd142m`, Apache-2.0) at 224 px;
   feature = [CLS ; mean(patch tokens)] (1536-d); one linear head per task. The features are
   the TextileNet probe's, from the per-image cache (`training/textilenet/feature_cache.py`).
2. **When the benchmark checkpoint exists:** Head A switches to the fine-tuned model
   (ConvNeXt V2-B or DINOv2 fine-tune, whichever wins on TextileNet val). Heads are
   swappable individually; two backbones fit in memory.

### 6.3 Calibration and abstention

- Temperature scaling per head, fitted on val by NLL. Report ECE (15 bins) and a reliability
  diagram per head (parent §8).
- Abstain threshold per head `τ_h`: the lowest confidence at which val accuracy among
  predictions with confidence ≥ `τ_h` reaches the head's target (A: 0.90, C: 0.90, B: 0.85;
  configurable). Below `τ_h` the head returns `None`, following the existing `Predictor`
  contract. Coverage (share of val not abstained) is reported with every accuracy.

### 6.4 Engine change: `FAMILY_MISMATCH`

Raised (severity `medium`) when:
- Head C is not `None`, and
- its confidence ≥ `tolerance.family_min_confidence` (new KB key; initial 0.90, tuned for
  **precision** in the bake-off and recorded in `kb.yaml` with a version bump), and
- the predicted family is not among the label's dominant families (the existing
  `min_component_pct` rule).

Example: *"Label states cellulosic (100% cotton) but the fabric reads as synthetic."*
Because heads are calibrated, a fixed KB threshold is meaningful across models, and the
engine stays model-agnostic.

### 6.5 Model bundle

Each trained model ships as `models/scanner-vN/` (gitignored):
- `bundle.json`: version, backbone ids, per-head class lists, temperatures, `τ_h`, views
  setting, the split files' SHA-1s, val/test metrics
- `heads.safetensors`
- `MODEL_CARD.md`: training data, metrics, known limitations

`ScanResult.model_version` = `scanner-vN+det=<backend>+ocr=<engine>`, so every stored scan
traces to the exact models that produced it.

## 7. API contract (additive only)

The app regenerates its TypeScript types from `services/api/schemas.py`; every change is
optional or nullable, so the existing app build keeps working. Per `CONTRIBUTING.md`, the
change goes in a PR the app owner reviews.

**Request** `POST /api/v1/scan` (multipart):

| Field | Status | Meaning |
|---|---|---|
| `surface_image` | existing, required | whole-garment photo **or** fabric close-up |
| `label_image` | **new**, optional | care-label close-up |
| `label_text` | existing, optional | typed composition; overrides OCR |

**Response** `ScanResult` additions:

```python
class GarmentPrediction(BaseModel):
    label: str                       # vocabulary canonical name
    confidence: float | None         # None for backends without scores (Florence-2)
    box: tuple[float, float, float, float]  # normalised 0-1 (x0, y0, x1, y1)

ScanResult.garment: GarmentPrediction | None = None
StatedComposition.section: str | None = None      # e.g. "shell"
```

**Flag codes**

| Code | Severity | When |
|---|---|---|
| `COMPOSITION_IMPLAUSIBLE` | high | existing |
| `TREATMENT_UNEXPECTED` | medium | existing |
| `FAMILY_MISMATCH` | medium | §6.4 |
| `NO_GARMENT_DETECTED` | info | §4.4 |
| `NO_LABEL_TEXT` | info | §5.2 |
| `COMPONENT_FAILED` | info | a model raised during this scan; message names the component |
| `LABEL_UNREADABLE` | info | label text found, but no single valid composition (§5.3) |

`info` is a new severity value: notes that explain an abstention, not mismatches.

**Configuration** (environment):

| Variable | Values | Default |
|---|---|---|
| `TEXPILOT_VISION` | `scanner`, `stub` | `stub` |
| `TEXPILOT_MODEL_BUNDLE` | path | `models/scanner-v1` |
| `TEXPILOT_GARMENT_DETECTOR` | `gdino`, `owlv2`, `rtdetr`, `florence2` | `gdino` until the bake-off picks (§8.3) |
| `TEXPILOT_OCR_BACKEND` | `none`, `apple`, `paddle`, `florence2` | `apple` with `TEXPILOT_VISION=scanner`, else `none` |

**Errors**
- **Startup:** with `TEXPILOT_VISION=scanner`, every configured model loads at startup. Any
  failure stops the API with a message naming the model. Misconfiguration must be loud.
- **Per scan:** if a component raises, it is logged, its output is `None`, and a
  `COMPONENT_FAILED` flag is added. The verdict follows from what remains (usually
  `INSUFFICIENT_EVIDENCE`). No 500s for model failures, and never a guess.
- **Latency target:** p50 ≤ 3 s per scan on the M3 with the default backends.

## 8. Evaluation and bake-off

### 8.1 Phone test set (team task)

About **100 garments from the team's own wardrobes** (minimum 60), spread across the
vocabulary and across fibre families, photographed by at least two people on different
phones. About an hour of work.

For each garment:
- `garment.jpg` — whole garment, laid flat or hung, any plain-ish background
- `label.jpg` — close-up of the composition side of the care label
- a row in `ground_truth.csv`: `id, garment_type, label_text` (typed exactly as printed),
  `fabric_structure` (optional, if known), `notes`

Stored under `data/phone/` (gitignored) and read through a `PhoneDataset` adapter
implementing the existing `FabricDataset` interface (`group_id` = garment id, domain
`phone`). The label text also gives each garment its dominant **fibre family**, so Head C
is measured on real photos without extra labelling.

### 8.2 Metrics

| Component | Metric |
|---|---|
| Garment detectors | type top-1 accuracy on the phone set; latency; B also Fashionpedia val mAP |
| OCR engines | composition exact-match rate (after normalisation); character error rate on the composition section; read rate |
| Head A | TextileNet test top-1 / top-5 / macro-F1 vs the 67.32 baseline; phone accuracy where `fabric_structure` is known |
| Head C | TextileNet fibre test (3-family) accuracy / macro-F1; phone accuracy against the label's family |
| Heads | ECE, coverage at the target accuracy |
| End to end | flag precision and recall, abstention rate, latency p50/p95 |

**Flag precision** uses deliberately mismatched pairs, made at evaluation time by pairing
each garment photo with another garment's label from a different fibre family (parent §8).
No extra photos are needed.

### 8.3 Decision rules

- Default detector: best type accuracy on the phone set; within 2 points, the faster wins.
- Default OCR engine: best composition exact-match; within 2 points, the faster wins.
- Default views: `crop` vs `crop+patches` by Head C phone accuracy.
- KB thresholds (`min_visual_confidence`, `family_min_confidence`): the lowest values
  giving flag precision ≥ 0.90 on the mismatched pairs, reported with recall.

If the phone set does not materialise, detectors are compared on Fashionpedia val, OCR is
reported on whatever labels exist, and the M1 demo ships with A1 + Apple Vision + `crop`,
with the limitation stated.

## 9. Testing

- Each unit gets fast tests with fake backends: primary-garment ranking, fallback, the
  cropper on synthetic masks, calibration and threshold maths, bundle loading.
- The extractor gets real label-text fixtures: sections, multilingual repeats, disagreeing
  parses, rotation retry, `NO_LABEL_TEXT`, and the `PA` fix.
- API tests use a fake `ScannerPredictor`, like the existing tests, and cover the new
  optional fields and flags.
- Model-backed smoke tests are marked `slow` and skipped by default and in CI.
- CI (no torch) keeps passing: heavy imports are lazy.

## 10. Build order

| Week | Dates | Work | End state |
|---|---|---|---|
| 1 | Sep 28 – Oct 4 | interfaces; A1/A2 + SAM 2.1 + cropper; Apple Vision + PaddleOCR; extractor + normaliser fixes; Heads A and C (frozen DINOv2) + calibration; `ScannerPredictor`; API additions. Team: phone set | **Demo works end to end on the Mac** |
| 2 | Oct 5 – 11 | `PhoneDataset` + evaluation harness; bake-off round 1 (A1 vs A2, Apple vs Paddle); KB thresholds; `FAMILY_MISMATCH`; Head B labelling tool (+ Head B if labels exist) | first measured numbers |
| 3 | Oct 12 – 18 | backend C (Florence-2 detection + OCR); bake-off round 2 | |
| 3–4 | Oct 12 – 25 | backend B: Fashionpedia download + RT-DETRv2 fine-tune on the rented GPU (with the TextileNet benchmark runs); bake-off round 3 | |
| 5 | Oct 26 – Nov 1 | fine-tuned Head A swapped in; defaults chosen; `scanner-v1` frozen; results written up | **M1** |

Dependencies: the phone set by the end of week 1; the rented GPU for backend B and the
benchmark; the final TextileNet split once the manifest scrape completes.

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Phone set not collected | §8.3 fallback; the demo still ships with stated defaults |
| 2 | Open-vocabulary detectors confuse near-neighbours (sweater / cardigan, shirt / top) | report the confusion; merge classes if the phone set shows it |
| 3 | Garment crops from phones differ from TextileNet product photos | white-background crop; phone-simulation augmentation in the fine-tune; measure the gap (the parent's headline result) |
| 4 | Memory or latency on 16 GB | load only the configured backends; the bake-off runs backends one at a time |
| 5 | PaddleOCR install friction on macOS arm64 / Python 3.10 | Apple Vision covers M1; Paddle stays optional |
| 6 | Florence-2 needs a specific `transformers` version or `trust_remote_code` | pin `transformers`; isolate in its backend module |
| 7 | Fashionpedia is several GB over a slow home link | download it on the rented GPU box, not the laptop |
| 8 | Head B hand labels never made | Head B returns `None`; the treatment check stays off; report it |

## 12. Licences

| Asset | Licence | Use |
|---|---|---|
| Grounding DINO-T, OWLv2-B, RT-DETRv2, SAM 2.1, DINOv2 | Apache-2.0 | served |
| Florence-2 | MIT | served |
| PaddleOCR | Apache-2.0 | served |
| Apple Vision | macOS system framework | served on the Mac only |
| Fashionpedia | annotations CC BY 4.0; check image terms before redistributing | backend B training |
| TextileNet | CC BY (data), MIT (code) | heads |
