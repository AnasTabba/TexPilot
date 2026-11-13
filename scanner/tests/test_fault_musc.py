"""MuSc wrapper tests. The backbone is never loaded: `_extract` is replaced by random patch features
(tiny config: 12 tiles, 4x4 patches, dim 16), and the real LNAMD + MSM code from the MuSc clone
runs. The clone is taken from MUSC_REPO_DIR, else the scratchpad path; those tests skip without it.
"""

import os
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from training.fault.methods._upstream import upstream_repo  # noqa: E402
from training.fault.methods.musc import MIN_TILES, MuSc, _chunk_bounds  # noqa: E402

REPO_DIR = Path(
    os.environ.get(
        "MUSC_REPO_DIR",
        "/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/"
        "7465821c-727f-422e-b6d5-83704616dd8a/scratchpad/agents/musc-research/MuSc",
    )
)


def _repo_or_skip() -> str:
    if not REPO_DIR.is_dir():
        pytest.skip(f"MuSc clone not found at {REPO_DIR}")
    try:
        with upstream_repo(REPO_DIR):
            import models.modules._LNAMD  # noqa: F401
            import models.modules._MSM  # noqa: F401
    except ImportError as e:
        pytest.skip(f"MuSc repo modules do not import here: {e}")
    return str(REPO_DIR)


def _tile(value: int) -> np.ndarray:
    return np.full((392, 392, 3), value, np.uint8)


def _fake_extract(self, tiles: np.ndarray) -> list[torch.Tensor]:
    """Tiles with mean > 100 get features from one random base, the others from another (+ noise).
    Four layers of (N, 1 + 16 patches, 16 dims), like the real extractor's shape for a 4x4 grid."""
    gen = torch.Generator().manual_seed(0)
    base_a = torch.randn(17, 16, generator=gen)
    base_b = torch.randn(17, 16, generator=gen)
    is_far = torch.from_numpy(tiles.reshape(len(tiles), -1).mean(1) > 100)
    out = []
    for _ in range(4):
        base = torch.where(is_far[:, None, None], base_b, base_a)
        out.append(base + 0.02 * torch.randn(len(tiles), 17, 16, generator=gen))
    return out


def _scorer(monkeypatch) -> MuSc:
    monkeypatch.setattr(MuSc, "_extract", _fake_extract)
    return MuSc(_repo_or_skip(), device="cpu")


def test_twelve_tiles_give_twelve_float32_maps_in_order(monkeypatch):
    tiles = [_tile(40) for _ in range(12)]
    tiles[5] = _tile(200)  # the only "far" tile
    maps = _scorer(monkeypatch).score_tiles(tiles)
    assert len(maps) == 12
    assert all(m.shape == (392, 392) and m.dtype == np.float32 for m in maps)
    assert int(np.argmax([m.max() for m in maps])) == 5


def test_tile_with_far_features_scores_highest(monkeypatch):
    tiles = [_tile(40) for _ in range(12)]
    tiles[9] = _tile(180)
    peaks = [m.max() for m in _scorer(monkeypatch).score_tiles(tiles)]
    assert peaks[9] > max(p for i, p in enumerate(peaks) if i != 9)


def test_fewer_than_eight_tiles_raises():
    with pytest.raises(ValueError, match="at least 8 tiles"):
        MuSc("/nonexistent/musc", device="cpu").score_tiles([_tile(40)] * (MIN_TILES - 1))


def test_chunk_205_is_one_chunk():
    assert _chunk_bounds(205, 200) == [(0, 205)]  # last 5 tiles merged into the previous chunk


def test_chunk_420_gives_200_200_20():
    # At most `chunk` per chunk; the 200+220 split in the task text would break that rule.
    assert _chunk_bounds(420, 200) == [(0, 200), (200, 400), (400, 420)]


@pytest.mark.parametrize("chunk", [0, 1, 3, 7])
def test_chunk_cannot_bypass_reference_minimum(chunk):
    with pytest.raises(ValueError, match="chunk must be at least"):
        MuSc("/unused", chunk=chunk)


def test_zero_features_produce_finite_maps(monkeypatch):
    scorer = _scorer(monkeypatch)
    monkeypatch.setattr(scorer, "_extract", lambda tiles: [torch.zeros(len(tiles), 17, 16)] * 4)
    maps = scorer.score_tiles([_tile(0)] * 8)
    assert np.isfinite(maps).all()
    assert np.asarray(maps).max() == 0


def test_configured_resolution_still_returns_benchmark_tile_maps(monkeypatch):
    scorer = _scorer(monkeypatch)
    scorer.img_size = 224
    assert all(m.shape == (392, 392) for m in scorer.score_tiles([_tile(40)] * 8))


def test_scoring_restores_foreign_models_module(monkeypatch):
    import sys
    import types

    scorer = _scorer(monkeypatch)
    foreign = types.ModuleType("models")
    monkeypatch.setitem(sys.modules, "models", foreign)
    path = sys.path[:]
    scorer.score_tiles([_tile(40)] * 8)
    assert sys.modules["models"] is foreign
    assert sys.path == path


def test_extract_resizes_normalizes_and_keeps_class_tokens(monkeypatch):
    from training.fault.methods.musc import FEATURE_LAYERS

    scorer = MuSc("/unused", img_size=224, device="cpu", batch_size=2)
    scorer._mean = torch.tensor([0.2, 0.3, 0.4]).view(1, 3, 1, 1)
    scorer._std = torch.tensor([0.5, 0.6, 0.7]).view(1, 3, 1, 1)
    seen = []

    class Backbone:
        def encode_image(self, x, layers):
            assert x.shape[1:] == (3, 224, 224)
            assert layers == FEATURE_LAYERS
            expected = (torch.ones_like(x) - scorer._mean) / scorer._std
            assert torch.allclose(x, expected, atol=1e-6)
            seen.append(len(x))
            return None, [torch.ones(len(x), 257, 16)] * 4

    monkeypatch.setattr(scorer, "_backbone", lambda: Backbone())
    features = scorer._extract(np.stack([_tile(255)] * 3))
    assert seen == [2, 1]
    assert all(f.shape == (3, 257, 16) and f.device.type == "cpu" for f in features)
