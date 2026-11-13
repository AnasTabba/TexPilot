# Reviewer 01 — scope, jury and research novelty

Recommendation: **revise before freezing the research contract**. No P0 identified; two P1 research-proof gaps and one P2 taxonomy gap below. This is one independent actual reviewer, with no helper workers or consultation of other reviewers.

## Inspected evidence and baseline

Inspected both complete drafts: `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` and `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md`; actual source: `scanner/services/vision/{scanner,predictor,heads,taxonomy}.py`, `scanner/services/api/pipeline.py`, `scanner/training/textilenet/splits.py`, and relevant frozen-PO construction in `yarnflow/server/procurement.mjs`. No applicable AGENTS.md appeared in repository file discovery. No authoritative jury rubric or signed project scope was identified; this review cannot certify institutional approval of the scope change.

Existing behavior is classification/abstention with separate optional fault evidence, not the proposed incoming-QC release system: `scanner/services/api/pipeline.py:121-135` evaluates legacy consistency and serializes it; `scanner/services/vision/predictor.py:89-99` already distinguishes unknown candidates. `scanner/services/vision/scanner.py:53-75` already classifies the full image when garment detection yields nothing, and `:65-66` supports whole-photo classification even with a garment. A dedicated flat-swatch path can remove unnecessary detector execution, but is not itself new classification capability. The proposed defensible research contribution is therefore the measured gated decision system, not these existing components.

## Findings

### P1-01 — The central novelty experiment has no executable task acceptance contract

**Evidence:** Design §1 promises four comparisons (classifier-only, classifier+defects, classifier+metrology, full fusion) at matched acceptance risk. Design §4 requires missing/disabled required stages to abstain. Plan T10 (`:154-164`) specifies bundle metrics/reproducibility; T11 (`:166-176`) specifies one release gate and aggregate metrics. Neither specifies executing the four arms, their eligibility/threshold selection, a comparison report, or a regression assertion that the experiment ran. The requirements matrix (`:206`) lists ablations as proof but maps them to T01/T05/T07/T13, none of which owns this experimental evaluation. Existing `scanner/services/api/pipeline.py:130` is a single consistency evaluation, not an ablation runner.

**Consequence:** Every listed task could pass while the sole stated novelty claim remains untested. Applying production all-stage gating unchanged to reduced arms can also force zero automation and make the comparison vacuous.

**Correction:** Assign the four-arm offline experiment to T10/T11 with an immutable arm manifest, shared independent cohort/reference endpoint, calibration-only threshold selection, predefined risk-matching procedure, and confidence bounds on coverage differences. Define how reduced arms can accept against the same *full* reference nonconformance endpoint; do not weaken deployed required-stage gates. Explicitly report infeasible risk targets/zero-coverage arms and avoid selecting the winning configuration on the confirmatory cohort.

**Test assertion:** A tiny deterministic fixture produces all four named arm reports with identical cohort IDs/reference labels and independently pinned calibration IDs; missing an arm or fitting its threshold on release IDs fails. A fixture with defects undetectable by classification yields a worse classifier-only risk/coverage frontier, while disabling a production-required stage still never produces ACCEPT/HOLD. The final artifact must contain the paired held-out comparison, including negative results; synthetic proof alone does not establish novelty.

### P1-02 — The authoritative sample contract cannot reconstruct the promised sampling study

**Evidence:** Design §7 (`:116-122`) requires supplier, face, planned area, actual usable area, sampling method, independent roll/lot grouping, and inclusion/exclusion accounting. Its authoritative `Sample` (`:60-63`) contains only PO, lot/roll/location references, sample-plan version, attempt and actor/time. `Capture` (`:64-67`) has no sampled face/area; `Evidence.defects.observed_area_cm2` (`:76-77`) is a single model-stage area and becomes unavailable when that stage fails. T09's acceptance list (`plan :148`) audits split leakage and rights but does not require persisting randomized selection, missing/excluded submissions or their usable area. Existing `scanner/training/textilenet/splits.py:64-70` records only path/label/split/source/hash, so these fields are not inherited from the existing dataset representation.

**Consequence:** A version string plus free-form location is insufficient to verify which sampling draw was followed, distinguish two faces, or retain denominators for failed evidence. The all-submission coverage and independence claims can become unauditable even when the runtime schema is followed exactly.

**Correction:** Define a versioned sampling-plan/selection record and bind each sample to its immutable selected unit, face, planned area/method and group identities; record actual usable area and missing/excluded disposition independently of successful model stages. Supplier may be derived from the immutable PO rather than duplicated, but document the binding. Extend T01/T02/T09/T11 acceptance assertions to require this lineage. G1 factory-QC sampling approval remains an external authority gate, not something schema tests can grant.

**Test assertion:** Failed capture/disabled fault-stage cases remain in the all-submission denominator with selection and exclusion reasons preserved; two shots/faces of the same dependent roll never increase confirmatory n. Missing sampling lineage prevents confirmatory report/release generation. Replaying the sealed manifest reproduces selected, excluded and accepted counts exactly.

### P2-03 — Taxonomy freeze does not resolve already shipped scope/drop behavior

**Evidence:** Design §2 and §6 describe a 27-label baseline and require expert aliases; T01 (`plan :52`) asks for overlap/UNKNOWN documentation. Actual `scanner/training/textilenet/splits.py:28-43` additionally implements fabric24 and fabric22, merging jersey into knit and excluding canvas/plush, then serge/chenille. `scanner/services/vision/heads.py:90-104` applies artifact-specific merge/drop and changes the answerable classes at runtime. `taxonomy.py:15-43` alone is therefore not the serving label universe. `heads.py:143-149` calibrates/scopes predictions through the actual artifact path.

**Consequence:** A PO can name a nominally valid 27-class label that its selected bundle cannot emit, or evaluation can compare different class universes under an ambiguous taxonomy version. This directly affects the central classifier's macro-F1 and coverage claims.

**Correction:** T01 must freeze the actual artifact's answerable label set and merge/drop lineage, distinguish source taxonomy from deployed scope, and define compatibility between PO allowed labels and that scope. T10 reports must name the evaluated label universe and retain excluded labels as explicit challenge/unsupported cases rather than silently improving F1 by dropping them. Factory experts approve semantic mappings; a code merge is not evidence of semantic equivalence.

**Test assertion:** A fabric22 bundle with a PO requiring serge is rejected as incompatible or routed to explicit review, never accepted through a silent alias. Jersey→knit behavior is pinned by the bundle manifest and agrees in Python/TS/Swift fixtures. Evaluation refuses to compare unqualified macro-F1 values from fabric27 versus fabric22.

## Final disposition and authority

Retain the sample-only, review-only fallback and prohibition on ERP side effects: these make the scope coherent and distinguish proposals from existing product behavior. Before calling the plan jury-ready, close the three findings and supply the actual supervisor/jury scope decision if formal project acceptance is claimed; no rubric was available to infer that decision. G1–G8 remain external evidence/approval gates, particularly factory access, physical references, risk tolerance and independent release sample size; their absence is honestly bounded in the drafts and is not a discovered implementation failure. This review executed read-only source inspection and wrote only this review file; it ran no product tests, installations, training, deployment or purchases.
