# Working on TexPilot

## Setup

```bash
make setup     # core + dev deps, ~20s, no torch
make test      # must pass before you push
make api       # http://127.0.0.1:8000/docs
```

`make setup-ml` adds torch/timm — only needed to train or run the vision model.

## Branches

`main` is protected by CI. Work on `feat/<area>-<thing>`, e.g. `feat/vision-dinov2-probe`.
Open a PR; someone else merges it.

## House rules

1. **Tests first.** Every behaviour change starts with a failing test. The suite is
   fast on purpose — there is no excuse to skip it.
2. **Never guess on behalf of the user.** If the model or the OCR is unsure, return
   `INSUFFICIENT_EVIDENCE`. Silent fallbacks and default labels are bugs here, not
   conveniences — see `parse_composition`, which returns `None` rather than drop an
   unrecognised fibre.
3. **The API contract is shared.** `services/api/schemas.py` is the boundary between
   all three workstreams. Change it in a PR all three review.
4. **Grouped splits, always.** Any evaluation over FabricsCompositionDataset splits on
   `Sample.group_id`. There are 44 distinct fabrics behind 12,724 images; a random
   image-level split invalidates every number you report.
5. **Report the domain.** Every accuracy figure states whether it came from catalog or
   phone images. They are not comparable.

## Layout

```
services/
  api/          FastAPI app, wire contract, pipeline      (P2)
  vision/       taxonomy, dataset adapters, predictor     (P1)
  ocr/          care-label parsing + fibre normalisation  (P2)
  consistency/  plausibility KB + flag engine             (P2)
app/            React Native client                       (P3)
docs/superpowers/specs/   the approved designs — read these first
scripts/        one-off utilities
tests/
```
