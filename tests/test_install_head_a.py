"""Installing a fine-tuned Head A makes a new bundle version; old bundles never change."""

import json

import pytest

from training.scanner.install_head_a import compare, install


def _bundle(root):
    d = root / "scanner-v2"
    d.mkdir()
    structure = {"val": {"top1": 0.706}, "test": {"top1": 0.720}, "coverage_val": 0.489,
                 "ece_val_after": 0.013}  # fmt: skip
    (d / "bundle.json").write_text(json.dumps({"version": 2, "heads": {"structure": structure}}))
    (d / "heads.safetensors").write_bytes(b"linear heads")
    (d / "MODEL_CARD.md").write_text("# scanner-v2\n")
    return d


def _head(root):
    d = root / "head_a"
    d.mkdir()
    (d / "model.safetensors").write_bytes(b"fine-tuned")
    head = {"timm_name": "convnextv2_base.fcmae_ft_in22k_in1k",
            "source_run": "runs/fabric/convnextv2_base/seed1",
            "val": {"top1": 0.781, "coverage": 0.612, "ece_after": 0.011},
            "test": {"top1": 0.790, "n": 40970}}  # fmt: skip
    (d / "head.json").write_text(json.dumps(head))
    return d


def test_install_writes_the_next_bundle_version_and_leaves_the_old_one(tmp_path):
    src, out = _bundle(tmp_path), tmp_path / "scanner-v3"
    install(src, _head(tmp_path), out)
    meta = json.loads((out / "bundle.json").read_text())
    assert meta["version"] == 3
    assert meta["structure_model"] == {
        "dir": "head_a",
        "timm_name": "convnextv2_base.fcmae_ft_in22k_in1k",
        "source_run": "runs/fabric/convnextv2_base/seed1",
    }
    assert (out / "head_a" / "model.safetensors").read_bytes() == b"fine-tuned"
    assert (out / "heads.safetensors").read_bytes() == b"linear heads"  # Head C still needs them
    assert "Head A" in (out / "MODEL_CARD.md").read_text()
    assert json.loads((src / "bundle.json").read_text())["version"] == 2


def test_an_existing_bundle_is_never_overwritten(tmp_path):
    out = tmp_path / "scanner-v3"
    out.mkdir()
    with pytest.raises(SystemExit, match="already exists"):
        install(_bundle(tmp_path), _head(tmp_path), out)


def test_the_two_head_as_are_compared_on_the_same_numbers(tmp_path):
    bundle = json.loads((_bundle(tmp_path) / "bundle.json").read_text())
    head = json.loads((_head(tmp_path) / "head.json").read_text())
    text = "\n".join(compare(bundle, head))
    assert "val top-1" in text and "0.706" in text and "0.781" in text
    assert "coverage" in text and "0.489" in text and "0.612" in text
