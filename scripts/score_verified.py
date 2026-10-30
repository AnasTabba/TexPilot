"""Score a train.py run on the human-verified photos (all from the archive test split).

    python scripts/score_verified.py --run runs/fabric22/<tag>/seed0 --partition fabric22 \\
        --split-csv fabric.csv --data-root data --verified verified_paths.csv

``verified_paths.csv`` is path,label (the judges' confirmed class). Photos whose class is out of
the scope are skipped. Row order of ``logits.npz`` is the test rows of the split CSV that exist on
disk, as train.py reads them.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # run as a script: repo root on path
from training.textilenet.data import load_rows  # noqa: E402
from training.textilenet.metrics import summarize  # noqa: E402
from training.textilenet.splits import SCOPES, class_index, rescope  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", type=Path, required=True)
    ap.add_argument("--partition", required=True)
    ap.add_argument("--split-csv", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--verified", type=Path, required=True)
    args = ap.parse_args(argv)

    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    z = np.load(args.run / "logits.npz")
    rows = rescope(load_rows(args.split_csv, args.data_root)["test"], args.partition)
    assert len(rows) == len(z["test_y"]), (
        f"{len(rows)} test rows on disk vs {len(z['test_y'])} logits"
    )
    mapping = SCOPES[args.partition][1] if args.partition in SCOPES else {}
    truth = {}
    with open(args.verified, newline="") as f:
        for v in csv.DictReader(f):
            if lab := mapping.get(v["label"], v["label"]):
                truth[v["path"]] = lab
    idx = [i for i, r in enumerate(rows) if r.path in truth]
    assert idx, "no verified photo found among the test rows"
    y = np.array([labels[truth[rows[i].path]] for i in idx])
    for name, logits, labels in (
        ("archive test (raw labels)", z["test"], z["test_y"]),
        (f"human-verified (n={len(idx)})", z["test"][idx], y),
    ):
        s = summarize(logits, labels, classes)
        print(f"{name}: macro F1 {s['macro_f1']:.4f} | top-1 {s['top1']:.4f} | n {len(labels)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
