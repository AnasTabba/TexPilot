# TexPilot results

All benchmark results below use the TextileNet catalog test split. They do not measure factory-phone performance.

## Fabric structure

| Model | Test macro F1 | Test top-1 accuracy | Test n | Evidence |
|---|---:|---:|---:|---|
| Frozen DINOv2 ViT-B/14 linear probe, mean ± SD over 3 seeds | 0.5449 ± 0.0019 | 74.48% ± 0.03% | 40,970 per seed | `runs/fabric/probe_dinov2_vitb14/seed*/test_metrics.json` |
| Scanner-v8 DINOv2 linear structure head | 0.5428 | 74.45% | 40,970 | `models/scanner-v8/bundle.json` |
| Scanner-v8 installed SigLIP Head A, 24 classes | 0.7666 | 82.22% | 24,303 | `models/scanner-v8/head_a/head.json` |

## Fibre

| Model | Test macro F1 | Test top-1 accuracy | Test n | Evidence |
|---|---:|---:|---:|---|
| Frozen DINOv2 ViT-B/14 linear probe, mean ± SD over 3 seeds, 33 classes | 0.3530 ± 0.0020 | 58.45% ± 0.04% | 47,805 per seed | `runs/fibre/probe_dinov2_vitb14/seed*/test_metrics.json` |
| Scanner-v8 fibre-family head, 3 classes | 0.7326 | 74.47% | 47,805 | `models/scanner-v8/bundle.json` |

The 27-class DINOv2 structure head and the 24-class installed Head A are different models and test sets; their figures should not be combined. Class lists and metric definitions are in the cited model artifacts.

## Composition from the photo (installed `models/custom/mix`, 18 Nov 2026)

Shop product photos from 21 Shopify stores, labels from each product's stated composition,
split by product (70/15/15). Test: 5,954 photos of 1,560 products never seen in training.
Old = the previous 19-class mix head, its answers mapped to the same groups.

| Model | Test macro F1 | Test top-1 | Polyester F1 | Answers given | Right when answering |
|---|---:|---:|---:|---:|---:|
| Previous mix head | 0.395 | 56.1% | 0.529 | 44.1% | 64.9% |
| Installed 8-group head | **0.714** | **76.3%** | **0.719** | 53.2% | 91.1% |

Per group F1: nylon 0.84, acrylic 0.82, cotton 0.82, linen 0.74, polyester 0.72, wool 0.71,
cotton/polyester 0.67, viscose 0.39. Evidence: `runs/kaggle/mix_groups/refit_linen/mix_groups_results.json`.
Shop labels were not hand-checked, and these are catalogue photos, not phone photos.

## Fault check (served `models/fault-wfdd-v1`)

WFDD test split, 444 photos (241 defect, 203 good), with the served rule (fixed threshold
0.118 on WFDD-like fabric; per-photo relative rule otherwise).

| Measure | Value |
|---|---:|
| Macro F1 (good and defect) | **0.871** |
| Defect F1 | 0.876 |
| Defect recall | 83.8% |
| False alarms per 1,000 good | 88.7 (all from pink_flower) |
| Image AUROC (peak score) | 0.972 |

Per category macro F1: grid_cloth 0.927, yellow_cloth 0.921, grey_cloth 0.871, pink_flower 0.598.
On 195 real garment scans the plain threshold flagged all 195; the relative rule flags 11 (5.6%).
No labelled real-garment defect set exists, so accuracy on real garments is not measured.

## Other evaluations

No factory-phone test result is available in this document. OCR exact-match accuracy is not reported here. The detector and yarn-count measurement do not have results in these tables.
