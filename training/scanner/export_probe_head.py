"""Turn a frozen-encoder linear probe (training/textilenet/probe.py) into a scanner Head A.

The probe's head works on standardised pooled features of a frozen timm encoder. Here the
standardisation is folded into the head, temperature and the abstain threshold are fitted
on val logits computed from the feature cache (test is only reported), and a head folder
is written with `pool: probe`: the scanner loads the public encoder weights itself, so
only the small head travels.

    python -m training.scanner.export_probe_head --run runs/bakeoff/fabric/<tag>/seed0 \\
        --split-csv data/splits/fabric.csv --out runs/head_a_probe
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def fold_standardisation(w, b, mu, sd):
    """``((x - mu) / sd) @ w.T + b`` as ``x @ w2.T + b2``."""
    w2 = w / sd
    return w2, b - w2 @ mu


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--run", type=Path, required=True, help="probe run dir with head.pt")
    ap.add_argument("--split-csv", type=Path, required=True)
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features"))
    ap.add_argument("--partition", default="fabric")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--target", type=float, default=0.90, help="val accuracy among kept answers")
    ap.add_argument("--crop-pct", type=float, default=0.875, help="as probe.py extracted with")
    args = ap.parse_args(argv)

    import timm
    import torch
    from safetensors.numpy import save_file

    from training.scanner.export_head_a import calibrate
    from training.textilenet.feature_cache import FeatureCache
    from training.textilenet.metrics import summarize
    from training.textilenet.splits import read_csv

    ck = torch.load(args.run / "head.pt", map_location="cpu", weights_only=False)
    classes, name, size = list(ck["classes"]), ck["timm_name"], ck["img_size"]
    w, b = ck["state_dict"]["weight"].numpy(), ck["state_dict"]["bias"].numpy()
    w2, b2 = fold_standardisation(w, b, ck["mu"], ck["sd"])

    cache = FeatureCache(args.feature_dir / args.partition / f"{name}_{size}")
    rows = read_csv(args.split_csv)
    scores = {}
    for split in ("val", "test"):
        rs = [r for r in rows if r.split == split]
        missing = set(cache.missing([r.path for r in rs]))
        rs = [r for r in rs if r.path not in missing]  # e.g. scraped rows absent on Kaggle
        f = cache.assemble([r.path for r in rs]).astype(np.float32)
        scores[split] = (f @ w2.T + b2, np.array([classes.index(r.label) for r in rs]))
    cal = calibrate(scores["val"], scores["test"], args.target)
    test = summarize(*scores["test"], classes)

    cfg = timm.get_pretrained_cfg(name).to_dict()
    args.out.mkdir(parents=True, exist_ok=True)
    save_file(
        {"probe.weight": w2.astype(np.float32), "probe.bias": b2.astype(np.float32)},
        str(args.out / "probe.safetensors"),
    )
    head = {
        "classes": classes,
        "timm_name": name,
        "img_size": size,
        "crop_pct": args.crop_pct,
        "mean": list(cfg["mean"]),
        "std": list(cfg["std"]),
        "pool": "probe",  # frozen public encoder + this linear head on its pooled features
        "source_run": str(args.run),
        "domain": "catalog (TextileNet fabric)",
        **cal,
        "test_macro_f1": test["macro_f1"],
    }
    (args.out / "head.json").write_text(json.dumps(head, indent=1))
    t = cal["test"]
    print(
        f"{name}: test n={t['n']} top-1 {t['top1']:.4f} macro F1 {test['macro_f1']:.4f}; answers "
        f"{t['coverage']:.1%} at {t['accuracy_kept'] or 0:.4f} accuracy. Wrote {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
