# R08: final QA of the uncommitted R04-R07 fixes (incoming-fabric QC v2)

Date: 16 Nov 2026. Reviewer: R08, read-only. Base 128bb74 plus the dirty working tree. Nothing in the repo was edited. All scratch scripts are in `/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/fa1c5477-7456-48d1-9aa4-f3793461398f/scratchpad/qa/`.

Baseline: `node --test tests/*.test.mjs` 779 pass, 0 fail. `pytest -k qc` all pass (one skip).

Claim under test: no automatic ACCEPT/HOLD without a released, tested domain; missing, failed or uncertain evidence never becomes ACCEPT; tenants isolated; retries idempotent.

Verdict: the claim holds for everything the real pipeline can emit today (the defects and domain stages are still unavailable, calibrated_probability is hard-coded None, so no automatic draft exists). It does NOT hold as a general statement about the policy and Worker code. Six findings. No P0.

## Findings

### F1 (P1, latent) No fabric confidence floor anywhere; p=0.0 is ACCEPT
`scanner/services/consistency/qc_policy.py:155-171`, `yarnflow/server/qc-store.mjs` `automaticEvidence` (fabric block). `DomainManifest` has no minimum-probability field. A known label with `calibrated_probability` 0.0 or 0.0001 is accepted by both Python and the Worker clamp; only `None` and `unknown=true` are refused.
Repro (`scratchpad/qa/py_policy.py`):
```
P1 calibrated_probability=0.0001: ACCEPT [] automatic=True
P2 calibrated_probability=0.0 : ACCEPT [] automatic=True
```
Worker: `scratchpad/qa/attack.test.mjs` case A7 prints `[A7 fabric calibrated_probability 0.0001] STORED/ACCEPTED-by-checkCandidate`.
Unreachable today only because `qc_pipeline.py:112` hard-codes `calibrated_probability=None`. This breaks "uncertain evidence never becomes ACCEPT" the moment a calibrated head ships. Fix: a released probability floor in `DomainManifest`, checked in Python and `automaticEvidence`.

### F2 (P1, latent) Defect regions are ignored; a 0.99 region under a 0.05 view is ACCEPT
`qc_policy.py:173-190` and `automaticEvidence` use only `views[*].score`. `DefectValue` (`qc_schemas.py:583`) does not tie `regions[*].score <= view score`.
Repro: `py_policy.py` P3 `regions 0.99 views 0.05: ACCEPT [] automatic=True`. Worker case A5 `STORED/ACCEPTED-by-checkCandidate`.
Fix: schema validator (region score <= its view score, on both sides) or include regions in the peak.

### F3 (P1) Metrology R05 P0-1 fix is incomplete: hidden fundamental at f/4 or f/5 still measures the harmonic
`scanner/services/vision/qc_metrology.py` sub-harmonic check covers only `f1/2` and `f1/3`.
Estimator level (`scratchpad/qa/pt/test_probe_metrology.py`):
```
true 15tpi amp0.3 under dominant 60tpi: MEASURED 59.9999 (f/4)
true 12tpi amp0.3 under dominant 60tpi: MEASURED 59.9999 (f/5)
```
End to end through `measure_with_geometry` (`scratchpad/qa/pt/test_probe_e2e.py`, synthetic weave with a 15 tpi component at amp 0.1 under 60 tpi):
```
state=OK values=[('ends', 59.96, [58.51, 61.4]), ('picks', 31.73, [30.96, 32.49])]
```
A confident, tight-interval wrong density is released as OK evidence. (At amp 0.3 the same image abstains for an unrelated SCALE_MISSING, so the e2e proof uses amp 0.1.) Same attack class R05 rated P0. Fix: check `f1/k` for k=2..5 (or all sub-multiples down to `fmin`).

### F4 (P1) Release gate's audit binding is circular; it accepts a forged or unrelated audit
`scanner/training/qc/release_gate.py` (new AUDIT_* block in `evaluate_release`). The gate checks `audit.manifest_sha256 == report.manifest_sha256`, `sha256(asdict(audit)) == report.audit_sha256` and `audit.promotable`. All three values are supplied by the caller in the same report; `promotable` is derived from the caller-built `findings`. The gate never checks that the released outcomes' `selection_id` and group ids appear in `audit.confirmatory_release_eligible`, and never receives the manifest.
Repro (`scratchpad/qa/pt/test_probe_gate.py`, output in `gate.txt`):
```
baseline: STATISTICAL_CANDIDATE accept_released=[True]
G1 audit of an unrelated clean manifest (other selections/groups): STATISTICAL_CANDIDATE accept_released=[True]
G2 forged AuditReport(findings=(), eligible=()) : STATISTICAL_CANDIDATE accept_released=[True]
```
Mitigation: result is only a STATISTICAL_CANDIDATE, still gated by T12 and G8. Fix: require every outcome selection id to be in `audit.confirmatory_release_eligible`, and recompute the audit from the manifest inside the gate (or verify a signed audit).

### F5 (P2) Worker clamp lacks parity with Python policy checks
The Worker `automaticEvidence`/`checkCandidate` (the only defence if the scanner is wrong or compromised) omits checks that `evaluate_qc` makes. A forged automatic ACCEPT is stored (`scratchpad/qa/attack.test.mjs`, `checkCandidate` returns instead of throwing):
```
A1 PO_UNCONFIRMED density (provenance != PO_CONFIRMED)   STORED/ACCEPTED
A2 domain.construction != spec.construction              STORED/ACCEPTED
A3 spec.allowed_fabric_labels not within effective_labels STORED/ACCEPTED
A4 evidence.created_at one day in the future             STORED/ACCEPTED
A9 domain.required_roles has a role no capture carries   STORED/ACCEPTED
A10 fabric label != top candidate                        STORED/ACCEPTED
```
Python rejects A1-A4 (PO_UNCONFIRMED, DOMAIN_UNVALIDATED, EVIDENCE_STALE). A9 and A10 are missed by Python as well. A9 is reachable by design: the capture set takes `required_roles` from the active release at creation time (`qc-store.mjs:414`, default `overview/structure/scale` when none), and `buildAnalyzeInputs` (line ~520) checks only the set's roles, never `domain.required_roles` of the release active at analysis time. Fix: add these to `automaticEvidence`, and check domain roles in `buildAnalyzeInputs`.

### F6 (P2) Quality and metrology threshold behaviour
- `_validated_thresholds` (`qc_quality.py:135`) accepts degenerate artifacts as validated: `blur_min_laplacian_var=0`, `glare_max_clipped=0.9999`, `moire_max_ratio=1e300`, `min_short_side_px=1`, `framing_min_texture_fill=1e-9` return True (`scratchpad/qa/py_q3.py`). Nothing bounds a validated threshold.
- `_MIN_STRUCTURE_PROMINENCE=200` is a hard-coded constant outside the validated artifact, and "no structure" is reported as `blur`/`framing`. Over-abstaining seen: a clean 60 px-period grid in a 1600 px frame is flagged `moire` (ratio 5.48, because the thread fundamental falls below `_FABRIC_MIN_FREQ` and the harmonic is taken as the thread line); a 3000 px render at 80 ends and 250 ppi flags moire 0.124. Direction is safe (recapture), but close-up shots may never pass.
- Sub-harmonic abstain is easy to trigger: 7 percent amplitude at f/2 passes, 10 percent abstains (alternating yarn weights); white noise sigma 0.5 on a unit tone abstains `PATTERN_AMBIGUOUS`. Safe direction, availability cost.
- The new traceability and print-verification `status == "PASSED"` check reads a field inside the same self-hashed artifact; it proves a declaration, not a verification.
- Identifier folding (`normalise_identifier`, `group_key`) folds case, whitespace, NFKC, zero-width and soft hyphen, but not `_` vs `-`, en dash, or homoglyphs (`Roll-17` vs `Roll_17`, `Rоll-17`): `scratchpad/qa/py_ident.py`. A physical roll can still sit on both sides of a split under a variant spelling.

## What I tried that held

- Worker clamp shape attacks (missing stage, null, string reasons, lowercase state, extra key, automatic as 1 or "true", automatic MANUAL_REVIEW, HOLD with no reasons): all refused before and after (r04 suite plus own).
- Duplicate metrology axis (bad value first, good last): refused by schema ("exactly one measurement per axis"), A6.
- Release mismatch: domain hash, policy hash, other workspace, expired release, release suspended between check and commit (SQL guard in `finalizeQC` batch), stage artifact hashes: refused.
- Retry: second `finalizeQC` with the same candidate writes nothing (`H1`, counts unchanged: evidence 1, decisions 1). Idempotency `request_id` is server-generated and UNIQUE, so the unscoped `UPDATE ... WHERE request_id=?` at `qc-store.mjs:697` and `:840` cannot cross tenants.
- Tenant: finalize with a foreign-workspace context: CONFLICT, no rows (`H2`).
- Density unit parity: `normalizeDensity` (JS) and `normalize_density` (Python) agree.
- Quality: pure noise, blank frame, and Gaussian-blurred grid (sigma 3) fail; rotation up to 45 degrees is not reported as moire; amplitude-modulated grid does not trip moire.
- Metrology: printed stripes, harmonics at 2f and 3f, lighting ramp, interferer at 0.1 amplitude, non-finite zoom, and non-PASSED reference records abstain or measure the right value as intended.
- iOS: `QCConfig` HTTPS-only in release, `keyed` idempotency keys are reused on indeterminate failures. `definitive` treats `status == 0` (a FAILED request record) as definitive and drops the key; the server then starts a fresh analysis, but a capture set with a recorded result returns CONFLICT, so no double decision. Not a bypass.
- Release gate: cohort and group reuse, calibration/release overlap, plan parameter binding (`risk_target`, `family_alpha`, `hold_criterion`), signatory normalisation: all refused in the tests I ran (the test file passes 66/66).

## Test and threshold changes (diff review)

No assertion was weakened. Deleted assertion lines were all replaced by stricter ones: `XCTAssertThrowsError` became explicit "accepted row" failure plus an error-type check; the fixture counter now increments only after the row passes; licence strings changed from `*-test-only*` placeholders to a real licence value in the split-audit and export-guard fixtures. Threshold changes: `moire_max_ratio` 5.0 to 0.1 (tighter) with `method_version` `qc-quality-1` to `qc-quality-2` (old artifacts are rejected). `synthetic_inputs` in `test_qc_release_gate.py` now uses `risk_target=0.9`, the same value the authority double already carried, now sealed into the plan hash; it is a test double, not a loosening. `from dataclasses import replace` removal is an import reshuffle (the new import still has `replace`).

## Notes

- Not verified: the Swift tests (no Xcode run), real D1, the HTTP route in `qc.mjs`.
- e2e proof for F3 uses my own patched synthetic weave (copy of `synthetic_weave` with the 20 tpi constant changed), not the repo's fixtures.
