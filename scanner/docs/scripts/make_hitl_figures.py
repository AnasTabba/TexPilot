"""Regenerate the human-in-the-loop figures from saved result files.

Every figure reads a CSV/JSON written by the agent that produced the result. If a
source file is missing the figure is skipped and a MISSING line is printed; nothing
is drawn from placeholder numbers.

Run from the repo root:
    .venv/bin/python docs/scripts/make_hitl_figures.py
Outputs: docs/figures/<name>.png and docs/figures/<name>.pdf
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "figures"
ABSTAIN = ROOT / "training" / "textilenet" / "results" / "abstain"
RETRAIN = ROOT / "training" / "textilenet" / "results" / "retrain_rounds"

# Macro F1 is drawn first everywhere (project rule); accuracy second.
C_F1 = "#1f5fa8"
C_ACC = "#8a8a8a"
C_FLOOR = "#c0392b"
C_BASE = "#7f8c8d"


def save(fig, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "pdf"):
        fig.savefig(OUT / f"{name}.{ext}", dpi=200, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote docs/figures/{name}.png and .pdf")


def missing(what: str, path: Path) -> None:
    print(f"MISSING {what}: {path.relative_to(ROOT)} (figure skipped)")


def risk_coverage() -> None:
    path = ABSTAIN / "sweep.csv"
    summary_path = ABSTAIN / "summary.json"
    if not path.exists() or not summary_path.exists():
        missing("risk-coverage", path)
        return
    rows = [
        r
        for r in csv.DictReader(path.open())
        if r["split"] == "test" and r["confidence"] == "maxprob" and r["macro_f1_answered"] and r["acc_answered"]
    ]  # rows with nothing answered have empty metrics and are skipped
    rows.sort(key=lambda r: float(r["coverage"]))
    cov = [float(r["coverage"]) for r in rows]
    f1 = [float(r["macro_f1_answered"]) for r in rows]
    floor = [float(r["macro_f1_abstain_as_wrong"]) for r in rows]
    acc = [float(r["acc_answered"]) for r in rows]
    primary = json.loads(summary_path.read_text())["operating_points"]["0.90"]["test"]

    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    ax.plot(cov, f1, color=C_F1, lw=2, label="macro F1, answered photos (primary)")
    ax.plot(cov, floor, color=C_FLOOR, lw=1.6, ls="--", label="macro F1, abstentions counted as wrong")
    ax.plot(cov, acc, color=C_ACC, lw=1.4, label="accuracy, answered photos")
    ax.scatter([primary["coverage"]], [primary["macro_f1_answered"]], color=C_F1, zorder=5, s=40)
    ax.annotate(
        f"tau 0.665 (val target 0.90)\ncoverage {primary['coverage']:.3f}, macro F1 {primary['macro_f1_answered']:.3f}",
        xy=(primary["coverage"], primary["macro_f1_answered"]),
        xytext=(0.42, 0.74), fontsize=8, arrowprops=dict(arrowstyle="-", lw=0.6),
    )
    ax.set_xlabel("coverage (fraction of test photos answered)")
    ax.set_ylabel("score on test (scanner-v8 head A, 24 classes)")
    ax.set_xlim(0.4, 1.0)
    ax.set_ylim(0.5, 1.0)
    ax.grid(alpha=0.25)
    ax.legend(fontsize=8, loc="lower right")
    ax.set_title("Risk-coverage: macro F1 first, then accuracy", fontsize=10)
    save(fig, "risk_coverage")


def reliability() -> None:
    summary_path = ABSTAIN / "summary.json"
    if not summary_path.exists():
        missing("reliability", summary_path)
        return
    s = json.loads(summary_path.read_text())
    bins = s["reliability_test"]
    ece = s["calibration"]["ece_test"]
    fig, axes = plt.subplots(1, 2, figsize=(7.4, 3.6), sharey=True)
    for ax, key, title in (
        (axes[0], "before", f"uncalibrated (T=1), ECE {ece['T1']:.4f}"),
        (axes[1], "after", f"temperature T={s['calibration']['t_served']:.3f}, ECE {ece['T_served']:.4f}"),
    ):
        pts = [b for b in bins[key] if b["n"] > 0]
        ax.plot([0, 1], [0, 1], color="#999999", lw=1, ls=":")
        ax.plot([b["mean_conf"] for b in pts], [b["accuracy"] for b in pts], "o-", color=C_F1, ms=4)
        ax.set_title(title, fontsize=8.5)
        ax.set_xlabel("mean confidence in bin")
        ax.grid(alpha=0.25)
    axes[0].set_ylabel("accuracy in bin (test)")
    fig.suptitle("Reliability diagram, scanner-v8 head A, test split (empty bins omitted)", fontsize=9)
    save(fig, "reliability")


def learning_curve() -> None:
    """Macro F1 and accuracy per correction round, with baselines. Format set by Agent 3."""
    path = RETRAIN / "rounds_summary.csv"
    if not path.exists():
        missing("learning curve", path)
        return
    print("learning curve: reader not yet written for", path.name)


def per_class_f1() -> None:
    """Per-class F1 before and after the final round. Format set by Agent 3."""
    path = RETRAIN / "per_class_before_after.csv"
    if not path.exists():
        missing("per-class F1", path)
        return
    print("per-class F1: reader not yet written for", path.name)


if __name__ == "__main__":
    risk_coverage()
    reliability()
    learning_curve()
    per_class_f1()
    sys.exit(0)
