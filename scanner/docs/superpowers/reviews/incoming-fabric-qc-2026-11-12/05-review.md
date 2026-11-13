# Reviewer 05 — metrology / optics

Recommendation: **revise before implementing the v2 metrology contract; retain REVIEW_ONLY until G3 and independent release gates pass.** No P0 found. This is one independent actual reviewer; no other reviewers' conclusions were consulted. Findings concern proposed behavior, not claims that v2 already ships.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (§§2–7, 11–13).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (contracts, T01/T03/T04/T06/T11, proof matrix).
- `scanner/services/vision/{marker,threads,quality}.py`, `scanner/services/api/spec.py`.
- `scanner/tests/{test_marker,test_threads,test_spec_api}.py`, `scanner/scripts/make_card.py`.
- `yarnflow/src/InspectArrival.tsx` (original-image compression boundary).

Read-only source tracing; no product tests, physical measurements, installs, training jobs, or purchases performed. Existing synthetic tests are evidence of their asserted cases, not physical validation.

## P1 — Named construction axes lack an observed orientation binding

**Evidence:** Design lines 102 and 108 prohibit rotation-based warp/weft swapping and require identifiable axes, but `Capture`/`Measurement` at lines 64–71 carry neither observed warp direction nor its provenance. T04 lines 86–90 accepts only image/profile/reference and asks for synthetic orientation checks without specifying how physical direction is established. Existing `threads.py:3–5,139–147` labels image x counts as ends and image y counts as picks; skew search is only approximately ±8 degrees (`25,85–99`). `marker.py:70–74` intentionally restores the photo's orientation, not a fabric direction. `tests/test_marker.py:test_the_rectified_photo_keeps_the_photos_orientation_not_the_cards` assumes the phone is held along the selvedge; it does not establish selvedge from pixels.

**Consequence:** A rotated swatch can produce plausible, low-spread counts assigned to the wrong PO axes. An asymmetric wrong construction could pass after a swap even though the design forbids that inference.

**Correction:** Add an immutable observed axis registration linked to each structure capture: selvedge/physical warp indicator or qualified operator registration, provenance, image coordinates and orientation transform. Missing or ambiguous registration must block named-axis automation. T01 owns the schema and T04 validates/transforms it; never choose assignment by closeness to PO targets.

**Test assertion:** The same asymmetric registered swatch at 0/90/180 degrees yields the same physically named ends/picks after coordinate transformation; absent registration or ambiguous cut swatch yields review regardless of which assignment meets the PO.

## P1 — Contract cannot reconstruct or validate the proposed measurement lineage

**Evidence:** Design line 106 requires retained homography, crop, pixel-to-mm Jacobian and calibrated profile details. The authoritative types at lines 64–79 expose only calibration/profile IDs, reference ID, method version, capture list and one stage artifact hash. They define no immutable calibration/reference record, calibration hash, per-measurement capture/ROI mapping, transform or uncertainty-budget binding. T01 only names PurchaseSpec parsing/normalization (plan lines 48–54); T04 introduces undefined `CalibrationProfile`/`ScaleReference` (86). Existing `marker.py:26–31,98–103` returns cropped pixels, scalar ppi and boxes but discards H, source corners and local geometry. Therefore reusing this return value cannot fulfill line 106.

**Consequence:** With multiple structure/scale images, a stored interval cannot be tied unambiguously to the measured pixels or independently checked against the calibration effective for that capture. A stage artifact hash alone does not identify which calibration, ROI or uncertainty inputs it represents.

**Correction:** Make T01 define immutable hashed calibration/reference and measurement-lineage records (inline or a specified content-addressed artifact). Bind each measurement to capture hash, source ROI, orientation/rectification transform, calibration hash, reference dimensions/uncertainty and uncertainty-model version/input report. Extend the primitive or owning QC adapter to retain geometry; do not silently change legacy v1 wire behavior.

**Test assertion:** Round-trip fixtures preserve the full lineage across Python/TS/Swift; changing any referenced capture, calibration, ROI or transform invalidates evidence binding. Two structure captures cannot satisfy an axis measurement with an unrelated scale-only image. Replay resolves the exact original calibration version after subsequent recalibration.

## P1 — Resolution gate does not distinguish source sampling from rectified output pixels

**Evidence:** Design lines 106–110 correctly require distortion validation and reject reliance on Nyquist/2.5 pixels alone, but T04's assertions (plan line 88) do not require local pre-resampling directional resolution. Existing `marker.py:66–83,100` sets output scale from mean marker edge length, then interpolates the whole plane. `MAX_STRETCH` at lines 22–23,79 bounds total output area, not worst local directional magnification at the measurement ROI. `threads.py:106–116` tests scalar ppi against period; it has no source-footprint or anisotropy input. Homography fitting exactly four marker corners also supplies no independent residual check of off-marker scale.

**Consequence:** Upsampled distant fabric can appear to have adequate pixels per thread in the rectified image even when the original camera samples do not resolve it. A small fit residual at the marker does not establish accuracy elsewhere in a distorted image.

**Correction:** T04 must assess source-pixel support along both registered thread directions over the actual ROI, using the calibrated distortion model and inverse mapping/Jacobian. Pin validated limits on worst-case source period, anisotropy and distance from validated field locations in the domain manifest. Evaluate residuals against independent physical references/field checks rather than only the four fitted corners.

**Test assertion:** A perspective image with a sharp, sufficiently sampled marker but under-resolved far-side fabric abstains even if rectification increases its apparent pixel period. Pure digital upsampling never changes a failed resolution gate into OK. Off-marker field references expose deliberately injected distortion that leaves marker corners fitted.

## P2 — Estimator agreement proof could reuse the same harmonic error

**Evidence:** Design line 108 asks for FFT versus spatial autocorrelation/manual peak evidence and rejection of disagreement. T04 line 88 lists harmonic challenges but does not define a second-evidence acceptance assertion. Existing `threads.py:63–76,141–143` band-passes the spatial count around the FFT frequency and falls back to that same FFT estimate when the count disagrees by 15% or is unavailable. This is not independent confirmation; autocorrelation alone can also repeat the same printed-grid harmonic. Existing thread tests primarily render synthetic optical fabric.

**Correction:** State explicitly that `_count`/FFT fallback is one estimator, not cross-method confirmation. T04 should record competing peak/harmonic hypotheses and require validated physical yarn-boundary evidence or abstention when fundamental identity is unresolved. Keep blinded pick-glass comparison as external reference, not PO-target-guided harmonic selection.

**Test assertion:** Printed stripes and half/double-frequency challenges that generate internally agreeing FFT and band-pass counts still abstain when yarn identity is unsupported; conflicting independent evidence cannot silently fall back to the FFT and yield Stage OK.

## Authority and completion boundary

G3's physical hardware/reference, repeatability and metrology-lead approval remain external gates, as do G2's tolerances and G7's independent acceptance-risk evidence. The provisional 5%/10% error goals and nominal 95% intervals are explicitly research targets; software fixtures cannot authorize them. The existing plan correctly excludes EXIF/form dpi authority, tile-IQR-as-uncertainty, knit automation without validation and arrival-image shrink; preserve those boundaries while resolving the findings above. No draft/product file was modified; only this review was created.
