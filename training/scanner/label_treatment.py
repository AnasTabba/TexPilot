"""Hand-label surface treatment for Head B (spec §6.1). Resumable; one keypress per image.

    .venv/bin/python -m training.scanner.label_treatment --split data/splits/fabric.csv

Keys: 1 printed · 2 piece-dyed · 3 yarn-dyed · 4 undyed · s skip · q quit.
Head B ships once every class has >= 100 labels.
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import Counter
from pathlib import Path

from services.vision.taxonomy import TREATMENT_CLASSES

KEYS = {str(i): c for i, c in enumerate(TREATMENT_CLASSES, 1)}
OUT = Path("data/treatment_labels.csv")


def load_labels(csv_path: Path) -> dict[str, str]:
    if not Path(csv_path).exists():
        return {}
    with open(csv_path, newline="") as f:
        return {row["path"]: row["treatment"] for row in csv.DictReader(f)}


def append_label(csv_path: Path, image_path: str, label: str) -> None:
    csv_path = Path(csv_path)
    new = not csv_path.exists()
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["path", "treatment"])
        w.writerow([image_path, label])


def todo(pool: list[str], done: dict, n: int, seed: int = 0) -> list[str]:
    order = sorted(pool)
    random.Random(seed).shuffle(order)
    return [p for p in order if p not in done][:n]


def main(argv: list[str] | None = None) -> int:
    import matplotlib.pyplot as plt
    from PIL import Image

    from training.textilenet.splits import read_csv

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--split", type=Path, default=Path("data/splits/fabric.csv"))
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--n", type=int, default=100, help="images this session")
    args = ap.parse_args(argv)

    # train and val (Head B calibrates on val, spec §6.3); never test
    pool = [r.path for r in read_csv(args.split) if r.split != "test"]
    queue = todo(pool, load_labels(OUT), args.n)
    plt.rcParams["keymap.save"] = [k for k in plt.rcParams["keymap.save"] if k != "s"]  # s = skip
    fig, ax = plt.subplots(figsize=(6, 6))
    state = {"i": 0}

    def show():
        ax.clear()
        ax.imshow(Image.open(args.data_root / queue[state["i"]]).convert("RGB"))
        counts = Counter(load_labels(OUT).values())
        ax.set_title(
            f"{state['i'] + 1}/{len(queue)}  1 printed · 2 piece · 3 yarn · 4 undyed"
            f" · s skip · q quit\n{dict(counts)}",
            fontsize=8,
        )
        ax.axis("off")
        fig.canvas.draw_idle()

    def on_key(event):
        if event.key == "q":
            plt.close(fig)
            return
        if event.key in KEYS:
            append_label(OUT, queue[state["i"]], KEYS[event.key])
        if event.key in KEYS or event.key == "s":
            state["i"] += 1
            if state["i"] >= len(queue):
                plt.close(fig)
                return
            show()

    if not queue:
        print("nothing left to label")
        return 0
    fig.canvas.mpl_connect("key_press_event", on_key)
    show()
    plt.show()
    print(dict(Counter(load_labels(OUT).values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
