"""Guarded single-dataset A2 execution; --preflight-only reads headers/resources only."""

import hashlib
import importlib.metadata
import json
import math
import os
import platform
import resource
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

from training.fault.data import save_index
from training.fault.kaggle.common import Tee, cleanup, command, download_weights, load_samples
from training.fault.tiles import tile_boxes

PIN = "1f252be03a918789b19848f0ca37166e7c28dada"
GIB = 1024**3
SOURCES = {
    "mvtec": "ipythonx/mvtec-ad",
    "wfdd": "hodinhtrieu/the-woven-fabric-defect-detection-wfdd",
    "aitex": "nexuswho/aitex-fabric-image-database",
}
ROW_KEYS = set(
    [
        "dataset",
        "category",
        "method",
        "mode",
        "perturbation",
        "auroc",
        "ap",
        "pixel_auroc",
        "pixel_ap",
        "aupro",
        "f1",
        "recall",
        "precision",
        "false_alarms_per_1000",
        "fa_ci95",
        "n_good",
        "n_defect",
        "threshold",
        "latency_ms",
        "tiles_per_image",
    ]
)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def inventory(samples, dataset, expected_categories=None):
    if not samples:
        raise ValueError("empty dataset")
    groups = defaultdict(
        lambda: {"images": Counter(), "tiles": Counter(), "test_pixels": 0, "reduced_pixels": 0}
    )
    seen = set()
    max_pixels = max_tiles = 0
    file_hashes = {}
    for s in samples:
        path = Path(s.path).resolve()
        if path in seen or s.dataset != dataset or s.split not in ("train", "calib", "test"):
            raise ValueError("duplicate path, wrong dataset or invalid split")
        seen.add(path)
        file_hashes[str(path)] = digest(path)
        if s.label not in (0, 1) or (s.split != "test" and (s.label != 0 or s.mask)):
            raise ValueError("invalid label or non-good training/calibration")
        with Image.open(path) as image:
            w, h = image.size
        pixels = h * w
        tiles = len(tile_boxes(h, w))
        max_pixels, max_tiles = max(max_pixels, pixels), max(max_tiles, tiles)
        g = groups[s.category]
        g["images"][f"{s.split}_{s.label}"] += 1
        g["tiles"][s.split] += tiles
        g.setdefault("dimensions", Counter())[f"{w}x{h}"] += 1
        if s.split == "test":
            g["test_pixels"] += pixels
            scale = min(1, 256 / max(h, w))
            g["reduced_pixels"] += max(1, round(h * scale)) * max(1, round(w * scale))
        if s.label == 1:
            if not s.mask:
                raise ValueError(f"missing defect mask: {path.name}")
            import numpy as np

            union = np.zeros((h, w), dtype=bool)
            for component in s.mask.split(";"):
                file_hashes[str(Path(component).resolve())] = digest(component)
                with Image.open(component) as mask:
                    if mask.size != (w, h):
                        raise ValueError(f"mask geometry mismatch: {Path(component).name}")
                    union |= np.asarray(mask.convert("L")) > 127
                g.setdefault("mask_components", 0)
                g["mask_components"] += 1
            union_nonempty = bool(union.any())
            if not union_nonempty:
                raise ValueError(f"empty defect mask union: {path.name}")
            g.setdefault("masked_defects", 0)
            g["masked_defects"] += 1
    expected = (
        set(expected_categories)
        if expected_categories is not None
        else ({"carpet", "grid", "leather", "tile", "wood"} if dataset == "mvtec" else set(groups))
    )
    if set(groups) != expected:
        raise ValueError(
            f"category coverage mismatch: expected {sorted(expected)}, got {sorted(groups)}"
        )
    for category, g in groups.items():
        if any(g["images"][key] == 0 for key in ("train_0", "calib_0", "test_0", "test_1")):
            raise ValueError(f"incomplete category splits/labels: {category}")
    return {
        "dataset": dataset,
        "file_sha256": file_hashes,
        "categories": dict(groups),
        "max_image_pixels": max_pixels,
        "max_image_tiles": max_tiles,
        "train_tiles": sum(g["tiles"]["train"] for g in groups.values()),
        "calib_tiles": sum(g["tiles"]["calib"] for g in groups.values()),
        "test_tiles": sum(g["tiles"]["test"] for g in groups.values()),
    }


def host_resources():
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        mem[key] = int(value.strip().split()[0]) * 1024
    available = mem["MemAvailable"]
    limits = []
    for limit_path, used_path in (
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        (
            "/sys/fs/cgroup/memory/memory.limit_in_bytes",
            "/sys/fs/cgroup/memory/memory.usage_in_bytes",
        ),
    ):
        p = Path(limit_path)
        if p.exists() and p.read_text().strip() != "max":
            limit = int(p.read_text())
            used = int(Path(used_path).read_text())
            available = min(available, max(0, limit - used))
            limits.append({"limit": limit, "used": used})
    return {
        "physical_bytes": mem["MemTotal"],
        "available_bytes": available,
        "cgroup": limits,
        "rss_peak_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "disk_free_bytes": shutil.disk_usage("/kaggle/working").free,
    }


def resource_budget(inv, host):
    # Deliberately overcount pixel sort/AUPRO temporaries and tile copies; runtime gate,
    # not a measured full-data RSS claim. Training list dies before category evaluation.
    train = inv["train_tiles"] * (392 * 392 * 3 + 256) * 2
    evaluation = max(
        10 * g["test_pixels"] + 256 * g["reduced_pixels"] for g in inv["categories"].values()
    )
    scratch = inv["max_image_pixels"] * 24 + inv["max_image_tiles"] * 392 * 392 * 8
    required = max(train, evaluation) + scratch + 4 * GIB
    seconds = 2 * (
        10000 * 1.232407
        + 33.080815054 * inv["train_tiles"] / 4032
        + 103.953771503 * (inv["test_tiles"] + inv["calib_tiles"]) / 1872
        + 1800
    )
    budget = {
        "host_required_bytes": required,
        "host_available_bytes": host["available_bytes"],
        "conservative_seconds": seconds,
        "assumption": "T4 AMP batch16; doubled pilot throughput plus 30min setup before doubling",
    }
    if required > host["available_bytes"] * 0.8:
        raise RuntimeError(f"host RAM gate failed: {budget}")
    if seconds > 10 * 3600 or host["disk_free_bytes"] < 5 * GIB:
        raise RuntimeError(f"time/disk gate failed: {budget}")
    return budget


def validate_rows(rows, inv):
    cats = inv["categories"]
    if len(rows) != len(cats) or {r["category"] for r in rows} != set(cats):
        raise RuntimeError("result category coverage mismatch")
    for row in rows:
        if (
            set(row) != ROW_KEYS
            or row["dataset"] != inv["dataset"]
            or row["mode"] != "unified"
            or row["method"] != "dinomaly_vitb"
            or row["perturbation"] is not None
        ):
            raise RuntimeError("result contract mismatch")
        g = cats[row["category"]]["images"]
        if row["n_good"] != g["test_0"] or row["n_defect"] != g["test_1"]:
            raise RuntimeError("result counts mismatch")
        for key in ROW_KEYS - {"dataset", "category", "method", "mode", "perturbation"}:
            value = row[key]
            if value is None or not all(
                math.isfinite(float(x)) for x in (value if isinstance(value, list) else [value])
            ):
                raise RuntimeError(f"missing/nonfinite metric: {key}")


def run(dataset, root, expected, input_bindings, preflight_only=False, gpus=1):
    work = Path("/kaggle/working")
    work.mkdir(exist_ok=True)
    started = time.monotonic()
    stdout, stderr = sys.stdout, sys.stderr
    with (work / "log.txt").open("w", buffering=1) as log:
        sys.stdout, sys.stderr = Tee(stdout, log), Tee(stderr, log)
        try:
            actual = {name: digest(root / name) for name in expected}
            if actual != expected:
                raise RuntimeError("mounted source hash mismatch")
            import torch

            if not torch.cuda.is_available() or torch.cuda.get_device_name(0) != "Tesla T4":
                raise RuntimeError("pilot requires Tesla T4; refresh pilot before other GPU")
            if gpus == 2 and torch.cuda.device_count() != 2:
                raise RuntimeError("DDP requires exactly two visible CUDA devices")
            devices = []
            for index in range(gpus):
                free_i, total_i = torch.cuda.mem_get_info(index)
                devices.append(
                    {
                        "index": index,
                        "name": torch.cuda.get_device_name(index),
                        "free_bytes": free_i,
                        "total_bytes": total_i,
                    }
                )
                if free_i < 10 * GIB or total_i < 12 * GIB:
                    raise RuntimeError("insufficient memory on selected CUDA device")
            free, total = torch.cuda.mem_get_info()
            if free < 10 * GIB or total < 12 * GIB:
                raise RuntimeError("insufficient GPU memory for pilot configuration")
            provenance = {
                "dataset": dataset,
                "kernel_id": (
                    f"anastabba/texpilot-a2-{dataset}-{'ddp2' if gpus == 2 else 'amp'}-10k"
                ),
                "source_slug": SOURCES[dataset],
                "code_root": str(root),
                "source_hashes": actual,
                "upstream_commit": PIN,
                "python": platform.python_version(),
                "packages": {
                    p: importlib.metadata.version(p)
                    for p in ("torch", "timm", "numpy", "scipy", "scikit-learn", "Pillow")
                },
                "settings": {
                    "method": "dinomaly_vitb",
                    "amp": True,
                    "mode": "unified",
                    "iters": 10000,
                    "smoke": False,
                    "seed": 2026,
                    "batch_size": 16,
                    "tile": 392,
                    "overlap": 0.25,
                },
                "gpu": torch.cuda.get_device_name(0),
                "gpu_free_bytes": free,
                "gpu_total_bytes": total,
                "kernel_environment": {
                    k: os.environ[k] for k in ("KAGGLE_KERNEL_RUN_TYPE",) if k in os.environ
                },
                "input_bindings": input_bindings,
                "cuda_devices": devices,
                "training_world_size": gpus,
            }
            write(work / "provenance.json", provenance)
            samples = load_samples(dataset, False)
            from training.fault.kaggle.common import dataset_root

            expected_categories = None
            if dataset == "wfdd":
                folder = dataset_root("WFDD") / "WFDD"
                expected_categories = {
                    p.name for p in folder.iterdir() if p.is_dir() and not p.name.startswith(".")
                }
            inv = inventory(samples, dataset, expected_categories)
            save_index(samples, work / "index.csv")
            write(work / "inventory.json", inv)
            resources = host_resources()
            write(work / "resource-summary.json", resources)
            resources["budget"] = resource_budget(inv, resources)
            if gpus == 2:
                memmap_bytes = inv["train_tiles"] * 392 * 392 * 3
                resources["budget"]["ddp_memmap_bytes"] = memmap_bytes
                if resources["disk_free_bytes"] < memmap_bytes + 6 * GIB:
                    raise RuntimeError("insufficient disk for DDP tiles and checkpoint reserve")
            write(work / "resource-summary.json", resources)
            if preflight_only:
                print("PREFLIGHT_ONLY: inventory/resource gates passed; no fit or weights")
                write(work / "probe-complete.json", {"status": "passed", "training_started": False})
                return
            repo = work / "repos" / "Dinomaly"
            repo.parent.mkdir(exist_ok=True)
            command("git", "clone", "https://github.com/guojiajeremy/Dinomaly", str(repo))
            command("git", "-C", str(repo), "checkout", PIN)
            for module, package in (("skimage", "scikit-image"), ("tabulate", "tabulate")):
                try:
                    __import__(module)
                except ModuleNotFoundError:
                    command(sys.executable, "-m", "pip", "install", package)
            download_weights(repo, ("dinomaly_vitb",))
            weight = repo / "backbones/weights/dinov2_vitb14_reg4_pretrain.pth"
            provenance["weight_sha256"] = digest(weight)
            if (
                provenance["weight_sha256"]
                != "73182a088cf94833c94b1666d1c99e02fe87e2007bff57b564fb6206e25dba71"
            ):
                raise RuntimeError("weight digest mismatch")
            write(work / "provenance.json", provenance)
            # Recheck allocation after setup and before benchmark tile allocation.
            budget = resource_budget(inv, host_resources())
            if time.monotonic() - started + budget["conservative_seconds"] > 10 * 3600:
                raise RuntimeError("elapsed setup exceeds remaining runtime budget")
            import numpy as np

            from training.fault.bench import run_benchmark
            from training.fault.methods.dinomaly import Dinomaly

            class CheckedDinomaly(Dinomaly):
                def fit(self, train):
                    resources["before_fit"] = host_resources()
                    # Tiles are already allocated here; retain a 4GiB working reserve.
                    if resources["before_fit"]["available_bytes"] < 4 * GIB:
                        raise RuntimeError("insufficient RAM after tile allocation")
                    super().fit(train)
                    resources["after_fit"] = host_resources()

                def score_tiles(self, tiles):
                    maps = super().score_tiles(tiles)
                    if len(maps) != len(tiles) or any(
                        m.shape != (392, 392) or not np.isfinite(m).all() for m in maps
                    ):
                        raise RuntimeError("invalid/nonfinite score maps")
                    return maps

            model = CheckedDinomaly(
                str(repo), backbone="dinov2reg_vit_base_14", iters=10000, amp=True, gpus=gpus
            )
            torch.cuda.reset_peak_memory_stats()
            output = work / "results" / f"{dataset}__dinomaly_vitb_amp__unified.json"
            result = run_benchmark(model, samples, output, mode="unified")
            validate_rows(json.loads(output.read_text()), inv)
            provenance["training"] = model.training_provenance
            write(work / "provenance.json", provenance)
            resources.update(
                {
                    "final": host_resources(),
                    "gpu_peak_allocated": torch.cuda.max_memory_allocated(),
                    "timing": result["timing"],
                    "wall_seconds": time.monotonic() - started,
                }
            )
            write(work / "resource-summary.json", resources)
            print("FIT_AND_METRICS_COMPLETE", dataset, result["timing"])
        finally:
            cleanup()
            sys.stdout, sys.stderr = stdout, stderr
    # Extracted source is an input, never a retained output.
    shutil.rmtree(work / "code", ignore_errors=True)
    allowed = {
        "log.txt",
        "provenance.json",
        "index.csv",
        "inventory.json",
        "resource-summary.json",
        f"results/{dataset}__dinomaly_vitb_amp__unified.json",
    }
    files = {str(p.relative_to(work)): p for p in work.rglob("*") if p.is_file()}
    if set(files) != allowed:
        raise RuntimeError(f"output inventory mismatch: {sorted(set(files) ^ allowed)}")
    write(work / "output-manifest.json", {name: digest(path) for name, path in files.items()})

    print("SUCCESS: output inventory and hashes complete", dataset)
