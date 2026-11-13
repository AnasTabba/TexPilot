"""Kaggle entrypoint helpers use tiny trees and fakes, with no installs or model loads."""

import importlib
import json
import subprocess
import sys
import types
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from training.fault.kaggle import common
from training.fault.kaggle.bench_a1 import run
from training.fault.kaggle.bench_a2 import run as dinomaly_run


def test_import_does_not_run_benchmark(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("import started an external command")

    monkeypatch.setattr(subprocess, "run", forbidden)
    importlib.reload(run)
    importlib.reload(dinomaly_run)


def test_code_root_from_tree(tmp_path, monkeypatch):
    source = tmp_path / "input" / "code"
    bench = source / "training/fault/bench.py"
    bench.parent.mkdir(parents=True)
    bench.write_text("")
    monkeypatch.setattr(run, "INPUT", tmp_path / "input")
    assert run.code_root() == source


def test_code_root_from_zip_and_rejects_traversal(tmp_path, monkeypatch):
    source = tmp_path / "input/texpilot-fault-code"
    source.mkdir(parents=True)
    work = tmp_path / "work"
    work.mkdir()
    archive = source / "training.zip"
    monkeypatch.setattr(run, "INPUT", tmp_path / "input")
    monkeypatch.setattr(run, "WORK", work)
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("training/fault/bench.py", "")
    assert run.code_root() == work / "code"
    (work / "code/training/fault/bench.py").unlink()
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("../escape.py", "")
    with pytest.raises(ValueError, match="unsafe"):
        run.code_root()
    assert not (work / "escape.py").exists()


def test_code_root_missing_or_ambiguous(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "INPUT", tmp_path)
    monkeypatch.setattr(run, "WORK", tmp_path)
    with pytest.raises(RuntimeError, match="expected one code root"):
        run.code_root()
    for name in ("a", "b"):
        bench = tmp_path / name / "training/fault/bench.py"
        bench.parent.mkdir(parents=True)
        bench.touch()
    with pytest.raises(RuntimeError, match="expected one code root"):
        run.code_root()


def test_dataset_root_unique(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "INPUT", tmp_path)
    with pytest.raises(RuntimeError, match="expected one carpet"):
        common.dataset_root("carpet")
    (tmp_path / "mvtec/carpet").mkdir(parents=True)
    assert common.dataset_root("carpet") == tmp_path / "mvtec"
    (tmp_path / "duplicate/carpet").mkdir(parents=True)
    with pytest.raises(RuntimeError, match="expected one carpet"):
        common.dataset_root("carpet")


def _mvtec(root, category="carpet"):
    for part in ("train/good", "test/good", "test/hole"):
        folder = root / category / part
        folder.mkdir(parents=True)
        for i in range(4):
            Image.new("RGB", (8, 8)).save(folder / f"{i}.png")


def test_load_samples_mvtec_smoke_and_wfdd(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "INPUT", tmp_path)
    _mvtec(tmp_path / "mvtec")
    rows = common.load_samples("mvtec", smoke=True)
    assert {r.category for r in rows} == {"carpet"}
    assert {r.split for r in rows} == {"train", "calib", "test"}
    _mvtec(tmp_path / "woven/WFDD", "fabric")
    assert {r.dataset for r in common.load_samples("wfdd")} == {"wfdd"}
    with pytest.raises(ValueError, match="unknown dataset"):
        common.load_samples("unknown")


def test_load_samples_aitex(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "INPUT", tmp_path)
    root = tmp_path / "aitex"
    good = root / "NODefect_images/fabric"
    good.mkdir(parents=True)
    (root / "Defect_images").mkdir()
    for i in range(10):
        Image.new("RGB", (8, 8)).save(good / f"{i:04d}_000_01.png")
    Image.new("RGB", (8, 8)).save(root / "Defect_images/9999_001_01.png")
    rows = common.load_samples("aitex")
    assert len(rows) == 11 and sum(r.label for r in rows) == 1


def test_patchcore_smoke_cap_and_unknown_method(monkeypatch, tmp_path):
    fake = types.ModuleType("training.fault.methods.anomalib_methods")
    fake.PatchCore = lambda **kwargs: kwargs
    monkeypatch.setitem(sys.modules, fake.__name__, fake)
    assert run.make_method("patchcore", tmp_path, True) == {"max_train_tiles": 200}
    assert run.make_method("patchcore", tmp_path, False) == {"max_train_tiles": 2000}
    with pytest.raises(ValueError, match="unknown method"):
        run.make_method("unknown", tmp_path, False)


def test_failed_method_continues_and_exits_one(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "path", sys.path.copy())
    import training.fault.bench as bench

    calls = []
    cuda = types.SimpleNamespace(
        is_available=lambda: True, get_device_name=lambda _: "fake GPU",
        reset_peak_memory_stats=lambda: None, synchronize=lambda: None,
        max_memory_allocated=lambda: 0, empty_cache=lambda: None,
    )
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(cuda=cuda))
    monkeypatch.setattr(run, "WORK", tmp_path)
    monkeypatch.setattr(run, "code_root", lambda: tmp_path)
    monkeypatch.setattr(run.importlib.metadata, "version", lambda _: "fake")
    monkeypatch.setattr(common, "command", lambda *args: None)
    monkeypatch.setattr(common, "cleanup", lambda: None)
    monkeypatch.setattr(common, "load_samples", lambda *args: ["sample"])

    def make(name, *args):
        calls.append(name)
        if name == "musc":
            raise RuntimeError("deliberate MuSc failure")
        return object()

    monkeypatch.setattr(run, "make_method", make)
    monkeypatch.setattr(bench, "run_benchmark", lambda *args, **kwargs: {"rows": [{}]})
    with pytest.raises(SystemExit) as exc:
        run.main()
    assert exc.value.code == 1 and calls == ["musc", "patchcore"]
    log = (tmp_path / "log.txt").read_text()
    assert "deliberate MuSc failure" in log and "SUCCESS mvtec patchcore" in log


def test_private_kernel_metadata():
    metadata = json.loads(Path(run.__file__).with_name("kernel-metadata.json").read_text())
    assert metadata["id"] == "anastabba/texpilot-bench-a1"
    assert metadata["is_private"] and metadata["enable_gpu"] and metadata["enable_internet"]
    assert len(metadata["dataset_sources"]) == 4


def test_cleanup_removes_repos_and_weights_but_keeps_results(tmp_path, monkeypatch):
    work, home = tmp_path / "work", tmp_path / "home"
    monkeypatch.setattr(common, "WORK", work)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    for path in (work / "repos/MuSc/weight.pt", work / "model.pth",
                 home / ".cache/torch/hub/checkpoints/backbone.pth",
                 work / "results/test.json", work / "log.txt"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("small fixture")
    common.cleanup()
    assert not (work / "repos").exists()
    assert not (work / "model.pth").exists()
    assert not (home / ".cache/torch/hub/checkpoints/backbone.pth").exists()
    assert (work / "results/test.json").is_file() and (work / "log.txt").is_file()
