"""scripts/score_verified.py scores the human-verified photos from a run's logits.npz."""

import csv
import importlib.util
from pathlib import Path

import numpy as np

from training.textilenet.splits import class_index

SPEC = importlib.util.spec_from_file_location(
    "score_verified", Path(__file__).parents[1] / "scripts" / "score_verified.py"
)
score = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(score)


def test_scores_only_in_scope_verified_photos(tmp_path, capsys):
    idx = class_index("fabric22")
    rows = [
        ("fabric/test/knit/a.jpg", "knit"),
        ("fabric/test/lace/b.jpg", "lace"),
        ("fabric/test/serge/c.jpg", "serge"),
    ]
    for p, _ in rows:
        (tmp_path / p).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / p).write_bytes(b"x")
    with open(tmp_path / "s.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "split", "source", "sha1"])
        w.writerows([p, lab, "test", "archive", "0"] for p, lab in rows)
    with open(tmp_path / "v.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "label"])
        w.writerows([("fabric/test/knit/a.jpg", "knit"), ("fabric/test/serge/c.jpg", "serge")])
    logits = np.zeros((2, 22))
    logits[0, idx["knit"]] = logits[1, idx["lace"]] = 1
    (tmp_path / "run").mkdir()
    y = np.array([idx["knit"], idx["lace"]])
    np.savez(tmp_path / "run/logits.npz", test=logits, test_y=y, val=logits, val_y=y)
    score.main(
        [
            "--run",
            str(tmp_path / "run"),
            "--partition",
            "fabric22",
            "--split-csv",
            str(tmp_path / "s.csv"),
            "--data-root",
            str(tmp_path),
            "--verified",
            str(tmp_path / "v.csv"),
        ]
    )
    out = capsys.readouterr().out
    assert "human-verified (n=1): macro F1 1.0000" in out  # serge photo is out of scope
