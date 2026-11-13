# Reviewer 03 — fabric classifier, taxonomy and F1

Recommendation: revise before implementation freeze. No P0 found; three P1 contract/artifact gaps and one P2 evaluation gap follow. This is an independent source review, not training or performance validation.

## Inspected paths

- Draft: `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` §§2–8,12; `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` T01,T03,T06,T09–T11 and requirements matrix.
- Runtime: `scanner/services/vision/{taxonomy,heads,predictor,scanner}.py`.
- Actual local artifacts: `scanner/models/scanner-v8/bundle.json`, `scanner/models/scanner-v8/head_a/head.json` (metadata inspected; weights not executed).
- Training/evaluation: `scanner/training/textilenet/{splits,data,train,metrics}.py`, `scanner/training/scanner/{export_head_a,export_probe_head}.py`.
- Existing proof: `scanner/tests/{test_fabric_abstain,test_taxonomy}.py`.

## Findings

### P1 — advertised 27-label baseline is not the active classifier vocabulary

**Evidence:** Design §2 describes “27 overlapping TextileNet fabric labels”; §6 rejects unadjudicated jersey→knit mapping. However `scanner/models/scanner-v8/bundle.json` names `structure_model.dir = head_a`; `scanner/services/vision/heads.py:LinearHeads.predict` replaces the linear structure classes/probabilities with that model's output. Its `head_a/head.json` contains 24 labels and declares `catalog (TextileNet fabric24)`. `scanner/training/textilenet/splits.py:SCOPES` drops canvas/plush and merges jersey into knit for fabric24; fabric22 additionally drops serge/chenille. The 27-class list in bundle.heads.structure is therefore not the active vocabulary. Proposed `taxonomy_version:string` and `allowed_fabric_labels:string[]` do not yet specify a canonical registry or fail-closed mapping between these scopes. T01 only says document aliases, while T06 reuses the real classifier.

**Consequence:** An executor can bind a 27-label PO dictionary to an effective 24-label classifier and call the result strictly compatible, or inherit an unadjudicated jersey/knit equivalence. A dropped label cannot be a confirmed mismatch merely because the active head cannot emit it.

**Correction:** Correct the baseline and have T01 own a versioned label registry plus explicit effective class order/scope/mapping artifact; T06 readiness and T11 release must validate it against the selected head, not the dormant linear head. Require expert/factory adjudication for semantic equivalences; unsupported PO distinctions remain review-only. This is a proposed mapping gate, not evidence that today's artifact has factory authority.

**Test assertion:** Given this v8 metadata, effective classes equal head_a's 24 labels; a PO requiring jersey as distinct from knit or requiring canvas fails compatibility and cannot ACCEPT/HOLD. Switching fabric24→fabric22 invalidates an old release/mapping unless independently reauthorized.

### P1 — Stage null invariant makes UNKNOWN evidence unrepresentable without inventing adapter semantics

**Evidence:** Design §3 gives `fabric:Stage<{label; taxonomy_version; calibrated_probability; unknown}>` but requires every non-OK stage to have `value:null`. §6 requires UNKNOWN distinct from missing execution. Existing `scanner/services/vision/heads.py:LinearHeads.predict` returns `structure=None` with closest candidates when the threshold abstains; `scanner/services/vision/predictor.py:structure_answer` deliberately returns the candidate label/confidence with `unknown:true`, and returns None only when the head did not run. `scanner/tests/test_fabric_abstain.py` explicitly tests these distinct cases. T01/T06 do not pin their v2 mapping.

**Consequence:** Mapping legacy abstention to ABSTAINED loses the candidate/unknown payload and makes the contract's unknown flag unusable there; mapping it to OK silently changes what stage success means. Clients and the policy may disagree about whether execution occurred or whether a candidate is authoritative.

**Correction:** Freeze one representation before fixtures: for example, OK means completed inference (including `unknown:true`), ABSTAINED is reserved for no usable inference; alternatively move diagnostic candidates outside Stage.value. Define label/probability/unknown constraints, reasons and no-automation semantics explicitly, including out-of-taxonomy versus low-confidence evidence. Do not weaken the existing missing-execution distinction.

**Test assertion:** Cross-language fixtures distinguish completed low-confidence inference, completed OOD inference, missing head and failed head; preserve intended diagnostic candidate data; all unknown cases produce MANUAL_REVIEW even if their candidate matches the PO.

### P1 — the selected existing artifact explicitly carries calibration that does not match served logits

**Evidence:** `scanner/models/scanner-v8/head_a/head.json` says class bias was removed before install and “val/test coverage and threshold were fitted with the bias”; it records threshold 0.6697233807960672 and temperature 0.8248758520320696 with no active class_bias. `scanner/services/vision/heads.py:FineTunedHead.__init__` defaults missing class_bias to zero, and `probs_from_features` computes softmax(logits + bias, temperature). Design §§3,8 calls outputs calibrated and reuses the existing export pipeline; T06 requires artifact hashes, but neither T06 nor T10 explicitly rejects metadata whose calibration refers to a different scoring transform. A hash proves identity, not calibration compatibility.

**Consequence:** The demo can display a historical catalog confidence as a calibrated current probability, and future release work can accidentally carry over a known stale threshold. Review-only prevents automated decisions but does not make the confidence claim correct.

**Correction:** Inventory this mismatch explicitly; represent the existing probability as unvalidated/null for v2 unless a matching evaluation is supplied. Require calibration provenance to bind weights, bias, scope, preprocessing, view aggregation and calibration cohort. Refit and independently validate only in the authorized future training/release workflow; this review authorizes no runs.

**Test assertion:** A fixture with removed bias and bias-dependent calibration is not eligible for calibrated_probability or release; changing any score transform invalidates calibration even with unchanged weights. A matching complete bundle passes compatibility, separately from empirical release statistics.

### P2 — macro-F1 protocol does not pin abstention and absent-label denominators

**Evidence:** Design §7 requests per-domain macro-F1 >=0.85 as a research target plus coverage; T10 requests known-label macro-F1/per-class/unknown, without stating whether abstentions are excluded. Existing `scanner/training/textilenet/metrics.py:summarize` uses argmax with no abstention and averages only labels present in y, reporting `classes_absent`; `scanner/training/scanner/export_head_a.py:macro_f1` likewise loops over np.unique(y). Runtime applies a threshold and can abstain. Product rescope also drops records before evaluation (`splits.py:rescope`). Thus these existing numbers measure different populations from selective runtime performance.

**Consequence:** Removing difficult classes/samples or scoring only answered cases can improve a reported F1 without improving the proposed classifier; per-domain missing labels can make comparisons misleading. This does not itself invalidate the separate selective-risk release gate.

**Correction:** Add an explicit T10 evaluation protocol: fixed adjudicated label universe and support table, unconditional known-label argmax F1, deployed thresholded result with abstentions counted as missed known-label answers, separately named conditional F1/coverage, and separately specified unknown challenge precision/recall. Report absent labels and scope exclusions; do not claim target attainment for unsupported labels/domains. Keep the 0.85 value a research target, not invented authority.

**Test assertion:** A high-confidence correct answer plus an abstained known-label example cannot produce perfect deployed unconditional F1; omitting the latter changes the exclusion/support report. A domain missing a required label reports insufficient support rather than silently certifying the full taxonomy target; a fabric22 report cannot substitute for fabric24/27-label performance.

## Final recommendation and authority boundaries

Resolve these items in the drafts and planned fixtures before calling T01 frozen or T06 classifier evidence calibrated. Existing whole-photo fallback (`scanner.py:ScannerPredictor.predict`) already classifies when no garment is detected, but still executes the detector; the proposed detector-free swatch path remains useful and is not shipped v2 behavior. Keep the existing review-only fallback and G1/G2/G4/G7 gates: expert taxonomy adjudication, factory permission, data rights and independent release evidence cannot be supplied by a unit test or this review. No draft/product files, GPU jobs, installs or purchases were changed or performed.
