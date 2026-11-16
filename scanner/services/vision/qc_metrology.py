"""QC v2 construction measurement: thread density with a physical lineage, or an abstention.

A count is produced only when every link is present and current: a calibration profile bound
to how this capture was actually taken, a traceable scale reference, a physical axis
registration, and three validated artifacts (metrology validation, uncertainty model, source
resolution limits) loaded by hash. Anything missing, expired, mismatched or ambiguous
abstains with a reason. Nothing here looks at the purchase-order targets: a harmonic, an axis
or a swap is never chosen because it lands closer to what was ordered (design §6, §15).

None of the artifacts exist until the physical validation of gate G3 is done, so in this
repository the adapter abstains in service; the measurement path is exercised by tests with
synthetic fabric and artifacts that are named as test doubles.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from services.api.qc_schemas import (
    AcquisitionAttestation,
    AxisRegistration,
    CalibrationProfile,
    Capture,
    Measurement,
    ScaleReference,
    Stage,
    canonical_json,
    content_sha256,
    sha256_hex,
)
from services.vision.qc_quality import ArtifactStore, assess_qc_quality, configured_artifacts

METHOD_VERSION = "qc-metrology-1"
#: Cells of the coarse validity grid, in millimetres.
_CELL_MM = 2.0
_MAX_RECT_PIXELS = 40_000_000
#: Analysis window of the 1-D estimator, in samples.
_TILE = 512
#: Power of f/2 or f/3 relative to the chosen peak above which the peak is a harmonic.
_SUBHARMONIC_MAX_RATIO = 0.005

VALIDATION_KEYS = (
    "constructions",
    "capture_modes",
    "zoom_factor",
    "marker_id",
    "marker_max_stretch",
    "field_marker_ids",
    "field_tolerance_rel",
    "min_source_px_per_thread",
    "harmonic_ratio_max",
    "estimator_agreement_rel",
    "tile_spread_max",
    "min_tiles",
    "min_repeats",
    "tpi_range",
    "profile_sha256",
    "reference_sha256",
    "method_version",
    "quality_thresholds_sha256",
)
UNCERTAINTY_COMPONENTS = (
    "distortion_rel",
    "rectification_rel",
    "estimator_bias_rel",
    "repeat_capture_rel",
    "inter_operator_rel",
    "reference_count_rel",
)
_AXES = {"woven": ("ends", "picks"), "knit": ("wales", "courses")}
#: The status value a traceability or print-verification record must carry to be accepted.
_PASSING_STATUS = "PASSED"


class _Abstain(Exception):
    def __init__(self, *reasons: str):
        super().__init__(",".join(reasons))
        self.reasons = list(reasons)


@dataclass(frozen=True)
class MetrologyResult:
    stage: Stage[list[Measurement]]
    #: Original corners, crop, H and inverse, local Jacobians, transform chain. None on abstain.
    geometry: dict | None = None
    uncertainty: dict | None = None


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _number(d: dict, key: str) -> float:
    v = d.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise _Abstain("DOMAIN_UNVALIDATED")
    return float(v)


def _apply(h: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.c_[pts, np.ones(len(pts))] @ h.T
    return p[:, :2] / p[:, 2:3]


def _source_points(points: np.ndarray, camera: np.ndarray, coeffs: np.ndarray) -> np.ndarray:
    """Map undistorted pixels back to actual original source pixels for lineage/support."""
    import cv2

    normalized = _apply(np.linalg.inv(camera), np.asarray(points, np.float64))
    rays = np.c_[normalized, np.ones(len(normalized))]
    distorted, _ = cv2.projectPoints(rays, np.zeros(3), np.zeros(3), camera, coeffs)
    return distorted.reshape(-1, 2)


def _check_binding(profile, reference, capture, attestation, image, validation, now) -> None:
    if not (_time(profile.valid_from) <= _time(now) < _time(profile.expires_at)):
        raise _Abstain("CALIBRATION_EXPIRED")
    if reference.id not in profile.reference_ids:
        raise _Abstain("SCALE_INVALID")
    if (
        capture.calibration_id != profile.id
        or capture.device_profile_id != profile.device_profile_id
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if attestation.image_sha256 != capture.original_sha256:
        raise _Abstain("DOMAIN_UNVALIDATED")
    observed = (
        attestation.lens_id,
        attestation.zoom_factor,
        attestation.focus_mode,
        attestation.resolution,
        attestation.processing,
        attestation.orientation,
    )
    # Something the client could not observe cannot be shown to match the validated profile.
    if any(v is None for v in observed):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if (
        attestation.capture_mode not in ("NATIVE_CAMERA", "WEB_CAMERA")
        or attestation.capture_mode not in validation["capture_modes"]
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if (
        attestation.lens_id != profile.lens_id
        or attestation.focus_mode != profile.focus_mode
        or not math.isfinite(attestation.zoom_factor)
        or abs(attestation.zoom_factor - _number(validation, "zoom_factor")) > 1e-6
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    want = tuple(profile.resolution)
    h, w = image.shape[:2]
    upright = want[::-1] if attestation.orientation in (5, 6, 7, 8) else want
    if (
        tuple(attestation.resolution) != want
        or (w, h) != upright
        or (capture.width, capture.height) != (w, h)
    ):
        raise _Abstain("RESOLUTION_LOW")  # downsampled or cropped outside the profile


def _markers(gray: np.ndarray) -> dict[int, np.ndarray]:
    import cv2

    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    corners, ids, _ = cv2.aruco.ArucoDetector(dictionary, params).detectMarkers(gray)
    found: dict[int, np.ndarray] = {}
    for quad, i in zip(corners, [] if ids is None else ids.ravel(), strict=False):
        if int(i) in found:
            raise _Abstain("SCALE_INVALID")  # the same marker twice: which one is the scale?
        found[int(i)] = quad[0].astype(np.float64)
    return found


def _largest_rect(mask: np.ndarray) -> tuple[int, int, int, int]:
    from services.vision.marker import _largest_rect as rect

    return rect(mask)


def _estimate(profile: np.ndarray, ppi: float, v: dict) -> tuple[float, float]:
    """(threads per inch, relative tile spread) along one rectified profile, or abstain.

    The spectral peak, the counted crossings and the autocorrelation must agree; a strong
    half or double harmonic, or a second unrelated periodicity, is an unresolved identity."""
    from services.vision.threads import _peak_of, _power

    lo, hi = (float(x) for x in v["tpi_range"])
    fmin, fmax = lo / ppi, hi / ppi
    n = len(profile)
    if fmax > 0.4 or n * fmin < _number(v, "min_repeats"):
        raise _Abstain("RESOLUTION_LOW" if fmax > 0.4 else "MEASUREMENT_UNCERTAIN")
    tile = min(_TILE, n)
    tiles = [profile[i : i + tile] for i in range(0, n - tile + 1, max(tile // 2, 1))]
    if len(tiles) < _number(v, "min_tiles"):
        raise _Abstain("MEASUREMENT_UNCERTAIN")
    spectra = [_power(t) for t in tiles]
    total = np.sum(spectra, axis=0)
    f1, p1 = _peak_of(total, fmin, fmax)
    if p1 <= 1e-9 or not math.isfinite(f1) or f1 <= 0:
        raise _Abstain("MEASUREMENT_UNCERTAIN")
    if f1 * n < _number(v, "min_repeats"):
        raise _Abstain("MEASUREMENT_UNCERTAIN")

    # Competing hypotheses: f/2 and 2f (a printed stripe, a doubled yarn, a loop's two legs)
    # and any other periodicity. They are kept as rivals, never resolved by guessing.
    freqs = np.arange(len(total)) / (2 * (len(total) - 1))
    ratio = _number(v, "harmonic_ratio_max")

    def near(f: float) -> float:
        band = (freqs >= f * 0.92) & (freqs <= f * 1.08)
        return float(total[band].max()) if band.any() else 0.0

    family = [f1 / 2, f1 * 2]
    if any(near(f) >= ratio * p1 for f in family if 0 < f < 0.5):
        raise _Abstain("PATTERN_AMBIGUOUS")
    # A weak fundamental under a dominant harmonic sits at f/2 or f/3 of the chosen peak. Clean
    # gratings leave about 1e-4 of the peak there; the weakest such case in R05 is about 0.01.
    if any(near(f) >= _SUBHARMONIC_MAX_RATIO * p1 for f in (f1 / 2, f1 / 3) if 0 < f < 0.5):
        raise _Abstain("PATTERN_AMBIGUOUS")
    other = (freqs >= fmin) & (freqs <= fmax)
    for f in (f1, *family, f1 * 3, f1 / 3):
        other &= ~((freqs >= f * 0.85) & (freqs <= f * 1.15))
    if other.any() and float(total[other].max()) >= ratio * p1:
        raise _Abstain("PATTERN_AMBIGUOUS")

    agree = _number(v, "estimator_agreement_rel")
    counted = _spatial_count(profile)
    if counted is None or abs(counted / f1 - 1) > agree:
        raise _Abstain("MEASUREMENT_UNCERTAIN")
    lag = _autocorrelation_period(profile, 1 / fmax, 1 / fmin)
    if lag is None or abs((1 / lag) / f1 - 1) > agree:
        raise _Abstain("MEASUREMENT_UNCERTAIN")  # no fall-back to the spectrum after a conflict
    per_tile = np.array([_peak_of(s, fmin, fmax)[0] for s in spectra])
    q1, q3 = np.percentile(per_tile, [25, 75])
    spread = float((q3 - q1) / f1)
    if spread > _number(v, "tile_spread_max"):
        raise _Abstain("MEASUREMENT_UNCERTAIN")
    return f1 * ppi, spread


def _spatial_count(profile: np.ndarray) -> float | None:
    """Unfiltered spatial mean crossings, independent of the FFT-selected frequency."""
    x = np.asarray(profile, np.float64) - np.mean(profile)
    rising = np.flatnonzero((x[:-1] < 0) & (x[1:] >= 0))
    if len(rising) < 8:
        return None
    pos = rising + x[rising] / (x[rising] - x[rising + 1])
    return float((len(pos) - 1) / (pos[-1] - pos[0]))


def _autocorrelation_period(profile: np.ndarray, min_lag: float, max_lag: float) -> float | None:
    """The repeat distance in pixels from the spatial autocorrelation: the first prominent
    peak, refined on a later multiple of it."""
    x = profile - profile.mean()
    n = len(x)
    ac = np.fft.irfft(np.abs(np.fft.rfft(x, 2 * n)) ** 2)[:n]
    ac = ac / np.maximum(np.arange(n, 0, -1), 1)  # unbiased by overlap
    if ac[0] <= 0:
        return None
    lo, hi = max(2, int(math.floor(min_lag))), min(n // 3, int(math.ceil(max_lag)) + 1)
    if hi - lo < 3:
        return None
    seg = ac[lo:hi]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] > seg[i + 1]]
    strong = [i for i in peaks if seg[i] >= 0.5 * seg.max() and seg[i] > 0]
    if not strong:
        return None
    first = lo + strong[0]
    m = max(1, min(8, (n // 3) // max(first, 1)))
    centre, half = first * m, max(2, first // 2)
    window = ac[max(1, centre - half) : centre + half + 1]
    k = max(1, centre - half) + int(window.argmax())
    if not 1 <= k < n - 1:
        return None
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) < 0 else 0.0
    return (k + shift) / m


def _validate_numbers(validation: dict, model: dict, limits: dict) -> None:
    """Malformed or permissive thresholds are not physical validation."""
    positive = (
        "zoom_factor",
        "marker_max_stretch",
        "field_tolerance_rel",
        "min_source_px_per_thread",
        "harmonic_ratio_max",
        "estimator_agreement_rel",
        "tile_spread_max",
        "min_tiles",
        "min_repeats",
    )
    if any(_number(validation, k) <= 0 for k in positive):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if (
        validation["marker_max_stretch"] < 1
        or validation["min_source_px_per_thread"] < 3
        or any(
            validation[k] >= 1
            for k in (
                "harmonic_ratio_max",
                "estimator_agreement_rel",
                "tile_spread_max",
                "field_tolerance_rel",
            )
        )
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    marker = validation["marker_id"]
    field = validation["field_marker_ids"]
    if (
        type(marker) is not int
        or not 0 <= marker < 50
        or not isinstance(field, list)
        or not field
        or any(type(i) is not int or not 0 <= i < 50 for i in field)
        or marker in field
        or len(set(field)) != len(field)
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    bounds = validation["tpi_range"]
    if (
        not isinstance(bounds, list)
        or len(bounds) != 2
        or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in bounds
        )
        or not 0 < bounds[0] < bounds[1]
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if _number(limits, "min_source_px_per_mm") <= 0 or _number(limits, "max_anisotropy") < 1:
        raise _Abstain("DOMAIN_UNVALIDATED")
    components = model.get("components")
    if (
        not isinstance(components, dict)
        or any(_number(components, k) < 0 for k in UNCERTAINTY_COMPONENTS)
        or _number(model, "coverage_factor") < 1.96
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")


def _measure(
    image,
    profile,
    reference,
    capture,
    attestation,
    axis,
    construction,
    validation_sha256,
    store,
    now,
) -> MetrologyResult:
    import cv2

    if profile is None:
        raise _Abstain("DOMAIN_UNVALIDATED")
    if now is None:
        raise _Abstain("DOMAIN_UNVALIDATED")  # never replace the Worker's evaluation clock
    if not (_time(profile.valid_from) <= _time(now) < _time(profile.expires_at)):
        raise _Abstain("CALIBRATION_EXPIRED")
    if reference is None:
        raise _Abstain("SCALE_MISSING")
    if capture is None or attestation is None:
        raise _Abstain("DOMAIN_UNVALIDATED")
    validation = store.load_current(validation_sha256, "qc-metrology-validation", now)
    model = store.load_current(profile.uncertainty_model_sha256, "qc-uncertainty-model", now)
    limits = store.load_current(
        profile.source_resolution_limits_sha256, "qc-source-resolution", now
    )
    distortion = store.load_current(profile.distortion_model_sha256, "qc-distortion-model", now)
    processing = store.load_current(profile.processing_sha256, "qc-processing", now)
    lighting = store.load_current(profile.lighting_protocol_sha256, "qc-lighting-protocol", now)
    trace = store.load_current(
        reference.traceability_report_sha256, "qc-reference-traceability", now
    )
    print_check = store.load_current(
        reference.print_verification_sha256, "qc-print-verification", now
    )
    if any(
        a is None
        for a in (validation, model, limits, distortion, processing, lighting, trace, print_check)
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    # The reference's own verdicts must say they passed; loading a record proves only its hash.
    if trace.get("status") != _PASSING_STATUS or print_check.get("status") != _PASSING_STATUS:
        raise _Abstain("DOMAIN_UNVALIDATED")
    # Immutable records themselves are content-addressed; a changed dimension cannot keep its hash.
    for record in (profile, reference):
        payload = record.model_dump(mode="json", exclude={"sha256"})
        if content_sha256(payload) != record.sha256 or store.load(record.sha256) != payload:
            raise _Abstain("DOMAIN_UNVALIDATED")
    if any(k not in validation for k in VALIDATION_KEYS):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if (
        validation["profile_sha256"] != profile.sha256
        or validation["reference_sha256"] != reference.sha256
        or validation["method_version"] != METHOD_VERSION
        or attestation.processing != processing.get("processing")
        or lighting.get("distance_mm") != list(profile.distance_mm)
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    _validate_numbers(validation, model, limits)
    components = model.get("components")
    if construction not in validation["constructions"] or construction not in _AXES:
        raise _Abstain("DOMAIN_UNVALIDATED")
    _check_binding(profile, reference, capture, attestation, image, validation, now)
    if (
        axis is None
        or axis.capture_id != capture.id
        or axis.capture_sha256 != capture.original_sha256
    ):
        raise _Abstain("MEASUREMENT_UNCERTAIN")
    registration = store.load_current(axis.transform_sha256, "qc-axis-registration", now)
    if registration is None or any(
        registration.get(k) != value
        for k, value in (
            ("capture_id", capture.id),
            ("capture_sha256", capture.original_sha256),
            ("origin_xy", list(axis.origin_xy)),
            ("direction_xy", list(axis.direction_xy)),
        )
    ):
        raise _Abstain("MEASUREMENT_UNCERTAIN")
    if registration.get("yarn_identity") != "RESOLVED_UNPRINTED_YARNS" or registration.get(
        "axes"
    ) != list(_AXES[construction]):
        raise _Abstain("PATTERN_AMBIGUOUS")

    quality = assess_qc_quality(
        image,
        profile,
        role="scale",
        capture_id=capture.id,
        thresholds_sha256=validation["quality_thresholds_sha256"],
        artifacts=store,
        now=now,
    )

    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    gray = np.ascontiguousarray(gray, np.uint8)
    coeffs = np.asarray(distortion.get("dist_coeffs", []), np.float64)
    camera = np.asarray(distortion.get("camera_matrix", []), np.float64)
    undistorted = False
    source_valid = np.ones(gray.shape, np.float32)
    if (
        coeffs.size not in (4, 5, 8, 12, 14)
        or camera.shape != (3, 3)
        or not np.isfinite(coeffs).all()
        or not np.isfinite(camera).all()
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    if np.any(coeffs != 0):
        if camera.shape != (3, 3):
            raise _Abstain("DOMAIN_UNVALIDATED")
        gray = cv2.undistort(gray, camera, coeffs)
        source_valid = (cv2.undistort(source_valid, camera, coeffs) > 0.999).astype(np.float32)
        undistorted = True
    h, w = gray.shape

    found = _markers(gray)
    card = found.get(int(validation["marker_id"]))
    if card is None:
        raise _Abstain(*dict.fromkeys(["SCALE_MISSING", *quality.reasons]))
    sides = np.linalg.norm(card - np.roll(card, -1, 0), axis=1)
    if sides.max() / max(sides.min(), 1e-6) > _number(validation, "marker_max_stretch"):
        raise _Abstain("SCALE_INVALID")
    mw, mh = reference.dimensions_mm
    to_mm = cv2.getPerspectiveTransform(
        card.astype(np.float32), np.float32([[0, 0], [mw, 0], [mw, mh], [0, mh]])
    ).astype(np.float64)
    # Independent field reference: other markers of the same printed size, away from the card,
    # must measure true under the card's plane. Distortion the card cannot see shows here.
    field_ids = [int(i) for i in validation["field_marker_ids"]]
    if (
        not field_ids
        or len(set(field_ids)) != len(field_ids)
        or int(validation["marker_id"]) in field_ids
    ):
        raise _Abstain("DOMAIN_UNVALIDATED")
    tolerance = _number(validation, "field_tolerance_rel")
    for fid in field_ids:
        if fid not in found:
            raise _Abstain("SCALE_MISSING")
        q = _apply(to_mm, found[fid])
        measured = np.linalg.norm(q - np.roll(q, -1, 0), axis=1)
        nominal = np.array([mw, mh, mw, mh])
        if np.any(np.abs(measured / nominal - 1) > tolerance):
            raise _Abstain("SCALE_INVALID")

    # Turn the plane so the registered warp direction is vertical. Direction comes from the
    # physical registration only.
    origin = np.array([axis.origin_xy[0] * w, axis.origin_xy[1] * h])
    step = np.array(axis.direction_xy) * 0.02 * max(w, h)
    registered_points = np.array([origin, origin + step])
    if undistorted:
        registered_points = cv2.undistortPoints(
            registered_points.reshape(-1, 1, 2), camera, coeffs, P=camera
        ).reshape(-1, 2)
    a, b = _apply(to_mm, registered_points)
    angle = math.atan2(b[0] - a[0], b[1] - a[1])  # rotate (dx, dy) onto +y
    c, s = math.cos(angle), math.sin(angle)
    rot = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])
    plane = rot @ to_mm  # source pixels -> millimetres, warp vertical
    inv = np.linalg.inv(plane)

    corners = _apply(plane, np.array([[0, 0], [w, 0], [w, h], [0, h]], float))
    (x0, y0), (x1, y1) = corners.min(0), corners.max(0)
    if not np.all(np.isfinite(corners)) or (x1 - x0) * (y1 - y0) <= 0:
        raise _Abstain("SCALE_INVALID")
    coarse = 1.0 / _CELL_MM * 4  # 4 coarse pixels per cell
    size = (int(math.ceil((x1 - x0) * coarse)), int(math.ceil((y1 - y0) * coarse)))
    if size[0] * size[1] > 4_000_000 or min(size) < 8:
        raise _Abstain("SCALE_INVALID")  # a tilt this steep is not a measurement plane
    to_coarse = np.array([[coarse, 0, -x0 * coarse], [0, coarse, -y0 * coarse], [0, 0, 1.0]])
    valid = cv2.warpPerspective(
        source_valid, to_coarse @ plane, size, flags=cv2.INTER_NEAREST
    ).astype(bool)
    for quad in found.values():
        q = _apply(to_coarse @ plane, quad)
        pad = 0.5 * max(mw, mh) * coarse
        qx0, qy0 = np.maximum(np.floor(q.min(0) - pad), 0).astype(int)
        qx1, qy1 = np.ceil(q.max(0) + pad).astype(int)
        valid[qy0:qy1, qx0:qx1] = False
    gh, gw = valid.shape[0] // 4, valid.shape[1] // 4
    cells = valid[: gh * 4, : gw * 4].reshape(gh, 4, gw, 4).all(axis=(1, 3))
    cx0, cy0, cx1, cy1 = _largest_rect(cells)
    if cx1 <= cx0 or cy1 <= cy0:
        raise _Abstain("QUALITY_FRAMING")
    roi_mm = np.array(
        [cx0 * _CELL_MM + x0, cy0 * _CELL_MM + y0, cx1 * _CELL_MM + x0, cy1 * _CELL_MM + y0]
    )

    # Directional source support over the ROI: how many source pixels one millimetre of fabric
    # really has, along and across the warp, at the worst point. Resampling cannot add to it.
    rx0, ry0, rx1, ry1 = roi_mm
    probes = np.array(
        [(x, y) for x in (rx0, (rx0 + rx1) / 2, rx1) for y in (ry0, (ry0 + ry1) / 2, ry1)]
    )

    def source_map(points):
        mapped = _apply(inv, points)
        return _source_points(mapped, camera, coeffs) if undistorted else mapped

    eps = 0.05
    jacobians = np.stack(
        (
            (source_map(probes + (eps, 0)) - source_map(probes - (eps, 0))) / (2 * eps),
            (source_map(probes + (0, eps)) - source_map(probes - (0, eps))) / (2 * eps),
        ),
        axis=2,
    )
    across, along = np.linalg.norm(jacobians, axis=1).T
    support = {"across": float(across.min()), "along": float(along.min())}
    singular = np.linalg.svd(jacobians, compute_uv=False)
    worst, best = float(singular.min()), float(singular.max())
    if not math.isfinite(worst) or worst <= 0:
        raise _Abstain("SCALE_INVALID")
    if worst < _number(limits, "min_source_px_per_mm") or best / worst > _number(
        limits, "max_anisotropy"
    ):
        raise _Abstain("RESOLUTION_LOW")

    if quality.state != "OK" or quality.reasons:
        raise _Abstain(*(quality.reasons or ["STAGE_UNAVAILABLE"]))

    scale = float(worst)  # px per mm of the rectified ROI: never finer than the source
    out = (int((rx1 - rx0) * scale), int((ry1 - ry0) * scale))
    if out[0] < 64 or out[1] < 64 or out[0] * out[1] > _MAX_RECT_PIXELS:
        raise _Abstain("QUALITY_FRAMING" if min(out) < 64 else "SCALE_INVALID")
    to_roi = np.array([[scale, 0, -rx0 * scale], [0, scale, -ry0 * scale], [0, 0, 1.0]]) @ plane
    flat = cv2.warpPerspective(gray, to_roi, out, flags=cv2.INTER_AREA).astype(np.float64)
    ppi = scale * 25.4

    min_px = _number(validation, "min_source_px_per_thread")
    values = {}
    for name, profile_1d, direction in (
        (_AXES[construction][0], flat.mean(0), "across"),
        (_AXES[construction][1], flat.mean(1), "along"),
    ):
        tpi, spread = _estimate(profile_1d, ppi, validation)
        if support[direction] * 25.4 / tpi < min_px:
            raise _Abstain("RESOLUTION_LOW")
        # Half a bin of the analysis window, as a relative half-width: the floor of the interval.
        resolution = 0.5 * ppi / (min(_TILE, len(profile_1d)) * tpi)
        values[name] = (tpi, spread, resolution)

    ref_rel = max(
        u / d for u, d in zip(reference.uncertainty_mm, reference.dimensions_mm, strict=True)
    )
    k = _number(model, "coverage_factor")
    src = np.clip(
        source_map(np.array([[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]], float)) / (w, h),
        0,
        1,
    )
    roi = [
        float(src[:, 0].min()),
        float(src[:, 1].min()),
        float(src[:, 0].max()),
        float(src[:, 1].max()),
    ]
    covered = registration.get("source_roi")
    if (
        not isinstance(covered, list)
        or len(covered) != 4
        or not (
            0 <= covered[0] <= roi[0] < roi[2] <= covered[2] <= 1
            and 0 <= covered[1] <= roi[1] < roi[3] <= covered[3] <= 1
        )
    ):
        raise _Abstain("PATTERN_AMBIGUOUS")
    geometry = {
        "method_version": METHOD_VERSION,
        "capture_id": capture.id,
        "capture_sha256": capture.original_sha256,
        "source_size": [w, h],
        "undistorted": undistorted,
        "marker_corners_px": (_source_points(card, camera, coeffs) if undistorted else card)
        .round(3)
        .tolist(),
        "undistorted_marker_corners_px": card.round(3).tolist(),
        "distortion_model_sha256": profile.distortion_model_sha256,
        "field_marker_corners_px": {
            str(i): (_source_points(found[i], camera, coeffs) if undistorted else found[i])
            .round(3)
            .tolist()
            for i in field_ids
        },
        "homography_px_to_mm": plane.round(9).tolist(),
        "homography_mm_to_px": inv.round(9).tolist(),
        "roi_mm": [round(float(x), 4) for x in roi_mm],
        "source_roi": [round(x, 6) for x in roi],
        "source_px_per_mm": {k_: round(v_, 5) for k_, v_ in support.items()},
        "source_jacobians": [
            {"point_mm": probe.tolist(), "px_per_mm": jacobian.tolist()}
            for probe, jacobian in zip(probes, jacobians, strict=True)
        ],
        "rectified_px_per_mm": round(scale, 5),
        "axis_registration_id": axis.id,
        "axis_transform_sha256": axis.transform_sha256,
        "transform_chain": [
            "exif-upright",
            *(["undistort"] if undistorted else []),
            "marker-plane",
            "axis-rotation",
            "roi-crop",
        ],
    }
    geometry_sha = sha256_hex(canonical_json(geometry))
    measurements, budget = [], {}
    for name, (_tpi, spread, resolution) in values.items():
        parts = {"reference_length_rel": ref_rel, "tile_spread_rel": spread}
        parts |= {c_: _number(components, c_) for c_ in UNCERTAINTY_COMPONENTS}
        combined = k * math.sqrt(sum(v_ * v_ for v_ in parts.values()))
        expanded = max(combined, resolution)  # zero model uncertainty never gives zero width
        if not math.isfinite(expanded) or expanded <= 0:
            raise _Abstain("MEASUREMENT_UNCERTAIN")
        budget[name] = {
            "components": parts,
            "coverage_factor": k,
            "resolution_floor_rel": resolution,
            "expanded_rel": expanded,
        }
    uncertainty = {
        "method_version": METHOD_VERSION,
        "model_sha256": profile.uncertainty_model_sha256,
        "geometry_sha256": geometry_sha,
        "budget": budget,
    }
    uncertainty_sha = sha256_hex(canonical_json(uncertainty))
    for name, (tpi, _spread, _resolution) in values.items():
        u = budget[name]["expanded_rel"]
        measurements.append(
            Measurement(
                capture_id=capture.id,
                capture_sha256=capture.original_sha256,
                source_roi=tuple(roi),
                calibration_sha256=profile.sha256,
                geometry_artifact_sha256=geometry_sha,
                uncertainty_report_sha256=uncertainty_sha,
                axis_registration_id=axis.id,
                axis=name,
                unit="count/in",
                value=tpi,
                interval95=(max(0.0, tpi * (1 - u)), tpi * (1 + u)),
                reference_id=reference.id,
                method_version=METHOD_VERSION,
            )
        )
    stage = Stage[list[Measurement]](
        state="OK",
        value=measurements,
        reasons=[],
        artifact_sha256=validation_sha256,
        duration_ms=0.0,
    )
    return MetrologyResult(stage, geometry, uncertainty)


def limits_or(validation: dict) -> dict:
    return validation


def measure_with_geometry(
    image: np.ndarray,
    profile: CalibrationProfile | None,
    reference: ScaleReference | None,
    *,
    capture: Capture | None = None,
    attestation: AcquisitionAttestation | None = None,
    axis_registration: AxisRegistration | None = None,
    construction: str = "woven",
    validation_sha256: str | None = None,
    artifacts: ArtifactStore | None = None,
    now: str | None = None,
) -> MetrologyResult:
    start = time.perf_counter()

    def stage(state: str, reasons: list[str]) -> MetrologyResult:
        return MetrologyResult(
            Stage[list[Measurement]](
                state=state,
                value=None,
                reasons=reasons,
                artifact_sha256=None,
                duration_ms=round(1000 * (time.perf_counter() - start), 1),
            )
        )

    try:
        result = _measure(
            image, profile, reference, capture, attestation, axis_registration, construction,
            validation_sha256, artifacts or configured_artifacts(), now,
        )  # fmt: skip
    except _Abstain as e:
        return stage("ABSTAINED", e.reasons)
    except Exception:  # noqa: BLE001 -- a crash is a failed stage, never a number
        return stage("FAILED", ["STAGE_UNAVAILABLE"])
    done = result.stage.model_copy(
        update={"duration_ms": round(1000 * (time.perf_counter() - start), 1)}
    )
    return MetrologyResult(done, result.geometry, result.uncertainty)


def measure_construction(
    image: np.ndarray,
    profile: CalibrationProfile | None,
    reference: ScaleReference | None,
    **binding,
) -> Stage[list[Measurement]]:
    """Plan T04 signature. ``binding`` is the keyword set of ``measure_with_geometry``."""
    return measure_with_geometry(image, profile, reference, **binding).stage
