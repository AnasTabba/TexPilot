"""QC v2 capture quality: can these photographs be evidence at all? (design §6)

Two honest modes:

* With a validated threshold artifact (named by the domain manifest, loaded by hash) every one
  of the seven pinned checks is evaluated and the stage is OK, pass or fail.
* Without one -- the state of this repository until capture profiles are physically validated
  (gate G3) -- the engineering heuristics still run so the operator hears "this is blurred",
  but the stage is ABSTAINED: a check nobody validated is never reported as passed.

The numbers in ``ENGINEERING`` are starting points taken from v1 (``quality.py``), not
calibrated acquisition thresholds.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from services.api.qc_schemas import QUALITY_CHECKS, QualityChecks, QualityValue, Stage

QUALITY_VERSION = "qc-quality-1"
#: Unvalidated engineering constants, used only to give recapture hints while abstaining.
ENGINEERING = {
    "blur_min_laplacian_var": 60.0,
    "glare_max_clipped": 0.05,
    "dark_max_clipped": 0.05,
    "min_short_side_px": 1200,
    "marker_max_stretch": 1.35,
    "framing_min_texture_fill": 0.9,
    "moire_max_ratio": 5.0,
    "fold_max_shading": 0.25,
}
#: Every key a validated threshold artifact must carry; a missing one abstains.
THRESHOLD_KEYS = (
    "blur_min_laplacian_var",
    "glare_max_clipped",
    "dark_max_clipped",
    "min_short_side_px",
    "marker_max_stretch",
    "framing_min_texture_fill",
    "moire_max_ratio",
    "fold_max_shading",
)
#: Roles whose view must show the scale marker.
MARKER_ROLES = ("scale",)
_REASON = {
    "blur": "QUALITY_BLUR",
    "glare": "QUALITY_GLARE",
    "moire": "QUALITY_MOIRE",
    "fold": "QUALITY_FOLD",
    "framing": "QUALITY_FRAMING",
    "resolution": "RESOLUTION_LOW",
}


class ArtifactStore:
    """Validated physical/statistical artifacts, addressed by the SHA-256 of their bytes.

    ``<root>/<sha256>.json``. A file whose bytes do not hash to its name is not that artifact
    and is treated as absent. No root configured means nothing is validated."""

    def __init__(self, root: Path | str | None):
        self.root = Path(root) if root else None

    def load(self, sha256: str | None, kind: str | None = None) -> dict | None:
        if (
            self.root is None
            or not isinstance(sha256, str)
            or len(sha256) != 64
            or not all(c in "0123456789abcdef" for c in sha256)
        ):
            return None
        path = self.root / f"{sha256}.json"
        try:
            with path.open("rb") as stream:
                data = stream.read(1_048_577)
            if len(data) > 1_048_576:
                return None
        except OSError:
            return None
        if hashlib.sha256(data).hexdigest() != sha256:
            return None
        try:
            value = json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except ValueError:
            return None
        if not isinstance(value, dict) or (kind is not None and value.get("kind") != kind):
            return None
        return value

    def load_current(self, sha256: str | None, kind: str, now: str) -> dict | None:
        """Hash identity plus an inclusive validity window; no date means no validation."""
        value = self.load(sha256, kind)
        if value is None:
            return None
        try:
            start, end, instant = (
                datetime.fromisoformat(t.replace("Z", "+00:00"))
                for t in (value["valid_from"], value["expires_at"], now)
            )
            if any(t.tzinfo is None for t in (start, end, instant)) or not start <= instant < end:
                return None
        except (KeyError, TypeError, ValueError):
            return None
        return value


def configured_artifacts() -> ArtifactStore:
    return ArtifactStore(os.environ.get("TEXPILOT_QC_ARTIFACTS"))


def _validated_thresholds(thresholds: dict | None) -> bool:
    if thresholds is None or thresholds.get("method_version") != QUALITY_VERSION:
        return False
    checks = thresholds.get("validated_checks")
    if (
        not isinstance(checks, list)
        or any(not isinstance(k, str) for k in checks)
        or sorted(checks) != sorted(QUALITY_CHECKS)
    ):
        return False
    for k in THRESHOLD_KEYS:
        v = thresholds.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            return False
    return (
        0 <= thresholds["glare_max_clipped"] < 1
        and 0 <= thresholds["dark_max_clipped"] < 1
        and 0 < thresholds["framing_min_texture_fill"] <= 1
        and thresholds["marker_max_stretch"] >= 1
        and thresholds["min_short_side_px"] >= 1
    )


@dataclass(frozen=True)
class QualityView:
    capture_id: str
    role: str
    image: np.ndarray  # upright RGB uint8 original


def _gray(image: np.ndarray) -> np.ndarray:
    import cv2

    return image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)


def measure_view(image: np.ndarray) -> dict[str, float]:
    """Raw quality numbers of one view. No thresholds here."""
    import cv2

    gray = _gray(image)
    h, w = gray.shape
    small = gray
    if w > 512:
        small = cv2.resize(gray, (512, max(1, round(h * 512 / w))), interpolation=cv2.INTER_AREA)
    # Texture fill: share of an 8x8 grid whose cells show any structure (not table or sky).
    gh, gw = small.shape[0] // 8, small.shape[1] // 8
    cells = small[: gh * 8, : gw * 8].reshape(8, gh, 8, gw).astype(np.float32)
    fill = float((cells.std(axis=(1, 3)) > 2.0).mean()) if gh and gw else 0.0
    # Shading: how much the heavily smoothed brightness varies across the frame (a fold or a
    # lamp falling off shows here; flat diffuse light does not).
    coarse = cv2.resize(small, (16, 16), interpolation=cv2.INTER_AREA).astype(np.float32)
    shading = float(coarse.std() / max(float(coarse.mean()), 1.0))
    # Moire: a strong slow beat (period 16-256 px at 512 width) relative to the fine texture.
    moire = 0.0
    for axis in (0, 1):
        p = small.mean(axis).astype(np.float64)
        p = (p - p.mean()) * np.hanning(len(p))
        power = np.abs(np.fft.rfft(p)) ** 2
        f = np.fft.rfftfreq(len(p))
        slow = power[(f >= 1 / 256) & (f <= 1 / 16)]
        fine = power[f > 1 / 16]
        if len(slow) and len(fine) and fine.max() > 0:
            moire = max(moire, float(slow.max() / fine.max()))
    return {
        "laplacian_var": float(cv2.Laplacian(small, cv2.CV_64F).var()),
        "clipped_bright": float((gray >= 250).mean()),
        "clipped_dark": float((gray <= 5).mean()),
        "short_side_px": float(min(h, w)),
        "texture_fill": fill,
        "shading": shading,
        "moire_ratio": moire,
    }


def marker_stretch(image: np.ndarray) -> float | None:
    """Longest / shortest side of the scale marker as photographed (1.0 = square-on), or None
    when the marker is not in the picture."""
    import cv2

    from services.vision.marker import CARD_ID

    gray = np.ascontiguousarray(_gray(image), np.uint8)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    corners, ids, _ = cv2.aruco.ArucoDetector(dictionary).detectMarkers(gray)
    if ids is None or CARD_ID not in ids.ravel():
        return None
    quad = corners[list(ids.ravel()).index(CARD_ID)][0]
    sides = np.linalg.norm(quad - np.roll(quad, -1, 0), axis=1)
    return float(sides.max() / max(float(sides.min()), 1e-6))


def _failures(views: Sequence[QualityView], t: dict, full: bool) -> dict[str, str]:
    """check name -> reason, for every check that failed on any view."""
    failed: dict[str, str] = {}
    for view in views:
        m = measure_view(view.image)
        if m["laplacian_var"] < t["blur_min_laplacian_var"]:
            failed["blur"] = _REASON["blur"]
        # The reason catalogue has no separate under-exposure code; both are lighting faults.
        if (
            m["clipped_bright"] > t["glare_max_clipped"]
            or m["clipped_dark"] > t["dark_max_clipped"]
        ):
            failed["glare"] = _REASON["glare"]
        if m["short_side_px"] < t["min_short_side_px"]:
            failed["resolution"] = _REASON["resolution"]
        if full:
            if m["texture_fill"] < t["framing_min_texture_fill"]:
                failed["framing"] = _REASON["framing"]
            if m["moire_ratio"] > t["moire_max_ratio"]:
                failed["moire"] = _REASON["moire"]
            if m["shading"] > t["fold_max_shading"]:
                failed["fold"] = _REASON["fold"]
    marker_views = [v for v in views if v.role in MARKER_ROLES]
    if not marker_views:
        failed["marker_geometry"] = "SCALE_MISSING"
    for view in marker_views:
        stretch = marker_stretch(view.image)
        if stretch is None:
            failed["marker_geometry"] = "SCALE_MISSING"
        elif stretch > t["marker_max_stretch"]:
            failed.setdefault("marker_geometry", "SCALE_INVALID")
    return failed


def assess_capture_set(
    views: Sequence[QualityView],
    thresholds_sha256: str | None = None,
    artifacts: ArtifactStore | None = None,
    *,
    now: str | None = None,
) -> Stage[QualityValue]:
    """The quality stage for one closed capture set."""
    start = time.perf_counter()

    def done(**kw) -> Stage[QualityValue]:
        return Stage[QualityValue](duration_ms=round(1000 * (time.perf_counter() - start), 1), **kw)

    if not views:
        return done(
            state="NOT_RUN", value=None, reasons=["STAGE_UNAVAILABLE"], artifact_sha256=None
        )
    instant = now or datetime.now(timezone.utc).isoformat()
    thresholds = (artifacts or configured_artifacts()).load_current(
        thresholds_sha256, "qc-quality-thresholds", instant
    )
    validated = _validated_thresholds(thresholds)
    try:
        failed = _failures(views, thresholds if validated else ENGINEERING, full=True)
    except Exception:  # noqa: BLE001 -- a failing heuristic is a failed stage, never a pass
        return done(state="FAILED", value=None, reasons=["STAGE_UNAVAILABLE"], artifact_sha256=None)
    reasons = list(dict.fromkeys(failed.values()))
    if not validated:
        # moire, fold and framing have no validated detector: the stage cannot vouch for them.
        return done(
            state="ABSTAINED",
            value=None,
            reasons=["STAGE_UNAVAILABLE", *reasons],
            artifact_sha256=None,
        )
    checks = QualityChecks(**{name: name not in failed for name in QUALITY_CHECKS})
    return done(
        state="OK",
        value=QualityValue(checks=checks),
        reasons=reasons,
        artifact_sha256=thresholds_sha256,
    )


def assess_qc_quality(
    image: np.ndarray,
    profile=None,  # noqa: ARG001 -- thresholds bind to the domain, not the calibration profile
    *,
    role: str = "structure",
    capture_id: str = "00000000-0000-0000-0000-000000000000",
    thresholds_sha256: str | None = None,
    artifacts: ArtifactStore | None = None,
    now: str | None = None,
) -> Stage[QualityValue]:
    """Plan T04 signature: the quality stage of a single view."""
    return assess_capture_set(
        [QualityView(capture_id, role, image)], thresholds_sha256, artifacts, now=now
    )
