"""Private per-category MuSc/anomalib benchmark; no work occurs on import."""

import gc
import importlib.metadata
import sys
import time
import traceback
import zipfile
from pathlib import Path

DATASET = "mvtec"
METHODS = ("musc", "patchcore", "reverse_distillation")
SMOKE = True
MODE = "per_category"
PIN = "b76b93da8bd3096a99964a96ae29d46f197a0651"
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


def make_method(name, repo, smoke):
    if name == "musc":
        from training.fault.methods.musc import MuSc

        return MuSc(str(repo))
    if name == "patchcore":
        from training.fault.methods.anomalib_methods import PatchCore

        return PatchCore(max_train_tiles=200 if smoke else 2000)
    if name == "reverse_distillation":
        from training.fault.methods.anomalib_methods import ReverseDistillation

        return ReverseDistillation()
    raise ValueError(f"unknown method: {name}")


def main():
    WORK.mkdir(exist_ok=True)
    sys.path.insert(0, str(code_root()))
    from training.fault.kaggle.common import Tee, cleanup, command, load_samples

    failures = 0
    with (WORK / "log.txt").open("w", buffering=1) as log:
        stdout, stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = Tee(stdout, log), Tee(stderr, log)
        try:
            command(sys.executable, "-m", "pip", "install", "anomalib")
            import torch

            from training.fault.bench import run_benchmark

            for package in ("anomalib", "lightning", "torch", "numpy"):
                print(f"{package}={importlib.metadata.version(package)}")
            if not torch.cuda.is_available():
                raise RuntimeError("GPU required")
            print(f"GPU={torch.cuda.get_device_name(0)} MuSc_pin={PIN}")
            dataset = "mvtec" if SMOKE else DATASET
            names = ("musc", "patchcore") if SMOKE else METHODS
            repo = WORK / "repos" / "MuSc"
            # Clone only MuSc: repo-backed methods use conflicting top-level packages.
            for name in names:
                started = time.perf_counter()
                torch.cuda.reset_peak_memory_stats()
                method = None
                try:
                    if name == "musc":
                        # ftfy is imported by MuSc's vendored open_clip tokenizer.
                        try:
                            __import__("ftfy")
                        except ModuleNotFoundError:
                            command(sys.executable, "-m", "pip", "install", "ftfy")
                        repo.parent.mkdir(exist_ok=True)
                        command("git", "clone", "https://github.com/xrli-U/MuSc", str(repo))
                        command("git", "-C", str(repo), "checkout", PIN)
                    samples = load_samples(dataset, SMOKE)
                    print(f"START {dataset} {name} mode={MODE} samples={len(samples)}")
                    method = make_method(name, repo, SMOKE)
                    result = run_benchmark(
                        method,
                        samples,
                        WORK / "results" / f"{dataset}__{name}__{MODE}.json",
                        mode=MODE,
                    )
                    if not result["rows"]:
                        raise RuntimeError("benchmark returned no rows")
                    print(f"SUCCESS {dataset} {name}")
                except Exception:
                    failures += 1
                    traceback.print_exc()
                finally:
                    torch.cuda.synchronize()
                    print(
                        f"RUN {dataset} {name} wall_seconds={time.perf_counter() - started:.3f} "
                        f"peak_gpu_bytes={torch.cuda.max_memory_allocated()}"
                    )
                    del method
                    gc.collect()
                    torch.cuda.empty_cache()
        finally:
            cleanup()
            sys.stdout, sys.stderr = stdout, stderr
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
