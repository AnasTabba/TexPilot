"""WFDD robustness: the exported Dinomaly weights scored clean and under each perturbation.

Parallel on a multi-GPU session: the nine units (clean, then each perturbation) are sharded
across one worker process per GPU (CUDA_VISIBLE_DEVICES=i); each worker loads the weights itself.
"""

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

DATASET = "wfdd"
METHOD = "dinomaly_vitb"
ITERS = 10000
AMP = True
MODE = "unified"
SMOKE = False
INPUT = Path("/kaggle/input")
WORK = Path("/kaggle/working")
SELF = Path(__file__).resolve()
REPO = Path("/tmp/Dinomaly")
PIN = "1f252be03a918789b19848f0ca37166e7c28dada"


def shard(items, n, i):
    """Items for worker i of n: each item goes to exactly one worker, in original order."""
    return items[i::n]


class Prefixed:
    """Stdout wrapper for a worker: every line gets the [gpu{i}] prefix and is flushed."""

    def __init__(self, stream, prefix):
        self.stream, self.prefix, self.pending = stream, prefix, ""

    def write(self, text):
        *lines, self.pending = (self.pending + text).split("\n")
        for line in lines:
            self.stream.write(f"{self.prefix}{line}\n")
        return len(text)

    def flush(self):
        if self.pending:
            self.stream.write(f"{self.prefix}{self.pending}\n")
            self.pending = ""
        self.stream.flush()


def code_root():
    roots = list(INPUT.rglob("training/fault/bench.py")) or list(
        (WORK / "code").rglob("training/fault/bench.py")
    )  # worker processes reuse the archive the parent already extracted
    if not roots:
        target = WORK / "code"
        target.mkdir(exist_ok=True)
        for archive in INPUT.rglob("*.zip"):
            if "texpilot-fault-code" not in str(archive):
                continue
            with zipfile.ZipFile(archive) as z:
                for member in z.infolist():
                    if not (target / member.filename).resolve().is_relative_to(target.resolve()):
                        raise ValueError("unsafe code archive path")
                z.extractall(target)
        roots = list(target.rglob("training/fault/bench.py"))
    if len(roots) != 1:
        raise RuntimeError(f"expected one code root, found {roots}")
    return roots[0].parents[2]


def gpu_count():
    import torch

    return torch.cuda.device_count()


def import_bench():
    sys.path.insert(0, str(code_root()))
    from training.fault import bench

    bench._train_tiles = lambda samples: []  # nothing is fitted here
    return bench


def find_weights():
    weights = [p for p in INPUT.rglob("weights.pt")]
    if len(weights) != 1:
        raise RuntimeError(f"expected one weights.pt, found {weights}")
    return weights


def unit_names():
    from training.fault.perturb import PERTURBATIONS

    return [None, *PERTURBATIONS]


def write_worker_file(i, units):
    path = WORK / "workers" / f"worker{i}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(units, indent=2, default=float))


def merge_units(directory, total):
    """Collect every worker{i}.json in directory and return the rows in original unit order."""
    units = []
    for path in Path(directory).glob("worker*.json"):
        units += json.loads(path.read_text())
    units.sort(key=lambda u: u["index"])
    if [u["index"] for u in units] != list(range(total)):
        raise RuntimeError(f"expected units 0..{total - 1}, found {[u['index'] for u in units]}")
    return [u["row"] for u in units]


def run_children(specs):
    """specs: (label, argv, gpu). Start every child on its GPU, wait for all, then fail if any
    exited non-zero, so partial results are never used."""
    procs = [
        (
            label,
            subprocess.Popen(
                [sys.executable, str(SELF), *argv],
                env={**os.environ, "CUDA_VISIBLE_DEVICES": str(gpu)},
            ),
        )
        for label, argv, gpu in specs
    ]
    codes = [(label, p.wait()) for label, p in procs]
    failed = [f"{label} exited with code {code}" for label, code in codes if code != 0]
    if failed:
        raise RuntimeError("; ".join(failed))


def run_shard(i, n):
    bench = import_bench()
    from training.fault.kaggle.common import load_samples
    from training.fault.methods.dinomaly import Dinomaly

    weights = find_weights()

    class Loaded(Dinomaly):
        def fit(self, train):  # already trained: the benchmark's fit step only loads
            if self._model is None:
                self.load(weights[0])

    model = Loaded(str(REPO), backbone="dinov2reg_vit_base_14", amp=True)
    samples = load_samples(DATASET, False)
    out = WORK / "robustness"
    units = []
    for index, name in shard(list(enumerate(unit_names())), n, i):
        key = name or "clean"
        rows = bench.run_benchmark(
            model, samples, out / f"{key}.json", perturbation=name, mode="unified"
        )["rows"]
        summary = {
            "macro_f1": sum(r["f1"] for r in rows) / len(rows),
            "macro_auroc": sum(r["auroc"] for r in rows) / len(rows),
            "macro_false_alarms_per_1000": sum(r["false_alarms_per_1000"] for r in rows)
            / len(rows),
            "per_category_f1": {r["category"]: r["f1"] for r in rows},
        }
        units.append({"index": index, "row": {"key": key, "summary": summary}})
        print("ROBUST", key, json.dumps(summary), flush=True)
    write_worker_file(i, units)


def main():
    root = code_root()
    sys.path.insert(0, str(root))
    from training.fault.kaggle.common import download_weights

    subprocess.run(
        ["git", "clone", "-q", "https://github.com/guojiajeremy/Dinomaly", str(REPO)], check=True
    )
    subprocess.run(["git", "-C", str(REPO), "checkout", "-q", PIN], check=True)
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "scikit-image", "tabulate"], check=True
    )
    download_weights(REPO, ("dinomaly_vitb",))
    find_weights()  # fails unless exactly one weights.pt is present

    total = len(unit_names())
    n = gpu_count()
    run_children([(f"worker {i}", ["--worker", str(i), str(n)], i) for i in range(n)])
    units = merge_units(WORK / "workers", total)
    summary = {u["key"]: u["summary"] for u in units}
    (WORK / "robustness-summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--worker"]:
        i, n = int(args[1]), int(args[2])
        sys.stdout = Prefixed(sys.stdout, f"[gpu{i}] ")
        run_shard(i, n)
    else:
        main()
