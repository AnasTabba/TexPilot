"""Index fault datasets (MVTec layout, AITEX) into Sample rows with a fixed calib split."""

import csv
import math
import random
from dataclasses import asdict, dataclass
from pathlib import Path

CALIB_SEED = 2026
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"})
_FIELDS = ["path", "label", "mask", "category", "dataset", "split"]


@dataclass(frozen=True)
class Sample:
    path: str
    label: int  # 0 good, 1 defect
    mask: str | None  # may hold several ";"-separated paths; their union is the mask
    category: str
    dataset: str
    split: str  # "train" | "calib" | "test"


def _images(folder: Path) -> list[str]:
    """Sorted image paths directly inside folder (empty if the folder is missing)."""
    if not folder.is_dir():
        return []
    return sorted(
        str(p) for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    )


def _mask_for(gt_dir: Path, stem: str) -> str | None:
    """Mask for an image stem: `<stem>_mask.png` first, then bare `<stem>.png`."""
    for name in (f"{stem}_mask.png", f"{stem}.png"):
        if (gt_dir / name).is_file():
            return str(gt_dir / name)
    return None


def _split_calib(good: list[str]) -> tuple[list[str], list[str]]:
    """Carve calib from sorted train-good paths. Returns (calib, train)."""
    n = len(good)
    k = max(math.floor(0.10 * n), min(20, n // 2))
    picked = set(random.Random(CALIB_SEED).sample(range(n), k))
    calib = [good[i] for i in range(n) if i in picked]
    train = [good[i] for i in range(n) if i not in picked]
    return calib, train


def index_mvtec_layout(
    root: Path, dataset: str, categories: list[str] | None = None
) -> list[Sample]:
    if categories is None:
        categories = sorted(d.name for d in root.iterdir() if (d / "train" / "good").is_dir())
    out: list[Sample] = []
    for cat in categories:
        cat_dir = root / cat
        if not (cat_dir / "train" / "good").is_dir():
            raise FileNotFoundError(f"no train/good folder for category {cat!r} under {root}")
        calib, train = _split_calib(_images(cat_dir / "train" / "good"))
        out += [Sample(p, 0, None, cat, dataset, "train") for p in train]
        out += [Sample(p, 0, None, cat, dataset, "calib") for p in calib]
        test_dir = cat_dir / "test"
        out += [Sample(p, 0, None, cat, dataset, "test") for p in _images(test_dir / "good")]
        for defect_dir in sorted(d for d in test_dir.iterdir() if d.is_dir() and d.name != "good"):
            gt_dir = cat_dir / "ground_truth" / defect_dir.name
            for p in _images(defect_dir):
                mask = _mask_for(gt_dir, Path(p).stem)
                out.append(Sample(p, 1, mask, cat, dataset, "test"))
    return out


def index_aitex(root: Path) -> list[Sample]:
    """AITEX: category is the fabric id `ff` in `nnnn_ddd_ff` file names."""

    def fabric(path: str) -> str:
        parts = Path(path).stem.split("_")
        if len(parts) != 3:
            raise ValueError(f"AITEX file name is not nnnn_ddd_ff: {path}")
        return parts[2]

    good: dict[str, list[str]] = {}
    for sub in sorted(d for d in (root / "NODefect_images").iterdir() if d.is_dir()):
        for p in _images(sub):
            good.setdefault(fabric(p), []).append(p)
    defects: dict[str, list[str]] = {}
    for p in _images(root / "Defect_images"):
        defects.setdefault(fabric(p), []).append(p)

    out: list[Sample] = []
    for fab in sorted(set(good) | set(defects)):
        g = sorted(good.get(fab, []))
        n_train = math.floor(0.7 * len(g))
        calib, train = _split_calib(g[:n_train])
        out += [Sample(p, 0, None, fab, "aitex", "train") for p in train]
        out += [Sample(p, 0, None, fab, "aitex", "calib") for p in calib]
        out += [Sample(p, 0, None, fab, "aitex", "test") for p in g[n_train:]]
        for p in sorted(defects.get(fab, [])):
            mask = _mask_for(root / "Mask_images", Path(p).stem)
            if mask is None:  # two-mask images: <stem>_mask1.png, <stem>_mask2.png, ...
                multi = sorted((root / "Mask_images").glob(f"{Path(p).stem}_mask[0-9]*.png"))
                mask = ";".join(str(m) for m in multi) or None
            out.append(Sample(p, 1, mask, fab, "aitex", "test"))
    return out


def save_index(samples: list[Sample], path: Path) -> None:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=_FIELDS)
        writer.writeheader()
        for s in samples:
            row = asdict(s)
            row["mask"] = s.mask or ""
            writer.writerow(row)


def load_index(path: Path) -> list[Sample]:
    with path.open(newline="") as f:
        return [
            Sample(
                path=r["path"],
                label=int(r["label"]),
                mask=r["mask"] or None,
                category=r["category"],
                dataset=r["dataset"],
                split=r["split"],
            )
            for r in csv.DictReader(f)
        ]
