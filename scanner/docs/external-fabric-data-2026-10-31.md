# External data experiment toward 0.89 fabric macro F1

External images help only when their supervision matches the missing capability.
DeepFashion2 supplies clothing identity across shop/consumer images, not fabric
ground truth. Its official README describes 491,895 images and 13 clothing
categories, with boxes, masks, landmarks, style, source and pair_id. Matching
positive retrieval items requires the same pair_id and positive style number;
pair_id alone is not a positive-pair label. Consumer images are not necessarily
factory fabric close-ups. Training on these pairs may improve robustness, but
does not establish a fabric-F1 gain or guarantee invariance to glare and folds.

Source checked 31 October 2026:
https://github.com/switchablenorms/DeepFashion2

The screenshot's combined “Alibaba FashionAI / WAB”, 1,042,178-image claim has
not been verified against an identifiable official release, annotation schema,
or terms. Do not download an arbitrary mirror or invent a mapping from clothing
categories to fabric. The separate iMaterialist 2018 release describes Wish
images with 228 attributes and URL-based downloads; it is not evidence for the
Alibaba claim: https://github.com/visipedia/imat_fashion_comp

## Implemented first step

`training/textilenet/external_fabric.py` inventories official DeepFashion2 training
annotations into a whole-photo review CSV. It keeps source domain, category IDs,
item count and conservative product identity; fabric labels start empty. No
inference model is loaded. No garment category is mapped to denim/crepe/etc.

Use validation confusions and independently reviewed training mistakes to target
additional examples for weak classes. Nearest-neighbor similarity can prioritize
review; it cannot decide that our ground truth is wrong. Previously inspected
archive-test errors may motivate a hypothesis, but must not become training rows
or recipe-selection data. Reserve new independent products for a final evaluation.

After access is granted and the official archives are extracted:

```bash
OMP_NUM_THREADS=2 nice -n 10 .venv/bin/python -m training.textilenet.external_fabric \
  index-deepfashion2 --root data/external/deepfashion2 --data-root data \
  --out runs/external_fabric/deepfashion2_review.csv
```

The official download page requires an application form to obtain the archive
password. This session did not submit a form, accept terms, download the archives,
or launch training. Check the supplied dataset agreement before use; “free” does
not establish unrestricted reuse.

A reviewer fills `fabric_label`, `review=approved`, and their `reviewer` identity
only for unambiguous photos using the exact classes in the deployed head JSON.
For multi-item photos, leave pending unless the whole-photo fabric target is
unambiguous. Use two independent qualified reviewers and adjudicate disagreements
for the experimental training batch; the importer records provenance but cannot
prove a reviewer is human or qualified. Automated predictions remain pending.

```bash
OMP_NUM_THREADS=2 nice -n 10 .venv/bin/python -m training.textilenet.external_fabric \
  merge-reviewed --base-split data/splits/fabric.csv --data-root data \
  --review-csv runs/external_fabric/deepfashion2_review.csv \
  --head-json models/scanner-v8/head_a/head.json \
  --out runs/external_fabric/fabric_plus.csv
```

The importer accepts reviewed external **training** rows only, validates image
decoding and label names, rejects paths outside the data root and conflicting
duplicate labels, and excludes duplicate content. A validation/test hash match
blocks the whole external product group, including when the match itself is
pending review. Every original benchmark row is preserved, in order. The audit
sidecar records class counts, exclusions, class order and input/output hashes.
Outputs cannot overwrite existing files. Exact hashes do not detect edited
copies: product/source overlap and near-duplicates still require review before
training. Indexing/merging reads the entire CSV; start with a reviewed pilot batch.

## Training pilot after data is available

1. Freeze a reviewed batch selected from development evidence, with additional
   independent examples of weak/rare fabric classes. Keep the original validation
   and test membership unchanged. Record per-class additions and provenance.
2. Compare matched current-data and enriched-data fine-tunes from identical v8
   initialization, seed, augmentation, resolution and GPU budget. Select by
   validation macro F1 over the fixed 24 classes. First require a >=0.005 gain and
   investigate supported-class regressions; replicate a promising recipe.
3. A separate later experiment may add a DeepFashion2 item-pair contrastive
   objective, using same pair_id **and style > 0**, grouped by product and with a
   separate projection head. Establish a data-only gain first; joint training
   can also harm fabric distinctions. This objective is not implemented here.
4. Lock the finalist, then report archive and independently labeled phone results
   separately, with per-class support and uncertainty. 0.89 remains an empirical
   target; excluding ambiguous examples or abstaining changes the reported task.

The generated CSV follows the existing `Record` contract. However this checkout's
generic trainer defaults to 27 classes; it is not the historical 24-class v8 LoRA
training runner. The FYP-enc path in older notes no longer exists. Restore and
verify that runner and exact class mapping before launching this pilot. Do not
run the default trainer and call it a matched v8 experiment. A changed encoder
also requires retraining/revalidating the six dependent custom heads before serving.
