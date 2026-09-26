#!/usr/bin/env python3
"""Seeds -> mean +/- std, against the published baselines. Writes results.md.

    python -m training.textilenet.aggregate            # reads runs/, writes results.md

Also copies each partition's best checkpoint -- chosen by mean *val* top-1, never by
test -- to checkpoints/<partition>_best.pt, and exports the small per-run artefacts
(config, log, metrics) to training/textilenet/results/ so they can be committed.
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

# Zhong et al. 2023 (arXiv:2301.06160), mean +/- std over 3 seeds, from scratch.
BASELINES = {
    "fabric": [
        ("ResNet-18, scratch", 65.28, 0.67, 90.36, 0.31),
        ("ViT-Tiny/16, scratch", 67.32, 0.45, 92.12, 0.26),
    ],
    "fibre": [
        ("ResNet-18, scratch", 49.74, 0.27, 87.32, 0.14),
        ("ViT-Tiny/16, scratch", 53.32, 0.64, 88.46, 0.26),
    ],
}
PRETRAINING = {
    "convnextv2_base": "FCMAE + IN-22k ft",
    "convnextv2_base_384": "FCMAE + IN-22k ft",
    "dinov2_vitb14": "DINOv2 LVD-142M (SSL)",
    "eva02_base": "EVA-02 MIM IN-22k",
    "vit_tiny": "AugReg IN-21k + IN-1k ft",
    "probe_dinov2_vitb14": "DINOv2 LVD-142M, frozen",
}
DISPLAY = {
    "convnextv2_base": "ConvNeXt V2-B",
    "convnextv2_base_384": "ConvNeXt V2-B @384",
    "dinov2_vitb14": "DINOv2 ViT-B/14",
    "eva02_base": "EVA-02 B/14",
    "vit_tiny": "ViT-Tiny/16 (ablation)",
    "probe_dinov2_vitb14": "DINOv2 ViT-B/14 linear probe",
}


def mean_std(xs: list[float]) -> tuple[float, float]:
    return statistics.fmean(xs), statistics.stdev(xs) if len(xs) > 1 else 0.0


def fmt(xs: list[float]) -> str:
    m, s = mean_std([100 * x for x in xs])
    return f"{m:.2f} ± {s:.2f}" if len(xs) > 1 else f"{m:.2f}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runs", type=Path, default=Path("runs"))
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--out", type=Path, default=Path("training/textilenet/results.md"))
    ap.add_argument("--export", type=Path, default=Path("training/textilenet/results"))
    ap.add_argument("--checkpoints", type=Path, default=Path("checkpoints"))
    args = ap.parse_args(argv)

    runs: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for f in sorted(args.runs.glob("*/*/seed*/test_metrics.json")):
        r = json.loads(f.read_text())
        r["_dir"] = f.parent
        runs[(r["partition"], r["tag"])].append(r)
    if not runs:
        print(f"no finished runs under {args.runs}", file=sys.stderr)
        return 1

    md = [
        "# TextileNet: pretrained backbones vs the published baselines\n",
        f"_Generated {date.today().isoformat()} by `training/textilenet/aggregate.py`._\n",
    ]
    md += data_section(args.data_root, runs)

    for part in ("fabric", "fibre"):
        tags = sorted(
            {t for p, t in runs if p == part},
            key=lambda t: -mean_std([r["best"]["val_top1"] for r in runs[(part, t)]])[0],
        )
        if not tags:
            continue
        best_base = max(b[1] for b in BASELINES[part])
        md += [
            f"\n## {part.capitalize()} ({len(runs[(part, tags[0])][0]['test']['per_class'])}"
            " classes)\n",
            "| Model | Pretraining | Test top-1 | Test top-5 | Test macro-F1 | Val top-1 "
            "| Seeds | Δ top-1 vs best baseline |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for name, t1, s1, t5, s5 in BASELINES[part]:
            md.append(
                f"| {name} (published) | none | {t1:.2f} ± {s1:.2f} | {t5:.2f} ± {s5:.2f} "
                "| — | — | 3 | — |"
            )
        for t in tags:
            rs = runs[(part, t)]
            top1 = [r["test"]["top1"] for r in rs]
            delta = 100 * statistics.fmean(top1) - best_base
            md.append(
                f"| {DISPLAY.get(t, t)} | {PRETRAINING.get(t, rs[0].get('timm_name', '?'))} "
                f"| {fmt(top1)} | {fmt([r['test']['top5'] for r in rs])} "
                f"| {fmt([r['test']['macro_f1'] for r in rs])} "
                f"| {fmt([r['best']['val_top1'] for r in rs])} | {len(rs)} | {delta:+.2f} |"
            )

        winner = tags[0]  # highest mean val top-1
        rs = runs[(part, winner)]
        best_run = max(rs, key=lambda r: r["best"]["val_top1"])
        md += [
            f"\n**Selected model (highest mean val top-1): {DISPLAY.get(winner, winner)}.** "
            f"Per-class and confusion figures below are its seed {best_run['seed']} run "
            f"(test n = {best_run['test']['n']}).\n"
        ]
        md += per_class_section(best_run)
        export_best(best_run, part, args.checkpoints)

    md += [CAVEATS]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(md) + "\n")
    export_artifacts(runs, args.export)
    print(f"wrote {args.out}")
    return 0


def data_section(data_root: Path, runs) -> list[str]:
    out = [
        "## Data actually used\n",
        "| Partition | Train | Val | Test | Test from archive | Test scraped "
        "| Test manifest URLs | Train leaks into test dropped | Train dupes dropped |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for part in ("fabric", "fibre"):
        stats_f = data_root / "splits" / f"{part}.stats.json"
        if not stats_f.exists():
            continue
        s = json.loads(stats_f.read_text())
        manifest = data_root / "scraped" / "manifests" / f"{part}_test.json"
        n_manifest = len(json.loads(manifest.read_text())) if manifest.exists() else None
        cells = [
            s.get(k) for k in ("n_train", "n_val", "n_test", "n_test_archive", "n_test_scraped")
        ]
        cells += [
            n_manifest,
            s.get("dropped_train_leaking_into_test"),
            s.get("dropped_train_duplicates"),
        ]
        out.append(f"| {part} | " + " | ".join(_n(c) for c in cells) + " |")
    evaluated = {(p, r["test"]["n"]) for (p, _), rs in runs.items() for r in rs}
    out.append(f"\nTest-set sizes actually evaluated: {sorted(evaluated)}.\n")
    return out


def _n(x) -> str:
    return f"{x:,}" if isinstance(x, int) else "?"


def per_class_section(run: dict) -> list[str]:
    pc = run["test"]["per_class"]
    rows = sorted(pc.items(), key=lambda kv: (kv[1]["recall"] is None, kv[1]["recall"] or 0))
    out = [
        "<details><summary>Per-class test accuracy (recall), worst first</summary>\n",
        "| Class | Test n | Recall | Precision | F1 |",
        "|---|---|---|---|---|",
    ]
    for c, m in rows:
        rec = "—" if m["recall"] is None else f"{100 * m['recall']:.1f}"
        out.append(
            f"| {c} | {m['support']} | {rec} | {100 * m['precision']:.1f} | {100 * m['f1']:.1f} |"
        )
    out += [
        "\n</details>\n",
        "Most-confused pairs (share of the true class predicted as the other):\n",
        "| True | Predicted as | Count | Rate |",
        "|---|---|---|---|",
    ]
    for p in run["test"]["confused_pairs"][:12]:
        out.append(f"| {p['true']} | {p['pred']} | {p['count']} | {100 * p['rate']:.1f}% |")
    return out


def export_best(run: dict, partition: str, dest: Path) -> None:
    ckpt = run["_dir"] / "best.pt"
    if ckpt.exists():
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ckpt, dest / f"{partition}_best.pt")


def export_artifacts(runs, dest: Path) -> None:
    for rs in runs.values():
        for r in rs:
            d = dest / r["partition"] / r["tag"] / f"seed{r['seed']}"
            d.mkdir(parents=True, exist_ok=True)
            for name in ("config.json", "log.jsonl", "test_metrics.json", "confusion.png"):
                if (r["_dir"] / name).exists():
                    shutil.copy2(r["_dir"] / name, d / name)


CAVEATS = """
## How to read these numbers

- **Same split, not the same images.** We rebuilt the paper's split (seed archives'
  `train/`/`test/` plus the `*_train.json`/`*_test.json` scrape manifests), but ~73% of
  manifest URLs point at `contestimg.wish.com` and many are dead, so our test set is the
  recoverable subset of theirs. The data table above gives the exact counts.
- **Baselines selected on test; we select on val.** The published training scripts keep
  the checkpoint with the best *test* accuracy. Ours pick weights (raw vs EMA), epoch and
  TTA on a 10% val carve-out of train and evaluate test once. This favours the baselines.
- **Leak removal only touches train.** Train images byte-identical to a test image are
  dropped from train; the test set is kept exactly as shipped.
- **Fibre is not a product claim.** Beating 53.3% on 33-way fibre is a benchmark result.
  Members of a fibre family (cotton/modal/viscose/lyocell) remain visually
  indistinguishable; see the confused pairs, and README "What it does *not* do".
- Mean ± sample std over seeds 0/1/2 (seed affects init, data order, augmentation; the
  split is fixed). Seeded but not bitwise-deterministic on GPU.
"""


if __name__ == "__main__":
    sys.exit(main())
