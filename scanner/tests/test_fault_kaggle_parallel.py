"""CPU-only checks for the multi-GPU Kaggle scripts: sharding, merge order, launcher, stdout prefix.

The scripts are loaded by path. Importing them must perform no work (all work sits behind
the __main__ guard), so these tests never touch CUDA, the network or /kaggle paths.
"""

import importlib.util
import io
import json
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

KAGGLE = Path(__file__).resolve().parents[1] / "training" / "fault" / "kaggle"
SCRIPTS = {
    "selfref": KAGGLE / "selfref_bench" / "run.py",
    "a2": KAGGLE / "a2_wfdd_robust" / "run.py",
}


def load(name):
    spec = importlib.util.spec_from_file_location(f"kaggle_{name}_run", SCRIPTS[name])
    module = importlib.util.module_from_spec(spec)
    refuse = mock.Mock(side_effect=AssertionError("import must not start a process"))
    with (
        mock.patch.object(subprocess, "Popen", refuse),
        mock.patch.object(subprocess, "run", refuse),
    ):
        spec.loader.exec_module(module)
    assert not refuse.called
    return module


@pytest.fixture(params=["selfref", "a2"])
def script(request):
    return load(request.param)


def write_worker(directory, i, units):
    (directory / f"worker{i}.json").write_text(json.dumps(units))


def test_shard_assigns_every_item_once_and_keeps_order(script):
    items = list(range(9))
    for n in (1, 2, 3, 12):
        parts = [script.shard(items, n, i) for i in range(n)]
        assert sorted(x for part in parts for x in part) == items
        assert all(part == sorted(part) for part in parts)
    assert script.shard(items, 1, 0) == items
    assert script.shard(["a", "b", "c", "d", "e"], 2, 0) == ["a", "c", "e"]
    assert script.shard([1, 2], 5, 4) == []


def test_merge_restores_original_order_from_two_workers(script, tmp_path):
    units = [{"index": k, "row": {"unit": k}} for k in range(5)]
    write_worker(tmp_path, 1, units[1::2])  # written first, on purpose
    write_worker(tmp_path, 0, units[0::2])
    assert script.merge_units(tmp_path, 5) == [{"unit": k} for k in range(5)]


def test_merge_refuses_a_missing_unit(script, tmp_path):
    write_worker(tmp_path, 0, [{"index": 0, "row": {}}, {"index": 2, "row": {}}])
    with pytest.raises(RuntimeError, match="expected units 0..2"):
        script.merge_units(tmp_path, 3)


def test_run_children_launches_one_child_per_gpu_and_reports_failure(script, monkeypatch):
    launched = []

    class FakeChild:
        def __init__(self, argv, env):
            launched.append((argv, env["CUDA_VISIBLE_DEVICES"]))
            self.code = 1 if len(launched) == 2 else 0

        def wait(self):
            return self.code

    monkeypatch.setattr(subprocess, "Popen", FakeChild)
    with pytest.raises(RuntimeError, match=r"worker 1 exited with code 1"):
        script.run_children([(f"worker {i}", ["--worker", str(i), "2"], i) for i in range(2)])
    assert [env for _, env in launched] == ["0", "1"]
    assert launched[0][0] == [sys.executable, str(script.SELF), "--worker", "0", "2"]


def test_code_root_reuses_an_archive_the_parent_already_extracted(script, monkeypatch, tmp_path):
    work = tmp_path / "work"
    bench = work / "code" / "training" / "fault" / "bench.py"
    bench.parent.mkdir(parents=True)
    bench.write_text("")
    monkeypatch.setattr(script, "WORK", work)
    monkeypatch.setattr(script, "INPUT", tmp_path / "missing-input")
    assert script.code_root() == work / "code"


def test_prefixed_stdout_prefixes_every_line_and_flushes(script):
    buf = io.StringIO()
    out = script.Prefixed(buf, "[gpu1] ")
    out.write("DEV a\nDEV ")
    out.write("b\nlast")
    assert buf.getvalue() == "[gpu1] DEV a\n[gpu1] DEV b\n"
    out.flush()
    assert buf.getvalue() == "[gpu1] DEV a\n[gpu1] DEV b\n[gpu1] last\n"
