"""INP-Former wrapper: stand-in model (no weights, no clone) for fit/score/save/load, plus the
copied anomaly-map maths. Clone tests skip when the INP-Former clone folder is missing."""

import os
import sys
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
np = pytest.importorskip("numpy")

from training.fault.methods import inpformer as inp  # noqa: E402

REPO = Path(
    os.environ.get(
        "INPFORMER_REPO",
        "/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/7465821c-727f-422e-b6d5-83704616dd8a"
        "/scratchpad/agents/inpformer-research/repo",
    )
)
needs_clone = pytest.mark.skipif(
    not (REPO / "models" / "uad.py").is_file(), reason="INP-Former clone folder not found"
)


class Stand(torch.nn.Module):
    """Same output shape as INP_Former.forward: en, de lists of (B,C,28,28) and a scalar g_loss."""

    def __init__(self) -> None:
        super().__init__()
        self.enc = torch.nn.Conv2d(3, 4, kernel_size=14, stride=14)  # 392 -> 28
        self.dec = torch.nn.Conv2d(4, 4, kernel_size=1)

    def forward(self, x):
        en = self.enc(x)
        de = self.dec(en)
        return [en], [de], self.dec.weight.abs().mean()


@pytest.fixture
def standin(monkeypatch):
    """Patch _build (stand-in model, returned as its own trainable module) and _optimizer
    (AdamW; the repo's StableAdamW lives in the clone). Returns built models and initial states."""
    made, init = [], []

    def build(self):
        m = Stand()
        made.append(m)
        init.append({k: v.clone() for k, v in m.state_dict().items()})
        return m, m

    def optimizer(self, params):
        return torch.optim.AdamW(params, lr=1e-3, weight_decay=1e-4, amsgrad=True, eps=1e-10)

    monkeypatch.setattr(inp.INPFormer, "_build", build)
    monkeypatch.setattr(inp.INPFormer, "_optimizer", optimizer)
    return made, init


def _tiles(n: int, seed: int = 0) -> list:
    rng = np.random.default_rng(seed)
    return [rng.integers(0, 256, (392, 392, 3), dtype=np.uint8) for _ in range(n)]


def _method(**kw) -> inp.INPFormer:
    args = dict(repo_dir="/nonexistent-inpformer-repo", iters=3, batch_size=2, device="cpu")
    args.update(kw)
    return inp.INPFormer(**args)


def test_fit_changes_trainable_and_keeps_cwd(standin):
    made, init = standin
    cwd = os.getcwd()
    m = _method(iters=3)
    m.fit(_tiles(4))
    assert os.getcwd() == cwd
    after = made[-1].state_dict()
    assert any(not torch.equal(after[k], init[-1][k]) for k in after)


def test_score_tiles_returns_float32_392_maps(standin):
    m = _method(iters=3)
    m.fit(_tiles(3))
    maps = m.score_tiles(_tiles(3, seed=1))
    assert len(maps) == 3
    for a in maps:
        assert a.shape == (392, 392) and a.dtype == np.float32
        assert np.isfinite(a).all()


def test_fewer_tiles_than_batch_size(standin):
    m = _method(iters=2, batch_size=16)
    m.fit(_tiles(3))
    maps = m.score_tiles(_tiles(3))
    assert len(maps) == 3 and maps[0].shape == (392, 392)


def test_save_then_load_gives_same_maps(standin, tmp_path):
    m = _method(iters=2)
    m.fit(_tiles(3))
    tiles = _tiles(2, seed=5)
    before = m.score_tiles(tiles)
    path = tmp_path / "inpformer.pt"
    m.save(path)

    m2 = _method(iters=2)  # its stand-in starts from a different random init
    m2.load(path)
    after = m2.score_tiles(tiles)
    for a, b in zip(before, after, strict=True):
        np.testing.assert_allclose(a, b, rtol=1e-6, atol=1e-6)


def test_cal_anomaly_maps_zero_for_identical_positive_for_different():
    f = [torch.randn(2, 8, 28, 28)]
    same, _ = inp.cal_anomaly_maps(f, f, 392)
    assert same.shape == (2, 1, 392, 392)
    assert float(same.abs().max()) < 1e-5
    other, _ = inp.cal_anomaly_maps(f, [torch.randn(2, 8, 28, 28)], 392)
    assert float(other.min()) >= 0 and float(other.mean()) > 0.1


class _StubEncoder(torch.nn.Module):
    """Stands in for the DINOv2-reg encoder: 4 register tokens, 28×28 patches, width 768."""

    num_register_tokens = 4

    def __init__(self) -> None:
        super().__init__()
        self.blocks = torch.nn.ModuleList([torch.nn.Identity() for _ in range(12)])

    def prepare_tokens(self, x):
        return torch.randn(x.shape[0], 1 + 4 + 28 * 28, 768)


@needs_clone
def test_clone_modules_wire_and_run_on_stub_encoder():
    m = inp.INPFormer(repo_dir=str(REPO), backbone="dinov2reg_vit_base_14", device="cpu")
    model, trainable = m._assemble(_StubEncoder())
    with inp.upstream_repo(REPO):
        assert Path(sys.modules["models.uad"].__file__).is_relative_to(REPO)
    en, de, g_loss = model(torch.zeros(1, 3, 392, 392))
    assert len(en) == 2 and len(de) == 2
    assert en[0].shape == (1, 768, 28, 28) and de[0].shape == (1, 768, 28, 28)
    assert g_loss.dim() == 0
    with inp.upstream_repo(REPO):
        from optimizers import StableAdamW

    assert isinstance(m._optimizer(list(trainable.parameters())), StableAdamW)


@needs_clone
def test_real_clone_models_collide_without_isolation():
    """Changing sys.path cannot replace a cached upstream package or its children."""
    import importlib

    dinomaly = REPO.parent.parent / "dinomaly-research" / "repo"
    musc = REPO.parent.parent / "musc-research" / "MuSc"
    if not (dinomaly / "models/uad.py").exists() or not musc.exists():
        pytest.skip("other upstream clones unavailable")
    with inp.upstream_repo(REPO):
        old = importlib.import_module("models.uad")
        assert hasattr(old, "INP_Former") and not hasattr(old, "ViTill")
        sys.path.insert(0, str(dinomaly))
        try:
            assert importlib.import_module("models.uad") is old
            with pytest.raises(ImportError):
                exec("from models.uad import ViTill", {})
        finally:
            sys.path.pop(0)
        with inp.upstream_repo(dinomaly):
            # Resolve without executing Dinomaly's unrelated scipy/sklearn dependencies.
            assert Path(importlib.util.find_spec("models.uad").origin).is_relative_to(dinomaly)
        assert importlib.import_module("models.uad") is old
    with inp.upstream_repo(musc):
        package = importlib.import_module("models")
        sys.path.insert(0, str(REPO))
        try:
            assert importlib.import_module("models") is package
            with pytest.raises(ModuleNotFoundError):
                importlib.import_module("models.uad")
        finally:
            sys.path.pop(0)


@needs_clone
@pytest.mark.parametrize("name", ["utils", "optimizers", "dataset"])
def test_real_clone_top_level_specs_are_cached_by_name(name):
    """Resolve actual source files without executing dependency-heavy utils/dataset bodies."""
    import importlib.util

    dinomaly = REPO.parent.parent / "dinomaly-research" / "repo"
    if not dinomaly.exists():
        pytest.skip("Dinomaly clone unavailable")
    with inp.upstream_repo(dinomaly):
        first = importlib.util.find_spec(name)
        assert Path(first.origin).is_relative_to(dinomaly)
        # This is exactly the sys.modules entry produced before module execution.
        cached = importlib.util.module_from_spec(first)
        sys.modules[name] = cached
        sys.path.insert(0, str(REPO))
        try:
            assert importlib.util.find_spec(name).origin == first.origin
            with inp.upstream_repo(REPO):
                assert Path(importlib.util.find_spec(name).origin).is_relative_to(REPO)
            assert sys.modules[name] is cached
        finally:
            sys.path.pop(0)
            # Do not retain a deliberately unexecuted module in the repo cache.
            del sys.modules[name]


def test_import_scope_restores_modules_and_path_after_error(tmp_path):
    import importlib

    from training.fault.methods._upstream import upstream_repo

    (tmp_path / "models").mkdir()
    (tmp_path / "models/__init__.py").write_text("marker = 42\n")
    before = {k: v for k, v in sys.modules.items() if k == "models" or k.startswith("models.")}
    path = sys.path[:]
    with pytest.raises(RuntimeError, match="deliberate"), upstream_repo(tmp_path):
        module = importlib.import_module("models")
        assert module.marker == 42
        raise RuntimeError("deliberate")
    assert sys.path == path
    assert {
        k: v for k, v in sys.modules.items() if k == "models" or k.startswith("models.")
    } == before
    with upstream_repo(tmp_path):
        assert importlib.import_module("models") is module


@pytest.mark.parametrize("kw", [{"iters": 0}, {"batch_size": 0}, {"inp_num": 0}])
def test_invalid_counts_fail_before_build(kw):
    with pytest.raises(ValueError, match="must be positive"):
        _method(**kw)


def test_checkpoint_records_and_checks_prototype_count(standin, tmp_path):
    m = _method(inp_num=3)
    m.fit(_tiles(2))
    path = tmp_path / "three.pt"
    m.save(path)
    assert torch.load(path, weights_only=True)["inp_num"] == 3
    with pytest.raises(ValueError, match="prototype count"):
        _method(inp_num=6).load(path)


def test_nested_same_repo_keeps_module_identity(tmp_path):
    import importlib

    (tmp_path / "models").mkdir()
    (tmp_path / "models/__init__.py").write_text("marker = object()\n")
    with inp.upstream_repo(tmp_path):
        first = importlib.import_module("models")
        with inp.upstream_repo(tmp_path):
            assert importlib.import_module("models") is first
        assert importlib.import_module("models") is first


def test_identical_features_have_finite_zero_loss_gradients():
    target = torch.ones(1, 4, 2, 2)
    reconstructed = target.clone().requires_grad_()
    loss = inp.global_cosine_hm_adaptive([target], [reconstructed])
    loss.backward()
    assert loss.item() == pytest.approx(0)
    assert torch.isfinite(reconstructed.grad).all()


def test_encoder_failure_restores_cwd_and_import_path(tmp_path):
    (tmp_path / "models").mkdir()
    (tmp_path / "models/__init__.py").write_text("")
    (tmp_path / "models/vit_encoder.py").write_text(
        "def load(backbone):\n    raise RuntimeError('encoder failed')\n"
    )
    cwd, path = os.getcwd(), sys.path[:]
    m = _method(repo_dir=str(tmp_path))
    with pytest.raises(RuntimeError, match="encoder failed"):
        m._load_encoder()
    assert os.getcwd() == cwd
    assert sys.path == path
