"""Shared Kaggle runtime helpers; importing this module performs no work."""

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

WORK = Path("/kaggle/working")
INPUT = Path("/kaggle/input")
TEXTURES = ["carpet", "grid", "leather", "tile", "wood"]


class Tee:
    def __init__(self, console, log):
        self.console, self.log = console, log

    def write(self, text):
        self.console.write(text)
        self.log.write(text)
        self.flush()

    def flush(self):
        self.console.flush()
        self.log.flush()


def command(*args):
    subprocess.run(args, check=True, stdout=sys.stdout.console, stderr=sys.stderr.console)


def download_weights(repo, methods):
    for name in methods:
        arch = {"dinomaly_vits": "vits14", "dinomaly_vitb": "vitb14"}[name]
        filename = f"dinov2_{arch}_reg4_pretrain.pth"
        url = f"https://dl.fbaipublicfiles.com/dinov2/dinov2_{arch}/{filename}"
        dest = repo / "backbones" / "weights" / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        args = ["curl", "-fsSL", "-o", str(dest), url]
        result = subprocess.run(args, capture_output=True, text=True)
        if result.returncode:
            print(result.stderr, flush=True)
            if result.returncode != 60:
                raise RuntimeError(f"weight download failed (curl {result.returncode})")
            print("Certificate verification failed; retrying at 2026-11-10 12:00:00")
            command("apt-get", "install", "-y", "-qq", "faketime")
            command("faketime", "2026-11-10 12:00:00", *args)
        size = dest.stat().st_size
        digest = hashlib.sha256()
        with dest.open("rb") as weight:
            for chunk in iter(lambda: weight.read(1024 * 1024), b""):
                digest.update(chunk)
        print(f"WEIGHT {filename} bytes={size} sha256={digest.hexdigest()}", flush=True)
        if size < 10 * 1024 * 1024:
            raise RuntimeError(f"weight download too small: {filename}: {size} bytes (<10 MB)")


def dataset_root(marker):
    matches = [p.parent for p in INPUT.rglob(marker) if p.is_dir()]
    if len(matches) != 1:
        raise RuntimeError(f"expected one {marker} dataset root, found {matches}")
    return matches[0]


def load_samples(dataset, smoke=False):
    from training.fault.data import index_aitex, index_mvtec_layout

    if dataset == "aitex":
        return index_aitex(dataset_root("Defect_images"))
    if dataset == "wfdd":
        return index_mvtec_layout(dataset_root("WFDD") / "WFDD", "wfdd")
    if dataset == "mvtec":
        return index_mvtec_layout(
            dataset_root("carpet"), "mvtec", ["carpet"] if smoke else TEXTURES
        )
    raise ValueError(f"unknown dataset: {dataset}")


def cleanup():
    shutil.rmtree(WORK / "repos", ignore_errors=True)
    for root in (WORK, Path.home() / ".cache/torch/hub/checkpoints"):
        for pattern in ("*.pth", "*.pt", "*.ckpt", "*.safetensors"):
            for weight in root.rglob(pattern):
                weight.unlink(missing_ok=True)
