# Reviewer 04 — defect models, ADNet and annotation integrity

Recommendation: **revise before implementation signoff**. Two P1 contract/ownership gaps and two P2 evaluation gaps below; no P0 identified. This is source inspection of proposed behavior, not a claim that v2 exists or that models have been validated.

## Findings

### P1 — Multi-image defect regions have no owning capture

- Evidence: design §3 (`scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md:65–78`) permits overview/structure/defect/scale captures but stores only evidence-wide `capture_ids` and region `box/score/label`. Existing `scanner/services/vision/predictor.py:35–40` defines a box relative to **the full photo**; `scanner/services/vision/fault.py:146–165` explicitly transforms working-crop boxes to that photo. T06 accepts a capture list; T07 requires a defect overlay.
- Consequence: with two detail photos, a valid normalized box cannot identify its image. An overlay or physical area can be attached to the wrong location; one evidence-wide `observed_area_cm2` also leaves overlapping photographs and unusable areas ambiguous.
- Correction: T01 must bind each region and per-view defect result to a validated `capture_id` (and pinned transform/reference where derived), define score aggregation across required views, and define usable-area union/overlap semantics or explicitly report per-view area only. T06 must reject foreign/missing view bindings and incomplete required-view evaluation.
- Test assertion: two photos with the same box coordinates retain distinct capture ownership after Python/TS/Swift roundtrip; overlapping views do not double-count inspected area; removing a required defect view cannot preserve an automatic clean result.

### P1 — A real defect artifact cannot currently be loaded, but no task owns completing that boundary

- Evidence: `scanner/services/vision/fault.py:88–106` requires config/weights then unconditionally raises `NotImplementedError` in `_load_model`. `scanner/services/api/config.py:74–84` retries scanner startup without fault. Design §2 describes optional load failure but omits this stronger baseline fact. Plan T06 (`.../plans/2026-11-12-incoming-fabric-qc.md:106–114`) owns API/config and predictor boundary only; T10 owns evaluation/training adapters, neither explicitly owns serving export/loader completion.
- Consequence: completed training jobs and available weights do not make the proposed required defect stage operational. G6 is not only an external artifact-delivery gate; repository implementation is missing. The review-only demo fallback is valid, but a released full pipeline has no scheduled owner for this work.
- Correction: state the unimplemented loader explicitly; add conditional export/load ownership to T06/T10 using the selected existing model, or explicitly scope the deliverable to an unavailable defect stage. Pin architecture/preprocessing/weights compatibility, rather than treating presence of files as readiness.
- Test assertion: a supported real-format checkpoint loads and produces finite correctly shaped maps through the actual serving loader; incompatible config/hash fails readiness; its loaded scores/regions match the evaluation adapter on fixed fixtures. Stub monkeypatch tests alone cannot satisfy this gate.

### P2 — Reused A2 comparisons include cohort-dependent inference, unlike stationary per-sample serving

- Evidence: `scanner/training/fault/methods/musc.py:51,164–177` declares transductive scoring, requires multiple tiles and compares them with each other. `scanner/training/fault/bench.py:96–106` supplies all category test tiles together, while `:58–67` separately supplies calibration tiles. In contrast, `scanner/services/vision/fault.py:108–110` calls a model independently per tile. Design §8 and plan T10 reuse A2 comparisons without requiring this protocol distinction.
- Consequence: benchmark quality/latency from this cohort cannot establish performance of single submitted samples or an interchangeable serving baseline. This is not evidence of train/test leakage by itself; it is a different inference dependency and information budget.
- Correction: T10 must label transductive results exploratory/cohort-based and exclude them from stationary release selection unless a fixed, authorized reference-cohort inference protocol is specified and independently evaluated. Record cohort composition, chunking, latency scope and dependence.
- Test assertion: evaluation reports identify transductive mode and cohort hashes; release selection rejects an unsupported cohort-dependent bundle. A sample-alone versus sample-plus-unrelated-images challenge must measure and report score/decision changes.

### P2 — Annotation-integrity requirements are broader than the executable acceptance criteria

- Evidence: design §8 (`.../specs/2026-11-12-incoming-fabric-qc-design.md:128`) correctly requires separate missing/empty/shape/orientation/union/corrupt validation. Existing `scanner/training/fault/bench.py:70–79` silently resizes masks and thresholds grayscale at 127; `:123–149` uses path presence to admit pixel evidence, so an existing empty defective mask is still admitted as all-negative pixels. Returned rows (`:153–174`) omit pixel eligibility/exclusion counts. `scanner/training/fault/data.py:16–24` has no annotation validity/version fields. Plan T09 explicitly tests AITEX empty masks, while T10 only says “valid-mask denominators,” leaving the other promised cases and eligibility mechanism unspecified.
- Consequence: simply reusing these adapters and attaching a denominator report can retain silently transformed or invalid annotations. This can invalidate localization comparisons even while image labels remain defective.
- Correction: assign annotation validation and explicit eligibility/reason lineage to T09, require T10 to consume it, and prohibit unapproved shape/orientation repair. Preserve raw masks and distinguish absent, empty-defective, valid-clean, valid-defective, corrupt and adjudicated-derived masks; serialize denominator counts and exclusions by category/source.
- Test assertion: corrupt/rotated/wrong-size masks cannot silently enter pixel scoring; approved multi-mask unions preserve source hashes; defective empty masks remain image-level defective and pixel-ineligible pending G5; reports reconcile total images with eligible/excluded image and pixel counts.

## Inspected paths and limits

- Both complete target draft documents, including contracts, T01/T03/T06/T09–T12 and external gates.
- `scanner/services/vision/{fault,predictor,scanner}.py`; `scanner/services/api/config.py`.
- `scanner/training/fault/{data,bench,tiles}.py`; `scanner/training/fault/methods/{_upstream,dinomaly,musc}.py`; `scanner/tests/test_fault_data.py`.
- Source inventory under `scanner/training/fault/methods` and `kaggle`; ADNet references in `scanner/docs/garment-fault-detection-research-2026-11-02.md` and the earlier fault design. No local ADNet ingestion adapter was found in the searched scanner source; historical download/access prose is not evidence of current source identity or rights.

Proof performed: read-only line-numbered source traces and repository path/reference searches. No installation, training, Kaggle access, GPU work, deployment or product modification performed; no product test pass claimed.

## Authority boundaries

G4 source-specific rights and permitted deployment purpose, G5 AITEX empty-mask disposition, and G6 actual artifact/hardware evidence remain external gates. ADNet access/download or overlap screening does not clear component licenses or prove independent roll identity; the proposed manifest and conservative overlap quarantine are appropriate and still unimplemented. None of these gates requires changing ongoing jobs or resolving pending annotation policy during this review; existing AITEX outputs must remain non-confirmatory until the declared authority resolves them.

Final disposition: retain review-only defaults and the explicit ADNet overlap/AITEX gates; fix the two P1 ownership/contract gaps and make the P2 evaluation assertions executable before calling the plan complete for defect-integrity implementation.
