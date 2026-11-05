# TexPilot Fault Detection — Research, Product Strategy and Implementation Plan

Date: 2 Nov 2026 (v2). Status: brainstorm / for team + supervisor discussion. Nothing built yet.

## 0. One-paragraph summary (for the defence)

We do not train a fault detector from scratch. We build on open-source, permissively licensed, state-of-the-art
industrial inspection software (Intel **Geti** + **Anomalib**, both Apache-2.0) and published SOTA models
(**Dinomaly / Dinomaly2**, CVPR 2025; **MuSc**, ICLR 2024; **RF-DETR**, 2025), whose backbones were pre-trained on
**142 million+ images** (DINOv2). We benchmark them on roughly **700,000 public inspection images**, including about **130,000
textile and sewing images** (ZJU-Leaper, StitchingNet, Tianchi, ITD, TILDA, AITEX). Then we polish them into one product: any camera
on a production line → fault found and localised → machine stopped or flagged → result logged in TexPilot. The product
adapts to a new factory line from **8–200 photos of good product**, with no defect labelling (Dinomaly2 few-shot: 98.7 %
image AUROC on MVTec AD with 8 normal images per class). That is what makes it sellable.

## 1. Supervisor feedback

- Leave Yarnflow (ERP) as it is.
- Move the scanner to **fault detection in garments during production**, using any camera, so machines can be stopped.
- Feed the result back into the current scanner.

## 2. Why "use and polish", not "build"

| Question | Build our own | Use + polish (chosen) |
|---|---|---|
| Accuracy on day one | low, needs years of data | published SOTA (99 %+ AUROC on standard benchmarks) |
| Data needed per new factory | thousands of labelled defects | 8–200 good photos (anomaly) + optional labels for named defects |
| Labelling tool, training UI, camera pipeline, edge export | we write all of it | already in Geti / Anomalib Studio |
| Defensibility | "students trained a CNN" | "we integrated and benchmarked the 2025–26 SOTA on 700k images, then productised it" |
| Licence for selling | ours | Apache-2.0 / MIT — commercial use allowed |

Proof the market exists: **Smartex** (camera arrays on circular knitting machines that flag defects so the machine is stopped early;
raised US$24.7M; customer Tintex reports 7 rolls saved per machine per month). Other vendors: iFactory (stitch/seam/trim
inspection, claims 95–98 % at 20–60 garments/min, self-reported), WarpDriven (multi-camera denim defects).
None is aimed at the Pakistani garment/textile SME market at a low price. That is our gap.

## 3. Recommended stack (all licences checked)

### 3.1 Platform to build the product on
| Component | What it gives us | Licence | Link |
|---|---|---|---|
| **Intel Geti** (~1.4k★) | labelling (with SAM assist), training, detection/segmentation/classification (D-FINE, RF-DETR, DEIM-DETR...), **live USB/IP camera pipelines with webhook + MQTT sinks** (= machine-stop signal), OpenVINO export, INT8 quantisation, runs on CPU/Intel GPU/CUDA | Apache-2.0 (Windows app: Intel Simplified Licence; some Ultralytics models AGPL — avoid those) | https://github.com/open-edge-platform/geti |
| **Anomalib** v2.7.0 (~6.4k★) + **Anomalib Studio** (beta, no-code web app) | 30+ anomaly models (PatchCore, EfficientAD, Dinomaly, UniNet, INP-Former, GLASS, AnomalyVFM, RAD, FoundAD, WinCLIP...), heatmaps, OpenVINO/ONNX export | Apache-2.0 | https://github.com/open-edge-platform/anomalib |

### 3.2 Models
| Role | Model | Evidence | Licence |
|---|---|---|---|
| "Anything wrong?" — main engine (trained on good samples only) | **Dinomaly** (CVPR 2025) → **Dinomaly2** (arXiv 2510.17611) | Dinomaly: 99.6 / 98.7 / 89.3 % I-AUROC on MVTec AD / VisA / Real-IAD. Dinomaly2: 99.9 % MVTec, 99.3 % VisA; **8-shot 98.7 % MVTec**. Best multi-class method on Real-IAD Variety (160 classes). Its variant Dinomaly-m is the baseline on ADNet (380 classes). | Apache-2.0 (https://github.com/guojiajeremy/Dinomaly) |
| Day-one demo, zero training | **MuSc** (ICLR 2024) | zero-shot 97.8 % I-AUROC MVTec, 92.8 % VisA; no training, no prompts; 48–270 ms/img on RTX 3090 | MIT (https://github.com/xrli-U/MuSc) |
| Zero/few-shot alternative | AdaptCLIP (AAAI 2026), AnomalyDINO (WACV 2025), VisualAD (CVPR 2026) | 2-shot AdaptCLIP ≈ full-data Dinomaly+ on Real-IAD Variety | check each repo |
| Name the fault (hole, stain, broken stitch...) | **RF-DETR** (Roboflow) or D-FINE, both inside Geti | RF-DETR-L 56.5 COCO AP @ 6.8 ms T4, beats YOLO11x; RF-DETR-M +5 mAP over YOLO11-M on RF100-VL | Apache-2.0 (N–L sizes). **Not Ultralytics YOLO: AGPL-3.0 forces open-sourcing our product or buying a licence** |
| Stitch-level classifier on sewing machines | fine-tuned CNN/ViT on StitchingNet, or a new head on our SigLIP2 scanner encoder | published: MobileNet F1 0.990, F1 0.986 live in a garment factory on Raspberry Pi 4B | our code |
| Backbone (shared) | DINOv2 (pre-trained on 142M curated images) / our SigLIP2 | — | Apache-2.0 |

## 4. Data — big benchmark corpus (academic) vs product data (commercial)

### 4.1 Textile / sewing (domain-specific, ≈130k images)
| Dataset | Content | Images | Labels | Licence |
|---|---|---|---|---|
| **ZJU-Leaper** (IEEE T-AI 2020/21) | woven fabric, 19 patterns, 5 task settings | **98,777** | none / class / box / mask | academic; download via project site (qaas.zju.edu.cn/zju-leaper) — confirm terms |
| **StitchingNet** (JCDE 2025) | sewing stitches, 10 defect types + normal, 11 fabrics | **14,565** | class | CC BY-NC 4.0 |
| **Tianchi fabric** (Alibaba) | 20 defect classes incl. holes, water/oil/dirt stains, knots, colour shading; 2446×1000 px | **9,576** (5,913 defect) | boxes (YOLO/COCO) | not found — check Tianchi page |
| **Industrial Textile Dataset** (Thomine 2023) | real factory fabric, industrial cameras | 5,662 | good / anomaly | **MIT** |
| **TILDA** | textile, 8 classes | 3,200 | class | research |
| **AITEX** | 7 fabrics, 12 defects, masks | 245 large (tiles to thousands) | mask | check |
| IEEE DataPort "Real-world textile AI dataset" (2026) | broken pick, hole, missing pick, thick weft | n/a | class | subscription |

### 4.2 General industrial anomaly (scale + generalisation, ≈570k images; ADNet overlaps some others)
| Dataset | Images | Classes | Licence |
|---|---|---|---|
| **Real-IAD Variety** (2025) | **198,960** | 160 categories, 28 industries (incl. fabric and clothing-supplies) | not yet stated |
| **ADNet** (2025) | **196,294** | 380 categories from 49 datasets (incl. AITEX textile) | per source, academic |
| **Real-IAD** (CVPR 2024) | **~150,000** | 30 objects, 5 views | CC BY-NC-SA 4.0, gated |
| MVTec AD + AD 2 | ~5,400 + 8,000 | incl. carpet, leather textures | CC BY-NC-SA 4.0 |
| VisA | ~10,800 | 12 | CC BY 4.0 |

### 4.3 The licence rule (must say this in the defence)
Most big research datasets are **non-commercial** (NC). So:
- **FYP / defence:** benchmark and compare models on all of the above (≈700k images). This shows the approach works at scale.
- **Product we sell:** the weights we ship are trained on **(a) our own factory data** and **(b) permissive data only** (ITD — MIT; VisA — CC BY; anything else after its licence is confirmed).
  The anomaly approach needs only good-product photos, which each customer produces in minutes. This is the core business advantage, not a workaround.
- Dataset 4.4 below is our own long-term moat.

### 4.4 Our own dataset (start now)
- Partner with 1–2 Karachi garment/textile factories (pilot). Fixed camera + light at one station.
- Collect: good items continuously (free), every defect the QC staff already rejects (photo + their label).
- Target by end of FYP: 20k+ images from real lines. This becomes **TexPilot-Fault**, our own dataset (possible paper contribution).

### 4.5 How to get each dataset for training (checked 2 Nov 2026)

All training runs on Kaggle GPUs. Datasets already on Kaggle are attached to the notebook directly, with no download to the laptop.

**Tier 1: on Kaggle now, attach and train (no sign-up)**
| Dataset | Kaggle ref | Size | Notes |
|---|---|---|---|
| ZJU-Leaper (98,777) | `bnhphan/zju-dataset` | 6.8 GB | full set incl. `Annotations/masks`; community mirror, cite the original paper |
| StitchingNet (14,565) | `hyungjung/stitchingnet-dataset` | 0.6 GB | **official** (uploaded by the author) |
| MVTec AD (5,354) | `ipythonx/mvtec-ad` | 5.3 GB | mirror; 46k downloads |
| VisA (10,821) | `ess1004/visa-anomaly-detection` | 1.9 GB | mirror |
| WFDD — Woven Fabric Defect Detection (4,101; GLASS, ECCV 2024) | `hodinhtrieu/the-woven-fabric-defect-detection-wfdd` | 0.7 GB | MVTec layout + masks |
| AITEX | `nexuswho/aitex-fabric-image-database` | 0.2 GB | masks |
| TILDA | `angelolmg/tilda-400-64x64-patches` | 0.15 GB | 64×64 patches |
| Textile Defect Detection | `belkhirnacim/textiledefectdetection` | 3.7 GB | grey 32/64 px patches with rotations, "educational"; low realism, pre-training only |

**Tier 2: Hugging Face, auto-approved gate (log in, click "Agree", access is instant)**
| Dataset | HF repo | Licence | Notes |
|---|---|---|---|
| Real-IAD (~150k) | `Real-IAD/Real-IAD` | CC BY-NC-SA 4.0 | has `realiad_256` / `realiad_512` / `realiad_1024` resized copies; use 256/512 (raw is very large) |
| Real-IAD Variety (198,960) | `Real-IAD/Real-IAD_Variety` | see its LICENSE.txt | raw only |
| Real-IAD D³ | `Real-IAD/Real-IAD_D3` | CC BY-NC-SA 4.0 | 2D/3D; optional |

How: inside the Kaggle notebook, `huggingface_hub.snapshot_download(...)` with an HF read token stored as a Kaggle secret. Save the
resized version as a **private Kaggle dataset** once, then attach it to every later run.

**Tier 3: request approval (send a short form/email from the IBA email, mention FYP + supervisor)**
| Dataset | Where | Approval |
|---|---|---|
| ADNet (196,294; 380 classes) | HF `linglingling009/ADNet` (gate = manual) | authors approve |
| MVTec AD 2 (8,000+) | mvtec.com/company/research/datasets/mvtec-ad-2 (form) | download link by email; test GT is private (evaluation server) |
| Tianchi fabric (9,576) | tianchi.aliyun.com/dataset/79336 (Aliyun account) | or Roboflow mirror `universe.roboflow.com/fufu-gg4dy/smart-diagnosis-of-cloth-flaw` |
| Industrial Textile Dataset (5,662) | Google Drive link in github.com/SimonThomine/IndustrialTextileDataset | open (MIT) — upload once as private Kaggle dataset |

Access status 2 Nov 2026: university HF account `anastabba7` has Real-IAD + Real-IAD Variety; ADNet awaiting author review.
On Kaggle (account `anastabba`, attach as `kernel_sources`): `anastabba/texpilot-get-realiad` (Real-IAD 512 px, 30 categories,
15 GB, zips) and `anastabba/texpilot-get-variety` (7 garment-related Variety categories, 8.2 GB, zips).
Measured sizes: Real-IAD `realiad_256` 4.3 GB, `realiad_512` 15.2 GB, `realiad_1024` 57.8 GB; Real-IAD Variety raw 281.5 GB
(160 zips; garment-related: `flower_velvet_fabric` 0.94, `long_zipper` 1.52, `side_release_buckle` 2.22, `bag_buckle` 0.84,
`ingot_buckle` 1.63, `tension_snap_release_clip` 0.8, `brooch_clasp_accessory` 0.79 GB); ADNet 91.2 GB in 5 zips
(Industry 31.2 GB holds the textile sources). Real-IAD Variety licence: CC BY-NC-SA 4.0.
Plan: Real-IAD 512 + Variety garment subset (~8 GB) + ADNet Industry → private Kaggle datasets.

Total reachable: ≈700k images, of which ≈136k textile/sewing (ZJU-Leaper, StitchingNet, Tianchi, ITD, WFDD, TILDA, AITEX).

## 5. Where the camera goes (stations)

| Station | Faults | Machine we can stop | Best data | Fit |
|---|---|---|---|---|
| A. Fabric inspection / spreading / cutting table | holes, stains, weave faults, shade | inspection machine, spreader, conveyor | ZJU-Leaper, Tianchi, ITD, TILDA | most data; simplest optics (flat fabric) |
| B. Sewing machine (needle area) | skipped/broken stitch, puckering, needle marks | the sewing machine (StitchingNet setup) | StitchingNet | strongest published result (F1 0.986 in factory) |
| C. End-of-line finished garment | stains, holes, open seams, missing trims | conveyor / reject gate | own data needed | hardest (3D garment, folds); highest value per item |

Proposed order: **A + B for the FYP**, C as a product extension after the pilot data exists.

## 6. System architecture (product)

```
camera (phone / USB / IP, RTSP) 
  -> Geti pipeline: frame sampling + tiling
     -> Anomaly model (Dinomaly2, trained on good samples of THIS line)  -> score + heatmap
     -> Detector (RF-DETR, optional) -> defect name + box
  -> Decision: fault on N consecutive frames AND score > threshold (two-model confirm, as in US 12,394,033 B2)
  -> Sinks: webhook / MQTT
       -> ESP32 / Raspberry Pi relay -> stack light + buzzer, machine STOP input (only with factory electrician; relay can only stop, never start)
       -> TexPilot scanner API -> fault log, photos, per-machine fault rate dashboard
```

Existing TexPilot scanner (SigLIP2 + 6 heads, FastAPI) keeps doing fabric/garment identification; fault results appear next to it in the app.

## 7. Implementation plan (draft)

| Phase | Work | Output / gate | Time |
|---|---|---|---|
| 0 | Decide stations; contact pilot factory; licence check (ZJU-Leaper, Tianchi, Real-IAD Variety, ADNet) | written decisions | 3 days |
| 1 | Benchmark (Kaggle GPU): MuSc zero-shot, PatchCore, EfficientAD, Dinomaly, Dinomaly2 on textile sets (ITD, ZJU-Leaper, AITEX, MVTec carpet/leather) + StitchingNet classifier | table: image AUROC, pixel AUPRO, F1 at chosen threshold, ms/frame on CPU and GPU | 2 weeks |
| 2 | RF-DETR (Apache) fine-tuned on Tianchi + ZJU-Leaper boxes for named defects; compare with Dinomaly heatmap-only | mAP@0.5, per-class recall, ms/frame | 2 weeks |
| 3 | Product base: Geti + Anomalib Studio installed; live camera pipeline; webhook to our API; relay box | demo: defect under camera → light/buzzer < 1 s | 1–2 weeks |
| 4 | Pilot at factory: collect good + defect data, few-shot retrain on that line, measure **false stops per hour** and missed faults | pilot report — the number buyers care about | 3–4 weeks |
| 5 | Polish: TexPilot app screen (live fault feed, heatmap, per-machine fault rate), installer, operator guide | sellable v1 | 2 weeks |

## 8. Risks (honest)

- Benchmark AUROC ≠ factory performance. Real-IAD Variety (160 classes) drops SOTA to ~81 % I-AUROC; the MVTec AD 2 hard set stays below 60 % AU-PRO. A low-cost two-stage fabric system (arXiv 2608.14727) caught all 20 defects but had a **49 % false-positive rate**. False stops will kill adoption, so Phase 4 measures them.
- Garment colour/fabric shift: a 2026 garment sewing-line paper (arXiv 2608.21426) trained on black fabric failed on light blue, silver and fluorescent fabrics. So we need few-shot retraining per line, which is why the anomaly approach is the core.
- Licences: NC datasets must not reach shipped weights; Ultralytics YOLO (AGPL) must not ship.
- Machine stop is a safety function: demo uses light/buzzer; real stop only through the factory's existing stop circuit with their approval.

## 9. Open questions

1. Which station(s) first: fabric table (A), sewing machine (B), end-of-line (C)?
2. Do we have a factory contact for a pilot (Karachi / Faisalabad / Lahore)?
3. Hardware target for v1: laptop, mini-PC with Intel iGPU (Geti-optimised), Jetson, or Raspberry Pi?
4. Demo stop: relay + light/buzzer, or a real machine?

## 10. Credits (will appear in report + README)

- Intel Geti — open-edge-platform, Apache-2.0. https://github.com/open-edge-platform/geti
- Anomalib — Akcay et al., ICIP 2022, Apache-2.0. https://github.com/open-edge-platform/anomalib
- Dinomaly — Guo et al., CVPR 2025, Apache-2.0. https://github.com/guojiajeremy/Dinomaly ; Dinomaly2 — arXiv 2510.17611
- MuSc — Li et al., ICLR 2024, MIT. https://github.com/xrli-U/MuSc
- RF-DETR — Roboflow, Apache-2.0 (N–L). https://github.com/roboflow/rf-detr
- DINOv2 — Oquab et al., TMLR 2024, Apache-2.0. https://github.com/facebookresearch/dinov2
- AnomalyCLIP — Zhou et al., ICLR 2024. https://github.com/zqhang/AnomalyCLIP ; AdaCLIP — Cao et al., ECCV 2024. https://github.com/caoyunkang/AdaCLIP
- StitchingNet — Jung, Kang, Kwon, Kim, J. Comput. Des. Eng. 12(4):140–154, 2025, doi:10.1093/jcde/qwaf037, CC BY-NC 4.0. https://github.com/hyungjungkim/StitchingNet-dataset
- ZJU-Leaper — Zhang, Feng, Wang, Wang, IEEE T-AI 1(3):219–232, doi:10.1109/TAI.2021.3057027. https://github.com/nico-zck/ZJU-Leaper-Dataset
- Industrial Textile Dataset — Thomine & Snoussi, Textile Research Journal 2023, MIT. https://github.com/SimonThomine/IndustrialTextileDataset
- Tianchi fabric defect dataset — Alibaba Tianchi. https://tianchi.aliyun.com/dataset/79336
- Real-IAD — Wang et al., CVPR 2024 (Tencent), CC BY-NC-SA 4.0. https://github.com/Tencent/AnomalyDetection_Real-IAD ; Real-IAD Variety — arXiv 2511.00540
- ADNet — Ling et al., arXiv 2511.20169. https://grainnet.github.io/ADNet
- MVTec AD — Bergmann et al., CVPR 2019; MVTec AD 2 — arXiv 2503.21622 / IJCV 2026. CC BY-NC-SA 4.0
- VisA — Zou et al., ECCV 2022, CC BY 4.0
- WFDD — Chen et al., "A Unified Anomaly Synthesis Strategy with Gradient Ascent for Industrial Anomaly Detection and Localization" (GLASS), ECCV 2024. https://github.com/cqylunlun/GLASS

## 11. Papers read

Full or results sections: StitchingNet (JCDE 2025); Dinomaly (CVPR 2025); Dinomaly2 (arXiv 2510.17611); MuSc (ICLR 2024);
Real-IAD Variety (arXiv 2511.00540); ADNet (arXiv 2511.20169); Low-cost two-stage fabric detection at the edge (arXiv 2608.14727);
AI Visual Inspection for Garment Production (arXiv 2608.21426).
Abstracts / summaries: AnomalyCLIP, AdaCLIP, PA-CLIP, AnomalyDINO (WACV 2025), AdaptCLIP (AAAI 2026), VisualAD (CVPR 2026),
MVTec AD 2, Improved YOLOv8 fabric (Appl. Sci. 2025), FD-YOLO (CMC 2025), YOLOv1–v11 fabric review (Sensors 2025),
carpet anomaly evaluation (Forsberg et al., arXiv 2407.18450), US patent 12,394,033 B2 (loom inspection with confirm-then-stop),
RF-DETR docs, Geti and Anomalib docs, Smartex coverage.

Still to verify before training: licences of ZJU-Leaper, Tianchi, Real-IAD Variety, ADNet; ZJU-Leaper download availability.

## 12. Low-cost webcam fabric inspection (added 3 Nov)

- Randitha & Rusitha, "Fabric Inspection using Computer Vision", Research Square preprint 2025 (doi:10.21203/rs.3.rs-5498346/v1):
  YOLOv8 on **Logitech C270** webcam images, FastAPI web app, fault-rate grading; classes hole, foreign yarn, slub, dirty
  mark, dye patch, oil patch; YOLOv8 beat VGG/ResNet. Metrics not read (full text not reachable). Abstract-level only.
- Gonzales, Sabino, Ugarte, "Intelligent Web Application with Computer Vision Algorithms for Detecting Flaws and Damage on
  Fabric in the Textile Industry", FRUCT 38 (2025, Peru): YOLOv8 / YOLOv8-OBB, 2,404 images augmented to 6,000+ (public +
  own photos), holes / lines / stains, best mAP@0.5 0.954 (single-label OBB); one camera + web app + cloud backend; live video
  and production deployment left as future work. Full text read (pdftotext). Camera model not named in the parts read.
- Akbar et al., "Real-Time Fabric Defect Detection Using Machine Vision and Neural Networks", ICCIT 2025 (Malaysia/Indonesia):
  low-cost webcam on a moving conveyor, 97.4 % accuracy, 156 ms per inspection; dataset, classes, camera model not stated.
  Repository abstract only (shdl.mmu.edu.my/14724).
- Gap vs ours: all are supervised detectors limited to 3–6 trained defect types, tested on their own small sets, with no
  false-alarm rate, no unseen-defect handling and no live production validation.
