# TexPilot in the factory

What the scanner tells you, how to give it what it needs, and how far to trust each answer.
Open the TexPilot app on a phone on the factory wifi and go to **Scanner**.

## 1. Fabric type from a photo (Fabric tab)

Photograph the garment or fabric in daylight, the whole piece in frame. The result names the
fabric type (27 types, e.g. denim, chambray, corduroy, jersey, satin) with a confidence.

When the scanner is not sure it says **Not enough evidence** and shows its closest matches.
That is deliberate: on 24,628 held-out catalog photos scanner-v5 answers about 73% of them, and
about 90% of those answers are right. Accuracy on phone photos from the factory floor has not
been measured yet (docs/phone-test-set.md describes how to collect that test).

## 2. The yarn to order (Yarn spec tab)

The threads are measured, so the scan needs a known scale. Either:

- **Flatbed scanner:** scan the fabric flat at 1200 dpi (600 dpi is enough for denim), at least
  1 x 1 inch of fabric, with the selvedge running up the glass. PNG or TIFF.
- **Phone and the TexPilot card:** print `yarnflow/public/texpilot-card.svg` at 100% (actual size,
  not "fit to page") and check that the black square measures 30 mm. If it doesn't, enter what it
  measures in the app. Cut out one card and lay it flat on the fabric. Use the normal 1x camera
  (not 0.5x), hold the phone straight above at about 15 cm with the selvedge running up the
  screen, keep the card away from the photo's edges, and fill the rest of the frame with fabric.

Then add the **weight**: cut a 10 x 10 cm piece and weigh it; grams x 100 = g/m2 (or use a GSM
cutter). Without the weight you get the thread count and weave but no yarn count. Add the
**care label** (typed or photographed) for the fibre.

The result lists the yarn to order (e.g. `Warp yarn: Ne 7s (range 6.6-7.1), 98% cotton + 2%
elastane/spandex`) and the construction (e.g. `woven 3/1 twill, right-hand, 64 ends x 42 picks
per inch, 390 g/m2`), with the measurements behind them. The notes under the result say what
each number assumes:

| Note | Meaning | What to do |
|---|---|---|
| CARD_SCALE | The scale came from the card | Check the card printed at 30 mm |
| LOW_DPI | The finest threads may be beyond the resolution | Scan at 1200 dpi, or photograph from closer |
| IRREGULAR_SPACING | Thread spacing varies across the swatch (slub yarn, distorted fabric) | Confirm with a pick glass |
| SMALL_SCAN | Few areas agreed on the count | Scan or photograph more fabric |
| NO_WEIGHT | No weight given, so no yarn count | Weigh a 10 x 10 cm piece |
| WEFT_ASSUMED | Warp and weft taken as the same count | Unravel and weigh one pick to confirm the weft |
| WEAVE_READ | The weave was read from the yarn crossings, darker yarn on top | Confirm with a pick glass |

**How far to trust it today.** Every count is within 3% on simulated fabric, including twill,
satin, basket, blur, uneven light, slub yarns, knits and phone photos tilted up to 15 degrees.
It has not yet been checked against real fabric: check the first orders against a pick glass.
Yarn counts are ranges because crimp is assumed (6-14% warp, 4-10% weft).

## 3. Teaching the scanner your own categories (e.g. wash type)

The scanner learns categories you name from your own photos: stone wash, enzyme wash, acid
wash, rinse, or your in-house fabric codes.

1. Make one folder per category, with at least 10 photos each (20-50 is better), taken the way
   you will scan:

   ```
   data/custom/wash/stone_wash/*.jpg
   data/custom/wash/enzyme_wash/*.jpg
   data/custom/wash/rinse/*.jpg
   ```

2. Teach it, on the computer that runs the scanner:

   ```
   .venv/bin/python -m training.scanner.teach --bundle models/scanner-v5 --photos data/custom/wash
   ```

   It reports how often it was right on your photos (cross-validated, so each photo is judged by a
   head that did not see it) and how many photos it would answer at about 90% accuracy.

3. Restart the scanner. Every fabric scan now shows a **Wash** line; below that confidence it
   says Not enough evidence and shows the closest matches.

To improve it, add photos and teach again. Each scan records which teaching answered it (the
model version ends in `+wash=<code>`).

As a guide to how many photos you need: taught from 20 photos per category, among 4-5 similar
catalog fabrics, it was right 71-81% of the time (balanced accuracy); from 50 photos, 74-83%.
Wash differences may be easier or harder: the report from your own photos is the real measure.
