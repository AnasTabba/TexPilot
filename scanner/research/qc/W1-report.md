# W1 report - R06 training/release audit fixes

Date: 2026-11-16. Only owned files edited. No git write commands run.

## Results

- `cd scanner && ../.venv/bin/python -m pytest tests/test_qc_split_audit.py tests/test_qc_release_gate.py tests/test_qc_training.py tests/test_qc_enrollment.py tests/test_qc_ablations.py tests/test_qc_export_guard.py tests/test_qc_references.py tests/test_qc_workflow_metrics.py -q` -> 357 passed, 0 failed, 0 errors (junit xml count).
- `cd scanner && ../.venv/bin/ruff check training/qc scripts/qc_*.py <the 8 test files above>` -> All checks passed.
- Wider glob `tests/test_qc_*.py` shows 5 ruff errors, all in `tests/test_qc_metrology.py` (not owned, other worker).
- The four named failing tests and `test_group_bootstrap_seeded_resamples_groups_not_tiles` pass.

## Per finding

Fixes P0-1..P0-4, P1-4 (partly) and the bootstrap test were made by the previous worker (in the working tree). In this session I re-ran every R06 reproduction against the current code and confirmed each now blocks or refuses. Regression tests for findings that had none were added this session. Those tests could not be run failing-first because the fix was already in the tree and git stash/checkout is forbidden. The repro output before the fix is in R06.

| Id | Status | Test |
|---|---|---|
| P0-1 correlated units | fixed (prior) | test_correlated_confirmatory_selections_block_promotion |
| P0-2 non-normalised group ids | fixed (prior) | test_non_normalised_group_ids_counted_as_one_group |
| P0-3 calibration groups reserved | fixed (prior) | test_calibration_groups_reserved_across_looks |
| P0-4 identifier normalisation | fixed (prior) | test_identifier_unicode_normalization_links_splits (3 variants). R06's "NBSP" row used `roll 7` (space vs hyphen), a different id; `roll-7<NBSP>` is linked. |
| P0-5 derived_from case | fixed, test added | test_derived_from_matches_source_names_regardless_of_case |
| P0-6 cohort validation (COHORT_INVALID) | fixed, test added | test_unknown_or_misspelt_cohort_blocks |
| P0-7 AITEX G5 any spelling | fixed, test added; G5 stays open, nothing relabelled/dropped | test_aitex_g5_stays_open_for_any_spelling |
| P0-8 placeholder licence, audit and export | fixed (allowlist), test added | test_placeholder_licence_blocks_promotion; export repro now `RIGHTS_UNKNOWN` |
| P1-1 consent | fixed in code (SourceRecord now has `consent_required`, `consent`); no new test added by me: skipped, needs a consent-authority design check by the lead | - |
| P1-2 consensus self-uncertainty | fixed, test added | test_consensus_cannot_hide_disagreement_by_declaring_large_uncertainty |
| P1-3 parity NaN | fixed (ValueError), test added | test_parity_nan_scores_or_densities_are_refused |
| P1-4 risk target in plan hash | fixed: changed risk target now gives `PLAN_MISMATCH`; test added. Family alpha and HOLD criterion not separately re-verified. | test_risk_target_is_sealed_in_the_plan |
| P1-5 malformed phash | fixed (PHASH_INVALID), test added | test_malformed_perceptual_hash_blocks |
| P1-6 selection id normalisation | fixed, test added | test_selection_id_spelling_does_not_hide_inconsistent_rolls |
| P2-1 bound rounds down | fixed this session, failing-first confirmed (4 params failed, then pass): bisection refined in 50-digit Decimal inside a 1e-10 bracket, upper end plus one ulp | test_bound_never_rounds_below_exact_tail |
| P2-2 NBSP signatory | fixed, test added | test_nbsp_variant_signatory_is_not_independent |
| P2-3 over-blocking | fixed (placeholder/missing ids no longer link) | test_placeholder_roll_ids_do_not_link_unrelated_items |
| P2-4 final_status vs flags | fixed (ValueError), test added | test_final_status_must_agree_with_accept_flags |
| P2-5 empty macro F1 | fixed (None), test added | test_empty_fabric_cohort_macro_f1_is_undefined |
| P2-6 weak tests | partly: TBD/tbc/?/- licence cases and cross-id cases added; the two AITEX tautology tests, `test_fixed_stopping` `or`, and enrollment self-formula test not rewritten | - |

## Files changed this session

- `scanner/training/qc/release_gate.py` (P2-1: `_decimal_cdf`, refinement step, Decimal import)
- `scanner/tests/test_qc_release_gate.py`, `test_qc_split_audit.py`, `test_qc_training.py`, `test_qc_references.py`, `test_qc_workflow_metrics.py` (tests appended)

## Not done / notes

- S1-S7 suspicions untouched (not proven defects).
- P1-1 consent: no dedicated test; design decision on authority model left to lead.
- `false_accept_upper` now takes about 0.16 s at (1000, 20000); acceptable.
