"""Turn an exported linear probe head (training/scanner/export_probe_head.py, e.g. the fibre head
trained on Kaggle) into a taught head on Head A's encoder (services/vision/custom.py): it then
answers from the same encoder pass as the fabric, at no extra cost per scan.

    python -m training.scanner.probe_to_custom --name fibre --bundle models/scanner-v5 \\
        --head runs/kaggle/fibre_head/result/out/siglip2_linear

The head's temperature is folded into its weights, and its threshold (calibrated on val for
90% accuracy among answers) is kept. Only valid for the encoder the probe's features came from.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from services.vision.custom import CustomHead


def convert(head_dir: Path, name: str, encoder_id: str) -> CustomHead:
    from safetensors.numpy import load_file

    meta = json.loads((Path(head_dir) / "head.json").read_text())
    w = load_file(str(Path(head_dir) / "probe.safetensors"))
    if "probe.weight" not in w:
        raise ValueError("taught heads are linear; this export is an MLP")
    t = float(meta["temperature"])
    report = {k: meta[k] for k in ("val", "test", "test_macro_f1", "domain") if k in meta}
    return CustomHead(name, tuple(meta["classes"]), w["probe.weight"] / t, w["probe.bias"] / t,
                      float(meta["threshold"]), encoder_id, report)  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--head", type=Path, required=True, help="export_probe_head.py's output folder")
    ap.add_argument("--name", required=True, help="the head's name in scan results, e.g. fibre")
    ap.add_argument("--bundle", type=Path, required=True, help="the scanner bundle it will run in")
    ap.add_argument("--out", type=Path, default=Path("models/custom"))
    args = ap.parse_args(argv)
    head_a = json.loads((args.bundle / "head_a" / "head.json").read_text())
    probe = json.loads((args.head / "head.json").read_text())
    if probe["timm_name"] != head_a["timm_name"] or "encoder_id" in head_a:
        sys.exit(f"{args.head} was trained on public {probe['timm_name']} features; "
                 f"{args.bundle} runs {head_a.get('encoder_id', head_a['timm_name'])}")  # fmt: skip
    head = convert(args.head, args.name, head_a["timm_name"])
    print(f"wrote {head.save(args.out)}; restart the scanner to use it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
