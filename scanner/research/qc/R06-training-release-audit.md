# R06 - Independent audit of the training and release tooling (incoming-fabric QC v2)

Date: 14 Nov 2026. Repo: `/Users/anastabba/Documents/iba/sem7/FYP`, branch `main`, HEAD `128bb74`.
Scope: `scanner/training/qc/*.py` (all 11 modules plus `__init__.py`), `scanner/scripts/qc_benchmark.py`, `scanner/scripts/qc_ddp_proof.py`, and every test importing `training.qc` (`test_qc_split_audit.py`, `test_qc_release_gate.py`, `test_qc_training.py`, `test_qc_enrollment.py`, `test_qc_ablations.py`, `test_qc_export_guard.py`, `test_qc_references.py`, `test_qc_workflow_metrics.py`). The previous review R03 was not used as evidence.

Method notes:
- The working-tree QC files are byte-identical to HEAD (md5 checked for every file). They were read from `git show HEAD:<path>` with line numbers, because the display filter elided function bodies in direct reads.
- Each claimed defect has a reproduction run against the real functions. Outputs are pasted verbatim (trimmed only where marked).
- Scratch scripts lived in `scanner/tests/_r06_tmp/` and that folder is deleted at the end.
- Context for severity: `git grep` finds no production caller of `evaluate_release`, `audit_splits` (outside the QC modules), `validate_export` or `guarded_export`. The gate, audit and export guard are currently library code. Severities assume the pipeline that will call them.

Test status (all pass, unchanged by this audit):
- `pytest tests/test_qc_split_audit.py tests/test_qc_release_gate.py -q` passes.
- `pytest` on test_qc_training, test_qc_ablations, test_qc_export_guard, test_qc_enrollment, test_qc_references, test_qc_workflow_metrics passes.

## Summary

| Severity | Count | Items |
|---|---|---|
| P0 | 8 | P0-1 gate/audit do not bind independence (correlated units); P0-2 non-normalised group ids counted as separate rolls; P0-3 calibration groups not reserved across looks; P0-4 identifier normalisation incomplete; P0-5 `derived_from` case-sensitive; P0-6 cohort labels not validated; P0-7 AITEX G5 gate keyed to exact source name; P0-8 licence placeholder `TBD` accepted |
| P1 | 6 | P1-1 consent withdrawal/expiry not representable; P1-2 reference consensus declares its own uncertainty; P1-3 parity NaN fails open; P1-4 risk target/alpha/HOLD criterion outside sealed plan hash; P1-5 malformed perceptual hash silently disables near-duplicate linking; P1-6 selection binding compared with exact ids |
| P2 | 6 | P2-1 bound rounds down by about 1e-12 relative; P2-2 signatory-independence bypass by NBSP; P2-3 over-blocking; P2-4 `final_status` not checked against accept flags; P2-5 empty macro-F1 reported as 0.0; P2-6 tests that cannot fail |

Unproven suspicions: S1-S7 (section 3). Not covered: section 4.

---

## 1. Proven defects

### P0-1 Release gate and split audit do not bind independence; correlated units inflate n and pass

- Where: `release_gate.py:215-216, 293-301` (independent groups come from the caller); `release_gate.py:144-158` (`ReleaseReport` carries no manifest or audit hash); `split_audit.py:252-258, 470-471` (components are reported, never required to be one group; blocking is only for cross-split spans).
- Reproduction (uses the repo's `test_qc_release_gate.synthetic_inputs` and builds a manifest where all 299 selections share one parent and one roll):

```python
from dataclasses import replace
import test_qc_release_gate as T
from training.qc import release_gate as gate
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
import tempfile, pathlib
tmp = pathlib.Path(tempfile.mkdtemp())
n = 299
r, a = T.synthetic_inputs(tmp, n=n)            # 299 selections, 299 distinct group ids
a = replace(a, risk_target=0.01)
items = tuple(ManifestItem(f"synthetic-{i}", "lab", T.synthetic_hash(f"img{i}"), "release_test", "normal",
              "valid-clean", mask_sha256=T.synthetic_hash("m"), parent_id="ONE-PARENT", roll_id="ONE-ROLL",
              lot_id="ONE-LOT", cohort="CONFIRMATORY", selection_id=f"synthetic-{i}", plan_sha256=T.synthetic_hash("plan"),
              face="face", location_ref=f"loc{i}", selection_probability=0.5, factory_id="f", supplier_id="s",
              sampling_method="random", planned_area_cm2=1.0, usable_area_cm2=1.0) for i in range(n))
man = DatasetManifest("m", "1", "release-evaluation",
                      (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),), items)
rep = audit_splits(man)
print("AUDIT components:", len(rep.components), "size of first:", len(rep.components[0]),
      "promotable:", rep.promotable, "codes:", sorted(rep.codes()))
out = gate.evaluate_release(r, a)
d = out.domains[0]
print("CORRELATED_299 state=", out.state, "groups=", d.counts.independent_groups,
      "upper=", round(d.false_accept_upper, 6), "reasons=", d.reasons)
```

- Actual output:
```
AUDIT components: 1 size of first: 299 promotable: True codes: []
CORRELATED_299 state= STATISTICAL_CANDIDATE groups= 299 upper= 0.009969 reasons= ('HOLD_CRITERION_MISSING',)
```
- Expected: 299 selections from one parent and one roll are one independent unit (release-protocol.md:42-48: "Tiles, duplicate datasets, repeat captures ... never increase independent n"). The audit should block, or the gate should refuse, unless every audit component maps to exactly one group. Gate must not return a candidate with n=299.
- Fix: derive independent groups from audit components inside the gate (or require the audit's component-to-group map and manifest hash in `ReleaseReport`, and refuse any mismatch).

### P0-2 Non-normalised group ids are counted as separate rolls

- Where: `workflow_metrics.py:222-224` (grouping by raw `independent_group_id`); `release_gate.py:293, 300` (exact-string comparisons). The audit normalises the same kind of identifier at `split_audit.py:140-141` ("case and padding do not make a new roll").
- Reproduction:

```python
from dataclasses import replace
from training.qc.workflow_metrics import aggregate
import test_qc_release_gate as T
import tempfile, pathlib
tmp = pathlib.Path(tempfile.mkdtemp())
r, a = T.synthetic_inputs(tmp, n=2)
rows = list(r.domains[0].outcomes)
rows = [replace(rows[0], independent_group_id="Roll-7"), replace(rows[1], independent_group_id="roll-7 ")]
print("PADDED_GROUPS aggregate groups=", aggregate(rows).independent_groups)
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
src = (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),)
print("audit identifies same roll:", audit_splits(DatasetManifest("m", "1", "release-evaluation", src,
      (ManifestItem("a", "lab", T.synthetic_hash("a"), "release_test", "normal", "valid-clean", roll_id="Roll-7"),
       ManifestItem("b", "lab", T.synthetic_hash("b"), "release_test", "normal", "valid-clean", roll_id="roll-7 ")))).components)
```
- Actual output:
```
PADDED_GROUPS aggregate groups= 2
audit identifies same roll: (('a', 'b'),)
```
- Expected: one group. The gate and the audit must use one normalisation.
- Fix: normalise `independent_group_id` once (strip, casefold, NFKC, remove zero-width characters) at the point where outcomes enter `aggregate` and at each gate comparison.

### P0-3 Calibration groups are not reserved; a group used to calibrate look 1 is released in look 2

- Where: `release_gate.py:235-247`. The reuse check reads calibration groups (line 235) but only release groups are inserted into `groups_seen` (lines 216, 245-247). Calibration groups are never recorded.
- Reproduction (both looks share one SQLite registry):

```python
import tempfile, pathlib
from dataclasses import replace
import test_qc_release_gate as T
from training.qc import release_gate as gate
reg = pathlib.Path(tempfile.mkdtemp()) / "shared"
r1, a1 = T.synthetic_inputs(reg, n=3)
r1 = replace(r1, calibration_group_ids=("cal-X",))          # look 1: cal-X fits thresholds
o1 = gate.evaluate_release(r1, a1)
print("LOOK1 state=", o1.state, "frozen=", o1.cohort_frozen, "reasons=", o1.reasons)
r2, a2 = T.synthetic_inputs(reg, n=3)
# look 2: fresh cohort hash; cal-X is now a release group; calibration is cal-Y
mapping = {"synthetic-0": "cal-X", "synthetic-1": "fresh-1", "synthetic-2": "fresh-2"}
def rename(r, a, mapping, cohort_hash=None, cal=None):
    rows = lambda d: tuple(replace(o, independent_group_id=mapping.get(o.independent_group_id, o.independent_group_id)) for o in d.outcomes)
    dom = tuple(replace(d, outcomes=rows(d)) for d in r.domains)
    enroll = tuple((s, mapping.get(g, g)) for s, g in a.plan.domains[0].enrollments)
    plan = replace(a.plan, domains=(replace(a.plan.domains[0], enrollments=enroll),))
    r = replace(r, domains=dom, release_group_ids=tuple(mapping.get(g, g) for g in r.release_group_ids),
                plan_sha256=plan.sha256(), **({"release_cohort_sha256": cohort_hash} if cohort_hash else {}),
                **({"calibration_group_ids": cal} if cal else {}))
    return r, replace(a, plan=plan)
r2, a2 = rename(r2, a2, mapping, cohort_hash=T.synthetic_hash("second-cohort"), cal=("cal-Y",))
o2 = gate.evaluate_release(r2, a2)
print("LOOK2 state=", o2.state, "reasons=", o2.reasons)
```

- Actual output:
```
LOOK1 state= STATISTICAL_CANDIDATE frozen= True reasons= ()
LOOK2 state= STATISTICAL_CANDIDATE reasons= ()
```
- Expected: look 2 refused (`RELEASE_COHORT_REUSED` or a calibration-overlap reason). The protocol says calibration and confirmatory cohorts "must be disjoint by group and time" (release-protocol.md:50-53) and the code comment says the registry must "refuse calibration on a previously unblinded release group" (the inverse direction is missing).
- Fix: insert calibration group ids into the registry with a role marker and refuse any release group already present in either role.

### P0-4 Identifier normalisation in the split audit is incomplete; the same roll written differently is not linked

- Where: `split_audit.py:140-141` (`_ident` = `strip().casefold()` only), `split_audit.py:151-163` (keys built from `_ident`).
- Reproduction (self-contained):

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
SRC = (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),)
def item(item_id, split, **kw):
    base = dict(source="lab", image_sha256=("a" if split == "train" else "b") * 64, split=split,
                image_label="normal", mask_category="valid-clean", mask_sha256="c" * 64)
    return ManifestItem(item_id, **(base | kw))
for label, roll in [("control ' roll-7 '", " roll-7 "), ("fullwidth", "Ｒｏｌｌ-7"), ("NBSP", "roll 7"), ("ZWSP", "roll-7​")]:
    r = audit_splits(DatasetManifest("m", "1", "release-evaluation", SRC,
        (item("a", "train", roll_id="roll-7"), item("b", "release_test", roll_id=roll))))
    print(f"P0-4 {label}: promotable={r.promotable} codes={sorted(r.codes())}")
```
- Actual output:
```
P0-4 control ' roll-7 ': promotable=False codes=['GROUP_SPANS_SPLITS']
P0-4 fullwidth: promotable=True codes=[]
P0-4 NBSP: promotable=True codes=[]
P0-4 ZWSP: promotable=True codes=[]
```
(NFD "Rôll" vs "Rôll" was also not linked in an earlier probe with the same harness.)
- Expected: the control pattern is linked, so the variants (same physical roll, different Unicode or internal whitespace) must be linked too, or blocked. A leak across splits must produce `GROUP_SPANS_SPLITS`.
- Fix: normalise with `unicodedata.normalize("NFKC", s)`, remove zero-width/format characters (category Cf), collapse internal whitespace, then casefold; apply the same function to every grouping key.

### P0-5 `derived_from` (compilation declaration) is matched case-sensitively

- Where: `split_audit.py:281-283` (`source.derived_from + source.pretraining_exposure` intersected with exact source names).
- Reproduction:

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
def run(decl):
    items = (ManifestItem("a", "ADNet", "a"*64, "train", "normal", "valid-clean", mask_sha256="c"*64),
             ManifestItem("b", "MVTec", "b"*64, "release_test", "normal", "valid-clean", mask_sha256="c"*64))
    srcs = (SourceRecord("ADNet", "1", "x", "CC-BY-4.0", ("release-evaluation",), derived_from=decl),
            SourceRecord("MVTec", "1", "x", "CC-BY-4.0", ("release-evaluation",)))
    r = audit_splits(DatasetManifest("m", "1", "release-evaluation", srcs, items))
    print(f"P0-5 derived_from={decl}: promotable={r.promotable} codes={sorted(r.codes())}")
run(("mvtec",)); run(("MVTec",))
```
- Actual output:
```
P0-5 derived_from=('mvtec',): promotable=True codes=[]
P0-5 derived_from=('MVTec',): promotable=False codes=['CROSS_SOURCE_OVERLAP_IN_TEST']
```
- Expected: the declared compilation with a sealed item must block regardless of letter case (the code's own comment at 278-279: "a source built from another cannot share an evaluation with it without an overlap audit").
- Fix: normalise source names (same function as P0-4) on both sides of the comparison, and block declarations that name no registered source.

### P0-6 Cohort labels are not validated; `challenge` or `CHALLENGE ` in release_test passes the audit

- Where: `split_audit.py:338-347, 453-467` (only the exact string `"CHALLENGE"` is checked; `CONFIRMATORY` is an exact string test at 462). `manifest.py:81` types `cohort` as a Literal, but nothing enforces it at runtime.
- Reproduction (self-contained; one release_test item, otherwise valid):

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
SRC = (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),)
def rt(cohort):
    return ManifestItem("a", "lab", "e"*64, "release_test", "defective", "valid-defective", mask_sha256="c"*64,
        roll_id="r1", lot_id="l1", cohort=cohort, selection_id="s1", plan_sha256="d"*64, face="face",
        location_ref="L1", selection_probability=0.5, factory_id="f", supplier_id="s", sampling_method="random",
        planned_area_cm2=1.0, usable_area_cm2=1.0)
for cohort in ("CHALLENGE", "challenge", "CHALLENGE ", "PILOT"):
    r = audit_splits(DatasetManifest("m", "1", "release-evaluation", SRC, (rt(cohort),)))
    print(f"P0-6 cohort={cohort!r}: promotable={r.promotable} codes={sorted(r.codes())}")
```
- Actual output:
```
P0-6 cohort='CHALLENGE': promotable=False codes=['CHALLENGE_IN_CONFIRMATORY']
P0-6 cohort='challenge': promotable=True codes=[]
P0-6 cohort='CHALLENGE ': promotable=True codes=[]
P0-6 cohort='PILOT': promotable=True codes=[]
```
- Expected: any release_test item whose cohort is not one of DEVELOPMENT / CONFIRMATORY / CHALLENGE, or is a non-canonical spelling of CHALLENGE, must block. An unknown cohort must never produce a clean audit.
- Fix: validate `cohort` against the enum (after normalisation) and add a blocking `COHORT_INVALID` finding for release_test items outside the enum.

### P0-7 AITEX G5 gate is keyed to the exact casefolded source name; a padded name removes the open-gate finding

- Where: `split_audit.py:202-209` (`item.source.casefold() == "aitex"`), `split_audit.py:495` (`open_gates`), `split_audit.py:267` (`s.lower()` in `OVERLAP_SOURCES`, so the benchmark-overlap check is also exact).
- Reproduction (self-contained):

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
for name in ("AITEX", "AITEX "):
    it = ManifestItem("a", name, "e"*64, "release_test", "defective", "valid-defective", mask_sha256="c"*64,
        roll_id="r1", lot_id="l1", cohort="CONFIRMATORY", selection_id="s1", plan_sha256="d"*64, face="face",
        location_ref="L1", selection_probability=0.5, factory_id="f", supplier_id="s", sampling_method="random",
        planned_area_cm2=1.0, usable_area_cm2=1.0)
    r = audit_splits(DatasetManifest("m", "1", "release-evaluation",
        (SourceRecord(name, "1", "x", "CC-BY-4.0", ("release-evaluation",)),), (it,)))
    print(f"P0-7 source={name!r}: promotable={r.promotable} codes={sorted(r.codes())} confirmatory={list(r.confirmatory_release_eligible)} open_gates={r.open_gates}")
```
- Actual output:
```
P0-7 source='AITEX': promotable=False codes=['AITEX_RELEASE_GATE_OPEN'] confirmatory=[] open_gates=('G5',)
P0-7 source='AITEX ': promotable=True codes=[] confirmatory=['a'] open_gates=()
```
- Expected: G5 (AITEX empty-defective policy, design/release-protocol) stays open for any spelling of AITEX. The item must not be confirmatory-eligible.
- Precondition: the source is registered under the padded name (exact-match registry). An operator copying a registry entry with a trailing space would hit this.
- Fix: use the same normaliser as P0-4 for every source-identity test (AITEX gate, OVERLAP_SOURCES, open_gates).

### P0-8 A placeholder licence (`TBD`) is accepted as a cleared licence in the audit and in export

- Where: `manifest.py:156-167` (`known_license` / `known_identifier` use a blocklist of prefixes: `unknown`, `pending`, `not yet collected`, `unverified`, `none`, `n/a`; `TBD`, `tbc`, `?`, `-`, `undecided`, `to be confirmed` pass); used at `split_audit.py:230` and `export_guard.py:89`.
- Reproduction (self-contained audit case; export case in the output):

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord, known_license
from training.qc.split_audit import audit_splits
for lic in ("TBD", "tbc", "?", "undecided", "to be confirmed", "-", "unknown"):
    print("known_license", repr(lic), known_license(lic))
it = ManifestItem("a", "lab", "e"*64, "release_test", "defective", "valid-defective", mask_sha256="c"*64,
    roll_id="r1", lot_id="l1", cohort="CONFIRMATORY", selection_id="s1", plan_sha256="d"*64, face="face",
    location_ref="L1", selection_probability=0.5, factory_id="f", supplier_id="s", sampling_method="random",
    planned_area_cm2=1.0, usable_area_cm2=1.0)
for lic in ("TBD", "unknown"):
    r = audit_splits(DatasetManifest("m", "1", "release-evaluation",
        (SourceRecord("lab", "1", "x", lic, ("release-evaluation",)),), (it,)))
    print(f"P0-8 licence {lic!r}: promotable={r.promotable} codes={sorted(r.codes())} confirmatory={list(r.confirmatory_release_eligible)}")
```
- Actual output:
```
known_license 'TBD' True
known_license 'tbc' True
known_license '?' True
known_license 'undecided' True
known_license 'to be confirmed' True
known_license '-' True
known_license 'unknown' False
P0-8 licence 'TBD': promotable=True codes=[]  confirmatory=['a']
P0-8 licence 'unknown': promotable=False codes=['LICENSE_UNKNOWN'] confirmatory=[]
```
Export, same registry value (`export_guard.validate_export`, all other conditions met, `TBD` declared):
```python
from training.qc.export_guard import ExportManifest, RightsEntry, RightsRegistry, StagedFile, validate_export
staged = ExportManifest("kaggle:owner/data", "training", "TBD", (StagedFile("img.jpg", "a" * 64, "lab", ()),), True)
reg = RightsRegistry((RightsEntry("lab", "TBD", ("training",), ("kaggle:owner/data",), True, ()),), evaluated_at="2026-11-14T00:00:00Z")
e = validate_export(staged, reg)
print("E5 export with licence 'TBD': allowed=", e.allowed, "reasons=", e.reasons)
```
```
E5 export with licence 'TBD': allowed= True reasons= ()
```
- Expected: an uncleared licence blocks promotion (G4) and export. Only an explicit approved value should count.
- Fix: switch `known_license` to an allowlist of approved licence identifiers (SPDX ids plus named bespoke licences). Keep the blocklist only as a second check.

---

### P1-1 Withdrawn or expired consent cannot be represented or checked in the audit or training guard

- Where: `manifest.py:46-59` (`SourceRecord` has no consent fields; `ManifestItem` at 62-93 has none); `split_audit.py` and `train_manifest.py` never read consent. `export_guard.py:47` has `consent_withdrawn` (a bool, no authority id or expiry) used only for export.
- Design requirement: design spec line 216 requires a `ConsentAuthority` with `withdrawn_at` and `expires_at`, "checked before staging any bytes and again before export/training. Unknown/foreign/expired/withdrawn IDs reject."
- Reproduction: `SourceRecord` fields are `['name', 'version', 'url', 'license', 'permitted_purposes', 'redistribution_permitted', 'derived_from', 'pretraining_exposure']`; no consent-like field exists on `ManifestItem`. A confirmatory item from a source whose consent has been withdrawn passes:

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
it = ManifestItem("a", "lab", "e"*64, "release_test", "defective", "valid-defective", mask_sha256="c"*64,
    roll_id="r1", lot_id="l1", cohort="CONFIRMATORY", selection_id="s1", plan_sha256="d"*64, face="face",
    location_ref="L1", selection_probability=0.5, factory_id="f", supplier_id="s", sampling_method="random",
    planned_area_cm2=1.0, usable_area_cm2=1.0)
r = audit_splits(DatasetManifest("m", "1", "release-evaluation",
    (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),), (it,)))
print("P1-1 licence cleared, consent withdrawn (not representable):", r.promotable, sorted(r.codes()), list(r.confirmatory_release_eligible))
```
```text
P1-1 licence cleared, consent withdrawn (not representable): True [] ['a']
```
The audit has no consent input, so a withdrawn source is indistinguishable from a consented one; the same item is eligible whatever its consent state.
- Expected: a withdrawn or expired consent blocks confirmatory eligibility and training input.
- Fix: add a consent authority reference (id, withdrawn_at, expires_at, training/research use flags) to each source or item, and block the audit and `verify_training_inputs` on withdrawn or expired authority.

### P1-2 A reference consensus can hide an observer disagreement by declaring a large uncertainty for itself

- Where: `references.py:236-249`; the threshold is `record.uncertainty[axis]` at line 241, the consensus record's own field. The parents' uncertainty is not used.
- Reproduction (uses the repo's `test_qc_references` doubles):

```python
from dataclasses import replace
import test_qc_references as R
from training.qc.references import validate_reference
a = R.raw_double()                                                           # ends (30,30)
b = R.raw_double("observer-b-double", raw_counts={"ends": (99, 99), "picks": (20, 20)})
c = R.consensus_double(a, b)
print("E4 control, disagreement 30 vs 99 with uncertainty 0.5:", validate_reference(c, R.selection_double()).release_eligible)
c2 = replace(c, uncertainty={"ends": 1000.0, "picks": 0.5})
r2 = validate_reference(c2, R.selection_double())
print("E4 consensus with uncertainty=1000: release_eligible=", r2.release_eligible, "reasons=", r2.reasons)
```
- Actual output:
```
E4 control, disagreement 30 vs 99 with uncertainty 0.5: False
E4 consensus with uncertainty=1000: release_eligible= True reasons= ()
```
(The control's reasons were `('UNRESOLVED_DISAGREEMENT',)`.)
- Expected: the disagreement tolerance must come from the observers' stated measurement uncertainty (or the instrument tolerance), not from the consensus record. Eligibility must stay False.
- Fix: compute the tolerance from the two raw observations (max of their stated uncertainties) and ignore the consensus record's own `uncertainty` for the disagreement test.

### P1-3 Parity comparison fails open on NaN scores or densities

- Where: `evaluate.py:432-435` (`max(score_error, abs(...))`, `max(density_error, *(...), 0.0)`); Python's `max` ignores NaN, so NaN deltas leave the reported error at 0.0. Nothing checks finiteness of `ParityCase.defect_score` or `densities`. `promotable` depends only on status changes (439-442, 456).
- Reproduction:

```python
from training.qc.evaluate import ParityCase, compare_parity
ref = [ParityCase("c1", 0.9, (1.0,), "woven", (), "ACCEPT")]
cand = [ParityCase("c1", float("nan"), (float("nan"),), "woven", (), "ACCEPT")]
p = compare_parity(ref, cand, thresholds=(0.5,), adjacency=0.05)
print("E1 NaN candidate: promotable=", p.promotable, "max_score_error=", p.max_score_error,
      "max_density_error=", p.max_density_error, "reasons=", p.reasons)
```
- Actual output:
```
E1 NaN candidate: promotable= True max_score_error= 0.0 max_density_error= 0.0 reasons= ()
```
- Expected: non-finite candidate or reference values raise `ValueError` (as `calibrate.py` and `evaluate.fault_metrics` already do), or make the report non-promotable.
- Fix: validate finiteness of every score and density in `compare_parity` before the loop.

### P1-4 Risk target, family alpha and HOLD criterion are outside the sealed plan hash

- Where: `release_gate.py:104-110` (`ReleasePlan` has domains, freeze time, stopping rule, endpoint, bootstrap seed and replicates only); `release_gate.py:269-273, 349-350, 415` (risk target, family alpha and HOLD criterion are read from `Authority`, which is not hashed and not in the plan). `plan_sha256` therefore stays the same when those values change.
- Reproduction (same synthetic inputs, two separate registries, only the risk target differs):

```python
from dataclasses import replace
import tempfile, pathlib
import test_qc_release_gate as T
from training.qc import release_gate as gate
base = pathlib.Path(tempfile.mkdtemp())
for risk, sub in ((0.5, "r05"), (0.9, "r09")):
    r, a = T.synthetic_inputs(base / sub, n=3)
    a = replace(a, risk_target=risk)
    o = gate.evaluate_release(r, a)
    print("RISK", risk, "plan_sha=", r.plan_sha256[:12], "state=", o.state, "reasons=", o.domains[0].reasons)
```
- Actual output:
```
RISK 0.5 plan_sha= c5682c0b7c30 state= NO_RELEASE reasons= ('SPARSE_DOMAIN', 'HOLD_CRITERION_MISSING')
RISK 0.9 plan_sha= c5682c0b7c30 state= STATISTICAL_CANDIDATE reasons= ('HOLD_CRITERION_MISSING',)
```
- Expected: a sealed plan pins the risk target, family alpha and HOLD criterion, so a risk target chosen after the outcomes are seen changes `plan_sha256` and fails `PLAN_MISMATCH`. The protocol says all of these must be "sealed" before unblinding (release-protocol.md:30-40).
- Fix: add `risk_target`, `family_alpha` and the `HoldCriterion` to `ReleasePlan` and compare them with `report.plan_sha256`.

### P1-5 A malformed perceptual hash silently disables near-duplicate linking

- Where: `split_audit.py:114-118` (`_hamming` returns `None` on invalid hex, no finding) and `split_audit.py:167-172` (`None` is never linked). No validation of `perceptual_hash` format exists anywhere in the audit (contrast `IMAGE_HASH_INVALID` for `image_sha256`).
- Reproduction:

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
SRC = (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),)
def ph(a, b):
    return audit_splits(DatasetManifest("m", "1", "release-evaluation", SRC,
        (ManifestItem("a", "lab", "a"*64, "train", "normal", "valid-clean", mask_sha256="c"*64, perceptual_hash=a, roll_id="ra", lot_id="la"),
         ManifestItem("b", "lab", "b"*64, "release_test", "normal", "valid-clean", mask_sha256="c"*64, perceptual_hash=b, roll_id="rb", lot_id="lb"))))
r4 = ph("0000000000000000", "000000000000000f")
r5 = ph("0000000000000000", "000000000000001f")
rz = ph("0000000000000000", "ZZZZZZZZZZZZZZZZ")
print("C8 pHash distance 4: promotable=", r4.promotable, sorted(r4.codes()))
print("C8 pHash distance 5: promotable=", r5.promotable, sorted(r5.codes()))
print("C8 pHash 'ZZZZ' (invalid) vs same: promotable=", rz.promotable, sorted(rz.codes()))
```
(Roll and lot ids are set deliberately: without them both items fall into the no-roll/no-lot over-link of P2-3 and the distance-5 row is confounded.)
- Actual output:
```
C8 pHash distance 4: promotable= False ['GROUP_SPANS_SPLITS']
C8 pHash distance 5: promotable= True []
C8 pHash 'ZZZZ' (invalid) vs same: promotable= True []
```
- Expected: the threshold behaves as designed (4 linked, 5 not), but a malformed hash must produce a blocking finding, not silence.
- Fix: validate `perceptual_hash` as 16 lowercase hex characters and add a blocking `PHASH_INVALID` finding.

### P1-6 Selection binding and challenge checks compare exact selection ids, while linking uses normalised ids

- Where: `split_audit.py:309-312` (selections keyed by exact `selection_id`), `split_audit.py:330-337` (`SELECTION_INCONSISTENT` from those keys), `split_audit.py:140-160` (linking uses `_ident`).
- Reproduction (uses `test_qc_split_audit.confirmatory_double`, source `lab`):

```python
import sys; sys.path.insert(0, "tests")
import test_qc_split_audit as S
from training.qc.manifest import DatasetManifest, SourceRecord
from training.qc.split_audit import audit_splits
LAB = (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation", "research")),)
m = lambda *items: DatasetManifest("m", "1", "release-evaluation", LAB, items)
r = audit_splits(m(S.confirmatory_double("a", source="lab", selection_id="SEL-1", roll_id="roll-A"),
                   S.confirmatory_double("b", source="lab", selection_id="sel-1", roll_id="roll-B")))
print("C6 'SEL-1' roll-A + 'sel-1' roll-B:", r.promotable, sorted(r.codes()), list(r.confirmatory_release_eligible))
r = audit_splits(m(S.confirmatory_double("a", source="lab", selection_id="SEL-1", roll_id="roll-A"),
                   S.confirmatory_double("b", source="lab", selection_id="SEL-1", roll_id="roll-B")))
print("C6 control 'SEL-1' roll-A + 'SEL-1' roll-B:", r.promotable, sorted(r.codes()))
```
- Actual output:
```
C6 'SEL-1' roll-A + 'sel-1' roll-B: True [] ['a', 'b']
C6 control 'SEL-1' roll-A + 'SEL-1' roll-B: False ['SELECTION_INCONSISTENT']
```
- Expected: the same physical selection with two rolls is inconsistent whatever its id spelling. Both items must be non-eligible and the audit must block.
- Fix: key the selection grouping with the same normaliser as the linking keys.

---

### P2-1 Clopper-Pearson bound rounds down by about one ulp to 1e-12 relative

- Where: `release_gate.py:61-68` (bisection returns `high` with `_binomial_cdf` evaluated in floats; the float CDF error can put the exact tail above alpha at the returned point).
- Evidence (see section 2 table): at (3, 1000, 0.05) the exact binomial tail at the code's bound is 0.05 + 2.2e-14, so the bound is below the exact bound by 6.6e-16. At (100, 10000, 0.05) the code is below scipy by 5.0e-15 (relative 4.2e-13).
- Expected: never round down. Magnitude is numerically immaterial to any decision, so this is hardening.
- Fix: after bisection, nudge `high` up by a few ulps, or verify `cdf(x, n, high) <= alpha` with exact `fractions.Fraction` arithmetic.

### P2-2 Signatory-independence check bypassed by a non-breaking space

- Where: `release_gate.py:277-280` (casefold equality only, no normalisation of Unicode whitespace).
- Reproduction:

```python
from dataclasses import replace
import tempfile, pathlib
import test_qc_release_gate as T
from training.qc import release_gate as gate
r, a = T.synthetic_inputs(pathlib.Path(tempfile.mkdtemp()) / "x")
a = replace(a, name="Factory QC Owner", independent_signatory="Factory QC Owner")
o = gate.evaluate_release(r, a)
print("G1 NBSP-variant signatory: state=", o.state, "reasons=", o.reasons)
```
- Actual output:
```
G1 NBSP-variant signatory: state= STATISTICAL_CANDIDATE reasons= ()
```
- Expected: the same person under a different space character is not an independent signatory (`SIGNATORY_NOT_INDEPENDENT`). Signature validity is external (G7), but this check is in code.
- Fix: use the same normaliser as P0-4.

### P2-3 Over-blocking from identifier and prefix rules

- Where: `split_audit.py:161-162` (all items with neither roll nor lot from one source are joined into one component); `split_audit.py:155-156` (a placeholder roll such as `unknown` joins unrelated rolls); `manifest.py:161-167` (prefix blocklist: `None-lot-3` is rejected as unknown).
- Reproduction:

```python
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord, known_identifier
from training.qc.split_audit import audit_splits
SRC = (SourceRecord("lab", "1", "x", "CC-BY-4.0", ("release-evaluation",)),)
a = ManifestItem("a", "lab", "a"*64, "train", "normal", "valid-clean", mask_sha256="c"*64)
b = ManifestItem("b", "lab", "b"*64, "validation", "normal", "valid-clean", mask_sha256="c"*64)
print("E7 two unrelated images, no roll/lot, train vs validation:", sorted(audit_splits(DatasetManifest("m", "1", "release-evaluation", SRC, (a, b))).codes()))
x = ManifestItem("x", "lab", "a"*64, "train", "normal", "valid-clean", mask_sha256="c"*64, roll_id="unknown")
y = ManifestItem("y", "lab", "b"*64, "release_test", "normal", "valid-clean", mask_sha256="c"*64, roll_id="Unknown")
print("G3 two different rolls both labelled 'unknown':", sorted(audit_splits(DatasetManifest("m", "1", "release-evaluation", SRC, (x, y))).codes()))
print("G4 known_identifier('None-lot-3') =", known_identifier("None-lot-3"))
```
- Actual output:
```
E7 two unrelated images, no roll/lot, train vs validation: ['GROUP_SPANS_SPLITS']
G3 two different rolls both labelled 'unknown': ['GROUP_SPANS_SPLITS']
G4 known_identifier('None-lot-3') = False
```
- Expected: these are conservative false blocks; placeholders should be treated as missing identity, and unrelated images should not be linked.
- Fix: do not create keys for placeholder or missing ids; link no-identity items only by image hash or parent id.

### P2-4 `final_status` is not checked against the accept/hold flags

- Where: `workflow_metrics.py:164-193` (`unique_outcomes` checks flags but not `final_status` against `accepted` or `held`); `workflow_metrics.py:239, 277` (`final_accept` counts `final_status == "ACCEPT"`).
- Reproduction:

```python
from training.qc.workflow_metrics import UnitOutcome, aggregate
row = UnitOutcome("s1", "g1", 1, 0, 0, 0, 0, 0, 0, "ACCEPT", 0, True, 1, 1, 0, None, True)
c = aggregate([row])
print("E8 final_status=ACCEPT with accepted=0: final_state_accepted_groups=", c.final_state_accepted_groups,
      "accepted_units=", c.accepted_independent_units)
```
- Actual output:
```
E8 final_status=ACCEPT with accepted=0: final_state_accepted_groups= 1 accepted_units= 0
```
- Expected: rejection. The result feeds `DomainResult.final_state_risk`, which is reported (not used for the accept decision), so the reported final-state risk is understated when the fields disagree.
- Fix: in `unique_outcomes`, require `final_status == "ACCEPT"` implies `accepted == 1` and `final_status == "HOLD"` implies `held == 1`.

### P2-5 Empty fabric cohort reports macro-F1 of 0.0, not undefined

- Where: `evaluate.py:64-72` (`_macro` returns 0.0 for classes with no support when there are no truths, and the average over the universe is non-None), used by `fabric_metrics` at `evaluate.py:98-99`.
- Reproduction:

```python
from training.qc.evaluate import fabric_metrics
m = fabric_metrics([None, None], ["a", "b"], [None, None], ("a", "b"))
print("E3 no labelled items: unconditional_macro_f1=", m.unconditional_macro_f1, "deployed=", m.deployed_macro_f1, "conditional=", m.conditional_macro_f1)
```
- Actual output:
```
E3 no labelled items: unconditional_macro_f1= 0.0 deployed= 0.0 conditional= None
```
- Expected: `None` (undefined), consistent with `descriptive_metrics` (`workflow_metrics.py:319`) and with `conditional_macro_f1`.
- Fix: return `None` from `_macro` when `labels` has no known truth.

### P2-6 Tests that cannot fail (test-quality defects)

Checked by stubbing the audit to return `None` and running the test functions directly from `tests/test_qc_split_audit.py`:

```text
ManifestItem frozen: True
test_aitex_empty_mask_never_relabelled_normal -> PASSES with audit stubbed to return None
test_aitex_empty_mask_never_given_invented_mask -> PASSES with audit stubbed to return None
test_aitex_empty_mask_never_dropped -> fails with stub: AttributeError
test_aitex_empty_mask_stays_image_level_defective -> fails with stub: AttributeError
```

- `test_aitex_empty_mask_never_relabelled_normal` (lines 142-147) and `test_aitex_empty_mask_never_given_invented_mask` (157-162) assert properties of a frozen dataclass that the audit never receives as a mutable object. They cannot fail, whatever the audit does, because they only inspect the input object, which the audit never writes to.
- `test_unknown_license_blocks_promotion` (line 111) lists `None`, `""`, `"unknown"`, `"not yet collected"` but not `TBD`, `tbc`, `?` or `-`. That gap is why P0-8 passes the suite.
- `test_fixed_stopping` (test_qc_release_gate.py:199-203) accepts the reason in either the report or the domain list (`or`), which weakens the assertion.
- `test_single_ceiling_of_complete_enrollment_arithmetic` (test_qc_enrollment.py:18-20) recomputes the implementation's own formula, so it checks agreement with the implementation, not with an independent value.
- No test covers a repeat of the same roll under different group ids (the P0-1 and P0-2 cases). `test_duplicate_tiles_and_correlated_selections_never_raise_n` (test_qc_workflow_metrics.py:75-81) passes only because the tiles share a group id, which is the caller's choice.
- Fix: replace the two tautologies with audit-output assertions, add `TBD`/`tbc`/`?`/`-` to the licence test, and add the cross-group-id tile case as a failing test.

---

## 2. Checked and sound

### 2.1 Clopper-Pearson bound: independent recomputation

Method: `scipy.stats.beta.ppf(1-alpha, x+1, n-x)` (scipy 1.14.1) and an independent exact bisection over the binomial CDF with `mpmath` at 60 digits, compared with `training.qc.release_gate.false_accept_upper`. Differences are `code - exact`; negative means the code is below the exact bound (rounded down).

| x | n | alpha | scipy beta.ppf | mpmath exact | code | code - exact | result |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 0.05 | 1.000000000000 | 1.000000000000 | 1.000000000000 | 0 | sound (n=0 uninformative, gate refuses) |
| 0 | 1 | 0.05 | 0.950000000000 | 0.950000000000 | 0.950000000000 | -4.2e-17 | sound (1 ulp) |
| 0 | 59 | 0.05 | 0.049507609888 | 0.049507609888 | 0.049507609888 | -2.1e-18 | sound |
| 0 | 299 | 0.05 | 0.009969146793 | 0.009969146793 | 0.009969146793 | -3.5e-19 | sound (<= 0.01 as required) |
| 1 | 300 | 0.05 | 0.015714554892 | 0.015714554892 | 0.015714554892 | -6.3e-16 | rounded down by 1 ulp (P2-1) |
| 3 | 1000 | 0.05 | 0.007735244718 | 0.007735244718 | 0.007735244718 | -6.6e-16 | rounded down by 1 ulp (P2-1) |
| 5 | 5 | 0.05 | 1.000000000000 | 1.000000000000 | 1.000000000000 | 0 | sound (n=x returns 1) |
| 2 | 8 | 0.025 | 0.650855794413 | 0.650855794413 | 0.650855794413 | -6.2e-17 | sound |
| 7 | 9 | 0.10 | 0.939230950349 | 0.939230950349 | 0.939230950349 | -3.3e-17 | sound |
| 3 | 30 | 0.01 | 0.297618678146 | 0.297618678146 | 0.297618678146 | +1.7e-16 | sound (conservative) |
| 50 | 100 | 0.05 | 0.586378285369 | 0.586378285369 | 0.586378285369 | -4.8e-16 | rounded down by 1 ulp (P2-1) |
| 1 | 3 | 0.05 | 0.864649637828 | 0.864649637828 | 0.864649637828 | +9.0e-17 | sound |
| 0 | 10 | 0.50 | 0.066967008463 | 0.066967008463 | 0.066967008463 | -8.0e-18 | sound |
| 10 | 1000 | 0.025 | 0.018313243055 | 0.018313243055 | 0.018313243055 | -1.1e-15 | rounded down by 1 ulp (P2-1) |
| 0 | 1000 | 0.05 | 0.002991249545 | 0.002991249545 | 0.002991249545 | -3.9e-19 | sound |
| 40 | 1000 | 0.05 | 0.051753401352 | 0.051753401352 | 0.051753401352 | -1.5e-15 | rounded down by 1 ulp (P2-1) |

Larger n, scipy reference (`code - scipy`, relative in brackets):

| x | n | alpha | scipy | code | code - scipy | relative |
|---|---|---|---|---|---|---|
| 100 | 10000 | 0.05 | 1.179723397134762e-02 | 1.179723397134263e-02 | -5.0e-15 | -4.2e-13 (rounded down) |
| 1000 | 20000 | 0.05 | 5.260873124658008e-02 | 5.260873124658223e-02 | +2.1e-15 | +4.1e-14 (conservative) |
| 5000 | 100000 | 0.05 | 5.114832194700961e-02 | 5.114832194705224e-02 | +4.3e-14 | +8.3e-13 (conservative) |
| 2000 | 100000 | 0.025 | 2.088676697182000e-02 | 2.088676697184650e-02 | +2.6e-14 | +1.3e-12 (conservative) |
| 30 | 100000 | 0.05 | 4.068833250808615e-04 | 4.068833250842229e-04 | +3.4e-15 | +8.3e-12 (conservative) |

Conclusions: the bound matches the exact Clopper-Pearson value to within about 1e-12 relative for every case tested. The one-sided alpha convention matches the design (design spec line 129: "one-sided 95% bound ... BetaQuantile(0.95; x+1,n-x)"). Only the rounding direction is off, at the ulp level (P2-1). Non-finite and out-of-range alpha are rejected (tests and probe).

Other statistical checks:
- Zero accepted units: `evaluate_release` returns `NO_RELEASE` with `NO_ACCEPTED_UNITS`, `false_accept_upper = 1.0`. Output:
```
ZERO_ACCEPT state= NO_RELEASE accepted= 0 upper= 1.0 reasons= ('NO_ACCEPTED_UNITS', 'HOLD_CRITERION_MISSING')
```
- Zero-failure closed form `1 - alpha^(1/n)` agrees with the exact bound (table above).
- `zero_failure_units` (enrollment) agrees with the exact smallest n for 63 (risk, alpha) pairs, including 0.01 at 0.05 giving 299:
```
E6 zero_failure_units mismatches over 63 pairs: []
```
- Alpha allocation (accept plus hold alphas against the family alpha) is enforced by `ALPHA_ALLOCATION_EXCEEDS_FAMILY` (`release_gate.py:347-352`), covered by `test_hold_endpoints_share_family_alpha`, which passes.
- Fixed look and fixed sample size are enforced (`UNPLANNED_INTERIM_LOOK`, `FIXED_SAMPLE_SIZE_NOT_MET`, tests pass).
- Repeated identical outcome rows are idempotent (`unique_outcomes`); conflicting rows raise.

### 2.2 Independence checks that work

- Tiles of one parent: linked through `parent_id` (`split_audit.py:151-154`); transitive chain across parent, roll, lot and a no-roll item joins one component and spans splits:
```
G2 transitive chain spans splits: ['AITEX_RELEASE_GATE_OPEN', 'GROUP_SPANS_SPLITS']
```
- Control: case and padding are linked (P0-4 control row): `promotable=False codes=['GROUP_SPANS_SPLITS']`.
- Near-duplicate threshold edges: distance 4 linked, distance 5 not (P1-5 rows). This is the designed threshold.
- Gate-level independence within one look: duplicate selections across domains (`SELECTION_IN_MULTIPLE_DOMAINS`), groups across domains (`GROUP_IN_MULTIPLE_DOMAINS`), calibration/release overlap (`CALIBRATION_RELEASE_OVERLAP`) and release-group set equality are checked; the registry blocks a first look re-using a previously unblinded group (tests pass).

### 2.3 Fail-closed behaviour checked

```
SOUND empty manifest: codes= ['EMPTY_MANIFEST'] promotable= False
SOUND missing label+mask_sha+selection: codes= ['IMAGE_LABEL_UNKNOWN', 'MASK_HASH_INVALID'] promotable= False confirmatory= []
SOUND NaN risk: state= NO_RELEASE reasons= ('AUTHORITY_RISK_TARGET_MISSING',)
SOUND NaN fabric F1 claim: state= NO_RELEASE reasons= ('FABRIC_F1_MISMATCH',)
SOUND zero domains: state= NO_RELEASE reasons= ('RELEASE_GROUPS_MISMATCH', 'NO_DOMAINS', 'PLAN_MISMATCH')
G5 expires==now: ('RIGHTS_EXPIRED:f.jpg',)
G5 7-digit fraction: ('RIGHTS_TIME_UNKNOWN:f.jpg',)
G5 +00:00 offset form: ('RIGHTS_TIME_UNKNOWN:f.jpg',)
```
- Export: unknown source, missing notice, withdrawn consent (`is not False`), non-boolean redistribution, duplicate registry entries, absolute or `..` paths, blanket licence mismatch are refused (tests and code).
- Training guard: edited audit (`audit != audit_splits(manifest)`), stale audit hash, changed file, sealed id in any consumer, duplicate consumed id and truncated split are refused before the model is constructed (tests pass).
- Reference eligibility: a 30 vs 99 disagreement with an honest uncertainty is `UNRESOLVED_DISAGREEMENT` (E4 control). Adjudicated status is never eligible (test).
- Evaluate: `evaluate_bundle` refuses calibration and release splits and missing weights (tests).

### 2.4 Test quality items that do work

- `test_nonzero_bound_independent_binomial_tail` checks the bound by summing the binomial tail independently (rel 1e-11). Sound.
- The split-audit tests that link by each key (`test_connected_groups_never_span_splits`, `test_identifier_case_and_padding...`, `test_transitive_...`) fail on a removed link. They are real tests, but they do not cover the Unicode variants in P0-4.

---

## 3. Unproven suspicions

S1 Gate trusts the caller's `failure` flag. `UnitOutcome.failure` is caller-set and `release_gate.py:404-407` uses it, while the gate's own `accept_given_nonconforming` uses `reference_nonconforming`. Probe:
```
FLAG_STATE STATISTICAL_CANDIDATE ()
FLAG accepted= 299 failures= 0 accept_given_nonconforming= 1.0 upper= 0.00997 state= STATISTICAL_CANDIDATE
```
This is a defect only if the accepting spec and the primary reference spec are the same. `reduce_workflow` can legitimately give `failure=0` with `reference_nonconforming=1` (accept under a conforming spec, primary spec nonconforming, `workflow_metrics.py:105-126`). The gate cannot check this because `UnitOutcome` carries no per-spec truth. Recommend: carry the accept-spec truth in `UnitOutcome`, or reject rows where `accepted=1, failure=0, reference_nonconforming=1` and the two specs are equal. Not proven as a defect.

S2 Parity status is not derived from the score. `compare_parity` compares caller-supplied `status` values; a candidate score that moves from 0.9 to 0.1 with the same `ACCEPT` status is promotable:
```
E2 score 0.9->0.1 with same status: promotable= True max_score_error= 0.8 reasons= ()
```
Whether `status` must follow the score under the frozen policy is not specified in the code, so this is unproven.

S3 `qc_ddp_proof.py` reads the hardware report three times: hash check at line 249, parse at line 252, and again inside `verify_ddp_proof` at line 256. A file swapped between the hash check and the parse would pass `production` checks. Not demonstrated; the race needs local write access, and the script is a G6 proof aid, not a release decision.

S4 No expiry on release evidence. `evaluate_release` has no validity window for the sampling agreement, signed records or plan (the export guard does handle rights expiry). An expired authority record would pass. Not demonstrated.

S5 Undeclared benchmark overlap is not detected. `CROSS_SOURCE_OVERLAP` only fires for hash-linked groups or declared `derived_from`/`pretraining_exposure` (`split_audit.py:267-295`). Two benchmark sources with no shared hash and no declaration pass silently. The closest run is the `derived_from=('mvtec',)` row of P0-5, which has no effective declaration and gave `codes=[]`. This is a known limitation, not a code defect.

S6 `fit_accept_threshold` scans every observed score as a threshold with no alpha spending (`calibrate.py:213-225`). It is labelled exploratory, and the release gate never uses its threshold. No release impact shown.

S7 `_components` is O(n^2) in perceptual-hash pairs (`split_audit.py:167-172`). Performance only; not measured.

---

## 4. Not covered

- The numerical DDP test itself (`tests/test_fault_dinomaly_ddp.py`) and any real upstream checkout; `qc_ddp_proof.py` was read and exercised only through the repo's doubles.
- `scripts/qc_benchmark.py` was read but not run (it runs the local ASGI service).
- `services/api/qc_schemas.py` (`canonical_json`, `sha256_hex`, `content_sha256`, `SamplingSelection`) was used but not audited. All hashes in this audit depend on it.
- The full scanner test suite was not run; only the QC files listed above.
- Real manifests, real rights registry, real SQLite registry permissions and any signature verification (external G7/G8, as the code's own docstrings state).
- `scanner/research/qc/R03-unaudited-files-review.md` and the agent ledger were not used as evidence.
- Ablation bootstrap numerics beyond the synthetic tests; the four-arm claim logic was read, not stress-tested.
- Concurrency of the registry (`_reserve_cohort`) under parallel writers.
- Other agents' uncommitted changes in the repo (`scanner/training/textilenet/prepare_data.py`, `scanner/docs/fault-a2-*`) were ignored, as instructed.
