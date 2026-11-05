# DeepFashion2 preparation and comparison

All four supplied archives were extracted from Downloads to
`data/external/deepfashion2/`. Originals remain in Downloads. Native unzip
completed successfully, checking encrypted entry CRCs. No scanner model or
frozen TextileNet split was replaced.

## Measured downloaded release

| Split | Images | Annotated items | Products | Shop consumer positive item pairs |
| --- | ---: | ---: | ---: | ---: |
| Train | 191,961 | 312,186 | 14,555 | 382,498 |
| Validation | 32,153 | 52,490 | 2,279 | 67,305 |
| Test | 62,629 | Not used | Not used | Not used |

Total: **286,743 images**, rather than the roughly 491K headline paper count.
These are measured archive contents, not a claim that the official paper is
wrong. Train contains 132,157 shop and 59,804 consumer images. The paired training
products number 14,180. No fabric labels are supplied by this annotation schema.

Pair construction requires the same official split, positive product ID,
matching positive style number, and matching garment category, with different
shop/consumer image paths. Category agreement is an additional conservative
constraint. Product groups retain all styles/categories together. Official IDs
are scoped to their split; equal integers across releases do not prove equal
products. Unknown style (94,408 train items) does not create positive pairs.
Zero boxes on unknown-style items are retained as metadata, never positive pairs.

## Integrity and leakage evidence

SHA-1 hashing covered **all 286,743 images**:

- Exact image overlap between DeepFashion2 splits: **0 found**.
- Exact image overlap with validation/test hashes in `data/splits/fabric.csv`:
  **0 found**. This covers that specified manifest, not every historical benchmark.
- Image verification sampled every 1,000th sorted image in each split: **0
  failures**. This is not full image decoding; archive extraction checked every CRC.
- Edited copies and other near-duplicates: **not measured**.

Artifacts under ignored `runs/deepfashion2/`:

- `archive_inventory.json` and `extract.log`: archive sizes/counts and extraction.
- `image_hashes.csv` and `image_audit.json`: complete hash inventory and audit.
- `manifests_v2/{train,validation}_items.csv`: item metadata and product groups.
- `manifests_v2/{train,validation}_pairs.csv`: domain-pair manifests.
- `manifests_v2/pilot_review.csv` and `pilot_review.html`: 260 training photos,
  ten representative pairs per garment category. All fabric judgments are pending.

The earlier `manifests/` directory is an incomplete first attempt, stopped on an
official zero-box unknown-style item. Use `manifests_v2/`, which has a completed
`summary.json`. No archive or annotation was modified to resolve that case.

## What this adds to TextileNet

TextileNet directly supervises fabric classes; our prior human review found
significant ambiguity and disagreement in some of those labels. DeepFashion2
provides richer garment geometry and identity across shop/consumer views. It
does not replace denim/satin/twill labels and cannot automatically adjudicate
our fabric mistakes. Label-quality superiority for fabric classification has
not been measured because DeepFashion2 has no equivalent fabric ground truth.

The strongest distinct use is a controlled cross-domain representation-learning
experiment, followed by evaluation on unchanged fabric validation data. A fabric
classifier cannot simply train on DeepFashion2 clothing IDs. The optional
260-photo review batch can supply additional explicit fabric training labels
after independent qualified review. Neither approach establishes a promised F1
gain or reaching 0.89.

## Execution state

Data preparation and pair manifests are complete. Targeted tests for this work:
19 passed; Ruff passed. The existing `external_fabric.py` importer remains the
boundary for merging reviewed external fabric examples into a separate training
CSV. Rebuild manifests with:

```bash
OMP_NUM_THREADS=2 nice -n 10 .venv/bin/python -m training.textilenet.deepfashion2 \
  --root data/external/deepfashion2 --data-root data \
  --out runs/deepfashion2/manifests_next
```

At the job check, `yaseenazhar/retrain-rounds-v1` and
`anastabba/texpilot-clean22-score` were both RUNNING, managed by another ongoing
workflow. They were left alone. This session did **not** submit a DeepFashion2
training job, upload licensed images, or change serving weights. The cross-domain
training objective and its fabric-validation comparison remain to be implemented;
pair manifests alone are not a trained model. The newer LoRA training code is
available in `FYP-clean`, rather than the obsolete `FYP-enc` path in old notes.

Respect the supplied non-commercial agreement and distribution restrictions.
The prepared data remain local; a remote dataset upload is not part of this
preparation step.
