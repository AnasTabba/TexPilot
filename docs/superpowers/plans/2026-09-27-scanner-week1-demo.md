# Scanner Week 1 — End-to-End Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone photo of a garment plus a photo of its care label goes in; a real
`PASS | FLAG | INSUFFICIENT_EVIDENCE` verdict comes out. The garment is detected and
cut out, its fabric classified, and the label read by OCR, all on the M3 laptop.

**Architecture:** Five small units behind typed interfaces (`GarmentDetector`,
`Segmenter`, `FabricCropper`, `FabricHeads`, `OcrEngine`), composed by a
`ScannerPredictor` that implements the existing `Predictor` protocol. Label OCR feeds a
new `CompositionExtractor`, which sits in front of the existing parser. The API gains
optional fields only.

**Tech Stack:** Python 3.10, PyTorch 2.14 (MPS), timm 1.0.30, Hugging Face
transformers 5.17 (Grounding DINO, OWLv2, SAM 2.1), DINOv2 ViT-B/14, Apple Vision via
PyObjC, PaddleOCR 3.7 (isolated venv), FastAPI, pytest.

**Spec:** `docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md` (parent:
`2026-09-20-fabric-verification-scanner-design.md`). Plans 2–5 (evaluation and bake-off,
Florence-2, RT-DETR/Fashionpedia, Head A swap) are written when their week starts.

**Where to work:** the `FYP-vision` worktree (`/Users/anastabba/Documents/iba/FYP-vision`),
branch `feat/vision-textilenet-train`. Its venv is `.venv/` in that worktree; run tests
with `.venv/bin/python -m pytest`.

## Global Constraints

- **Local models only.** No hosted AI APIs anywhere in the scan path.
- Inference runs on an Apple M3 MacBook Air, **16 GB, fanless**; phones call it over Wi-Fi.
- Pinned versions: `torch==2.14.0`, `timm==1.0.30`, `transformers==5.17.0`,
  `albumentations==2.0.8`, `scipy==1.14.1` (1.15.x fails to load on macOS 27),
  `huggingface_hub==1.33.0`.
- Model IDs, verbatim: `IDEA-Research/grounding-dino-tiny`,
  `google/owlv2-base-patch16-ensemble`, `facebook/sam2.1-hiera-small`,
  `vit_base_patch14_dinov2.lvd142m` (timm).
- **Never guess.** Heads below their threshold `τ_h` return `None`; label parses that
  disagree return unreadable. That abstention is a verdict, not an error.
- API changes are **additive only** (new optional/nullable fields); existing tests stay
  green. `services/api/schemas.py` changes go in a PR the app owner (P3) reviews, and
  after merge P3 runs `cd app && npm run gen:api`.
- `services/ocr/`, `services/consistency/` and `services/api/` are P2's lane. The user
  (project lead) approved this spec, and the PR description must still ask P2 to review.
- Heavy imports (torch, transformers, PyObjC, numpy, PIL) are **lazy** in any module that
  API or CI-core tests import. CI (no torch, no numpy) must keep passing.
- Tests that load real weights or local data are marked `@pytest.mark.slow` and skipped by
  default. Run them with `pytest -m slow`.
- **Laptop safety:** long local loops go through `training/textilenet/governor.py`, with
  at most 2 DataLoader workers and batch ≤ 32. Metal memory stays capped. Only one heavy job runs at a time.
- Latency target: **p50 ≤ 3 s per scan** on the M3 with default backends.
- Run `.venv/bin/ruff format` and `.venv/bin/ruff check` on touched files before every commit.
- Commits are authored by the user (git config); **no Claude co-author trailer**.

## Review Focus

These inputs are implied by the spec but no feature test naturally covers them. Each has
a pinning test in the task named:

1. **Phone photos stored sideways with an EXIF rotation tag.** They must be classified
   upright, not on their side (Task 1).
2. **12-megapixel phone photos (4032×3024).** Decoding must bound them to 1600 px so
   memory and latency stay in budget (Task 1).
3. **HEIC or non-image bytes** (an iPhone default). These must give a clear HTTP 422, not
   a crash or a silent abstention (Tasks 1 and 11).
4. **RGBA, greyscale or palette PNGs.** They must decode to 3-channel RGB (Task 1).
5. **A worn outfit with several garments in frame.** The scan must pick one garment
   deterministically (the confident, large, central one), not the first detection
   returned (Task 2).

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `services/vision/errors.py` | `UnsupportedImage` (stdlib only) | 1 |
| `services/vision/runtime.py` | Metal/env settings, device choice, float64→float32 moves | 1 |
| `services/vision/imageio.py` | decode upload bytes → upright bounded RGB array | 1 |
| `requirements-ml.txt` | exact pins for the scanner + benchmark stack | 1 |
| `services/vision/garment.py` | vocabulary, `Detection`, label mapping, primary-garment choice | 2 |
| `services/vision/detectors/{__init__,gdino,owlv2}.py` | detector protocol, loader, backends A1/A2 | 3 |
| `services/vision/segment.py` | SAM 2.1 wrapper, mask clean-up, box masks | 4 |
| `services/vision/crop.py` | masked garment crop, texture patches, `FabricCropper` | 5 |
| `services/vision/backbone.py` | DINOv2 pooling and preprocessing shared by training and serving | 6 |
| `services/vision/heads.py` | bundle format, calibrated linear heads, `LinearHeads` | 6 |
| `training/scanner/calibration.py` | temperature scaling, ECE, abstain thresholds | 6 |
| `training/scanner/fit_heads.py` | fit Heads A and C from cached features → `models/scanner-v1` | 6 |
| `services/vision/predictor.py` | + `GarmentOutput`, `Note`, new optional `VisionOutput` fields | 7 |
| `services/vision/scanner.py` | `ScannerPredictor`, `build_scanner` | 7 |
| `services/ocr/engines/{__init__,base,apple}.py` | `TextLine`, `OcrEngine`, Apple Vision backend | 8 |
| `services/ocr/{normalizer,parser}.py` | PA fix, accents, multilingual names, trailing-word tolerance | 9 |
| `services/ocr/extract.py` | `CompositionExtractor`: order, sections, agreement, rotation | 9 |
| `services/consistency/{engine.py,kb.yaml}` | `FAMILY_MISMATCH`, KB v2 | 10 |
| `services/api/{schemas,config,pipeline,main}.py` | additive contract, config, wiring | 11 |
| `services/ocr/engines/{paddle,paddle_worker}.py` | PaddleOCR through an isolated-venv worker | 12 |
| `scripts/scan_demo.py`, `Makefile` | one-command end-to-end demo, `make api-scanner` | 13 |

---

### Task 1: Scanner runtime, dependencies and image decoding

**Files:**
- Create: `services/vision/errors.py`, `services/vision/runtime.py`, `services/vision/imageio.py`, `requirements-ml.txt`
- Modify: `pyproject.toml` (ml extras, pytest markers), `training/textilenet/__init__.py`, `training/textilenet/requirements.txt`, `Makefile` (`setup-ml`), `.gitignore`
- Test: `tests/test_scanner_imageio.py`

**Interfaces:**
- Produces: `UnsupportedImage(ValueError)`; `decode_image(data: bytes, max_side: int = 1600) -> np.ndarray` (HxWx3 uint8, upright); `runtime.pick_device(name="auto") -> torch.device`; `runtime.to_device(batch, device) -> dict` (float64 tensors become float32).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner_imageio.py
"""Upload decoding: upright, RGB, bounded. Skipped where numpy/PIL are absent (CI core)."""

import io

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.errors import UnsupportedImage  # noqa: E402
from services.vision.imageio import decode_image  # noqa: E402


def _encode(img, fmt="JPEG", **kw):
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kw)
    return buf.getvalue()


def test_exif_rotated_phone_photo_is_decoded_upright():
    img = Image.new("RGB", (40, 20), "red")  # stored landscape
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90° clockwise to display", as phones write it
    assert decode_image(_encode(img, exif=exif)).shape == (40, 20, 3)  # displayed portrait


def test_twelve_megapixel_photos_are_bounded():
    out = decode_image(_encode(Image.new("RGB", (4032, 3024), "blue")), max_side=1600)
    assert out.shape == (1200, 1600, 3)


@pytest.mark.parametrize("mode", ["RGBA", "L", "P"])
def test_any_pixel_mode_becomes_rgb(mode):
    out = decode_image(_encode(Image.new(mode, (8, 6)), fmt="PNG"))
    assert out.shape == (6, 8, 3)
    assert out.dtype == np.uint8


@pytest.mark.parametrize(
    "data", [b"not an image", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64], ids=["junk", "heic"]
)
def test_undecodable_bytes_raise_unsupported_image(data):
    with pytest.raises(UnsupportedImage):
        decode_image(data)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_scanner_imageio.py -v`
Expected: collection ERROR, `ModuleNotFoundError: No module named 'services.vision.errors'`

- [ ] **Step 3: Implement**

```python
# services/vision/errors.py
"""Errors the API maps to HTTP responses. Stdlib only, so the API imports it cheaply."""


class UnsupportedImage(ValueError):
    """The upload is not an image we can decode (HEIC, truncated, not an image at all)."""
```

```python
# services/vision/imageio.py
"""Decode uploaded images the same way everywhere: upright, RGB, bounded size."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from services.vision.errors import UnsupportedImage

#: Detectors resize to ~800-1000 px and the heads to 224; nothing needs 12 MP.
MAX_SIDE = 1600


def decode_image(data: bytes, max_side: int = MAX_SIDE) -> np.ndarray:
    """HxWx3 uint8 RGB, rotated upright per EXIF, longest side at most ``max_side``."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)  # phones store rotation as a tag, not pixels
            im = im.convert("RGB")
            if max(im.size) > max_side:
                im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            return np.asarray(im).copy()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise UnsupportedImage(f"cannot decode image: {e}") from e
```

```python
# services/vision/runtime.py
"""Process-wide settings for running models on this laptop. Import before torch.

Why the Metal caps: on 2026-09-27 a model job plus browser tabs exhausted the 16 GB
fanless MacBook Air, which froze and had to be force-restarted. With the cap, a runaway
job fails with an out-of-memory error instead. See training/textilenet/governor.py.
"""

from __future__ import annotations

import os

_DEFAULTS = {
    # Cap Metal memory at half the recommended working set (~5 GB of 16 GB). The low
    # watermark must not exceed the high one, or torch refuses every MPS allocation.
    "PYTORCH_MPS_HIGH_WATERMARK_RATIO": "0.5",
    "PYTORCH_MPS_LOW_WATERMARK_RATIO": "0.4",
    # Ops with no Metal kernel (some detector layers) fall back to CPU instead of raising.
    "PYTORCH_ENABLE_MPS_FALLBACK": "1",
    # albumentations phones PyPI on every import, once per DataLoader worker.
    "NO_ALBUMENTATIONS_UPDATE": "1",
}


def configure() -> None:
    for key, value in _DEFAULTS.items():
        os.environ.setdefault(key, value)


def pick_device(name: str = "auto"):
    import torch

    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def to_device(batch, device) -> dict:
    """Move a processor output to ``device``. Metal has no float64, so those become float32."""
    import torch

    out = {}
    for key, value in batch.items():
        if isinstance(value, torch.Tensor):
            if value.dtype == torch.float64:
                value = value.float()
            value = value.to(device)
        out[key] = value
    return out


configure()
```

Replace the body of `training/textilenet/__init__.py` with:

```python
# Metal memory caps, MPS fallback and quiet albumentations, set before torch loads.
# One definition for serving and training: services/vision/runtime.py.
from services.vision import runtime  # noqa: F401
```

- [ ] **Step 4: Dependencies**

In `pyproject.toml`, add to the `ml` extras list:

```toml
    "transformers==5.17.0",
    "huggingface_hub>=1.33,<2",
    "pyobjc-framework-Vision>=12; sys_platform == 'darwin'",
    "pyobjc-framework-Quartz>=12; sys_platform == 'darwin'",
```

and replace the pytest block with:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-q -m 'not slow'"
markers = ["slow: loads real model weights or local data; run with `pytest -m slow`"]
```

In `training/textilenet/requirements.txt`, change `huggingface_hub==2.0.0` to
`huggingface_hub==1.33.0`, because transformers 5.17 requires hub < 2.

Create `requirements-ml.txt`:

```text
# Scanner + benchmark stack, exact versions. `make setup-ml` installs this.
-r training/textilenet/requirements.txt
transformers==5.17.0
tokenizers==0.23.2
pyobjc-framework-Vision==12.2.2; sys_platform == "darwin"
pyobjc-framework-Quartz==12.2.2; sys_platform == "darwin"
```

In `Makefile`, make `setup-ml` also install the pins: after the
`$(PIP) install -q -e ".[ml]"` line add `$(PIP) install -q -r requirements-ml.txt`.

Append to `.gitignore`:

```text
/models/
.venv-paddle/
```

Install: `.venv/bin/pip install -q -r requirements-ml.txt`

- [ ] **Step 5: Run the tests, plus a check that timm still loads DINOv2 on hub 1.33**

Run: `.venv/bin/python -m pytest tests/test_scanner_imageio.py -v`
Expected: 7 passed

Run: `.venv/bin/python -c "import services.vision.runtime, timm; timm.create_model('vit_base_patch14_dinov2.lvd142m', pretrained=True, num_classes=0, img_size=224); print('ok')"`
Expected: `ok` (the weights are already in `~/.cache/huggingface`)

Run: `.venv/bin/python -m pytest && .venv/bin/ruff check .`
Expected: all pass (the MPS watermark test still passes via the runtime import)

- [ ] **Step 6: Commit**

```bash
git add services/vision/errors.py services/vision/runtime.py services/vision/imageio.py \
  training/textilenet/__init__.py training/textilenet/requirements.txt requirements-ml.txt \
  pyproject.toml Makefile .gitignore tests/test_scanner_imageio.py
git commit -m "Decode scan uploads upright and bounded; pin the scanner model stack"
```

---

### Task 2: Garment vocabulary and choosing the garment

**Files:**
- Create: `services/vision/garment.py`
- Test: `tests/test_scanner_garment.py` (stdlib only: runs in CI)

**Interfaces:**
- Produces: `Box = tuple[float, float, float, float]` (pixels, x0 y0 x1 y1);
  `GARMENT_VOCAB: dict[str, tuple[str, ...]]`; `PROMPTS: tuple[str, ...]`;
  `Detection(label: str, score: float | None, box: Box)` (frozen);
  `canonical(phrase: str) -> str | None`;
  `to_detections(labels, scores, boxes, width, height) -> list[Detection]`;
  `choose_primary(dets, width, height, min_score=0.30) -> Detection | None`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner_garment.py
"""Which garment a photo is about. Pure logic, so it runs in CI."""

import pytest

from services.vision.garment import (
    GARMENT_VOCAB,
    PROMPTS,
    Detection,
    canonical,
    choose_primary,
    to_detections,
)


@pytest.mark.parametrize(
    "phrase,expected",
    [
        ("shirt", "shirt_blouse"),
        ("t - shirt", "top_tshirt_sweatshirt"),  # Grounding DINO splits hyphens
        ("Sweatshirt", "top_tshirt_sweatshirt"),
        ("jeans", "pants"),
        ("a photo of a dupatta", "scarf"),  # OWLv2 query form
        ("overcoat", "coat"),
        ("shoe", None),
        ("", None),
    ],
)
def test_detector_phrases_map_to_canonical_garments(phrase, expected):
    assert canonical(phrase) == expected


def test_every_prompt_maps_back_to_its_own_garment():
    for garment, synonyms in GARMENT_VOCAB.items():
        for synonym in synonyms:
            assert canonical(synonym) == garment, synonym


def test_vocabulary_is_the_fourteen_fabric_garments():
    assert len(GARMENT_VOCAB) == 14
    assert len(PROMPTS) == len(set(PROMPTS))


def test_to_detections_maps_clips_and_drops():
    dets = to_detections(
        ["jeans", "shoe", "t-shirt"],
        [0.8, 0.9, 0.5],
        [(-5, 10, 50, 120), (0, 0, 5, 5), (10, 10, 10, 20)],  # last one has zero width
        100,
        100,
    )
    assert dets == [Detection("pants", 0.8, (0.0, 10.0, 50.0, 100.0))]


def test_large_central_garment_beats_small_corner_one():
    corner = Detection("scarf", 0.9, (0, 0, 10, 10))
    central = Detection("dress", 0.6, (20, 20, 80, 80))
    assert choose_primary([corner, central], 100, 100) == central


def test_detections_below_the_threshold_leave_no_garment():
    assert choose_primary([Detection("dress", 0.2, (20, 20, 80, 80))], 100, 100) is None
    assert choose_primary([], 100, 100) is None


def test_scoreless_backend_ranks_by_size_and_centre():
    small = Detection("skirt", None, (40, 40, 50, 50))
    big = Detection("coat", None, (10, 10, 90, 90))
    assert choose_primary([small, big], 100, 100, min_score=0.9) == big


def test_worn_outfit_resolves_to_one_garment_deterministically():
    # Review Focus 5: a person wearing a top and pants. One must win, the same one every time.
    top = Detection("top_tshirt_sweatshirt", 0.60, (30, 10, 70, 50))
    pants = Detection("pants", 0.55, (30, 50, 70, 98))
    assert choose_primary([pants, top], 100, 100) == top
    assert choose_primary([top, pants], 100, 100) == top
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_scanner_garment.py -v`
Expected: collection ERROR, `No module named 'services.vision.garment'`

- [ ] **Step 3: Implement**

```python
# services/vision/garment.py
"""Garment vocabulary and choosing the garment a photo is about. Spec §4.1, §4.3.

Stdlib only: every detector backend maps its raw output through here.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

Box = tuple[float, float, float, float]  # pixels (x0, y0, x1, y1), origin top-left

#: The fabric garments among Fashionpedia's apparel classes -> prompt synonyms.
GARMENT_VOCAB: dict[str, tuple[str, ...]] = {
    "shirt_blouse": ("shirt", "blouse"),
    "top_tshirt_sweatshirt": ("t-shirt", "top", "sweatshirt", "hoodie"),
    "sweater": ("sweater", "jumper", "pullover"),
    "cardigan": ("cardigan",),
    "jacket": ("jacket", "blazer"),
    "vest": ("vest", "waistcoat"),
    "pants": ("pants", "trousers", "jeans"),
    "shorts": ("shorts",),
    "skirt": ("skirt",),
    "coat": ("coat", "overcoat"),
    "dress": ("dress", "gown"),
    "jumpsuit": ("jumpsuit", "overalls"),
    "cape": ("cape", "poncho"),
    "scarf": ("scarf", "shawl", "dupatta"),
}
PROMPTS: tuple[str, ...] = tuple(s for synonyms in GARMENT_VOCAB.values() for s in synonyms)


@dataclass(frozen=True)
class Detection:
    label: str  # a GARMENT_VOCAB key
    score: float | None  # None when the backend produces no scores (Florence-2)
    box: Box


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


# Longest first, so "sweatshirt" and "tshirt" are tried before "shirt".
_SYNONYMS = sorted(
    ((_norm(s), garment) for garment, synonyms in GARMENT_VOCAB.items() for s in synonyms),
    key=lambda pair: -len(pair[0]),
)


def canonical(phrase: str) -> str | None:
    """Canonical garment named in a detector's text label, or None if it names none."""
    key = _norm(phrase)
    if not key:
        return None
    for synonym, garment in _SYNONYMS:
        if synonym in key:
            return garment
    return None


def to_detections(labels, scores, boxes, width: float, height: float) -> list[Detection]:
    """Raw backend output -> Detections: canonical labels, boxes clipped to the image,
    unmapped labels and empty boxes dropped."""
    out: list[Detection] = []
    for label, score, (x0, y0, x1, y1) in zip(labels, scores, boxes, strict=True):
        garment = canonical(label)
        if garment is None:
            continue
        box = (max(0.0, float(x0)), max(0.0, float(y0)), min(float(width), float(x1)),
               min(float(height), float(y1)))
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        out.append(Detection(garment, None if score is None else float(score), box))
    return out


def choose_primary(
    dets: list[Detection], width: float, height: float, min_score: float = 0.30
) -> Detection | None:
    """rank = score x sqrt(area fraction) x (1 - 0.5 x centre distance). Spec §4.3.

    Scoreless detections count as score 1 and skip the threshold. Ties keep the first."""
    cx, cy = width / 2, height / 2
    half_diagonal = math.hypot(cx, cy)
    best, best_rank = None, -1.0
    for d in dets:
        if d.score is not None and d.score < min_score:
            continue
        x0, y0, x1, y1 = d.box
        area = (x1 - x0) * (y1 - y0) / (width * height)
        distance = math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy) / half_diagonal
        rank = (1.0 if d.score is None else d.score) * math.sqrt(area) * (1 - 0.5 * distance)
        if rank > best_rank:
            best, best_rank = d, rank
    return best
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_scanner_garment.py -v`
Expected: 15 passed

- [ ] **Step 5: Commit**

```bash
git add services/vision/garment.py tests/test_scanner_garment.py
git commit -m "Add the garment vocabulary and primary-garment choice"
```

---

### Task 3: Garment detectors A1 (Grounding DINO) and A2 (OWLv2)

**Files:**
- Create: `services/vision/detectors/__init__.py`, `services/vision/detectors/gdino.py`, `services/vision/detectors/owlv2.py`
- Test: `tests/test_slow_detectors.py`

**Interfaces:**
- Consumes: `PROMPTS`, `Detection`, `to_detections` (Task 2); `runtime.to_device` (Task 1).
- Produces: `GarmentDetector` protocol (`name: str`, `default_min_score: float`,
  `detect(image: np.ndarray) -> list[Detection]`); `load_detector(name: str, device) -> GarmentDetector` for `"gdino" | "owlv2"`.

Verified against transformers 5.17 on 2026-09-27:
- `GroundingDinoProcessor.post_process_grounded_object_detection(outputs, input_ids, threshold, text_threshold, target_sizes, text_labels)` returns dicts with `scores`, `boxes` and `text_labels`.
- OWLv2's version takes `(outputs, threshold, target_sizes, text_labels)`. OWLv2 pads images to a square at the bottom/right, so its `target_sizes` must be `(side, side)` with `side = max(h, w)`.

- [ ] **Step 1: Write the slow test**

```python
# tests/test_slow_detectors.py
"""Real detector weights on a real catalog photo. `pytest -m slow`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


@pytest.fixture(scope="module")
def image():
    if SAMPLE is None:
        pytest.skip("TextileNet not on this machine")
    from services.vision.imageio import decode_image

    return decode_image(SAMPLE.read_bytes())


@pytest.mark.parametrize("name", ["gdino", "owlv2"])
def test_detector_finds_a_garment_with_sane_boxes(name, image):
    from services.vision.detectors import load_detector
    from services.vision.garment import GARMENT_VOCAB
    from services.vision.runtime import pick_device

    det = load_detector(name, pick_device())
    found = det.detect(image)
    h, w = image.shape[:2]
    assert found, f"{name} found nothing in {SAMPLE}"
    for d in found:
        assert d.label in GARMENT_VOCAB
        assert 0 <= d.box[0] < d.box[2] <= w and 0 <= d.box[1] < d.box[3] <= h
        assert 0.0 <= d.score <= 1.0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest -m slow tests/test_slow_detectors.py -v`
Expected: FAIL, `No module named 'services.vision.detectors'`

- [ ] **Step 3: Implement**

```python
# services/vision/detectors/__init__.py
"""Garment detector backends (spec §4.2). Each imports its heavy dependencies lazily."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import numpy as np

    from services.vision.garment import Detection


class GarmentDetector(Protocol):
    name: str
    default_min_score: float  # τ_det before the bake-off tunes it (spec §4.3)

    def detect(self, image: np.ndarray) -> list[Detection]: ...


def load_detector(name: str, device) -> GarmentDetector:
    if name == "gdino":
        from services.vision.detectors.gdino import GroundingDinoDetector

        return GroundingDinoDetector(device)
    if name == "owlv2":
        from services.vision.detectors.owlv2 import Owlv2Detector

        return Owlv2Detector(device)
    raise ValueError(f"unknown garment detector {name!r}; week 1 ships 'gdino' and 'owlv2'")
```

```python
# services/vision/detectors/gdino.py
"""Grounding DINO-T, zero-shot garment detection. Spec §4.2, backend A1."""

from __future__ import annotations

import numpy as np

from services.vision.garment import PROMPTS, Detection, to_detections
from services.vision.runtime import to_device

MODEL_ID = "IDEA-Research/grounding-dino-tiny"


class GroundingDinoDetector:
    name = "gdino"
    default_min_score = 0.30

    def __init__(self, device, model_id: str = MODEL_ID, box_threshold: float = 0.25,
                 text_threshold: float = 0.25):
        import torch
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).eval().to(device)
        # Grounding DINO expects lower-case phrases separated by " . ", ending with " .".
        self.prompt = " . ".join(p.lower() for p in PROMPTS) + " ."
        self.box_threshold, self.text_threshold = box_threshold, text_threshold

    def detect(self, image: np.ndarray) -> list[Detection]:
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(images=Image.fromarray(image), text=self.prompt, return_tensors="pt")
        with self._no_grad():
            outputs = self.model(**to_device(inputs, self.device))
        res = self.processor.post_process_grounded_object_detection(
            outputs, inputs["input_ids"], threshold=self.box_threshold,
            text_threshold=self.text_threshold, target_sizes=[(h, w)],
        )[0]
        return to_detections(res["text_labels"], res["scores"].tolist(), res["boxes"].tolist(), w, h)
```

```python
# services/vision/detectors/owlv2.py
"""OWLv2-B, zero-shot garment detection. Spec §4.2, backend A2."""

from __future__ import annotations

import numpy as np

from services.vision.garment import PROMPTS, Detection, to_detections
from services.vision.runtime import to_device

MODEL_ID = "google/owlv2-base-patch16-ensemble"


class Owlv2Detector:
    name = "owlv2"
    # OWLv2 scores run lower than Grounding DINO's; 0.15 until the bake-off tunes it.
    default_min_score = 0.15

    def __init__(self, device, model_id: str = MODEL_ID, threshold: float = 0.10):
        import torch
        from transformers import Owlv2ForObjectDetection, Owlv2Processor

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = Owlv2Processor.from_pretrained(model_id)
        self.model = Owlv2ForObjectDetection.from_pretrained(model_id).eval().to(device)
        self.queries = [f"a photo of a {p}" for p in PROMPTS]
        self.threshold = threshold

    def detect(self, image: np.ndarray) -> list[Detection]:
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(text=[self.queries], images=Image.fromarray(image), return_tensors="pt")
        with self._no_grad():
            outputs = self.model(**to_device(inputs, self.device))
        side = max(h, w)  # OWLv2 pads to a square at the bottom/right; boxes live in that frame
        res = self.processor.post_process_grounded_object_detection(
            outputs, threshold=self.threshold, target_sizes=[(side, side)],
            text_labels=[self.queries],
        )[0]
        return to_detections(res["text_labels"], res["scores"].tolist(), res["boxes"].tolist(), w, h)
```

- [ ] **Step 4: Run the slow test** (downloads ~0.7 GB + ~0.6 GB of weights the first time)

Run: `.venv/bin/python -m pytest -m slow tests/test_slow_detectors.py -v`
Expected: 2 passed. If an op has no Metal kernel, `PYTORCH_ENABLE_MPS_FALLBACK=1`
(set in `runtime.py`) runs it on CPU. That's fine, since it's correct, just slower.

Also run `.venv/bin/python -m pytest` (default, not slow). Expected: all pass (the
detector modules are never imported by core tests).

- [ ] **Step 5: Commit**

```bash
git add services/vision/detectors tests/test_slow_detectors.py
git commit -m "Add zero-shot garment detectors: Grounding DINO-T and OWLv2-B"
```

---

### Task 4: Segmenter (SAM 2.1-small) and mask clean-up

**Files:**
- Create: `services/vision/segment.py`
- Test: `tests/test_scanner_segment.py`, `tests/test_slow_segment.py`

**Interfaces:**
- Consumes: `Box` (Task 2), `runtime.to_device` (Task 1).
- Produces: `box_mask(shape: tuple[int, int], box: Box) -> np.ndarray` (bool HxW);
  `clean_mask(mask, box, min_box_fraction=0.20) -> np.ndarray`;
  `Sam2Segmenter(device).segment(image, box) -> np.ndarray` (bool HxW, never empty for a non-empty box).

Verified against transformers 5.17: `Sam2Processor(images, input_boxes=[[[x0, y0, x1, y1]]])`,
`Sam2Model(..., multimask_output=True)` returns `pred_masks (B, P, 3, h, w)` and
`iou_scores (B, P, 3)`, and `post_process_masks(masks, original_sizes)`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner_segment.py
"""Mask clean-up rules (spec §4.5). Skipped where numpy/scipy are absent (CI core)."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")

from services.vision.segment import box_mask, clean_mask  # noqa: E402


def test_keeps_only_the_largest_region_and_fills_its_holes():
    m = np.zeros((50, 50), bool)
    m[5:30, 5:30] = True  # the garment
    m[12:15, 12:15] = False  # a hole (a print, a button) inside it
    m[40:43, 40:43] = True  # a stray blob elsewhere
    out = clean_mask(m, (0, 0, 50, 50), min_box_fraction=0.1)
    assert out[13, 13] and not out[41, 41]
    assert out.sum() == 25 * 25


def test_a_mask_far_smaller_than_its_box_falls_back_to_the_box():
    m = np.zeros((50, 50), bool)
    m[20:22, 20:22] = True  # 4 px inside a 30x30 box: segmentation failed
    out = clean_mask(m, (10, 10, 40, 40))
    assert np.array_equal(out, box_mask((50, 50), (10, 10, 40, 40)))


def test_box_mask_is_the_rectangle():
    out = box_mask((6, 8), (1.2, 2.0, 5.0, 4.6))
    assert out.sum() == 4 * 3 and out[2:5, 1:5].all()
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_scanner_segment.py -v`
Expected: collection ERROR, `No module named 'services.vision.segment'`

- [ ] **Step 3: Implement**

```python
# services/vision/segment.py
"""Garment masks from SAM 2.1-small, and the clean-up rules around them. Spec §4.5."""

from __future__ import annotations

import numpy as np

from services.vision.garment import Box
from services.vision.runtime import to_device

MODEL_ID = "facebook/sam2.1-hiera-small"
#: Below this share of its box, a mask is a failed segmentation, not a garment.
MIN_BOX_FRACTION = 0.20


def box_mask(shape: tuple[int, int], box: Box) -> np.ndarray:
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    mask = np.zeros(shape, bool)
    mask[max(0, y0):y1, max(0, x0):x1] = True
    return mask


def clean_mask(mask: np.ndarray, box: Box, min_box_fraction: float = MIN_BOX_FRACTION) -> np.ndarray:
    """Largest connected region, holes filled; the box itself if the region is too small."""
    from scipy import ndimage

    mask = np.asarray(mask, bool)
    labels, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, labels, index=range(1, n + 1))
        mask = ndimage.binary_fill_holes(labels == 1 + int(np.argmax(sizes)))
    x0, y0, x1, y1 = box
    if mask.sum() < min_box_fraction * max(1.0, (x1 - x0) * (y1 - y0)):
        return box_mask(mask.shape, box)
    return mask


class Sam2Segmenter:
    def __init__(self, device, model_id: str = MODEL_ID):
        import torch
        from transformers import Sam2Model, Sam2Processor

        self._no_grad = torch.no_grad
        self.device = device
        self.processor = Sam2Processor.from_pretrained(model_id)
        self.model = Sam2Model.from_pretrained(model_id).eval().to(device)

    def segment(self, image: np.ndarray, box: Box) -> np.ndarray:
        from PIL import Image

        inputs = self.processor(images=Image.fromarray(image), input_boxes=[[[float(v) for v in box]]],
                                return_tensors="pt")
        with self._no_grad():
            out = self.model(**to_device(inputs, self.device), multimask_output=True)
        masks = self.processor.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"])[0]
        best = int(out.iou_scores[0, 0].argmax())  # keep the mask SAM rates best
        return clean_mask(masks[0, best].numpy(), box)
```

```python
# tests/test_slow_segment.py
"""Real SAM 2.1 weights on a real photo. `pytest -m slow`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


def test_sam_mask_is_non_empty_and_inside_the_image():
    if SAMPLE is None:
        pytest.skip("TextileNet not on this machine")
    from services.vision.imageio import decode_image
    from services.vision.runtime import pick_device
    from services.vision.segment import Sam2Segmenter

    img = decode_image(SAMPLE.read_bytes())
    h, w = img.shape[:2]
    box = (w * 0.1, h * 0.1, w * 0.9, h * 0.9)
    mask = Sam2Segmenter(pick_device()).segment(img, box)
    assert mask.shape == (h, w) and mask.dtype == bool
    assert mask.sum() >= 0.2 * (0.8 * w) * (0.8 * h)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_scanner_segment.py -v`
Expected: 3 passed
Run: `.venv/bin/python -m pytest -m slow tests/test_slow_segment.py -v`
Expected: 1 passed (downloads ~0.2 GB the first time)

- [ ] **Step 5: Commit**

```bash
git add services/vision/segment.py tests/test_scanner_segment.py tests/test_slow_segment.py
git commit -m "Segment the chosen garment with SAM 2.1-small"
```

---

### Task 5: FabricCropper

**Files:**
- Create: `services/vision/crop.py`
- Test: `tests/test_scanner_crop.py`

**Interfaces:**
- Produces: `masked_crop(image, mask) -> np.ndarray` (square, white outside the mask);
  `patch_boxes(mask, n=3, side_frac=0.25, erode_frac=0.05) -> list[tuple[int, int, int]]`
  (y0, x0, side); `texture_patches(image, mask, ...) -> list[np.ndarray]`;
  `FabricCropper(patches: bool = False).views(image, mask) -> list[np.ndarray]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner_crop.py
"""Classifier views (spec §4.6). Skipped where numpy/scipy are absent (CI core)."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")

from services.vision.crop import FabricCropper, masked_crop, patch_boxes  # noqa: E402


def _disk(h=120, w=200, cy=60, cx=100, r=50):
    yy, xx = np.mgrid[:h, :w]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def _image(h=120, w=200):
    return np.full((h, w, 3), 100, np.uint8)


def test_masked_crop_is_square_with_white_background():
    out = masked_crop(_image(), _disk())
    assert out.shape[0] == out.shape[1] == 101
    assert (out[0, 0] == 255).all()  # corner lies outside the disk
    assert (out[50, 50] == 100).all()  # centre is garment


def test_patches_lie_inside_the_eroded_mask_and_do_not_overlap():
    mask = _disk()
    boxes = patch_boxes(mask, n=3)
    assert 1 <= len(boxes) <= 3
    for y0, x0, s in boxes:
        assert mask[y0:y0 + s, x0:x0 + s].all()
    for i, (ya, xa, s) in enumerate(boxes):
        for yb, xb, _ in boxes[i + 1:]:
            assert abs(ya - yb) >= s or abs(xa - xb) >= s


def test_patches_never_leave_the_image_when_the_mask_touches_its_edge():
    mask = np.zeros((100, 100), bool)
    mask[:, :60] = True
    for y0, x0, s in patch_boxes(mask):
        assert y0 >= 0 and x0 >= 0 and y0 + s <= 100 and x0 + s <= 100


def test_a_sliver_of_mask_yields_no_patches():
    mask = np.zeros((100, 100), bool)
    mask[40:44, 10:90] = True
    assert patch_boxes(mask) == []


def test_empty_mask_is_an_error_not_a_blank_view():
    with pytest.raises(ValueError):
        masked_crop(_image(), np.zeros((120, 200), bool))


def test_cropper_views():
    img, mask = _image(), _disk()
    assert len(FabricCropper().views(img, mask)) == 1
    assert len(FabricCropper(patches=True).views(img, mask)) > 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_scanner_crop.py -v`
Expected: collection ERROR, `No module named 'services.vision.crop'`

- [ ] **Step 3: Implement**

```python
# services/vision/crop.py
"""Classifier views from a garment mask. Spec §4.6.

The masked crop mimics TextileNet's white-background product photos, which is what the
heads were trained on. Texture patches are close-ups from well inside the garment.
"""

from __future__ import annotations

import numpy as np

WHITE = 255


def masked_crop(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        raise ValueError("empty mask")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = image[y0:y1, x0:x1].copy()
    crop[~mask[y0:y1, x0:x1]] = WHITE
    h, w = crop.shape[:2]
    side = max(h, w)
    out = np.full((side, side, 3), WHITE, dtype=image.dtype)
    oy, ox = (side - h) // 2, (side - w) // 2
    out[oy:oy + h, ox:ox + w] = crop
    return out


def patch_boxes(mask: np.ndarray, n: int = 3, side_frac: float = 0.25,
                erode_frac: float = 0.05) -> list[tuple[int, int, int]]:
    """Up to ``n`` non-overlapping squares (y0, x0, side) wholly inside the mask eroded by
    ``erode_frac`` of the garment's short side. Deepest positions are taken first."""
    from scipy import ndimage

    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return []
    short = min(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1)
    side, margin = int(side_frac * short), int(erode_frac * short)
    if side < 8:
        return []
    # Chessboard distance to the nearest non-garment pixel (the image border counts as
    # outside). A square of half-side r centred on p fits iff that distance > r.
    dist = ndimage.distance_transform_cdt(np.pad(mask, 1), metric="chessboard")[1:-1, 1:-1]
    free = dist >= side // 2 + margin + 1
    boxes: list[tuple[int, int, int]] = []
    while len(boxes) < n and free.any():
        cy, cx = np.unravel_index(np.argmax(np.where(free, dist, -1)), dist.shape)
        boxes.append((int(cy) - side // 2, int(cx) - side // 2, side))
        free[max(0, cy - side):cy + side + 1, max(0, cx - side):cx + side + 1] = False
    return boxes


def texture_patches(image: np.ndarray, mask: np.ndarray, n: int = 3, side_frac: float = 0.25,
                    erode_frac: float = 0.05) -> list[np.ndarray]:
    return [image[y0:y0 + s, x0:x0 + s].copy()
            for y0, x0, s in patch_boxes(mask, n, side_frac, erode_frac)]


class FabricCropper:
    def __init__(self, patches: bool = False):
        self.patches = patches

    def views(self, image: np.ndarray, mask: np.ndarray) -> list[np.ndarray]:
        views = [masked_crop(image, mask)]
        if self.patches:
            views += texture_patches(image, mask)
        return views
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_scanner_crop.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add services/vision/crop.py tests/test_scanner_crop.py
git commit -m "Cut the garment out on white, with optional texture patches"
```

---

### Task 6: Fabric heads: backbone, calibration, bundle, fitting

**Files:**
- Create: `services/vision/backbone.py`, `services/vision/heads.py`, `training/scanner/__init__.py`, `training/scanner/calibration.py`, `training/scanner/fit_heads.py`
- Modify: `training/textilenet/probe.py` (use `pool_features`; expose `GRID`)
- Test: `tests/test_scanner_backbone.py`, `tests/test_scanner_calibration.py`, `tests/test_scanner_heads.py`

**Interfaces:**
- Consumes: `FeatureCache` (`training/textilenet/feature_cache.py`), `probe.fit_linear`, `metrics.summarize`, `splits.read_csv`/`class_index`, `taxonomy.family_of`.
- Produces:
  - `backbone.pool_features(model, x) -> Tensor`; `backbone.preprocess(view, mean, std, img_size=224, crop_pct=0.875) -> np.ndarray` (3x224x224 float32)
  - `heads.softmax(logits, t=1.0)`; `HeadSpec(classes, weight, bias, temperature, threshold)`
  - `heads.apply_head(features, spec, k=5) -> HeadOutput | None`
  - `heads.save_bundle(out_dir, meta, specs)` and `heads.load_bundle(bundle_dir) -> (meta, specs)`
  - `LinearHeads(bundle_dir, device)`, with `.version: int` and `.predict(views) -> VisionOutput`
  - `calibration.fit_temperature(logits, y) -> float`; `calibration.ece(probs, y, bins=15) -> float`; `calibration.abstain_threshold(conf, correct, target) -> (tau, coverage)`

**Data prerequisite:** fabric features exist from the preliminary probe
(`data/features/fabric/dinov2_vitb14_224`). Fibre features are produced in Step 7.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner_calibration.py
"""Calibration maths (spec §6.3). Skipped without numpy."""

import pytest

np = pytest.importorskip("numpy")

from training.scanner.calibration import abstain_threshold, ece, fit_temperature  # noqa: E402


def test_temperature_recovers_known_overconfidence():
    rng = np.random.default_rng(0)
    true = rng.normal(size=(4000, 5)) * 2
    p = np.exp(true) / np.exp(true).sum(1, keepdims=True)
    y = np.array([rng.choice(5, p=row) for row in p])
    assert fit_temperature(3.0 * true, y) == pytest.approx(3.0, rel=0.1)


def test_ece_is_small_when_calibrated_and_large_when_not():
    rng = np.random.default_rng(1)
    conf = rng.uniform(0.5, 1.0, 20000)
    correct = rng.uniform(size=conf.size) < conf
    probs = np.stack([conf, 1 - conf], 1)
    y = np.where(correct, 0, 1)
    assert ece(probs, y) < 0.02
    assert ece(probs, np.ones_like(y)) > 0.4


@pytest.mark.parametrize(
    "target,expected",
    [(0.75, (0.6, 1.0)), (0.9, (0.8, 0.5))],
)
def test_threshold_is_the_lowest_that_meets_the_target(target, expected):
    conf = np.array([0.9, 0.8, 0.7, 0.6])
    correct = np.array([1, 1, 0, 1], bool)
    assert abstain_threshold(conf, correct, target) == pytest.approx(expected)


def test_tied_confidences_are_kept_together():
    # Cutting between the two 0.8s would promise accuracy the threshold cannot deliver.
    conf = np.array([0.9, 0.8, 0.8])
    correct = np.array([1, 1, 0], bool)
    assert abstain_threshold(conf, correct, 0.9) == pytest.approx((0.9, 1 / 3))


def test_unreachable_target_abstains_on_everything():
    tau, coverage = abstain_threshold(np.array([0.9, 0.8]), np.array([0, 0], bool), 0.9)
    assert tau > 1.0 and coverage == 0.0
```

```python
# tests/test_scanner_heads.py
"""Calibrated heads and the bundle format (spec §6). Skipped without numpy/safetensors."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("safetensors")

from services.vision.heads import HeadSpec, apply_head, load_bundle, save_bundle  # noqa: E402


def _spec(threshold=0.5, temperature=1.0):
    # Two features, three classes; feature 0 votes for "a", feature 1 for "b".
    w = np.array([[4.0, 0.0], [0.0, 4.0], [0.0, 0.0]], np.float32)
    return HeadSpec(("a", "b", "c"), w, np.zeros(3, np.float32), temperature, threshold)


def test_confident_prediction_with_sorted_topk():
    out = apply_head(np.array([[1.0, 0.0]], np.float32), _spec())
    assert out.label == "a" and out.confidence > 0.9
    assert [c for c, _ in out.topk] == ["a", "b", "c"]


def test_below_threshold_returns_none_not_a_guess():
    assert apply_head(np.array([[1.0, 0.0]], np.float32), _spec(threshold=0.999)) is None


def test_temperature_softens_confidence():
    f = np.array([[1.0, 0.0]], np.float32)
    assert apply_head(f, _spec(temperature=4.0)).confidence < apply_head(f, _spec()).confidence


def test_views_are_averaged():
    both = np.array([[1.0, 0.0], [0.0, 1.0]], np.float32)  # views disagree evenly
    assert apply_head(both, _spec(threshold=0.6)) is None


def test_bundle_round_trip(tmp_path):
    meta = {"version": 3, "backbone": {"timm_name": "x", "img_size": 224, "crop_pct": 0.875,
                                       "mean": [0.5] * 3, "std": [0.2] * 3}}
    save_bundle(tmp_path, meta, {"structure": _spec(threshold=0.7, temperature=1.5)})
    meta2, specs = load_bundle(tmp_path)
    assert meta2["version"] == 3
    s = specs["structure"]
    assert s.classes == ("a", "b", "c") and s.threshold == 0.7 and s.temperature == 1.5
    assert np.array_equal(s.weight, _spec().weight)
```

```python
# tests/test_scanner_backbone.py
"""Serving preprocessing must equal the transform the cached features were made with."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("albumentations")
pytest.importorskip("cv2")

from services.vision.backbone import preprocess  # noqa: E402
from training.textilenet.train import build_transforms  # noqa: E402

MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


@pytest.mark.parametrize("shape", [(300, 400, 3), (512, 256, 3), (224, 224, 3)])
def test_preprocess_matches_the_training_eval_transform(shape):
    img = (np.random.default_rng(0).random(shape) * 255).astype(np.uint8)
    _, eval_tf = build_transforms(224, MEAN, STD, 0.875)
    expected = eval_tf(image=img)["image"].numpy()
    got = preprocess(img, MEAN, STD)
    assert got.shape == (3, 224, 224)
    assert np.abs(got - expected).max() < 1e-4
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_scanner_calibration.py tests/test_scanner_heads.py tests/test_scanner_backbone.py -v`
Expected: collection ERRORs (`No module named 'training.scanner'`, `services.vision.heads`, `services.vision.backbone`)

- [ ] **Step 3: Implement backbone and heads**

```python
# services/vision/backbone.py
"""DINOv2 features exactly as the heads were trained on them. Spec §6.2."""

from __future__ import annotations

import numpy as np

TIMM_NAME = "vit_base_patch14_dinov2.lvd142m"
IMG_SIZE = 224
CROP_PCT = 0.875


def pool_features(model, x):
    """[CLS ; mean(patch tokens)] for ViTs (the DINOv2 linear-eval feature); pooled
    pre-logits for other backbones."""
    tokens = model.forward_features(x)
    if tokens.ndim == 3:
        import torch

        prefix = getattr(model, "num_prefix_tokens", 1)
        return torch.cat([tokens[:, 0], tokens[:, prefix:].mean(1)], dim=1)
    return model.forward_head(tokens, pre_logits=True)


def preprocess(view: np.ndarray, mean, std, img_size: int = IMG_SIZE,
               crop_pct: float = CROP_PCT) -> np.ndarray:
    """HWC uint8 -> CHW float32. Shorter side to img_size/crop_pct, centre crop, normalise:
    the same as the albumentations eval transform the cached features used (pinned by
    tests/test_scanner_backbone.py)."""
    import cv2

    h, w = view.shape[:2]
    target = int(round(img_size / crop_pct))
    scale = target / min(h, w)
    nh, nw = max(target, int(round(h * scale))), max(target, int(round(w * scale)))
    resized = cv2.resize(view, (nw, nh), interpolation=cv2.INTER_LINEAR)
    y0, x0 = (nh - img_size) // 2, (nw - img_size) // 2
    crop = resized[y0:y0 + img_size, x0:x0 + img_size].astype(np.float32) / 255.0
    crop = (crop - np.asarray(mean, np.float32)) / np.asarray(std, np.float32)
    return np.ascontiguousarray(crop.transpose(2, 0, 1))
```

If `test_preprocess_matches_the_training_eval_transform` fails by exactly one row or column
of offset, albumentations rounds the resize differently. Read
`albumentations/augmentations/geometric/functional.py:smallest_max_size` and copy its
rounding here. The test is the spec.

```python
# services/vision/heads.py
"""Calibrated linear heads on DINOv2 features. Spec §6.

Below its threshold a head returns None: the scan abstains rather than guess.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from services.vision import runtime  # noqa: F401 -- Metal caps set before torch is imported
from services.vision.predictor import HeadOutput, VisionOutput

HEAD_NAMES = ("structure", "treatment", "fibre_family")


@dataclass(frozen=True)
class HeadSpec:
    classes: tuple[str, ...]
    weight: np.ndarray  # (C, D) float32, applies to raw (unstandardised) features
    bias: np.ndarray  # (C,)
    temperature: float
    threshold: float


def softmax(logits: np.ndarray, t: float = 1.0) -> np.ndarray:
    z = logits / t
    z = z - z.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def apply_head(features: np.ndarray, spec: HeadSpec, k: int = 5) -> HeadOutput | None:
    """Features (V, D) of one garment's views -> calibrated prediction, or None if unsure."""
    probs = softmax(features @ spec.weight.T + spec.bias, spec.temperature).mean(0)
    i = int(probs.argmax())
    if probs[i] < spec.threshold:
        return None
    topk = [(spec.classes[j], float(probs[j])) for j in np.argsort(-probs, kind="stable")[:k]]
    return HeadOutput(spec.classes[i], float(probs[i]), topk)


def save_bundle(out_dir: Path, meta: dict, specs: dict[str, HeadSpec]) -> None:
    from safetensors.numpy import save_file

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tensors = {}
    heads_meta = dict(meta.get("heads", {}))
    for name, s in specs.items():
        tensors[f"{name}.weight"] = np.ascontiguousarray(s.weight, np.float32)
        tensors[f"{name}.bias"] = np.ascontiguousarray(s.bias, np.float32)
        heads_meta[name] = {**heads_meta.get(name, {}), "classes": list(s.classes),
                            "temperature": float(s.temperature), "threshold": float(s.threshold)}
    save_file(tensors, str(out_dir / "heads.safetensors"))
    (out_dir / "bundle.json").write_text(json.dumps({**meta, "heads": heads_meta}, indent=1))


def load_bundle(bundle_dir: Path) -> tuple[dict, dict[str, HeadSpec]]:
    from safetensors.numpy import load_file

    bundle_dir = Path(bundle_dir)
    meta = json.loads((bundle_dir / "bundle.json").read_text())
    tensors = load_file(str(bundle_dir / "heads.safetensors"))
    specs = {
        name: HeadSpec(tuple(h["classes"]), tensors[f"{name}.weight"], tensors[f"{name}.bias"],
                       float(h["temperature"]), float(h["threshold"]))
        for name, h in meta["heads"].items()
    }
    return meta, specs


class LinearHeads:
    """The FabricHeads unit: views -> VisionOutput. Missing heads (e.g. treatment) are None."""

    def __init__(self, bundle_dir: Path, device):
        import timm
        import torch

        self.meta, self.specs = load_bundle(bundle_dir)
        self.version = int(self.meta["version"])
        bb = self.meta["backbone"]
        self.mean, self.std = bb["mean"], bb["std"]
        self.img_size, self.crop_pct = bb["img_size"], bb["crop_pct"]
        self.device, self._torch = device, torch
        self.half = device.type in ("mps", "cuda")
        model = timm.create_model(bb["timm_name"], pretrained=True, num_classes=0,
                                  img_size=bb["img_size"]).eval().to(device)
        self.model = model.half() if self.half else model

    def predict(self, views: list[np.ndarray]) -> VisionOutput:
        from services.vision.backbone import pool_features, preprocess

        x = np.stack([preprocess(v, self.mean, self.std, self.img_size, self.crop_pct)
                      for v in views])
        t = self._torch.from_numpy(x).to(self.device)
        with self._torch.no_grad():
            f = pool_features(self.model, t.half() if self.half else t).float().cpu().numpy()
        out = {n: (apply_head(f, self.specs[n]) if n in self.specs else None) for n in HEAD_NAMES}
        return VisionOutput(**out)
```

In `training/textilenet/probe.py`: delete the local `pool` function and import it
instead: `from services.vision.backbone import pool_features as pool`. Move the grid to
module level as `GRID = list(itertools.product([1e-3, 3e-3], [1e-4, 1e-3, 1e-2, 5e-2]))`
and use `for lr, wd in GRID:` in `main()`.

- [ ] **Step 4: Implement calibration**

```python
# training/scanner/__init__.py
```

```python
# training/scanner/calibration.py
"""Temperature scaling, calibration error and abstain thresholds. Spec §6.3. numpy only."""

from __future__ import annotations

import math

import numpy as np

from services.vision.heads import softmax

NEVER = 1.01  # a threshold no confidence reaches: abstain on everything


def nll(logits: np.ndarray, y: np.ndarray, t: float) -> float:
    p = softmax(logits, t)
    return float(-np.log(p[np.arange(len(y)), y] + 1e-12).mean())


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    """T minimising validation NLL; golden-section search over log T in [log 0.05, log 20]."""
    lo, hi = math.log(0.05), math.log(20.0)
    g = (math.sqrt(5) - 1) / 2
    a, b = hi - g * (hi - lo), lo + g * (hi - lo)
    fa, fb = nll(logits, y, math.exp(a)), nll(logits, y, math.exp(b))
    for _ in range(60):
        if fa < fb:
            hi, b, fb = b, a, fa
            a = hi - g * (hi - lo)
            fa = nll(logits, y, math.exp(a))
        else:
            lo, a, fa = a, b, fb
            b = lo + g * (hi - lo)
            fb = nll(logits, y, math.exp(b))
    return math.exp((lo + hi) / 2)


def ece(probs: np.ndarray, y: np.ndarray, bins: int = 15) -> float:
    conf = probs.max(1)
    correct = probs.argmax(1) == y
    total = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(total)


def abstain_threshold(conf: np.ndarray, correct: np.ndarray, target: float) -> tuple[float, float]:
    """Lowest τ whose kept predictions (conf ≥ τ) are at least ``target`` accurate.

    Tied confidences stay together: a cut can only fall between distinct values.
    Returns (τ, coverage); (NEVER, 0.0) if no τ meets the target."""
    order = np.argsort(-conf, kind="stable")
    c_sorted, ok_sorted = conf[order], correct[order].astype(float)
    cumacc = np.cumsum(ok_sorted) / np.arange(1, len(ok_sorted) + 1)
    group_ends = np.nonzero(np.append(c_sorted[1:] != c_sorted[:-1], True))[0]
    good = group_ends[cumacc[group_ends] >= target]
    if good.size == 0:
        return NEVER, 0.0
    k = int(good.max())
    return float(c_sorted[k]), (k + 1) / len(c_sorted)
```

- [ ] **Step 5: Run the unit tests**

Run: `.venv/bin/python -m pytest tests/test_scanner_calibration.py tests/test_scanner_heads.py tests/test_scanner_backbone.py -v`
Expected: 14 passed

- [ ] **Step 6: Implement the head fitter**

```python
# training/scanner/fit_heads.py
"""Fit the scanner's structure and fibre-family heads on cached DINOv2 features. Spec §6.

    python -m training.scanner.fit_heads --fabric-split data/splits/prelim/fabric.csv \
        --fibre-split data/splits/prelim/fibre.csv --out models/scanner-v1 --version 1

Selection and calibration use val only; test metrics are reported, never tuned on.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import torch

from services.vision.backbone import CROP_PCT, IMG_SIZE, TIMM_NAME
from services.vision.heads import HeadSpec, save_bundle, softmax
from services.vision.runtime import pick_device
from services.vision.taxonomy import FABRIC_CLASSES, family_of
from training.scanner.calibration import abstain_threshold, ece, fit_temperature
from training.textilenet.feature_cache import FeatureCache
from training.textilenet.metrics import summarize
from training.textilenet.probe import GRID, fit_linear
from training.textilenet.splits import read_csv

FAMILIES_TRAINED = ("cellulosic", "protein", "synthetic")  # no blend images exist (spec §6.1)
IMAGENET_MEAN, IMAGENET_STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


def load_xy(split_csv: Path, partition: str, feature_dir: Path, classes, label_of):
    rows = read_csv(split_csv)
    cache = FeatureCache(feature_dir / partition / f"dinov2_vitb14_{IMG_SIZE}")
    missing = cache.missing([r.path for r in rows])
    if missing:
        raise SystemExit(f"{len(missing)} {partition} images have no cached features; run "
                         f"training.textilenet.probe on {split_csv} first")
    x = cache.assemble([r.path for r in rows]).astype(np.float32)
    y = np.array([classes.index(label_of(r.label)) for r in rows])
    split = np.array([r.split for r in rows])
    return {s: (x[split == s], y[split == s]) for s in ("train", "val", "test")}


def fit_head(data, classes, device, epochs: int, target: float) -> tuple[HeadSpec, dict]:
    (xtr, ytr), (xva, yva), (xte, yte) = data["train"], data["val"], data["test"]
    mu, sd = xtr.mean(0), xtr.std(0) + 1e-6
    t = lambda a: torch.from_numpy((a - mu) / sd).to(device)  # noqa: E731
    tr, va = (t(xtr), torch.from_numpy(ytr).to(device)), t(xva)
    best = None
    for lr, wd in GRID:
        head = fit_linear(*tr, len(classes), lr, wd, epochs, 0, device)
        with torch.no_grad():
            acc = (head(va).argmax(1).cpu().numpy() == yva).mean()
        if best is None or acc > best[0]:
            best = (acc, lr, wd, head)
    _, lr, wd, head = best
    w = head.weight.detach().cpu().numpy() / sd  # fold standardisation into the head
    b = head.bias.detach().cpu().numpy() - (head.weight.detach().cpu().numpy() * (mu / sd)).sum(1)
    logits_va, logits_te = xva @ w.T + b, xte @ w.T + b
    temp = fit_temperature(logits_va, yva)
    p_va = softmax(logits_va, temp)
    tau, coverage = abstain_threshold(p_va.max(1), p_va.argmax(1) == yva, target)
    spec = HeadSpec(tuple(classes), w.astype(np.float32), b.astype(np.float32), temp, tau)
    info = {
        "lr": lr, "wd": wd, "target_accuracy": target, "coverage_val": coverage,
        "ece_val_before": ece(softmax(logits_va), yva), "ece_val_after": ece(p_va, yva),
        "val": {k: v for k, v in summarize(logits_va, yva, list(classes)).items()
                if k in ("top1", "top5", "macro_f1", "n")},
        "test": {k: v for k, v in summarize(logits_te, yte, list(classes)).items()
                 if k in ("top1", "top5", "macro_f1", "n")},
    }
    return spec, info


def sha1(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--fabric-split", type=Path, required=True)
    ap.add_argument("--fibre-split", type=Path, required=True)
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features"))
    ap.add_argument("--out", type=Path, default=Path("models/scanner-v1"))
    ap.add_argument("--version", type=int, default=1)
    ap.add_argument("--target", type=float, default=0.90, help="val accuracy among kept predictions")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    device = pick_device(args.device)

    fabric = load_xy(args.fabric_split, "fabric", args.feature_dir, list(FABRIC_CLASSES), str)
    fibre = load_xy(args.fibre_split, "fibre", args.feature_dir, list(FAMILIES_TRAINED), family_of)
    specs, infos = {}, {}
    for name, data, classes in (("structure", fabric, FABRIC_CLASSES),
                                ("fibre_family", fibre, FAMILIES_TRAINED)):
        specs[name], infos[name] = fit_head(data, classes, device, args.epochs, args.target)
        print(name, json.dumps({k: infos[name][k] for k in ("val", "test", "coverage_val")}))

    meta = {
        "version": args.version, "created": date.today().isoformat(),
        "backbone": {"timm_name": TIMM_NAME, "img_size": IMG_SIZE, "crop_pct": CROP_PCT,
                     "mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD)},
        "views": "crop",
        "splits": {"fabric": {"path": str(args.fabric_split), "sha1": sha1(args.fabric_split)},
                   "fibre": {"path": str(args.fibre_split), "sha1": sha1(args.fibre_split)}},
        "heads": infos,
    }
    save_bundle(args.out, meta, specs)
    card = [f"# scanner-v{args.version}", "", f"Created {meta['created']}. Frozen DINOv2 "
            "ViT-B/14 + calibrated linear heads. Catalog-domain numbers (TextileNet).", ""]
    for name, info in infos.items():
        card.append(f"- **{name}**: test top-1 {info['test']['top1']:.3f}, val coverage "
                    f"{info['coverage_val']:.2f} at {info['target_accuracy']:.0%} target, "
                    f"ECE {info['ece_val_before']:.3f} → {info['ece_val_after']:.3f}")
    card += ["", "Limitations: trained on catalog photos, not phone photos; fibre family "
             "has no blend class (blends come from the label)."]
    (args.out / "MODEL_CARD.md").write_text("\n".join(card) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Produce fibre features, then fit the bundle** (long: governed, one heavy job at a time)

Wait until the fabric probe has finished (`grep TEST data/logs/probe-fabric-prelim.log`).
Then run:

```bash
python3 -m training.textilenet.prepare_data index --partition fibre --train-sources archive \
  --out data/splits/prelim/fibre.csv
caffeinate -ims .venv/bin/python -m training.textilenet.probe --partition fibre \
  --split-csv data/splits/prelim/fibre.csv --tag probe_dinov2_vitb14_prelim
.venv/bin/python -m training.scanner.fit_heads --fabric-split data/splits/prelim/fabric.csv \
  --fibre-split data/splits/prelim/fibre.csv --out models/scanner-v1 --version 1
```

Expected: `wrote models/scanner-v1`, containing `bundle.json`, `heads.safetensors` and
`MODEL_CARD.md`. Structure test top-1 should be well above 0.67 (the published
baseline). Record the printed numbers in the commit message.

- [ ] **Step 8: Run all tests, then commit**

Run: `.venv/bin/python -m pytest && .venv/bin/ruff check .`
Expected: all pass

```bash
git add services/vision/backbone.py services/vision/heads.py training/scanner \
  training/textilenet/probe.py tests/test_scanner_calibration.py tests/test_scanner_heads.py \
  tests/test_scanner_backbone.py
git commit -m "Fit calibrated structure and fibre-family heads into scanner-v1"
```

---

### Task 7: ScannerPredictor

**Files:**
- Modify: `services/vision/predictor.py`
- Create: `services/vision/scanner.py`
- Test: `tests/test_scanner_predictor.py`

**Interfaces:**
- Consumes: `decode_image` (1), `choose_primary`, `Detection` (2), `load_detector` (3), `Sam2Segmenter`, `box_mask` (4), `FabricCropper` (5), `LinearHeads` (6).
- Produces:
  - `GarmentOutput(label: str, confidence: float | None, box: tuple[float, float, float, float])` (normalised 0–1)
  - `Note(code: str, message: str)`
  - `VisionOutput(structure, treatment, fibre_family, garment=None, notes=())`
  - `ScannerPredictor(detector, segmenter, cropper, heads, min_det_score=None).predict(image_bytes) -> VisionOutput`, raising `UnsupportedImage` on undecodable bytes
  - `build_scanner(bundle_dir, detector_name, device, patches=False) -> ScannerPredictor`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner_predictor.py
"""The composed scanner with fake parts. Skipped without numpy/PIL (CI core)."""

import io

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.errors import UnsupportedImage  # noqa: E402
from services.vision.garment import Detection  # noqa: E402
from services.vision.predictor import HeadOutput, VisionOutput  # noqa: E402
from services.vision.scanner import ScannerPredictor  # noqa: E402


def _jpeg(w=200, h=100):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "gray").save(buf, format="JPEG")
    return buf.getvalue()


class Det:
    name, default_min_score = "fake", 0.3

    def __init__(self, dets=(), error=None):
        self.dets, self.error = list(dets), error

    def detect(self, image):
        if self.error:
            raise self.error
        return self.dets


class Seg:
    def __init__(self, error=None):
        self.error = error

    def segment(self, image, box):
        if self.error:
            raise self.error
        m = np.zeros(image.shape[:2], bool)
        m[10:90, 50:150] = True
        return m


class Crop:
    def __init__(self):
        self.masks = []

    def views(self, image, mask):
        self.masks.append(mask)
        return [image[:10, :10]]


class Heads:
    def __init__(self, error=None):
        self.views, self.error = [], error

    def predict(self, views):
        if self.error:
            raise self.error
        self.views.append(views)
        return VisionOutput(HeadOutput("denim", 0.9, []), None, None)


def _scanner(det=None, seg=None, heads=None, crop=None):
    return ScannerPredictor(det or Det([Detection("pants", 0.8, (50, 10, 150, 90))]),
                            seg or Seg(), crop or Crop(), heads or Heads())


def test_garment_found_cut_out_and_classified():
    heads = Heads()
    out = _scanner(heads=heads).predict(_jpeg())
    assert out.structure.label == "denim"
    assert out.garment.label == "pants"
    assert out.garment.box == pytest.approx((0.25, 0.1, 0.75, 0.9))
    assert out.notes == ()
    assert heads.views[0][0].shape == (10, 10, 3)  # the cropper's view, not the frame


def test_no_garment_classifies_the_whole_photo_and_says_so():
    heads = Heads()
    out = _scanner(det=Det([]), heads=heads).predict(_jpeg())
    assert out.garment is None
    assert [n.code for n in out.notes] == ["NO_GARMENT_DETECTED"]
    assert heads.views[0][0].shape == (100, 200, 3)


def test_detection_below_threshold_counts_as_no_garment():
    out = _scanner(det=Det([Detection("pants", 0.1, (50, 10, 150, 90))])).predict(_jpeg())
    assert out.garment is None


def test_failing_detector_abstains_with_a_reason_instead_of_crashing():
    out = _scanner(det=Det(error=RuntimeError("boom"))).predict(_jpeg())
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED", "NO_GARMENT_DETECTED"]
    assert "garment detector" in out.notes[0].message


def test_failing_segmenter_falls_back_to_the_box():
    crop = Crop()
    out = _scanner(seg=Seg(error=RuntimeError("x")), crop=crop).predict(_jpeg())
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED"]
    assert crop.masks[0][10:90, 50:150].all() and crop.masks[0].sum() == 80 * 100


def test_failing_heads_leave_every_head_empty():
    out = _scanner(heads=Heads(error=RuntimeError("x"))).predict(_jpeg())
    assert out.structure is None and out.fibre_family is None
    assert out.garment.label == "pants"
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED"]


def test_undecodable_upload_is_rejected():
    with pytest.raises(UnsupportedImage):
        _scanner().predict(b"not an image")
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_scanner_predictor.py -v`
Expected: collection ERROR, `No module named 'services.vision.scanner'`

- [ ] **Step 3: Extend the vision types** (in `services/vision/predictor.py`, replacing the
`VisionOutput` dataclass; `HeadOutput`, `Predictor` and `StubPredictor` are unchanged)

```python
@dataclass(frozen=True)
class GarmentOutput:
    label: str  # services.vision.garment.GARMENT_VOCAB key
    confidence: float | None  # None for detectors without scores
    box: tuple[float, float, float, float]  # normalised 0-1 (x0, y0, x1, y1)


@dataclass(frozen=True)
class Note:
    """Why a scan abstained or degraded; surfaces as an `info` flag."""

    code: str  # NO_GARMENT_DETECTED | COMPONENT_FAILED
    message: str


@dataclass(frozen=True)
class VisionOutput:
    structure: HeadOutput | None
    treatment: HeadOutput | None
    fibre_family: HeadOutput | None
    garment: GarmentOutput | None = None
    notes: tuple[Note, ...] = ()
```

- [ ] **Step 4: Implement the scanner**

```python
# services/vision/scanner.py
"""Detector -> segmenter -> cropper -> heads, as the API's Predictor. Spec §3, §4.

A failing model degrades the scan and says why (COMPONENT_FAILED); it never 500s and
never guesses.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path

from services.vision.garment import choose_primary
from services.vision.imageio import decode_image
from services.vision.predictor import GarmentOutput, Note, VisionOutput

log = logging.getLogger(__name__)


class ScannerPredictor:
    def __init__(self, detector, segmenter, cropper, heads, min_det_score: float | None = None):
        self.detector, self.segmenter, self.cropper, self.heads = detector, segmenter, cropper, heads
        self.min_det_score = (detector.default_min_score if min_det_score is None
                              else min_det_score)

    def predict(self, image_bytes: bytes) -> VisionOutput:
        from services.vision.segment import box_mask

        image = decode_image(image_bytes)  # UnsupportedImage propagates -> HTTP 422
        h, w = image.shape[:2]
        notes: list[Note] = []
        dets = self._try(notes, "garment detector", lambda: self.detector.detect(image)) or []
        primary = choose_primary(dets, w, h, self.min_det_score)
        garment = None
        if primary is None:
            notes.append(Note("NO_GARMENT_DETECTED",
                              "No garment found; the whole photo was classified."))
            views = [image]
        else:
            x0, y0, x1, y1 = primary.box
            garment = GarmentOutput(primary.label, primary.score, (x0 / w, y0 / h, x1 / w, y1 / h))
            mask = self._try(notes, "segmenter", lambda: self.segmenter.segment(image, primary.box))
            if mask is None:
                mask = box_mask((h, w), primary.box)
            views = self._try(notes, "cropper", lambda: self.cropper.views(image, mask)) or [image]
        heads = self._try(notes, "fabric heads", lambda: self.heads.predict(views))
        return replace(heads or VisionOutput(None, None, None), garment=garment, notes=tuple(notes))

    @staticmethod
    def _try(notes: list[Note], component: str, fn):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 -- a failing model must abstain, not crash
            log.exception("%s failed", component)
            notes.append(Note("COMPONENT_FAILED", f"{component} failed: {type(e).__name__}"))
            return None


def build_scanner(bundle_dir: Path, detector_name: str, device, patches: bool = False):
    from services.vision.crop import FabricCropper
    from services.vision.detectors import load_detector
    from services.vision.heads import LinearHeads
    from services.vision.segment import Sam2Segmenter

    return ScannerPredictor(load_detector(detector_name, device), Sam2Segmenter(device),
                            FabricCropper(patches), LinearHeads(bundle_dir, device))
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_scanner_predictor.py tests/test_consistency.py tests/test_api.py -v`
Expected: all pass (the existing `VisionOutput(None, None, None)` calls still work)

- [ ] **Step 6: Commit**

```bash
git add services/vision/predictor.py services/vision/scanner.py tests/test_scanner_predictor.py
git commit -m "Compose detector, segmenter, cropper and heads into the ScannerPredictor"
```

---

### Task 8: OCR engine interface and Apple Vision

**Files:**
- Create: `services/ocr/engines/__init__.py`, `services/ocr/engines/base.py`, `services/ocr/engines/apple.py`
- Test: `tests/test_ocr_engines.py`, `tests/test_slow_ocr_apple.py`

**Interfaces:**
- Produces: `TextLine(text: str, confidence: float, box: tuple[float, float, float, float])` (pixels, top-left origin); `OcrEngine` protocol (`name: str`, `read(image: np.ndarray) -> list[TextLine]`); `load_engine(name) -> OcrEngine` for `"apple" | "paddle"`; `vision_box_to_pixels(x, y, w, h, width, height) -> tuple`.

Verified 2026-09-27: PyObjC `VNRecognizeTextRequest` read `"SHELL: 80% PA 20% EA"`
exactly with language correction off. Boxes are normalised with the origin at the
bottom-left. The first call takes ~44 s (model load), later calls 0.03–0.14 s, hence the
startup warm-up.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ocr_engines.py
"""Engine plumbing that needs no OCR model. Stdlib only."""

import pytest

from services.ocr.engines.apple import vision_box_to_pixels
from services.ocr.engines.base import TextLine


def test_vision_boxes_become_top_left_pixel_boxes():
    # Vision: normalised, origin bottom-left. A line in the top quarter of a 200x100 image.
    assert vision_box_to_pixels(0.1, 0.75, 0.5, 0.2, 200, 100) == pytest.approx(
        (20.0, 5.0, 120.0, 25.0)
    )


def test_textline_is_a_plain_value():
    assert TextLine("60% COTTON", 0.9, (0, 0, 1, 1)) == TextLine("60% COTTON", 0.9, (0, 0, 1, 1))
```

```python
# tests/test_slow_ocr_apple.py
"""Apple Vision on a rendered care label. `pytest -m slow`, macOS only."""

import platform

import pytest

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(platform.system() != "Darwin", reason="Apple Vision is macOS only"),
]


def _label():
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (900, 220), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 40)
    d.text((30, 30), "SHELL: 80% PA 20% EA", fill="black", font=font)
    d.text((30, 120), "LINING: 100% PES", fill="black", font=font)
    return np.asarray(img)


def test_reads_fibre_codes_verbatim_in_reading_order():
    from services.ocr.engines import load_engine

    lines = load_engine("apple").read(_label())
    texts = [line.text for line in sorted(lines, key=lambda l: l.box[1])]
    assert texts == ["SHELL: 80% PA 20% EA", "LINING: 100% PES"]
    assert all(line.confidence > 0.5 for line in lines)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_ocr_engines.py -v`
Expected: collection ERROR, `No module named 'services.ocr.engines'`

- [ ] **Step 3: Implement**

```python
# services/ocr/engines/base.py
"""What every OCR engine returns. Stdlib only."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import numpy as np


@dataclass(frozen=True)
class TextLine:
    text: str
    confidence: float  # 0-1
    box: tuple[float, float, float, float]  # pixels (x0, y0, x1, y1), origin top-left


class OcrEngine(Protocol):
    name: str

    def read(self, image: np.ndarray) -> list[TextLine]: ...
```

```python
# services/ocr/engines/__init__.py
"""OCR engines. Spec §5.1. Heavy imports stay inside each backend."""

from __future__ import annotations

from services.ocr.engines.base import OcrEngine, TextLine

__all__ = ["OcrEngine", "TextLine", "load_engine"]


def load_engine(name: str) -> OcrEngine:
    if name == "apple":
        from services.ocr.engines.apple import AppleVisionEngine

        return AppleVisionEngine()
    if name == "paddle":
        from services.ocr.engines.paddle import PaddleEngine

        return PaddleEngine()
    raise ValueError(f"unknown OCR engine {name!r}; week 1 ships 'apple' and 'paddle'")
```

```python
# services/ocr/engines/apple.py
"""Apple Vision text recognition via PyObjC. Spec §5.1, engine 2. macOS only."""

from __future__ import annotations

import io

from services.ocr.engines.base import TextLine

LANGUAGES = ("en-US", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR")


def vision_box_to_pixels(x: float, y: float, w: float, h: float, width: float,
                         height: float) -> tuple[float, float, float, float]:
    """Vision boxes are normalised with the origin bottom-left; ours are pixels, top-left."""
    return (x * width, (1 - y - h) * height, (x + w) * width, (1 - y) * height)


class AppleVisionEngine:
    name = "apple"

    def __init__(self, languages: tuple[str, ...] = LANGUAGES):
        import numpy as np
        import Quartz
        import Vision
        from Foundation import NSData

        self._quartz, self._vision, self._nsdata = Quartz, Vision, NSData
        self.languages = list(languages)
        # The first request loads the recognition model (~40 s cold). Pay it at startup.
        self.read(np.full((32, 128, 3), 255, np.uint8))

    def read(self, image) -> list[TextLine]:
        from PIL import Image

        h, w = image.shape[:2]
        buf = io.BytesIO()
        Image.fromarray(image).save(buf, format="PNG")
        png = buf.getvalue()
        data = self._nsdata.dataWithBytes_length_(png, len(png))
        source = self._quartz.CGImageSourceCreateWithData(data, None)
        cg = self._quartz.CGImageSourceCreateImageAtIndex(source, 0, None)
        req = self._vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(self._vision.VNRequestTextRecognitionLevelAccurate)
        req.setUsesLanguageCorrection_(False)  # it would "correct" EA, PES, PA into words
        req.setRecognitionLanguages_(self.languages)
        handler = self._vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
        ok, err = handler.performRequests_error_([req], None)
        if not ok:
            raise RuntimeError(f"Vision text request failed: {err}")
        lines = []
        for obs in req.results() or []:
            candidates = obs.topCandidates_(1)
            if not candidates:
                continue
            c, bb = candidates[0], obs.boundingBox()
            lines.append(TextLine(str(c.string()), float(c.confidence()),
                                  vision_box_to_pixels(bb.origin.x, bb.origin.y, bb.size.width,
                                                       bb.size.height, w, h)))
        return lines
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_ocr_engines.py -v`
Expected: 2 passed
Run: `.venv/bin/python -m pytest -m slow tests/test_slow_ocr_apple.py -v`
Expected: 1 passed (~45 s the first time, then fast)

- [ ] **Step 5: Commit**

```bash
git add services/ocr/engines tests/test_ocr_engines.py tests/test_slow_ocr_apple.py
git commit -m "Read care labels with Apple Vision, autocorrect off"
```

---

### Task 9: Normaliser and parser fixes, and the CompositionExtractor

**Files:**
- Modify: `services/ocr/normalizer.py`, `services/ocr/parser.py`
- Create: `services/ocr/extract.py`
- Test: `tests/test_ocr.py` (additions), `tests/test_ocr_extract.py`

**Interfaces:**
- Consumes: `TextLine`, `OcrEngine` (Task 8).
- Produces: `normalizer.fold_text(text) -> str` (accents stripped, ß→ss);
  `Extraction(fibers: list[FiberPct] | None, section: str | None = None, confidence: float | None = None, reason: str | None = None)`
  where `reason` is `"NO_LABEL_TEXT" | "UNREADABLE"` when `fibers` is None;
  `reading_order(lines)`; `extract(lines) -> Extraction`;
  `read_composition(engine, image) -> Extraction`.

- [ ] **Step 1: Write the failing parser and normaliser tests** (append to `tests/test_ocr.py`)

```python
import pytest  # add to the imports at the top of tests/test_ocr.py


def test_pa_is_polyamide_not_acrylic():
    # ISO 2076 / EU Reg. 1007/2011: PA is polyamide (nylon); acrylic is PAN.
    assert normalize_fiber_name("PA") == "nylon"
    assert normalize_fiber_name("PAN") == "acrylic"


@pytest.mark.parametrize(
    "raw,canonical",
    [
        ("coton", "cotton"), ("baumwolle", "cotton"), ("algodón", "cotton"),
        ("cotone", "cotton"), ("katoen", "cotton"),
        ("poliéster", "polyester"), ("poliestere", "polyester"),
        ("élasthanne", "elastane_spandex"), ("elastano", "elastane_spandex"),
        ("elasthan", "elastane_spandex"),
        ("laine", "wool"), ("wolle", "wool"), ("lana", "wool"),
        ("soie", "silk"), ("seide", "silk"), ("seta", "silk"), ("seda", "silk"),
        ("leinen", "flax_linen"), ("lino", "flax_linen"), ("linho", "flax_linen"),
        ("viscosa", "viscose_rayon"), ("viskose", "viscose_rayon"),
        ("poliamida", "nylon"), ("poliammide", "nylon"), ("polyamid", "nylon"),
        ("acrílico", "acrylic"), ("acrylique", "acrylic"), ("polyacryl", "acrylic"),
    ],
)
def test_common_label_languages(raw, canonical):
    assert normalize_fiber_name(raw) == canonical


def test_accented_labels_parse():
    got = parse_composition("60% ALGODÓN 40% POLIÉSTER")
    assert [(f.name, f.pct) for f in got] == [("cotton", 60.0), ("polyester", 40.0)]


def test_trailing_words_after_a_fibre_are_ignored():
    got = parse_composition("100% COTTON MADE IN PAKISTAN")
    assert [(f.name, f.pct) for f in got] == [("cotton", 100.0)]


def test_leading_qualifiers_are_ignored():
    got = parse_composition("70% RECYCLED POLYESTER 30% ORGANIC COTTON")
    assert [(f.name, f.pct) for f in got] == [("polyester", 70.0), ("cotton", 30.0)]


def test_an_unknown_fibre_still_fails_the_whole_parse():
    assert parse_composition("70% ZZZFIBRE COTTON 30% COTTON") is None
```

- [ ] **Step 2: Write the failing extractor tests**

```python
# tests/test_ocr_extract.py
"""From OCR lines to one trustworthy composition (spec §5.3). Mostly stdlib."""

import pytest

from services.ocr.engines.base import TextLine
from services.ocr.extract import extract, reading_order


def L(text, row, x=0.0, conf=0.9):  # one OCR line on "row" (10 px rows)
    return TextLine(text, conf, (x, row * 10.0, x + 100.0, row * 10.0 + 8.0))


def fibres(ex):
    return [(f.name, f.pct) for f in ex.fibers] if ex.fibers else None


def test_single_line_label():
    ex = extract([L("60% COTTON 40% POLYESTER", 0)])
    assert fibres(ex) == [("cotton", 60.0), ("polyester", 40.0)] and ex.section is None


def test_composition_split_over_two_lines():
    assert fibres(extract([L("60% COTTON", 0), L("40% POLYESTER", 1)])) == [
        ("cotton", 60.0), ("polyester", 40.0)]


def test_shell_is_reported_even_when_lining_comes_first():
    ex = extract([L("LINING: 100% PES", 0), L("SHELL: 80% PA 20% EA", 1)])
    assert fibres(ex) == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.section == "shell"


def test_only_a_lining_composition_is_unreadable_not_a_guess():
    ex = extract([L("LINING: 100% POLYESTER", 0)])
    assert ex.fibers is None and ex.reason == "UNREADABLE"


def test_multilingual_repeats_agree_and_raise_confidence():
    ex = extract([L("80% POLYAMIDE 20% ELASTANE", 0), L("80% POLIAMIDA 20% ELASTANO", 1),
                  L("80% POLYAMID 20% ELASTHAN", 2)])
    assert fibres(ex) == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.confidence > 0.9


def test_disagreeing_compositions_are_unreadable():
    ex = extract([L("100% COTTON", 0), L("100% POLYESTER", 3)])
    assert ex.fibers is None and ex.reason == "UNREADABLE"


def test_text_without_composition_is_no_label_text():
    ex = extract([L("MADE IN PAKISTAN", 0), L("MACHINE WASH 30", 1)])
    assert ex.fibers is None and ex.reason == "NO_LABEL_TEXT"
    assert extract([]).reason == "NO_LABEL_TEXT"


def test_reading_order_rows_then_columns():
    lines = [L("B", 1, x=0), L("A2", 0, x=120), L("A1", 0, x=0)]
    assert [line.text for line in reading_order(lines)] == ["A1", "A2", "B"]


def test_sideways_label_is_read_after_rotation():
    np = pytest.importorskip("numpy")
    from services.ocr.extract import read_composition

    class SidewaysOnly:  # sees text only when the 20x40 image is turned to 40x20
        name = "fake"

        def read(self, image):
            return [L("100% COTTON", 0)] if image.shape[:2] == (40, 20) else []

    ex = read_composition(SidewaysOnly(), np.zeros((20, 40, 3), np.uint8))
    assert fibres(ex) == [("cotton", 100.0)]
```

- [ ] **Step 3: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_ocr.py tests/test_ocr_extract.py -v`
Expected: the new normaliser/parser tests FAIL (PA → acrylic, accents unknown); the
extractor tests ERROR (`No module named 'services.ocr.extract'`)

- [ ] **Step 4: Implement the normaliser and parser changes**

In `services/ocr/normalizer.py`: change `"pa": "acrylic"` to `"pa": "nylon"`, and add these
entries to `_CODEBOOK` (unaccented, because lookups are folded):

```python
    # Common label languages (FR, DE, ES, IT, NL, PT). Keys are accent-folded.
    "coton": "cotton", "baumwolle": "cotton", "algodon": "cotton", "cotone": "cotton",
    "katoen": "cotton",
    "poliester": "polyester", "poliestere": "polyester",
    "elasthanne": "elastane_spandex", "elastano": "elastane_spandex",
    "elasthan": "elastane_spandex",
    "laine": "wool", "wolle": "wool", "lana": "wool",
    "soie": "silk", "seide": "silk", "seta": "silk", "seda": "silk",
    "leinen": "flax_linen", "lino": "flax_linen", "linho": "flax_linen",
    "viscosa": "viscose_rayon", "viskose": "viscose_rayon",
    "poliamida": "nylon", "poliammide": "nylon", "polyamid": "nylon",
    "acrilico": "acrylic", "acrylique": "acrylic", "polyacryl": "acrylic",
```

and replace `normalize_fiber_name` with:

```python
import unicodedata  # at the top of the module


def fold_text(text: str) -> str:
    """Accents stripped and ß expanded, so ALGODÓN and algodon compare equal."""
    text = text.replace("ß", "ss").replace("ẞ", "SS")
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def normalize_fiber_name(raw: str) -> str | None:
    """Canonical fibre name, or ``None`` if unrecognised.

    ``None`` means *we do not know*, and callers must treat it as unreadable
    rather than dropping the component -- silently discarding an unknown fibre
    would let percentages sum to 100 and produce a confident wrong composition.
    """
    key = " ".join(fold_text(raw).strip().lower().replace(".", " ").split())
    if not key:
        return None
    return _CODEBOOK.get(key)
```

In `services/ocr/parser.py`, replace the two patterns and `_collect` with:

```python
_WORD = r"[^\W\d_]"  # any letter, accented included (A-Z missed ALGODÓN)
_NAME = rf"{_WORD}(?:{_WORD}|[\s\-]){{1,24}}"
_PCT_FIRST = re.compile(rf"(\d{{1,3}})\s*%\s*({_NAME})")
_NAME_FIRST = re.compile(rf"({_NAME}?)\s*[:\-]?\s*(\d{{1,3}})\s*%")

#: Words that qualify a fibre without changing it ("RECYCLED POLYESTER" is polyester).
_QUALIFIERS = frozenset({"recycled", "organic", "combed", "mercerised", "mercerized"})


def _fibre(name: str) -> str | None:
    """Canonical fibre at the start of a captured name. Trailing words are dropped one at a
    time ('COTTON MADE IN PAKISTAN' -> cotton); the first word must still name a fibre, so
    an unknown fibre still fails."""
    words = name.split()
    while words and words[0].lower() in _QUALIFIERS:
        words.pop(0)
    while words:
        canonical = normalize_fiber_name(" ".join(words))
        if canonical:
            return canonical
        words.pop()
    return None


def _collect(text: str) -> list[FiberPct] | None:
    """Best-effort extraction under both orderings; ``None`` if any name is unknown."""
    best: list[FiberPct] = []
    for pattern, pct_group in ((_PCT_FIRST, 1), (_NAME_FIRST, 2)):
        found: list[FiberPct] = []
        for m in pattern.finditer(text):
            name_group = 2 if pct_group == 1 else 1
            canonical = _fibre(m.group(name_group))
            if canonical is None:
                # An unrecognised component makes the whole parse untrustworthy:
                # dropping it could let the rest sum to 100 and look valid.
                found = []
                break
            found.append(FiberPct(canonical, float(m.group(pct_group))))
        if len(found) > len(best):
            best = found
    return best or None
```

- [ ] **Step 5: Implement the extractor**

```python
# services/ocr/extract.py
"""OCR lines from a care-label photo -> one trustworthy composition. Spec §5.3.

Never a guess: a label whose readings disagree, or that only states a lining, is
UNREADABLE; a photo with no composition text is NO_LABEL_TEXT.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

from services.ocr.engines.base import TextLine
from services.ocr.normalizer import fold_text, normalize_fiber_name
from services.ocr.parser import FiberPct, parse_composition

MAIN_SECTIONS = ("shell", "outer", "main", "body", "self", "fabric", "tessuto", "tissu",
                 "tejido", "stoff", "exterior", "exterieur", "aussen")
OTHER_SECTIONS = ("lining", "trim", "rib", "filling", "padding", "pocketing", "contrast",
                  "fodera", "doublure", "forro", "futter", "garnissage", "relleno",
                  "imbottitura")
_SECTION = re.compile(r"^\s*(" + "|".join(MAIN_SECTIONS + OTHER_SECTIONS) + r")\b\s*[:\-]?\s*",
                      re.IGNORECASE)
_WORDS = re.compile(r"[^\W\d_]+")


@dataclass(frozen=True)
class Extraction:
    fibers: list[FiberPct] | None
    section: str | None = None
    confidence: float | None = None
    reason: str | None = None  # "NO_LABEL_TEXT" | "UNREADABLE" when fibers is None


def _cy(line: TextLine) -> float:
    return (line.box[1] + line.box[3]) / 2


def reading_order(lines: list[TextLine]) -> list[TextLine]:
    """Top to bottom, then left to right. Lines whose centres are within half a line
    height of a row's first line join that row."""
    if not lines:
        return []
    by_y = sorted(lines, key=_cy)
    rows, row = [], [by_y[0]]
    for line in by_y[1:]:
        height = max(1.0, min(row[0].box[3] - row[0].box[1], line.box[3] - line.box[1]))
        if abs(_cy(line) - _cy(row[0])) <= height / 2:
            row.append(line)
        else:
            rows.append(row)
            row = [line]
    rows.append(row)
    return [line for r in rows for line in sorted(r, key=lambda l: l.box[0])]


def _looks_like_label(lines: list[TextLine]) -> bool:
    return any("%" in line.text or any(normalize_fiber_name(w) for w in _WORDS.findall(line.text))
               for line in lines)


def _split_sections(lines: list[TextLine]) -> list[tuple[str | None, list[TextLine]]]:
    sections: list[tuple[str | None, list[TextLine]]] = [(None, [])]
    for line in lines:
        text = fold_text(line.text)
        m = _SECTION.match(text)
        if m:
            rest = text[m.end():]
            sections.append((m.group(1).lower(), [replace(line, text=rest)] if rest.strip() else []))
        else:
            sections[-1][1].append(replace(line, text=text))
    return [(name, ls) for name, ls in sections if ls]


def _parse_section(lines):
    """(composition, lines used, agreeing readings, conflict?)."""
    whole = parse_composition(" | ".join(line.text for line in lines))
    if whole:
        return whole, lines, 1, False
    valid = [(c, line) for line in lines if (c := parse_composition(line.text))]
    if not valid:
        return None, [], 0, False
    first = valid[0][0]
    if any(c != first for c, _ in valid[1:]):
        return None, [], 0, True
    return first, [line for _, line in valid], len(valid), False


def extract(lines: list[TextLine]) -> Extraction:
    if not lines or not _looks_like_label(lines):
        return Extraction(None, reason="NO_LABEL_TEXT")
    sections = _split_sections(reading_order(lines))
    main = [s for s in sections if s[0] in MAIN_SECTIONS]
    candidates = main[:1] if main else [s for s in sections if s[0] not in OTHER_SECTIONS]
    for name, section_lines in candidates:
        fibers, used, agreeing, conflict = _parse_section(section_lines)
        if conflict:
            return Extraction(None, reason="UNREADABLE")
        if fibers:
            mean = sum(line.confidence for line in used) / len(used)
            return Extraction(fibers, section=name, confidence=1 - (1 - mean) ** agreeing)
    return Extraction(None, reason="UNREADABLE")


def read_composition(engine, image) -> Extraction:
    """OCR + extract, retrying at 90°, 180° and 270° when nothing parses."""
    import numpy as np

    saw_text = False
    for k in range(4):
        ex = extract(engine.read(np.ascontiguousarray(np.rot90(image, k))))
        if ex.fibers:
            return ex
        saw_text = saw_text or ex.reason == "UNREADABLE"
    return Extraction(None, reason="UNREADABLE" if saw_text else "NO_LABEL_TEXT")
```

- [ ] **Step 6: Run the tests, plus the existing OCR tests**

Run: `.venv/bin/python -m pytest tests/test_ocr.py tests/test_ocr_extract.py tests/test_consistency.py tests/test_api.py -v`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add services/ocr tests/test_ocr.py tests/test_ocr_extract.py
git commit -m "Read compositions from label OCR: sections, languages, agreement, rotation

Also fixes PA (polyamide, per ISO 2076, not acrylic) and accented fibre names,
which the A-Z-only parser rejected outright."
```

---

### Task 10: Consistency engine: FAMILY_MISMATCH

**Files:**
- Modify: `services/consistency/engine.py` (`evaluate`), `services/consistency/kb.yaml`
- Test: `tests/test_consistency.py` (additions)

**Interfaces:**
- Consumes: `VisionOutput.fibre_family` (Task 7).
- Produces: `evaluate(...)` may return flag `FAMILY_MISMATCH` (severity `medium`); `kb.yaml` version 2 with `tolerance.family_min_confidence`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_consistency.py`)

```python
from services.consistency.engine import load_kb  # add to the imports


def _family(label, conf=0.95, structure=None):
    return VisionOutput(structure=structure, treatment=None,
                        fibre_family=HeadOutput(label, conf, []))


def test_confident_family_mismatch_flags_even_without_a_structure():
    v = evaluate(_family("synthetic"), [FiberPct("cotton", 100.0)])
    assert v.outcome == "FLAG"
    assert [f.code for f in v.flags] == ["FAMILY_MISMATCH"]
    assert v.flags[0].severity == "medium"
    assert "cellulosic" in v.flags[0].message and "synthetic" in v.flags[0].message


def test_unsure_family_does_not_flag():
    v = evaluate(_family("synthetic", conf=0.6), [FiberPct("cotton", 100.0)])
    assert v.outcome == "INSUFFICIENT_EVIDENCE"


def test_blend_label_that_includes_the_family_does_not_flag():
    v = evaluate(_family("synthetic"), [FiberPct("cotton", 60.0), FiberPct("polyester", 40.0)])
    assert v.outcome == "INSUFFICIENT_EVIDENCE" and not v.flags


def test_family_agreement_with_a_checked_structure_passes():
    v = evaluate(_family("cellulosic", structure=HeadOutput("denim", 0.95, [])),
                 [FiberPct("cotton", 100.0)])
    assert v.outcome == "PASS"


def test_structure_and_family_can_both_flag():
    v = evaluate(_family("synthetic", structure=HeadOutput("tweed", 0.95, [])),
                 [FiberPct("cotton", 100.0)])
    assert {f.code for f in v.flags} == {"COMPOSITION_IMPLAUSIBLE", "FAMILY_MISMATCH"}


def test_kb_is_version_two_with_a_family_threshold():
    kb = load_kb()
    assert kb["version"] == 2 and 0.5 < kb["tolerance"]["family_min_confidence"] <= 1.0
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_consistency.py -v`
Expected: the 6 new tests FAIL; existing tests pass

- [ ] **Step 3: Implement**

In `services/consistency/kb.yaml`: set `version: 2` and add under `tolerance:`:

```yaml
  # Head C (fibre family) must be at least this confident to raise FAMILY_MISMATCH.
  # Calibrated confidence, so comparable across models. Tuned for precision in the
  # week-2 bake-off (spec §8.3).
  family_min_confidence: 0.90
```

Replace `evaluate` in `services/consistency/engine.py`:

```python
def evaluate(
    vision: VisionOutput,
    composition: list[FiberPct] | None,
    kb_path: Path = DEFAULT_KB_PATH,
) -> Verdict:
    """Compare vision output against a stated composition.

    PASS needs the structure check to have run. The family check can only add a flag:
    a confident family that the label does not mention is evidence of a mislabel, but a
    matching family alone is too coarse to vouch for the label.
    """
    kb = load_kb(kb_path)
    tol = kb["tolerance"]
    version = int(kb["version"])

    if composition is None:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)
    stated = _dominant_families(composition, tol["min_component_pct"])
    if not stated:
        return Verdict("INSUFFICIENT_EVIDENCE", kb_version=version)

    flags: list[Flag] = []
    structure_checked = False
    s = vision.structure
    entry = kb["fabrics"].get(s.label) if s is not None else None
    if s is not None and entry is not None and s.confidence >= tol["min_visual_confidence"]:
        structure_checked = True
        plausible = set(entry["families"])
        if not (stated & plausible):
            flags.append(Flag(
                code="COMPOSITION_IMPLAUSIBLE",
                message=(f"Label states {'/'.join(sorted(stated))} but the fabric reads as "
                         f"{s.label}, which is normally {'/'.join(sorted(plausible))}."),
                severity="high",
            ))
        expected = entry.get("expected_treatment")
        t = vision.treatment
        if (expected and t is not None and t.confidence >= tol["min_visual_confidence"]
                and t.label != expected):
            flags.append(Flag(
                code="TREATMENT_UNEXPECTED",
                message=f"{s.label} is normally {expected}, but this reads as {t.label}.",
                severity="medium",
            ))

    f = vision.fibre_family
    if f is not None and f.confidence >= tol["family_min_confidence"] and f.label not in stated:
        flags.append(Flag(
            code="FAMILY_MISMATCH",
            message=(f"Label states {'/'.join(sorted(stated))} but the fabric reads as "
                     f"{f.label}."),
            severity="medium",
        ))

    if flags:
        return Verdict("FLAG", tuple(flags), version)
    return Verdict("PASS" if structure_checked else "INSUFFICIENT_EVIDENCE", kb_version=version)
```

- [ ] **Step 4: Run all the consistency and API tests**

Run: `.venv/bin/python -m pytest tests/test_consistency.py tests/test_api.py -v`
Expected: all pass (existing behaviour is unchanged)

- [ ] **Step 5: Commit**

```bash
git add services/consistency tests/test_consistency.py
git commit -m "Flag a confident fibre family the label does not mention"
```

---

### Task 11: API: additive contract, configuration, wiring

**Files:**
- Modify: `services/api/schemas.py`, `services/api/pipeline.py`, `services/api/main.py`, `docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md` (§7 table)
- Create: `services/api/config.py`
- Test: `tests/test_api.py` (additions), `tests/test_api_config.py`

**Interfaces:**
- Consumes: `VisionOutput.garment/.notes` (7), `read_composition`, `Extraction` (9), `UnsupportedImage` (1), `load_engine` (8), `build_scanner` (7).
- Produces:
  - `GarmentPrediction(label, confidence | None, box)`, `ScanResult.garment`, `StatedComposition.section`
  - `run_scan(predictor, surface_image, label_text=None, *, label_image=None, ocr=None, model_version="stub-0") -> ScanResult`
  - `Settings.from_env(env) -> Settings`, `build_predictor(settings) -> (Predictor, version)`, `build_ocr(settings) -> OcrEngine | None`
  - Info flags: `NO_GARMENT_DETECTED`, `COMPONENT_FAILED`, `NO_LABEL_TEXT`, `LABEL_UNREADABLE`

`LABEL_UNREADABLE` (info) is a small addition to spec §7. It tells the user *why* a
label with text still abstained. Step 5 adds it to the spec table.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_api.py`)

```python
import io

import pytest

from services.api import main
from services.ocr.engines.base import TextLine
from services.vision.errors import UnsupportedImage
from services.vision.predictor import GarmentOutput, Note, StubPredictor, VisionOutput


@pytest.fixture
def state():
    saved = dict(main._state)
    yield main._state
    main._state.clear()
    main._state.update(saved)


def _png():
    Image = pytest.importorskip("PIL.Image")
    buf = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(buf, format="PNG")
    return buf.getvalue()


class FakeOcr:
    name = "fake"

    def __init__(self, lines=(), error=None):
        self.lines, self.error, self.calls = list(lines), error, 0

    def read(self, image):
        self.calls += 1
        if self.error:
            raise self.error
        return self.lines


class FakePredictor:
    def __init__(self, out=None, error=None):
        self.out, self.error = out, error

    def predict(self, image_bytes):
        if self.error:
            raise self.error
        return self.out


def test_label_photo_is_read_by_ocr(state):
    state["ocr"] = FakeOcr([TextLine("SHELL: 80% PA 20% EA", 0.95, (0, 0, 100, 10))])
    r = client.post("/api/v1/scan", files={"surface_image": ("g.jpg", b"x", "image/jpeg"),
                                           "label_image": ("l.png", _png(), "image/png")})
    comp = r.json()["stated_composition"]
    assert r.status_code == 200
    assert comp["source"] == "care_label" and comp["section"] == "shell"
    assert {f["name"] for f in comp["fibers"]} == {"nylon", "elastane_spandex"}
    assert comp["ocr_confidence"] == pytest.approx(0.95)


def test_typed_label_text_overrides_the_photo(state):
    ocr = FakeOcr([TextLine("100% POLYESTER", 0.9, (0, 0, 1, 1))])
    state["ocr"] = ocr
    r = client.post("/api/v1/scan", files={"surface_image": ("g.jpg", b"x", "image/jpeg"),
                                           "label_image": ("l.png", _png(), "image/png")},
                    data={"label_text": "100% COTTON"})
    assert [f["name"] for f in r.json()["stated_composition"]["fibers"]] == ["cotton"]
    assert ocr.calls == 0


def test_unreadable_label_explains_itself(state):
    state["ocr"] = FakeOcr([TextLine("MADE IN PAKISTAN", 0.9, (0, 0, 1, 1))])
    r = client.post("/api/v1/scan", files={"surface_image": ("g.jpg", b"x", "image/jpeg"),
                                           "label_image": ("l.png", _png(), "image/png")})
    body = r.json()
    assert body["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert {"code": "NO_LABEL_TEXT", "severity": "info"}.items() <= body["flags"][0].items()


def test_failing_ocr_is_an_info_flag_not_a_500(state):
    state["ocr"] = FakeOcr(error=RuntimeError("engine died"))
    r = client.post("/api/v1/scan", files={"surface_image": ("g.jpg", b"x", "image/jpeg"),
                                           "label_image": ("l.png", _png(), "image/png")})
    assert r.status_code == 200
    assert [f["code"] for f in r.json()["flags"]] == ["COMPONENT_FAILED"]


def test_garment_and_notes_reach_the_response(state):
    state["predictor"] = FakePredictor(VisionOutput(
        None, None, None, garment=GarmentOutput("pants", 0.8, (0.1, 0.2, 0.9, 0.95)),
        notes=(Note("COMPONENT_FAILED", "segmenter failed: RuntimeError"),)))
    body = client.post("/api/v1/scan",
                       files={"surface_image": ("g.jpg", b"x", "image/jpeg")}).json()
    assert body["garment"] == {"label": "pants", "confidence": 0.8, "box": [0.1, 0.2, 0.9, 0.95]}
    assert body["flags"][0]["severity"] == "info"


def test_undecodable_photo_is_a_422(state):
    # Review Focus 3: an iPhone HEIC upload must be a clear client error.
    state["predictor"] = FakePredictor(error=UnsupportedImage("cannot decode image: heic"))
    r = client.post("/api/v1/scan", files={"surface_image": ("g.heic", b"x", "image/heic")})
    assert r.status_code == 422 and "decode" in r.json()["detail"]


def test_stub_is_still_the_default(state):
    assert isinstance(main._state["predictor"], StubPredictor)
```

```python
# tests/test_api_config.py
"""Which models the API loads, chosen by environment. Stdlib only."""

import pytest

from services.api.config import Settings, build_ocr, build_predictor
from services.vision.predictor import StubPredictor


def test_defaults_are_the_stub_without_ocr():
    s = Settings.from_env({})
    assert (s.vision, s.ocr) == ("stub", "none")
    predictor, version = build_predictor(s)
    assert isinstance(predictor, StubPredictor) and version == "stub-0"
    assert build_ocr(s) is None


def test_scanner_mode_defaults_to_grounding_dino_and_apple_vision():
    s = Settings.from_env({"TEXPILOT_VISION": "scanner"})
    assert (s.detector, s.ocr) == ("gdino", "apple")


def test_unknown_vision_mode_fails_at_startup():
    with pytest.raises(ValueError, match="TEXPILOT_VISION"):
        build_predictor(Settings.from_env({"TEXPILOT_VISION": "magic"}))
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_api.py tests/test_api_config.py -v`
Expected: new tests FAIL / ERROR (`main._state`, `services.api.config` missing)

- [ ] **Step 3: Extend the schemas** (`services/api/schemas.py`)

Add, after `HeadPrediction`:

```python
class GarmentPrediction(BaseModel):
    label: str  # services.vision.garment vocabulary, e.g. "pants"
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)  # None: scoreless detector
    box: tuple[float, float, float, float]  # normalised 0-1 (x0, y0, x1, y1)
```

Add `section: str | None = None  # e.g. "shell"; None when the label is unsectioned` to
`StatedComposition`. Add `garment: GarmentPrediction | None = None` to `ScanResult`
after `fibre_family`. Change the `FlagModel.severity` line to
`severity: str  # "high" | "medium" | "info" (info explains an abstention)`.

- [ ] **Step 4: Implement config, pipeline and main**

```python
# services/api/config.py
"""Which models the API serves, from the environment. Spec §7.

Stdlib at import time: models load only in build_*(), at startup, and any failure
stops the server with a message. Misconfiguration must be loud.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from services.vision.predictor import Predictor, StubPredictor


@dataclass(frozen=True)
class Settings:
    vision: str = "stub"  # stub | scanner
    bundle: Path = Path("models/scanner-v1")
    detector: str = "gdino"  # gdino | owlv2
    ocr: str = "none"  # none | apple | paddle
    device: str = "auto"

    @classmethod
    def from_env(cls, env=os.environ) -> Settings:
        vision = env.get("TEXPILOT_VISION", "stub")
        return cls(
            vision=vision,
            bundle=Path(env.get("TEXPILOT_MODEL_BUNDLE", "models/scanner-v1")),
            detector=env.get("TEXPILOT_GARMENT_DETECTOR", "gdino"),
            # OCR defaults on only with the scanner, so stub mode runs on any OS.
            ocr=env.get("TEXPILOT_OCR_BACKEND", "apple" if vision == "scanner" else "none"),
            device=env.get("TEXPILOT_DEVICE", "auto"),
        )


def build_predictor(s: Settings) -> tuple[Predictor, str]:
    if s.vision == "stub":
        return StubPredictor(), "stub-0"
    if s.vision != "scanner":
        raise ValueError(f"TEXPILOT_VISION must be 'stub' or 'scanner', not {s.vision!r}")
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    predictor = build_scanner(s.bundle, s.detector, pick_device(s.device))
    return predictor, f"scanner-v{predictor.heads.version}+det={s.detector}+ocr={s.ocr}"


def build_ocr(s: Settings):
    if s.ocr == "none":
        return None
    from services.ocr.engines import load_engine

    return load_engine(s.ocr)
```

Replace `services/api/pipeline.py`:

```python
"""Wires vision + OCR + consistency into one scan. Spec §3, §5, §7."""

from __future__ import annotations

import logging
import uuid

from services.api.schemas import (
    CompositionSource,
    FiberComponent,
    FlagModel,
    GarmentPrediction,
    HeadPrediction,
    Outcome,
    ScanResult,
    StatedComposition,
)
from services.consistency.engine import evaluate
from services.ocr.parser import parse_composition
from services.vision.predictor import HeadOutput, Predictor

log = logging.getLogger(__name__)
_REASONS = {
    "NO_LABEL_TEXT": ("NO_LABEL_TEXT", "No composition text found in the label photo."),
    "UNREADABLE": ("LABEL_UNREADABLE",
                   "Label text was found, but no single valid composition could be read."),
}


def _head(out: HeadOutput | None) -> HeadPrediction | None:
    if out is None:
        return None
    return HeadPrediction(label=out.label, confidence=out.confidence, topk=out.topk)


def _info(code: str, message: str) -> FlagModel:
    return FlagModel(code=code, message=message, severity="info")


def _read_label(ocr, label_image: bytes, flags: list[FlagModel]):
    from services.ocr.extract import read_composition
    from services.vision.imageio import decode_image

    image = decode_image(label_image)  # UnsupportedImage propagates -> HTTP 422
    try:
        return read_composition(ocr, image)
    except Exception as e:  # noqa: BLE001 -- a failing engine abstains, it does not 500
        log.exception("OCR failed")
        flags.append(_info("COMPONENT_FAILED", f"OCR engine failed: {type(e).__name__}"))
        return None


def run_scan(
    predictor: Predictor,
    surface_image: bytes,
    label_text: str | None = None,
    *,
    label_image: bytes | None = None,
    ocr=None,
    model_version: str = "stub-0",
) -> ScanResult:
    vision = predictor.predict(surface_image)
    notes = [_info(n.code, n.message) for n in vision.notes]

    composition, stated = None, StatedComposition()
    if label_text:  # typed text is a human correction: it wins over OCR
        composition = parse_composition(label_text)
        if composition is not None:
            stated = StatedComposition(
                source=CompositionSource.CARE_LABEL,
                fibers=[FiberComponent(name=c.name, pct=c.pct) for c in composition],
            )
    elif label_image is not None and ocr is not None:
        ex = _read_label(ocr, label_image, notes)
        if ex is not None and ex.fibers:
            composition = ex.fibers
            stated = StatedComposition(
                source=CompositionSource.CARE_LABEL,
                fibers=[FiberComponent(name=c.name, pct=c.pct) for c in composition],
                ocr_confidence=ex.confidence,
                section=ex.section,
            )
        elif ex is not None and ex.reason in _REASONS:
            notes.append(_info(*_REASONS[ex.reason]))

    verdict = evaluate(vision, composition)
    g = vision.garment
    return ScanResult(
        scan_id=str(uuid.uuid4()),
        verdict=Outcome(verdict.outcome),
        structure=_head(vision.structure),
        treatment=_head(vision.treatment),
        fibre_family=_head(vision.fibre_family),
        garment=None if g is None else GarmentPrediction(label=g.label, confidence=g.confidence,
                                                         box=g.box),
        stated_composition=stated,
        flags=[FlagModel(code=f.code, message=f.message, severity=f.severity)
               for f in verdict.flags] + notes,
        model_version=model_version,
        kb_version=str(verdict.kb_version),
    )
```

Replace `services/api/main.py`:

```python
"""TexPilot scanner API.

    make api           # stub: every scan abstains; the app can build against it anywhere
    make api-scanner   # the real models, on the M3 (TEXPILOT_VISION=scanner)

Configuration is by environment (services/api/config.py). With the scanner, models load
at startup; if any fails, the server does not start.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from services.api.config import Settings, build_ocr, build_predictor
from services.api.pipeline import run_scan
from services.api.schemas import ScanResult
from services.vision.errors import UnsupportedImage
from services.vision.predictor import Predictor, StubPredictor

_state: dict = {"predictor": StubPredictor(), "ocr": None, "model_version": "stub-0"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = Settings.from_env()
    predictor, version = build_predictor(settings)
    _state.update(predictor=predictor, ocr=build_ocr(settings), model_version=version)
    yield


app = FastAPI(title="TexPilot Scanner", version="0.2.0", lifespan=lifespan)


def get_predictor() -> Predictor:
    return _state["predictor"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/scan", response_model=ScanResult)
async def scan(
    surface_image: UploadFile = File(...),
    label_image: UploadFile | None = File(default=None),
    label_text: str | None = Form(default=None),
) -> ScanResult:
    """Scan a garment (or a fabric close-up), cross-checked against its care label.

    ``label_image`` is read by server-side OCR; ``label_text``, if given, overrides it.
    Undecodable images (e.g. HEIC) are a 422.
    """
    data = await surface_image.read()
    label = await label_image.read() if label_image is not None else None
    try:
        return run_scan(get_predictor(), data, label_text, label_image=label,
                        ocr=_state["ocr"], model_version=_state["model_version"])
    except UnsupportedImage as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
```

- [ ] **Step 5: Keep the spec in step**

In `docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md` §7:
- add a row `| LABEL_UNREADABLE | info | label text found, but no single valid composition (§5.3) |` to the flag table;
- set the `TEXPILOT_OCR_BACKEND` default cell to `apple with TEXPILOT_VISION=scanner, else none`.

- [ ] **Step 6: Run the tests**

Run: `.venv/bin/python -m pytest && .venv/bin/ruff check .`
Expected: all pass, including the three original API tests unchanged

- [ ] **Step 7: Commit**

```bash
git add services/api tests/test_api.py tests/test_api_config.py \
  docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md
git commit -m "Serve the scanner: label photos, garment field, info flags, config

Additive only: every new field is optional or nullable, so the app's current
build keeps working. P3: run 'cd app && npm run gen:api' after this merges."
```

---

### Task 12: PaddleOCR in an isolated venv

**Files:**
- Create: `services/ocr/engines/paddle.py`, `services/ocr/engines/paddle_worker.py`
- Modify: `Makefile` (`setup-paddle`)
- Test: `tests/test_ocr_paddle_protocol.py`, `tests/test_slow_ocr_paddle.py`

**Interfaces:**
- Consumes: `TextLine` (8).
- Produces: `encode_request(image) -> str`, `decode_reply(line: str) -> list[TextLine]`, `PaddleEngine(python=".venv-paddle/bin/python")` implementing `OcrEngine`.

Why isolated: PaddleOCR 3.7 pulls in `opencv-contrib-python` 4.10, which installs the same
`cv2` module as our `opencv-python-headless` 5.0, and it downgrades PyYAML and others. So
it gets its own venv and talks to us over a JSON-lines pipe.

- [ ] **Step 1: Set up the venv and confirm the result format**

Add to `Makefile`:

```make
PADDLE_VENV := .venv-paddle

setup-paddle: ## PaddleOCR in its own venv (its deps clash with the main ML stack)
	python3 -m venv $(PADDLE_VENV)
	$(PADDLE_VENV)/bin/pip install -q --upgrade pip
	$(PADDLE_VENV)/bin/pip install -q paddlepaddle==3.3.1 paddleocr==3.7.0
```

Run: `make setup-paddle` (~500 MB)

Confirm the keys this plan relies on:

```bash
.venv-paddle/bin/python - <<'EOF'
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from paddleocr import PaddleOCR
img = Image.new("RGB", (700, 120), "white")
ImageDraw.Draw(img).text((20, 30), "80% PA 20% EA", fill="black",
    font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 44))
ocr = PaddleOCR(lang="en", use_doc_orientation_classify=False, use_doc_unwarping=False,
                use_textline_orientation=True)
res = ocr.predict(np.asarray(img)[:, :, ::-1])[0]
print(sorted(k for k in res.keys() if k.startswith("rec_")))
print(res["rec_texts"], res["rec_scores"], res["rec_boxes"])
EOF
```

Expected: the keys include `rec_texts`, `rec_scores` and `rec_boxes`, and the text reads
`80% PA 20% EA`. If `rec_boxes` is absent, use `rec_polys`: take each polygon's min/max x
and y in `paddle_worker.py` below instead of the box.

- [ ] **Step 2: Write the failing protocol test**

```python
# tests/test_ocr_paddle_protocol.py
"""The JSON-lines protocol between us and the PaddleOCR worker. Needs numpy/PIL."""

import base64
import io
import json

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.ocr.engines.base import TextLine  # noqa: E402
from services.ocr.engines.paddle import decode_reply, encode_request  # noqa: E402


def test_request_carries_a_png_of_the_image():
    img = np.zeros((5, 7, 3), np.uint8)
    png = base64.b64decode(json.loads(encode_request(img))["png"])
    assert Image.open(io.BytesIO(png)).size == (7, 5)


def test_reply_becomes_text_lines():
    line = json.dumps({"lines": [["80% PA 20% EA", 0.97, [1, 2, 30, 12]]]})
    assert decode_reply(line) == [TextLine("80% PA 20% EA", 0.97, (1.0, 2.0, 30.0, 12.0))]


def test_worker_error_raises():
    with pytest.raises(RuntimeError, match="boom"):
        decode_reply(json.dumps({"error": "ValueError: boom"}))
```

Run: `.venv/bin/python -m pytest tests/test_ocr_paddle_protocol.py -v`
Expected: collection ERROR (`No module named 'services.ocr.engines.paddle'`)

- [ ] **Step 3: Implement the worker and the engine**

```python
# services/ocr/engines/paddle_worker.py
"""PaddleOCR worker. Runs inside .venv-paddle (make setup-paddle) and imports nothing
from `services`. Protocol: one JSON request per stdin line -> one JSON reply per stdout
line. Paddle's own logging is pushed to stderr so it cannot corrupt the protocol."""

import base64
import io
import json
import os
import sys


def main() -> None:
    proto = os.fdopen(os.dup(1), "w")  # protocol channel = the original stdout
    os.dup2(2, 1)  # anything else written to fd 1 (Paddle logs) goes to stderr
    import numpy as np
    from paddleocr import PaddleOCR
    from PIL import Image

    ocr = PaddleOCR(lang="en", use_doc_orientation_classify=False, use_doc_unwarping=False,
                    use_textline_orientation=True)
    proto.write("ready\n")
    proto.flush()
    for raw in sys.stdin:
        try:
            png = base64.b64decode(json.loads(raw)["png"])
            bgr = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))[:, :, ::-1]
            res = ocr.predict(np.ascontiguousarray(bgr))[0]
            lines = [[str(t), float(s), [float(v) for v in b]]
                     for t, s, b in zip(res["rec_texts"], res["rec_scores"], res["rec_boxes"],
                                        strict=True)]
            reply = {"lines": lines}
        except Exception as e:  # noqa: BLE001 -- report it; the caller decides
            reply = {"error": f"{type(e).__name__}: {e}"}
        proto.write(json.dumps(reply) + "\n")
        proto.flush()


if __name__ == "__main__":
    main()
```

```python
# services/ocr/engines/paddle.py
"""PaddleOCR PP-OCRv5 through a worker in its own venv. Spec §5.1, engine 1."""

from __future__ import annotations

import base64
import io
import json
import select
import subprocess
from pathlib import Path

from services.ocr.engines.base import TextLine

WORKER = Path(__file__).with_name("paddle_worker.py")


def encode_request(image) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(image).save(buf, format="PNG")
    return json.dumps({"png": base64.b64encode(buf.getvalue()).decode("ascii")})


def decode_reply(line: str) -> list[TextLine]:
    reply = json.loads(line)
    if "error" in reply:
        raise RuntimeError(f"PaddleOCR worker: {reply['error']}")
    return [TextLine(t, float(s), tuple(float(v) for v in b)) for t, s, b in reply["lines"]]


class PaddleEngine:
    name = "paddle"

    def __init__(self, python: str = ".venv-paddle/bin/python", timeout_s: float = 120.0):
        if not Path(python).exists():
            raise FileNotFoundError(f"{python} not found; run `make setup-paddle` first")
        self.timeout_s = timeout_s
        self.proc = subprocess.Popen([python, "-u", str(WORKER)], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True)
        if self._readline() != "ready":
            raise RuntimeError("PaddleOCR worker did not start")

    def _readline(self) -> str:
        ready, _, _ = select.select([self.proc.stdout], [], [], self.timeout_s)
        if not ready:
            self.proc.kill()
            raise TimeoutError(f"PaddleOCR worker silent for {self.timeout_s:.0f}s")
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError(f"PaddleOCR worker exited ({self.proc.poll()})")
        return line.strip()

    def read(self, image) -> list[TextLine]:
        self.proc.stdin.write(encode_request(image) + "\n")
        self.proc.stdin.flush()
        return decode_reply(self._readline())

    def close(self) -> None:
        self.proc.terminate()
```

```python
# tests/test_slow_ocr_paddle.py
"""PaddleOCR end to end through the worker. `pytest -m slow`; needs `make setup-paddle`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow


def test_paddle_reads_a_rendered_label():
    if not Path(".venv-paddle/bin/python").exists():
        pytest.skip("run `make setup-paddle` first")
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    from services.ocr.engines import load_engine

    img = Image.new("RGB", (700, 120), "white")
    ImageDraw.Draw(img).text((20, 30), "80% PA 20% EA", fill="black",
                             font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 44))
    engine = load_engine("paddle")
    try:
        texts = " ".join(line.text for line in engine.read(np.asarray(img)))
    finally:
        engine.close()
    assert "80%" in texts and "PA" in texts
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_ocr_paddle_protocol.py -v`
Expected: 3 passed
Run: `.venv/bin/python -m pytest -m slow tests/test_slow_ocr_paddle.py -v`
Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add services/ocr/engines/paddle.py services/ocr/engines/paddle_worker.py Makefile \
  tests/test_ocr_paddle_protocol.py tests/test_slow_ocr_paddle.py
git commit -m "Add PaddleOCR through a worker in its own venv

PaddleOCR 3.7 installs opencv-contrib-python 4.10 over our cv2 and downgrades
PyYAML, so it cannot share the main environment."
```

---

### Task 13: End-to-end demo on the Mac

**Files:**
- Create: `scripts/scan_demo.py`, `tests/test_slow_scanner_e2e.py`
- Modify: `Makefile` (`api-scanner`), `README.md` (a "Run the real scanner" section)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the end-to-end slow test**

```python
# tests/test_slow_scanner_e2e.py
"""The whole scanner on the Mac: real models, real bundle. `pytest -m slow`."""

import time
from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
BUNDLE = Path("models/scanner-v1")
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


def test_scan_returns_a_verdict_within_budget():
    if SAMPLE is None or not (BUNDLE / "bundle.json").exists():
        pytest.skip("needs TextileNet and models/scanner-v1 (Task 6)")
    from services.api.pipeline import run_scan
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    predictor = build_scanner(BUNDLE, "gdino", pick_device())
    data = SAMPLE.read_bytes()
    run_scan(predictor, data, "100% COTTON")  # warm-up
    t0 = time.perf_counter()
    result = run_scan(predictor, data, "100% COTTON")
    elapsed = time.perf_counter() - t0
    assert result.verdict.value in ("PASS", "FLAG", "INSUFFICIENT_EVIDENCE")
    assert result.garment is not None or any(f.code == "NO_GARMENT_DETECTED" for f in result.flags)
    assert elapsed <= 3.0, f"scan took {elapsed:.2f}s (target p50 <= 3 s)"
```

- [ ] **Step 2: Run to verify the chain works** (after Tasks 1–12)

Run: `.venv/bin/python -m pytest -m slow tests/test_slow_scanner_e2e.py -v`
Expected: 1 passed. If it fails only on time, record the number and profile with Step 3
before changing anything.

- [ ] **Step 3: The demo script**

```python
# scripts/scan_demo.py
"""Run one scan end to end with the real models; print the result and the timings.

    .venv/bin/python scripts/scan_demo.py --garment shirt.jpg --label label.jpg
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--garment", type=Path, required=True)
    ap.add_argument("--label", type=Path)
    ap.add_argument("--label-text")
    ap.add_argument("--detector", default="gdino", choices=["gdino", "owlv2"])
    ap.add_argument("--ocr", default="apple", choices=["apple", "paddle"])
    ap.add_argument("--bundle", type=Path, default=Path("models/scanner-v1"))
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args()

    from services.api.pipeline import run_scan
    from services.ocr.engines import load_engine
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    t0 = time.perf_counter()
    predictor = build_scanner(args.bundle, args.detector, pick_device())
    ocr = load_engine(args.ocr) if args.label else None
    print(f"models loaded in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    garment = args.garment.read_bytes()
    label = args.label.read_bytes() if args.label else None
    version = f"scanner-v{predictor.heads.version}+det={args.detector}+ocr={args.ocr}"
    times, result = [], None
    for i in range(args.repeat + 1):  # first run is warm-up
        t = time.perf_counter()
        result = run_scan(predictor, garment, args.label_text, label_image=label, ocr=ocr,
                          model_version=version)
        if i:
            times.append(time.perf_counter() - t)
    print(result.model_dump_json(indent=2))
    print(f"latency p50 {statistics.median(times):.2f}s over {len(times)} runs", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Add to `Makefile`:

```make
api-scanner: ## The real scanner on this Mac, reachable from phones on the same wifi
	TEXPILOT_VISION=scanner TEXPILOT_GARMENT_DETECTOR=gdino TEXPILOT_OCR_BACKEND=apple \
	$(VENV)/bin/uvicorn services.api.main:app --host 0.0.0.0 --port 8000
```

Add a README section after "Quick start":

````markdown
## Run the real scanner (M1 demo, Apple Silicon Mac)

```bash
make setup-ml                     # once
make api-scanner                  # loads ~2 GB of models (~1 min), then serves on :8000
.venv/bin/python scripts/scan_demo.py --garment shirt.jpg --label label.jpg
```

Needs `models/scanner-v1` (see `training/scanner/fit_heads.py`). Phones reach the server
at `http://<this-mac's-ip>:8000`.
````

- [ ] **Step 4: Demo on real photos**

Ask the user to AirDrop 2–3 garments (whole-garment photo plus label close-up) into
`data/phone/samples/`. Then, one at a time, run:

`.venv/bin/python scripts/scan_demo.py --garment data/phone/samples/<g>.jpg --label data/phone/samples/<l>.jpg`

Expected: JSON with a `garment` (or a `NO_GARMENT_DETECTED` flag), heads or their honest
`null`, a parsed `stated_composition` (or `NO_LABEL_TEXT`/`LABEL_UNREADABLE`), a verdict,
and `latency p50` printed. Paste the outputs into the week's notes. If no photos are
available yet, use a TextileNet test image and a rendered label, and say so.

Then: `make api-scanner`, and from another terminal:

`curl -s -F "surface_image=@data/phone/samples/<g>.jpg" -F "label_image=@data/phone/samples/<l>.jpg" http://127.0.0.1:8000/api/v1/scan | python3 -m json.tool`

Expected: the same shape as the demo script's output.

- [ ] **Step 5: Full check and commit**

Run: `.venv/bin/python -m pytest && .venv/bin/python -m pytest -m slow && .venv/bin/ruff check .`
Expected: all pass

```bash
git add scripts/scan_demo.py tests/test_slow_scanner_e2e.py Makefile README.md
git commit -m "Run the scanner end to end on the Mac: demo script and make api-scanner"
```

Push the branch: `git push`.
