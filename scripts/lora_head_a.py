"""A probe Head A on a LoRA run's encoder, like scanner-v5's (frozen SigLIP 2 + MLP), so custom
heads keep working: write the run's adapters (lora.safetensors, a few MB: what you download),
cache centre-crop features with the merged encoder (probe.py --weights-file), pick an MLP head
on val (head_search, 3 seeds) and export it calibrated (export_probe_head).

    python scripts/lora_head_a.py --run runs/fabric/<tag>/seed0 --split-csv fabric.csv \\
        --data-root data --out out/<tag>

Locally, rebuild the encoder from the adapters with training/scanner/apply_lora.py.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import torch
from safetensors.torch import save_file

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # run as a script: repo root on the path
from training.textilenet.splits import base_partition  # noqa: E402


def run(*argv: str) -> None:
    print("+", " ".join(argv), flush=True)
    subprocess.run([sys.executable, "-m", *argv], check=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", type=Path, required=True, help="train.py --lora-rank run dir")
    ap.add_argument("--split-csv", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--work", type=Path, help="merged encoder + features (default: <out>/work)")
    ap.add_argument("--seeds", nargs="+", default=["0", "1", "2"])
    ap.add_argument("--partition", default="fabric", help="or a scope such as fabric24")
    ap.add_argument("--batch-size", default="64")
    ap.add_argument("--workers", default="4")
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args(argv)
    work = args.work or args.out / "work"
    work.mkdir(parents=True, exist_ok=True)

    ck = torch.load(args.run / "best.pt", map_location="cpu", weights_only=False)
    if not ck.get("lora"):
        raise SystemExit(f"{args.run} has no saved adapters (train.py --lora-rank)")
    meta = {"scale": str(ck["lora_scale"]), "timm_name": ck["timm_name"], "best": str(ck["best"])}
    size = str(ck["img_size"])
    lora = {k: v.contiguous() for k, v in ck["lora"].items()}
    save_file(lora, str(args.out / "lora.safetensors"), metadata=meta)
    encoder = work / "encoder.safetensors"
    weights = {k: v.contiguous() for k, v in ck["model"].items() if not k.startswith("head.")}
    save_file(weights, str(encoder))
    del ck, weights

    feats, csv, root = work / "features", str(args.split_csv), str(args.data_root)
    name = f"{meta['timm_name']}_{size}"
    run(
        "training.textilenet.probe",
        "--partition",
        args.partition,
        "--model",
        meta["timm_name"],
        "--img-size",
        size,
        "--weights-file",
        str(encoder),
        "--split-csv",
        csv,
        "--data-root",
        root,
        "--feature-dir",
        str(feats),
        "--out",
        str(work / "probe"),
        "--tag",
        "lora_linear",
        "--epochs",
        "20",
        "--select",
        "macro_f1",
        "--seeds",
        "0",
        "--batch-size",
        args.batch_size,
        "--workers",
        args.workers,
        "--device",
        args.device,
    )
    run(
        "training.textilenet.head_search",
        "--partition",
        args.partition,
        "--split-csv",
        csv,
        "--features",
        name,
        "--feature-dir",
        str(feats / base_partition(args.partition)),
        "--kinds",
        "mlp",
        "--epochs",
        "30",
        "--hidden",
        "1024",
        "--dropout",
        "0.2",
        "--seeds",
        *args.seeds,
        "--device",
        args.device,
        "--out",
        str(args.out / "heads"),
    )
    run(
        "training.scanner.export_probe_head",
        "--partition",
        args.partition,
        "--tune-bias",
        "--run",
        str(args.out / "heads" / "mlp_vit"),
        "--split-csv",
        csv,
        "--feature-dir",
        str(feats),
        "--out",
        str(args.out / "head_a"),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
