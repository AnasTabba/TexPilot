"""Isolated private full A2; --preflight-only validates data/resources without fit."""

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
        "b96b3a93e9c52bce727090caf8f83e44e7c6ce69439919b8d9b1339402651a81"
    ),
    "training/fault/methods/_upstream.py": (
        "f79b4230f620ab3662cb6b73f74268155e934f837f14380eab8e39b9d5bd7bf3"
    ),
    "training/fault/kaggle/common.py": (
        "ae29b8bc93c3b6e9f8497d6bb96db88500c89aedb82c7ef7027c0dfc2a4b861b"
    ),
    "training/fault/kaggle/full_a2.py": (
        "daf544acc1e03b247cc9e6dc96456a2ac9030da3b2fdb7d56821e8e46e8824b1"
    ),
}

INPUT_BINDINGS = [
    "anastabba/texpilot-fault-code/7",
    "hodinhtrieu/the-woven-fabric-defect-detection-wfdd/1",
]

if __name__ == "__main__":
    sys.argv = [sys.argv[0], "--preflight-only"]
    if sys.argv[1:] not in ([], ["--preflight-only"]):
        raise SystemExit("only --preflight-only is supported")
    if sys.argv[1:]:
        import signal

        signal.alarm(900)  # bounded inventory/resource probe, Linux Kaggle
    root = code_root()
    sys.path.insert(0, str(root))
    from training.fault.kaggle.full_a2 import run

    run(DATASET, root, EXPECTED, INPUT_BINDINGS, preflight_only=bool(sys.argv[1:]))
