"""An exported probe head (e.g. the fibre head trained on Kaggle) becomes a taught head on Head A's
encoder: same probabilities, its calibrated threshold, keyed by the encoder it was trained on."""

import json

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("safetensors")

from services.vision.custom import load_custom_heads  # noqa: E402
from training.scanner.probe_to_custom import convert  # noqa: E402


def _export(d, mlp=False):
    from safetensors.numpy import save_file

    rng = np.random.default_rng(0)
    w = {"probe.weight": rng.normal(size=(3, 8)), "probe.bias": rng.normal(size=3)}
    if mlp:
        w = {
            "probe.0.weight": rng.normal(size=(4, 8)),
            "probe.0.bias": rng.normal(size=4),
            "probe.3.weight": rng.normal(size=(3, 4)),
            "probe.3.bias": rng.normal(size=3),
        }
    d.mkdir()
    save_file({k: v.astype(np.float32) for k, v in w.items()}, str(d / "probe.safetensors"))
    meta = dict(classes=["cotton", "nylon", "polyester"], timm_name="enc", temperature=2.0,
                threshold=0.6, val={"top1": 0.7, "coverage": 0.5}, test_macro_f1=0.4)  # fmt: skip
    (d / "head.json").write_text(json.dumps(meta))
    return w


def test_a_linear_export_becomes_a_taught_head_with_the_same_calibrated_probabilities(tmp_path):
    w = _export(tmp_path / "export")
    head = convert(tmp_path / "export", "fibre", "enc+lora-1234abcd")
    head.save(tmp_path / "custom")
    (loaded,) = load_custom_heads(tmp_path / "custom", "enc+lora-1234abcd")
    f = np.random.default_rng(1).normal(size=(2, 8)).astype(np.float32)
    z = (f @ w["probe.weight"].T + w["probe.bias"]) / 2.0
    want = (
        np.exp(z - z.max(1, keepdims=True))
        / np.exp(z - z.max(1, keepdims=True)).sum(1, keepdims=True)
    ).mean(0)
    assert loaded.name == "fibre" and loaded.classes == ("cotton", "nylon", "polyester")
    assert np.allclose(loaded.probs(f), want, atol=1e-5) and loaded.threshold == 0.6
    assert load_custom_heads(tmp_path / "custom", "enc") == []  # another encoder never loads it


def test_an_mlp_export_is_refused_because_taught_heads_are_linear(tmp_path):
    _export(tmp_path / "export", mlp=True)
    with pytest.raises(ValueError, match="linear"):
        convert(tmp_path / "export", "fibre", "enc")
