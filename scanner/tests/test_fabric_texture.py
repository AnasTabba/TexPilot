"""Look-alike fabric texture features: centre+corner crops, patch pooling, and the nearest-patch
memory. Synthetic arrays only; no model or dataset needed."""

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")

from training.fabric_texture.features import crops, pool_tokens  # noqa: E402
from training.fabric_texture.heads import PatchMemory  # noqa: E402


def test_crops_five_native_scale():
    img = np.arange(500 * 600 * 3, dtype=np.uint32).reshape(500, 600, 3) % 251
    img = img.astype(np.uint8)
    out = crops(img)
    assert len(out) == 5
    for c in out:
        assert c.shape == (392, 392, 3)
        assert c.dtype == np.uint8
    # first crop is the centre, last is bottom-right corner, both at native scale
    assert np.array_equal(out[-1], img[500 - 392 :, 600 - 392 :])
    assert np.array_equal(out[0], img[54:446, 104:496])


def test_crops_small_image_resized_up():
    img = np.full((100, 300, 3), 128, dtype=np.uint8)
    out = crops(img)
    assert len(out) == 5
    assert all(c.shape == (392, 392, 3) and c.dtype == np.uint8 for c in out)


def test_pool_tokens_batch_and_2d():
    tokens = torch.randn(2, 10, 8)
    pooled = pool_tokens(tokens)
    assert pooled.shape == (2, 24)
    single = pool_tokens(tokens[0])
    assert single.shape == (24,)
    assert torch.allclose(single, pooled[0], atol=1e-6)


def test_patch_memory_nearest_cluster():
    rng = np.random.default_rng(0)
    a = np.zeros((300, 16), np.float32)
    a[:, 0] = 1.0
    a += rng.normal(0, 0.01, a.shape).astype(np.float32)
    b = np.zeros((300, 16), np.float32)
    b[:, 1] = 1.0
    b += rng.normal(0, 0.01, b.shape).astype(np.float32)
    mem = PatchMemory()
    mem.fit({"B": b, "A": a}, per_class=100)
    assert mem.classes == ["A", "B"]
    query = np.zeros((5, 16), np.float32)
    query[:, 0] = 1.0
    scores = mem.scores(query)
    assert scores.shape == (2,)
    assert scores[0] < scores[1]


def test_patch_memory_deterministic_for_seed():
    rng = np.random.default_rng(1)
    feats = {"x": rng.normal(size=(500, 12)), "y": rng.normal(size=(400, 12))}
    query = rng.normal(size=(30, 12))
    s1 = PatchMemory()
    s1.fit(feats, per_class=50, seed=2026)
    s2 = PatchMemory()
    s2.fit(feats, per_class=50, seed=2026)
    assert np.array_equal(s1.scores(query), s2.scores(query))
