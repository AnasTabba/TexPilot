"""TexPilot's measured results on one page, for the report. Every number states its
domain and n (repo rule). Reads whatever exists on this machine; everything else is
listed as not measured yet. Stdlib only.

    python -m training.scanner.results        # writes docs/results.md
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

from training.textilenet.aggregate import BASELINES, fmt, mean_std

PENDING = "_Not measured yet: {}._"


def _benchmark(root: Path) -> list[str]:
    runs: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for f in sorted((root / "runs").glob("*/*/seed*/test_metrics.json")):
        r = json.loads(f.read_text())
        if "partition" in r and "tag" in r:
            runs[(r["partition"], r["tag"])].append(r)
    md = [
        "## 1. Catalog benchmark: TextileNet (domain: catalog)",
        "",
        "Full tables, per-class results and caveats go to `training/textilenet/results.md`, "
        "written by `training/textilenet/aggregate.py` after the benchmark run, including the "
        "train images dropped for leaking into test.",
        "",
    ]
    if not runs:
        return md + [PENDING.format("no benchmark or probe run under runs/"), ""]
    md += [
        "| Partition | Selected (best mean val top-1) | Test top-1 | Seeds | Test n "
        "| Best published | Δ top-1 |",
        "|---|---|---|---|---|---|---|",
    ]
    for part in ("fabric", "fibre"):
        tags = [t for p, t in runs if p == part]
        if not tags:
            continue
        tag = max(tags, key=lambda t: mean_std([r["best"]["val_top1"] for r in runs[(part, t)]])[0])
        rs = runs[(part, tag)]
        top1 = [r["test"]["top1"] for r in rs]
        name, base = max(((b[0], b[1]) for b in BASELINES[part]), key=lambda b: b[1])
        md.append(
            f"| {part} | {tag} | {fmt(top1)} | {len(rs)} | {rs[0]['test']['n']:,} "
            f"| {name}: {base:.2f} | {100 * statistics.fmean(top1) - base:+.2f} |"
        )
    return md + [""]


def _head_row(bundle: str, name: str, test_top1, test_n, coverage, ece_before, ece_after) -> str:
    return (
        f"| {bundle} | {name} | {test_top1:.3f} | {test_n:,} | {coverage:.0%} "
        f"| {ece_before:.3f} → {ece_after:.3f} |"
    )


def _bundles(root: Path) -> list[str]:
    md = ["## 2. Scanner heads (domain: catalog; calibrated on val, reported on test)", ""]
    files = sorted(
        (root / "models").glob("scanner-v*/bundle.json"),
        key=lambda f: json.loads(f.read_text())["version"],
    )
    if not files:
        return md + [PENDING.format("no scanner bundle under models/"), ""]
    md += [
        "Coverage is the share of val images a head answers at its 90% accuracy target; "
        "below that it abstains.",
        "",
        "| Bundle | Head | Test top-1 | Test n | Val coverage | Val ECE before → after |",
        "|---|---|---|---|---|---|",
    ]
    for f in files:
        meta, bundle = json.loads(f.read_text()), f.parent.name
        for name, h in meta["heads"].items():
            md.append(_head_row(bundle, name, h["test"]["top1"], h["test"]["n"], h["coverage_val"],
                                h["ece_val_before"], h["ece_val_after"]))  # fmt: skip
        ref = meta.get("structure_model")
        if ref:
            h = json.loads((f.parent / ref["dir"] / "head.json").read_text())
            md.append(_head_row(bundle, f"structure, fine-tuned `{ref['timm_name']}`",
                                h["test"]["top1"], h["test"]["n"], h["val"]["coverage"],
                                h["val"]["ece_before"], h["val"]["ece_after"]))  # fmt: skip
    return md + [""]


def _detector_b(root: Path) -> list[str]:
    md = ["## 3. Garment detector B: RT-DETRv2 on Fashionpedia (domain: catalog)", ""]
    f = root / "runs" / "rtdetr" / "metrics.json"
    if not f.exists():
        return md + [PENDING.format("training/detector/run_cloud.sh has not run"), ""]
    m = json.loads(f.read_text())
    t, n = m["test_val2020"], m["n"]
    return md + [
        f"Fashionpedia val as the test set (n = {n['test_val2020']:,} photos): "
        f"mAP@[.5:.95] **{t['map']:.3f}**, AP50 {t['ap50']:.3f}. Checkpoint chosen on a "
        f"{n['holdout']:,}-photo hold-out of train (mAP {m['holdout_best_map']:.3f}); "
        f"trained on {n['train']:,} photos.",
        "",
    ]


def _head_a_export(root: Path) -> list[str]:
    md = ["## 4. Fine-tuned Head A, as exported (domain: catalog)", ""]
    f = root / "runs" / "head_a" / "head.json"
    if not f.exists():
        return md + [PENDING.format("run_all.sh headA has not run"), ""]
    h = json.loads(f.read_text())
    v, t = h["val"], h["test"]
    return md + [
        f"`{h['timm_name']}` from `{h['source_run']}`: test top-1 {t['top1']:.3f} "
        f"(n = {t['n']:,}); answers {t['coverage']:.0%} of test at {h['target_accuracy']:.0%} "
        f"target; val ECE {v['ece_before']:.3f} → {v['ece_after']:.3f}.",
        "",
    ]


def _phone(root: Path) -> list[str]:
    md = ["## 5. The scanner on the team's phone photos (domain: phone)", ""]
    f = root / "results" / "bakeoff" / "bakeoff.md"
    if not f.exists():
        return md + [PENDING.format("the phone set (due Oct 4) and the bake-off"), ""]
    body = [("##" + line) if line.startswith("#") else line for line in f.read_text().splitlines()]
    return md + body + [""]


def build(root: Path) -> str:
    root = Path(root)
    md = [
        "# TexPilot results",
        "",
        f"_Generated {date.today().isoformat()} by `training/scanner/results.py` from the runs "
        "and models on the Mac. Every number states its domain (catalog or phone) and n._",
        "",
    ]
    for section in (_benchmark, _bundles, _detector_b, _head_a_export, _phone):
        md += section(root)
    return "\n".join(md) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path("."))
    ap.add_argument("--out", type=Path, default=Path("docs/results.md"))
    args = ap.parse_args(argv)
    args.out.write_text(build(args.root))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
