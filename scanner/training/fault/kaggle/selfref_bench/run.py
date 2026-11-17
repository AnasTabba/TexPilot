"""Self-reference fault scoring: choose the configuration on MVTec AD textures (development set),
then score WFDD once with that configuration (held-out test). Nothing is fitted: zero-shot.

Parallel on a multi-GPU session: the parent starts one worker process per GPU
(CUDA_VISIBLE_DEVICES=i). The development configurations are sharded across the workers; the two
WFDD evaluations then run as separate workers (calibrated on GPU 0, global threshold on GPU 1).
"""

import hashlib
import json
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path

INPUT = Path("/kaggle/input")
WORK = Path("/kaggle/working")
SELF = Path(__file__).resolve()
DEV_CONFIGS = [
    {"layers": layers, "k": k, "radius": radius, "normalize": normalize}
    for layers in [(11,), (5, 8, 11)]
    for k in [1, 5, 20]
    for radius in [2, 4]
    for normalize in [True, False]
]
DINOMALY_WFDD = {
    "label": "trained on WFDD, per-category calibrated",
    "macro_f1": 0.8999,
    "macro_image_auroc": 0.9437,
}


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


def install_dependencies():
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "timm==1.0.30"], check=True)


def require_cuda():
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("selfref bench needs a CUDA GPU")


def gpu_count():
    import torch

    return torch.cuda.device_count()


def import_bench():
    sys.path.insert(0, str(code_root()))
    from training.fault import bench

    bench._train_tiles = lambda samples: []  # nothing is fitted: zero-shot
    return bench


def config_name(cfg):
    layers = "-".join(str(i) for i in cfg["layers"])
    return f"L{layers}_k{cfg['k']}_r{cfg['radius']}_{'norm' if cfg['normalize'] else 'raw'}"


def config_json(cfg):
    return {
        "layers": list(cfg["layers"]),
        "k": cfg["k"],
        "radius": cfg["radius"],
        "normalize": cfg["normalize"],
    }


def mean_or_none(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def summarize(rows):
    keys = ("f1", "auroc", "pixel_auroc", "aupro", "false_alarms_per_1000")
    return {key: mean_or_none([r.get(key) for r in rows]) for key in keys}


def fmt(value):
    return "None" if value is None else f"{value:.4f}"


def wfdd_categories(samples):
    """Categories run_benchmark evaluates in unified mode: those with train and calib samples."""
    splits = {}
    for s in samples:
        splits.setdefault(s.category, set()).add(s.split)
    return [cat for cat, seen in splits.items() if {"train", "calib"} <= seen]


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


def run_dev_shard(i, n):
    bench = import_bench()
    from training.fault.kaggle.common import load_samples
    from training.fault.methods.selfref import SelfReference

    mvtec = load_samples("mvtec", False)
    units = []
    for index in shard(range(len(DEV_CONFIGS)), n, i):
        cfg = DEV_CONFIGS[index]
        name = config_name(cfg)
        started = time.perf_counter()
        rows = bench.run_benchmark(
            SelfReference(**cfg), mvtec, WORK / "dev" / f"{name}.json", mode="unified"
        )["rows"]
        seconds = time.perf_counter() - started
        s = summarize(rows)
        units.append(
            {"index": index, "row": {"config": name, **config_json(cfg), **s, "seconds": seconds}}
        )
        print(
            f"DEV {name} auroc={fmt(s['auroc'])} pixel_auroc={fmt(s['pixel_auroc'])} "
            f"aupro={fmt(s['aupro'])} f1={fmt(s['f1'])} seconds={seconds:.1f}",
            flush=True,
        )
    write_worker_file(i, units)


def run_wfdd(job, best):
    """job a: per-category calibrated run_benchmark. job b: one global threshold from pooled
    MVTec calibration, then _evaluate per WFDD category."""
    bench = import_bench()
    from training.fault.kaggle.common import load_samples
    from training.fault.methods.selfref import SelfReference

    chosen = DEV_CONFIGS[best]
    mvtec = load_samples("mvtec", False)
    wfdd = load_samples("wfdd", False)
    if job == "a":
        rows_a = bench.run_benchmark(
            SelfReference(**chosen), wfdd, WORK / "wfdd_calibrated.json", mode="unified"
        )["rows"]
        print("WFDD calibrated", json.dumps(summarize(rows_a), default=float), flush=True)
        payload = {"rows": rows_a}
    else:
        method = SelfReference(**chosen)
        pooled = [s for s in mvtec if s.split == "calib"]
        threshold = bench._calib_threshold(method, pooled)
        rows_b = []
        for cat in wfdd_categories(wfdd):
            test = [s for s in wfdd if s.category == cat and s.split == "test"]
            rows_b.append(bench._evaluate(method, ("wfdd", cat), test, threshold, None, "global"))
        (WORK / "wfdd_global_threshold.json").write_text(
            json.dumps(rows_b, indent=2, default=float)
        )
        print(
            f"WFDD global threshold {threshold:.4f}",
            json.dumps(summarize(rows_b), default=float),
            flush=True,
        )
        payload = {"threshold": threshold, "rows": rows_b}
    (WORK / "workers").mkdir(parents=True, exist_ok=True)
    (WORK / "workers" / f"wfdd_{job}.json").write_text(json.dumps(payload, indent=2, default=float))


def main():
    install_dependencies()
    require_cuda()
    root = code_root()
    sys.path.insert(0, str(root))
    import timm

    from training.fault.methods.selfref import ENCODER, TILE, SelfReference

    timm.create_model(ENCODER, pretrained=True, num_classes=0, img_size=TILE)  # cache only, CPU
    code_sha = hashlib.sha256((root / "training/fault/methods/selfref.py").read_bytes()).hexdigest()

    n = gpu_count()
    run_children([(f"worker {i}", ["--worker", str(i), str(n)], i) for i in range(n)])
    dev = merge_units(WORK / "workers", len(DEV_CONFIGS))

    def rank(i):  # highest image AUROC, tie broken by pixel AUROC; first config wins a full tie
        px = dev[i]["pixel_auroc"]
        return (dev[i]["auroc"], px if px is not None else float("-inf"))

    best = max(range(len(dev)), key=rank)
    chosen = DEV_CONFIGS[best]
    print(f"CHOSEN {dev[best]['config']} dev_auroc={fmt(dev[best]['auroc'])}", flush=True)

    job_a = ("wfdd a", ["--wfdd", "a", str(best), "0"], 0)
    job_b = ("wfdd b", ["--wfdd", "b", str(best), "1"], 1)
    if n > 1:
        run_children([job_a, job_b])
    else:
        run_children([job_a])
        run_children([("wfdd b", ["--wfdd", "b", str(best), "0"], 0)])
    wa = json.loads((WORK / "workers" / "wfdd_a.json").read_text())
    wb = json.loads((WORK / "workers" / "wfdd_b.json").read_text())
    rows_a, rows_b, threshold = wa["rows"], wb["rows"], wb["threshold"]
    if [r["category"] for r in rows_a] != [r["category"] for r in rows_b]:
        raise RuntimeError("calibrated and global-threshold runs evaluated different categories")

    results = {
        "method": SelfReference.name,
        "selfref_sha256": code_sha,
        "dev_table": dev,
        "chosen": {"config": dev[best]["config"], **config_json(chosen)},
        "wfdd_calibrated": {"rows": rows_a, "mean": summarize(rows_a)},
        "wfdd_global_threshold": {
            "threshold": threshold,
            "calibration": "pooled MVTec calibration images, all five categories",
            "rows": rows_b,
            "mean": summarize(rows_b),
        },
        "reference_dinomaly": DINOMALY_WFDD,
    }
    (WORK / "selfref_results.json").write_text(json.dumps(results, indent=2, default=float))
    print("DONE selfref_results.json written", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--worker"]:
        i, n = int(args[1]), int(args[2])
        sys.stdout = Prefixed(sys.stdout, f"[gpu{i}] ")
        run_dev_shard(i, n)
    elif args[:1] == ["--wfdd"]:
        job, best, gpu = args[1], int(args[2]), int(args[3])
        sys.stdout = Prefixed(sys.stdout, f"[gpu{gpu}] ")
        run_wfdd(job, best)
    else:
        main()
