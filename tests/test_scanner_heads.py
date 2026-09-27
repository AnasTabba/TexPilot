"""Calibrated heads and the bundle format (spec §6). Skipped without numpy/safetensors."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("safetensors")

from services.vision.heads import HeadSpec, apply_head, load_bundle, save_bundle  # noqa: E402


def _spec(threshold=0.5, temperature=1.0):
    # Two features, three classes; feature 0 votes for "a", feature 1 for "b".
    w = np.array([[4.0, 0.0], [0.0, 4.0], [0.0, 0.0]], np.float32)
    return HeadSpec(("a", "b", "c"), w, np.zeros(3, np.float32), temperature, threshold)


def test_confident_prediction_with_sorted_topk():
    out = apply_head(np.array([[1.0, 0.0]], np.float32), _spec())
    assert out.label == "a" and out.confidence > 0.9
    assert [c for c, _ in out.topk] == ["a", "b", "c"]


def test_below_threshold_returns_none_not_a_guess():
    assert apply_head(np.array([[1.0, 0.0]], np.float32), _spec(threshold=0.999)) is None


def test_temperature_softens_confidence():
    f = np.array([[1.0, 0.0]], np.float32)
    assert apply_head(f, _spec(temperature=4.0)).confidence < apply_head(f, _spec()).confidence


def test_views_are_averaged():
    both = np.array([[1.0, 0.0], [0.0, 1.0]], np.float32)  # views disagree evenly
    assert apply_head(both, _spec(threshold=0.6)) is None


def test_bundle_round_trip(tmp_path):
    meta = {
        "version": 3,
        "backbone": {
            "timm_name": "x",
            "img_size": 224,
            "crop_pct": 0.875,
            "mean": [0.5] * 3,
            "std": [0.2] * 3,
        },
    }
    save_bundle(tmp_path, meta, {"structure": _spec(threshold=0.7, temperature=1.5)})
    meta2, specs = load_bundle(tmp_path)
    assert meta2["version"] == 3
    s = specs["structure"]
    assert s.classes == ("a", "b", "c") and s.threshold == 0.7 and s.temperature == 1.5
    assert np.array_equal(s.weight, _spec().weight)
