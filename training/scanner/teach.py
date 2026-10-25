"""Teach the scanner a category of your own, e.g. the wash a denim went through, from
labelled photos (services/vision/custom.py serves it).

    .venv/bin/python -m training.scanner.teach --bundle models/scanner-v5 --photos data/custom/wash

``--photos`` holds one folder per class (stone_wash/, enzyme_wash/, rinse/, ...), at least
10 photos each, taken the way scans will be taken. The report is cross-validated on those
photos: it measures your categories on your photos, nothing more. The head abstains below
the confidence that kept 90% of the cross-validated answers right.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import numpy as np

from services.vision.custom import CustomHead
from services.vision.heads import HEAD_NAMES

MIN_PHOTOS = 10
PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def teach(photos: Path, head_a, name: str, target: float = 0.9, batch: int = 16):
    """(CustomHead, report) from class folders, on ``head_a``'s encoder features."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold, cross_val_predict
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    from services.vision.imageio import decode_image
    from training.scanner.calibration import abstain_threshold

    if name in HEAD_NAMES or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", name):
        raise ValueError(f"{name!r}: use a short lower-case name, not a built-in head's name")
    if head_a.probe is None:
        raise ValueError("custom heads need a probe Head A (frozen encoder), e.g. scanner-v4")
    photos = Path(photos)
    files = {
        d.name: sorted(p for p in d.iterdir() if p.suffix.lower() in PHOTO_EXTS)
        for d in sorted(photos.iterdir())
        if d.is_dir()
    }
    if len(files) < 2:
        raise ValueError(f"{photos}: needs a folder per class, at least two")
    few = [f"{c} ({len(f)})" for c, f in files.items() if len(f) < MIN_PHOTOS]
    if few:
        raise ValueError(f"at least {MIN_PHOTOS} photos per class; too few: {', '.join(few)}")

    classes = list(files)
    paths = [p for c in classes for p in files[c]]
    y = np.array([i for i, c in enumerate(classes) for _ in files[c]])
    x = np.concatenate([
        head_a.features([decode_image(p.read_bytes()) for p in paths[i : i + batch]])
        for i in range(0, len(paths), batch)
    ])  # fmt: skip

    def model():
        lr = LogisticRegression(C=1.0, max_iter=5000, class_weight="balanced")
        return make_pipeline(StandardScaler(), lr)

    folds = min(5, min(len(f) for f in files.values()))
    cv = StratifiedKFold(folds, shuffle=True, random_state=0)
    p = cross_val_predict(model(), x, y, cv=cv, method="predict_proba")
    right = p.argmax(1) == y
    threshold, coverage = abstain_threshold(p.max(1), right, target)

    fit = model().fit(x, y)
    scaler, lr = fit.named_steps["standardscaler"], fit.named_steps["logisticregression"]
    w = lr.coef_ / scaler.scale_
    b = lr.intercept_ - w @ scaler.mean_
    if len(classes) == 2:  # sklearn keeps one logit for two classes: split it as a softmax pair
        w, b = np.vstack([-w / 2, w / 2]), np.array([-b[0] / 2, b[0] / 2])
    report = {
        "photos": {c: len(f) for c, f in files.items()},
        "cv_accuracy": float(right.mean()),
        "cv_recall": {c: float(right[y == i].mean()) for i, c in enumerate(classes)},
        "folds": folds,
        "target_accuracy": target,
        "answers_at_target": float(coverage),
    }
    encoder = head_a.meta["timm_name"]
    return CustomHead(name, tuple(classes), w, b, float(threshold), encoder, report), report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--bundle", type=Path, required=True, help="the scanner bundle it will run in")
    ap.add_argument("--photos", type=Path, required=True, help="one folder of photos per class")
    ap.add_argument("--name", help="the head's name in scan results (default: the folder name)")
    ap.add_argument("--out", type=Path, default=Path("models/custom"))
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)

    from services.vision.heads import FineTunedHead
    from services.vision.runtime import pick_device

    head_a = FineTunedHead(args.bundle / "head_a", pick_device(args.device))
    try:
        head, report = teach(args.photos, head_a, args.name or args.photos.name)
    except ValueError as e:
        sys.exit(str(e))
    print(f"{head.name}: {', '.join(f'{c} {n}' for c, n in report['photos'].items())} photos")
    print(f"cross-validated accuracy {report['cv_accuracy']:.1%} ({report['folds']} folds); "
          f"answers {report['answers_at_target']:.0%} of photos at >= 90% right")  # fmt: skip
    for c, r in report["cv_recall"].items():
        print(f"  {c}: {r:.0%} recognised")
    print(f"wrote {head.save(args.out)}; restart the scanner to use it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
