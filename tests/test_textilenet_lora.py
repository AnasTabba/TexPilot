"""LoRA on the ViT attention projections. Skipped where torch or timm is absent (CI core)."""

import pytest

torch = pytest.importorskip("torch")
timm = pytest.importorskip("timm")

from training.textilenet.recipe import add_lora, apply_lora, merge_lora  # noqa: E402


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


def test_lora_can_be_limited_to_the_last_blocks():
    model = _vit()
    assert add_lora(model, rank=4, alpha=4, last_blocks=1) == 1
    assert isinstance(model.blocks[0].attn.qkv, torch.nn.Linear)
    assert not any(p.requires_grad for p in model.blocks[0].parameters())


def test_saved_adapters_rebuild_the_merged_weights_from_the_pretrained_ones():
    model = _vit()
    pretrained = {k: v.clone() for k, v in model.state_dict().items()}
    add_lora(model, rank=4, alpha=8)
    with torch.no_grad():
        for n, p in model.named_parameters():
            if "lora_b" in n:
                p.normal_()
    lora = {k: v for k, v in model.state_dict().items() if ".lora_" in k}  # as train.py saves
    merged = merge_lora(model).state_dict()
    rebuilt = apply_lora(pretrained, lora, scale=2.0)
    assert set(rebuilt) == set(merged)
    assert all(torch.allclose(rebuilt[k], merged[k], atol=1e-6) for k in merged)
