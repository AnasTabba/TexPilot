# Florence-2 Backend C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Florence-2-large as a third garment detector and a third OCR engine, sharing
one loaded model, so bake-off round 2 compares three backends of each.

**Architecture:**
- `services/vision/florence2.py` owns the model: `Florence2.run(image, task, text)` runs
  one Florence-2 task and returns the processor's parsed answer. `load(device)` hands out
  one instance per (checkpoint, device) through a weak-reference cache.
- `Florence2Detector` (phrase grounding) and `Florence2Engine` (`<OCR_WITH_REGION>`) are
  thin adapters over `run()`. Each takes an injected `model` in tests.
- `TextLine.confidence` becomes optional, so a composition read by Florence-2 reports
  `ocr_confidence: null` instead of an invented number.

**Tech Stack:** Python 3.10, `transformers` 5.17.0 (native `Florence2ForConditionalGeneration`),
torch 2.14 on MPS, pytest.

**Spec:** `docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md`: §4.2 (Florence-2
details), §4.3, §5.1 engine 3, §5.3 step 6, §11 risk 6.

## Global Constraints

- **Checkpoint:** `florence-community/Florence-2-large` (MIT, 1.55 GB). No `trust_remote_code`,
  and no new dependency: `transformers` stays pinned at 5.17.0.
- **Precision:** float16 on MPS/CUDA, float32 on CPU (spec §4.2).
- **Sharing:** the detector and the OCR engine share one loaded model per (checkpoint, device).
  Dropping both frees it (spec §4.2, §5.1).
- **No scores:** Florence-2 detections carry `score=None` (spec §4.2, §4.3). OCR lines carry
  `confidence=None`, and `ocr_confidence` is `null` (spec §5.3 step 6).
- **Lazy imports:** torch and transformers are imported only inside functions or classes.
  CI has no torch, so fast tests must `pytest.importorskip` numpy, and torch where they need it.
- **Contract:** `services/api/schemas.py` does not change, because `ocr_confidence` is already
  `float | None`.
- **Laptop safety:** one heavy job at a time. Run slow tests under `caffeinate` and
  `nice -n 10 taskpolicy -c utility`. Never load two Florence-2 copies at once.
- **Workflow:** tests first. Run `ruff format` and `ruff check`. Commits are authored by the
  user, with no Claude trailer and plain sentence-case messages. When done, fast-forward
  into `main` and push `origin/main`.

## Review Focus

1. **A grounded box partly outside the image, or one with zero area.** It is clipped to the
   image or dropped; it never crashes and never produces a box the cropper can't use (Task 3).
2. **Florence-2 grounds a phrase outside the vocabulary** (e.g. "person"). That detection is
   dropped. A paraphrase that contains a synonym (e.g. "jeans") maps to its class (Task 3).
3. **An OCR region that comes back blank or whitespace-only.** It is dropped, not passed to
   the extractor as an empty line (Task 4).
4. **The API with `TEXPILOT_DEVICE=cpu` and Florence-2 as both detector and OCR.** The engine
   loads on the same device as the detector, so the two share one model instead of loading
   two (Task 4).
5. **A composition read from lines with no confidence.** It still parses, and its confidence
   is `None`, not 0, 1 or a crash in the mean (Task 1).

---

### Task 1: Optional OCR line confidence

**Files:**
- Modify: `services/ocr/engines/base.py` (`TextLine.confidence`)
- Modify: `services/ocr/extract.py:130-135` (the confidence in `extract()`)
- Test: `tests/test_ocr_extract.py`

**Interfaces:**
- Produces: `TextLine.confidence: float | None`, where `None` means the engine gives no
  per-line confidence. `Extraction.confidence` is `None` whenever any line used has `None`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_ocr_extract.py`)

```python
def test_lines_without_confidence_give_a_composition_with_no_confidence():
    ex = extract([L("80% PA 20% EA", 0, conf=None)])
    assert fibres(ex) == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.confidence is None  # Florence-2 gives none; the API reports null, not a guess
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_ocr_extract.py -q`
Expected: 1 failed, `TypeError: unsupported operand type(s) for +: 'int' and 'NoneType'`

- [ ] **Step 3: Implement**

In `services/ocr/engines/base.py`:

```python
    confidence: float | None  # 0-1; None when the engine gives none (Florence-2)
```

In `services/ocr/extract.py`, replace

```python
            mean = sum(line.confidence for line in used) / len(used)
            text = " / ".join(line.text.strip() for line in used)
            return Extraction(
                fibers, section=name, confidence=1 - (1 - mean) ** agreeing, text=text
            )
```

with

```python
            confs = [line.confidence for line in used]
            confidence = (
                None if None in confs else 1 - (1 - sum(confs) / len(confs)) ** agreeing
            )
            text = " / ".join(line.text.strip() for line in used)
            return Extraction(fibers, section=name, confidence=confidence, text=text)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_ocr_extract.py tests/test_ocr_engines.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add services/ocr/engines/base.py services/ocr/extract.py tests/test_ocr_extract.py
git commit -m "Let an OCR engine report no line confidence, and pass that on as null"
```

---

### Task 2: The shared Florence-2 model

**Files:**
- Create: `services/vision/florence2.py`
- Test: `tests/test_florence2_model.py`

**Interfaces:**
- Produces:
  - `MODEL_ID = "florence-community/Florence-2-large"`.
  - `class Florence2(device, model_id=MODEL_ID)` with `.run(image: np.ndarray, task: str, text: str = "") -> dict`,
    the processor's parsed answer for `task`. For `<CAPTION_TO_PHRASE_GROUNDING>` that is
    `{"bboxes": [[x0, y0, x1, y1], ...], "labels": [...]}`; for `<OCR_WITH_REGION>` it is
    `{"quad_boxes": [[x1, y1, ..., x4, y4], ...], "labels": [...]}`, in pixels.
  - `load(device, model_id=MODEL_ID) -> Florence2`, one per `(model_id, str(device))`, held weakly.
- `run()` needs the real weights, so it is verified by Task 5's slow tests. The fast tests
  here cover the cache.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_florence2_model.py
"""The shared Florence-2 model: one per (checkpoint, device), freed when unused. No weights."""

import gc
import weakref

import services.vision.florence2 as f2


class FakeModel:
    made = 0

    def __init__(self, device, model_id=f2.MODEL_ID):
        FakeModel.made += 1
        self.device, self.model_id = device, model_id


def _fresh(monkeypatch):
    monkeypatch.setattr(f2, "Florence2", FakeModel)
    monkeypatch.setattr(f2, "_shared", weakref.WeakValueDictionary())
    FakeModel.made = 0


def test_detector_and_ocr_share_one_model_per_device(monkeypatch):
    _fresh(monkeypatch)
    a, b, c = f2.load("mps"), f2.load("mps"), f2.load("cpu")
    assert a is b and c is not a and FakeModel.made == 2


def test_the_model_is_freed_once_nothing_uses_it(monkeypatch):
    _fresh(monkeypatch)
    m = f2.load("mps")
    del m
    gc.collect()
    f2.load("mps")
    assert FakeModel.made == 2  # the bake-off holds one backend at a time
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_florence2_model.py -q`
Expected: collection ERROR, `No module named 'services.vision.florence2'`

- [ ] **Step 3: Implement**

```python
# services/vision/florence2.py
"""Florence-2-large, shared by the garment detector and the OCR engine (spec §4.2, §5.1).

One model per (checkpoint, device), held weakly: the API loading both backends pays for
one model, and the bake-off dropping a backend frees it.
"""

from __future__ import annotations

import weakref
from typing import TYPE_CHECKING

from services.vision.runtime import to_device

if TYPE_CHECKING:
    import numpy as np

MODEL_ID = "florence-community/Florence-2-large"
NUM_BEAMS = 3  # the model card's setting; the bake-off measures what it costs
MAX_NEW_TOKENS = 1024


class Florence2:
    def __init__(self, device, model_id: str = MODEL_ID):
        import torch
        from transformers import AutoProcessor, Florence2ForConditionalGeneration

        self._no_grad = torch.no_grad
        self.device = device
        # Half precision on the GPU: ~1.5 GB instead of 3 GB on a 16 GB laptop.
        self.dtype = torch.float32 if str(device) == "cpu" else torch.float16
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = (
            Florence2ForConditionalGeneration.from_pretrained(model_id, dtype=self.dtype)
            .eval()
            .to(device)
        )

    def run(self, image: np.ndarray, task: str, text: str = "") -> dict:
        """One Florence-2 task on an RGB array; the processor's parsed answer, in pixels."""
        from PIL import Image

        h, w = image.shape[:2]
        inputs = self.processor(text=task + text, images=Image.fromarray(image), return_tensors="pt")
        inputs = to_device(inputs, self.device)
        with self._no_grad():
            ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"].to(self.dtype),
                max_new_tokens=MAX_NEW_TOKENS,
                num_beams=NUM_BEAMS,
                do_sample=False,
            )
        raw = self.processor.batch_decode(ids, skip_special_tokens=False)[0]
        return self.processor.post_process_generation(raw, task=task, image_size=(w, h))[task]


_shared: weakref.WeakValueDictionary = weakref.WeakValueDictionary()


def load(device, model_id: str = MODEL_ID) -> Florence2:
    key = (model_id, str(device))
    model = _shared.get(key)
    if model is None:
        model = _shared[key] = Florence2(device, model_id)
    return model
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_florence2_model.py -q`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add services/vision/florence2.py tests/test_florence2_model.py
git commit -m "Add a shared Florence-2 model, one per device, freed when unused"
```

---

### Task 3: Florence-2 garment detector

**Files:**
- Create: `services/vision/detectors/florence2.py`
- Modify: `services/vision/detectors/__init__.py` (`load_detector`)
- Modify: `services/api/config.py:20` (comment), `scripts/scan_demo.py:22` (choices)
- Test: `tests/test_florence2_detector.py`

**Interfaces:**
- Consumes: `load(device)` and `.run(image, task, text)` (Task 2); `PROMPTS`, `to_detections` (`services.vision.garment`).
- Produces: `TASK = "<CAPTION_TO_PHRASE_GROUNDING>"`, `CAPTION: str`,
  `Florence2Detector(device, model=None)` with `name = "florence2"`, `.model`, and
  `.detect(image) -> list[Detection]` (score `None`); `load_detector("florence2", device)`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_florence2_detector.py
"""Florence-2 phrase grounding -> Detections, with a fake model. No weights."""

import pytest

np = pytest.importorskip("numpy")

from services.vision.detectors.florence2 import CAPTION, TASK, Florence2Detector  # noqa: E402
from services.vision.garment import PROMPTS  # noqa: E402

IMAGE = np.zeros((100, 200, 3), dtype=np.uint8)


class FakeModel:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def run(self, image, task, text=""):
        self.calls.append((task, text))
        return self.answer


def test_grounded_phrases_become_scoreless_canonical_detections():
    model = FakeModel({"bboxes": [[10, 10, 90, 90], [0, 0, 20, 20]], "labels": ["jeans", "person"]})
    [d] = Florence2Detector(None, model=model).detect(IMAGE)
    assert (d.label, d.score, d.box) == ("pants", None, (10.0, 10.0, 90.0, 90.0))
    assert model.calls == [(TASK, CAPTION)]


def test_the_caption_names_every_garment_synonym():
    assert all(p in CAPTION for p in PROMPTS)


def test_boxes_are_clipped_to_the_image_and_empty_ones_dropped():
    answer = {"bboxes": [[-5, -5, 250, 120], [50, 50, 50, 80]], "labels": ["dress", "skirt"]}
    [d] = Florence2Detector(None, model=FakeModel(answer)).detect(IMAGE)
    assert (d.label, d.box) == ("dress", (0.0, 0.0, 200.0, 100.0))


def test_it_is_registered_as_florence2(monkeypatch):
    import services.vision.florence2 as f2
    from services.vision.detectors import load_detector

    fake = FakeModel({"bboxes": [], "labels": []})
    monkeypatch.setattr(f2, "load", lambda device: fake)
    det = load_detector("florence2", "cpu")
    assert det.name == "florence2" and det.model is fake
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_florence2_detector.py -q`
Expected: collection ERROR, `No module named 'services.vision.detectors.florence2'`

- [ ] **Step 3: Implement**

```python
# services/vision/detectors/florence2.py
"""Florence-2-large phrase grounding, zero-shot garment detection. Spec §4.2, backend C.

No scores: every detection reports None, which the primary-garment rank counts as 1 and
which skips the detection threshold (spec §4.3).
"""

from __future__ import annotations

import numpy as np

from services.vision.garment import PROMPTS, Detection, to_detections

TASK = "<CAPTION_TO_PHRASE_GROUNDING>"
CAPTION = ", ".join(PROMPTS)


class Florence2Detector:
    name = "florence2"
    default_min_score = 0.30  # never applied: every score is None

    def __init__(self, device, model=None):
        if model is None:
            from services.vision.florence2 import load

            model = load(device)
        self.model = model

    def detect(self, image: np.ndarray) -> list[Detection]:
        h, w = image.shape[:2]
        res = self.model.run(image, TASK, CAPTION)
        return to_detections(res["labels"], [None] * len(res["labels"]), res["bboxes"], w, h)
```

In `services/vision/detectors/__init__.py`, before the `raise`:

```python
    if name == "florence2":
        from services.vision.detectors.florence2 import Florence2Detector

        return Florence2Detector(device)
    raise ValueError(
        f"unknown garment detector {name!r}; choose 'gdino', 'owlv2' or 'florence2'"
    )
```

In `services/api/config.py`: `detector: str = "gdino"  # gdino | owlv2 | florence2`.
In `scripts/scan_demo.py`: `choices=["gdino", "owlv2", "florence2"]` for `--detector`.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_florence2_detector.py -q`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add services/vision/detectors/florence2.py services/vision/detectors/__init__.py \
  services/api/config.py scripts/scan_demo.py tests/test_florence2_detector.py
git commit -m "Add Florence-2 phrase grounding as garment detector C"
```

---

### Task 4: Florence-2 OCR engine

**Files:**
- Create: `services/ocr/engines/florence2.py`
- Modify: `services/ocr/engines/__init__.py` (`load_engine(name, device="auto")`)
- Modify: `services/api/config.py` (`build_ocr` passes `s.device`; `ocr` comment),
  `scripts/scan_demo.py:23` (choices)
- Test: `tests/test_florence2_engine.py`

**Interfaces:**
- Consumes: `load(device)`, `.run(image, task)` (Task 2); `pick_device` (`services.vision.runtime`); `TextLine` with optional confidence (Task 1).
- Produces: `TASK = "<OCR_WITH_REGION>"`, `quad_to_box(q) -> (x0, y0, x1, y1)`,
  `Florence2Engine(device="auto", model=None)` with `name = "florence2"`, `.model`, and
  `.read(image) -> list[TextLine]` (confidence `None`); `load_engine("florence2", device)`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_florence2_engine.py
"""Florence-2 <OCR_WITH_REGION> -> TextLines, with a fake model. No weights."""

import pytest

np = pytest.importorskip("numpy")

from services.ocr.engines.base import TextLine  # noqa: E402
from services.ocr.engines.florence2 import TASK, Florence2Engine  # noqa: E402
from services.ocr.extract import extract  # noqa: E402

IMAGE = np.zeros((220, 900, 3), dtype=np.uint8)


class FakeModel:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def run(self, image, task, text=""):
        self.calls.append((task, text))
        return self.answer


def test_regions_become_axis_aligned_lines_without_confidence():
    model = FakeModel({"quad_boxes": [[30, 30, 400, 32, 399, 70, 29, 68]],
                       "labels": ["SHELL: 80% PA 20% EA"]})  # fmt: skip
    assert Florence2Engine(model=model).read(IMAGE) == [
        TextLine("SHELL: 80% PA 20% EA", None, (29.0, 30.0, 400.0, 70.0))
    ]
    assert model.calls == [(TASK, "")]


def test_blank_regions_are_dropped():
    model = FakeModel({"quad_boxes": [[0] * 8, [0, 0, 10, 0, 10, 10, 0, 10]],
                       "labels": ["  ", "100% COTTON"]})  # fmt: skip
    assert [ln.text for ln in Florence2Engine(model=model).read(IMAGE)] == ["100% COTTON"]


def test_its_lines_parse_into_a_composition_with_no_confidence():
    model = FakeModel({"quad_boxes": [[30, 30, 400, 30, 400, 70, 30, 70],
                                      [30, 120, 300, 120, 300, 160, 30, 160]],
                       "labels": ["SHELL: 80% PA 20% EA", "LINING: 100% PES"]})  # fmt: skip
    ex = extract(Florence2Engine(model=model).read(IMAGE))
    assert [(f.name, f.pct) for f in ex.fibers] == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.confidence is None


def test_the_api_loads_it_on_the_configured_device_so_it_shares_the_detectors(monkeypatch):
    pytest.importorskip("torch")
    import services.vision.florence2 as f2
    from services.api.config import Settings, build_ocr

    seen = []
    monkeypatch.setattr(f2, "load", lambda device: seen.append(str(device)) or FakeModel({}))
    engine = build_ocr(Settings(vision="scanner", ocr="florence2", device="cpu"))
    assert engine.name == "florence2" and seen == ["cpu"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_florence2_engine.py -q`
Expected: collection ERROR, `No module named 'services.ocr.engines.florence2'`

- [ ] **Step 3: Implement**

```python
# services/ocr/engines/florence2.py
"""Florence-2-large <OCR_WITH_REGION>. Spec §5.1, engine 3.

Shares the loaded model with the Florence-2 garment detector. Florence-2 gives no
per-line confidence, so lines carry None and the composition's ocr_confidence is null.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from services.ocr.engines.base import TextLine

if TYPE_CHECKING:
    import numpy as np

TASK = "<OCR_WITH_REGION>"


def quad_to_box(q) -> tuple[float, float, float, float]:
    """(x1, y1, ..., x4, y4) -> the axis-aligned box around it."""
    xs, ys = q[0::2], q[1::2]
    return (float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys)))


class Florence2Engine:
    name = "florence2"

    def __init__(self, device="auto", model=None):
        if model is None:
            from services.vision.florence2 import load
            from services.vision.runtime import pick_device

            model = load(pick_device(device))
        self.model = model

    def read(self, image: np.ndarray) -> list[TextLine]:
        res = self.model.run(image, TASK)
        return [
            TextLine(text.strip(), None, quad_to_box(q))
            for q, text in zip(res["quad_boxes"], res["labels"], strict=True)
            if text.strip()
        ]
```

In `services/ocr/engines/__init__.py`:

```python
def load_engine(name: str, device="auto") -> OcrEngine:
    """``device`` matters only to engines on torch (Florence-2); pass the API's setting so
    a Florence-2 engine shares the Florence-2 detector's model."""
    if name == "apple":
        from services.ocr.engines.apple import AppleVisionEngine

        return AppleVisionEngine()
    if name == "paddle":
        from services.ocr.engines.paddle import PaddleEngine

        return PaddleEngine()
    if name == "florence2":
        from services.ocr.engines.florence2 import Florence2Engine

        return Florence2Engine(device)
    raise ValueError(f"unknown OCR engine {name!r}; choose 'apple', 'paddle' or 'florence2'")
```

In `services/api/config.py`: `build_ocr` returns `load_engine(s.ocr, s.device)`, and the
field comment becomes `ocr: str = "none"  # none | apple | paddle | florence2`.
In `scripts/scan_demo.py`: `choices=["apple", "paddle", "florence2"]` for `--ocr`.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_florence2_engine.py tests/test_api_config.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add services/ocr/engines/florence2.py services/ocr/engines/__init__.py \
  services/api/config.py scripts/scan_demo.py tests/test_florence2_engine.py
git commit -m "Add Florence-2 as OCR engine 3, sharing the detector's model"
```

---

### Task 5: Real weights, bake-off round 2 defaults, docs

**Files:**
- Create: `tests/test_slow_florence2.py`
- Modify: `training/scanner/bakeoff.py` (default `--detectors` / `--ocr`, docstring)
- Modify: `docs/HANDOFF.md` §1 (backend C done)

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Write the slow tests** (they download 1.55 GB on first run; the user confirmed home wifi on 2026-09-27)

```python
# tests/test_slow_florence2.py
"""Florence-2-large weights on a real catalog photo and a rendered label. `pytest -m slow`."""

from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


def _label():
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (900, 220), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=40)
    d.text((30, 30), "SHELL: 80% PA 20% EA", fill="black", font=font)
    d.text((30, 120), "LINING: 100% PES", fill="black", font=font)
    return np.asarray(img)


@pytest.fixture(scope="module")
def backends():
    from services.ocr.engines import load_engine
    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    return load_detector("florence2", pick_device()), load_engine("florence2")


def test_detector_and_engine_share_one_model(backends):
    det, engine = backends
    assert det.model is engine.model


def test_detector_finds_a_scoreless_garment_with_sane_boxes(backends):
    if SAMPLE is None:
        pytest.skip("TextileNet not on this machine")
    from services.vision.garment import GARMENT_VOCAB
    from services.vision.imageio import decode_image

    image = decode_image(SAMPLE.read_bytes())
    found = backends[0].detect(image)
    h, w = image.shape[:2]
    assert found, f"florence2 found nothing in {SAMPLE}"
    for d in found:
        assert d.label in GARMENT_VOCAB and d.score is None
        assert 0 <= d.box[0] < d.box[2] <= w and 0 <= d.box[1] < d.box[3] <= h


def test_engine_reads_a_rendered_label_into_its_composition(backends):
    from services.ocr.extract import read_composition

    ex = read_composition(backends[1], _label())
    assert [(f.name, f.pct) for f in ex.fibers] == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.section == "shell" and ex.confidence is None
```

- [ ] **Step 2: Run them** (downloads the weights; one heavy job; nothing else running on the GPU)

Run: `caffeinate -ims nice -n 10 taskpolicy -c utility .venv/bin/python -m pytest tests/test_slow_florence2.py -m slow -v -s`
Expected: 3 passed.
- If generation returns garbage or NaN on MPS in float16, change the dtype rule in
  `Florence2.__init__` to float32 on every device, rerun, and ledger a ruling with the
  memory cost (about 3 GB).
- If a reading differs only in spacing or case, the extractor already normalises it.
  A different composition is a finding: debug it, don't loosen the assertion.

- [ ] **Step 3: Measure latency on the M3** (recorded in the ledger, not committed)

Run:
```bash
caffeinate -ims .venv/bin/python - <<'EOF'
import time
from pathlib import Path
from services.ocr.engines import load_engine
from services.ocr.extract import read_composition
from services.vision.detectors import load_detector
from services.vision.imageio import decode_image
from services.vision.runtime import pick_device
from tests.test_slow_florence2 import _label
img = decode_image(next(Path("data/fabric/test/denim").glob("*.jp*g")).read_bytes())
det, eng = load_detector("florence2", pick_device()), load_engine("florence2")
det.detect(img); read_composition(eng, _label())  # warm-up
for name, fn in (("detect", lambda: det.detect(img)), ("ocr", lambda: read_composition(eng, _label()))):
    ts = []
    for _ in range(3):
        t = time.perf_counter(); fn(); ts.append(time.perf_counter() - t)
    print(name, sorted(ts)[1])
EOF
```
Expected: two median times. Spec §7's target is p50 ≤ 3 s per scan with the default
backends, so if detect + ocr exceeds 3 s, record that. Florence-2 isn't the default until
the bake-off picks it.

- [ ] **Step 4: Bake-off round 2 defaults**

In `training/scanner/bakeoff.py`, set `--detectors` default to `["gdino", "owlv2", "florence2"]`
and `--ocr` default to `["apple", "paddle", "florence2"]`, and update the module docstring's
example command to match.

- [ ] **Step 5: Docs**

In `docs/HANDOFF.md` §1, the "Done" bullet: add "Florence-2 (backend C) as a third detector
and OCR engine sharing one model".

- [ ] **Step 6: Full check**

Run: `.venv/bin/python -m pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check services training tests scripts`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add tests/test_slow_florence2.py training/scanner/bakeoff.py docs/HANDOFF.md services/vision/florence2.py
git commit -m "Run Florence-2 on real weights and put it in bake-off round 2"
```
