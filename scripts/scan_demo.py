"""Run one scan end to end with the real models; print the result and the timings.

.venv/bin/python scripts/scan_demo.py --garment shirt.jpg --label label.jpg
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--garment", type=Path, required=True)
    ap.add_argument("--label", type=Path)
    ap.add_argument("--label-text")
    ap.add_argument(
        "--detector", default="gdino", choices=["gdino", "owlv2", "rtdetr", "florence2"]
    )
    ap.add_argument("--ocr", default="apple", choices=["apple", "paddle", "florence2"])
    ap.add_argument("--bundle", type=Path, default=Path("models/scanner-v2"))
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args()

    from services.api.pipeline import run_scan
    from services.ocr.engines import load_engine
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    t0 = time.perf_counter()
    predictor = build_scanner(args.bundle, args.detector, pick_device())
    ocr = load_engine(args.ocr) if args.label else None
    print(f"models loaded in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    garment = args.garment.read_bytes()
    label = args.label.read_bytes() if args.label else None
    version = f"scanner-v{predictor.heads.version}+det={args.detector}+ocr={args.ocr}"
    times, result = [], None
    for i in range(args.repeat + 1):  # first run is warm-up
        t = time.perf_counter()
        result = run_scan(
            predictor, garment, args.label_text, label_image=label, ocr=ocr, model_version=version
        )
        if i:
            times.append(time.perf_counter() - t)
    print(result.model_dump_json(indent=2))
    print(f"latency p50 {statistics.median(times):.2f}s over {len(times)} runs", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
