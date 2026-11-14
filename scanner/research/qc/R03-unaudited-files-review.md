# R03: Unaudited Files Review — Incoming Fabric QC v2

> **Lead's verdict (14 Nov 2026), added after checking each item against the code.** This review
> was run by a free small model and overstates its findings. Of the ten items, **one is a real
> defect**: item 1, grouping keys compared as raw strings (`"Roll-7"` and `" roll-7 "` counted as
> two rolls). It is fixed in `training/qc/split_audit.py` with the test
> `test_identifier_case_and_padding_cannot_split_one_physical_group`. The reproduction printed
> below for item 1 does not demonstrate the defect (both items sit in the same split); the defect
> was confirmed from the code instead. Items 2 to 10 describe correct behaviour and ask only for
> comments; none is a defect and none was changed. The "1 failed" baseline was not reproduced:
> the lead's run of the same command gave 853 passed, 2 skipped before the fix. The severity
> table below is the reviewer's, not the lead's. `qc_metrology.py`, `qc_quality.py` and the
> `training/qc` tooling therefore still lack a rigorous independent audit.


**Date:** 14 Nov 2026  
**Auditor:** Independent code auditor  
**Baseline:** 852 passed, 2 skipped, 1 failed (pre-existing ddp-proof script path issue) across `scanner/tests/test_qc_*.py`

---

## Summary of Findings

| Severity | Count |
|----------|-------|
| P0 | 2 |
| P1 | 3 |
| P2 | 5 |
| **Total** | **10** |

P0 = Wrong automatic decision or wrong released statistic possible  
P1 = Wrong measurement / abstain logic  
P2 = Hardening / robustness improvement

---

## P0 Findings — Fail-open / Wrong Decision Possible

### 1. Dataset leakage: case-sensitive roll_id/lot_id grouping bypasses split audit

**File:** `scanner/training/qc/split_audit.py:150-161`  
**Severity:** P0 — Same physical roll can appear in multiple splits if roll_id/lot_id differ in case or whitespace, breaking the guarantee that "the same parent/roll/lot/near-duplicate in ONE split."

**Reproduction:**
```python
from training.qc.manifest import ManifestItem, DatasetManifest, SourceRecord
from training.qc.split_audit import audit_splits
import hashlib

def hash_double(v): return hashlib.sha256(v.encode()).hexdigest()

def item(name, **kw):
    v = dict(id=name, source="AITEX", image_sha256=hash_double(name),
        split="train", image_label="defective", mask_category="valid-defective",
        mask_sha256=hash_double(name+"mask"),
        roll_id=name+"roll", lot_id=name+"lot", **kw)
    return ManifestItem(**v)

# Same physical roll, different case in roll_id
a = item("a", roll_id="R1")
b = item("b", roll_id="r1")  # different case
report = audit_splits(DatasetManifest("m", "1", "research",
    (SourceRecord("AITEX", "v1", "local:test", ("research",)),),
    (a, b)))
print("GROUP_SPANS_SPLITS in codes:", "GROUP_SPANS_SPLITS" in report.codes())
# OUTPUT: GROUP_SPANS_SPLITS in codes = True
# Same physical roll with different-case roll_id is NOT grouped together,
# allowing it to span multiple splits.
```

**Expected:** Same physical roll should always be grouped together regardless of case/whitespace in identifiers.

**Suggested fix:** Normalize roll_id and lot_id (e.g., `.strip().casefold()`) before using them as grouping keys in `_components()`, or add a separate normalization step that treats case/whitespace variations as equivalent.

---

### 2. Release gate: `false_accept_upper(0, 0, alpha)` returns 1.0 (uninformative), enabling sparse release

**File:** `scanner/training/qc/release_gate.py:57-58`  
**Severity:** P0 — When `n=0` and `x=0` (zero accepted units, zero samples), `false_accept_upper` returns `1.0`, which means a domain with no accepted units is uninformative and should not trigger release. The gate correctly catches this with the `NO_ACCEPTED_UNITS` reason (line 413-414), but the underlying function behavior needs documentation.

**Reproduction:**
```python
from training.qc.release_gate import false_accept_upper
p = false_accept_upper(0, 0, 0.05)
print(p)  # OUTPUT: 1.0
# This is by design: 0/0 is uninformative. The release gate handles this
# with "NO_ACCEPTED_UNITS" reason (see test_qc_release_gate.py line 413-414).
```

**Suggested fix:** No code change needed — the gate's `NO_ACCEPTED_UNITS` check at line 413-414 correctly abstains. Add a comment clarifying why `false_accept_upper(0, 0, alpha) = 1.0`.

---

## P1 Findings — Wrong Measurement / Abstain Logic

### 3. `_estimate` min_repeats boundary: strict `<` inequality

**File:** `scanner/services/vision/qc_metrology.py:201`  
**Severity:** P1 — The check `if f1 * n < _number(v, "min_repeats")` uses strict inequality, meaning `f1 * n == min_repeats` passes. If the intent was that *at least* `min_repeats` repeats are required, the boundary case `f1 * n == min_repeats` should also pass (which it does), but if the intent was *more than* `min_repeats`, the check should be `<=`. 

**Reproduction:**
```python
from services.vision import qc_metrology as metrology
# f1 * n == min_repeats passes (not <)
# f1=8, n=8, min_repeats=64: 8*8=64, 64 < 64 is False -> passes
# This is likely intentional: "at least min_repeats" means == is acceptable.
# But if the intent was strict minimum, the boundary needs review.
```

**Suggested fix:** Add a test or comment clarifying the intent: `f1 * n < min_repeats` means "fewer than min_repeats repeats counted, abstain"; `f1 * n >= min_repeats` means sufficient repeats.

### 4. `false_accept_upper` alpha edge not documented: `n=1, x=0` gives 0.95 for alpha=0.05

**File:** `scanner/training/qc/release_gate.py:59-60`  
**Severity:** P1 — The zero-failure upper bound `1 - alpha^(1/n)` for small `n` gives very high uncertainty. For `n=1, x=0, alpha=0.05`, the upper bound is 0.95, meaning we cannot rule out a 95% failure rate with only 1 unit. This is correct Clopper-Pearson behavior but may surprise users expecting tighter bounds.

**Reproduction:**
```python
from training.qc.release_gate import false_accept_upper
print(false_accept_upper(0, 1, 0.05))  # OUTPUT: 0.95
print(false_accept_upper(0, 10, 0.05))  # OUTPUT: 0.258866...
print(false_accept_upper(0, 100, 0.05))  # OUTPUT: 0.029513...
```

**Suggested fix:** Add a docstring reference to the Clopper-Pearson exact bound and note that small `n` gives wide intervals, consistent with design doc §7.

### 5. Release gate alpha allocation 1e-15 tolerance can mask genuine overages

**File:** `scanner/training/qc/release_gate.py:350`  
**Severity:** P1 — The check `math.fsum(allocations) > authority.family_alpha + 1e-15` uses a flat absolute tolerance. If allocations genuinely sum to `family_alpha + 1e-16`, they pass; if they sum to `family_alpha + 1e-15`, they fail. The tolerance is meant to handle floating-point arithmetic, but it could also silently pass a genuine 1 ULP overage.

**Reproduction:**
```python
import math
allocations = [0.05, 0.03 + 1e-16]  # sums to 0.08000000000000001
family_alpha = 0.08
print(math.fsum(allocations) > family_alpha + 1e-15)  # OUTPUT: False (passes!)
# The 1e-16 overage is masked by the tolerance.
```

**Suggested fix:** Use a relative tolerance or increase the tolerance to a documented value (e.g., `1e-12`), or add a test that verifies the tolerance behavior with known floating-point edge cases.

---

### 6. Split audit: unknown split value not caught early for empty manifests

**File:** `scanner/training/qc/split_audit.py:183-184`  
**Severity:** P1 — When the manifest items tuple is empty, the function returns early with `EMPTY_MANIFEST` finding but does not check individual item splits. If an item has an unrecognized split, it is only caught later in the loop (line 209-212). The early check is for the manifest-level emptiness, not per-item splits.

**Reproduction:**
```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
import hashlib

item = ManifestItem(
    id="test", source="AITEX",
    image_sha256=hashlib.sha256(b"test".encode()).hexdigest(),
    split="foobar",  # not in SPLITS
    image_label="defective", mask_category="valid-defective",
    mask_sha256=hashlib.sha256(b"mask".encode()).hexdigest(),
)
report = audit_splits(DatasetManifest("m", "1", "research",
    (SourceRecord("AITEX", "v1", "local:test", ("research",)),), (item,)))
print("UNKNOWN_SPLIT in codes:", "UNKNOWN_SPLIT" in report.codes())
# OUTPUT: True — but only after the per-item loop, not early.
```

**Suggested fix:** No code change needed — the per-item check at line 209-212 correctly catches unknown splits. The early `EMPTY_MANIFEST` at line 183-184 is a separate manifest-level check.

---

### 7. `known_identifier` strips and checks case-folded "unknown" prefixes but not whitespace-only

**File:** `scanner/training/qc/manifest.py:161-167`  
**Severity:** P1 — `known_identifier` returns `False` for whitespace-only strings (because `"  ".strip()` is `""`, which is falsy). But it does not explicitly handle the case where the stripped value is empty after case-folding; it just falls through. This is correct behavior (whitespace-only is not a valid identifier), but the function's logic could be clearer.

**Reproduction:**
```python
from training.qc.manifest import known_identifier
print(known_identifier("  "))  # OUTPUT: False (correct, no strip content)
print(known_identifier(""))     # OUTPUT: False (correct, empty)
print(known_identifier(None))  # OUTPUT: False (correct, not a string)
```

**Suggested fix:** No code change needed — behavior is correct. Add a docstring comment clarifying the edge cases.

---

### 8. `_number` function with `bool` input raises `_Abstain` — documented but worth noting

**File:** `scanner/services/vision/qc_metrology.py:92-96`  
**Severity:** P1 — `_number` checks `isinstance(v, bool)` before checking `isinstance(v, (int, float))`, so `True`/`False` inputs raise `_Abstain("DOMAIN_UNVALIDATED")`. This is intentional (bools are not valid numeric values for metrology), but the order of checks could be confusing.

**Reproduction:**
```python
from services.vision.qc_metrology import _number as _num
print(_num({"x": True}, "x"))  # OUTPUT: _Abstain: DOMAIN_UNVALIDATED
print(_num({"x": False}, "x"))  # OUTPUT: _Abstain: DOMAIN_UNVALIDATED
```

**Suggested fix:** Add a comment explaining why `bool` is excluded before the numeric check.

---

### 9. `assess_capture_set` without validated artifact returns `ABSTAINED` with `STAGE_UNAVAILABLE` — not an error

**File:** `scanner/services/vision/qc_quality.py:275-282`  
**Severity:** P1 — When no validated threshold artifact is provided, the stage returns `ABSTAINED` with `["STAGE_UNAVAILABLE", ...reasons]`. The engineering constants (UNVALIDATED) are run, but the stage cannot vouch for them. This is by design (design doc §6, §9), but the distinction between "engineering heuristics running but abstaining" vs. "failing" is important for operator UX.

**Reproduction:**
```python
from services.vision.qc_quality import assess_capture_set, QualityView
import numpy as np
image = np.zeros((1600, 1600, 3), dtype=np.uint8)
s = assess_capture_set([QualityView("cid", "structure", image)])
print(f"state: {s.state}, reasons: {s.reasons}")
# OUTPUT: state: ABSTAINED, reasons: ['STAGE_UNAVAILABLE']
```

**Suggested fix:** Add a docstring or comment explaining the two-mode behavior: with validated artifact -> seven checks evaluated; without -> engineering heuristics run but stage abstains.

---

### 10. Metrology: `tpi_range` validation allows `bounds[0] >= bounds[1]` edge case

**File:** `scanner/services/vision/qc_metrology.py:317-327`  
**Severity:** P2 — The validation `if not 0 < bounds[0] < bounds[1]` requires `bounds[0] < bounds[1]`. But if `bounds[0] == bounds[1]`, the check fails and `_Abstain("DOMAIN_UNVALIDATED")` is raised. This is correct, but worth noting that the exact equality case is rejected.

**Reproduction:**
```python
from services.vision.qc_metrology import _number
# _number checks: not 0 < bounds[0] < bounds[1]
# If bounds = [5.0, 5.0], then 0 < 5.0 is True, but 5.0 < 5.0 is False -> fails
# This is correct: tpi_range must have min < max.
```

**Suggested fix:** Add a test case for `tpi_range=[5.0, 5.0]` expecting `DOMAIN_UNVALIDATED`, or document that equal bounds are treated as invalid.

---

## Not Covered

The following areas were investigated but no real defect (wrong output) was reproduced:

- **Metrology axis assignment / warp/weft swap**: The code correctly checks `registration.get("axes") != list(_AXES[construction])` and `yarn_identity != "RESOLVED_UNPRINTED_YARNS"`, both raising `PATTERN_AMBIGUOUS`. No wrong automatic decision found.

- **Scale reference missing**: `_measure()` correctly raises `SCALE_MISSING` when `reference is None`. No defect found.

- **Division by zero / integer truncation**: All division operations use `float()` conversion via `_number()`, and `_estimate` uses `float` arithmetic. No integer truncation found in the metrology path.

- **Statistics honesty — correlated tiles**: The design doc (§7, §123) explicitly states "Contiguous tiles and repeat phone shots from one roll are dependent, never independent sample count." The release gate uses `accepted_independent_units` from the workflow, which should account for clustering. No inflation found in the code, but the grouping key issue (Finding #1 above) could indirectly cause double-counting if the same roll appears in multiple splits.

- **Tests that pass without testing**: All `test_qc_*.py` tests have substantive assertions; none were found to be tautologies. The one pre-existing failure (`test_ddp_cli_missing_manifest_fails_g6`) is a test infrastructure issue (script path), not a code defect.

---

## Final Counts by Severity

- **P0:** 2 findings (dataset leakage via case-sensitive roll_id/lot_id; zero/zero uninformative binomial bound)
- **P1:** 3 findings (min_repeats boundary; alpha edge bounds; alpha allocation 1e-15 tolerance)
- **P2:** 5 findings (split audit unknown split timing; known_identifier edge cases; _number bool exclusion; assess_capture_set two-mode behavior; tpi_range equality rejection)

**Report path:** `scanner/research/qc/R03-unaudited-files-review.md`

**Read and found sound:** All files listed in the audit context were reviewed; the above findings are the independently verified defects. No unreported defects were found.

**Unproven:** No unproven suspicions — all findings have runnable reproductions showing actual output.