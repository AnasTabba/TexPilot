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


def test_a_probe_head_runs_its_linear_layer_on_the_frozen_encoders_pooled_features(
    tmp_path, monkeypatch
):
    from safetensors.numpy import save_file

    from services.vision import heads
    from services.vision.backbone import pool_features, preprocess

    torch.manual_seed(0)
    encoder = timm_classifier("resnet10t", 0, 64)
    monkeypatch.setattr(heads, "timm_classifier", lambda *a, **k: encoder)  # no download
    d = tmp_path / "head_a"
    d.mkdir()
    rng = np.random.default_rng(0)
    w, b = rng.normal(size=(3, encoder.num_features)), rng.normal(size=3)
    save_file(
        {"probe.weight": w.astype(np.float32), "probe.bias": b.astype(np.float32)},
        str(d / "probe.safetensors"),
    )
    meta = dict(classes=list(CLASSES), timm_name="resnet10t", img_size=64, crop_pct=0.875)
    meta |= dict(mean=[0.5] * 3, std=[0.5] * 3, temperature=1.0, threshold=0.0, pool="probe")
    (d / "head.json").write_text(json.dumps(meta))
    head = FineTunedHead(d, CPU)
    view = np.random.default_rng(1).integers(0, 255, (80, 100, 3), dtype=np.uint8)
    x = torch.from_numpy(preprocess(view, meta["mean"], meta["std"], 64, 0.875))[None]
    with torch.no_grad():
        logits = pool_features(encoder.eval(), x).numpy() @ w.T + b
    want = np.exp(logits - logits.max()) / np.exp(logits - logits.max()).sum()
    assert np.allclose(head.probs([view]), want[0], atol=1e-4)


def test_a_head_whose_fp16_output_overflows_reruns_in_fp32(tmp_path):
    head = FineTunedHead(_head_dir(tmp_path, 0.0), CPU)

    class Overflowing(torch.nn.Module):  # e.g. DINOv3 in fp16
        def forward(self, x):
            return (
                torch.full((len(x), 3), float("inf"))
                if x.dtype == torch.float16
                else x[:, 0, 0, :3]
            )

    head.model, head.half = Overflowing(), True
    p = head.probs([np.full((64, 64, 3), 128, np.uint8)])
    assert np.isfinite(p).all() and not head.half
