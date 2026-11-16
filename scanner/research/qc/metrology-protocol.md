# Incoming-fabric metrology protocol — T04a engineering boundary

Status: physical observations, calibration profiles, traceability reports, validation reports,
and sign-off are **not yet collected / external gate G3**. No physical report exists yet.
Synthetic tests establish software behavior only. This document does not approve a device,
threshold, fabric domain, release, or automatic decision. The default workflow is REVIEW_ONLY;
only `services/consistency/qc_policy.py` makes a QC disposition.

## Capture and physical reference collection

Before collecting factory evidence, resolve authorized factory access (G1), tolerances and risk
authority (G2), rights/operational consent (G4), and security/signing authority (G8). Observer
identities, qualifications, sample/roll lists, device profiles, instrument certificates, and
collection dates are not yet collected / external gate G3. Authorized full-text standards and
the factory-selected grading procedure remain external; no standards-compliance claim is made.

Use relaxed, flat fabric and a stable camera, controlled diffuse lighting, locked lens, zoom,
focus, processing and distance. Record what the client can actually observe in
AcquisitionAttestation; an unobserved field stays null. An imported, reencoded or canvas image
cannot qualify through this adapter. EXIF dpi, typed dpi and display size are never scale
references. Retain the raw upload hash, bounded full-resolution original and EXIF-upright
transform. Record every derivative separately; no arrival/1600-pixel shrink is measurement
input. Inspect folds, tension, glare, motion, moire, patterned printing and occlusion.

Verify each physical marker's width and height with a traceable length reference and record
uncertainty, instrument lineage, print scaling and print verification. Keep scale coplanar with
the measurement ROI. Include independent field references away from the fitted marker: fitting
four corners alone supplies no independent homography residual. Challenge off-marker distortion,
near/far perspective, lens changes and resolution loss. Register the physical warp/selvedge or
qualified direction for this exact capture and ROI, independently of PO density. Unresolved
yarn versus printed-pattern identity, either missing axis, or ambiguous registration abstains.

## Blinded pick-glass reference procedure

1. Assign immutable selection, lot, roll, location, face, sample and capture identifiers. Freeze
   the sampling plan, independent roll/group split, allowed domain, analysis protocol and
   exclusion/missingness rules before inspecting results. Preserve missing/excluded selections
   and all recapture attempts; repeated photos are not independent fabric samples.
2. At the same registered physical location, two distinct qualified observers independently use
   a verified pick glass or equivalent traceable length/count method. Record raw yarn counts,
   counted lengths, units, direction, repeat readings, instrument ID and uncertainty. Do not
   present PO targets, scanner counts, other observers' counts or predicted fabric labels.
3. Timestamp and freeze both observers' signed records before model unblinding. Record physical
   ends and picks separately; knits require their own qualified wales/courses procedure. Preserve
   originals and all later adjudication links. An unresolved disagreement is UNDETERMINED,
   never an averaged truth or an operational adjudication substituted for blinded reference.
4. Repeat acquisitions across operators, sessions, distances, allowed focus/lens settings and
   near/far field positions. Separate calibration development rolls from unseen validation
   rolls. Include naturally failed captures and printed stripes/checks, doubled/half harmonics,
   slubs, aliasing and folds as challenges; no synthetic result substitutes for these trials.
5. Freeze detector/quality thresholds and uncertainty components using development data only.
   Evaluate absolute/relative density error, interval coverage, bias, repeat capture and
   inter-operator variation on held-out physical rolls, retaining abstentions and missingness
   in the denominator. Report each axis/domain/device separately and grouped uncertainty.
   Acceptance criteria require G2/G3 authority; design §6 research goals are provisional.
6. Archive the signed physical report, raw observations, hashes, splits, exact code and acquisition
   protocol, uncertainty budget and independent review. No report/signatory/date/approval has
   been supplied. Automation additionally requires the other G1–G8 release gates.

## Guarded software path and artifact contract

Public functions remain `decode_original` (also `decode_qc_image`), `assess_qc_quality`,
`assess_capture_set`, `measure_construction`, and `measure_with_geometry`. The last returns
`MetrologyResult(stage, geometry, uncertainty)` so the service can retain hash-bound geometry
and uncertainty reports. It must retain these reports with the evidence binding; hashes alone
are not a persisted report. Metrology accepts no PO targets. Its `now` is the Worker's injected
UTC evaluation time; omission cannot authorize measurement. Expiry is inclusive (`now >= end`).

`TEXPILOT_QC_ARTIFACTS` names a local, provisioned artifact directory. An explicitly passed
`ArtifactStore` overrides it. Each file is `<sha256>.json`, at most one MiB, and must hash to
its name; a matching name without matching bytes supplies no artifact. JSON constants NaN and
Infinity are invalid. Artifact provisioning/authority is external G3/G8, not conferred by a
`kind`, a hash, or a synthetic test file. No production artifact is included in this repository.

All supporting artifacts require `kind`, `version`, `valid_from`, and `expires_at` and must be
current at the injected clock. The following are internal artifact shapes, not changes to the
frozen wire contract:

- CalibrationProfile and ScaleReference files contain their canonical record payload excluding
  their own `sha256`. The object hash and loaded payload must match the supplied record.
- `qc-metrology-validation` binds `method_version`, `profile_sha256`, `reference_sha256`,
  `quality_thresholds_sha256`, allowed `constructions` and camera `capture_modes`, `zoom_factor`,
  marker and independent `field_marker_ids`, marker stretch/field residual limits, directional
  minimum source support per thread, harmonic rejection, estimator agreement, repeat/tile and
  density search bounds. Search bounds are physically validated operating limits, never PO
  targets. Imported/reencoded/canvas modes cannot be enabled by an artifact.
- `qc-source-resolution` supplies `min_source_px_per_mm` and `max_anisotropy`. The adapter checks
  inverse-map directional source support across ROI probes before rectification; rectification
  uses no finer sampling than the worst source support. Digital upsampling cannot qualify an
  image outside its source profile. Both directions must independently meet the per-yarn bound.
- `qc-distortion-model` supplies `camera_matrix` and `dist_coeffs`. Field marker residuals must
  pass independently of the fitted card. Reference dimensions/uncertainties come only from the
  immutable ScaleReference and its current `qc-reference-traceability` / `qc-print-verification`.
- `qc-processing` supplies the observed `processing` identifier. `qc-lighting-protocol` binds
  the profile's `distance_mm` range. The wire attestation cannot prove distance or lighting;
  verified physical acquisition protocol compliance is therefore still an external G3 gate.
- `qc-axis-registration` is addressed by `AxisRegistration.transform_sha256` and binds
  `capture_id`, `capture_sha256`, normalized `origin_xy`, `direction_xy`, covered `source_roi`,
  both physical `axes`, and qualified `yarn_identity: RESOLVED_UNPRINTED_YARNS`. This evidence
  must come from independent physical registration/inspection; the optical estimators never
  create it. Printed/unknown identity abstains even when FFT and spatial estimates agree.
- `qc-quality-thresholds` binds `method_version: qc-quality-2`, all seven `validated_checks`,
  and every numeric threshold in `qc_quality.THRESHOLD_KEYS`. A missing, expired, nonfinite,
  invalid or partly validated artifact yields ABSTAINED with engineering hints and
  STAGE_UNAVAILABLE. Quality is never silently passed by skipping a check.
- `qc-uncertainty-model` supplies a coverage factor and nonnegative relative components for
  distortion, rectification, estimator bias, repeat capture, inter-operator and reference-count
  effects. The adapter adds physical reference-length and observed tile-spread terms. The
  independence/combination assumptions and actual interval coverage require physical validation;
  a computed interval is not evidence of nominal coverage.

The optical path compares FFT periodicity against unfiltered spatial mean crossings and spatial
autocorrelation. It rejects disagreement rather than averaging or falling back to FFT. Strong
competing half/double or unrelated peaks abstain. Both construction axes must finish; a partial
result carries no numbers. Geometry records marker/field corners, ROI, homographies/inverse,
directional Jacobians, axis registration and transform chain. The uncertainty report binds its
geometry hash; each Measurement binds both report hashes, capture, calibration, registration,
reference and source ROI. Changing a record requires a new hash and re-evaluation.

## Engineering evidence available now

`tests/test_qc_metrology.py` creates NumPy/OpenCV synthetic images and temporary artifacts named
synthetic test doubles, including a registered asymmetric weave at 0/90/180 degrees. It tests
expiry equality, missing/mismatched acquisition metadata/artifacts/axes, printed/harmonic
ambiguity, estimator contradiction, field distortion, source support and upsampling. These are
software regression checks, not blinded physical trials or G3 approval.

`tests/fixtures/qc-images/generate.py` generates real JPEG/PNG/WebP files and the SHA-256 manifest,
including EXIF rotation, a 4032×3024 JPEG, the signature-valid truncated 14-byte JPEG negative,
and a compressed PNG above the pixel limit. The decoder checks the 12 MiB byte / 16 MP pixel
bounds before constructing a raster decoder. The positive files depict synthetic textures.
Physical calibration, error/interval-coverage report and repeatability evidence remain
**not yet collected / external gate G3**.
