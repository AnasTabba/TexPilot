"""Choosing and calibrating the fine-tuned Head A (spec §6.3, §10). numpy only."""

import json

import pytest

np = pytest.importorskip("numpy")

from training.scanner.export_head_a import best_run, calibrate  # noqa: E402


def _run(root, name, val_top1, test_top1):
    d = root / name / "seed0"
    d.mkdir(parents=True)
    (d / "best.pt").write_bytes(b"x")
    (d / "test_metrics.json").write_text(
        json.dumps({"best": {"val_top1": val_top1}, "test": {"top1": test_top1}})
    )
    return d


def test_the_run_is_chosen_on_val_never_on_test(tmp_path):
    _run(tmp_path, "convnextv2_base", 0.80, 0.70)
    winner = _run(tmp_path, "dinov2_vitb14", 0.82, 0.60)
    _run(tmp_path, "eva02_base", 0.79, 0.95)  # best on test, which must not matter
    (tmp_path / "vit_tiny" / "seed0").mkdir(parents=True)  # unfinished: no metrics yet
    assert best_run(tmp_path) == winner


def test_no_finished_run_is_a_clear_error(tmp_path):
    with pytest.raises(SystemExit, match="no finished"):
        best_run(tmp_path)


def _logits(n, correct_frac, scale, rng):
    """Overconfident, and less sure when wrong, like a real classifier."""
    y = rng.integers(0, 3, n)
    right = rng.random(n) < correct_frac
    pred = np.where(right, y, (y + 1) % 3)
    margin = np.where(right, scale, scale / 4)[:, None]
    return np.eye(3)[pred] * margin + rng.normal(0, 0.5, (n, 3)), y


def test_calibration_is_fit_on_val_and_reported_on_test():
    rng = np.random.default_rng(0)
    val, test = _logits(2000, 0.85, 8.0, rng), _logits(1000, 0.85, 8.0, rng)
    cal = calibrate(val, test, target=0.90)
    assert cal["temperature"] > 1  # the logits were overconfident
    assert cal["val"]["ece_after"] < cal["val"]["ece_before"]
    assert cal["val"]["accuracy_kept"] >= 0.90 and 0 < cal["val"]["coverage"] < 1
    assert cal["test"]["n"] == 1000 and cal["val"]["n"] == 2000
