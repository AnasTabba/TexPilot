import sys
import zipfile
from pathlib import Path

INPUT = Path("/kaggle/input")
WORK = Path("/kaggle/working")


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


EXPECTED = {
    "training/fault/__init__.py": (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    ),
    "training/fault/bench.py": (
        "81185a672b16e21a62edd4b5aa2189c5bccdbab6aaad33a00e4a2b65a4546d7f"
    ),
    "training/fault/data.py": (
        "6a80c40a1e822410b2dab621f8bcc16843d4e858ed4b73fa8ae82074379b1f7d"
    ),
    "training/fault/metrics.py": (
        "e5cddf03e327d89ad55df0b2a766408df616aa2c31de68a39434564d1a1f91fb"
    ),
    "training/fault/tiles.py": (
        "4816ac763dba7c3bb805db45309bed848e3ebe8c54edbf90b5a561782ffb4710"
    ),
    "training/fault/perturb.py": (
        "7a8effc29e7b5538fd82c0ad37e1aaf9447040a0e374a8a56c6601db5cbfcbbb"
    ),
    "training/fault/methods/__init__.py": (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    ),
    "training/fault/methods/dinomaly.py": (
        "62648e3e8678e9a8025b6cb7b75c23acfcf5997ad287dc596cf7df15349ce14f"
    ),
    "training/fault/methods/_upstream.py": (
        "f79b4230f620ab3662cb6b73f74268155e934f837f14380eab8e39b9d5bd7bf3"
    ),
    "training/fault/kaggle/common.py": (
        "ae29b8bc93c3b6e9f8497d6bb96db88500c89aedb82c7ef7027c0dfc2a4b861b"
    ),
    "training/fault/kaggle/full_a2.py": (
        "c9b223cd5f598ac50142bcebcaf2a7a9add0cd4b12feb675e7a012845785ccc0"
    ),
}

INPUT_BINDINGS = ["anastabba/texpilot-fault-code/9"]


def main():
    import gc
    import subprocess
    import threading
    import time

    import numpy as np
    import torch

    from training.fault.kaggle.common import Tee, cleanup, command, download_weights
    from training.fault.kaggle.full_a2 import digest, write
    from training.fault.methods.dinomaly import Dinomaly

    if torch.cuda.device_count() != 2:
        raise RuntimeError("proof requires two visible GPUs, no single-GPU fallback")
    if {torch.cuda.get_device_name(i) for i in range(2)} != {"Tesla T4"}:
        raise RuntimeError("pilot requires T4 pair")
    work = Path("/kaggle/working")
    root = code_root()
    if {p: digest(root / p) for p in EXPECTED} != EXPECTED:
        raise RuntimeError("source hash mismatch")
    original = sys.stdout, sys.stderr
    with (work / "log.txt").open("w", buffering=1) as log:
        sys.stdout, sys.stderr = Tee(original[0], log), Tee(original[1], log)
        try:
            repo = work / "repos/Dinomaly"
            repo.parent.mkdir(exist_ok=True)
            command("git", "clone", "https://github.com/guojiajeremy/Dinomaly", str(repo))
            command("git", "-C", str(repo), "checkout", "1f252be03a918789b19848f0ca37166e7c28dada")
            for mod, package in [("skimage", "scikit-image"), ("tabulate", "tabulate")]:
                try:
                    __import__(mod)
                except ModuleNotFoundError:
                    command(sys.executable, "-m", "pip", "install", package)
            download_weights(repo, ("dinomaly_vitb",))
            tiles = [
                np.random.default_rng(2026 + i).integers(0, 256, (392, 392, 3), dtype=np.uint8)
                for i in range(32)
            ]
            results = {
                "source_hashes": EXPECTED,
                "input_bindings": INPUT_BINDINGS,
                "devices": [torch.cuda.get_device_properties(i).__repr__() for i in range(2)],
                "variants": {},
            }
            for gpus in (1, 2):
                samples = []
                stop = threading.Event()

                def sample(stop=stop, samples=samples):
                    while not stop.is_set():
                        result = subprocess.run(
                            [
                                "nvidia-smi",
                                "--query-gpu=index,uuid,utilization.gpu,memory.used",
                                "--format=csv,noheader,nounits",
                            ],
                            capture_output=True,
                            text=True,
                        )
                        samples.append({"seconds": time.monotonic(), "csv": result.stdout})
                        stop.wait(2)

                monitor = threading.Thread(target=sample, daemon=True)
                monitor.start()
                model = Dinomaly(str(repo), iters=150, batch_size=16, amp=True, gpus=gpus)
                started = time.perf_counter()
                try:
                    model.fit(tiles)
                    wall = time.perf_counter() - started
                    maps = model.score_tiles(tiles[:2])
                    assert len(maps) == 2 and all(np.isfinite(m).all() for m in maps)
                    if gpus == 2:
                        checkpoint = work / "roundtrip.pt"
                        model.save(checkpoint)
                        restored = Dinomaly(str(repo), device="cuda:0", amp=True)
                        restored.load(checkpoint)
                        for a, b in zip(maps, restored.score_tiles(tiles[:2]), strict=True):
                            np.testing.assert_allclose(a, b, rtol=1e-5, atol=1e-5)
                        del restored
                    assert model.training_provenance["optimizer_steps"] == 150
                    assert model.training_provenance["world_size"] == gpus
                    results["variants"][str(gpus)] = {
                        "wall_seconds": wall,
                        "loop_seconds": model.fit_loop_seconds,
                        "training": model.training_provenance,
                        "gpu_samples": samples,
                    }
                finally:
                    stop.set()
                    monitor.join(timeout=10)
                    del model
                    gc.collect()
                    torch.cuda.empty_cache()
                write(work / "proof.json", results)
            results["loop_speedup"] = (
                results["variants"]["1"]["loop_seconds"] / results["variants"]["2"]["loop_seconds"]
            )
            results["wall_speedup"] = (
                results["variants"]["1"]["wall_seconds"] / results["variants"]["2"]["wall_seconds"]
            )
            observed = set()
            for sample in results["variants"]["2"]["gpu_samples"]:
                for line in sample["csv"].splitlines():
                    fields = [v.strip() for v in line.split(",")]
                    if len(fields) == 4 and int(fields[2]) > 0:
                        observed.add(int(fields[0]))
            if observed != {0, 1}:
                raise RuntimeError(f"both-GPU utilization not demonstrated: {observed}")
            results["both_devices_observed_busy"] = True
            write(work / "proof.json", results)
            print(
                "DDP_PROOF_COMPLETE", results["loop_speedup"], results["wall_speedup"], flush=True
            )
        finally:
            cleanup()
            sys.stdout, sys.stderr = original


if __name__ == "__main__":
    import signal

    signal.alarm(1800)
    root = code_root()
    sys.path.insert(0, str(root))
    main()
