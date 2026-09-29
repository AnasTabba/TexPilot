# TexPilot results

_Generated 2026-09-29 by `training/scanner/results.py` from the runs and models on the Mac. Every number states its domain (catalog or phone) and n._

## 1. Catalog benchmark: TextileNet (domain: catalog)

Full tables, per-class results and caveats go to `training/textilenet/results.md`, written by `training/textilenet/aggregate.py` after the benchmark run, including the train images dropped for leaking into test.

| Partition | Selected (best mean val top-1) | Test top-1 | Seeds | Test n | Best published | Δ top-1 |
|---|---|---|---|---|---|---|
| fabric | probe_dinov2_vitb14 | 74.48 ± 0.03 | 3 | 40,970 | ViT-Tiny/16, scratch: 67.32 | +7.16 |
| fibre | probe_dinov2_vitb14 | 58.45 ± 0.04 | 3 | 47,805 | ViT-Tiny/16, scratch: 53.32 | +5.13 |

## 2. Scanner heads (domain: catalog; calibrated on val, reported on test)

Coverage is the share of val images a head answers at its 90% accuracy target; below that it abstains.

| Bundle | Head | Test top-1 | Test n | Val coverage | Val ECE before → after |
|---|---|---|---|---|---|
| scanner-v1 | structure | 0.720 | 40,970 | 49% | 0.077 → 0.013 |
| scanner-v1 | fibre_family | 0.725 | 47,805 | 34% | 0.041 → 0.012 |
| scanner-v2 | structure | 0.744 | 40,970 | 58% | 0.086 → 0.012 |
| scanner-v2 | fibre_family | 0.745 | 47,805 | 44% | 0.048 → 0.009 |

## 3. Garment detector B: RT-DETRv2 on Fashionpedia (domain: catalog)

_Not measured yet: training/detector/run_cloud.sh has not run._

## 4. Fine-tuned Head A, as exported (domain: catalog)

_Not measured yet: run_all.sh headA has not run._

## 5. The scanner on the team's phone photos (domain: phone)

_Not measured yet: the phone set (due Oct 4) and the bake-off._

