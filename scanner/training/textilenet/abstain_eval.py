"""Risk-coverage for the deployed fabric24 head: confidence, abstain threshold, calibration.

Input is the deployed head's cached logits (runs/codex_f1_20261027/task1_baseline/
baseline_logits.npz). Those logits reproduce the stored val/test macro F1 exactly, so no
image or encoder is touched. Every choice (confidence measure, temperature, threshold) is
made on validation; test is evaluated once per pre-chosen operating point.

Run: python -m training.textilenet.abstain_eval
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

from services.vision.heads import softmax
from training.scanner.calibration import (
    abstain_threshold,
    aurc,
    confidences,
    ece,
    fit_temperature,
    nll,
)
from training.textilenet.metrics import summarize

ROOT = Path(__file__).resolve().parents[2]
LOGITS = ROOT / "runs/codex_f1_20261027/task1_baseline/baseline_logits.npz"
HEAD = ROOT / "models/scanner-v8/head_a/head.json"
OUT = ROOT / "training/textilenet/results/abstain"
TARGETS = (0.85, 0.90, 0.95)  # validation accuracy among answered; 0.90 = the deployed target
PRIMARY = 0.90
GRID = np.linspace(0.0, 1.0, 201)


def _load() -> tuple[dict, list[str]]:
    d = np.load(LOGITS, allow_pickle=True)
    data = {
        s: {"logits": d[s], "y": d[f"{s}_y"], "paths": d[f"{s}_paths"], "labels": d[f"{s}_labels"]}
        for s in ("val", "test")
    }
    return data, [str(c) for c in d["classes"]]


def _at(logits, y, conf, tau, classes) -> dict:
    """Metrics for the answers with conf >= tau. Macro F1 uses the repo's summarize()."""
    keep = conf >= tau
    row = {
        "threshold": float(tau),
        "coverage": float(keep.mean()),
        "n_answered": int(keep.sum()),
        "abstain_rate": float(1 - keep.mean()),
        "macro_f1_answered": None,
        "acc_answered": None,
        "n_classes_answered": 0,
    }
    # Floor: every abstention counted as a wrong answer, over all rows and all 24 classes.
    # Unlike macro F1 on answered, a class that is never answered still counts here.
    filled = np.hstack([logits, np.full((len(y), 1), -1e9, logits.dtype)])
    filled[~keep] = -1e9
    filled[~keep, -1] = 0.0  # abstained rows argmax to the extra "unknown" column
    row["macro_f1_abstain_as_wrong"] = summarize(filled, y, classes + ["unknown"])["macro_f1"]
    if keep.any():
        r = summarize(logits[keep], y[keep], classes)
        row.update(
            macro_f1_answered=r["macro_f1"],
            acc_answered=r["top1"],
            n_classes_answered=int((np.bincount(y[keep], minlength=len(classes)) > 0).sum()),
        )
    return row


def _per_class_abstain(logits, y, conf, tau, classes) -> dict:
    keep = conf >= tau
    out = {}
    for i, c in enumerate(classes):
        m = y == i
        n = int(m.sum())
        k = keep & m
        out[c] = {
            "support": n,
            "abstain_rate": round(float(1 - k.sum() / n), 4) if n else None,
            "acc_answered": round(float((logits[k].argmax(1) == i).mean()), 4) if k.any() else None,
        }
    return out


def _reliability(p: np.ndarray, y: np.ndarray, bins: int = 15) -> list[dict]:
    conf, correct = p.max(1), p.argmax(1) == y
    edges = np.linspace(0.0, 1.0, bins + 1)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (conf > lo) & (conf <= hi)
        rows.append(
            {
                "bin_lo": round(float(lo), 4),
                "bin_hi": round(float(hi), 4),
                "n": int(m.sum()),
                "mean_conf": round(float(conf[m].mean()), 4) if m.any() else None,
                "accuracy": round(float(correct[m].mean()), 4) if m.any() else None,
            }
        )
    return rows


def _plot(sweep_test, primary_row, reliab, path_rc, path_rel, conf_name) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cov = [r["coverage"] for r in sweep_test if r["macro_f1_answered"] is not None]
    f1 = [r["macro_f1_answered"] for r in sweep_test if r["macro_f1_answered"] is not None]
    acc = [r["acc_answered"] for r in sweep_test if r["acc_answered"] is not None]
    fig, ax = plt.subplots(figsize=(6.4, 4.4))
    ax.plot(cov, f1, label="macro F1 on answered")
    ax.plot(cov, acc, label="accuracy on answered", linestyle="--")
    ax.axvline(
        primary_row["coverage"],
        color="grey",
        linestyle=":",
        label=f"val-chosen ({PRIMARY:.2f} target)",
    )
    ax.set_xlabel("coverage (fraction answered, test)")
    ax.set_ylabel("score on answered")
    ax.set_title(f"Risk-coverage, fabric24 head A, confidence = {conf_name}")
    ax.set_xlim(0, 1.02)
    ax.set_ylim(0, 1.02)
    ax.grid(alpha=0.3)
    ax.legend(loc="lower left")
    fig.tight_layout()
    fig.savefig(path_rc, dpi=150)
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(9, 4.2), sharey=True)
    for ax, key, title in zip(
        axes, ("before", "after"), ("T = 1 (uncalibrated)", "T fitted on val"), strict=True
    ):
        rows = reliab[key]
        xs = [(r["bin_lo"] + r["bin_hi"]) / 2 for r in rows if r["n"]]
        ys = [r["accuracy"] for r in rows if r["n"]]
        ax.plot([0, 1], [0, 1], color="grey", linestyle="--", label="perfect")
        ax.bar(xs, ys, width=1 / 15, alpha=0.6, label="accuracy in bin")
        ax.plot(
            [r["mean_conf"] for r in rows if r["n"]],
            ys,
            "o-",
            color="C3",
            label="(mean confidence, accuracy)",
        )
        ax.set_title(title)
        ax.set_xlabel("confidence (max softmax)")
        ax.grid(alpha=0.3)
        ax.legend(loc="upper left", fontsize=8)
    axes[0].set_ylabel("accuracy (test)")
    fig.tight_layout()
    fig.savefig(path_rel, dpi=150)
    plt.close(fig)


def main() -> dict:
    data, classes = _load()
    served = json.loads(HEAD.read_text())
    tv, tt = data["val"], data["test"]

    # Temperature: refit on validation NLL and compare with the served one.
    t_fit = fit_temperature(tv["logits"], tv["y"])
    t_served = float(served["temperature"])
    calib = {
        "t_fit_val": t_fit,
        "t_served": t_served,
        "nll_val": {
            "T1": nll(tv["logits"], tv["y"], 1.0),
            "T_fit": nll(tv["logits"], tv["y"], t_fit),
        },
        "nll_test": {
            "T1": nll(tt["logits"], tt["y"], 1.0),
            "T_fit": nll(tt["logits"], tt["y"], t_fit),
            "T_served": nll(tt["logits"], tt["y"], t_served),
        },
        "ece_test": {
            "T1": ece(softmax(tt["logits"], 1.0), tt["y"]),
            "T_fit": ece(softmax(tt["logits"], t_fit), tt["y"]),
            "T_served": ece(softmax(tt["logits"], t_served), tt["y"]),
        },
        "ece_test_served_recorded": served["test"]["ece_after"],
    }

    # Confidence measure: choose the lowest validation AURC.
    conf_val, p_val = confidences(tv["logits"], t_fit)
    conf_test, p_test = confidences(tt["logits"], t_fit)
    correct_val = tv["logits"].argmax(1) == tv["y"]
    correct_test = tt["logits"].argmax(1) == tt["y"]
    aurc_val = {k: aurc(v, correct_val) for k, v in conf_val.items()}
    best = min(aurc_val, key=aurc_val.get)
    # A different measure must beat the served max-prob rule beyond resampling noise
    # (paired bootstrap over validation images), or the served rule stays: no serving change
    # for a gain the validation set cannot resolve.
    rng = np.random.default_rng(0)
    diffs = []
    for _ in range(1000):
        idx = rng.integers(0, len(correct_val), len(correct_val))
        diffs.append(
            aurc(conf_val[best][idx], correct_val[idx])
            - aurc(conf_val["maxprob"][idx], correct_val[idx])
        )
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    boot = {
        "measure": best,
        "vs": "maxprob",
        "aurc_diff_mean": float(np.mean(diffs)),
        "ci95": [float(lo), float(hi)],
    }
    # Kept: max-prob. Margin ranks validation slightly better (AURC gap in boot above, about
    # 0.001), but the served rule is a max-prob threshold in services/vision/heads.decide; a
    # margin rule would need a serving change and its own calibration. Test AURC is reported.
    conf_name = "maxprob"
    cv, ct = conf_val[conf_name], conf_test[conf_name]

    # Threshold per target: chosen on validation only; then one test evaluation each.
    operating = {}
    for target in TARGETS:
        tau, cov_val = abstain_threshold(cv, correct_val, target)
        row = {"target_acc_val": target, "threshold": float(tau), "val_coverage": float(cov_val)}
        if tau <= 1.0:
            row["val"] = _at(tv["logits"], tv["y"], cv, tau, classes)
            row["test"] = _at(tt["logits"], tt["y"], ct, tau, classes)
        else:
            row["test"] = _at(tt["logits"], tt["y"], ct, tau, classes)
        operating[f"{target:.2f}"] = row

    # Full sweep, reported on both splits (the threshold itself is not picked from these).
    sweep_rows = []
    for tau in GRID:
        for split, logits, y, c in (
            ("val", tv["logits"], tv["y"], cv),
            ("test", tt["logits"], tt["y"], ct),
        ):
            r = _at(logits, y, c, tau, classes)
            sweep_rows.append({"split": split, "confidence": conf_name, **r})
    sweep_test = [r for r in sweep_rows if r["split"] == "test"]

    # Served-configuration check: the deployed T and threshold should give head.json's numbers.
    served_tau = float(served["threshold"])
    served_chk = _at(
        tt["logits"], tt["y"], softmax(tt["logits"], t_served).max(1), served_tau, classes
    )
    served_val = _at(
        tv["logits"], tv["y"], softmax(tv["logits"], t_served).max(1), served_tau, classes
    )

    primary = operating[f"{PRIMARY:.2f}"]
    tau_p = primary["threshold"]
    unknown_test = ct < tau_p
    pc = _per_class_abstain(tt["logits"], tt["y"], ct, tau_p, classes)

    reliab = {
        "before": _reliability(softmax(tt["logits"], 1.0), tt["y"]),
        "after": _reliability(softmax(tt["logits"], t_fit), tt["y"]),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "sweep.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sweep_rows[0]))
        w.writeheader()
        w.writerows(sweep_rows)
    with (OUT / "abstained_test.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "true_label", "pred_label", "confidence", "unknown", "correct"])
        pred = tt["logits"].argmax(1)
        for i in np.argsort(ct):
            if unknown_test[i]:
                w.writerow(
                    [
                        str(tt["paths"][i]),
                        tt["labels"][i],
                        classes[pred[i]],
                        f"{ct[i]:.4f}",
                        True,
                        bool(pred[i] == tt["y"][i]),
                    ]
                )
    with (OUT / "per_class_abstain_test.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["class", "support", "abstain_rate", "acc_answered"])
        for c, v in pc.items():
            w.writerow([c, v["support"], v["abstain_rate"], v["acc_answered"]])

    summary = {
        "logits": str(LOGITS.relative_to(ROOT)),
        "classes": classes,
        "n_val": int(len(tv["y"])),
        "n_test": int(len(tt["y"])),
        "deployed_macro_f1_val_test": [
            float(summarize(tv["logits"], tv["y"], classes)["macro_f1"]),
            float(summarize(tt["logits"], tt["y"], classes)["macro_f1"]),
        ],
        "confidence_aurc_val": aurc_val,
        "confidence_test_aurc": {k: aurc(v, correct_test) for k, v in conf_test.items()},
        "confidence_chosen": conf_name,
        "confidence_bootstrap_vs_maxprob": boot,
        "calibration": calib,
        "reliability_test": reliab,
        "operating_points": operating,
        "primary_target": PRIMARY,
        "primary_threshold": tau_p,
        "primary_per_class_abstain_test": pc,
        "served_check_test": {"threshold": served_tau, "T": t_served, **served_chk},
        "served_check_val": {"threshold": served_tau, "T": t_served, **served_val},
        "served_recorded": {"test": served["test"], "val": served["val"]},
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=float))
    _plot(
        sweep_test,
        primary["test"],
        reliab,
        OUT / "risk_coverage.png",
        OUT / "reliability.png",
        conf_name,
    )
    return summary


if __name__ == "__main__":
    s = main()
    print(
        json.dumps(
            {
                k: s[k]
                for k in (
                    "confidence_aurc_val",
                    "confidence_chosen",
                    "calibration",
                    "primary_threshold",
                )
            },
            indent=2,
            default=float,
        )
    )
    for k, v in s["operating_points"].items():
        t = v["test"]
        print(
            k,
            "val_tau",
            round(v["threshold"], 4),
            "test cov",
            round(t["coverage"], 4),
            "macroF1_ans",
            round(t["macro_f1_answered"], 4) if t["macro_f1_answered"] is not None else None,
            "acc_ans",
            round(t["acc_answered"], 4) if t["acc_answered"] is not None else None,
        )
    print(
        "served check",
        {
            k: round(v, 4) if isinstance(v, float) else v
            for k, v in s["served_check_test"].items()
            if k in ("threshold", "coverage", "acc_answered", "macro_f1_answered")
        },
    )
