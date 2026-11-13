"""Dinomaly wrapper: fit/score/save/load on a tiny stand-in model (no weights, CPU, seconds).

Needs the Dinomaly clone: set DINOMALY_REPO to its folder, otherwise tests that use the `repo`
fixture skip. If the repo's `utils` or `optimizers` cannot be imported here (missing skimage or
tabulate), the fixture injects small fakes for them and warns with the ImportError.
"""

import importlib
import os
import sys
import types
import warnings
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
np = pytest.importorskip("numpy")

import torch.nn as nn  # noqa: E402
import torch.nn.functional as F  # noqa: E402

from training.fault.methods.dinomaly import Dinomaly  # noqa: E402

TILE = 392


class Stub(nn.Module):
    """Stand-in for ViTill: frozen 'encoder' features, trainable bottleneck and decoder."""

    def __init__(self) -> None:
        super().__init__()
        self.encoder = nn.Conv2d(3, 8, 3, padding=1)
        self.bottleneck = nn.Conv2d(8, 8, 1)
        self.decoder = nn.Conv2d(8, 8, 1)

    def forward(self, x):
        f = self.encoder(F.avg_pool2d(x, 14)).detach()  # 28x28 feature map
        d = self.decoder(self.bottleneck(f))
        return [f], [d]


def _stub_build(self):
    torch.manual_seed(0)  # same frozen encoder in every instance, so save/load can be compared
    model = Stub()
    trainable = nn.ModuleList([model.bottleneck, model.decoder])
    return model, trainable


def _fake_utils():
    mod = types.ModuleType("utils")

    def global_cosine_hm_percent(a, b, p=0.9, factor=0.0):
        terms = [
            torch.mean(1 - F.cosine_similarity(x.detach(), y, dim=1))
            for x, y in zip(a, b, strict=True)
        ]
        return sum(terms) / len(a)

    def cal_anomaly_maps(fs_list, ft_list, out_size=224):
        maps = [
            F.interpolate(
                (1 - F.cosine_similarity(fs, ft)).unsqueeze(1),
                size=(out_size, out_size),
                mode="bilinear",
                align_corners=True,
            )
            for fs, ft in zip(fs_list, ft_list, strict=True)
        ]
        return torch.cat(maps, dim=1).mean(dim=1, keepdim=True), maps

    def get_gaussian_kernel(kernel_size=3, sigma=2, channels=1):
        return nn.Identity()

    class WarmCosineScheduler(torch.optim.lr_scheduler.LambdaLR):
        def __init__(self, optimizer, base_value, final_value, total_iters, warmup_iters=0):
            super().__init__(optimizer, lambda _: 1.0)

    mod.global_cosine_hm_percent = global_cosine_hm_percent
    mod.cal_anomaly_maps = cal_anomaly_maps
    mod.get_gaussian_kernel = get_gaussian_kernel
    mod.WarmCosineScheduler = WarmCosineScheduler
    return mod


def _fake_optimizers():
    mod = types.ModuleType("optimizers")
    mod.StableAdamW = torch.optim.AdamW
    return mod


@pytest.fixture
def repo(monkeypatch):
    path = os.environ.get("DINOMALY_REPO")
    if not path or not Path(path).is_dir():
        pytest.skip("set DINOMALY_REPO to the Dinomaly clone folder")
    monkeypatch.syspath_prepend(path)
    for name, fake in (("utils", _fake_utils), ("optimizers", _fake_optimizers)):
        try:
            importlib.import_module(name)
        except ImportError as exc:
            warnings.warn(
                f"repo module {name!r} not importable here, using a fake: {exc}", stacklevel=2
            )
            monkeypatch.setitem(sys.modules, name, fake())
    from training.fault.methods._upstream import _MODULES

    monkeypatch.setitem(_MODULES, str(Path(path).resolve()), {
        "utils": sys.modules["utils"], "optimizers": sys.modules["optimizers"]
    })
    monkeypatch.setattr(Dinomaly, "_build", _stub_build)  # tiny stand-in, no weights
    return path


def _tiles(n: int, seed: int = 0) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [rng.integers(0, 256, (TILE, TILE, 3), dtype=np.uint8) for _ in range(n)]


def test_name_from_backbone():
    assert Dinomaly("unused", backbone="dinov2reg_vit_base_14").name == "dinomaly_vitb"
    assert Dinomaly("unused", backbone="dinov2reg_vit_small_14").name == "dinomaly_vits"


def test_fit_changes_trainable_params(repo):
    m = Dinomaly(repo, iters=3, batch_size=2, device="cpu")
    initial = [p.detach().clone() for p in _stub_build(m)[1].parameters()]
    m.fit(_tiles(4))
    assert any(
        not torch.equal(a, b) for a, b in zip(initial, m._trainable.parameters(), strict=True)
    )


def test_score_three_tiles_returns_392_float32_maps(repo):
    m = Dinomaly(repo, iters=3, batch_size=2, device="cpu")
    m.fit(_tiles(4))
    maps = m.score_tiles(_tiles(3, seed=1))
    assert len(maps) == 3
    for a in maps:
        assert isinstance(a, np.ndarray)
        assert a.shape == (TILE, TILE)
        assert a.dtype == np.float32


def test_fewer_tiles_than_batch_size(repo):
    m = Dinomaly(repo, iters=2, batch_size=16, device="cpu")
    m.fit(_tiles(2))
    assert len(m.score_tiles(_tiles(2, seed=2))) == 2


def test_save_then_load_reproduces_maps(repo, tmp_path):
    m = Dinomaly(repo, iters=3, batch_size=2, device="cpu")
    m.fit(_tiles(4))
    tiles = _tiles(2, seed=3)
    expected = m.score_tiles(tiles)
    ckpt = tmp_path / "dinomaly.pt"
    m.save(ckpt)

    other = Dinomaly(repo, iters=3, batch_size=2, device="cpu")
    other.load(ckpt)
    got = other.score_tiles(tiles)
    for a, b in zip(expected, got, strict=True):
        np.testing.assert_allclose(a, b, rtol=1e-6, atol=1e-6)


def test_working_directory_unchanged_after_fit(repo, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    m = Dinomaly(repo, iters=2, batch_size=2, device="cpu")
    m.fit(_tiles(3))
    assert os.getcwd() == str(tmp_path)


def test_non_finite_loss_raises_with_iteration(repo, monkeypatch):
    utils = sys.modules["utils"]
    monkeypatch.setattr(
        utils,
        "global_cosine_hm_percent",
        lambda a, b, p=0.9, factor=0.0: torch.tensor(float("nan"), requires_grad=True),
    )
    m = Dinomaly(repo, iters=3, batch_size=2, device="cpu")
    with pytest.raises(RuntimeError, match="iteration 0"):
        m.fit(_tiles(4))


def test_wrong_tile_shape_rejected(repo):
    m = Dinomaly(repo, iters=2, batch_size=2, device="cpu")
    m.fit(_tiles(2))
    with pytest.raises(ValueError, match="392"):
        m.score_tiles([np.zeros((256, 256, 3), dtype=np.uint8)])


def test_repo_dir_resolved_to_absolute(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert Path(Dinomaly("rel-clone").repo_dir).is_absolute()


def test_fit_and_score_restore_foreign_upstream_modules(monkeypatch, tmp_path):
    from training.fault.methods._upstream import _MODULES

    repo_path = str(tmp_path)
    foreign = types.ModuleType("utils")
    monkeypatch.setitem(sys.modules, "utils", foreign)
    monkeypatch.setitem(_MODULES, repo_path, {
        "utils": _fake_utils(), "optimizers": _fake_optimizers()
    })
    before = sys.path.copy()
    monkeypatch.setattr(Dinomaly, "_build", _stub_build)
    method = Dinomaly(repo_path, iters=1, batch_size=1, device="cpu")
    method.fit(_tiles(1))
    assert sys.modules["utils"] is foreign
    assert sys.path == before
    assert len(method.score_tiles(_tiles(1))) == 1
    assert sys.modules["utils"] is foreign
    assert sys.path == before


def test_amp_keeps_linear_attention_contractions_in_float32(monkeypatch, tmp_path):
    """FP16 unnormalised contractions overflow even when inputs are finite."""
    monkeypatch.setattr(sys, "path", sys.path.copy())
    class Attention(nn.Module):
        def __init__(self, *args, **kwargs):
            super().__init__()

        def forward(self, x, attn_mask=None):
            product = x @ x.transpose(-1, -2)
            return product, product

    class Block(nn.Module):
        def __init__(self, *args, attn, **kwargs):
            super().__init__()
            self.attn = attn()

    def module(name, **attrs):
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, mod)
        return mod

    module("dinov1")
    module("dinov1.utils", trunc_normal_=lambda *args, **kwargs: None)
    module("models.uad", ViTill=lambda **kwargs: nn.ModuleDict({
        "decoder": kwargs["decoder"], "encoder": kwargs["encoder"]
    }))
    module("models.vision_transformer", Block=Block, LinearAttention2=Attention,
           bMlp=lambda *args, **kwargs: nn.Identity())
    encoder = types.SimpleNamespace(load=lambda _: nn.Identity())
    module("models", vit_encoder=encoder)
    from training.fault.methods._upstream import _MODULES

    monkeypatch.setitem(_MODULES, str(tmp_path), {
        name: sys.modules[name] for name in
        ("dinov1", "dinov1.utils", "models", "models.uad", "models.vision_transformer")
    })
    method = Dinomaly(str(tmp_path), amp=True, device="cpu")
    model, _ = method._build()
    x = torch.full((2, 2), 1000.0)
    with torch.autocast("cpu", dtype=torch.float16):
        naive, _ = Attention()(x)
        guarded, _ = model["decoder"][0].attn(x)
    assert not torch.isfinite(naive).all()
    assert guarded.dtype == torch.float32 and torch.isfinite(guarded).all()


def test_fit_failure_restores_foreign_upstream_modules(monkeypatch, tmp_path):
    from training.fault.methods._upstream import _MODULES

    foreign = types.ModuleType("utils")
    monkeypatch.setitem(sys.modules, "utils", foreign)
    monkeypatch.setitem(_MODULES, str(tmp_path), {})
    before = sys.path.copy()
    with pytest.raises(ValueError, match="at least one"):
        Dinomaly(str(tmp_path), device="cpu").fit([])
    assert sys.modules["utils"] is foreign
    assert sys.path == before
