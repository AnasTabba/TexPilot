"""Rebuild a LoRA-adapted encoder from the pretrained encoder file and a run's adapters
(lora.safetensors, a few MB, scale in its metadata), e.g. for a probe Head A:

    python -m training.scanner.apply_lora --encoder models/scanner-v5/head_a/encoder.safetensors \\
        --lora lora.safetensors --out models/scanner-v6/head_a/encoder.safetensors
"""

from __future__ import annotations

import argparse
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import load_file, save_file

from training.textilenet.recipe import apply_lora


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--encoder", type=Path, required=True, help="pretrained encoder weights")
    ap.add_argument("--lora", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    with safe_open(str(args.lora), "pt") as f:
        scale = float(f.metadata()["scale"])
    weights = apply_lora(load_file(str(args.encoder)), load_file(str(args.lora)), scale)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    save_file({k: v.contiguous() for k, v in weights.items()}, str(args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
