#!/usr/bin/env python3
"""Frozen-backbone linear probe: the cheap first number, runnable on a laptop.

Extracts features once (resumable shards), then fits a linear head on them. Weight
decay and lr are chosen on val; test is evaluated once per seed with that choice.

    python -m training.textilenet.probe --partition fabric --model dinov2_vitb14

For ViTs the feature is [CLS ; mean(patch tokens)], the DINOv2 linear-eval recipe.
Writes runs/<partition>/probe_<model>/seed<k>/test_metrics.json in the same format as
train.py, so ``aggregate`` puts both in one table, plus log.jsonl (train/val loss and
val metrics per epoch), head.pt and confusion.png.

Rows already in the feature cache need no image on disk. The imbalance ablation:

    python -m training.textilenet.probe --partition fabric \
        --split-csv data/splits/prelim/fabric.csv --epochs 20 --select macro_f1 \
        --sampler sqrt --tag dinov2_linear_sqrt --out runs/imbalance
"""

from __future__ import annotations

import argparse
import copy
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

from services.vision.backbone import pool_features as pool
from training.textilenet.data import TextileDataset, seed_worker
from training.textilenet.feature_cache import FeatureCache
from training.textilenet.governor import Governor
from training.textilenet.metrics import HEADLINE, minority_recall, summarize
from training.textilenet.recipe import epoch_order, irus_epoch_size, irus_order, lr_at
from training.textilenet.splits import class_index, read_csv
from training.textilenet.train import (
    PRESETS,
    augment_4to5,
    build_transforms,
    pick_device,
    plot_confusion,
)

SHARD = 4096  # images per cache shard; the unit of resumption
#: (lr, weight decay) pairs tried on val; shared with training/scanner/fit_heads.py
GRID = list(itertools.product([1e-3, 3e-3], [1e-4, 1e-3, 1e-2, 5e-2]))
SAMPLER_POWER = {"none": 0.0, "sqrt": 0.5, "inverse": 1.0}


def pooled(model, x, half: bool):
    """Pooled features as float32, computed in fp16 when ``half``. A model whose fp16
    activations overflow (DINOv3 does) is switched to fp32 for good, instead of a head
    silently training on inf. Returns (features, half still on)."""
    if half:
        f = pool(model, x.half()).float()
        if torch.isfinite(f).all():
            return f, True
        print("non-finite fp16 features: switching this encoder to fp32", flush=True)
        model.float()
    return pool(model, x.float()).float(), False


@torch.no_grad()
def extract(
    args: argparse.Namespace, rows, device, cache: FeatureCache, augment_seed: int | None = None
) -> np.ndarray:
    """Features for ``rows`` in order; only images not already cached are computed. With
    ``augment_seed``, each image gets one seeded augment_4to5 view instead of the centre crop."""
    missing = set(cache.missing([r.path for r in rows]))
    todo = [r for r in rows if r.path in missing]
    if todo:
        print(f"extracting {len(todo)} of {len(rows)} images (rest cached)", flush=True)
        name = PRESETS.get(args.model, {"timm_name": args.model})["timm_name"]
        kw = {"img_size": args.img_size} if name.startswith(("vit_", "eva")) else {}
        model = timm.create_model(name, pretrained=True, num_classes=0, **kw).eval().to(device)
        half = device.type in ("cuda", "mps")
        if half:
            model.half()
        cfg = timm.data.resolve_model_data_config(model)
        _, tf = build_transforms(args.img_size, cfg["mean"], cfg["std"], args.crop_pct)
        decode = math.ceil(args.img_size / args.crop_pct)
        if augment_seed is not None:
            tf, decode = augment_4to5(args.img_size, cfg["mean"], cfg["std"]), 2 * args.img_size
            tf.set_random_seed(augment_seed)
        ds = TextileDataset(todo, args.data_root, class_index(args.partition), tf, decode)
        n_shards = math.ceil(len(todo) / SHARD)
        gov = Governor()  # pauses when the laptop runs hot or short of memory
        t_all = time.time()
        for k in range(n_shards):
            idx = range(k * SHARD, min((k + 1) * SHARD, len(todo)))
            loader = DataLoader(
                Subset(ds, idx),
                args.batch_size,
                num_workers=args.workers,
                worker_init_fn=seed_worker,  # distinct, reproducible augmentations per worker
                generator=torch.Generator().manual_seed(1000 * (augment_seed or 0) + k),
            )
            feats, t0 = [], time.time()
            for x, _ in loader:
                gov.pause_if_needed()
                f, half = pooled(model, x.to(device), half)
                feats.append(f.cpu().numpy())
            feats = np.concatenate(feats)
            if not np.isfinite(feats).all():
                raise FloatingPointError(f"{name}: non-finite features even in fp32")
            cache.add([todo[i].path for i in idx], feats)
            rate = len(idx) / (time.time() - t0)
            left = (len(todo) - idx.stop) / max(idx.stop / (time.time() - t_all), 1e-9) / 60
            print(
                f"shard {k + 1}/{n_shards}: {rate:.0f} img/s, ~{left:.0f} min left, "
                f"{gov.paused_s:.0f}s paused so far",
                flush=True,
            )
    return cache.assemble([r.path for r in rows])


def fit_linear(
    xtr,
    ytr,
    n_classes,
    lr,
    wd,
    epochs,
    seed,
    device,
    *,
    sampler_power=0.0,
    irus_cap=0,
    copies=1,
    on_epoch=None,
) -> torch.nn.Linear:
    """``sampler_power`` > 0 redraws each epoch at class weight count^-power; ``irus_cap``
    > 0 runs IRUS instead. ``xtr`` may stack ``copies`` views of the same N images.
    ``on_epoch(epoch, head, mean_train_loss)`` runs after every epoch."""
    g = torch.Generator().manual_seed(seed)
    torch.manual_seed(seed)
    head = torch.nn.Linear(xtr.shape[1], n_classes).to(device)
    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=wd)
    y_img = ytr[: len(ytr) // copies].cpu()
    per_epoch = (
        irus_epoch_size(y_img.numpy(), n_classes, irus_cap, copies) if irus_cap else len(xtr)
    )
    total = epochs * math.ceil(per_epoch / 1024)
    step = 0
    for epoch in range(epochs):
        loss_sum = torch.zeros((), device=device)
        order = (
            irus_order(y_img, n_classes, irus_cap, g, copies)
            if irus_cap
            else epoch_order(ytr, n_classes, sampler_power, g)
        )
        for idx in order.split(1024):
            for group in opt.param_groups:  # same warmup-cosine as train.py; 10% warmup
                group["lr"] = lr_at(step, total, total // 10, lr)
            idx = idx.to(device)
            loss = F.cross_entropy(head(xtr[idx]), ytr[idx], label_smoothing=0.1)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            step += 1
            loss_sum += loss.detach() * len(idx)
        if on_epoch:
            on_epoch(epoch, head, loss_sum.item() / per_epoch)
    return head


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--partition", choices=["fabric", "fibre"], required=True)
    ap.add_argument("--model", default="dinov2_vitb14")
    ap.add_argument("--img-size", type=int, default=224)
    ap.add_argument("--crop-pct", type=float, default=0.875)
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--split-csv", type=Path, help="default: <data-root>/splits/<partition>.csv")
    ap.add_argument("--tag", help="run name (default: probe_<model>)")
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features"))
    ap.add_argument("--out", type=Path, default=Path("runs"))
    # Kept small on purpose: 6 workers x 0.3 GB + batch 64 helped freeze a 16 GB laptop.
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--device", default="auto")
    ap.add_argument(
        "--sampler",
        choices=[*SAMPLER_POWER, "irus"],
        default="none",
        help="redraw train each epoch at class weight count^-0.5 (sqrt) or count^-1, or IRUS",
    )
    ap.add_argument("--irus-cap", type=int, default=1000, help="IRUS: images per class per epoch")
    ap.add_argument(
        "--aug-views",
        type=int,
        default=0,
        help="add this many augment_4to5 views of every train image (1 = a 2x train set)",
    )
    ap.add_argument(
        "--select",
        choices=["top1", "macro_f1"],
        default="top1",
        help="val metric that picks lr/wd and the epoch whose head is kept",
    )
    args = ap.parse_args(argv)

    device = pick_device(args.device)
    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    split_csv = args.split_csv or args.data_root / "splits" / f"{args.partition}.csv"
    cache = FeatureCache(args.feature_dir / args.partition / f"{args.model}_{args.img_size}")
    all_rows = read_csv(split_csv)
    uncached = set(cache.missing([r.path for r in all_rows]))
    rows = [r for r in all_rows if r.path not in uncached or (args.data_root / r.path).exists()]
    feats = extract(args, rows, device, cache)

    split = np.array([r.split for r in rows])
    source = np.array([r.source for r in rows])
    y = np.array([labels[r.label] for r in rows])
    mu = feats[split == "train"].astype(np.float32).mean(0)
    sd = feats[split == "train"].astype(np.float32).std(0) + 1e-6

    def tensors(s):
        x = torch.from_numpy((feats[split == s].astype(np.float32) - mu) / sd).to(device)
        return x, torch.from_numpy(y[split == s]).to(device)

    (xtr, ytr), (xva, yva), (xte, yte) = tensors("train"), tensors("val"), tensors("test")
    yva_np, yte_np, src_te = yva.cpu().numpy(), yte.cpu().numpy(), source[split == "test"]
    counts = np.bincount(ytr.cpu().numpy(), minlength=len(classes)).tolist()
    train_counts = dict(zip(classes, counts, strict=True))
    power = SAMPLER_POWER.get(args.sampler, 0.0)
    irus_cap = args.irus_cap if args.sampler == "irus" else 0
    if args.aug_views:  # stack augmented views under the standard ones: rows i, i + N, ...
        train_rows = [r for r in rows if r.split == "train"]
        root = args.feature_dir / args.partition / f"{args.model}_{args.img_size}_aug4to5"
        views = [
            extract(args, train_rows, device, FeatureCache(Path(f"{root}_{v}")), augment_seed=v)
            for v in range(args.aug_views)
        ]
        aug = torch.from_numpy((np.concatenate(views).astype(np.float32) - mu) / sd)
        xtr = torch.cat([xtr, aug.to(device)])
        ytr = ytr.repeat(1 + args.aug_views)

    @torch.no_grad()
    def logits(head, x):
        return head(x).float().cpu().numpy()

    def fit(lr, wd, seed, log=None):
        """The head from the epoch with the best val ``--select`` metric, and that epoch."""
        best = {"score": -1.0}

        def on_epoch(epoch, head, train_loss):
            lv = logits(head, xva)
            s = summarize(lv, yva_np, classes)
            if log is not None:
                val_loss = F.cross_entropy(torch.from_numpy(lv), torch.from_numpy(yva_np)).item()
                log.append(
                    {"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss}
                    | {f"val_{k}": s[k] for k in HEADLINE}
                )
            if s[args.select] > best["score"]:
                state = copy.deepcopy(head.state_dict())
                best.update(score=s[args.select], epoch=epoch, state=state)

        head = fit_linear(
            xtr, ytr, len(classes), lr, wd, args.epochs, seed, device,
            sampler_power=power, irus_cap=irus_cap, copies=1 + args.aug_views,
            on_epoch=on_epoch,
        )  # fmt: skip
        head.load_state_dict(best["state"])
        return head, best

    scores = {}
    for lr, wd in GRID:
        scores[(lr, wd)] = fit(lr, wd, 0)[1]["score"]
        print(f"lr {lr:g} wd {wd:g}: val {args.select} {scores[(lr, wd)]:.4f}", flush=True)
    lr, wd = max(scores, key=scores.get)
    print(f"selected on val {args.select}: lr {lr:g} wd {wd:g}")

    tag = args.tag or f"probe_{args.model}"
    for seed in args.seeds:
        log = []
        head, best = fit(lr, wd, seed, log)
        val = summarize(logits(head, xva), yva_np, classes)
        lte = logits(head, xte)
        test = summarize(lte, yte_np, classes)
        by_source = {
            str(s): summarize(lte[src_te == s], yte_np[src_te == s], classes)
            for s in np.unique(src_te)
        }
        for s in (test, *by_source.values()):
            s["minority_recall"] = minority_recall(s, train_counts)
        run_dir = args.out / args.partition / tag / f"seed{seed}"
        run_dir.mkdir(parents=True, exist_ok=True)
        result = {
            "partition": args.partition,
            "tag": tag,
            "seed": seed,
            "tta": False,
            "timm_name": PRESETS.get(args.model, {"timm_name": args.model})["timm_name"],
            "best": {
                "val_top1": val["top1"],
                f"val_{args.select}": val[args.select],
                "epoch": best["epoch"],
                "weights": "frozen+linear",
                "lr": lr,
                "wd": wd,
                "sampler": args.sampler,
                "irus_cap": irus_cap,
                "aug_views": args.aug_views,
                "select": args.select,
                "epochs": args.epochs,
            },
            "val": {"plain": {k: val[k] for k in HEADLINE}},
            "test": test,
            "test_by_source": by_source,
            "train_counts": train_counts,
            "split_csv": str(split_csv),
            "grid": {f"lr={a:g},wd={b:g}": v for (a, b), v in scores.items()},
        }
        (run_dir / "test_metrics.json").write_text(json.dumps(result, indent=1))
        (run_dir / "log.jsonl").write_text("".join(json.dumps(r) + "\n" for r in log))
        torch.save(
            {
                "state_dict": head.state_dict(),
                "mu": mu,
                "sd": sd,
                "classes": classes,
                "timm_name": result["timm_name"],
                "img_size": args.img_size,
                "feature": "[CLS ; mean(patch tokens)]",
            },
            run_dir / "head.pt",
        )
        plot_confusion(test, classes, run_dir / "confusion.png")
        print(
            f"TEST {args.partition}/{tag}/seed{seed} (epoch {best['epoch']}): "
            + " ".join(f"{k} {test[k]:.4f}" for k in HEADLINE)
            + f" minRec {test['minority_recall']['mean_recall'] or 0:.4f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
