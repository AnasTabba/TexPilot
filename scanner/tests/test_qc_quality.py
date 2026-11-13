"""QC v2 quality stage: real detections, and no unvalidated check ever reported as passed."""

from __future__ import annotations

import hashlib
import json

import cv2
import numpy as np
import pytest

from services.api.qc_schemas import QUALITY_CHECKS
from services.vision.marker import CARD_ID
from services.vision.qc_quality import (
    THRESHOLD_KEYS,
    ArtifactStore,
    QualityView,
    assess_capture_set,
    assess_qc_quality,
    marker_stretch,
)
from tests.fabric_sim import render

CID = "11111111-1111-4111-8111-111111111111"


def fabric(size=1600, **kw) -> np.ndarray:
    g = render("plain", 60, 50, 400, size=size, **kw)
    return np.stack([g, g, g], -1)


def with_marker(img: np.ndarray, side=160, at=(100, 100)) -> np.ndarray:
    out = img.copy()
    m = cv2.aruco.generateImageMarker(
        cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), CARD_ID, side
    )
    pad = side // 4
    y, x = at
    out[y - pad : y + side + pad, x - pad : x + side + pad] = 255
    out[y : y + side, x : x + side] = m[..., None]
    return out


def put(tmp_path, value: dict) -> str:
    data = json.dumps(value).encode()
    sha = hashlib.sha256(data).hexdigest()
    (tmp_path / f"{sha}.json").write_bytes(data)
    return sha


THRESHOLD_DOUBLE = {
    "kind": "qc-quality-thresholds",
    "version": "test-double-1",
    "method_version": "qc-quality-1",
    "valid_from": "2000-01-01T00:00:00Z",
    "expires_at": "2099-01-01T00:00:00Z",
    "validated_checks": list(QUALITY_CHECKS),
    "blur_min_laplacian_var": 60.0,
    "glare_max_clipped": 0.05,
    "dark_max_clipped": 0.05,
    "min_short_side_px": 1200,
    "marker_max_stretch": 1.35,
    "framing_min_texture_fill": 0.9,
    "moire_max_ratio": 5.0,
    "fold_max_shading": 0.25,
}


def good_views():
    return [
        QualityView(CID, "structure", fabric()),
        QualityView(CID, "scale", with_marker(fabric())),
    ]


def test_without_a_validated_artifact_the_stage_abstains_even_on_a_clean_capture():
    s = assess_capture_set(good_views())
    assert s.state == "ABSTAINED" and s.value is None and s.artifact_sha256 is None
    assert s.reasons == ["STAGE_UNAVAILABLE"]  # nothing detected, and nothing vouched for


def test_engineering_hints_name_what_to_fix_while_still_abstaining():
    blurred = cv2.GaussianBlur(fabric(), (0, 0), 12)
    glare = fabric()
    glare[:700] = 255
    small = fabric(size=600)
    cases = {"QUALITY_BLUR": blurred, "QUALITY_GLARE": glare, "RESOLUTION_LOW": small}
    for reason, image in cases.items():
        s = assess_capture_set([QualityView(CID, "structure", image), good_views()[1]])
        assert s.state == "ABSTAINED" and s.value is None
        assert "STAGE_UNAVAILABLE" in s.reasons and reason in s.reasons, reason


def test_underexposure_is_reported_as_a_lighting_fault():
    dark = (fabric() * 0.01).astype(np.uint8)
    s = assess_capture_set([QualityView(CID, "structure", dark), good_views()[1]])
    assert "QUALITY_GLARE" in s.reasons


def test_missing_marker_is_scale_missing_and_a_steep_one_is_scale_invalid():
    no_scale_view = assess_capture_set([QualityView(CID, "structure", fabric())])
    assert "SCALE_MISSING" in no_scale_view.reasons
    no_marker = assess_capture_set([good_views()[0], QualityView(CID, "scale", fabric())])
    assert "SCALE_MISSING" in no_marker.reasons
    img = with_marker(fabric())
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[0, 0], [w, 0], [w * 0.62, h], [w * 0.38, h]])  # strong keystone
    tilted = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h))
    stretch = marker_stretch(tilted)
    assert stretch is not None and stretch > 1.0
    s = assess_capture_set(
        [good_views()[0], QualityView(CID, "scale", tilted)],
    )
    assert ("SCALE_INVALID" in s.reasons) == (stretch > 1.35)
    assert marker_stretch(with_marker(fabric())) == pytest.approx(1.0, abs=0.02)


def test_validated_thresholds_give_an_ok_stage_with_all_seven_checks(tmp_path):
    sha = put(tmp_path, THRESHOLD_DOUBLE)
    s = assess_capture_set(good_views(), sha, ArtifactStore(tmp_path))
    assert s.state == "OK" and s.artifact_sha256 == sha and s.reasons == []
    checks = s.value.checks.model_dump()
    assert set(checks) == set(QUALITY_CHECKS) and all(checks.values())


def test_validated_stage_reports_each_failure_as_a_failed_check(tmp_path):
    sha = put(tmp_path, THRESHOLD_DOUBLE)
    store = ArtifactStore(tmp_path)
    blurred = cv2.GaussianBlur(fabric(), (0, 0), 12)
    s = assess_capture_set([QualityView(CID, "structure", blurred), good_views()[1]], sha, store)
    assert s.state == "OK" and s.value.checks.blur is False and "QUALITY_BLUR" in s.reasons
    # A fold: one half of the swatch in deep shade.
    folded = fabric().astype(np.float32)
    folded[:, :800] *= 0.35
    s = assess_capture_set(
        [QualityView(CID, "structure", folded.astype(np.uint8)), good_views()[1]], sha, store
    )
    assert s.value.checks.fold is False and "QUALITY_FOLD" in s.reasons
    # Moire: a slow strong beat laid over the weave.
    x = np.arange(1600)
    beat = 1 + 0.5 * np.sin(2 * np.pi * x / 180)
    moire = np.clip(fabric().astype(np.float32) * beat[None, :, None], 0, 255).astype(np.uint8)
    s = assess_capture_set([QualityView(CID, "structure", moire), good_views()[1]], sha, store)
    assert s.value.checks.moire is False and "QUALITY_MOIRE" in s.reasons
    # Framing: the swatch fills a corner of an empty table.
    table = np.full((1600, 1600, 3), 128, np.uint8)
    table[:300, :300] = fabric()[:300, :300]
    s = assess_capture_set([QualityView(CID, "structure", table), good_views()[1]], sha, store)
    assert s.value.checks.framing is False and "QUALITY_FRAMING" in s.reasons


@pytest.mark.parametrize("missing", THRESHOLD_KEYS)
def test_an_incomplete_threshold_artifact_is_not_validation(tmp_path, missing):
    sha = put(tmp_path, {k: v for k, v in THRESHOLD_DOUBLE.items() if k != missing})
    s = assess_capture_set(good_views(), sha, ArtifactStore(tmp_path))
    assert s.state == "ABSTAINED" and s.value is None


def test_artifacts_are_addressed_by_content_hash_and_kind(tmp_path):
    sha = put(tmp_path, THRESHOLD_DOUBLE)
    store = ArtifactStore(tmp_path)
    assert store.load(sha, "qc-quality-thresholds")["version"] == "test-double-1"
    assert store.load(sha, "something-else") is None
    assert store.load("0" * 64) is None and store.load("../" + sha) is None
    (tmp_path / f"{sha}.json").write_bytes(b'{"kind":"qc-quality-thresholds"}')  # tampered
    assert store.load(sha) is None
    assert ArtifactStore(None).load(sha) is None


def test_no_views_is_not_run_and_single_view_signature_works():
    assert assess_capture_set([]).state == "NOT_RUN"
    s = assess_qc_quality(fabric(), None)
    assert s.state == "ABSTAINED" and "SCALE_MISSING" in s.reasons


def test_a_crashing_heuristic_is_a_failed_stage(monkeypatch):
    from services.vision import qc_quality

    monkeypatch.setattr(qc_quality, "measure_view", lambda image: 1 / 0)
    s = assess_capture_set(good_views())
    assert s.state == "FAILED" and s.value is None and s.reasons == ["STAGE_UNAVAILABLE"]


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1.0])
def test_invalid_numeric_threshold_cannot_make_a_valid_stage(tmp_path, bad):
    sha = put(tmp_path, {**THRESHOLD_DOUBLE, "blur_min_laplacian_var": bad})
    s = assess_capture_set(good_views(), sha, ArtifactStore(tmp_path))
    assert s.state == "ABSTAINED" and "STAGE_UNAVAILABLE" in s.reasons


def test_expired_quality_artifact_cannot_report_checks_passed(tmp_path):
    sha = put(tmp_path, {**THRESHOLD_DOUBLE, "expires_at": "2000-01-01T00:00:00Z"})
    s = assess_capture_set(good_views(), sha, ArtifactStore(tmp_path))
    assert s.state == "ABSTAINED" and s.value is None


def test_missing_individual_check_validation_abstains(tmp_path):
    sha = put(tmp_path, {**THRESHOLD_DOUBLE, "validated_checks": ["blur"]})
    assert assess_capture_set(good_views(), sha, ArtifactStore(tmp_path)).state == "ABSTAINED"


def test_engineering_fold_moire_and_framing_hints_run_without_artifact():
    table = np.full((1600, 1600, 3), 128, np.uint8)
    table[:300, :300] = fabric()[:300, :300]
    s = assess_capture_set([QualityView(CID, "structure", table), good_views()[1]])
    assert s.state == "ABSTAINED" and "QUALITY_FRAMING" in s.reasons


def test_quality_can_discover_artifact_directory_from_environment(tmp_path, monkeypatch):
    sha = put(tmp_path, THRESHOLD_DOUBLE)
    monkeypatch.setenv("TEXPILOT_QC_ARTIFACTS", str(tmp_path))
    assert assess_capture_set(good_views(), sha).state == "OK"
