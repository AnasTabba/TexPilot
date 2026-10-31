"""Score a lora_head_a MLP head on the human-verified photos (LoRA-merged encoder features).

    python scripts/score_verified_mlp.py --lora out/<tag>/lora.safetensors \\
        --head out/<tag>/heads/mlp_vit/head.pt --verified verified_paths.csv \\
        --data-root data --partition fabric22 --work /tmp/w

train.py's own linear head is not the served one; the served head is this MLP on the merged
encoder's pooled features, standardised with the head's saved mu/sd.
"""

from __future__ import annotations

import argparse
import csv
import sys
from argparse import Namespace
from pathlib import Path

import numpy as np
import timm
import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # run as a script: repo root on path
from training.textilenet.feature_cache import FeatureCache  # noqa: E402
from training.textilenet.head_search import make_head  # noqa: E402
from training.textilenet.metrics import summarize  # noqa: E402
from training.textilenet.probe import extract  # noqa: E402
from training.textilenet.recipe import apply_lora  # noqa: E402
from training.textilenet.splits import Record, class_index, rescope  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lora", type=Path, required=True)
    ap.add_argument("--head", type=Path, required=True)
    ap.add_argument("--verified", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--partition", required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--timm-name", default="vit_so400m_patch16_siglip_384.v2_webli")
    ap.add_argument("--img-size", type=int, default=384)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args(argv)
    args.work.mkdir(parents=True, exist_ok=True)

    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    with open(args.verified, newline="") as f:
        rows = [Record(v["path"], v["label"], "test", "archive", "") for v in csv.DictReader(f)]
    rows = rescope(rows, args.partition)  # drops photos whose verified class is out of scope

    base = timm.create_model(args.timm_name, pretrained=True, num_classes=0, img_size=args.img_size)
    with safe_open(str(args.lora), "pt") as f:
        scale = float(f.metadata()["scale"])
    merged = apply_lora(base.state_dict(), load_file(str(args.lora)), scale)
    encoder = args.work / "encoder.safetensors"
    save_file({k: v.contiguous() for k, v in merged.items()}, str(encoder))
    del base, merged

    ns = Namespace(model=args.timm_name, img_size=args.img_size, weights_file=encoder,
                   crop_pct=0.875, data_root=args.data_root, partition=args.partition,
                   batch_size=args.batch_size, workers=args.workers)  # fmt: skip
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    feats = extract(ns, rows, device, FeatureCache(args.work / "feats"))

    ck = torch.load(args.head, map_location="cpu", weights_only=False)
    assert list(ck["classes"]) == classes, "head class order differs from the scope's"
    mu, sd = np.asarray(ck["mu"][0], dtype=np.float32), np.asarray(ck["sd"][0], dtype=np.float32)
    x = torch.from_numpy((feats.astype(np.float32) - mu) / sd)
    head = make_head(ck["kind"], x.shape[1], len(classes))
    head.load_state_dict(ck["state_dict"])
    with torch.no_grad():
        logits = head.eval()(x).numpy()
    y = np.array([labels[r.label] for r in rows])
    s = summarize(logits, y, classes)
    print(
        f"human-verified MLP head (n={len(y)}): macro F1 {s['macro_f1']:.4f} top-1 {s['top1']:.4f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
