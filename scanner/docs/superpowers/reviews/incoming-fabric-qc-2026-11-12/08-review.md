# Independent reviewer 08 — factory sampling / ground truth

Recommendation: revise before freezing T01/T09 contracts; retain REVIEW_ONLY until the stated external gates pass. No P0 identified. This review examines proposed behavior against actual source; it does not assert that v2 exists or that factory validation has occurred.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (especially §§3, 6–8, 12)
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (contract/endpoint map, T01/T04/T09–T11/T13)
- `scanner/services/vision/datasets/phone.py:22–90`
- `scanner/scripts/check_phone_set.py:19–89`
- `scanner/docs/phone_ground_truth_template.csv:1–3`
- `scanner/training/textilenet/splits.py:1–13,64–123`
- `scanner/training/fault/data.py:11–21,41–70,74–104`
- `scanner/services/api/store.py:17–25,44–63`
- `scanner/services/vision/threads.py:30–38,102–130`

## Findings

### P1 — Required sampling provenance has no authoritative record contract

**Evidence:** Design §7 line 116 requires supplier, face, planned area, actual usable area and sampling method. Its authoritative `Sample` (lines 60–63) contains only lot/roll/location references and `sample_plan_version`; no typed immutable sampling-plan record or those missing fields is defined. `observed_area_cm2` at line 77 belongs only to an OK defect stage, so cannot preserve usable area for excluded/failed submissions. Plan T01 freezes this contract; T09 lines 144–150 creates a manifest/split auditor and SOP but supplies no sampling-plan contract or assertion for plan adherence. Actual `PhoneDataset` assigns `group_id=gid` (`phone.py:82–89`), and both existing training record types lack factory/roll sampling provenance (`splits.py:64–70`, `fault/data.py:14–21`); existing code cannot fill this gap.

**Impact:** A valid-looking v2 sample can lack the information required to reconstruct the randomized sampling frame, distinguish opposite faces or convenience samples, and account for unusable submissions. Later statistical grouping cannot recover facts never captured.

**Correction:** Make T01/T02/T09 own an immutable version/hash-bound sampling-plan and per-sample selection record, with supplier/factory identity, face, registered location, planned/usable area with units and missingness reasons, selection method/probability and cohort/challenge designation. An explicitly external signed manifest is sufficient if its schema, immutable hash and sample join are specified; do not require a new runtime service. Keep lot disposition outside this record.

**Test assertion:** Round-trip a randomized planned sample and a failed capture without a defect value; both retain selection and area provenance. Reject unknown plan versions and inconsistent roll/lot/face references; challenge samples cannot enter the confirmatory cohort. Multiple photographs of the same selected location count as one submission/unit.

### P1 — Blinded physical reference is prose, while the available adjudication contract can silently substitute for it

**Evidence:** Design line 118 requires two independent blinded qualified counters, retained raw counts, registered locations and resolved/uncertain reference. Plan endpoint map line 40 accepts supervisor adjudication with only outcome, reason and `reference_ids`; T09 line 148 merely says disagreement is retained. Neither T01 nor T09 defines a reference-observation/adjudication schema or validation linking those IDs to independent blinded observations. Existing phone truth is one `fabric_structure` string plus typed label text (`phone.py:80–89`; CSV header line 1), and its checker validates garment/label presence rather than physical reference evidence (`check_phone_set.py:60–77`). Legacy store even labels typed text retraining truth (`store.py:24`), correctly disclaimed by the draft but not replaced by a specified reference ingestion boundary.

**Impact:** An ordinary supervisor review after seeing the model can be passed as the release reference, defeating the independence promised by §7 even if split and binomial arithmetic tests pass.

**Correction:** Add a versioned research reference record in T09 with sample/location/face and spec hash, observer identities/qualification evidence, observation and model-unblinding timestamps, independent raw axis counts and counted lengths/units, fabric labels, physical defect observations/sizes, uncertainty/disagreement and adjudication lineage. Distinguish operational supervisor adjudication from release-eligible blinded reference. Have T11 validate that distinction rather than trusting arbitrary reference IDs.

**Test assertion:** Two agreeing references from the same observer, post-unblinding observations, a reference for another location/spec, missing raw counts, and unresolved reference disagreement cannot yield release-eligible truth. Retain all raw observations after adjudication; an UNDETERMINED reference is reported separately and never coerced to conforming.

### P2 — Multi-image sample evidence cannot register a defect region or prove nonduplicated inspected area

**Evidence:** Design Capture supports overview/structure/defect/scale images (lines 64–67), Evidence has an array of capture IDs (line 73), but every defect region has only box/score/label and the defect stage has one scalar observed area (lines 76–77). There is no capture ID or registered coordinate-frame association per region, nor an area aggregation rule. §7 line 118 requires physical location/size, and §10 line 144 promises overlays. Existing fault records bind masks directly to one image (`fault/data.py:14–21,68–70`); the proposed combined sample loses that binding. Existing thread-density tiles overlap by half a tile (`threads.py:127–130`), reinforcing that summing image/tile areas is unsafe.

**Impact:** The UI cannot reliably place a box on the correct close-up, and repeat/overlapping close-ups can inflate the claimed inspected area or duplicate a physical defect. This matters even without four-point grading.

**Correction:** Bind each region to a capture and coordinate/preprocessing frame. Define observed area as registered physical union area or explicitly report per-capture areas with overlap/union unknown; forbid total inspected-area claims when registration is unavailable. Preserve physical reference dimensions separately from normalized image boxes.

**Test assertion:** With two differently sized captures, every region resolves to exactly one immutable image frame. Repeated and partially overlapping images never double the declared union area or independent count; absent registration makes union area unavailable rather than a fabricated sum.

## External authority gates and proof

G1/G2/G3/G4/G7 remain genuine factory access, sampling/risk authority, physical-reference, rights and independent-statistics gates (design line 164), not facts a reviewer can approve. The proposed one predeclared sample per independent roll and escalation to higher dependent grouping (line 122) are appropriate; the findings concern preserving and validating the evidence needed to enforce them. No demand here converts the illustrative 1% risk target into factory policy.

Proof performed: read-only source/contract tracing with numbered lines and ownership comparison. No product tests, installation, training, GPU/Kaggle work, purchases or commits were needed for this documentation-only review. Only this review file was authored; fix the contract/task gaps above before implementation contract freeze, and require signed physical/statistical evidence before automation.
