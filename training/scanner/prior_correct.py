"""Undo a resampled training class mix in an exported Head A, before installing it.

A head trained with IRUS (or another sampler) learned the class mix it was shown, not the
real one, so it over-predicts rare classes. Adding tau * log(true prior / seen prior) to
its logits corrects that (tau = 1 is the exact Bayes correction); tau is chosen on val
macro F1, then temperature and the abstain threshold are re-fitted on the corrected val
logits. Test is only reported. The correction is folded into the classifier bias, so
serving is unchanged.

    python -m training.scanner.prior_correct --head runs/head_a_lora \\
        --run runs/fabric/<tag>/seed0 --out runs/head_a_lora_pc
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

from training.textilenet.metrics import summarize

TAUS = np.round(np.arange(0, 1.51, 0.05), 2)


def prior_shift(counts: np.ndarray, cap: int) -> np.ndarray:
    """log(true prior) - log(the prior IRUS showed: every class cut to ``cap``)."""
    counts = np.asarray(counts, dtype=float)
    if not cap:
        return np.zeros_like(counts)
    seen = np.minimum(counts, cap)
    return np.log(counts / counts.sum()) - np.log(seen / seen.sum())


def choose_tau(val_logits, val_y, shift, classes) -> tuple[float, dict]:
    scores = {
        float(t): summarize(val_logits + t * shift, val_y, list(classes))["macro_f1"] for t in TAUS
    }
    return max(scores, key=scores.get), scores


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--head", type=Path, required=True, help="export_head_a.py output")
    ap.add_argument("--run", type=Path, required=True, help="the train.py run it came from")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)

    from safetensors.numpy import load_file, save_file

    from services.vision.heads import softmax
    from training.scanner.export_head_a import calibrate

    head = json.loads((args.head / "head.json").read_text())
    cfg = json.loads((args.run / "config.json").read_text())
    z = np.load(args.run / "logits.npz")
    cap = cfg["args"]["irus_cap"] if cfg["args"]["sampler"] == "irus" else 0
    shift = prior_shift(np.array(cfg["train_counts"]), cap)
    tau, scores = choose_tau(z["val"], z["val_y"], shift, head["classes"])
    lv, lt = z["val"] + tau * shift, z["test"] + tau * shift
    cal = calibrate((lv, z["val_y"]), (lt, z["test_y"]), head["target_accuracy"])
    test = summarize(lt, z["test_y"], head["classes"])

    shutil.copytree(args.head, args.out)
    weights = load_file(str(args.head / "model.safetensors"))
    weights["head.bias"] = (weights["head.bias"] + tau * shift).astype(np.float32)
    save_file(weights, str(args.out / "model.safetensors"))
    head |= cal | {
        "prior_correction": {"tau": tau, "irus_cap": cap, "val_macro_f1_by_tau": scores},
        "test_macro_f1": test["macro_f1"],
    }
    (args.out / "head.json").write_text(json.dumps(head, indent=1))
    t = cal["test"]
    p = softmax(lt, cal["temperature"])
    print(
        f"tau {tau} (val macro F1 {scores[0.0]:.4f} -> {scores[tau]:.4f}); test n={t['n']}: "
        f"top-1 {t['top1']:.4f}, macro F1 {test['macro_f1']:.4f}, answers {t['coverage']:.1%} "
        f"at {t['accuracy_kept'] or 0:.4f} accuracy (mean conf {p.max(1).mean():.3f}). "
        f"Wrote {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
