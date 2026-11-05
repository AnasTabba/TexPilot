# TexPilot Fault Detection + Fine-Grained Fabric ID — Design

Date: 3 Nov 2026. Status: DRAFT for approval. Research basis: `docs/garment-fault-detection-research-2026-11-02.md`
plus five research/inventory agent reports (3 Nov), audited (corrections listed in §11).

## 1. Intent

The supervisor asked the team to leave Yarnflow alone and turn the TexPilot scanner toward production fault detection:
any camera watches fabric/garments, a fault is found and localised, and a machine can be told to stop. The FYP
instructor also said fibre-level ID (cotton vs polyester) is trivial and the scanner must separate **look-alike
fabrics** (khaddar vs lawn vs cambric vs karandi). The user must defend this in front of a jury and later sell it,
so every claim must be backed by our own measured numbers or a cited paper. No unverified numbers.

Three deliverables, one shared foundation:
- **A. TexPilot-Fault**: a fabric/garment fault detector, benchmarked on public data and running on a live camera.
- **B. Scanner integration**: the v8 scanner returns a fault result (score, heatmap, regions) with each scan.
- **C. Fine-grained fabric ID**: lift `local_fabric` (17 classes, test macro-F1 0.625) using the same patch-level
  texture features the fault detector uses.

Shared foundation: a frozen DINOv2 encoder whose **patch tokens** (not only a pooled vector) feed both the fault
detector and the texture classifier. Evidence: frozen DINOv2 + trained head 0.79 mIoU / 0.88 mAcc on FMD vs
0.23/0.38 when fully fine-tuned (arXiv 2603.17390, Table 5, verified); Dinomaly uses frozen DINOv2 patches.

## 1b. Our contribution (the answer to "this already exists online")

We do not claim a new backbone. Published fabric anomaly results are saturated on lab benchmarks (MVTec textures and
WFDD 99–100 % image AUROC) taken with industrial cameras on flat fabric. The open problems the research found are
elsewhere, and each contribution below is measured, not asserted:

1. **Look-alike fabric ID with texture memory (method).** Reuse fault-detection machinery as a classifier:
   class-conditional patch memory banks on frozen DINOv2 patch tokens + pooled patch texture features, to separate
   khaddar / lawn / cambric / karandi / slub. No paper found separates these fabrics, and no paper tests anomaly-style
   patch memories as a fine-grained fabric classifier. Kept only if it beats the v8 head (paired bootstrap CI).
2. **New benchmark results (evaluation).** Dinomaly, INP-Former, MuSc have no published numbers on WFDD, AITEX or
   ZJU-Leaper. We report them under one matched protocol, including what papers omit: false alarms per 1,000 good
   images with confidence intervals, worst-category rows, latency on T4 and CPU.
3. **Data (dataset).** First human-verified, kappa-reported look-alike Pakistani fabric set (phone photos), and the
   first measured comparison of normal vs close-up vs backlit phone capture for fabric ID.
4. **Deployment problem papers skip (system).** False stops: per-fabric threshold from good images only + K-of-N
   temporal confirmation, with false stops per hour as the headline metric (a published edge system had 49 % FPR,
   arXiv 2608.14727); few-shot setup of a new fabric from 8–16 good photos with measured accuracy; a working
   phone/webcam → detector → stop-signal loop integrated into the existing TexPilot scanner.

## 1c. Target user: small and medium factories (confirmed by user 3 Nov)

Robust for an SME means, and each item is tested:
- **Cheap hardware**: one USB webcam (Logitech C270/C920 class) or a phone; inference on a CPU laptop/mini-PC
  (OpenVINO), no GPU. Measured: ms/frame and frames/s on CPU.
- **Setup by a non-expert in minutes**: a new fabric is enrolled from 8–16 photos of good fabric; no defect labelling.
  Measured: detection quality at 8/16 good photos vs full training.
- **Real-floor conditions**: lighting changes, motion blur, focus drift, JPEG/webcam noise, camera swap. Measured:
  a perturbation suite (brightness ±30 %, colour temperature, Gaussian/motion blur, JPEG q=30, sensor noise) applied
  to the benchmark test sets, reporting the drop per perturbation; plus a live webcam test on real fabric.
- **Any defect, not a fixed list**: anomaly detection flags unseen defect types; naming is a bonus that may abstain.
- **Few false stops**: per-fabric threshold from good images + K-of-N confirmation; false stops per hour reported.
- **Offline**: runs without internet.

Helps the current scanner: the same frozen DINOv2 patch features and texture memories power (a) a fault check on
every scan and (b) the look-alike fabric classifier (Part C).

## 2. Goals, non-goals, anti-goals

Goals
- G1. Fault detector benchmarked on WFDD, AITEX, ZJU-Leaper, MVTec textures, Real-IAD Variety garment categories,
  StitchingNet, Industrial Textile Dataset; per-category tables with image AUROC, pixel AUROC, AUPRO, F1 at a frozen
  threshold, and **false alarms per 1000 good images with 95 % CI**.
- G2. New results where none are published: Dinomaly / INP-Former / MuSc on WFDD, AITEX, ZJU-Leaper (research agent
  found no published numbers — these are a citable contribution).
- G3. Live demo: camera → detector → N-of-M confirmation → stop signal (relay-driven light/buzzer) with measured latency.
- G4. Scanner v8 returns `fault` in the scan response, behind an env flag, without changing existing fields.
- G5. `local_fabric` macro-F1 improves on the same product-level test split, with a confusion matrix, and is
  re-measured on a human-verified test subset for the confusable classes.

Non-goals
- Yarnflow (ERP) changes of any kind.
- Shipping/commercial packaging, Geti/Anomalib Studio productisation (later, after FYP).
- Wiring into a real factory machine's control circuit (demo uses a relay + light/buzzer only).
- Beglarian dataset (not counted on).
- Ultralytics YOLO (AGPL).

Anti-goals (failure even if code "works")
- Any number in the report that we did not measure or cannot cite to a page we read.
- Choosing thresholds or hyper-parameters on test data.
- Claiming "better than commercial systems" — no commercial numbers are public; we claim "better than published
  open baselines at matched settings" only where our measurement shows it.
- A fault feature that slows or breaks a normal scan when disabled.

## 3. Constraints

- Compute: Kaggle T4 ×2 (16 GB each) on accounts `anastabba` and `yaseenazhar`; weekly GPU quota limits. Mac is a
  fanless M3 16 GB: no training locally, `nice` for anything heavy.
- Data on Kaggle (verified 2–3 Nov): ZJU-Leaper `bnhphan/zju-dataset` (6.8 GB, masks + XML boxes; split files not yet
  located), WFDD `hodinhtrieu/the-woven-fabric-defect-detection-wfdd` (4,101 imgs + 241 masks, MVTec layout, MIT),
  AITEX `nexuswho/aitex-fabric-image-database` (106 defect + 141 good, 4096×256, masks, CC BY-NC-ND), MVTec AD
  `ipythonx/mvtec-ad`, VisA `ess1004/visa-anomaly-detection`, StitchingNet `hyungjung/stitchingnet-dataset`
  (official, CC BY-NC), TILDA **64×64 patches only** `angelolmg/tilda-400-64x64-patches` (good 23,170; hole 337;
  objects 837; oil spot 636; thread error 620), Real-IAD 512 px `anastabba/texpilot-get-realiad` (kernel output,
  15 GB), Real-IAD Variety garment subset `anastabba/texpilot-get-variety` (8.2 GB: flower_velvet_fabric,
  long_zipper, 4 buckles/clips, brooch clasp). ADNet: access pending. ITD: Google Drive (MIT) — upload once.
  Shop photos for `local_fabric`: Kaggle `texpilot-shop-scrape` (+ `feats_v8.npy` pooled features only).
- Licences: almost all benchmark data is non-commercial — fine for the FYP; recorded per dataset.
- Commits: user is sole author — no AI attribution lines.
- Scanner contract: `services/api/schemas.py` changes are additive and optional (existing clients keep working).

## 4. Part A — TexPilot-Fault (detector)

### 4.1 Model (decided)
- **Primary: Dinomaly** (CVPR 2025, Apache-2.0, official repo `guojiajeremy/Dinomaly`), DINOv2-registers ViT-B/14,
  **one unified multi-class model** for all fabric types (unified training is what fixes linear defects in
  Forsberg arXiv 2407.18450 and is how Dinomaly reaches 99.6 % MVTec / 87.1 % Real-IAD Variety (Dinomaly+)).
- **Challenger: INP-Former** (CVPR 2025, MIT; 99.7 / 98.9 / 90.5 I-AUROC MVTec / VisA / Real-IAD).
- **Zero-shot baseline: MuSc** (ICLR 2024, MIT) — also used to show "works with zero training images".
- **Classic baselines** (anomalib, same tiles/resolution): PatchCore, Reverse Distillation, EfficientAD.
- Dinomaly2 only if its code + weights are usable on T4 by the time Phase A1 ends (preview repo, no licence file).

### 4.2 Input handling
- Tile wide images to native-scale 392 px tiles (AITEX 4096×256 → strips; ZJU-Leaper/ITD large frames → grid).
  Image score = max tile score; heatmap = stitched tile maps. Tile count per frame reported with latency.
- Real-IAD/Real-IAD Variety used at 512 px as provided.

### 4.3 Protocol (pre-registered — written before any run)
- Splits: dataset-official splits where they exist (MVTec, WFDD, VisA, Real-IAD). AITEX: by fabric ID. ZJU-Leaper:
  official split files if found; otherwise split by pattern-group image ID with a fixed seed, documented.
  StitchingNet: authors' 6:2:2 protocol (its paper) for classification; for anomaly mode, train on Normal only.
- Thresholds: chosen on a **validation set of good images only** at a target false-alarm rate (0.5 % of good tiles),
  frozen, then applied once to test.
- Report per dataset and per category: image AUROC, image AP, pixel AUROC, AUPRO (FPR ≤ 0.3), pixel AP, F1 at the
  frozen threshold, worst-category row, false alarms / 1000 good images with 95 % CI (rule of three when 0),
  latency ms/image on T4 and on CPU (OpenVINO) at the real tiling.
- Ablations: unified vs per-pattern; full-shot vs 8/16-shot (good images per pattern); tiled vs whole image.
- "Better than published": only for cells where a published number exists at matched setting (e.g. Thomine AITEX
  96.5 mean I-AUROC, TILDA 83.6 — note our TILDA copy is 64 px patches so it is NOT comparable; GLASS WFDD 100/98.9/94.9
  — to be re-verified from the PDF before quoting).

### 4.4 Defect naming (second stage)
- A small classifier on crops around anomaly regions, on frozen DINOv2 features, trained on labelled defect crops:
  StitchingNet (10 stitch defect classes), TILDA patches (hole / objects / oil spot / thread error), WFDD grey-cloth
  types (contaminated / flecked / line / string), Textile Defect Detection (color / cut / hole / thread /
  metal_contamination). Output label + confidence; abstains below a val-chosen threshold ("defect, type unknown").
- Report macro-F1 per source.

### 4.5 Live stream + stop signal
- `scripts/fault_stream.py`: OpenCV source (USB index, RTSP URL or video file) → frame sampling → tiles → detector →
  **confirm rule: K of the last N frames over threshold** (default K=3, N=5; tuned on validation video) → events.
- Sinks: console + JSON log; HTTP webhook (POST); optional serial line to an ESP32/Arduino relay board that switches a
  light + buzzer. Stop-only, latched until a human clears it. Never starts a machine.
- Measured: end-to-end latency (frame captured → relay switched), false stops per hour on a good-fabric video.

## 5. Part B — Scanner v8 integration

- New `services/vision/fault.py`: loads the exported detector (checkpoint + threshold + version), runs on the scan's
  garment box (or whole image), ≤ 6 tiles per scan, returns `{score, is_fault, threshold, regions:[{box, score,
  type?, type_confidence?}], heatmap_png_b64, model_version}`.
- Wired in `services/vision/scanner.py` after the fabric heads (around `:73`), via the existing `_try` so a fault
  failure never fails a scan. Timing added to `timings_ms.fault_model`.
- `services/api/schemas.py`: optional `fault` field on `ScanResult` (default null) + flag `FAULT_DETECTED` (severity
  warn) in `flags`. `model_version` gains `+fault=<id>`.
- Gated by env `TEXPILOT_FAULT=1` in `services/api/config.py`; off = byte-identical responses to today.
- Tests: unit tests with a fake detector (shape of response, flag on/off, failure isolation), one slow test with the
  real checkpoint.

## 6. Part C — Fine-grained fabric ID (`local_fabric`)

Measured today (`models/custom/local_fabric/head.json`): test macro-F1 0.6250, top-1 0.6742, answers 31.8 % of photos
(90.4 % right when it answers). Worst test F1: satin 0.152, karandi 0.293, slub 0.324, twill 0.416, cambric 0.505,
khaddar 0.664, lawn 0.726. Train products: lawn 3,972, khaddar 2,054, cambric 1,748 … canvas 160, satin 176.
Cause candidates: (1) only one pooled vector per photo, so weave/yarn detail is lost; (2) shop-label noise
(TextileNet authors estimate ~82 % web labels correct); (3) heavy imbalance; (4) print/colour shortcuts.

Steps (each gated: val up AND test macro-F1 ≥ +0.01, same product-level split; else keep v8 head):
- C1. **Verified test subset**: 40–50 photos per confusable class (khaddar, lawn, cambric, karandi, slub, twill,
  satin, silk, linen), two judges blind to predictions, Cohen's kappa reported. Reuses the existing label-survey HTML
  tool (`runs/human_verify/`). Needs two people from the team (about 2 hours each).
- C2. **Patch-texture features**: extract SigLIP2 (current encoder) and DINOv2-B patch tokens at native scale on 5
  crops per photo; pool mean + max + GeM; train balanced logistic regression and a small MLP; test-time average over
  crops. Compare against the v8 head on the identical split.
- C3. **Fault-tech classifier (the "use fault detection to improve the scanner" link)**: class-conditional patch
  memory banks (AnomalyDINO/PatchCore-style nearest-patch distance per class) used as extra features / a kNN vote.
  This is our own idea; no paper tests it — ablated, kept only if it passes the gate.
- C4. **Label cleaning**: drop training photos where cross-fitted models confidently disagree with the label; ELR loss
  as the alternative (arXiv 2605.22591, abstract-level evidence). Gate as above.
- C5. **Capture protocol study** (needs the team): 30–50 own photos per confusable class at fixed close range (+ a
  backlit shot for lawn/cambric translucency); report accuracy normal-shot vs close-up on the same fabrics.
- Install: the winning head ships as a new `models/custom/local_fabric` version with rollback kept.

## 7. Execution model

- Subagent-driven: Sonnet 5.5 agents write code/kernels (one task each, disjoint files); Haiku 5.5 agents do
  mechanical work (dataset listing, converters, report tables). The controller (Claude) audits every result against
  files/logs before it is accepted; no agent output is reported to the user unchecked.
- All GPU work on Kaggle; Claude launches and collects runs itself; results land in `docs/` with exact sources.
- Work happens on a new branch in a worktree (current checkout has another agent's uncommitted edits).

## 8. Order and rough timing

1. A1 — data loaders/tilers + MuSc/PatchCore/RD/EfficientAD baselines on WFDD, AITEX, MVTec textures (≈3–4 days).
2. A2 — Dinomaly + INP-Former unified on all fabric sets incl. ZJU-Leaper, Real-IAD Variety, ITD (≈1 week).
3. C2/C3 in parallel with A2 (features share the extractor) (≈1 week). C1 by the team in parallel.
4. A3 — defect naming (≈3 days). A4 — live stream + relay demo (≈3–4 days). B — scanner integration (≈2 days).
5. C4/C5 and write-up (≈1 week).

## 9. Left to the builder

File layout under `training/fault/`, kernel packaging, exact tile overlap, which anomalib version pins, test
fixture design, OpenVINO export details, heatmap colour map.

## 10. Risks

- Saturated benchmarks (MVTec textures, WFDD ≈ 99–100) cannot show a gain → the weight of evidence is ZJU-Leaper,
  AITEX, Real-IAD Variety, false-alarm rate and latency.
- Patterned fabrics and thin/shade defects are the documented failure modes → reported separately.
- ZJU-Leaper split files not yet located; if absent, our split is documented and not comparable to other papers.
- `local_fabric` ceiling may be label noise / seller naming, not the model → C1 verified set tells us which.
- Kaggle GPU quota and rate limits can stall runs → two accounts, small output files.
- Domain gap: public datasets are industrial cameras; phones differ → the live demo and C5 measure it directly.

## 10b. Calls made by Claude after the builder check (user may override)

- Unified model = **one model per dataset across all its patterns/categories** (headline numbers per dataset); one
  global model across all fabric datasets is an ablation only.
- Good-only calibration set: carved from each category's train-good images: max(10 %, min(20, half)) images, seed 2026; AITEX
  carved per fabric ID. Few-shot cells use the remaining train-good images.
- Part C gate: paired bootstrap (1,000 resamples, by product) 95 % CI of the macro-F1 difference must be > 0 on the
  product-level test split; the verified subset (C1) is reported alongside and decides ties.
- GPU budget cut order if quota runs out: drop INP-Former first, then ITD and Real-IAD Variety runs; Dinomaly,
  baselines, WFDD, AITEX, ZJU-Leaper, MVTec textures are never cut.
- TILDA (64 px patches) dropped from the anomaly benchmark; used only for defect-type naming.
- Scanner host = the Mac M3 (MPS). Budget: fault stage adds ≤ 1.5 s per scan; if ViT-B misses it, use DINOv2 ViT-S
  for the scanner path (benchmarks still report ViT-B). Scanner fault result is labelled "close-up fabric" mode:
  photos where the garment box is small get `fault: null` with a reason instead of a guess.
- No relay hardware: the stream script writes events to a mock sink and latency is reported as software-only.

## 10c. User decisions (3 Nov) and what they change

- **Jury target (Part A):** beat the published AITEX mean image AUROC of 96.5 (Thomine & Snoussi, arXiv 2401.02287)
  at matched setting; at the frozen operating point catch ≥ 90 % of defective test images with ≤ 5 false alarms per
  1,000 good images; report ZJU-Leaper as a first published result. Misses are reported as misses.
- **Priority:** fault detection (Parts A + B) first; Part C runs alongside and is cut first.
- **No team data collection in the next 1–2 weeks:** C1 (new verified local_fabric subset) and C5 (own fabric photos)
  are dropped. Contribution 3 (own dataset) moves to future work. Part C is gated on the paired bootstrap over the
  existing product-level test split and labelled "measured on shop labels". Extra check: the same patch-texture
  features are also scored on the existing human-verified archive set (`runs/human_verify/round2/
  verified_conservative.csv`, 641 photos, two human judges, scanner-v8 macro-F1 0.886) so the texture-feature claim has
  one human-verified number.
- **Hardware: phone camera only, no relay.** Live demo = phone as camera (IP-camera app stream or recorded video) →
  `scripts/fault_stream.py` → on-screen alert + webhook event; stop signal is software-only and the latency reported
  excludes hardware. Real-floor robustness is measured with the perturbation suite (§1c) on benchmark test sets, plus
  phone video of whatever fabric is at hand during the demo.

## 11. Audit corrections (from agent reports, verified 3 Nov)

- `local_fabric` per-class F1 misquoted by the inventory agent; the values in §6 are read from the file.
- Forsberg carpet paper is arXiv 2407.18450 (not 2401.02287 = Thomine & Snoussi); research doc fixed.
- FMMC (arXiv 2603.17390) is an arXiv preprint, not CVPR; its models were trained on generated data.
- GLASS WFDD numbers not yet re-verified from the PDF (too large to fetch); must be checked before quoting.
