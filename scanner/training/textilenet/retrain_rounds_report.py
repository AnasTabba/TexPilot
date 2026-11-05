"""Aggregate retrain_rounds runs: mean and std over seeds, val-selected round, learning curve.

    python -m training.textilenet.retrain_rounds_report \
        --runs training/textilenet/results/retrain_rounds

Selection uses validation macro F1 only. Test columns are reported for the chosen round,
never used to pick it.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

KEYS = [
    "val_macro_f1",
    "test_macro_f1",
    "test_top1",
    "test_abstain_rate",
    "stream_abstain_rate",
    "corrections_used",
    "worker_flipped_round",
]


def _ms(values: list[float]) -> tuple[float, float]:
    a = np.asarray(values, dtype=float)
    return float(a.mean()), float(a.std(ddof=1)) if len(a) > 1 else 0.0


def aggregate(records: list[dict]) -> dict:
    cells: dict = defaultdict(list)
    for r in records:
        if r["strategy"] == "ceiling_all_labels":
            continue
        cells[(r["strategy"], r["noise"], r["round"])].append(r)

    table = []
    for (strategy, noise, rnd), rs in sorted(cells.items()):
        row = {"strategy": strategy, "noise": noise, "round": rnd, "n_seeds": len(rs)}
        for k in KEYS:
            m, s = _ms([r[k] for r in rs])
            row[f"{k}_mean"], row[f"{k}_std"] = m, s
        pc = defaultdict(list)
        for r in rs:
            for c, v in r["test_per_class_f1"].items():
                pc[c].append(v)
        row["test_per_class_f1_mean"] = {c: float(np.mean(v)) for c, v in pc.items()}
        table.append(row)

    selected = {}
    for strategy, noise in sorted({(t["strategy"], t["noise"]) for t in table}):
        rows = [t for t in table if t["strategy"] == strategy and t["noise"] == noise]
        best = max(rows, key=lambda t: t["val_macro_f1_mean"])  # validation only
        selected[f"{strategy}|{noise:.2f}"] = {
            "round": best["round"],
            "val_macro_f1_mean": best["val_macro_f1_mean"],
            "test_macro_f1_mean": best["test_macro_f1_mean"],
            "test_macro_f1_std": best["test_macro_f1_std"],
            "test_top1_mean": best["test_top1_mean"],
            "corrections_used": best["corrections_used_mean"],
        }

    ceiling = [r for r in records if r["strategy"] == "ceiling_all_labels"]
    out = {"per_round": table, "val_selected": selected}
    if ceiling:
        out["ceiling_all_labels"] = {
            "n_seeds": len(ceiling),
            "val_macro_f1": _ms([r["val_macro_f1"] for r in ceiling]),
            "test_macro_f1": _ms([r["test_macro_f1"] for r in ceiling]),
            "test_top1": _ms([r["test_top1"] for r in ceiling]),
        }
    return out


def learning_curve(
    table: list[dict], out_png: Path, deployed_test: float | None, ceiling: float | None
) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5), sharey=True)
    colors = {"none": "black", "random": "tab:gray", "abstain": "tab:blue", "mixed": "tab:orange"}
    for strategy in ("none", "random", "abstain", "mixed"):
        for noise in sorted({t["noise"] for t in table if t["strategy"] == strategy}):
            rows = sorted(
                (t for t in table if t["strategy"] == strategy and t["noise"] == noise),
                key=lambda t: t["round"],
            )
            if not rows:
                continue
            label = strategy if strategy == "none" else f"{strategy} (noise {noise:.0%})"
            ls = "-" if noise == 0 else ("--" if noise < 0.10 else ":")
            x_r = [t["round"] for t in rows]
            x_c = [t["corrections_used_mean"] for t in rows]
            y = np.array([t["test_macro_f1_mean"] for t in rows])
            s = np.array([t["test_macro_f1_std"] for t in rows])
            for ax, x in ((ax1, x_r), (ax2, x_c)):
                (line,) = ax.plot(
                    x, y, ls=ls, marker="o", ms=3, color=colors[strategy], label=label
                )
                ax.fill_between(x, y - s, y + s, alpha=0.10, color=line.get_color())
    if ceiling is not None:
        for ax in (ax1, ax2):
            ax.axhline(ceiling, color="green", lw=1, ls="--", label="all archive labels")
    if deployed_test is not None:
        for ax in (ax1, ax2):
            ax.axhline(deployed_test, color="red", lw=1, ls=":", label="deployed head (test)")
    ax1.set_xlabel("correction round")
    ax2.set_xlabel("cumulative corrections")
    ax1.set_ylabel("test macro F1 (mean ± std over seeds)")
    for ax in (ax1, ax2):
        ax.grid(alpha=0.3)
    ax2.legend(fontsize=7, loc="lower right")
    fig.suptitle(
        "Simulated worker corrections on the frozen fabric24 head (archive test, n=24,303)"
    )
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=150)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--runs", type=Path, required=True)
    args = ap.parse_args(argv)
    records = [json.loads(line) for line in (args.runs / "runs.jsonl").read_text().splitlines()]
    summary = aggregate(records)
    meta = json.loads((args.runs / "run_meta.json").read_text())
    summary["run_meta"] = {
        k: meta[k]
        for k in ("config", "recipe", "pool_rows", "exclusions", "split_sha256")
        if k in meta
    }
    if "parity" in meta:
        summary["deployed_parity"] = meta["parity"]
    (args.runs / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True))

    import csv

    flat = [{k: v for k, v in t.items() if not isinstance(v, dict)} for t in summary["per_round"]]
    with open(args.runs / "summary.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(flat[0]))
        w.writeheader()
        w.writerows(flat)
    deployed = (summary.get("deployed_parity") or {}).get("test", {}).get("macro_f1")
    ceil = summary.get("ceiling_all_labels", {}).get("test_macro_f1", [None])[0]
    learning_curve(summary["per_round"], args.runs / "learning_curve.png", deployed, ceil)
    print(json.dumps(summary["val_selected"], indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
