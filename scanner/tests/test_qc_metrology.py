"""Synthetic engineering proof only. Every calibration/validation is a test double, not G3."""

from __future__ import annotations

import json
import os

import cv2
import numpy as np
import pytest

from services.api.qc_schemas import (
    AcquisitionAttestation,
    AxisRegistration,
    CalibrationProfile,
    Capture,
    Provenance,
    ScaleReference,
    canonical_json,
    content_sha256,
    sha256_hex,
)
from services.vision import qc_metrology as metrology
from services.vision.qc_quality import ArtifactStore

NOW = "2026-11-13T08:00:00Z"
EXPIRES = "2026-11-14T08:00:00Z"
CID = "11111111-1111-4111-8111-111111111111"


def synthetic_weave(turn=0, *, pattern="weave", markers=True):
    y, x = np.mgrid[:1600, :1600]
    # Asymmetric resolved optical yarn signals, 50.8 ends and 31.75 picks per inch.
    across = 42 * np.cos(2 * np.pi * x / 10)
    along = 36 * np.cos(2 * np.pi * y / 16)
    if pattern == "stripe":
        along = np.zeros_like(along)
    elif pattern == "harmonic":
        across += 36 * np.cos(2 * np.pi * x / 20)
    elif pattern == "weak_third":  # 20 tpi at 0.3 under a dominant 60 tpi third harmonic
        across = 0.3 * 42 * np.cos(2 * np.pi * 20 * x / 508)
        across = across + 42 * np.cos(2 * np.pi * 60 * x / 508 + 0.7)
    elif pattern == "weak_second":  # 25 tpi at 0.3 under a dominant 50 tpi second harmonic
        across = 0.3 * 42 * np.cos(2 * np.pi * 25 * x / 508)
        across = across + 42 * np.cos(2 * np.pi * 50 * x / 508 + 0.7)
    gray = np.clip(128 + across + along, 0, 255).astype(np.uint8)
    if markers:
        dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        for mid, left in ((7, 80), (8, 1280)):
            gray[40:280, left - 40 : left + 200] = 255
            gray[80:240, left : left + 160] = cv2.aruco.generateImageMarker(dictionary, mid, 160)
    return np.ascontiguousarray(np.rot90(np.repeat(gray[..., None], 3, axis=2), turn))


@pytest.fixture
def synthetic_double(tmp_path, monkeypatch):
    monkeypatch.setenv("TEXPILOT_QC_ARTIFACTS", str(tmp_path))

    def put(value):
        data = canonical_json(value).encode()
        sha = sha256_hex(data)
        (tmp_path / f"{sha}.json").write_bytes(data)
        return sha

    def artifact(kind, **values):
        return put(
            {
                "kind": kind,
                "version": "synthetic-test-double-1",
                "valid_from": "2026-11-12T08:00:00Z",
                "expires_at": EXPIRES,
                **values,
            }
        )

    def build(
        turn=0,
        pattern="weave",
        markers=True,
        *,
        component=0.005,
        reference_uncertainty=(0.01, 0.01),
        traceability=None,
        print_check=None,
        **validation_updates,
    ):
        traceability = {"status": "PASSED"} if traceability is None else traceability
        print_check = {"status": "PASSED"} if print_check is None else print_check
        image = synthetic_weave(turn, pattern=pattern, markers=markers)
        image_sha = sha256_hex(image.tobytes())  # synthetic raster binding, not an upload
        processing = artifact("qc-processing", processing="synthetic-unprocessed")
        lighting = artifact("qc-lighting-protocol", distance_mm=[180.0, 220.0])
        distortion = artifact(
            "qc-distortion-model",
            dist_coeffs=[0.0] * 5,
            camera_matrix=[[1000.0, 0.0, 800.0], [0.0, 1000.0, 800.0], [0.0, 0.0, 1.0]],
        )
        limits = artifact("qc-source-resolution", min_source_px_per_mm=10.0, max_anisotropy=1.3)
        uncertainty = artifact(
            "qc-uncertainty-model",
            coverage_factor=1.96,
            components={k: component for k in metrology.UNCERTAINTY_COMPONENTS},
        )
        reference_data = dict(
            id="synthetic-reference-double",
            dimensions_mm=[8.0, 8.0],
            uncertainty_mm=list(reference_uncertainty),
            traceability_report_sha256=artifact("qc-reference-traceability", **traceability),
            print_verification_sha256=artifact("qc-print-verification", **print_check),
        )
        if min(reference_uncertainty) > 0:
            reference = ScaleReference.model_validate(
                {**reference_data, "sha256": put(reference_data)}
            )
        else:  # the schema forbids zero uncertainty; construct it anyway, as a bypass would
            reference = ScaleReference.model_construct(
                **{**reference_data, "sha256": put(reference_data)}
            )
        profile_data = dict(
            id="synthetic-profile-double",
            version="synthetic-test-double-1",
            device_profile_id="synthetic-device-double",
            lens_id="synthetic-lens",
            resolution=[1600, 1600],
            focus_mode="locked",
            distance_mm=[180.0, 220.0],
            lighting_protocol_sha256=lighting,
            processing_sha256=processing,
            distortion_model_sha256=distortion,
            source_resolution_limits_sha256=limits,
            uncertainty_model_sha256=uncertainty,
            reference_ids=[reference.id],
            valid_from="2026-11-12T08:00:00Z",
            expires_at=EXPIRES,
        )
        profile = CalibrationProfile.model_validate({**profile_data, "sha256": put(profile_data)})
        attestation = AcquisitionAttestation(
            image_sha256=image_sha,
            capture_mode="NATIVE_CAMERA",
            device_model="synthetic-device-double",
            lens_id=profile.lens_id,
            zoom_factor=1.0,
            focus_mode="locked",
            exposure_mode="locked",
            resolution=(1600, 1600),
            orientation=1,
            processing="synthetic-unprocessed",
            captured_at=NOW,
        )
        capture = Capture(
            id=CID,
            sample_id=CID,
            capture_set_id=CID,
            original_sha256=image_sha,
            role="structure",
            taken_at=NOW,
            device_profile_id=profile.device_profile_id,
            calibration_id=profile.id,
            width=1600,
            height=1600,
            preprocessing_version="qc-imageio-1",
            consent_record_id=CID,
            byte_size=image.nbytes,
            media_type="image/png",
            original_state="AVAILABLE",
            attestation_sha256=content_sha256(attestation),
        )
        direction = [(0.0, 1.0), (1.0, 0.0), (0.0, -1.0)][turn]
        transform = artifact(
            "qc-axis-registration",
            capture_id=CID,
            capture_sha256=image_sha,
            origin_xy=[0.5, 0.5],
            direction_xy=list(direction),
            source_roi=[0.0, 0.0, 1.0, 1.0],
            axes=["ends", "picks"],
            yarn_identity="RESOLVED_UNPRINTED_YARNS"
            if pattern in ("weave", "weak_third", "weak_second")
            else "PRINTED_OR_AMBIGUOUS",
        )
        axis = AxisRegistration(
            id=CID,
            capture_id=CID,
            capture_sha256=image_sha,
            physical_indicator="QUALIFIED_REGISTRATION",
            origin_xy=(0.5, 0.5),
            direction_xy=direction,
            transform_sha256=transform,
            provenance=Provenance(
                source="PHYSICAL_REFERENCE",
                source_id="synthetic-axis-double",
                source_version="synthetic-test-double-1",
                actor_id="synthetic-observer-double",
                observed_at=NOW,
                image_sha256=image_sha,
            ),
        )
        quality_sha = artifact(
            "qc-quality-thresholds",
            method_version="qc-quality-2",
            validated_checks=[
                "blur",
                "glare",
                "moire",
                "fold",
                "framing",
                "resolution",
                "marker_geometry",
            ],
            blur_min_laplacian_var=60.0,
            glare_max_clipped=0.05,
            dark_max_clipped=0.05,
            min_short_side_px=1200,
            marker_max_stretch=1.35,
            framing_min_texture_fill=0.9,
            moire_max_ratio=0.1,
            fold_max_shading=0.25,
        )
        validation = dict(
            quality_thresholds_sha256=quality_sha,
            constructions=["woven"],
            capture_modes=["NATIVE_CAMERA"],
            zoom_factor=1.0,
            marker_id=7,
            marker_max_stretch=1.3,
            field_marker_ids=[8],
            field_tolerance_rel=0.03,
            min_source_px_per_thread=5.0,
            harmonic_ratio_max=0.15,
            estimator_agreement_rel=0.05,
            tile_spread_max=0.05,
            min_tiles=2,
            min_repeats=8,
            tpi_range=[20.0, 70.0],
            profile_sha256=profile.sha256,
            reference_sha256=reference.sha256,
            method_version=metrology.METHOD_VERSION,
        )
        validation.update(validation_updates)
        kwargs = dict(
            capture=capture,
            attestation=attestation,
            axis_registration=axis,
            construction="woven",
            validation_sha256=artifact("qc-metrology-validation", **validation),
            artifacts=None,
            now=NOW,
        )
        return image, profile, reference, kwargs

    return build, put, artifact


def run(case):
    image, profile, reference, kwargs = case
    return metrology.measure_with_geometry(image, profile, reference, **kwargs)


def assert_abstains(result, reason):
    assert result.stage.state == "ABSTAINED", result.stage
    assert result.stage.value is None and reason in result.stage.reasons
    assert result.geometry is None and result.uncertainty is None


def validation_of(case):
    return ArtifactStore(os.environ["TEXPILOT_QC_ARTIFACTS"]).load(case[3]["validation_sha256"])


def test_no_profile_public_adapter_abstains_without_additional_bindings():
    stage = metrology.measure_construction(synthetic_weave(), None, None)
    assert stage.state == "ABSTAINED" and stage.reasons == ["DOMAIN_UNVALIDATED"]


@pytest.mark.parametrize("turn", [0, 1, 2])
def test_registered_asymmetric_synthetic_weave_preserves_physical_axes(synthetic_double, turn):
    build, _, _ = synthetic_double
    result = run(build(turn))
    assert result.stage.state == "OK", result.stage
    values = {m.axis: m.value for m in result.stage.value}
    assert values == pytest.approx({"ends": 50.8, "picks": 31.75}, rel=0.025)
    for m in result.stage.value:
        assert m.interval95[0] < m.value < m.interval95[1]
        assert m.geometry_artifact_sha256 == sha256_hex(canonical_json(result.geometry))
        assert m.uncertainty_report_sha256 == sha256_hex(canonical_json(result.uncertainty))
    assert result.geometry["source_px_per_mm"]["across"] > 19
    assert "source_jacobians" in result.geometry


@pytest.mark.parametrize(
    "field,value,reason",
    [
        ("lens_id", "other", "DOMAIN_UNVALIDATED"),
        ("lens_id", None, "DOMAIN_UNVALIDATED"),
        ("zoom_factor", 2.0, "DOMAIN_UNVALIDATED"),
        ("zoom_factor", None, "DOMAIN_UNVALIDATED"),
        ("focus_mode", "auto", "DOMAIN_UNVALIDATED"),
        ("focus_mode", None, "DOMAIN_UNVALIDATED"),
        ("resolution", (800, 800), "RESOLUTION_LOW"),
        ("resolution", None, "DOMAIN_UNVALIDATED"),
        ("processing", "reprocessed", "DOMAIN_UNVALIDATED"),
        ("capture_mode", "IMPORTED", "DOMAIN_UNVALIDATED"),
        ("capture_mode", "REENCODED", "DOMAIN_UNVALIDATED"),
        ("capture_mode", "CANVAS", "DOMAIN_UNVALIDATED"),
    ],
)
def test_acquisition_mismatch_or_unobserved_abstains(synthetic_double, field, value, reason):
    build, _, _ = synthetic_double
    case = build()
    case[3]["attestation"] = case[3]["attestation"].model_copy(update={field: value})
    assert_abstains(run(case), reason)


def test_expiry_is_inclusive_at_injected_time(synthetic_double):
    case = synthetic_double[0]()
    case[3]["now"] = EXPIRES
    assert_abstains(run(case), "CALIBRATION_EXPIRED")


@pytest.mark.parametrize("missing", ["profile", "reference", "validation", "axis"])
def test_missing_prerequisite_abstains(synthetic_double, missing):
    image, profile, reference, kwargs = synthetic_double[0]()
    if missing == "profile":
        profile = None
    elif missing == "reference":
        reference = None
    elif missing == "validation":
        kwargs["validation_sha256"] = None
    else:
        kwargs["axis_registration"] = None
    expected = {"reference": "SCALE_MISSING", "axis": "MEASUREMENT_UNCERTAIN"}.get(
        missing, "DOMAIN_UNVALIDATED"
    )
    assert_abstains(run((image, profile, reference, kwargs)), expected)


def test_missing_marker_abstains(synthetic_double):
    assert_abstains(run(synthetic_double[0](markers=False)), "SCALE_MISSING")


@pytest.mark.parametrize("pattern", ["stripe", "harmonic"])
def test_printed_or_harmonic_signals_never_choose_a_density(synthetic_double, pattern):
    assert_abstains(run(synthetic_double[0](pattern=pattern)), "PATTERN_AMBIGUOUS")


def test_half_double_harmonics_are_rejected_even_with_identity_double(synthetic_double):
    case = synthetic_double[0]()
    x = np.arange(2048)
    signal = np.cos(2 * np.pi * x / 10) + 0.8 * np.cos(2 * np.pi * x / 20)
    # Explicit store since the injected directory is discovered by the public adapter.
    import os

    validation = ArtifactStore(os.environ["TEXPILOT_QC_ARTIFACTS"]).load(
        case[3]["validation_sha256"]
    )
    with pytest.raises(metrology._Abstain) as error:
        metrology._estimate(signal, 508.0, validation)
    assert error.value.reasons == ["PATTERN_AMBIGUOUS"]


def test_independent_autocorrelation_disagreement_abstains_no_fft_fallback(
    synthetic_double, monkeypatch
):
    monkeypatch.setattr(metrology, "_autocorrelation_period", lambda *args: 100.0)
    assert_abstains(run(synthetic_double[0]()), "MEASUREMENT_UNCERTAIN")


def test_any_missing_axis_abstains_instead_of_partial_numbers(synthetic_double, monkeypatch):
    original = metrology._estimate
    calls = []

    def missing_axis(*args):
        calls.append(1)
        if len(calls) == 2:
            raise metrology._Abstain("MEASUREMENT_UNCERTAIN")
        return original(*args)

    monkeypatch.setattr(metrology, "_estimate", missing_axis)
    assert_abstains(run(synthetic_double[0]()), "MEASUREMENT_UNCERTAIN")
    assert len(calls) == 2


def test_off_marker_field_distortion_is_rejected(synthetic_double, monkeypatch):
    original = metrology._markers

    def distorted(gray):
        found = original(gray)
        found[8] = found[8].mean(0) + 1.15 * (found[8] - found[8].mean(0))
        return found

    monkeypatch.setattr(metrology, "_markers", distorted)
    assert_abstains(run(synthetic_double[0]()), "SCALE_INVALID")


def test_digital_upsampling_cannot_repair_source_support(synthetic_double):
    case = synthetic_double[0](min_source_px_per_thread=30.0)
    assert_abstains(run(case), "RESOLUTION_LOW")


def test_tampered_artifact_abstains(synthetic_double, tmp_path):
    case = synthetic_double[0]()
    (tmp_path / f"{case[1].uncertainty_model_sha256}.json").write_text("{}")
    assert_abstains(run(case), "DOMAIN_UNVALIDATED")


def test_expired_validation_artifact_abstains(synthetic_double, tmp_path):
    build, put, _ = synthetic_double
    case = build()
    path = tmp_path / f"{case[3]['validation_sha256']}.json"
    data = json.loads(path.read_bytes())
    data["expires_at"] = NOW
    case[3]["validation_sha256"] = put(data)
    assert_abstains(run(case), "DOMAIN_UNVALIDATED")


def test_forbidden_capture_modes_cannot_be_enabled_by_artifact(synthetic_double):
    case = synthetic_double[0](capture_modes=["IMPORTED"])
    case[3]["attestation"] = case[3]["attestation"].model_copy(update={"capture_mode": "IMPORTED"})
    assert_abstains(run(case), "DOMAIN_UNVALIDATED")


@pytest.mark.parametrize(
    "key,bad",
    [
        ("min_source_px_per_thread", -1.0),
        ("estimator_agreement_rel", 2.0),
        ("min_repeats", 0.0),
        ("marker_id", True),
        ("field_marker_ids", [7]),
    ],
)
def test_invalid_validation_double_is_not_an_artifact(synthetic_double, key, bad):
    build, _, _ = synthetic_double
    assert_abstains(run(build(**{key: bad})), "DOMAIN_UNVALIDATED")


def test_changed_reference_dimensions_or_profile_cannot_keep_old_hash(synthetic_double):
    image, profile, reference, kw = synthetic_double[0]()
    assert_abstains(
        run((image, profile, reference.model_copy(update={"dimensions_mm": (9.0, 9.0)}), kw)),
        "DOMAIN_UNVALIDATED",
    )
    assert_abstains(
        run((image, profile.model_copy(update={"lens_id": "changed"}), reference, kw)),
        "DOMAIN_UNVALIDATED",
    )


def test_changed_axis_transform_cannot_keep_registration_hash(synthetic_double):
    case = synthetic_double[0]()
    axis = case[3]["axis_registration"]
    case[3]["axis_registration"] = axis.model_copy(update={"direction_xy": (1.0, 0.0)})
    assert_abstains(run(case), "MEASUREMENT_UNCERTAIN")


def test_unavailable_spatial_count_does_not_fall_back_to_fft(synthetic_double, monkeypatch):
    monkeypatch.setattr(metrology, "_spatial_count", lambda *args: None)
    assert_abstains(run(synthetic_double[0]()), "MEASUREMENT_UNCERTAIN")


def test_far_side_perspective_source_support_cannot_be_repaired_by_rectification(synthetic_double):
    image, profile, reference, kw = synthetic_double[0]()
    h = cv2.getPerspectiveTransform(
        np.float32([[0, 0], [1600, 0], [1600, 1600], [0, 1600]]),
        np.float32([[0, 0], [1600, 0], [1400, 1400], [200, 1400]]),
    )
    perspective = cv2.warpPerspective(image, h, (1600, 1600))
    assert_abstains(run((perspective, profile, reference, kw)), "RESOLUTION_LOW")


def test_real_upsampling_is_outside_source_profile(synthetic_double):
    image, profile, reference, kw = synthetic_double[0]()
    upsampled = cv2.resize(image, (3200, 3200))
    assert_abstains(run((upsampled, profile, reference, kw)), "RESOLUTION_LOW")


@pytest.mark.parametrize("degradation", ["blur", "glare", "fold", "moire"])
def test_degraded_synthetic_source_never_produces_metrology(synthetic_double, degradation):
    image, profile, reference, kw = synthetic_double[0]()
    if degradation == "blur":
        image = cv2.GaussianBlur(image, (0, 0), 12)
    elif degradation == "glare":
        image[600:1200] = 255
    elif degradation == "fold":
        image[400:, :800] = (image[400:, :800] * 0.15).astype(np.uint8)
    else:
        beat = 1 + 0.5 * np.sin(2 * np.pi * np.arange(1600) / 180)
        image[300:] = np.clip(
            128 + (image[300:].astype(float) - 128) * 0.2 + 100 * (beat[None, :, None] - 1), 0, 255
        ).astype(np.uint8)
    result = run((image, profile, reference, kw))
    assert result.stage.state == "ABSTAINED" and result.stage.value is None
    if degradation != "blur":
        assert {"glare": "QUALITY_GLARE", "fold": "QUALITY_FOLD", "moire": "QUALITY_MOIRE"}[
            degradation
        ] in result.stage.reasons


def test_distortion_inverse_maps_geometry_back_to_original_source_pixels():
    camera = np.array([[1000.0, 0.0, 800.0], [0.0, 1000.0, 800.0], [0.0, 0.0, 1.0]])
    coeffs = np.array([0.1, 0.0, 0.0, 0.0, 0.0])
    source = metrology._source_points(np.array([[1200.0, 800.0]]), camera, coeffs)
    # Ideal normalized radius .4: x distortion is x*(1 + .1*.4**2).
    assert source[0] == pytest.approx([1206.4, 800.0])


@pytest.mark.parametrize("harmonic,amp", [(3, 0.1), (3, 0.3), (2, 0.1), (2, 0.3)])
def test_weak_fundamental_under_dominant_harmonic_abstains(synthetic_double, harmonic, amp):
    # Report R05 P0-1: the fundamental sits at 1/harmonic of the dominant peak, below 0.15 power.
    top = {2: 50.0, 3: 60.0}[harmonic]
    x = np.arange(1024, dtype=float)
    tone = lambda tpi, a, ph: a * np.cos(2 * np.pi * tpi / 508.0 * x + ph)  # noqa: E731
    signal = tone(top / harmonic, amp, 0.3) + tone(top, 1.0, 0.7)
    with pytest.raises(metrology._Abstain) as error:
        metrology._estimate(signal, 508.0, validation_of(synthetic_double[0]()))
    assert error.value.reasons == ["PATTERN_AMBIGUOUS"]


@pytest.mark.parametrize("pattern", ["weak_third", "weak_second"])
def test_weak_fundamental_under_dominant_harmonic_never_measures(synthetic_double, pattern):
    assert_abstains(run(synthetic_double[0](pattern=pattern)), "PATTERN_AMBIGUOUS")


@pytest.mark.parametrize("density", [20.0, 25.0, 50.0, 60.0])
def test_pure_grating_at_harmonic_densities_still_measures(synthetic_double, density):
    x = np.arange(1024, dtype=float)
    signal = np.cos(2 * np.pi * density / 508.0 * x + 0.3)
    value, _spread = metrology._estimate(signal, 508.0, validation_of(synthetic_double[0]()))
    assert value == pytest.approx(density, rel=0.005)


def test_zero_model_uncertainty_still_gives_a_real_interval(synthetic_double):
    # Report R05 P1-1: zero components and zero reference uncertainty gave low == high.
    result = run(synthetic_double[0](component=0.0, reference_uncertainty=(0.0, 0.0)))
    assert result.stage.state == "OK", result.stage
    truth = {"ends": 50.8, "picks": 31.75}
    for m in result.stage.value:
        low, high = m.interval95
        assert low < m.value < high
        assert low <= truth[m.axis] <= high


@pytest.mark.parametrize("which", ["traceability", "print_check"])
@pytest.mark.parametrize("status", ["FAILED", "PENDING", None])
def test_failed_or_unstated_reference_verification_abstains(synthetic_double, which, status):
    # Report R05 P1-2: the traceability and print reports were loaded but never read.
    fields = {} if status is None else {"status": status}
    case = synthetic_double[0](**{which: fields})
    assert_abstains(run(case), "DOMAIN_UNVALIDATED")


def test_non_finite_zoom_cannot_pass_the_binding(synthetic_double):
    # Report R05 P2-1: NaN makes the abs(...) > 1e-6 comparison False.
    case = synthetic_double[0]()
    case[3]["attestation"] = case[3]["attestation"].model_copy(
        update={"zoom_factor": float("nan")}
    )
    assert_abstains(run(case), "DOMAIN_UNVALIDATED")
