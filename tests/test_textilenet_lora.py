"""LoRA on the ViT attention projections. Skipped where torch or timm is absent (CI core)."""

import pytest

torch = pytest.importorskip("torch")
timm = pytest.importorskip("timm")

from training.textilenet.recipe import add_lora, merge_lora  # noqa: E402


def _vit():
    torch.manual_seed(0)
    return timm.create_model(
        "vit_tiny_patch16_224", pretrained=False, num_classes=3, img_size=32, depth=2
    ).eval()


def test_lora_starts_at_the_pretrained_model_and_trains_only_adapters_and_head():
    model, x = _vit(), torch.randn(2, 3, 32, 32)
    before = model(x)
    assert add_lora(model, rank=4, alpha=4) == 2  # one qkv per block
    assert torch.allclose(model(x), before)  # B starts at zero
    trainable = [n for n, p in model.named_parameters() if p.requires_grad]
    assert trainable and all("lora_" in n or n.startswith("head.") for n in trainable)
    assert any(n.startswith("head.") for n in trainable)


def test_merged_model_matches_the_adapted_one_under_timm_keys():
    model, x = _vit(), torch.randn(2, 3, 32, 32)
    keys = set(model.state_dict())
    add_lora(model, rank=4, alpha=8)
    with torch.no_grad():
        for n, p in model.named_parameters():
            if "lora_b" in n:
                p.normal_()
    adapted = model(x)
    merged = merge_lora(model)
    assert set(merged.state_dict()) == keys  # loads into a plain timm model for serving
    assert torch.allclose(merged(x), adapted, atol=1e-5)
    assert not torch.allclose(_vit()(x), adapted)  # the adapters did change the output
