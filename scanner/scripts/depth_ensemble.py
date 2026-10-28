"""Does an ensemble over depths beat Head A? SigLIP 2 has no convolutional layers past the patch
embedding, so "after the 4th layer" means after transformer block 4. One pass per encoder pools the
tokens after each tapped block ([mean ; std] over patches, a texture statistic) next to the final
attention-pooled feature. An MLP head (head_search's recipe: lr/wd grid on seed 0, then 3 seeds)
is fitted on each feature, and on final + tap concatenated. Then calibrated probabilities from the
final head and one or two other heads are averaged with weights chosen on val macro F1. Test is
scored once for every candidate; the pick is the best on val.

    python scripts/depth_ensemble.py --split-csv fabric.csv --data-root data --partition fabric24 \\
        --encoder v8=vit_so400m_patch16_siglip_384.v2_webli:384:v8_lora.safetensors \\
        --encoder v7=vit_so400m_patch14_siglip_224.v2_webli:224:v7_lora.safetensors --out out
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
from safetensors import safe_open
from safetensors.torch import load_file
from torch.utils.data import DataLoader

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1])
)  # run as a script: repo root on the path
from training.scanner.calibration import fit_temperature  # noqa: E402
from training.textilenet.data import TextileDataset  # noqa: E402
from training.textilenet.head_search import train_head  # noqa: E402
from training.textilenet.metrics import summarize  # noqa: E402
from training.textilenet.recipe import apply_lora  # noqa: E402
from training.textilenet.splits import class_index, read_csv, rescope  # noqa: E402
from training.textilenet.train import build_transforms  # noqa: E402


def encoder(spec: str, device):
    tag, rest = spec.split("=", 1)
    name, size, lora_file = rest.split(":")
    model = timm.create_model(name, pretrained=True, num_classes=0, img_size=int(size))
    with safe_open(lora_file, "pt") as f:
        scale = float(f.metadata()["scale"])
    model.load_state_dict(apply_lora(model.state_dict(), load_file(lora_file), scale))
    return tag, int(size), model.eval().to(device)


@torch.no_grad()
def features(model, size, rows, args, taps):
    """{'final': N x C, 'b<k>': N x 2C} as float16, centre crops as probe.py caches them."""
    cfg = timm.data.resolve_model_data_config(model)
    _, tf = build_transforms(size, cfg["mean"], cfg["std"], 0.875)
    ds = TextileDataset(
        rows, args.data_root, class_index(args.partition), tf, math.ceil(size / 0.875)
    )
    loader = DataLoader(ds, args.batch_size, num_workers=args.workers)
    out, t0, half = {}, time.time(), True
    model.half()
    for i, (x, _) in enumerate(loader):
        x = x.to(args.device)
        while True:
            xx = x.half() if half else x.float()
            final, inter = (
                model.forward_intermediates(xx, indices=[k - 1 for k in taps], output_fmt="NLC")
                if taps
                else (model.forward_features(xx), [])
            )
            got = {"final": model.forward_head(final, pre_logits=True).float()}
            for k, t in zip(taps, inter, strict=True):
                t = t.float()
                got[f"b{k}"] = torch.cat([t.mean(1), t.std(1)], 1)
            if not half or all(torch.isfinite(v).all() for v in got.values()):
                break
            print("non-finite fp16 features: this encoder runs in fp32 from here", flush=True)
            half = False
            model.float()
        for k, v in got.items():
            out.setdefault(k, []).append(v.cpu().numpy().astype(np.float16))
        if i % 100 == 0:
            done = (i + 1) * args.batch_size
            print(f"{done}/{len(rows)} images, {done / (time.time() - t0):.0f} img/s", flush=True)
    return {k: np.concatenate(v) for k, v in out.items()}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--split-csv", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--partition", default="fabric24")
    ap.add_argument(
        "--encoder", action="append", required=True, help="tag=timm_name:img_size:lora file"
    )
    ap.add_argument(
        "--taps", type=int, nargs="+", default=[4, 8, 12, 16, 20, 24], help="1-based blocks"
    )
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)

    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    rows = [r for r in read_csv(args.split_csv) if r.split != "test" or r.source == "archive"]
    rows = [r for r in rescope(rows, args.partition) if (args.data_root / r.path).exists()]
    split = np.array([r.split for r in rows])
    y = np.array([labels[r.label] for r in rows])
    print({s: int((split == s).sum()) for s in ("train", "val", "test")}, flush=True)

    feats = {}  # "v8/final", "v8/b4", ... -> N x d float16
    for i, spec in enumerate(args.encoder):
        tag, size, model = encoder(spec, args.device)
        taps = args.taps if i == 0 else []  # depth taps on the first (serving) encoder only
        for k, v in features(model, size, rows, args, taps).items():
            feats[f"{tag}/{k}"] = v
        del model
        torch.cuda.empty_cache()
    main_final = f"{args.encoder[0].split('=')[0]}/final"

    def fit(names):
        x = np.concatenate([feats[n].astype(np.float32) for n in names], 1)
        mu, sd = x[split == "train"].mean(0), x[split == "train"].std(0) + 1e-6
        x = (x - mu) / sd
        xtr, xva, xte = (
            torch.from_numpy(x[split == s]).to(args.device) for s in ("train", "val", "test")
        )
        ytr, yva = torch.from_numpy(y[split == "train"]).to(args.device), y[split == "val"]
        grid = {g: train_head("mlp", xtr, ytr, xva, yva, classes, *g, args.epochs, 0,
                              args.device)[1]
                for g in itertools.product((1e-3, 3e-3), (1e-4, 5e-2))}  # fmt: skip
        lr, wd = max(grid, key=grid.get)
        probs = []  # per seed: (val, test) calibrated probabilities
        for seed in args.seeds:
            head, _ = train_head(
                "mlp", xtr, ytr, xva, yva, classes, lr, wd, args.epochs, seed, args.device
            )
            with torch.no_grad():
                lv, lt = (head(v).float().cpu().numpy() for v in (xva, xte))
            temp = fit_temperature(lv, yva)
            probs.append(
                tuple(torch.softmax(torch.from_numpy(z / temp), 1).numpy() for z in (lv, lt))
            )
            if seed == args.seeds[0]:
                torch.save(dict(state_dict=head.state_dict(), features=names, mu=mu, sd=sd, lr=lr,
                                wd=wd, classes=classes, temperature=temp),
                           args.out / f"head_{'+'.join(names).replace('/', '_')}.pt")  # fmt: skip
        return probs

    yva, yte = y[split == "val"], y[split == "test"]

    def score(probs):
        """Mean over seeds of val/test macro F1 and test top-1."""
        s = [(summarize(np.log(pv + 1e-12), yva, classes),
              summarize(np.log(pt + 1e-12), yte, classes)) for pv, pt in probs]  # fmt: skip
        return dict(val_macro_f1=float(np.mean([v["macro_f1"] for v, _ in s])),
                    test_macro_f1=float(np.mean([t["macro_f1"] for _, t in s])),
                    test_top1=float(np.mean([t["top1"] for _, t in s])))  # fmt: skip

    members, results = {}, {}

    def report(name, probs, **extra):
        results[name] = dict(score(probs), **extra)
        r = results[name]
        print(f"{name:40s} val mF1 {r['val_macro_f1']:.4f} | test mF1 {r['test_macro_f1']:.4f}"
              f" top-1 {r['test_top1']:.4f} {extra or ''}", flush=True)  # fmt: skip
        (args.out / "results.json").write_text(json.dumps(results, indent=1))

    sets = [[n] for n in feats] + [
        [main_final, n] for n in feats if n.split("/")[1].startswith("b")
    ]
    for names in sets:
        key = " + ".join(names) if len(names) > 1 else names[0]
        members[key] = fit(names)
        report(key, members[key])

    def blend(ms, w):
        """Per seed, the w-weighted average of the members' (val, test) probabilities."""
        return [tuple(sum(wi * m[s][j] for wi, m in zip(w, ms, strict=True)) for j in (0, 1))
                for s in range(len(args.seeds))]  # fmt: skip

    def best(ms, grid):
        return max(grid, key=lambda w: score(blend(ms, w))["val_macro_f1"])

    weights = [i / 10 for i in range(1, 10)]
    others = [k for k in members if k != main_final]
    for other in others:  # final head + one other, weight on val
        ms = [members[main_final], members[other]]
        w = best(ms, [(a, round(1 - a, 1)) for a in weights])
        report(f"avg({main_final}, {other})", blend(ms, w), w=list(w))
    # three-way: final + the best same-encoder tap head + the other encoder
    enc = main_final.split("/")[0]
    taps = [k for k in others if k.startswith(enc) and "+" not in k]
    other_enc = [k for k in others if not k.startswith(enc)]
    if taps and other_enc:
        tap = max(taps, key=lambda k: results[f"avg({main_final}, {k})"]["val_macro_f1"])
        ms = [members[main_final], members[tap], members[other_enc[0]]]
        trio = [(a, b, round(1 - a - b, 1)) for a in weights for b in weights if a + b < 0.95]
        w = best(ms, trio)
        report(f"avg({main_final}, {tap}, {other_enc[0]})", blend(ms, w), w=list(w))

    pick = max(results, key=lambda k: results[k]["val_macro_f1"])
    print(
        "chosen on val:",
        pick,
        results[pick],
        "| baseline",
        main_final,
        results[main_final],
        flush=True,
    )
    (args.out / "results.json").write_text(json.dumps(dict(results, chosen=pick), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
