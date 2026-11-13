"""Private Kaggle Dinomaly benchmark; change only the settings below for a run."""

import gc
import importlib
import json
import sys
import time
import traceback
import zipfile
from pathlib import Path

DATASET = "mvtec"
METHOD = "dinomaly_vitb"
ITERS = 10000
AMP = True
MODE = "unified"
SMOKE = False


PIN = "1f252be03a918789b19848f0ca37166e7c28dada"
WORK = Path("/kaggle/working")
INPUT = Path("/kaggle/input")


def code_root():
    roots = list(INPUT.rglob("training/fault/bench.py"))
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


def main():
    WORK.mkdir(exist_ok=True)
    sys.path.insert(0, str(code_root()))
    from training.fault.kaggle.common import (
        Tee,
        cleanup,
        command,
        download_weights,
        load_samples,
    )
    with (WORK / "log.txt").open("w", buffering=1) as log:
        stdout, stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = Tee(stdout, log), Tee(stderr, log)
        failures = 0
        repo = WORK / "repos" / "Dinomaly"
        try:
            repo.parent.mkdir(exist_ok=True)
            command("git", "clone", "https://github.com/guojiajeremy/Dinomaly", str(repo))
            command("git", "-C", str(repo), "checkout", PIN)
            for module, package in (("skimage", "scikit-image"), ("tabulate", "tabulate")):
                try:
                    importlib.import_module(module)
                except ModuleNotFoundError:
                    command(sys.executable, "-m", "pip", "install", package)
            import timm
            import torch

            from training.fault.bench import run_benchmark
            from training.fault.methods.dinomaly import Dinomaly

            print(f"torch={torch.__version__} timm={timm.__version__}")
            if not torch.cuda.is_available():
                raise RuntimeError("GPU required")
            print(f"GPU={torch.cuda.get_device_name(0)} pin={PIN}")
            dataset = "mvtec" if SMOKE else DATASET
            iters = 300 if SMOKE else ITERS
            download_weights(repo, (METHOD,))
            amp = AMP
            name = METHOD
            label = f"{name}_{'amp' if amp else 'fp32'}"
            started = time.perf_counter()
            torch.cuda.reset_peak_memory_stats()
            method = None
            try:
                samples = load_samples(dataset, SMOKE)
                print(
                    f"START {dataset} {label} mode={MODE} "
                    f"iters={iters} samples={len(samples)}"
                )
                backbone = {
                    "dinomaly_vits": "dinov2reg_vit_small_14",
                    "dinomaly_vitb": "dinov2reg_vit_base_14",
                }[name]
                method = Dinomaly(str(repo), backbone=backbone, iters=iters, amp=amp)
                result = run_benchmark(
                    method,
                    samples,
                    WORK / "results" / f"{dataset}__{label}__{MODE}.json",
                    mode=MODE,
                )
                if not result["rows"]:
                    raise RuntimeError("benchmark returned no rows")
                print(f"PHASE {dataset} {label} {json.dumps(result['timing'])}")
                print(f"SUCCESS {dataset} {label}")
            except Exception:
                failures += 1
                traceback.print_exc()
            finally:
                torch.cuda.synchronize()
                print(
                    f"RUN {dataset} {label} "
                    f"wall_seconds={time.perf_counter() - started:.3f} "
                    f"peak_gpu_bytes={torch.cuda.max_memory_allocated()}"
                )
                del method
                gc.collect()
                torch.cuda.empty_cache()
        finally:
            cleanup()
            sys.stdout, sys.stderr = stdout, stderr
        if failures:
            raise RuntimeError(f"{failures} dataset/method runs failed; see log.txt")


if __name__ == "__main__":
    main()
