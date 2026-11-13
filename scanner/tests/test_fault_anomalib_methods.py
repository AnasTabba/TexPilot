"""Tests for the anomalib PatchCore and Reverse Distillation wrappers.

anomalib is not installed locally; tests that need it are skipped here and run on Kaggle.
"""

from __future__ import annotations

import numpy as np
import pytest
import torch

from training.fault.methods import anomalib_methods as am


def _tiles(n: int) -> list[np.ndarray]:
    return [np.full((392, 392, 3), i, dtype=np.uint8) for i in range(n)]


def test_module_imports_without_anomalib() -> None:
    assert am.PatchCore.name == "patchcore"
    assert am.ReverseDistillation.name == "reverse_distillation"
    # Construction must not touch anomalib.
    am.PatchCore(max_train_tiles=4)
    am.ReverseDistillation(epochs=1)


def test_subsample_respects_max_and_is_seeded() -> None:
    tiles = _tiles(50)
    first = am._subsample(tiles, 10, seed=2026)
    second = am._subsample(tiles, 10, seed=2026)
    assert len(first) == 10
    ids = [int(t[0, 0, 0]) for t in first]
    assert ids == [int(t[0, 0, 0]) for t in second]
    assert len(set(ids)) == 10  # sampled without replacement
    assert am._subsample(tiles, 50, seed=2026) is tiles
    assert len(am._subsample(tiles, 100, seed=2026)) == 50


def test_tile_to_chw_gives_float_chw_in_unit_range() -> None:
    tile = np.random.default_rng(0).integers(0, 256, size=(392, 392, 3), dtype=np.uint8)
    x = am._tile_to_chw(tile)
    assert x.shape == (3, 392, 392)
    assert x.dtype == torch.float32
    assert float(x.min()) >= 0.0
    assert float(x.max()) <= 1.0
    assert torch.allclose(x[0, 0, 0], torch.tensor(float(tile[0, 0, 0]) / 255.0))


def test_tile_to_chw_rejects_wrong_shape() -> None:
    with pytest.raises(ValueError, match="392"):
        am._tile_to_chw(np.zeros((256, 256, 3), dtype=np.uint8))


def test_score_before_fit_raises() -> None:
    with pytest.raises(RuntimeError, match="fit"):
        am.PatchCore().score_tiles(_tiles(1))
    with pytest.raises(RuntimeError, match="fit"):
        am.ReverseDistillation().score_tiles(_tiles(1))


def test_patchcore_fit_and_score_on_kaggle() -> None:
    pytest.importorskip("anomalib")
    method = am.PatchCore(max_train_tiles=4, batch_size=2, device="cpu")
    method.fit(_tiles(4))
    maps = method.score_tiles(_tiles(3))
    assert len(maps) == 3
    for m in maps:
        assert m.shape == (392, 392)
        assert m.dtype == np.float32


def test_reverse_distillation_fit_and_score_on_kaggle() -> None:
    pytest.importorskip("anomalib")
    method = am.ReverseDistillation(epochs=1, batch_size=2, device="cpu")
    method.fit(_tiles(4))
    maps = method.score_tiles(_tiles(3))
    assert len(maps) == 3
    for m in maps:
        assert m.shape == (392, 392)
        assert m.dtype == np.float32


def test_score_normalizes_once_and_preserves_raw_map_scale():
    from types import SimpleNamespace

    class Net(torch.nn.Module):
        def forward(self, x):
            expected = torch.tensor(am.MEAN).view(1, 3, 1, 1)
            std = torch.tensor(am.STD).view(1, 3, 1, 1)
            assert torch.allclose(x, (torch.ones_like(x) - expected) / std)
            return SimpleNamespace(anomaly_map=torch.full((len(x), 1, 8, 8), 7.0))

    maps = am._score(
        Net(),
        [np.full((392, 392, 3), 255, np.uint8)] * 3,
        am._transform(32),
        2,
        torch.device("cpu"),
    )
    assert len(maps) == 3
    assert all(m.shape == (392, 392) and m.dtype == np.float32 for m in maps)
    assert all(np.allclose(m, 7.0) for m in maps)


@pytest.mark.parametrize("kind", [am.PatchCore, am.ReverseDistillation])
def test_fit_seeds_before_constructing_and_passes_device(monkeypatch, kind):
    import sys
    from types import SimpleNamespace

    events = []

    class Model:
        @staticmethod
        def configure_pre_processor(**kwargs):
            return kwargs

        def __init__(self, **kwargs):
            events.append(("model", kwargs))

    monkeypatch.setitem(
        sys.modules, "anomalib.models", SimpleNamespace(Patchcore=Model, ReverseDistillation=Model)
    )
    monkeypatch.setitem(
        sys.modules,
        "lightning",
        SimpleNamespace(seed_everything=lambda seed: events.append(("seed", seed))),
    )
    monkeypatch.setattr(am, "_fit", lambda *args, **kwargs: events.append(("fit", kwargs)))
    kind(device="cpu", seed=123).fit(_tiles(2))
    assert events[0] == ("seed", 123)
    assert events[1][0] == "model"
    assert events[1][1]["post_processor"] is False
    assert events[-1][1]["device"] == torch.device("cpu")


@pytest.mark.parametrize("device", ["cpu", "cuda:1"])
def test_engine_uses_explicit_single_device_without_validation(monkeypatch, device):
    import sys
    from types import SimpleNamespace

    captured = {}

    class Engine:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def fit(self, **kwargs):
            captured["fit"] = kwargs

    monkeypatch.setitem(
        sys.modules,
        "anomalib.data",
        SimpleNamespace(
            ImageItem=lambda **kwargs: kwargs, ImageBatch=SimpleNamespace(collate=lambda x: x)
        ),
    )
    monkeypatch.setitem(sys.modules, "anomalib.engine", SimpleNamespace(Engine=Engine))
    monkeypatch.setitem(
        sys.modules, "lightning", SimpleNamespace(seed_everything=lambda seed: None)
    )
    monkeypatch.setitem(
        sys.modules,
        "lightning.pytorch.strategies",
        SimpleNamespace(SingleDeviceStrategy=lambda **kwargs: kwargs),
    )
    model = torch.nn.Identity()
    am._fit(model, _tiles(2), batch_size=2, max_epochs=1, seed=123, device=torch.device(device))
    assert captured["strategy"] == {"device": torch.device(device)}
    assert captured["accelerator"] == ("gpu" if device.startswith("cuda") else "cpu")
    assert captured["fit"]["model"] is model
    assert set(captured["fit"]) == {"model", "train_dataloaders"}
    assert len(next(iter(captured["fit"]["train_dataloaders"]))) == 2
