#!/usr/bin/env python3
"""Which head on frozen features, and which features: linear vs a small MLP, one encoder vs
two concatenated. Everything is chosen on val (macro F1); test is scored once per finalist,
with the scanner's own calibration (temperature + the 90%-accuracy abstain threshold).

    python -m training.textilenet.head_search --split-csv data/splits/prelim/fabric.csv \\
        --features vit_so400m_patch14_siglip_224.v2_webli_224 dinov2_vitb14_224

Each feature set must already be in the feature cache (training/textilenet/probe.py).
Writes runs/heads/<name>/result.json and head.pt (weights + standardisation).
"""

from __future__ import annotations

import argparse
import copy
import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from training.scanner.calibration import abstain_threshold, fit_temperature
from training.textilenet.feature_cache import FeatureCache
from training.textilenet.metrics import summarize
from training.textilenet.recipe import lr_at
from training.textilenet.splits import class_index, read_csv


def make_head(
    kind: str, dim: int, n_classes: int, hidden: int = 1024, dropout: float = 0.2
) -> torch.nn.Module:
    if kind == "linear":
        return torch.nn.Linear(dim, n_classes)
    return torch.nn.Sequential(  # "mlp"
        torch.nn.Linear(dim, hidden),
        torch.nn.GELU(),
        torch.nn.Dropout(dropout),
        torch.nn.Linear(hidden, n_classes),
    )


def train_head(kind, xtr, ytr, xva, yva, classes, lr, wd, epochs, seed, device, hidden=1024,
               dropout=0.2):  # fmt: skip
    """The head from the epoch with the best val macro F1, and that score."""
    torch.manual_seed(seed)
    g = torch.Generator().manual_seed(seed)
    head = make_head(kind, xtr.shape[1], len(classes), hidden, dropout).to(device)
    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=wd)
    steps = epochs * math.ceil(len(xtr) / 1024)
    best, step = (-1.0, None), 0
    for _ in range(epochs):
        head.train()
        for idx in torch.randperm(len(xtr), generator=g).split(1024):
            for group in opt.param_groups:
                group["lr"] = lr_at(step, steps, steps // 10, lr)
            idx = idx.to(device)
            loss = F.cross_entropy(head(xtr[idx]), ytr[idx], label_smoothing=0.1)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            step += 1
        head.eval()
        with torch.no_grad():
            score = summarize(head(xva).float().cpu().numpy(), yva, classes)["macro_f1"]
        if score > best[0]:
            best = (score, copy.deepcopy(head.state_dict()))
    head.load_state_dict(best[1])
    return head, best[0]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--split-csv", type=Path, required=True)
    ap.add_argument("--features", nargs="+", required=True, help="feature-cache dir names")
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features/fabric"))
    ap.add_argument("--partition", choices=["fabric", "fibre"], default="fabric")
    ap.add_argument("--kinds", nargs="+", default=["linear", "mlp"])
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--hidden", type=int, default=1024, help="MLP hidden width")
    ap.add_argument("--dropout", type=float, default=0.2, help="MLP dropout")
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--out", type=Path, default=Path("runs/heads"))
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = ap.parse_args(argv)

    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    rows = [r for r in read_csv(args.split_csv) if r.split != "test" or r.source == "archive"]
    caches = {name: FeatureCache(args.feature_dir / name) for name in args.features}
    rows = [r for r in rows if all(not c.missing([r.path]) for c in caches.values())]
    split = np.array([r.split for r in rows])
    y = np.array([labels[r.label] for r in rows])
    blocks = {}
    for name, cache in caches.items():
        f = cache.assemble([r.path for r in rows]).astype(np.float32)
        mu, sd = f[split == "train"].mean(0), f[split == "train"].std(0) + 1e-6
        blocks[name] = ((f - mu) / sd, mu, sd)
    print({s: int((split == s).sum()) for s in ("train", "val", "test")}, flush=True)

    feature_sets = [args.features[:1]] + ([args.features] if len(args.features) > 1 else [])
    summary = []
    for names, kind in itertools.product(feature_sets, args.kinds):
        x = np.concatenate([blocks[n][0] for n in names], axis=1)

        xtr, xva, xte = (
            torch.from_numpy(x[split == s]).to(args.device) for s in ("train", "val", "test")
        )
        ytr = torch.from_numpy(y[split == "train"]).to(args.device)
        yva, yte = y[split == "val"], y[split == "test"]
        grid = {}
        for lr, wd in itertools.product((1e-3, 3e-3), (1e-4, 5e-2)):
            grid[(lr, wd)] = train_head(kind, xtr, ytr, xva, yva, classes, lr, wd, args.epochs, 0,
                                        args.device, args.hidden, args.dropout)[1]  # fmt: skip
        lr, wd = max(grid, key=grid.get)
        tag = f"{kind}_{'+'.join(n.split('_')[0] for n in names)}"
        runs = []
        for seed in args.seeds:
            head, val_f1 = train_head(kind, xtr, ytr, xva, yva, classes, lr, wd, args.epochs, seed,
                                      args.device, args.hidden, args.dropout)  # fmt: skip
            with torch.no_grad():
                lv, lt = (head(v).float().cpu().numpy() for v in (xva, xte))
            temp = fit_temperature(lv, yva)
            pv = torch.softmax(torch.from_numpy(lv / temp), 1).numpy()
            thr, _ = abstain_threshold(pv.max(1), pv.argmax(1) == yva, 0.9)
            pt = torch.softmax(torch.from_numpy(lt / temp), 1).numpy()
            keep = pt.max(1) >= thr
            s = summarize(lt, yte, classes)
            runs.append(dict(seed=seed, val_macro_f1=val_f1, test_top1=s["top1"],
                             test_macro_f1=s["macro_f1"], coverage=float(keep.mean()),
                             accuracy_kept=float((pt.argmax(1) == yte)[keep].mean())))  # fmt: skip
            if seed == args.seeds[0]:
                d = args.out / tag
                d.mkdir(parents=True, exist_ok=True)
                torch.save(dict(state_dict=head.state_dict(), kind=kind, features=names,
                                mu=[blocks[n][1] for n in names], sd=[blocks[n][2] for n in names],
                                classes=classes, temperature=temp, threshold=thr),
                           d / "head.pt")  # fmt: skip
        mean = {k: float(np.mean([r[k] for r in runs])) for k in runs[0] if k != "seed"}
        std = {k: float(np.std([r[k] for r in runs])) for k in runs[0] if k != "seed"}
        res = dict(tag=tag, lr=lr, wd=wd, grid={f"{a:g},{b:g}": v for (a, b), v in grid.items()},
                   mean=mean, std=std, runs=runs)  # fmt: skip
        (args.out / tag / "result.json").write_text(json.dumps(res, indent=1))
        summary.append(res)
        m, d = mean, std
        print(
            f"{tag:32s} val mF1 {m['val_macro_f1']:.4f} | test top1 {m['test_top1']:.4f}"
            f"±{d['test_top1']:.4f} mF1 {m['test_macro_f1']:.4f}±{d['test_macro_f1']:.4f}"
            f" | answers {m['coverage']:.1%} at {m['accuracy_kept']:.1%}",
            flush=True,
        )
    best = max(summary, key=lambda r: r["mean"]["val_macro_f1"])
    print("chosen on val:", best["tag"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
