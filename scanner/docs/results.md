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
The WFDD table has no evidence path: the WFDD images were not on the machine used for this update, so it was not re-run (the figures are from the earlier measurement).
The rule that judged each photo is returned as `reference` (`trained` or `self_relative`). On real uploads, see the next section.
No labelled real-garment defect set exists, so accuracy on real garments is not measured.
(The earlier "195 real garment scans" figure was not deduplicated and had no evidence path; it is replaced below.)

## Calibration of the structure head (catalogue photos)

Served structure head (`models/scanner-v8` Head A), TextileNet catalogue test split, evidence
`docs/agent1-abstain-results.md`: coverage 0.8201, accuracy of answered photos 0.8952, macro F1 of answered photos 0.8540.
Test ECE 0.0567 uncalibrated (T=1), 0.0214 with T fitted on validation.

## Real uploaded photos (coverage, not accuracy)

Photos uploaded to the scanner by app users. These are not catalogue photos and no human labels exist yet, so this
section measures how often each head answers, not whether it is right.
Evidence: `scanner/runs/real_uploads/2026-11-22/` (`coverage.md`, `coverage.json`, `run_info.json`; gitignored, not in git).
Run: scanner-v8 with the fault model `fault-wfdd-v1`, photo only (no label text), CPU, 21 Nov 2026.

- 135 unique uploads; 10 excluded as web formats (6 PNG, 4 WEBP); 125 evaluated; 118 near-duplicate groups; 0 scanner errors.
- Sources of the 125: 2 camera photos with EXIF, 123 in-app JPEGs without EXIF. The in-app camera strips EXIF, so
  the 123 may be phone photos but this cannot be proved from the files. Do not call them "phone photos" without this caveat.
- Counts are per image; near-duplicates make them correlated.

Answer rate (answered / 125):

| Head | Answered | Rate | Catalogue reference |
|---|---:|---:|---|
| structure | 50 | 40.0% | 0.8201 coverage, catalogue test (`docs/agent1-abstain-results.md`) |
| fibre_family | 37 | 29.6% | none |
| treatment | 0 | 0.0% | none |
| garment | 97 | 77.6% | none |
| custom.blend | 98 | 78.4% | none |
| custom.fibre | 3 | 2.4% | none |
| custom.finish | 102 | 81.6% | none |
| custom.garment_type | 98 | 78.4% | none |
| custom.local_fabric | 55 | 44.0% | none |
| custom.mix | 60 | 48.0% | 53.2% answers given, catalogue test (table above) |

Fault check by rule (the flag rate is within each bucket; it is not a false-alarm rate, because no photo is labelled):

| Rule | n | Flagged |
|---|---:|---:|
| self_relative (fabric unlike WFDD) | 121 | 13 (10.7%) |
| trained (WFDD-like fabric) | 1 | 1 (100%) |
| skipped | 3 | none |

Composition is not measurable here: only 2 photos came with label text.

Labels pending: there is no real-photo accuracy yet. To get one, a person labels the photos blind
(`cd scanner && ../.venv/bin/python scripts/label_sheet.py --out runs/real_uploads/2026-11-22`, then save the downloaded CSV in `labels/`)
and `scripts/eval_real_set.py --out runs/real_uploads/2026-11-22` scores it from human labels only.
Rebuild the report with `scripts/real_uploads.py triage|rerun|report`.

## Other evaluations

No factory-phone test result is available in this document. OCR exact-match accuracy is not reported here. The detector and yarn-count measurement do not have results in these tables.
