"""Turn the best fine-tuned TextileNet fabric model into a calibrated scanner Head A.
Spec §6.3 (calibration, abstention) and §10 (week 5: fine-tuned Head A swapped in).

Runs on the GPU box after the benchmark (`run_all.sh headA`). The run is chosen by val
top-1, temperature and threshold are fitted on val, and test is only reported, so no
choice ever sees test. Copy the output folder to the Mac and install it into a bundle
with training/scanner/install_head_a.py.

    python -m training.scanner.export_head_a --runs runs/fabric --out runs/head_a
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

from services.vision.heads import softmax
from training.scanner.calibration import abstain_threshold, ece, fit_temperature


def best_run(runs_root: Path) -> Path:
    """The finished run (<model>/seed<k>/) with the best val top-1."""
    finished = [
        (json.loads((d / "test_metrics.json").read_text())["best"]["val_top1"], d)
        for d in sorted(Path(runs_root).glob("*/seed*"))
        if (d / "test_metrics.json").exists() and (d / "best.pt").exists()
    ]
    if not finished:
        raise SystemExit(f"no finished run (best.pt + test_metrics.json) under {runs_root}")
    return max(finished, key=lambda pair: pair[0])[1]


def calibrate(val: tuple, test: tuple, target: float = 0.90) -> dict:
    """val, test: (logits, labels). Temperature and abstain threshold come from val only."""
    (lv, yv), (lt, yt) = val, test
    temperature = fit_temperature(lv, yv)
    pv = softmax(lv, temperature)
    threshold, _ = abstain_threshold(pv.max(1), pv.argmax(1) == yv, target)

    def report(logits: np.ndarray, y: np.ndarray) -> dict:
        p = softmax(logits, temperature)
        keep = p.max(1) >= threshold
        right = p.argmax(1) == y
        return {
            "n": int(len(y)),
            "top1": float(right.mean()),
            "coverage": float(keep.mean()),
            "accuracy_kept": float(right[keep].mean()) if keep.any() else None,
            "ece_before": ece(softmax(logits), y),
            "ece_after": ece(p, y),
        }

    return {
        "temperature": float(temperature),
        "threshold": float(threshold),
        "target_accuracy": target,
        "val": report(lv, yv),
        "test": report(lt, yt),
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    import contextlib

    import torch
    from safetensors.torch import save_file
    from torch.utils.data import DataLoader

    from services.vision.heads import timm_classifier
    from training.textilenet.data import TextileDataset, load_rows
    from training.textilenet.recipe import predict
    from training.textilenet.train import build_transforms

    run = args.run or best_run(args.runs)
    ck = torch.load(run / "best.pt", map_location="cpu", weights_only=False)
    classes, size, crop = list(ck["classes"]), ck["img_size"], ck["crop_pct"]
    mean, std = list(ck["data_cfg"]["mean"]), list(ck["data_cfg"]["std"])
    device = torch.device(args.device if args.device != "auto" else
                          ("cuda" if torch.cuda.is_available() else "cpu"))  # fmt: skip
    model = timm_classifier(ck["timm_name"], len(classes), size)
    model.load_state_dict(ck["model"])
    model = model.to(device)

    _, eval_tf = build_transforms(size, mean, std, crop)
    rows = load_rows(args.split_csv, args.data_root)
    labels = {c: i for i, c in enumerate(classes)}
    amp = (lambda: torch.autocast("cuda", dtype=torch.bfloat16)) if device.type == "cuda" \
        else contextlib.nullcontext  # fmt: skip
    scores = {}
    for split in ("val", "test"):
        ds = TextileDataset(rows[split], args.data_root, labels, eval_tf, math.ceil(size / crop))
        loader = DataLoader(ds, batch_size=args.batch_size, num_workers=args.workers)
        scores[split] = predict(model, loader, device, amp, False)
    cal = calibrate(scores["val"], scores["test"], args.target)

    args.out.mkdir(parents=True, exist_ok=True)
    weights = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_file(weights, str(args.out / "model.safetensors"))
    head = {
        "classes": classes,
        "timm_name": ck["timm_name"],
        "img_size": size,
        "crop_pct": crop,
        "mean": mean,
        "std": std,
        "source_run": str(run),
        "domain": "catalog (TextileNet fabric)",
        **cal,
    }
    (args.out / "head.json").write_text(json.dumps(head, indent=1))
    v, t = cal["val"], cal["test"]
    print(f"{run}: val top-1 {v['top1']:.3f}, test top-1 {t['top1']:.3f} (catalog, n={t['n']}); "
          f"answers {t['coverage']:.0%} of test at {t['accuracy_kept']} accuracy; "
          f"ECE {t['ece_before']:.3f} -> {t['ece_after']:.3f}. Wrote {args.out}")  # fmt: skip
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--runs", type=Path, default=Path("runs/fabric"), help="searched by val top-1")
    ap.add_argument("--run", type=Path, help="export this run instead of searching")
    ap.add_argument("--split-csv", type=Path, default=Path("data/splits/fabric.csv"))
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--out", type=Path, default=Path("runs/head_a"))
    ap.add_argument("--target", type=float, default=0.90, help="val accuracy among kept answers")
    ap.add_argument("--batch-size", type=int, default=128)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--device", default="auto")
    return ap.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
