# R05 audit: QC v2 metrology and capture-quality (14 Nov 2026)

Scope: `scanner/services/vision/qc_metrology.py` (737 lines), `scanner/services/vision/qc_quality.py` (305 lines), their imported helpers (`threads._power`, `threads._peak_of`, `marker._largest_rect`, `marker.CARD_ID`, `services/api/qc_schemas.py` for `Stage`, `Measurement`, `QualityChecks`, `ScaleReference`, `CalibrationProfile`, `AcquisitionAttestation`, `canonical_json`), and tests `scanner/tests/test_qc_metrology.py`, `scanner/tests/test_qc_quality.py`. Design reference: `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md`.

Method notes:
- Both test files pass: 71 tests, 0 failures, 0 errors (JUnit totals for `../.venv/bin/python -m pytest tests/test_qc_metrology.py tests/test_qc_quality.py -p no:cacheprovider`).
- The file viewer folded function bodies to `...`. Every body was therefore read byte-for-byte through `sed`, `awk` or Python line dumps. Confirmed: zero literal `...` lines in `qc_metrology.py`; `git show HEAD:` shows the same content.
- Synthetic images: 1600 x 1600 RGB, 508 px/in (20 px/mm). The 160 px card is 8 mm, matching `ScaleReference.dimensions_mm = (8, 8)`. The harness rebuilds the test-double artifacts (`tests/_r05_tmp/harness.py`, deleted at the end). All artifacts are test doubles, not G3 validation.
- Throwaway scripts lived only in `scanner/tests/_r05_tmp/`. The folder is deleted before this report was finalised.

Severity scale: P0 wrong measurement returned as OK with a confident interval. P1 wrong abstain or wrong quality decision. P2 hardening, no reachable wrong output today.

---

## 1. Proven defects

### P0-1. Weak fundamental under a dominant harmonic is returned as OK at 2x or 3x density

Location: `services/vision/qc_metrology.py:213-217` (rival test: only `f1/2` and `2*f1` are tested, and `f1/3`, `3*f1` are excluded from the "other periodicity" test entirely); `:261-264` (autocorrelation takes the first strong peak, the smallest lag, which is the harmonic's period). Docstring `:181-183` promises that a harmonic is never chosen.

Mechanism (verified, `exp_mechanism.py`): the strongest spectral peak is the harmonic. The true fundamental sits below the `harmonic_ratio_max = 0.15` power threshold, so the code does not reject it. The autocorrelation estimator then locks onto the same harmonic, so the "independent agreement" check agrees with the wrong answer.

Reproduction 1, estimator level, standalone (self-contained, `ppi=508`, `tpi_range=[20,70]`, the test-double values for the other keys). Every component is an integer multiple of 20 tpi, so the signal's period is 20 tpi:

```python
import numpy as np
from services.vision.qc_metrology import _estimate
x = np.arange(1024, dtype=float)
tone = lambda t, a, ph: a * np.cos(2 * np.pi * t / 508.0 * x + ph)
sig = tone(20, 0.3, 0.3) + tone(60, 1.0, 0.7)          # fundamental 20 tpi, third harmonic 60 tpi
v = dict(tpi_range=[20.0, 70.0], min_repeats=8, min_tiles=2, harmonic_ratio_max=0.15,
         estimator_agreement_rel=0.05, tile_spread_max=0.05)
print(_estimate(sig, 508.0, v))                        # -> (~60.0, spread): returns the harmonic
```

Actual output, pasted from running the snippet above:

```
(np.float64(59.99989603923177), 2.775433716097966e-08)
```

Same pattern at fundamental amplitude 0.1 and 0.5 (`exp_estimate2.py`): OK 60.000.

Reproduction 2, pipeline level. The test fixture `build()` at `tests/test_qc_metrology.py:49-225` is a copy with the image injected (the scratch copy is deleted). Image: across = 0.3*42*cos(2*pi*20*x/508) + 42*cos(2*pi*60*x/508 + 0.7), picks 31.75 as in the fixture, card regions restored:

Actual output:
```
3rd-harmonic-dominant pipeline: OK ends=59.957 interval=[58.510;61.403] truth=20.0 err=+199.8%  picks=31.727 (truth 31.75)
2nd-harmonic-dominant pipeline: OK ends=49.964 interval=[48.758;51.169] truth=25.0 err=+99.9%  picks=31.727 (truth 31.75)
clean control: OK ends=50.763 interval=[49.538;51.988] truth=50.8 err=-0.1%  picks=31.727 (truth 31.75)
```

Reproduction 2, estimator level (`exp_estimate2.py`, `_estimate` directly, `ppi=508`, `tpi_range=[20,70]`):
```
T1 sub-harmonic: truth f0=25, amp f0 a, amp 2f0=1
  a=0.1 r=0.15 -> OK 50.000   r=0.5 -> OK 50.000
  a=0.3 r=0.15 -> OK 50.000   r=0.5 -> OK 50.000
  a=0.39 r=0.15 -> ABSTAIN PATTERN_AMBIGUOUS
T2 third harmonic: truth f0=20, amp f0 a, amp 3f0=1
  a=0.1 -> OK 60.000   a=0.3 -> OK 60.000   a=0.5 -> OK 60.000
```

Mechanism readout (`exp_mechanism.py`):
```
2nd harmonic (truth 25): spectral peak 50.00 tpi | power/peak at truth 0.010 | at f1/2 0.010 | at f1/3 0.000 | autocorr period 10.159px -> 50.00 tpi | counted 50.00 tpi
3rd harmonic (truth 20): spectral peak 60.00 tpi | power/peak at truth 0.089 | at f1/2 0.000 | at f1/3 0.089 | autocorr period 8.472px -> 59.96 tpi | counted 60.00 tpi
```

Expected: abstain (PATTERN_AMBIGUOUS), or the fundamental. Never a harmonic with a tight interval.

Caveat on severity: the "truth" is the fundamental period of a signal built by construction. If the lab defines thread count as the dominant spectral peak, this becomes a spec question, not a code bug. The module docstring and `_estimate` docstring say otherwise.

Fix: test `f1/3` and `3*f1` against the same ratio as `f1/2` and `2*f1`, and make the autocorrelation refinement start from the longest-lag strong peak, or require the lag to be an integer multiple of the spectral period.

### P1-1. Zero model uncertainty gives a zero-width "95%" interval

Location: `services/vision/qc_metrology.py:333` (`_number(components, k) < 0` accepts 0; `:330-336` accepts a zero reference uncertainty), `:670` (`interval95=(max(0.0, tpi*(1-u)), tpi*(1+u))`).

Reproduction (`exp_pipeline_harm.py`, `build(components=0.0, ref_unc=(0.0, 0.0))`):
```
zero-components ends: value=50.7632 interval=[50.7632;50.7632] width=0.0000 rel_halfwidth=0.0000%
zero-components picks: value=31.7271 interval=[31.7270;31.7271] width=0.0001
```
Truth 50.8 lies outside the reported interval. The 0.07% offset is estimator bias, so the interval reports zero uncertainty for a measurement it does not match.

Expected: a validated artifact cannot produce a zero-width interval. Floor the interval at the estimator resolution, and reject zero reference or model components.

Fix: require strictly positive `components` and `uncertainty_mm` in `_validate_numbers`, and add a resolution floor (about one frequency bin relative width) to `u`.

### P1-2. Reference traceability and print verification are checked for presence, not content

Location: `services/vision/qc_metrology.py:371-379`. `trace` and `print_check` are loaded by hash and kind, then only tested for `is None`. Their contents are never read.

Reproduction (`exp_trace.py`):
```
traceability+print artifact (no content): OK [] {'ends': 50.763, 'picks': 31.727}
traceability+print artifact (status FAILED): OK [] {'ends': 50.763, 'picks': 31.727}
```

Expected: a traceability report whose own status is FAILED must abstain (`DOMAIN_UNVALIDATED`). Fix: check the report's verdict field before accepting it.

### P1-3. Capture-quality "blur" and "framing" pass on grain or noise

Location: `services/vision/qc_quality.py:187` (Laplacian variance over the whole frame, which grain dominates), `:219` (blur `<` threshold), `:170` (texture fill counts any 8x8 cell with std > 2.0, which grain also satisfies), `:230` (framing).

Reproduction (`exp_quality_final.py`, validated thresholds as test doubles, same numbers as `THRESHOLD_DOUBLE`):
```
defocus sigma12 + grain sigma12 -> OK [] {'blur': True, 'glare': True, 'moire': True, 'fold': True, 'framing': True, 'resolution': True, 'marker_geometry': True}
pure uniform noise -> OK [] {'blur': True, 'glare': True, 'moire': True, 'fold': True, 'framing': True, 'resolution': True, 'marker_geometry': True}
```

Grain sweep on a sigma-12 or sigma-20 blurred swatch (`exp_blur_noise.py`): grain sigma 10 gives Laplacian variance 68.0, grain 12 gives 97.6, grain 15 gives 152.0. The blur threshold is 60, so grain of sigma 10 and above flips blur to a pass (sigma below 10 was not tested). Clean blurred input gives 0.2 (fail), correctly.

Expected: an out-of-focus image and a noise field are not "not blurred" and "framed". Fix: estimate the noise floor and measure sharpness on the fabric's own spectral band, not on raw Laplacian variance; require structure at the expected thread frequency for framing.

Note: the uniform grey and grey-plus-light-grain cases fail correctly (`exp_quality.py`: "uniform grey 128 -> blur and framing fail"). Only the noise-dominated case passes.

### P1-4. Rotated fabric fails the moire gate, so every tilted sheet abstains

Location: `services/vision/qc_quality.py:176-185` (moire is the peak ratio of slow to fine power of the **row- and column-averaged** profiles), `:232` (`> moire_max_ratio`).

Reproduction (`exp_moire_angle.py`, `grating_rot` rotates the fabric relative to the fixed card, the card itself is not rotated):
```
theta=  0.5 moire_ratio=0.033
theta=  1.0 moire_ratio=0.285
theta=  2.0 moire_ratio=0.358
theta=  3.0 moire_ratio=1.004
theta=  5.0 moire_ratio=14.204
theta= 20.0 moire_ratio=14.178
theta= 30.0 moire_ratio=13.204
```
Pipeline (`exp_rotation.py`, validated thresholds, moire threshold 5.0):
```
10 correct ABSTAINED ['QUALITY_MOIRE']
45 correct ABSTAINED ['QUALITY_MOIRE']
80 correct ABSTAINED ['QUALITY_MOIRE']
```
With the moire gate disabled (`exp_rot_isolated.py`), the rectification is correct at each angle (see section 2). So the failure is the gate alone.

Expected: a sheet placed a few degrees off-axis should not be rejected as moire. This is a systematic wrong abstain for any tilted sheet. Raising the threshold to about 15 would clear it, but that removes the gate's sensitivity to real moire, so the defect is in the measure, not the threshold. Fix: compute the beat in 2-D (for example on the rotated-to-warp rectified image, or on the 2-D power spectrum) instead of on row and column means.

### P2-1. NaN passes the zoom binding check

Location: `services/vision/qc_metrology.py:145` (`abs(attestation.zoom_factor - _number(...)) > 1e-6`). For NaN, `abs(...)` is NaN and `NaN > 1e-6` is False, so the mismatch is never raised.

Reproduction (`exp_nan_binding.py`):
```
_check_binding with zoom_factor=NaN: NO ABSTAIN (passes)
full pipeline zoom=NaN(model_construct): OK [] [('ends', 50.763), ('picks', 31.727)]
```
Today the schema blocks this (`exp_nan_inputs.py`: `attestation zoom=nan: rejected (ValidationError)`, same for inf, -1, 0; reference NaN and inf dimensions also rejected). So it is reachable only by bypassing validation.

Fix: write the test as `not abs(...) <= 1e-6`.

---

## 2. Checked and sound

Accuracy, pipeline level (`exp_pipeline_accuracy.py`, clean synthetic gratings, card 8 mm, 20 px/mm):

| true ends (tpi) | true picks (tpi) | measured ends | err ends | ends 95% interval | measured picks | err picks | picks 95% interval |
|---|---|---|---|---|---|---|---|
| 50.8 | 31.75 | 50.763 | -0.07% | [49.54; 51.99] | 31.727 | -0.07% | [30.96; 32.49] |
| 40.0 | 25.4 | 39.971 | -0.07% | [39.01; 40.94] | 25.382 | -0.07% | [24.77; 25.99] |
| 60.0 | 45.0 | 59.957 | -0.07% | [58.51; 61.40] | 44.968 | -0.07% | [43.88; 46.05] |
| 30.0 | 20.0 | 29.978 | -0.07% | [29.25; 30.70] | 19.985 | -0.07% | [19.50; 20.47] |
| 65.0 | 30.0 | 64.953 | -0.07% | [63.39; 66.52] | 29.978 | -0.07% | [29.25; 30.70] |

Rotation of the fabric relative to the fixed card, moire gate disabled (`exp_rot_isolated.py`), truth ends 50.8, picks 31.75:

| fabric rotation | measured ends | err | measured picks | err |
|---|---|---|---|---|
| 0 | 50.763 | -0.07% | 31.727 | -0.07% |
| 10 | 50.763 | -0.07% | 31.727 | -0.07% |
| 45 | 50.763 | -0.07% | 31.727 | -0.07% |
| 80 | 50.763 | -0.07% | 31.727 | -0.07% |

Other geometry:
- Non-square pixels (x stretched 1.2x, card stretched to 192 px, which is under the 1.3 limit): ends 50.770 (-0.06%), picks 31.727 (-0.07%). The homography from the card corners corrects it.
- Lens distortion k1 = +0.05 with the matching artifact: ends 50.838 (+0.07%), picks 31.776 (+0.08%), `undistorted=True`.
- Lens distortion not corrected (artifact says 0, photo has k1 = 0.02, 0.05, 0.10): abstains with `SCALE_MISSING`, `SCALE_INVALID`, `SCALE_INVALID`. Fail-closed, as intended.
- Negative k1 (barrel) abstains: the left card is pushed into the black remap border and detection fails. Fail-closed.

Noise and spacing wander (`exp_interval.py`):
- Grain sigma 25 and 40: ends err -0.07%, truth inside the interval.
- Thread spacing wander 0.2 px and 0.4 px: ends err -0.08% and -0.02%, truth inside the interval.
- Interval half-width is 2.41% in every case; see section 3.

1-D estimator (`exp_estimate2.py`), pure tones, n = 1024, band 20 to 70 tpi, 0.5 tpi steps: 95 OK, max error 0.001%. 6 abstain at 67.0 to 70.0 tpi, near the band edge. Fail-closed.

Other metrology checks sound on read and test:
- `_check_binding`: orientation 5 to 8 swaps width and height correctly; the 90-degree tests (`turn` 0/1/2) pass with the axes preserved; resolution, capture mode, lens, focus, zoom and unobserved-field cases all abstain (`test_acquisition_mismatch_or_unobserved_abstains`, 12 cases).
- Expiry: `valid_from <= now < expires_at` in both `_measure` and `load_current`, so `now == expires_at` abstains consistently.
- `_largest_rect`: brute-force check against all rectangles on 400 random masks, 0 mismatches (`exp_rect.py`).
- Frequency grid: `_power` zero-pads to 4n and `_peak_of` uses the same 4n grid, so the frequency axes agree. Confirmed by the 0.001% pure-tone error.
- `_spatial_count` (unfiltered crossings) agrees with the spectral frequency on the clean and harmonic cases; counts 50.00 and 60.00 tpi as expected.
- Rectification angle: `atan2(dx, dy)` maps the registered direction onto +y (checked analytically: the x-component of the rotated step is zero, and the y-component is the step length). Confirmed numerically across 0 to 80 degrees.
- Generic exceptions inside `_measure` become `FAILED` with `STAGE_UNAVAILABLE`, never a number.
- Numeric validation (`_validate_numbers`): rejects harmonic ratio >= 1, marker stretch < 1, min source px per thread < 3, coverage factor < 1.96, reversed or non-positive tpi range, duplicate or self-referencing marker IDs. Read and covered by tests.
- Schema: `AcquisitionAttestation.zoom_factor`, `ScaleReference.dimensions_mm` and `uncertainty_mm` reject NaN, inf, zero and negative values with `ValidationError`.
- Degenerate images in metrology: uniform grey with cards abstains (`QUALITY_FRAMING`); pure uniform noise with cards abstains (`PATTERN_AMBIGUOUS`); Gaussian noise sigma 40 with cards abstains (`PATTERN_AMBIGUOUS`); stripe only (picks zero) abstains (`MEASUREMENT_UNCERTAIN`); density 90 tpi or 15 tpi outside the range abstains (`PATTERN_AMBIGUOUS`).
- Quality heuristics on clean inputs (`exp_quality.py`, validated thresholds): sharp fabric passes all seven; gaussian blur sigma 12 fails blur and framing; uniform grey 128 fails blur and framing; 64x64 image fails resolution; 1x1 image fails four checks.
- Quality threshold directions (read): blur `<`, glare `>` on clipped-bright, dark `>` on clipped-dark, resolution `<`, framing `<`, moire `>`, fold `>`, marker stretch `>`. Each is the correct direction for "fails when worse". Equality passes, consistent across checks.
- `_largest_rect`, `_estimate` and `measure_with_geometry` have no fail-open path on NaN or empty input (they raise, and the outer `except Exception` returns `FAILED`).

---

## 3. Unproven suspicions

1. **Interval does not include estimator variance.** The half-width is 2.41% in every OK case tested, including grain sigma 40 and spacing wander 0.4 px. It comes entirely from the validated uncertainty model (`k * sqrt(sum parts^2)`, with a test-double component of 0.005). The tile-spread term is near zero on synthetic fabric. Real fabric spread is unmeasured. Whether the interval is then a real uncertainty depends on the validated model, which does not exist yet (gate G3).
2. **Wrong axis registration is returned as OK with the axes swapped.** Registering the fabric 90 degrees off gives `ends 31.73, picks 50.76`, state OK, no reasons. The design calls the registration the trust root, and no image-side check can detect it. Flagged for the spec owner, not as a code bug.
3. **Blur verdict depends on source resolution.** `measure_view` resizes to 512 px width before the Laplacian (`qc_quality.py:165-166`). The same photo at different resolutions can get a different blur verdict. Not tested.
4. **Quality stage uses the wall clock when `now` is None.** `assess_capture_set` (`qc_quality.py:265`) falls back to `datetime.now`. The metrology path always passes `now`, so this only affects a direct call to the quality stage.
5. **Colour channel order is assumed RGB.** `cv2.cvtColor(..., COLOR_RGB2GRAY)` at `qc_metrology.py:434` and `qc_quality.py:155`. A BGR input changes the luminance weights. Density is unaffected (grey gratings), but the quality heuristics may be. Not tested.
6. **`limits_or` is dead code.** `qc_metrology.py:685-686` returns its input. No caller in `git grep`.
7. **Test coverage gaps (category E).** No test would fail if the P0-1 defect were present. `test_half_double_harmonics_are_rejected_even_with_identity_double` uses a 0.8-amplitude subharmonic (power 0.64, far above the 0.15 threshold). `test_printed_or_harmonic_signals_never_choose_a_density` uses a 36-to-42 amplitude ratio, also strong. The rotation tests use only 90-degree multiples, so P1-4 is untested. The quality tests use only clean synthetic images, so P1-3 is untested. `test_independent_autocorrelation_disagreement_*` replaces the autocorrelation with a constant, so it tests the plumbing, not the independence claim.

---

## 4. Not covered

- `services/vision/qc_imageio.py` and the `test_qc_imageio.py`, `test_qc_references.py` tests. Not imported by the two audited modules. No `qc_references.py` source file exists in `git ls-files`.
- `services/api/qc_pipeline.py::_metrology`, the production caller. Read the call (it passes `now=context.evaluated_at`, which is correct). Multi-view combination was not audited.
- `threads.py` and `marker.py` beyond `_power`, `_peak_of`, `_largest_rect` and `CARD_ID`.
- `_markers` duplicate-ID path (read only, not exercised).
- `_source_points` at scale (one test point only).
- Real photographs. Every result is synthetic. No G3 validation artifact exists.
- Float, 16-bit, BGR and EXIF-rotated inputs (the decoder emits uint8 RGB, so float NaN cannot reach the quality path in practice; checked by reading `qc_imageio.py` only).
- Timing and memory limits (`_MAX_RECT_PIXELS`, `duration_ms`).
- Harmonic thresholds for a real validated `harmonic_ratio_max`. The test doubles use 0.15; the real value is unknown.

---

## 5. Scratch scripts

All under `scanner/tests/_r05_tmp/`, deleted before finishing: `harness.py`, `exp_pipeline_accuracy.py`, `exp_rotation.py`, `exp_moire_rot.py`, `exp_moire_angle.py`, `exp_quality.py`, `exp_blur_noise.py`, `exp_quality_final.py`, `exp_estimate.py`, `exp_estimate2.py`, `exp_pipeline_harm.py`, `exp_mechanism.py`, `exp_rotation`/`exp_rot_isolated.py`, `exp_adversarial.py`, `exp_adv2.py`, `exp_nan_inputs.py`, `exp_nan_binding.py`, `exp_rect.py`, `exp_distortion*.py`, `exp_interval.py`, `exp_trace.py`.
