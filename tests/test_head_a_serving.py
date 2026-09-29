"""A fine-tuned Head A served from a scanner bundle. A tiny untrained timm model; no downloads."""

import json

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")
pytest.importorskip("timm")
pytest.importorskip("safetensors")

from services.vision.heads import (  # noqa: E402
    FineTunedHead,
    decide,
    load_structure_model,
    timm_classifier,
)

CLASSES = ("canvas", "denim", "lace")
CPU = torch.device("cpu")


def _head_dir(root, threshold):
    from safetensors.torch import save_file

    d = root / "head_a"
    d.mkdir()
    save_file(
        timm_classifier("resnet10t", len(CLASSES), 64).state_dict(), str(d / "model.safetensors")
    )
    head = {
        "classes": list(CLASSES),
        "timm_name": "resnet10t",
        "img_size": 64,
        "crop_pct": 0.875,
        "mean": [0.5] * 3,
        "std": [0.5] * 3,
        "temperature": 1.5,
        "threshold": threshold,
    }
    (d / "head.json").write_text(json.dumps(head))
    return d


def test_decide_answers_above_the_threshold_and_abstains_below():
    probs = np.array([0.1, 0.7, 0.2])
    out = decide(probs, CLASSES, 0.6)
    assert (out.label, round(out.confidence, 2), out.topk[0][0]) == ("denim", 0.7, "denim")
    assert decide(probs, CLASSES, 0.8) is None


def test_a_fine_tuned_head_answers_with_calibrated_probabilities(tmp_path):
    head = FineTunedHead(_head_dir(tmp_path, 0.0), CPU)
    views = [np.full((80, 100, 3), 128, np.uint8), np.zeros((90, 90, 3), np.uint8)]
    out = head.predict(views)
    assert out.label in CLASSES and 0 < out.confidence <= 1 and len(out.topk) == 3


def test_a_fine_tuned_head_abstains_below_its_threshold(tmp_path):
    head = FineTunedHead(_head_dir(tmp_path, 1.01), CPU)
    assert head.predict([np.zeros((64, 64, 3), np.uint8)]) is None


def test_a_bundle_names_its_structure_model_or_keeps_the_linear_head(tmp_path):
    _head_dir(tmp_path, 0.5)
    assert load_structure_model(tmp_path, {"version": 1}, CPU) is None
    head = load_structure_model(tmp_path, {"structure_model": {"dir": "head_a"}}, CPU)
    assert isinstance(head, FineTunedHead) and head.classes == CLASSES
