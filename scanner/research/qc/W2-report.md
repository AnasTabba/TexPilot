# W2 report: R05 metrology and quality fixes (16 Nov 2026)

Result: `cd scanner && ../.venv/bin/python -m pytest tests/test_qc_metrology.py tests/test_qc_quality.py -p no:cacheprovider -W ignore` -> 96 passed, 0 failed.
`../.venv/bin/ruff check services/vision/qc_metrology.py services/vision/qc_quality.py tests/test_qc_metrology.py tests/test_qc_quality.py` -> All checks passed.

G3 calibration stays unvalidated. All thresholds and artifacts are test doubles. Nothing here claims physical accuracy.

| Finding | Status | Fix | Test |
|---|---|---|---|
| P0-1 weak fundamental under dominant harmonic | fixed | `_estimate` abstains PATTERN_AMBIGUOUS when power at f/2 or f/3 of the chosen peak exceeds `_SUBHARMONIC_MAX_RATIO` (0.005) of the peak | `test_weak_fundamental_under_dominant_harmonic_never_measures[weak_second/weak_third]` |
| P1-1 zero-width interval | fixed | interval floored at half an analysis-window bin (`resolution_floor_rel` in the budget); non-finite or non-positive width abstains MEASUREMENT_UNCERTAIN | `test_zero_model_uncertainty_still_gives_a_real_interval` |
| P1-2 traceability/print content unread | fixed | both reports must carry `status == "PASSED"`, else DOMAIN_UNVALIDATED | `test_failed_or_unstated_reference_verification_abstains` (6 cases) |
| P1-3 blur/framing pass on grain or noise | fixed | `measure_view` adds `structure_prominence` (2-D spectrum peak-to-median floor, threshold 200); no periodic structure fails blur and framing | `test_grain_cannot_make_a_defocused_swatch_look_sharp`, `test_a_noise_field_is_neither_sharp_nor_textured[12/30/60]` |
| P1-4 tilted fabric flagged as moire | fixed | moire is measured on the 2-D spectrum: slow-beat peak over the yarn line, thread band from 1/16 cycles/px at 512 px width; `moire_max_ratio` meaning changed, ENGINEERING value 0.1 | `test_tilted_fabric_is_not_reported_as_moire[2400-15.0/1600-5.0/1600-45.0]`, existing moire cases in both files |
| P2-1 NaN zoom passes binding | fixed | `math.isfinite(attestation.zoom_factor)` check in `_check_binding` | `test_non_finite_zoom_cannot_pass_the_binding` |

## Design notes for the lead

- `QUALITY_VERSION` is bumped to `qc-quality-2` because the moire measure and its threshold scale changed. Old `qc-quality-1` threshold artifacts now fail closed (stage ABSTAINED). The test doubles in both test files are updated (method_version, moire_max_ratio 0.1). `scanner/research/qc/metrology-protocol.md:102` still says `qc-quality-1`; not an owned file, needs a one-word change.
- Structure prominence 200 and the sub-harmonic ratio 0.005 are engineering constants chosen against synthetic cases only. Clean gratings leave about 1e-4 at f/2 and f/3; the weakest R05 case leaves about 0.01.
- This continuation fixed the remaining failures: `_failures` did not use `structure_prominence` yet, the thread band minimum (1/64) let a strong moire beat be picked as the thread line, and the test doubles used the old method version. Lint fixes in the test file: mutable defaults (`traceability`, `print_check` now `None` sentinels), long lines.
- Sheets coarser than a 50 px thread period at 1600 px width fall below the thread band and would be treated as unstructured (fail closed: blur and framing fail). Documented ceiling.

## Files changed

- `scanner/services/vision/qc_metrology.py`
- `scanner/services/vision/qc_quality.py`
- `scanner/tests/test_qc_metrology.py`
- `scanner/tests/test_qc_quality.py`
