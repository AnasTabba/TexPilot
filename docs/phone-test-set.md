# Phone test set — how to collect it

**Who:** the whole team, about an hour each. **When:** by the end of week 1 (Oct 4).
**Why:** it decides which detector and OCR engine the scanner ships with (the bake-off),
and it gives us the project's headline result: how much accuracy drops between catalog
photos (what the models trained on) and real phone photos. Spec:
`docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md` §8.1.

## What to collect

About **100 garments** (60 at minimum) from your own wardrobes. Each garment gets **two
photos** and **one row** in the spreadsheet.

Aim for variety. The set is only useful if it isn't all cotton t-shirts:
- **Garment types:** cover as many of the 14 below as you can.
- **Fibres:** a mix of cotton, polyester, wool, silk, viscose, nylon and blends. Blends are
  fine and useful; record them exactly as the label says.
- **Hard cases on purpose:** a satin that's polyester next to one that's silk; denim;
  fleece; knits; anything shiny, fuzzy or printed.
- **At least two people, on different phones.**

## Before you start: turn off HEIC (iPhone)

iPhones save photos as HEIC by default, and the scanner rejects HEIC. Go to
**Settings → Camera → Formats → Most Compatible**, which saves JPEG. Android phones
already save JPEG.

## Photo 1 — the whole garment (`<id>_garment.jpg`)

- Lay it flat, or hang it on a hanger, **the whole garment in frame**, filling about 70% of it.
- Plain-ish background: a bed sheet, a floor or a wall. Busy patterns confuse the detector.
- Daylight or bright indoor light. No harsh shadows across it, no flash glare.
- Hold the phone straight above it (flat) or straight in front (hanger). No filters, no zoom.
- **No faces.** If someone is wearing it, crop above the neck, or just lay it flat.

## Photo 2 — the care label (`<id>_label.jpg`)

- The side of the label that lists the **composition** (the % and fibre names).
- Flatten it with a finger outside the text. The **whole label in frame**, text in
  focus, and as horizontal as you can get it.
- If the composition runs over two labels, or both sides of one label, take the one that
  names the **main fabric** ("shell", "outer", "body"). Note the rest in `notes`.

## Naming and where files go

- `id` is 3 digits plus your initials, so ids never clash: `001_AT`, `002_AT`, … and
  `001_MK`, … for someone else.
- Files: `001_AT_garment.jpg`, `001_AT_label.jpg`.
- Upload everything to the shared Drive folder **TexPilot phone set**, one subfolder per
  person. It gets downloaded into `data/phone/` (gitignored). Never commit photos.

## The spreadsheet (`ground_truth.csv`)

Copy `docs/phone_ground_truth_template.csv` and add one row per garment:

| Column | What to write |
|---|---|
| `id` | e.g. `001_AT` |
| `garment_type` | **one** of the 14 below, spelled exactly |
| `label_text` | the composition **exactly as printed**, every language. Separate lines with ` / `. e.g. `SHELL: 80% POLYAMIDE 20% ELASTANE / LINING: 100% POLYESTER` |
| `fabric_structure` | *optional.* One of the 27 fabric classes below, **only if you're sure** (e.g. it's obviously denim). Otherwise leave it empty; an empty cell is better than a guess |
| `photographer` | your initials |
| `phone_model` | e.g. `iPhone 13`, `Galaxy A54` |
| `notes` | anything odd: two labels, faded text, worn by a person, a lining shown |

**Garment types (14):** `shirt_blouse`, `top_tshirt_sweatshirt`, `sweater`, `cardigan`,
`jacket`, `vest`, `pants`, `shorts`, `skirt`, `coat`, `dress`, `jumpsuit`, `cape`, `scarf`
(jeans are `pants`; a hoodie is `top_tshirt_sweatshirt`; a dupatta or shawl is `scarf`).

**Fabric classes (27, optional column):** canvas, chambray, chenille, chiffon, corduroy,
crepe, denim, faux_fur, faux_leather, flannel, fleece, gingham, jersey, knit, lace, lawn,
neoprene, organza, plush, satin, serge, taffeta, tulle, tweed, twill, velvet, vinyl.

## Checklist before you upload

- [ ] Every garment has both photos, named `<id>_garment.jpg` and `<id>_label.jpg`
- [ ] JPEG, not HEIC
- [ ] No faces
- [ ] Every row's `garment_type` is one of the 14, spelled exactly
- [ ] `label_text` is copied exactly as printed, including percentages
- [ ] `fabric_structure` is filled only where you are sure

Whoever has the repo can check a folder in one go; it names every mistake above:

```bash
.venv/bin/python scripts/check_phone_set.py data/phone
```
