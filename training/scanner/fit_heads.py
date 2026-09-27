"""Fit the scanner's structure and fibre-family heads on cached DINOv2 features. Spec §6.

    python -m training.scanner.fit_heads --fabric-split data/splits/prelim/fabric.csv \
        --fibre-split data/splits/prelim/fibre.csv --out models/scanner-v1 --version 1

Selection and calibration use val only; test metrics are reported, never tuned on.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import torch

from services.vision.backbone import CROP_PCT, IMG_SIZE, TIMM_NAME
from services.vision.heads import HeadSpec, save_bundle, softmax
from services.vision.runtime import pick_device
from services.vision.taxonomy import FABRIC_CLASSES, family_of
from training.scanner.calibration import abstain_threshold, ece, fit_temperature
from training.textilenet.feature_cache import FeatureCache
from training.textilenet.metrics import summarize
from training.textilenet.probe import GRID, fit_linear
from training.textilenet.splits import read_csv

FAMILIES_TRAINED = ("cellulosic", "protein", "synthetic")  # no blend images exist (spec §6.1)
IMAGENET_MEAN, IMAGENET_STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


def load_xy(split_csv: Path, partition: str, feature_dir: Path, classes, label_of):
    rows = read_csv(split_csv)
    cache = FeatureCache(feature_dir / partition / f"dinov2_vitb14_{IMG_SIZE}")
    missing = cache.missing([r.path for r in rows])
    if missing:
        raise SystemExit(
            f"{len(missing)} {partition} images have no cached features; run "
            f"training.textilenet.probe on {split_csv} first"
        )
    x = cache.assemble([r.path for r in rows]).astype(np.float32)
    y = np.array([classes.index(label_of(r.label)) for r in rows])
    split = np.array([r.split for r in rows])
    return {s: (x[split == s], y[split == s]) for s in ("train", "val", "test")}


def fit_head(data, classes, device, epochs: int, target: float) -> tuple[HeadSpec, dict]:
    (xtr, ytr), (xva, yva), (xte, yte) = data["train"], data["val"], data["test"]
    mu, sd = xtr.mean(0), xtr.std(0) + 1e-6
    t = lambda a: torch.from_numpy((a - mu) / sd).to(device)  # noqa: E731
    tr, va = (t(xtr), torch.from_numpy(ytr).to(device)), t(xva)
    best = None
    for lr, wd in GRID:
        head = fit_linear(*tr, len(classes), lr, wd, epochs, 0, device)
        with torch.no_grad():
            acc = (head(va).argmax(1).cpu().numpy() == yva).mean()
        if best is None or acc > best[0]:
            best = (acc, lr, wd, head)
    _, lr, wd, head = best
    w = head.weight.detach().cpu().numpy() / sd  # fold standardisation into the head
    b = head.bias.detach().cpu().numpy() - (head.weight.detach().cpu().numpy() * (mu / sd)).sum(1)
    logits_va, logits_te = xva @ w.T + b, xte @ w.T + b
    temp = fit_temperature(logits_va, yva)
    p_va = softmax(logits_va, temp)
    tau, coverage = abstain_threshold(p_va.max(1), p_va.argmax(1) == yva, target)
    spec = HeadSpec(tuple(classes), w.astype(np.float32), b.astype(np.float32), temp, tau)
    info = {
        "lr": lr,
        "wd": wd,
        "target_accuracy": target,
        "coverage_val": coverage,
        "ece_val_before": ece(softmax(logits_va), yva),
        "ece_val_after": ece(p_va, yva),
        "val": {
            k: v
            for k, v in summarize(logits_va, yva, list(classes)).items()
            if k in ("top1", "top5", "macro_f1", "n")
        },
        "test": {
            k: v
            for k, v in summarize(logits_te, yte, list(classes)).items()
            if k in ("top1", "top5", "macro_f1", "n")
        },
    }
    return spec, info


def sha1(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--fabric-split", type=Path, required=True)
    ap.add_argument("--fibre-split", type=Path, required=True)
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features"))
    ap.add_argument("--out", type=Path, default=Path("models/scanner-v1"))
    ap.add_argument("--version", type=int, default=1)
    ap.add_argument(
        "--target", type=float, default=0.90, help="val accuracy among kept predictions"
    )
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    device = pick_device(args.device)

    fabric = load_xy(args.fabric_split, "fabric", args.feature_dir, list(FABRIC_CLASSES), str)
    fibre = load_xy(args.fibre_split, "fibre", args.feature_dir, list(FAMILIES_TRAINED), family_of)
    specs, infos = {}, {}
    for name, data, classes in (
        ("structure", fabric, FABRIC_CLASSES),
        ("fibre_family", fibre, FAMILIES_TRAINED),
    ):
        specs[name], infos[name] = fit_head(data, classes, device, args.epochs, args.target)
        print(name, json.dumps({k: infos[name][k] for k in ("val", "test", "coverage_val")}))

    meta = {
        "version": args.version,
        "created": date.today().isoformat(),
        "backbone": {
            "timm_name": TIMM_NAME,
            "img_size": IMG_SIZE,
            "crop_pct": CROP_PCT,
            "mean": list(IMAGENET_MEAN),
            "std": list(IMAGENET_STD),
        },
        "views": "crop",
        "splits": {
            "fabric": {"path": str(args.fabric_split), "sha1": sha1(args.fabric_split)},
            "fibre": {"path": str(args.fibre_split), "sha1": sha1(args.fibre_split)},
        },
        "heads": infos,
    }
    save_bundle(args.out, meta, specs)
    card = [
        f"# scanner-v{args.version}",
        "",
        f"Created {meta['created']}. Frozen DINOv2 "
        "ViT-B/14 + calibrated linear heads. Catalog-domain numbers (TextileNet).",
        "",
    ]
    for name, info in infos.items():
        card.append(
            f"- **{name}**: test top-1 {info['test']['top1']:.3f}, val coverage "
            f"{info['coverage_val']:.2f} at {info['target_accuracy']:.0%} target, "
            f"ECE {info['ece_val_before']:.3f} → {info['ece_val_after']:.3f}"
        )
    card += [
        "",
        "Limitations: trained on catalog photos, not phone photos; fibre family "
        "has no blend class (blends come from the label).",
    ]
    (args.out / "MODEL_CARD.md").write_text("\n".join(card) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
