# Scanner Week 2 — Evaluation and Bake-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure every detector and OCR backend on the team's phone photos, pick the
demo defaults by the spec's decision rules, tune the knowledge-base thresholds for flag
precision, and add the tool that makes Head B (surface treatment) trainable.

**Architecture:**
- A `PhoneDataset` adapter reads `data/phone/ground_truth.csv` through the existing
  `FabricDataset` interface.
- `scripts/check_phone_set.py` lets the team catch mistakes while they're still collecting.
- Pure metric functions feed a bake-off runner. It loads **one backend at a time**, caches
  every prediction to JSON (reruns don't reload models), and writes a report that applies
  spec §8.3's rules.
- Threshold tuning and the Head B labelling tool are small, separately testable units.

**Tech Stack:** Python 3.10, the week-1 scanner (`services/vision`, `services/ocr`),
pytest, matplotlib (labelling UI).

**Spec:** `docs/superpowers/specs/2026-09-27-scanner-ai-pipeline-design.md` (§6.1 Head B,
§6.4 thresholds, §8 evaluation). Depends on Plan 1
(`2026-09-27-scanner-week1-demo.md`) being merged into the branch.

## Global Constraints

- Everything in Plan 1's Global Constraints still applies: local models only, laptop
  safety, lazy heavy imports, `slow` marker, `ruff format` + `ruff check`, user-authored
  commits, no Claude trailer.
- **Every accuracy number states its domain** (`phone` or `catalog`) and its `n`.
- **Group by garment id:** one garment is one unit. Its two photos never split across anything.
- **One backend in memory at a time.** Free it (`del`, `gc.collect()`,
  `torch.mps.empty_cache()`) before loading the next.
- Decision rules, verbatim from spec §8.3:
  - Detector: best type accuracy; within 2 points, the faster wins.
  - OCR: best composition exact-match; within 2 points, the faster wins.
  - Views: `crop` vs `crop+patches` by Head C phone accuracy.
  - KB thresholds: the lowest values giving flag precision ≥ 0.90 on the mismatched pairs.

## Review Focus

1. **A CSV edited in Excel by three people:** a BOM on the first header (`﻿id`),
   `Pants` instead of `pants`, stray spaces, blank trailing rows. These must be normalised
   or reported clearly, never silently dropped (Task 2).
2. **A row with no photos, or photos with no row**, e.g. a typo in an id. Both must be
   reported (Task 2).
3. **Ground-truth label text we can't parse** (e.g. `LUREX`). The garment leaves the OCR
   exact-match denominator and is counted and reported, not scored as a miss (Task 3).
4. **A backend that crashes on one photo.** It must not abort the bake-off; that item is
   recorded as a failure (Task 4).
5. **A swapped-label pair whose two garments share a fibre family.** That is not a
   mislabel, so it must not count as "should flag" (Task 3).

---

### Task 1: PhoneDataset adapter

**Files:**
- Modify: `services/vision/datasets/base.py` (`Sample`: three optional fields)
- Create: `services/vision/datasets/phone.py`
- Test: `tests/test_phone_dataset.py`

**Interfaces:**
- Produces: `Sample.garment_type: str | None = None`, `Sample.label_image_path: Path | None = None`, `Sample.label_text: str | None = None`;
  `typed_composition(label_text: str) -> list[FiberPct] | None` (a typed label, '/'-separated lines, through the week-1 extractor);
  `label_family(label_text: str) -> str | None` (dominant family, `"blend"` if several, None if unparseable);
  `PhoneDataset(root: Path)` (`domain = "phone"`, `.missing: list[str]` ids without a garment photo).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_phone_dataset.py
"""The team's phone photos through the FabricDataset interface."""

from pathlib import Path

import pytest

from services.vision.datasets.phone import PhoneDataset, label_family, typed_composition

HEADER = "id,garment_type,label_text,fabric_structure,photographer,phone_model,notes\n"


def _set(tmp_path: Path, rows: str, photos: list[str]) -> Path:
    (tmp_path / "ground_truth.csv").write_text("﻿" + HEADER + rows, encoding="utf-8")
    for name in photos:
        p = tmp_path / "AT" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    return tmp_path


def test_rows_become_samples_with_both_photos(tmp_path):
    root = _set(tmp_path, "001_AT,pants,98% COTTON 2% ELASTANE,denim,AT,iPhone 13,\n",
                ["001_AT_garment.jpg", "001_AT_label.jpg"])
    [s] = list(PhoneDataset(root))
    assert s.group_id == "001_AT" and s.garment_type == "pants" and s.fabric == "denim"
    assert s.image_path.name == "001_AT_garment.jpg"
    assert s.label_image_path.name == "001_AT_label.jpg"
    assert s.fibre_family == "cellulosic"  # elastane at 2% is below the 15% floor


def test_missing_garment_photo_is_listed_not_hidden(tmp_path):
    ds = PhoneDataset(_set(tmp_path, "001_AT,pants,100% COTTON,,AT,x,\n", []))
    assert len(ds) == 0 and ds.missing == ["001_AT"]


@pytest.mark.parametrize(
    "text,family",
    [("100% COTTON", "cellulosic"),
     ("SHELL: 60% COTTON 40% POLYESTER / LINING: 100% POLYESTER", "blend"),
     ("80% POLYAMIDE 20% ELASTANE", "synthetic"),
     ("100% LUREX", None)],
)
def test_label_family(text, family):
    assert label_family(text) == family


def test_typed_composition_reads_the_shell():
    got = typed_composition("LINING: 100% POLYESTER / SHELL: 80% PA 20% EA")
    assert [(f.name, f.pct) for f in got] == [("nylon", 80.0), ("elastane_spandex", 20.0)]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_phone_dataset.py -v`
Expected: collection ERROR, `No module named 'services.vision.datasets.phone'`

- [ ] **Step 3: Implement**

In `services/vision/datasets/base.py`, add three fields at the end of `Sample`:

```python
    garment_type: str | None = None  # phone set: services.vision.garment vocabulary
    label_image_path: Path | None = None  # phone set: the care-label photo
    label_text: str | None = None  # phone set: composition typed exactly as printed
```

```python
# services/vision/datasets/phone.py
"""The team's phone photo set (spec §8.1) as a FabricDataset. Domain: phone.

Layout: <root>/ground_truth.csv plus photos anywhere under <root>, named
<id>_garment.<ext> and <id>_label.<ext>. See docs/phone-test-set.md.
"""

from __future__ import annotations

import csv
from pathlib import Path

from services.ocr.engines.base import TextLine
from services.ocr.extract import extract
from services.vision.datasets.base import FabricDataset, Sample
from services.vision.taxonomy import family_of

PHOTO_EXTS = (".jpg", ".jpeg", ".png")
MIN_COMPONENT_PCT = 15.0  # same floor as the consistency KB


def typed_composition(label_text: str):
    """A typed label ('/'-separated lines) through the same extractor OCR output goes
    through, so ground truth and predictions are parsed identically."""
    lines = [TextLine(t.strip(), 1.0, (0.0, 10.0 * i, 100.0, 10.0 * i + 8))
             for i, t in enumerate(label_text.split(" / ")) if t.strip()]
    return extract(lines).fibers


def label_family(label_text: str) -> str | None:
    """Dominant fibre family of a typed label; 'blend' when two or more families each
    reach 15%; None when the text does not parse."""
    fibers = typed_composition(label_text)
    if not fibers:
        return None
    families = set()
    for f in fibers:
        if f.pct < MIN_COMPONENT_PCT:
            continue
        try:
            families.add(family_of(f.name))
        except KeyError:
            return None
    if not families:
        return None
    return families.pop() if len(families) == 1 else "blend"


class PhoneDataset(FabricDataset):
    domain = "phone"

    def __init__(self, root: Path):
        self.root = Path(root)
        photos = {p.stem: p for p in self.root.rglob("*") if p.suffix.lower() in PHOTO_EXTS}
        self.samples: list[Sample] = []
        self.missing: list[str] = []
        with open(self.root / "ground_truth.csv", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
                gid = row.get("id", "")
                if not gid:
                    continue
                garment = photos.get(f"{gid}_garment")
                if garment is None:
                    self.missing.append(gid)
                    continue
                text = row.get("label_text") or None
                self.samples.append(Sample(
                    image_path=garment, group_id=gid,
                    fabric=row.get("fabric_structure") or None,
                    fibre_family=label_family(text) if text else None,
                    garment_type=(row.get("garment_type") or "").lower() or None,
                    label_image_path=photos.get(f"{gid}_label"), label_text=text,
                ))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Sample:
        return self.samples[idx]
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_phone_dataset.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add services/vision/datasets/base.py services/vision/datasets/phone.py tests/test_phone_dataset.py
git commit -m "Read the team's phone photo set through the FabricDataset interface"
```

---

### Task 2: Phone-set checker for the collectors

**Files:**
- Create: `scripts/check_phone_set.py`
- Test: `tests/test_check_phone_set.py`

**Interfaces:**
- Consumes: `GARMENT_VOCAB` (Plan 1 Task 2), `FABRIC_CLASSES`, `label_family` (Task 1).
- Produces: `check(root: Path) -> tuple[list[str], dict]` (problems, summary counts); CLI `python scripts/check_phone_set.py data/phone`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_check_phone_set.py
"""What the collectors see when they run the checker."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("cps", Path("scripts/check_phone_set.py"))
cps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cps)

HEADER = "id,garment_type,label_text,fabric_structure,photographer,phone_model,notes\n"


def _root(tmp_path, rows, photos):
    (tmp_path / "ground_truth.csv").write_text("﻿" + HEADER + rows, encoding="utf-8")
    for n in photos:
        (tmp_path / n).write_bytes(b"x")
    return tmp_path


def test_a_clean_set_has_no_problems(tmp_path):
    root = _root(tmp_path, "001_AT,pants,100% COTTON,denim,AT,x,\n",
                 ["001_AT_garment.jpg", "001_AT_label.jpg"])
    problems, summary = cps.check(root)
    assert problems == []
    assert summary["garments"] == 1 and summary["by_family"] == {"cellulosic": 1}


def test_each_mistake_is_named(tmp_path):
    rows = ("001_AT,Trousers,100% COTTON,,AT,x,\n"      # not a vocabulary key
            "002_AT,pants,100% LUREX,denimm,AT,x,\n"    # unparseable label, bad class
            "002_AT,pants,100% COTTON,,AT,x,\n"         # duplicate id
            "003_AT,pants,100% COTTON,,AT,x,\n")        # no photos
    root = _root(tmp_path, rows, ["001_AT_garment.jpg", "001_AT_label.jpg",
                                  "002_AT_garment.jpg", "002_AT_label.heic",
                                  "009_AT_garment.jpg"])
    text = "\n".join(cps.check(root)[0])
    assert "001_AT: garment_type 'trousers' is not one of the 14" in text
    assert "002_AT: label_text does not parse" in text
    assert "002_AT: fabric_structure 'denimm' is not one of the 27" in text
    assert "002_AT: duplicate id" in text
    assert "003_AT: no garment photo" in text
    assert "002_AT_label.heic: HEIC" in text
    assert "009_AT_garment.jpg: photo has no row" in text
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_check_phone_set.py -v`
Expected: ERROR, `FileNotFoundError` for `scripts/check_phone_set.py`

- [ ] **Step 3: Implement**

```python
# scripts/check_phone_set.py
"""Check the phone photo set while you collect it. See docs/phone-test-set.md.

    .venv/bin/python scripts/check_phone_set.py data/phone
"""

from __future__ import annotations

import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.vision.datasets.phone import PHOTO_EXTS, label_family  # noqa: E402
from services.vision.garment import GARMENT_VOCAB  # noqa: E402
from services.vision.taxonomy import FABRIC_CLASSES  # noqa: E402

ROLES = ("_garment", "_label")


def check(root: Path) -> tuple[list[str], dict]:
    root = Path(root)
    problems: list[str] = []
    files = [p for p in root.rglob("*") if p.is_file() and p.name != "ground_truth.csv"]
    for p in files:
        if p.suffix.lower() in (".heic", ".heif"):
            problems.append(f"{p.name}: HEIC photo; set Camera -> Formats -> Most Compatible")
    photos = {p.stem: p for p in files if p.suffix.lower() in PHOTO_EXTS}

    seen: Counter = Counter()
    families: Counter = Counter()
    types: Counter = Counter()
    with open(root / "ground_truth.csv", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            gid = row.get("id", "")
            if not gid:
                continue
            seen[gid] += 1
            if seen[gid] == 2:
                problems.append(f"{gid}: duplicate id")
            if seen[gid] > 1:
                continue
            gtype = row.get("garment_type", "").lower()
            if gtype not in GARMENT_VOCAB:
                problems.append(f"{gid}: garment_type {gtype!r} is not one of the 14")
            else:
                types[gtype] += 1
            fabric = row.get("fabric_structure", "").lower()
            if fabric and fabric not in FABRIC_CLASSES:
                problems.append(f"{gid}: fabric_structure {fabric!r} is not one of the 27")
            family = label_family(row.get("label_text", "")) if row.get("label_text") else None
            if family is None:
                problems.append(f"{gid}: label_text does not parse; copy it exactly as printed")
            else:
                families[family] += 1
            for role in ROLES:
                if f"{gid}{role}" not in photos:
                    problems.append(f"{gid}: no {role[1:]} photo")

    for stem, p in photos.items():
        gid = next((stem[: -len(r)] for r in ROLES if stem.endswith(r)), None)
        if gid is None or gid not in seen:
            problems.append(f"{p.name}: photo has no row in ground_truth.csv")

    summary = {"garments": len(seen), "by_family": dict(families), "by_type": dict(types)}
    return problems, summary


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "data/phone")
    problems, summary = check(root)
    print(f"{summary['garments']} garments; families {summary['by_family']}")
    print(f"types {summary['by_type']}")
    for p in problems:
        print("  -", p)
    print("OK" if not problems else f"{len(problems)} problem(s) to fix")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_check_phone_set.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/check_phone_set.py tests/test_check_phone_set.py
git commit -m "Add a checker the team can run on the phone photo set while collecting"
```

---

### Task 3: Evaluation metrics

**Files:**
- Create: `training/scanner/eval_metrics.py`
- Test: `tests/test_eval_metrics.py` (stdlib only)

**Interfaces:**
- Consumes: `FiberPct` (parser).
- Produces: `type_accuracy(pred, truth) -> float`; `composition_match(pred, truth) -> bool`;
  `cer(pred_text, truth_text) -> float`; `latency(times) -> dict` (`p50`, `p95`);
  `swap_pairs(families: dict[str, str]) -> list[tuple[str, str, bool]]`
  (garment id, label id, should_flag); `precision_recall(flagged, should) -> tuple[float, float]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_metrics.py
"""Bake-off metrics. Pure and stdlib, so they run in CI."""

import pytest

from services.ocr.parser import FiberPct
from training.scanner.eval_metrics import (
    cer, composition_match, latency, precision_recall, swap_pairs, type_accuracy)


def test_type_accuracy_counts_abstentions_as_wrong():
    assert type_accuracy(["pants", None, "dress"], ["pants", "skirt", "coat"]) == pytest.approx(1 / 3)


def test_composition_match_is_order_free_and_tolerates_rounding():
    a = [FiberPct("cotton", 60.0), FiberPct("polyester", 40.0)]
    b = [FiberPct("polyester", 40.4), FiberPct("cotton", 59.6)]
    assert composition_match(a, b)
    assert not composition_match(a, [FiberPct("cotton", 100.0)])
    assert not composition_match(None, a)


def test_character_error_rate():
    assert cer("80% PA 20% EA", "80% PA 20% EA") == 0.0
    assert cer("80% PA 20% FA", "80% PA 20% EA") == pytest.approx(1 / 13)
    assert cer("  80%  pa ", "80% PA") == 0.0  # case and spacing are not errors


def test_latency_percentiles():
    assert latency([1.0, 2.0, 3.0, 4.0]) == {"p50": 2.5, "p95": pytest.approx(3.85)}


def test_swapped_labels_only_should_flag_across_families():
    pairs = swap_pairs({"a": "cellulosic", "b": "cellulosic", "c": "synthetic"})
    own = [(g, l, s) for g, l, s in pairs if g == l]
    assert all(not s for _, _, s in own) and len(own) == 3
    cross = {(g, l): s for g, l, s in pairs if g != l}
    assert cross[("a", "c")] is True and ("a", "b") not in cross  # same family: not a mislabel


def test_precision_and_recall():
    assert precision_recall([True, True, False, False], [True, False, True, False]) == (0.5, 0.5)
    assert precision_recall([False, False], [True, False]) == (1.0, 0.0)  # no flags: vacuous precision
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_eval_metrics.py -v`
Expected: collection ERROR, `No module named 'training.scanner.eval_metrics'`

- [ ] **Step 3: Implement**

```python
# training/scanner/eval_metrics.py
"""Bake-off metrics (spec §8.2). Stdlib only."""

from __future__ import annotations

import re
import statistics


def type_accuracy(pred: list[str | None], truth: list[str]) -> float:
    return sum(p == t for p, t in zip(pred, truth, strict=True)) / max(1, len(truth))


def composition_match(pred, truth, tol: float = 1.0) -> bool:
    """Same fibres, each percentage within ``tol`` points. None never matches."""
    if not pred or not truth:
        return False
    a = {f.name: f.pct for f in pred}
    b = {f.name: f.pct for f in truth}
    return a.keys() == b.keys() and all(abs(a[k] - b[k]) <= tol for k in a)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.upper()).strip()


def cer(pred_text: str, truth_text: str) -> float:
    """Character error rate: Levenshtein distance / length of the truth, after upper-casing
    and collapsing whitespace."""
    p, t = _norm(pred_text), _norm(truth_text)
    prev = list(range(len(p) + 1))
    for i, tc in enumerate(t, 1):
        cur = [i]
        for j, pc in enumerate(p, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (pc != tc)))
        prev = cur
    return prev[-1] / max(1, len(t))


def latency(times: list[float]) -> dict:
    qs = statistics.quantiles(times, n=20, method="inclusive") if len(times) > 1 else times * 19
    return {"p50": statistics.median(times), "p95": qs[18]}


def swap_pairs(families: dict[str, str]) -> list[tuple[str, str, bool]]:
    """Each garment with its own label (should not flag) and, for every garment of a
    different family, with that garment's label (should flag). Same-family swaps are
    left out: a cotton label on a linen shirt is not a mislabel we promise to catch."""
    ids = sorted(families)
    pairs = [(g, g, False) for g in ids]
    pairs += [(g, lab, True) for g in ids for lab in ids
              if lab != g and families[lab] != families[g]]
    return pairs


def precision_recall(flagged: list[bool], should: list[bool]) -> tuple[float, float]:
    tp = sum(f and s for f, s in zip(flagged, should, strict=True))
    fp = sum(f and not s for f, s in zip(flagged, should, strict=True))
    fn = sum(s and not f for f, s in zip(flagged, should, strict=True))
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    return precision, recall
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_eval_metrics.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add training/scanner/eval_metrics.py tests/test_eval_metrics.py
git commit -m "Add bake-off metrics: type accuracy, composition match, CER, flag precision"
```

---

### Task 4: Bake-off runner

**Files:**
- Create: `training/scanner/bakeoff.py`
- Test: `tests/test_bakeoff.py`

**Interfaces:**
- Consumes: `PhoneDataset` (1), `eval_metrics` (3), `load_detector`, `choose_primary` (Plan 1), `load_engine`, `read_composition` (Plan 1), `decode_image`, `run_scan`.
- Produces: `run_detector(name, samples, loader, cache_dir) -> list[dict]` (per item: id, label, score, seconds, error);
  `run_ocr(name, samples, loader, cache_dir) -> list[dict]` (per item: id, fibres, text, seconds, error);
  `pick(results: dict[str, tuple[float, float]]) -> str` (the §8.3 rule: best score, within 2 points the fastest);
  CLI writing `results/bakeoff/bakeoff.md`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_bakeoff.py
"""Bake-off mechanics with fake backends: caching, per-item failure, the decision rule."""

import json
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.datasets.base import Sample  # noqa: E402
from services.vision.garment import Detection  # noqa: E402
from training.scanner.bakeoff import pick, run_detector  # noqa: E402


def _samples(tmp_path, n=3):
    out = []
    for i in range(n):
        p = tmp_path / f"{i}_garment.jpg"
        Image.new("RGB", (40, 40), "gray").save(p)
        out.append(Sample(image_path=p, group_id=str(i), garment_type="pants"))
    return out


class Fake:
    name, default_min_score = "fake", 0.3

    def __init__(self):
        self.calls = 0

    def detect(self, image):
        self.calls += 1
        if self.calls == 2:
            raise RuntimeError("boom")
        return [Detection("pants", 0.9, (0, 0, 40, 40))]


def test_one_crash_is_one_failed_item_not_an_aborted_run(tmp_path):
    rows = run_detector("fake", _samples(tmp_path), lambda: Fake(), tmp_path / "cache")
    assert [r["label"] for r in rows] == ["pants", None, "pants"]
    assert rows[1]["error"] == "RuntimeError: boom"


def test_predictions_are_cached_and_reused(tmp_path):
    samples = _samples(tmp_path)
    run_detector("fake", samples, lambda: Fake(), tmp_path / "cache")
    loads = []
    rows = run_detector("fake", samples, lambda: loads.append(1) or Fake(), tmp_path / "cache")
    assert loads == [] and len(rows) == 3
    assert json.loads((tmp_path / "cache" / "det_fake.json").read_text())[0]["id"] == "0"


def test_pick_prefers_the_faster_within_two_points():
    assert pick({"gdino": (0.81, 0.9), "owlv2": (0.80, 0.4)}) == "owlv2"
    assert pick({"gdino": (0.85, 0.9), "owlv2": (0.80, 0.4)}) == "gdino"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bakeoff.py -v`
Expected: collection ERROR, `No module named 'training.scanner.bakeoff'`

- [ ] **Step 3: Implement**

```python
# training/scanner/bakeoff.py
"""Bake-off on the phone set (spec §8). One backend in memory at a time; every
prediction cached to JSON so reruns and report tweaks never reload a model.

    .venv/bin/python -m training.scanner.bakeoff --phone data/phone \
        --detectors gdino owlv2 --ocr apple paddle --bundle models/scanner-v1
"""

from __future__ import annotations

import argparse
import gc
import json
import sys
import time
from pathlib import Path

from services.vision.datasets.phone import PhoneDataset
from services.vision.garment import choose_primary
from services.vision.imageio import decode_image
from training.scanner.eval_metrics import composition_match, latency, type_accuracy

MARGIN = 0.02  # spec §8.3: within 2 points, the faster backend wins


def _free() -> None:
    gc.collect()
    try:
        import torch

        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except ImportError:
        pass


def _cached(path: Path, compute):
    if path.exists():
        return json.loads(path.read_text())
    rows = compute()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=1))
    return rows


def run_detector(name: str, samples, loader, cache_dir: Path) -> list[dict]:
    def compute():
        det, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "label": None, "score": None, "seconds": None, "error": None}
            try:
                img = decode_image(s.image_path.read_bytes())
                t = time.perf_counter()
                primary = choose_primary(det.detect(img), img.shape[1], img.shape[0],
                                         det.default_min_score)
                row["seconds"] = time.perf_counter() - t
                if primary is not None:
                    row["label"], row["score"] = primary.label, primary.score
            except Exception as e:  # noqa: BLE001 -- one bad photo is one failed item
                row["error"] = f"{type(e).__name__}: {e}"
            rows.append(row)
        del det
        _free()
        return rows

    return _cached(Path(cache_dir) / f"det_{name}.json", compute)


def run_ocr(name: str, samples, loader, cache_dir: Path) -> list[dict]:
    from services.ocr.extract import read_composition

    def compute():
        engine, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "fibres": None, "seconds": None, "error": None}
            if s.label_image_path is None:
                row["error"] = "no label photo"
                rows.append(row)
                continue
            try:
                img = decode_image(s.label_image_path.read_bytes())
                t = time.perf_counter()
                ex = read_composition(engine, img)
                row["seconds"] = time.perf_counter() - t
                row["fibres"] = [[f.name, f.pct] for f in ex.fibers] if ex.fibers else None
                row["reason"] = ex.reason
            except Exception as e:  # noqa: BLE001
                row["error"] = f"{type(e).__name__}: {e}"
            rows.append(row)
        close = getattr(engine, "close", None)
        if close:
            close()
        del engine
        _free()
        return rows

    return _cached(Path(cache_dir) / f"ocr_{name}.json", compute)


def pick(results: dict[str, tuple[float, float]]) -> str:
    """results: name -> (score, median seconds). Best score; within MARGIN, the fastest."""
    best = max(score for score, _ in results.values())
    contenders = {n: sec for n, (score, sec) in results.items() if best - score <= MARGIN}
    return min(contenders, key=contenders.get)


def main(argv: list[str] | None = None) -> int:
    from services.ocr.engines import load_engine
    from services.ocr.parser import FiberPct
    from services.vision.datasets.phone import typed_composition
    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--phone", type=Path, default=Path("data/phone"))
    ap.add_argument("--detectors", nargs="+", default=["gdino", "owlv2"])
    ap.add_argument("--ocr", nargs="+", default=["apple", "paddle"])
    ap.add_argument("--out", type=Path, default=Path("results/bakeoff"))
    ap.add_argument("--bundle", type=Path, default=Path("models/scanner-v1"))
    args = ap.parse_args(argv)

    ds = PhoneDataset(args.phone)
    samples = list(ds)
    device = pick_device()
    md = [f"# Bake-off (domain: phone, n = {len(samples)} garments)", ""]
    if ds.missing:
        md.append(f"Rows without a garment photo, excluded: {', '.join(ds.missing)}\n")

    det_scores = {}
    md += ["## Garment detectors", "", "| Backend | Type accuracy | p50 s | p95 s | Failures |",
           "|---|---|---|---|---|"]
    for name in args.detectors:
        rows = run_detector(name, samples, lambda n=name: load_detector(n, device), args.out)
        acc = type_accuracy([r["label"] for r in rows], [s.garment_type for s in samples])
        lat = latency([r["seconds"] for r in rows if r["seconds"] is not None] or [0.0])
        det_scores[name] = (acc, lat["p50"])
        md.append(f"| {name} | {acc:.3f} | {lat['p50']:.2f} | {lat['p95']:.2f} "
                  f"| {sum(r['error'] is not None for r in rows)} |")
    md.append(f"\n**Default detector (spec §8.3): {pick(det_scores)}**\n")

    def truth(s):
        return typed_composition(s.label_text or "")

    scored = [s for s in samples if truth(s)]
    ocr_scores = {}
    md += ["## OCR engines", "", f"Scored on {len(scored)} garments whose typed label parses "
           f"({len(samples) - len(scored)} excluded).", "",
           "| Engine | Exact match | p50 s | Failures |", "|---|---|---|---|"]
    for name in args.ocr:
        rows = {r["id"]: r for r in run_ocr(name, scored, lambda n=name: load_engine(n), args.out)}
        hits = [composition_match([FiberPct(n, p) for n, p in (rows[s.group_id]["fibres"] or [])],
                                  truth(s)) for s in scored]
        rate = sum(hits) / max(1, len(hits))
        lat = latency([r["seconds"] for r in rows.values() if r["seconds"] is not None] or [0.0])
        ocr_scores[name] = (rate, lat["p50"])
        md.append(f"| {name} | {rate:.3f} | {lat['p50']:.2f} "
                  f"| {sum(r['error'] is not None for r in rows.values())} |")
    md.append(f"\n**Default OCR engine (spec §8.3): {pick(ocr_scores)}**\n")
    md += vision_section(samples, pick(det_scores), args.bundle, device, args.out)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "bakeoff.md").write_text("\n".join(md) + "\n")
    print(f"wrote {args.out / 'bakeoff.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_bakeoff.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add training/scanner/bakeoff.py tests/test_bakeoff.py
git commit -m "Add the bake-off runner: one backend at a time, cached, spec §8.3 decisions"
```

---

### Task 5: KB threshold tuning

**Files:**
- Create: `training/scanner/tune_thresholds.py`
- Test: `tests/test_tune_thresholds.py`

**Interfaces:**
- Consumes: `swap_pairs`, `precision_recall` (3); `evaluate` (consistency engine); `VisionOutput`, `HeadOutput`.
- Produces: `sweep(records, grid) -> list[dict]` (precision/recall per threshold pair);
  `choose(sweep_rows, target=0.90) -> dict | None` (the lowest thresholds meeting the target);
  CLI that writes `results/bakeoff/thresholds.md` and, with `--apply`, the chosen values
  into `services/consistency/kb.yaml` with a version bump.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_tune_thresholds.py
"""Choosing KB thresholds for flag precision (spec §8.3)."""

from training.scanner.tune_thresholds import choose, sweep


def _rec(conf, family, stated_family, should):
    return {"structure": None, "family": (family, conf), "stated": [stated_family],
            "should_flag": should}


def test_sweep_and_choose_lowest_threshold_meeting_precision():
    records = [
        _rec(0.95, "synthetic", "cellulosic", True),   # a confident, correct flag
        _rec(0.70, "synthetic", "cellulosic", False),  # an unsure, wrong one
        _rec(0.92, "protein", "protein", False),       # agrees: never flags
    ]
    rows = sweep(records, visual=[0.7], family=[0.6, 0.8, 0.9])
    best = choose(rows, target=0.9)
    assert best["family_min_confidence"] == 0.8
    assert best["precision"] == 1.0 and best["recall"] == 1.0


def test_no_threshold_meets_the_target():
    records = [_rec(0.95, "synthetic", "cellulosic", False)]
    assert choose(sweep(records, visual=[0.7], family=[0.9]), target=0.9) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_tune_thresholds.py -v`
Expected: collection ERROR, `No module named 'training.scanner.tune_thresholds'`

- [ ] **Step 3: Implement**

```python
# training/scanner/tune_thresholds.py
"""Pick KB flag thresholds for precision on deliberately mismatched pairs (spec §8.3).

Records come from the bake-off: each is one (garment photo, label) pair with the vision
outputs recorded once. Thresholds are then swept without re-running any model.
"""

from __future__ import annotations

import itertools

from training.scanner.eval_metrics import precision_recall


def _flags(rec: dict, visual: float, family: float, kb_fabrics: dict | None) -> bool:
    stated = set(rec["stated"])
    raised = False
    if rec.get("structure") and kb_fabrics is not None:
        label, conf = rec["structure"]
        entry = kb_fabrics.get(label)
        if entry and conf >= visual and not (stated & set(entry["families"])):
            raised = True
    if rec.get("family"):
        label, conf = rec["family"]
        if conf >= family and label not in stated:
            raised = True
    return raised


def sweep(records: list[dict], visual: list[float], family: list[float],
          kb_fabrics: dict | None = None) -> list[dict]:
    rows = []
    for v, f in itertools.product(visual, family):
        flagged = [_flags(r, v, f, kb_fabrics) for r in records]
        p, r = precision_recall(flagged, [rec["should_flag"] for rec in records])
        rows.append({"min_visual_confidence": v, "family_min_confidence": f,
                     "precision": p, "recall": r, "flags": sum(flagged)})
    return rows


def choose(rows: list[dict], target: float = 0.90) -> dict | None:
    """Lowest thresholds (most recall) whose precision meets the target and that flag at
    least once; None if nothing qualifies."""
    ok = [r for r in rows if r["precision"] >= target and r["flags"] > 0]
    if not ok:
        return None
    return min(ok, key=lambda r: (r["min_visual_confidence"] + r["family_min_confidence"],
                                  -r["recall"]))
```

`records` are built from the scanner's cached per-garment outputs in Task 6.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_tune_thresholds.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add training/scanner/tune_thresholds.py tests/test_tune_thresholds.py
git commit -m "Add KB threshold tuning for flag precision on swapped labels"
```

---

### Task 6: The scanner on the phone set: head accuracy, views, threshold records

**Files:**
- Modify: `training/scanner/bakeoff.py` (add `run_vision`, `head_accuracy`, `threshold_records`, `vision_section`)
- Test: `tests/test_bakeoff_vision.py`

**Interfaces:**
- Consumes: `build_scanner(bundle, detector, device, patches)` (Plan 1), `label_family` (1),
  `swap_pairs` (3), `sweep`/`choose` (5), `load_kb` (consistency engine).
- Produces:
  - `run_vision(tag, samples, loader, cache_dir) -> list[dict]` (per garment: id, garment, structure `[label, conf]` or None, family `[label, conf]` or None, seconds, error)
  - `head_accuracy(rows, truth: dict[str, str], key) -> tuple[float, float, int]` (accuracy with abstentions counted wrong, coverage, n)
  - `threshold_records(rows, families) -> list[dict]`
  - `vision_section(samples, detector, bundle, device, out) -> list[str]` (report lines)

Ruling carried from the spec: Head C accuracy counts an abstention as **wrong**, so a view
setting cannot win the §8.3 comparison by abstaining more. Coverage is reported alongside.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_bakeoff_vision.py
"""Scanner-on-phone-set mechanics with a fake predictor."""

import pytest

pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.datasets.base import Sample  # noqa: E402
from services.vision.predictor import GarmentOutput, HeadOutput, VisionOutput  # noqa: E402
from training.scanner.bakeoff import head_accuracy, run_vision, threshold_records  # noqa: E402


class FakeScanner:
    def predict(self, data):
        return VisionOutput(HeadOutput("denim", 0.95, []), None, HeadOutput("synthetic", 0.93, []),
                            garment=GarmentOutput("pants", 0.8, (0, 0, 1, 1)))


def test_run_vision_records_heads_and_caches(tmp_path):
    p = tmp_path / "1_garment.jpg"
    Image.new("RGB", (20, 20)).save(p)
    rows = run_vision("crop", [Sample(image_path=p, group_id="1")], lambda: FakeScanner(),
                      tmp_path / "c")
    assert rows[0]["structure"] == ["denim", 0.95] and rows[0]["family"] == ["synthetic", 0.93]
    assert (tmp_path / "c" / "vision_crop.json").exists()


def test_abstention_counts_as_wrong_and_lowers_coverage():
    rows = [{"id": "a", "family": ["cellulosic", 0.9]}, {"id": "b", "family": None},
            {"id": "c", "family": ["protein", 0.9]}]
    acc, cov, n = head_accuracy(rows, {"a": "cellulosic", "b": "synthetic", "c": "synthetic"},
                                "family")
    assert (acc, cov, n) == (pytest.approx(1 / 3), pytest.approx(2 / 3), 3)


def test_threshold_records_pair_vision_with_labels_and_skip_failures():
    rows = [{"id": "a", "structure": None, "family": ["synthetic", 0.95], "error": None},
            {"id": "b", "structure": None, "family": None, "error": "RuntimeError: x"}]
    recs = threshold_records(rows, {"a": "synthetic", "b": "cellulosic"})
    assert {(tuple(r["stated"]), r["should_flag"]) for r in recs} == {
        (("synthetic",), False), (("cellulosic",), True)}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bakeoff_vision.py -v`
Expected: collection ERROR, `cannot import name 'head_accuracy'`

- [ ] **Step 3: Implement** (append to `training/scanner/bakeoff.py`)

```python
def run_vision(tag: str, samples, loader, cache_dir: Path) -> list[dict]:
    """The full scanner (detector -> SAM -> crop -> heads) per garment photo, cached."""

    def compute():
        predictor, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "garment": None, "structure": None, "family": None,
                   "seconds": None, "error": None}
            try:
                data = s.image_path.read_bytes()
                t = time.perf_counter()
                out = predictor.predict(data)
                row["seconds"] = time.perf_counter() - t
                row["garment"] = out.garment.label if out.garment else None
                if out.structure:
                    row["structure"] = [out.structure.label, out.structure.confidence]
                if out.fibre_family:
                    row["family"] = [out.fibre_family.label, out.fibre_family.confidence]
            except Exception as e:  # noqa: BLE001
                row["error"] = f"{type(e).__name__}: {e}"
            rows.append(row)
        del predictor
        _free()
        return rows

    return _cached(Path(cache_dir) / f"vision_{tag}.json", compute)


def head_accuracy(rows: list[dict], truth: dict[str, str], key: str) -> tuple[float, float, int]:
    """(accuracy, abstentions counted wrong; coverage; n) over the ids in ``truth``."""
    scored = [r for r in rows if r["id"] in truth]
    answered = [r for r in scored if r.get(key)]
    correct = sum(r[key][0] == truth[r["id"]] for r in answered)
    n = len(scored)
    return correct / max(1, n), len(answered) / max(1, n), n


def threshold_records(rows: list[dict], families: dict[str, str]) -> list[dict]:
    from training.scanner.eval_metrics import swap_pairs

    by_id = {r["id"]: r for r in rows if not r.get("error")}
    return [{"structure": by_id[g]["structure"], "family": by_id[g]["family"],
             "stated": [families[lab]], "should_flag": should}
            for g, lab, should in swap_pairs(families) if g in by_id]


def vision_section(samples, detector: str, bundle: Path, device, out: Path) -> list[str]:
    from services.consistency.engine import load_kb
    from services.vision.datasets.phone import label_family
    from services.vision.scanner import build_scanner
    from training.scanner.tune_thresholds import choose, sweep

    single = {s.group_id: f for s in samples
              if s.label_text and (f := label_family(s.label_text)) not in (None, "blend")}
    fabric = {s.group_id: s.fabric for s in samples if s.fabric}
    md = ["## Heads on the phone set (domain: phone)", "",
          f"Head C scored on {len(single)} single-family garments; Head A on {len(fabric)} "
          "with a known fabric. Abstentions count as wrong.", "",
          "| Views | Head C acc | Head C coverage | Head A acc | p50 s | p95 s |",
          "|---|---|---|---|---|---|"]
    results = {}
    for tag, patches in (("crop", False), ("crop+patches", True)):
        rows = run_vision(tag, samples,
                          lambda p=patches: build_scanner(bundle, detector, device, patches=p), out)
        c_acc, c_cov, _ = head_accuracy(rows, single, "family")
        a_acc, _, _ = head_accuracy(rows, fabric, "structure")
        lat = latency([r["seconds"] for r in rows if r["seconds"] is not None] or [0.0])
        results[tag] = (c_acc, lat["p50"], rows)
        md.append(f"| {tag} | {c_acc:.3f} | {c_cov:.2f} | {a_acc:.3f} | {lat['p50']:.2f} "
                  f"| {lat['p95']:.2f} |")
    views = pick({t: (acc, sec) for t, (acc, sec, _) in results.items()})
    md.append(f"\n**Views (spec §8.3): {views}**\n")

    grid = [round(0.5 + 0.05 * i, 2) for i in range(10)]
    rows = sweep(threshold_records(results[views][2], single), grid, grid,
                 kb_fabrics=load_kb()["fabrics"])
    best = choose(rows, target=0.90)
    md += ["## KB thresholds (flag precision on swapped labels)", ""]
    if best is None:
        md.append("No threshold pair reaches 0.90 precision; keep the current kb.yaml values.")
    else:
        md.append(f"min_visual_confidence **{best['min_visual_confidence']}**, "
                  f"family_min_confidence **{best['family_min_confidence']}**: precision "
                  f"{best['precision']:.3f}, recall {best['recall']:.3f}.")
    (out / "thresholds.json").write_text(json.dumps({"best": best, "sweep": rows}, indent=1))
    return md
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_bakeoff_vision.py tests/test_bakeoff.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add training/scanner/bakeoff.py tests/test_bakeoff_vision.py
git commit -m "Bake-off: the full scanner on the phone set, head accuracy, views, thresholds"
```

---

### Task 7: Head B labelling tool

**Files:**
- Create: `training/scanner/label_treatment.py`
- Test: `tests/test_label_treatment.py`

**Interfaces:**
- Produces: `KEYS = {"1": "printed", "2": "piece_dyed", "3": "yarn_dyed", "4": "undyed"}`;
  `load_labels(csv_path) -> dict[str, str]`; `append_label(csv_path, image_path, label)`;
  `todo(pool: list[str], done: dict, n: int, seed: int) -> list[str]` (a deterministic sample,
  excluding what's done); CLI showing images with matplotlib (`1`–`4`, `s` skip, `q` quit).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_label_treatment.py
"""Head B hand-labelling: resumable, deterministic, append-only."""

from training.scanner.label_treatment import KEYS, append_label, load_labels, todo


def test_labels_append_and_reload(tmp_path):
    csv_path = tmp_path / "treatment_labels.csv"
    append_label(csv_path, "fabric/train/lace/a.jpg", "piece_dyed")
    append_label(csv_path, "fabric/train/knit/b.jpg", "printed")
    assert load_labels(csv_path) == {"fabric/train/lace/a.jpg": "piece_dyed",
                                     "fabric/train/knit/b.jpg": "printed"}


def test_todo_is_deterministic_and_skips_done():
    pool = [f"img{i}.jpg" for i in range(50)]
    first = todo(pool, {}, 10, seed=0)
    assert first == todo(pool, {}, 10, seed=0) and len(first) == 10
    rest = todo(pool, {p: "printed" for p in first}, 10, seed=0)
    assert not set(first) & set(rest)


def test_the_four_treatments_have_keys():
    assert set(KEYS.values()) == {"printed", "piece_dyed", "yarn_dyed", "undyed"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_label_treatment.py -v`
Expected: collection ERROR, `No module named 'training.scanner.label_treatment'`

- [ ] **Step 3: Implement**

```python
# training/scanner/label_treatment.py
"""Hand-label surface treatment for Head B (spec §6.1). Resumable; one keypress per image.

    .venv/bin/python -m training.scanner.label_treatment --split data/splits/fabric.csv

Keys: 1 printed · 2 piece-dyed · 3 yarn-dyed · 4 undyed · s skip · q quit.
Head B ships once every class has >= 100 labels.
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import Counter
from pathlib import Path

KEYS = {"1": "printed", "2": "piece_dyed", "3": "yarn_dyed", "4": "undyed"}
OUT = Path("data/treatment_labels.csv")


def load_labels(csv_path: Path) -> dict[str, str]:
    if not Path(csv_path).exists():
        return {}
    with open(csv_path, newline="") as f:
        return {row["path"]: row["treatment"] for row in csv.DictReader(f)}


def append_label(csv_path: Path, image_path: str, label: str) -> None:
    csv_path = Path(csv_path)
    new = not csv_path.exists()
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["path", "treatment"])
        w.writerow([image_path, label])


def todo(pool: list[str], done: dict, n: int, seed: int = 0) -> list[str]:
    order = sorted(pool)
    random.Random(seed).shuffle(order)
    return [p for p in order if p not in done][:n]


def main(argv: list[str] | None = None) -> int:
    import matplotlib.pyplot as plt
    from PIL import Image

    from training.textilenet.splits import read_csv

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--split", type=Path, default=Path("data/splits/fabric.csv"))
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--n", type=int, default=100, help="images this session")
    args = ap.parse_args(argv)

    pool = [r.path for r in read_csv(args.split) if r.split == "train"]
    queue = todo(pool, load_labels(OUT), args.n)
    fig, ax = plt.subplots(figsize=(6, 6))
    state = {"i": 0}

    def show():
        ax.clear()
        ax.imshow(Image.open(args.data_root / queue[state["i"]]).convert("RGB"))
        counts = Counter(load_labels(OUT).values())
        ax.set_title(f"{state['i'] + 1}/{len(queue)}  1 printed · 2 piece · 3 yarn · 4 undyed"
                     f" · s skip · q quit\n{dict(counts)}", fontsize=8)
        ax.axis("off")
        fig.canvas.draw_idle()

    def on_key(event):
        if event.key == "q":
            plt.close(fig)
            return
        if event.key in KEYS:
            append_label(OUT, queue[state["i"]], KEYS[event.key])
        if event.key in KEYS or event.key == "s":
            state["i"] += 1
            if state["i"] >= len(queue):
                plt.close(fig)
                return
            show()

    if not queue:
        print("nothing left to label")
        return 0
    fig.canvas.mpl_connect("key_press_event", on_key)
    show()
    plt.show()
    print(dict(Counter(load_labels(OUT).values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_label_treatment.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add training/scanner/label_treatment.py tests/test_label_treatment.py
git commit -m "Add the Head B hand-labelling tool: resumable, one keypress per image"
```

---

### Task 8: Run the bake-off and apply its decisions

**Files:**
- Modify: `services/api/config.py` (defaults), `services/consistency/kb.yaml` (thresholds, version)
- Create: `results/bakeoff/bakeoff.md` (committed; the JSON caches stay local)

- [ ] **Step 1: Check the phone set**

Run: `.venv/bin/python scripts/check_phone_set.py data/phone`
Expected: `OK`, with at least 60 garments. Otherwise send the problem list to the team and wait.

- [ ] **Step 2: Run the bake-off** (backends load one at a time; ~10–20 min for 100 garments)

Run: `caffeinate -ims .venv/bin/python -m training.scanner.bakeoff --phone data/phone --detectors gdino owlv2 --ocr apple paddle --bundle models/scanner-v1`
Expected: `wrote results/bakeoff/bakeoff.md`, naming a default detector, an OCR engine, a view setting and thresholds.

- [ ] **Step 3: Apply the decisions**

- Set the defaults in `services/api/config.py` (`Settings.detector`, the `ocr` default in
  `from_env`) to the two winners.
- If `crop+patches` won, pass `patches=True` in `build_scanner`'s call from `services/api/config.py`.
- Record the thresholds from `results/bakeoff/thresholds.json` in `kb.yaml`, bump `version`, and update
  `test_kb_is_version_two_with_a_family_threshold` to the new version.
- If `choose()` returns None, keep the current thresholds and say so in `bakeoff.md`.

Run: `.venv/bin/python -m pytest && .venv/bin/ruff check .`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add results/bakeoff/bakeoff.md services/api/config.py services/consistency/kb.yaml tests/test_consistency.py
git commit -m "Apply bake-off round 1: default detector, OCR engine and KB thresholds"
```
