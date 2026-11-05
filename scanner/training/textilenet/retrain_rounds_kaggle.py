"""Kaggle CPU kernel driver for training/textilenet/retrain_rounds.py.

The input dataset (texpilot-retrain-rounds-input) carries a snapshot of the repo's
Python sources under repo/, the frozen fabric split, the cached v8 features and the
installed head. Nothing is downloaded at run time (kernels have no internet here).
Output lands in /kaggle/working/retrain_rounds and is fetched with `kaggle kernels output`.
"""

import os
import sys
from pathlib import Path

OUT = Path("/kaggle/working/retrain_rounds")
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
# The mount point is the dataset slug; find the module rather than assume a layout.
_found = sorted(Path("/kaggle/input").rglob("training/textilenet/retrain_rounds.py"))
print("found:", [str(p) for p in _found], flush=True)
if not _found:
    for p in sorted(Path("/kaggle/input").rglob("*"))[:60]:
        print("  ", p, flush=True)
    raise SystemExit("retrain_rounds.py not found under /kaggle/input")
REPO = _found[0].parents[2]  # <repo>/training/textilenet/retrain_rounds.py
IN = REPO.parent
sys.path.insert(0, str(REPO))

from training.textilenet.retrain_rounds import main  # noqa: E402

if __name__ == "__main__":
    main(
        [
            "--features",
            str(IN / "features"),
            "--split-csv",
            str(IN / "splits" / "prelim_fabric.csv"),
            "--deployed-head",
            str(IN / "deployed" / "head_a"),
            "--out",
            str(OUT),
            "--seeds",
            "0",
            "1",
            "2",
            "--noise",
            "0.0",
            "0.05",
            "0.10",
            "--rounds",
            "5",
            "--budget",
            "2000",
        ]
    )
