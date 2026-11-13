# Dinomaly full A2 results — 13 November 2026

## Runs

Both private Kaggle full runs completed successfully at 10,000 AMP optimizer steps. They use the same Dinomaly ViT-B code snapshot (private code dataset v7), seed 2026, unified mode, batch size 16, and 392-pixel tiles with 25% overlap on a Tesla T4.

| Dataset | Kernel | Train tiles | Test images | Test tiles | Fit | Total wall |
|---|---|---:|---:|---:|---:|---:|
| MVTec AD textures (carpet, grid, leather, tile, wood) | `anastabba/texpilot-a2-mvtec-amp-10k`, v1 | 16,807 | 515 | 7,421 | 11,484 s | 12,089 s (3.36 h) |
| WFDD (grey_cloth, grid_cloth, pink_flower, yellow_cloth) | `anastabba/texpilot-a2-wfdd-amp-10k`, v1 | 13,176 | 444 | 1,776 | 10,583 s | 11,099 s (3.08 h) |

Both inventories, masks, resource guards, completion markers, output manifests and source hashes passed in the kernels. The recorded device is one Tesla T4 per run. These results do not measure the later prepared DDP/two-GPU implementation.

## Aggregate metrics

Metrics are unweighted means across the five MVTec or four WFDD categories. They use each benchmark's held-out images and masks, not factory samples.

| Dataset | Macro image F1 | Macro image AUROC | Macro pixel AUROC | Macro AUPRO |
|---|---:|---:|---:|---:|
| MVTec textures | **0.9590** | 0.9957 | 0.9887 | 0.9780 |
| WFDD | **0.8999** | 0.9437 | 0.9917 | 0.9477 |

## Per-category results

| Dataset | Category | F1 | Image AUROC | Pixel AUROC | False alarms / 1,000 good test images | Good / defect test images |
|---|---|---:|---:|---:|---:|---:|
| MVTec | carpet | 0.948 | 0.984 | 0.985 | 71.4 | 28 / 89 |
| MVTec | grid | 0.898 | 1.000 | 0.997 | **619.0** | 21 / 57 |
| MVTec | leather | 0.974 | 1.000 | 0.997 | 156.2 | 32 / 92 |
| MVTec | tile | 1.000 | 1.000 | 0.984 | 0.0 | 33 / 84 |
| MVTec | wood | 0.976 | 0.995 | 0.980 | 157.9 | 19 / 60 |
| WFDD | grey_cloth | 0.975 | 1.000 | 0.990 | 142.9 | 21 / 59 |
| WFDD | grid_cloth | 0.973 | 1.000 | 0.993 | 54.5 | 55 / 55 |
| WFDD | pink_flower | **0.667** | **0.776** | 0.999 | **562.5** | 32 / 32 |
| WFDD | yellow_cloth | 0.984 | 0.999 | 0.985 | 21.1 | 95 / 95 |

## Interpretation and limits

MVTec scores higher on macro image F1 and image AUROC; WFDD is a different source domain and its macro pixel AUROC is slightly higher. The results are not a controlled cross-dataset ranking of real factory fabric. WFDD `pink_flower` is a clear weakness. MVTec `grid` also has a high false-alarm rate despite AUROC 1.0, illustrating why AUROC alone does not establish an acceptable operating threshold.

Per-category held-out test sets are small, and thresholds were selected within the benchmark's calibration protocol. The false-alarm rates have wide uncertainty. These benchmarks do not establish phone capture robustness, a factory false-accept bound, purchase-order acceptance performance, or deployment readiness. Automatic decisions remain disabled pending the independent evidence and external gates in the incoming-fabric QC design.

## Reproducibility artifacts

Each completed private kernel retains `log.txt`, `index.csv`, `inventory.json`, `provenance.json`, `resource-summary.json`, `output-manifest.json`, and the full per-category result JSON. Kaggle's kernel output contains those files. The code/data bindings and artifact hashes are recorded in `provenance.json` and `output-manifest.json` in each run; the raw kernel outputs are retained on Kaggle rather than copied into this source repository.
