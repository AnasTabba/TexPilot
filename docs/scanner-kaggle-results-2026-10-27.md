# Completed Kaggle scanner runs — 27 October 2026

All four original notebook versions were freshly confirmed COMPLETE using their authenticated Kaggle accounts. Downloaded result archives are preserved under `runs/completed_20261027/` (ignored local artifacts). No model has been promoted by this review.

## Ensemble decision

Keep scanner-v8. The predeclared rule chooses on validation, then requires a meaningful held-out macro-F1 gain (approximately 0.005). The selected candidate is `avg(v8/final, v8/b12, v7/final)`, with weights [0.2, 0.3, 0.5].

| Candidate | Validation macro F1 | Test macro F1 | Test top-1 |
| --- | ---: | ---: | ---: |
| Current v8 | 75.5714% | 76.1889% | 82.3904% |
| Validation-selected ensemble | 77.6142% | 75.8727% | 82.7045% |

The selected ensemble improves validation but loses held-out macro F1. Its top-1 gain does not satisfy the predefined criterion. Some other candidates score better on test, but choosing one after inspecting test would contaminate model selection; those observations need a new independent evaluation, not deployment. The downloaded depth archive contains metrics/logs, not the intermediate head weights required to serve a winning ensemble.

## Shop heads

Same shop product-level split as the preserved v7 reports; these are shop-photo benchmarks, not measured factory accuracy.

| Head | v7 validation F1 | v8 validation F1 | v7 test F1 | v8 test F1 | v8 test top-1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| local_fabric | 58.61% | 61.30% | 58.22% | 60.39% | 62.55% |
| blend | 49.17% | 51.68% | 50.91% | 51.02% | 76.94% |
| finish | 80.06% | 81.12% | 81.19% | 82.44% | 85.61% |
| garment_type | 78.19% | 80.02% | 77.27% | 79.02% | 82.26% |
| mix | 41.47% | 45.45% | 44.20% | 48.31% | 73.34% |

All five improve both validation and held-out macro F1. Blend’s macro-F1 improvement is marginal (0.11 percentage points). Exported weights were retrieved; serving compatibility and an end-to-end scan are still required before promotion.

## Fibre head

The ordinary linear recipe wins over square-root sampling on mean validation macro F1 in both runs. Three-seed means for that recipe:

| Encoder | Validation macro F1 | Test macro F1 | Test top-1 |
| --- | ---: | ---: | ---: |
| v7 | 48.82% | 52.91% | 59.45% |
| v8 | 51.29% | 55.35% | 60.21% |

This is the 33-class archive fibre benchmark, distinct from the three-family head. The exported v8 probe is downloaded but not installed.

## Job records

- `anastabba/texpilot-depth-ensemble/1`: COMPLETE; metrics and logs retrieved.
- `anastabba/texpilot-fabric-feats/1`: COMPLETE; v8 and public-384 extraction logs retrieved. Diagnostic linear probes score 71.93% and 65.51% test macro F1 respectively; these are not the deployed MLP recipe. Cache shards remain remote and need completeness checks before a follow-up training job.
- `yaseenazhar/texpilot-fibre-head-v8/1`: COMPLETE; both recipes, three seeds and exported probes retrieved.
- `yaseenazhar/texpilot-shop-heads-v8/2`: COMPLETE; five exported heads retrieved. Version 1’s historical failure was already superseded.

Pattern-head and label-cleaning follow-up notebooks are separate experiments; this review did not submit new training jobs.
