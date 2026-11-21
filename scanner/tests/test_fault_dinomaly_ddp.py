"""Real two-process Gloo proof of global mining and DDP optimizer equivalence."""

import ast
import os
from functools import partial
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
import torch.distributed as dist  # noqa: E402
from torch import nn  # noqa: E402
from torch.multiprocessing import spawn  # noqa: E402
from torch.nn.parallel import DistributedDataParallel  # noqa: E402

from training.fault.methods.dinomaly import (  # noqa: E402
    Dinomaly,
    distributed_cosine_hm_percent,
)


def upstream_loss():
    repo = os.environ.get("DINOMALY_REPO")
    if not repo:
        raise RuntimeError("DINOMALY_REPO required")
    tree = ast.parse((Path(repo) / "utils.py").read_text())
    nodes = [
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name in ("modify_grad", "global_cosine_hm_percent")
    ]
    scope = {"torch": torch, "partial": partial}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "upstream/utils.py", "exec"), scope)
    return scope["global_cosine_hm_percent"]


def worker(rank, folder):
    torch.set_num_threads(1)
    dist.init_process_group(
        "gloo", init_method=(Path(folder) / "init").as_uri(), rank=rank, world_size=2
    )
    try:
        torch.manual_seed(73)
        model = nn.Conv2d(3, 4, 1, bias=False)
        serial = nn.Conv2d(3, 4, 1, bias=False)
        serial.load_state_dict(model.state_dict())
        parallel = DistributedDataParallel(model)
        opt = torch.optim.AdamW(parallel.parameters(), lr=0.002)
        baseline = torch.optim.AdamW(serial.parameters(), lr=0.002)
        loss_fn = upstream_loss()
        for step in range(3):
            torch.manual_seed(900 + step)
            x = torch.randn(16, 3, 3, 3)
            target = torch.randn(16, 4, 3, 3)
            # Deliberately vary rank distributions: local top-k differs from global.
            target[8:] *= 4
            output = serial(x)
            reference = loss_fn([target], [output], p=0.6, factor=0.1)
            baseline.zero_grad()
            reference.backward()
            nn.utils.clip_grad_norm_(serial.parameters(), 0.1)
            baseline.step()
            local = slice(rank * 8, (rank + 1) * 8)
            predicted = parallel(x[local])
            loss = distributed_cosine_hm_percent([target[local]], [predicted], p=0.6, factor=0.1)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(parallel.parameters(), 0.1)
            opt.step()
            torch.testing.assert_close(model.weight, serial.weight, rtol=2e-5, atol=1e-7)
        torch.save(model.state_dict(), Path(folder) / f"rank{rank}.pt")
    finally:
        dist.destroy_process_group()


@pytest.mark.skipif(not os.environ.get("DINOMALY_REPO"), reason="real upstream loss required")
def test_two_rank_gradients_and_three_updates_match_upstream_global_batch(tmp_path):
    spawn(worker, args=(str(tmp_path),), nprocs=2, join=True)
    a = torch.load(tmp_path / "rank0.pt", weights_only=True)
    b = torch.load(tmp_path / "rank1.pt", weights_only=True)
    torch.testing.assert_close(a["weight"], b["weight"], rtol=0, atol=0)


@pytest.mark.parametrize("kwargs", [{"gpus": 3}, {"gpus": 2, "batch_size": 15}, {"iters": 0}])
def test_invalid_parallel_settings_fail_before_model_build(kwargs):
    with pytest.raises(ValueError):
        Dinomaly("unused", **kwargs)


def test_two_gpu_mode_never_silently_falls_back_to_cpu():
    import numpy as np

    method = Dinomaly("unused", gpus=2, device="cpu")
    with pytest.raises(RuntimeError, match="two visible CUDA"):
        method.fit([np.zeros((392, 392, 3), dtype=np.uint8)])


def test_two_gpu_parent_uses_file_backed_tiles_and_restores_portable_weights(monkeypatch, tmp_path):
    import tempfile

    import numpy as np
    import torch.multiprocessing as multiprocessing

    observed = []
    original_temp = tempfile.TemporaryDirectory
    monkeypatch.setattr(
        tempfile, "TemporaryDirectory", lambda **kwargs: original_temp(dir=tmp_path, **kwargs)
    )
    monkeypatch.setattr(torch.cuda, "device_count", lambda: 2)

    def build(self):
        model = nn.Linear(3, 2)
        return model, nn.ModuleList([model])

    monkeypatch.setattr(Dinomaly, "_build", build)

    def spawn_stub(function, args, nprocs, join):
        config, directory = args
        observed.append(directory)
        assert nprocs == 2 and join
        assert config["batch_size"] == 16 and config["iters"] == 10000
        tiles = np.load(Path(directory) / "tiles.npy", mmap_mode="r")
        assert isinstance(tiles, np.memmap) and tiles.shape == (2, 392, 392, 3)
        model, weights = build(None)
        with torch.no_grad():
            for p in weights.parameters():
                p.fill_(0.25)
        torch.save(
            {
                "state_dict": weights.state_dict(),
                "fit_loop_seconds": 3.5,
                "training_provenance": {"world_size": 2, "optimizer_steps": 10000},
            },
            Path(directory) / "rank0.pt",
        )

    monkeypatch.setattr(multiprocessing, "spawn", spawn_stub)
    method = Dinomaly("unused", gpus=2, device="cuda:0")
    method.fit([np.zeros((392, 392, 3), np.uint8)] * 2)
    assert method.training_provenance["optimizer_steps"] == 10000
    assert method.fit_loop_seconds == 3.5
    assert all(torch.all(p == 0.25) for p in method._trainable.parameters())
    assert all(not Path(folder).exists() for folder in observed)


def test_fit_loop_accepts_worker_memmap_input(monkeypatch, tmp_path):
    import numpy as np
    from test_fault_dinomaly import _fake_optimizers, _fake_utils, _stub_build

    from training.fault.methods._upstream import _MODULES

    monkeypatch.setitem(
        _MODULES, str(tmp_path), {"utils": _fake_utils(), "optimizers": _fake_optimizers()}
    )
    monkeypatch.setattr(Dinomaly, "_build", _stub_build)
    tiles = np.lib.format.open_memmap(
        tmp_path / "tiles.npy", mode="w+", dtype=np.uint8, shape=(2, 392, 392, 3)
    )
    tiles[:] = 100
    method = Dinomaly(str(tmp_path), iters=2, batch_size=2, device="cpu")
    method._fit_loop(tiles)
    assert method.training_provenance["optimizer_steps"] == 2


def test_amp_overflow_retries_same_batch_without_counting_optimizer_step(monkeypatch, tmp_path):
    """CPU scaler stand-in exercises the GPU control flow, not GPU performance."""
    import types
    from contextlib import nullcontext

    import numpy as np
    from test_fault_dinomaly import _fake_optimizers, _fake_utils, _stub_build

    from training.fault.methods._upstream import _MODULES

    monkeypatch.setitem(
        _MODULES, str(tmp_path), {"utils": _fake_utils(), "optimizers": _fake_optimizers()}
    )
    monkeypatch.setattr(Dinomaly, "_build", _stub_build)
    monkeypatch.setattr(Dinomaly, "_autocast", lambda self: nullcontext())
    monkeypatch.setattr(torch.cuda, "synchronize", lambda *_: None)
    original_tensor = torch.tensor
    monkeypatch.setattr(
        torch,
        "tensor",
        lambda *a, **kw: original_tensor(
            *a, **dict(kw, device="cpu") if str(kw.get("device", "")).startswith("cuda") else kw
        ),
    )
    calls = types.SimpleNamespace(steps=0, updates=0, clips=0)

    class Scaler:
        def __init__(self, *args, **kwargs):
            self.value = 8.0

        def scale(self, loss):
            return loss

        def unscale_(self, opt):
            pass

        def get_scale(self):
            return self.value

        def step(self, opt):
            calls.steps += 1
            opt.step()

        def update(self, new_scale=None):
            calls.updates += 1
            if new_scale is not None:
                self.value = new_scale

    monkeypatch.setattr(torch.amp, "GradScaler", Scaler)
    original_clip = nn.utils.clip_grad_norm_

    def clip(parameters, max_norm):
        calls.clips += 1
        if calls.clips == 1:
            return original_tensor(float("inf"))
        return original_clip(parameters, max_norm)

    monkeypatch.setattr(nn.utils, "clip_grad_norm_", clip)
    batches = []

    def tensor_batch(self, batch):
        batches.append([id(x) for x in batch])
        return torch.from_numpy(np.stack(batch)).float().permute(0, 3, 1, 2) / 255

    monkeypatch.setattr(Dinomaly, "_to_tensor", tensor_batch)
    method = Dinomaly(str(tmp_path), iters=2, batch_size=2, device="cuda:0", amp=True)
    method.fit([np.full((392, 392, 3), v, np.uint8) for v in (30, 70, 120)])
    assert batches[0] == batches[1]
    assert calls.steps == 2 and calls.updates == 3
    assert method.training_provenance["attempts"] == 3
    assert method.training_provenance["optimizer_steps"] == 2
    assert method.training_provenance["skipped_updates"] == 1


def test_ddp_checks_the_actual_temporary_filesystem_before_allocating(monkeypatch):
    import shutil
    import types

    import numpy as np

    monkeypatch.setattr(torch.cuda, "device_count", lambda: 2)
    monkeypatch.setattr(shutil, "disk_usage", lambda _: types.SimpleNamespace(free=0))
    with pytest.raises(RuntimeError, match="temporary filesystem"):
        Dinomaly("unused", gpus=2, device="cuda:0").fit([np.zeros((392, 392, 3), np.uint8)])
