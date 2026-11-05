# Scanner garment check and context prior experiment

## Scanner diagnostic

Ran the scanner's actual OWLv2 detector and v8 encoder/custom garment head,
sequentially on the Mac with two CPU threads and existing inference memory caps.
The inference functions, whole-photo preprocessing and installed thresholds were
reused; the API, inventory ledger, OCR and consistency engine were not invoked.
No live model or threshold was changed.

The frozen sample contains **102 validation images from 95 DeepFashion2 products**,
50 shop and 52 consumer images. Selection was deterministic, up to four distinct
products per original garment category and source domain, restricted to images
with exactly one annotated clothing item and a valid box. Other unannotated
garments can still be visible. This is a small stratified diagnostic, not the
full dataset, a factory benchmark, or a new independent test set.

| Measurement | Result |
| --- | ---: |
| Detector primary box IoU >= 0.5 against annotated item | 99/102, **97.1%** |
| Detector primary coarse garment type accuracy | 54/102, **52.9%** |
| Detector coarse macro F1, seven groups | **43.46%** |
| Any above-threshold detection with correct coarse type and IoU >= 0.5 | 61/102, **59.8%** |
| Detector coarse type accuracy on shop images | 32/50, **64.0%** |
| Detector coarse type accuracy on consumer images | 22/52, **42.3%** |
| Custom garment head coarse accuracy, supported groups | 49/86, **57.0%** |
| Custom garment head coarse macro F1, supported groups | **50.87%** |

The mapping was specified before inference: tops, outerwear, vest, shorts, pants,
skirt and dress. DeepFashion2 sleeve-length distinctions are collapsed. The custom
head has no vest/skirt classes; those 16 examples are disclosed as unsupported,
not silently counted as supported labels. Its other unsupported predictions
remain errors. On the supported cohort it answered 69/86 photos, with 43/69
correct (**62.3%**). This is below its historical shop-domain accuracy target.
Neither localization rate nor coarse classification is COCO detection mAP.

Fabric predictions were recorded but cannot be verified here: DeepFashion2 does
not supply the corresponding fabric ground truth. No automatic relabeling was
performed.

## Garment fabric associations in existing training metadata

Retrieved only `shops/all_manifest.csv` from the existing shop-scrape run. Counts
below use one vote per product and the original training split only, with the
same title-derived garment rules as the installed custom-head recipe. These are
supplier-text labels, not independent textile-expert verification.

| Garment | Evidence among products with a fabric label |
| --- | --- |
| Jeans | Denim in **362/365**, 99.2% |
| Kurta | Lawn in **130/293**, 44.4% |
| Generic T shirt | Knit in **260/367**, 70.8% |
| Dress | Most common label linen in **40/143**, 28.0% |

Among generic T shirts with a main-fibre label, **956/980** were cotton and 22
polyester. This does not describe a sportswear-only cohort. It demonstrates why
garment names do not determine composition. Several labels mix fibre and fabric
terminology, which also limits their use as physical ground truth.

## Implemented bounded probabilistic context pilot

Kaggle CPU-only job: `yaseenazhar/texpilot-context-prior-pilot/2`, COMPLETE.
No licensed DeepFashion2 images were uploaded. The job reused existing remote
shop features and metadata. Source and both installed custom-head weights were
checked against SHA-256 hashes. Feature paths were checked against the complete
manifest, including multiplicities. Fifteen identical duplicate source records
were preserved to match the historical benchmark; conflicting duplicates fail.
Version 1 stopped at that duplicate check without evaluating a candidate.

The pilot concerns the **17-class local_fabric shop head**, not the 24-class
archive fabric score. It builds a conditional fabric prior from **11,085
training products** having both supported labels, smoothed toward the training
marginal with strength 20. It uses the garment head's full predicted probability
distribution, rather than oracle garment labels or a hard override:

`adjustment(f) = log(sum_g P_model(g | image) * P_train(f | g) / P_train(f))`

The visual log-probability receives `alpha * adjustment`. The predeclared alpha
grid was `{0, 0.25, 0.5}`, including unchanged baseline. Two-fold product-grouped
validation selects on the opposite fold; no image from a product crosses folds.
The acceptance rule requires pooled cross-fit macro-F1 gain >= 0.005 and no
supported class (validation n >= 30) losing more than 0.05 F1.

| Alpha | Validation macro F1, n = 8,645 |
| --- | ---: |
| 0, unchanged | **0.658090** |
| 0.25 | 0.655510 |
| 0.5 | 0.652121 |

Both folds selected alpha 0. Pooled gain is **0.000000**, so the gate **failed**.
No candidate test evaluation was performed, no further grid was attempted, and
no context prior was installed. This rejects this adjustment, not all possible
context-learning approaches. It establishes no improvement toward 0.89 F1.

## Artifacts and reproduction

Ignored `runs/deepfashion2/scanner_check/` contains the frozen `sample.json`,
`detector.jsonl`, `head.jsonl`, per-component summaries, source script, model and
input provenance, `context_associations.json`, and
`cloud_result/context_pilot_result.json`. The result JSON was recovered from
authenticated completed-run stdout because the output download hit a DNS error;
raw logs and retrieval provenance are retained beside it. The Kaggle launch snapshot is under
`runs/kaggle/context_prior_pilot/`. The incomplete local feature download was
stopped when remote computation replaced it; it must not be used as a cache.

Metric sanity checks covered identical/disjoint box IoU, abstention counting,
102/102 aligned predictions, 102 unique evaluation paths, source counts, and
alpha-zero parity. The completed cloud job verified class/encoder dimensions,
finite features and prior probabilities, source/head hashes and complete path
alignment. No serving behavior was edited, so the full application suite was
not rerun for these artifact-only experiments.

## Fabric data search criteria

Search for `fabric weave classification dataset plain twill satin`,
`textile swatch dataset expert annotated fabric types`,
`fabric dataset lawn cambric khaddar karandi`, and
`fabric dataset paired macro close-up garment images`.

Prefer verified fabric identities, separate structure/fibre/finish fields,
many independent physical fabrics per class, product/sample IDs for grouped
splits, sharp images retaining weave texture, and explicit research-use rights.
Paired close-up and full-garment photos of the same known fabric are especially
useful for this scanner. Dataset names mentioning textiles are insufficient:
defect-only labels or a single generic fabric class do not supervise our classes.
