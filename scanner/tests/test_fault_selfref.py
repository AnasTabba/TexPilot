"""Self-reference fault scoring: the patch-similarity math on synthetic tokens, and the
SelfReference wrapper with `_tokens` replaced by a fake. CPU only, no model weights, no timm."""

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("numpy")

from training.fault.methods.selfref import (  # noqa: E402
    GRID,
    TILE,
    SelfReference,
    self_reference_map,
)

D = 8


def _basis(i: int) -> torch.Tensor:
    v = torch.zeros(D)
    v[i] = 1.0
    return v


def _tokens(patches: dict[int, torch.Tensor], background: torch.Tensor, layers: int = 2):
    """(L, P, D) tokens: every patch is `background` unless it is listed in `patches`."""
    t = background.expand(layers, GRID * GRID, D).clone()
    for idx, vec in patches.items():
        t[:, idx, :] = vec
    return t


def _idx(r: int, c: int) -> int:
    return r * GRID + c


def test_odd_patch_is_argmax_with_and_without_normalize():
    odd = _idx(5, 7)
    tokens = _tokens({odd: _basis(1)}, _basis(0))
    for normalize in (True, False):
        m = self_reference_map(tokens, normalize=normalize)
        assert m.shape == (GRID, GRID)
        assert m.dtype == torch.float32
        assert int(torch.argmax(m.flatten())) == odd


def test_block_of_identical_odd_patches_radius_matters():
    block = [_idx(10, 10), _idx(10, 11), _idx(11, 10), _idx(11, 11)]
    isolated = _idx(3, 3)
    tokens = _tokens({**{i: _basis(1) for i in block}, isolated: _basis(2)}, _basis(0))

    r0 = self_reference_map(tokens, k=5, radius=0, normalize=False).flatten()
    r2 = self_reference_map(tokens, k=5, radius=2, normalize=False).flatten()
    background = _idx(20, 20)

    # radius 0: block-mates match each other, so the block scores below an isolated odd patch
    assert r0[block].mean() < r0[isolated] - 0.3
    # radius 2: block-mates are excluded, the block becomes the highest region
    assert r2[block].mean() > r0[block].mean() + 0.3
    assert r2[block].min() > r2[background] + 0.5
    assert r2[background] < 1e-6


def test_normalize_gives_median_zero_on_random_tokens():
    g = torch.Generator().manual_seed(0)
    tokens = torch.randn(2, GRID * GRID, 16, generator=g)
    m = self_reference_map(tokens, normalize=True).flatten()
    assert abs(float(m.median())) < 1e-4


def test_unnormalized_values_are_cosine_distances_in_0_2():
    g = torch.Generator().manual_seed(1)
    tokens = torch.randn(3, GRID * GRID, 16, generator=g)
    m = self_reference_map(tokens, normalize=False)
    assert float(m.min()) >= -1e-6
    assert float(m.max()) <= 2.0 + 1e-6


def test_wrong_token_count_raises():
    with pytest.raises(ValueError):
        self_reference_map(torch.randn(1, GRID * GRID - 1, 8))


def test_radius_leaving_fewer_than_k_candidates_raises():
    # 4x4 grid, radius 3: every patch is within Chebyshev distance 3 of every other patch
    tokens = torch.randn(1, 16, 8)
    with pytest.raises(ValueError):
        self_reference_map(tokens, grid=4, k=1, radius=3)


def test_score_tiles_returns_one_finite_map_per_tile(monkeypatch):
    calls = []

    def fake_tokens(self, x):
        calls.append(tuple(x.shape))
        g = torch.Generator().manual_seed(len(calls))
        return torch.randn(x.shape[0], len(self.layers), GRID * GRID, D, generator=g)

    monkeypatch.setattr(SelfReference, "_tokens", fake_tokens)
    s = SelfReference(device="cpu", batch_size=2)
    rng = np.random.default_rng(0)
    tiles = [rng.integers(0, 256, (TILE, TILE, 3), dtype=np.uint8) for _ in range(3)]
    maps = s.score_tiles(tiles)

    assert len(maps) == 3
    for m in maps:
        assert isinstance(m, np.ndarray)
        assert m.shape == (TILE, TILE)
        assert m.dtype == np.float32
        assert np.isfinite(m).all()
    assert calls == [(2, 3, TILE, TILE), (1, 3, TILE, TILE)]


def test_score_tiles_rejects_wrong_tile_size(monkeypatch):
    monkeypatch.setattr(
        SelfReference, "_tokens", lambda self, x: pytest.fail("encoder must not run")
    )
    s = SelfReference(device="cpu")
    with pytest.raises(ValueError):
        s.score_tiles([np.zeros((391, TILE, 3), np.uint8)])


def test_fit_is_a_noop_and_construction_loads_nothing():
    s = SelfReference(device="cpu")
    assert s._model is None
    assert s.fit([]) is None
    assert s.name == "selfref_vitb"
