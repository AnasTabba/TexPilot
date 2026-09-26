#!/usr/bin/env python3
"""Frozen-backbone linear probe: the cheap first number, runnable on a laptop.

Extracts features once (resumable shards), then fits a linear head on them. Weight
decay and lr are chosen on val; test is evaluated once per seed with that choice.

    python -m training.textilenet.probe --partition fabric --model dinov2_vitb14

For ViTs the feature is [CLS ; mean(patch tokens)], the DINOv2 linear-eval recipe.
Writes runs/<partition>/probe_<model>/seed<k>/test_metrics.json in the same format as
train.py, so ``aggregate`` puts both in one table.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import timm
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Subset

from training.textilenet.data import TextileDataset
from training.textilenet.metrics import summarize
from training.textilenet.splits import class_index, read_csv
from training.textilenet.train import PRESETS, build_transforms, pick_device

SHARD = 8192


@torch.no_grad()
def extract(args: argparse.Namespace, rows, device) -> np.ndarray:
    out_dir = args.feature_dir / args.partition / f"{args.model}_{args.img_size}"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = out_dir / "paths.txt"
    paths = [r.path for r in rows]
    if manifest.exists() and manifest.read_text().splitlines() != paths:
        raise SystemExit(f"{out_dir} was built from a different split; delete it to rebuild")
    manifest.write_text("\n".join(paths))

    name = PRESETS.get(args.model, {"timm_name": args.model})["timm_name"]
    kw = {"img_size": args.img_size} if name.startswith(("vit_", "eva")) else {}
    model = timm.create_model(name, pretrained=True, num_classes=0, **kw).eval().to(device)
    half = device.type in ("cuda", "mps")
    if half:
        model.half()
    cfg = timm.data.resolve_model_data_config(model)
    _, tf = build_transforms(args.img_size, cfg["mean"], cfg["std"], args.crop_pct)
    ds = TextileDataset(
        rows,
        args.data_root,
        class_index(args.partition),
        tf,
        decode_size=math.ceil(args.img_size / args.crop_pct),
    )

    n_shards = math.ceil(len(rows) / SHARD)
    for k in range(n_shards):
        shard = out_dir / f"shard_{k:04d}.npy"
        if shard.exists():
            continue
        idx = range(k * SHARD, min((k + 1) * SHARD, len(rows)))
        loader = DataLoader(Subset(ds, idx), args.batch_size, num_workers=args.workers)
        feats, t0 = [], time.time()
        for x, _ in loader:
            x = x.to(device)
            feats.append(pool(model, x.half() if half else x).float().cpu().numpy())
        np.save(shard.with_suffix(".tmp.npy"), np.concatenate(feats).astype(np.float16))
        shard.with_suffix(".tmp.npy").rename(shard)
        rate = len(idx) / (time.time() - t0)
        eta_min = (n_shards - k - 1) * SHARD / rate / 60
        print(f"shard {k + 1}/{n_shards}: {rate:.0f} img/s, ~{eta_min:.0f} min left", flush=True)
    return np.concatenate([np.load(out_dir / f"shard_{k:04d}.npy") for k in range(n_shards)])


def pool(model, x):
    tokens = model.forward_features(x)
    if tokens.ndim == 3:  # ViT family: [CLS ; mean(patches)]
        prefix = getattr(model, "num_prefix_tokens", 1)
        return torch.cat([tokens[:, 0], tokens[:, prefix:].mean(1)], dim=1)
    return model.forward_head(tokens, pre_logits=True)


def fit_linear(xtr, ytr, n_classes, lr, wd, epochs, seed, device) -> torch.nn.Linear:
    g = torch.Generator().manual_seed(seed)
    torch.manual_seed(seed)
    head = torch.nn.Linear(xtr.shape[1], n_classes).to(device)
    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=wd)
    steps = epochs * math.ceil(len(xtr) / 1024)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.1)
    for _ in range(epochs):
        for idx in torch.randperm(len(xtr), generator=g).split(1024):
            idx = idx.to(device)
            loss = F.cross_entropy(head(xtr[idx]), ytr[idx], label_smoothing=0.1)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
    return head


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--partition", choices=["fabric", "fibre"], required=True)
    ap.add_argument("--model", default="dinov2_vitb14")
    ap.add_argument("--img-size", type=int, default=224)
    ap.add_argument("--crop-pct", type=float, default=0.875)
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features"))
    ap.add_argument("--out", type=Path, default=Path("runs"))
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)

    device = pick_device(args.device)
    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    rows = [
        r
        for r in read_csv(args.data_root / "splits" / f"{args.partition}.csv")
        if (args.data_root / r.path).exists()
    ]
    feats = extract(args, rows, device)

    split = np.array([r.split for r in rows])
    y = np.array([labels[r.label] for r in rows])
    mu = feats[split == "train"].astype(np.float32).mean(0)
    sd = feats[split == "train"].astype(np.float32).std(0) + 1e-6

    def tensors(s):
        x = torch.from_numpy((feats[split == s].astype(np.float32) - mu) / sd).to(device)
        return x, torch.from_numpy(y[split == s]).to(device)

    (xtr, ytr), (xva, yva), (xte, yte) = tensors("train"), tensors("val"), tensors("test")

    @torch.no_grad()
    def logits(head, x):
        return head(x).float().cpu().numpy()

    grid = list(itertools.product([1e-3, 3e-3], [1e-4, 1e-3, 1e-2, 5e-2]))
    scores = {}
    for lr, wd in grid:
        head = fit_linear(xtr, ytr, len(classes), lr, wd, args.epochs, 0, device)
        scores[(lr, wd)] = summarize(logits(head, xva), yva.cpu().numpy(), classes)["top1"]
        print(f"lr {lr:g} wd {wd:g}: val top-1 {scores[(lr, wd)]:.4f}", flush=True)
    lr, wd = max(scores, key=scores.get)
    print(f"selected on val: lr {lr:g} wd {wd:g}")

    tag = f"probe_{args.model}"
    for seed in args.seeds:
        head = fit_linear(xtr, ytr, len(classes), lr, wd, args.epochs, seed, device)
        val = summarize(logits(head, xva), yva.cpu().numpy(), classes)
        test = summarize(logits(head, xte), yte.cpu().numpy(), classes)
        run_dir = args.out / args.partition / tag / f"seed{seed}"
        run_dir.mkdir(parents=True, exist_ok=True)
        headline = {k: val[k] for k in ("top1", "top5", "macro_f1")}
        result = {
            "partition": args.partition,
            "tag": tag,
            "seed": seed,
            "tta": False,
            "timm_name": PRESETS.get(args.model, {"timm_name": args.model})["timm_name"],
            "best": {"val_top1": val["top1"], "weights": "frozen+linear", "lr": lr, "wd": wd},
            "val": {"plain": headline},
            "test": test,
            "grid": {f"lr={a:g},wd={b:g}": v for (a, b), v in scores.items()},
        }
        (run_dir / "test_metrics.json").write_text(json.dumps(result, indent=1))
        print(
            f"TEST {args.partition}/{tag}/seed{seed}: top1 {test['top1']:.4f} "
            f"top5 {test['top5']:.4f} macroF1 {test['macro_f1']:.4f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
