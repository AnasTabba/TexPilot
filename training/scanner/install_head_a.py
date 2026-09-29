"""Install an exported fine-tuned Head A (export_head_a.py) as a new scanner bundle version.
Spec §6.5: a bundle, once written, never changes, so every stored scan's model_version
still names exactly the models that produced it. Stdlib only.

    python -m training.scanner.install_head_a --bundle models/scanner-v2 \
        --head runs/head_a --out models/scanner-v3

Prints the new Head A beside the bundle's linear one first; decide with the numbers.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path


def compare(bundle: dict, head: dict) -> list[str]:
    """The linear and the fine-tuned Head A on the numbers both record (catalog domain)."""
    lin, fine = bundle["heads"]["structure"], head
    rows = [
        ("val top-1", lin["val"]["top1"], fine["val"]["top1"]),
        ("test top-1", lin["test"]["top1"], fine["test"]["top1"]),
        ("val coverage at the target", lin["coverage_val"], fine["val"]["coverage"]),
        ("val ECE after calibration", lin["ece_val_after"], fine["val"]["ece_after"]),
    ]
    out = [f"{'Head A (catalog domain)':<30} {'linear':>8} {'fine-tuned':>11}"]
    out += [f"{name:<30} {a:>8.3f} {b:>11.3f}" for name, a, b in rows]
    return out


def install(bundle: Path, head: Path, out: Path) -> None:
    bundle, head, out = Path(bundle), Path(head), Path(out)
    if out.exists():
        raise SystemExit(f"{out} already exists; bundles are never overwritten, pick a new name")
    meta = json.loads((bundle / "bundle.json").read_text())
    info = json.loads((head / "head.json").read_text())
    shutil.copytree(bundle, out)
    shutil.copytree(head, out / "head_a")
    meta["version"] = int(meta["version"]) + 1
    meta["structure_model"] = {
        "dir": "head_a",
        "timm_name": info["timm_name"],
        "source_run": info["source_run"],
    }
    (out / "bundle.json").write_text(json.dumps(meta, indent=1))
    card = out / "MODEL_CARD.md"
    with open(card, "a", encoding="utf-8") as f:
        f.write(
            f"\n## Head A: fine-tuned (bundle v{meta['version']})\n\n"
            f"Structure comes from `{info['timm_name']}` fine-tuned on TextileNet fabric "
            f"(`{info['source_run']}`), calibrated on val; `head_a/head.json` has its metrics. "
            "Head C (fibre family) is unchanged.\n\n```\n"
            + "\n".join(compare(meta, info))
            + "\n```\n"
        )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--bundle", type=Path, required=True, help="the bundle to build on")
    ap.add_argument("--head", type=Path, required=True, help="export_head_a.py's output folder")
    ap.add_argument(
        "--out", type=Path, required=True, help="the new bundle, e.g. models/scanner-v3"
    )
    args = ap.parse_args(argv)
    bundle = json.loads((args.bundle / "bundle.json").read_text())
    head = json.loads((args.head / "head.json").read_text())
    print("\n".join(compare(bundle, head)))
    install(args.bundle, args.head, args.out)
    print(f"wrote {args.out}; serve it with TEXPILOT_MODEL_BUNDLE={args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
