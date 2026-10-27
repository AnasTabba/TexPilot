"""Flag train/val labels that are probably wrong, then check which cleaning helps a head.

The flagger must not be a model fine-tuned on these labels (it learned the noise), so it uses
frozen public encoders from the feature cache (--features). Out-of-fold MLP probabilities (5 folds
over train + val; test rows get the fold models' mean) feed two kinds of rule:

  cl        confident learning: some other class clears its own threshold (the mean
            self-confidence of rows labelled with it) and beats the labelled class
  rank<q>   the lowest q of each class by out-of-fold probability of its own label

Each rule's flags are scored against the hand-checked audit (runs/label_audit/audit.json: test
photos, label_ok), and an A/B trains the same MLP head (3 seeds) on --ab-features with all
train rows and with each rule's survivors, picked on its own val. The audit is split in two
halves per class (seed 0): the rule is chosen on half A (photos whose label is right, macro F1);
half B and the archive test (labels as given) are reported for it. Test labels never change.

    python scripts/flag_labels.py --split-csv data/splits/prelim/fabric.csv --partition fabric24 \\
        --features pub384_384 dinov2_vitb14_224 --ab-features v8_384 \\
        --audit runs/label_audit/audit.json --out runs/label_clean
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # script: repo root on path
from training.textilenet.feature_cache import FeatureCache  # noqa: E402
from training.textilenet.head_search import train_head  # noqa: E402
from training.textilenet.metrics import summarize  # noqa: E402
from training.textilenet.splits import base_partition, class_index, read_csv, rescope  # noqa: E402


def available_rows(rows, caches, allow_missing=False):
    """Align all encoders explicitly; never silently remove held-out images."""
    missing_paths = set().union(*(set(c.missing([r.path for r in rows])) for c in caches))
    missing = [r for r in rows if r.path in missing_paths]
    if missing and not allow_missing:
        raise ValueError(f'{len(missing)} rows not cached in every encoder; '
                         'inspect them before --allow-missing-features')
    return [r for r in rows if r.path not in missing_paths], missing


def audit_index(audit, rows, missing_paths):
    """Audit photos as row indices, mislabelled flags and halves A/B (per class, seed 0).
    Photos opted out as uncached are skipped without moving the others between halves;
    any other audit photo absent from ``rows`` is still an error."""
    pos = {r.path: i for i, r in enumerate(rows)}
    a_idx, bad, half, skipped = [], [], [], []
    for _, rs in sorted(audit.items()):
        order = np.random.default_rng(0).permutation(len(rs))
        for j, r in enumerate(rs):
            if r["path"] in missing_paths:
                skipped.append((r["path"], r["label_ok"]))
                continue
            a_idx.append(pos[r["path"]])
            bad.append(not r["label_ok"])
            half.append("A" if order[j] % 2 == 0 else "B")
    return np.array(a_idx), np.array(bad), np.array(half), skipped


def standardised(names, root, rows, fit):
    x = np.concatenate(
        [FeatureCache(root / n).assemble([r.path for r in rows]) for n in names], 1
    ).astype(np.float32)
    mu, sd = x[fit].mean(0), x[fit].std(0) + 1e-6
    x -= mu
    x /= sd
    return x


def flag(rule: str, p: np.ndarray, y: np.ndarray, dev: np.ndarray) -> np.ndarray:
    """Rows flagged by ``rule``; thresholds come from the train + val rows (dev)."""
    n = p.shape[1]
    own = p[np.arange(len(y)), y]
    if rule == "cl":
        t = np.array([p[dev & (y == c), c].mean() for c in range(n)])
        cand = np.where(p >= t, p, -1.0)
        return (cand.max(1) >= 0) & (cand.argmax(1) != y)
    q = float(rule.removeprefix("rank"))
    t = np.array([np.quantile(own[dev & (y == c)], q) for c in range(n)])
    return own < t[y]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--split-csv", type=Path, required=True)
    ap.add_argument("--partition", default="fabric24")
    ap.add_argument("--feature-dir", type=Path, default=Path("data/features"))
    ap.add_argument("--features", nargs="+", required=True, help="flagger feature caches")
    ap.add_argument("--ab-features", nargs="+", required=True, help="the A/B head's feature caches")
    ap.add_argument("--rules", nargs="+", default=["cl", "rank0.1", "rank0.2", "rank0.3"])
    ap.add_argument("--audit", type=Path, required=True)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    ap.add_argument("--allow-missing-features", action="store_true",
                    help="explicitly compare only common cached rows; exports missing_features.csv")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    root = args.feature_dir / base_partition(args.partition)

    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    rows = rescope([r for r in read_csv(args.split_csv) if r.source == "archive"], args.partition)
    caches = [FeatureCache(root / n) for n in set(args.features + args.ab_features)]
    rows, missing = available_rows(rows, caches, args.allow_missing_features)
    if missing:
        from collections import Counter
        counts = Counter((r.label, r.split) for r in missing)
        print("EXPLICITLY EXCLUDED uncached rows:", dict(counts), flush=True)
        with (args.out / "missing_features.csv").open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["path", "label", "split"])
            w.writerows((r.path, r.label, r.split) for r in missing)
    del caches
    split = np.array([r.split for r in rows])
    y = np.array([labels[r.label] for r in rows])
    dev, te = split != "test", split == "test"
    print({s: int((split == s).sum()) for s in ("train", "val", "test")}, flush=True)

    # out-of-fold probabilities for train + val; test: the mean of the fold models
    x = standardised(args.features, root, rows, split == "train")
    rng = np.random.default_rng(0)
    fold = np.full(len(rows), -1)
    for c in range(len(classes)):
        idx = np.flatnonzero(dev & (y == c))
        fold[rng.permutation(idx)] = np.arange(len(idx)) % args.folds
    p = np.zeros((len(rows), len(classes)), np.float32)

    def gpu(a):
        return torch.from_numpy(a).to(args.device)

    for k in range(args.folds):
        tr, ho = dev & (fold != k), fold == k
        head, f1 = train_head("mlp", gpu(x[tr]), gpu(y[tr]), gpu(x[ho]), y[ho], classes,
                              1e-3, 1e-4, 20, k, args.device)  # fmt: skip
        with torch.no_grad():
            p[ho] = torch.softmax(head(gpu(x[ho])).float(), 1).cpu().numpy()
            p[te] += torch.softmax(head(gpu(x[te])).float(), 1).cpu().numpy() / args.folds
        print(f"fold {k}: held-out macro F1 {f1:.4f}", flush=True)
    del x

    audit = json.loads(args.audit.read_text())["audit"]
    a_idx, bad, half, skipped = audit_index(audit, rows, {r.path for r in missing})
    if skipped:
        print(f"EXPLICITLY EXCLUDED {len(skipped)} uncached audit photos "
              f"({sum(not ok for _, ok in skipped)} mislabelled)", flush=True)  # fmt: skip
    own = p[np.arange(len(y)), y]
    print(f"audit: {len(a_idx)} photos, {bad.sum()} mislabelled; AUROC of low own-label "
          f"probability {roc_auc_score(bad, -own[a_idx]):.3f}", flush=True)  # fmt: skip

    xa = standardised(args.ab_features, root, rows, split == "train")
    evals = {"test (labels as given)": np.flatnonzero(te)}
    for h in "AB":
        evals[f"audit {h}: all"] = a_idx[half == h]
        evals[f"audit {h}: label right"] = a_idx[(half == h) & ~bad]

    def ab(keep):
        tr, va = (split == "train") & keep, (split == "val") & keep
        runs = []
        for seed in args.seeds:
            head, _ = train_head("mlp", gpu(xa[tr]), gpu(y[tr]), gpu(xa[va]), y[va], classes,
                                 1e-3, 1e-4, 30, seed, args.device)  # fmt: skip
            with torch.no_grad():
                z = head(gpu(xa)).float().cpu().numpy()
            runs.append({k: summarize(z[i], y[i], classes) for k, i in evals.items()})
        return {k: {m: float(np.mean([r[k][m] for r in runs])) for m in ("macro_f1", "top1")}
                for k in evals}  # fmt: skip

    results = {"none": dict(dropped=0, ab=ab(np.ones(len(rows), bool)))}
    print("none", json.dumps(results["none"]), flush=True)
    flagged = {}
    for rule in args.rules:
        flagged[rule] = f = flag(rule, p, y, dev)
        fa = f[a_idx]
        results[rule] = dict(
            dropped=int((f & dev).sum()),
            audit_precision=float((fa & bad).sum() / max(fa.sum(), 1)),
            audit_recall=float((fa & bad).sum() / bad.sum()),
            ab=ab(~(f & dev)),
        )
        print(rule, json.dumps(results[rule]), flush=True)
    pick = max(results, key=lambda k: results[k]["ab"]["audit A: label right"]["macro_f1"])
    print("chosen on audit half A:", pick, flush=True)
    (args.out / "result.json").write_text(
        json.dumps(dict(features=args.features, ab_features=args.ab_features, chosen=pick,
                        n_rows=len(rows), missing_features=len(missing),
                        results=results), indent=1)  # fmt: skip
    )

    f = flagged.get(pick, np.zeros(len(rows), bool))
    with open(args.out / "flags.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["path", "label", "split", "p_label", "top_other", "p_top_other", *flagged])
        for i, r in enumerate(rows):
            o = np.argsort(-p[i])
            k = o[0] if o[0] != y[i] else o[1]
            w.writerow([r.path, r.label, r.split, f"{own[i]:.4f}", classes[k], f"{p[i, k]:.4f}",
                        *(int(v[i]) for v in flagged.values())])  # fmt: skip
    drop = {rows[i].path for i in np.flatnonzero(f & dev)}
    drop |= {r.path for r in missing if r.split != "test"}
    with open(args.split_csv) as fh:
        src = list(csv.DictReader(fh))
    with open(args.out / "fabric_clean.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(src[0]))
        w.writeheader()
        w.writerows(r for r in src if r["path"] not in drop)
    print(f"{pick}: dropped {len(drop)} of {int(dev.sum())} train+val rows -> fabric_clean.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
