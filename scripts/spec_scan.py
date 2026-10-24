"""Spec card for a woven swatch from a flatbed scan: thread density and, given the fabric
weight, the yarn count to order. Measurement; check the first few against a pick glass.

    .venv/bin/python scripts/spec_scan.py --image swatch.png [--dpi 1200] [--gsm 380 | --oz 11.5]

Scan at >= 600 dpi (1200 for shirting), warp running up the scanner glass (selvedge parallel
to the long edge), lid closed, no auto-crop or sharpening. Weight: a 10x10 cm swatch in grams
x 100 = g/m2, or the GSM cutter reading.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # this checkout's services/

OZ_PER_SQYD_IN_GSM = 33.906


def main(argv: list[str] | None = None) -> int:
    from PIL import Image

    from services.vision.threads import thread_density, yarn_count_ne

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--dpi", type=float, help="default: read from the scan's metadata")
    weight = ap.add_mutually_exclusive_group()
    weight.add_argument("--gsm", type=float, help="fabric weight, g/m2")
    weight.add_argument("--oz", type=float, help="fabric weight, oz/yd2 (denim)")
    ap.add_argument("--max-tpi", type=float, default=200, help="finest count to look for")
    ap.add_argument("--weft-to-warp", type=float, default=1.0, help="assumed Ne_weft / Ne_warp")
    args = ap.parse_args(argv)

    with Image.open(args.image) as im:
        dpi = args.dpi or (im.info.get("dpi") or (None,))[0]
        gray = np.asarray(im.convert("L"))
    if not dpi or dpi < 100:  # phone photos often claim 72 dpi: that is not a scale
        raise SystemExit("no scan resolution: pass --dpi (the dpi you scanned at)")
    d = thread_density(gray, float(dpi), max_tpi=args.max_tpi)
    print(f"{args.image.name}: {gray.shape[1]}x{gray.shape[0]} px at {dpi:.0f} dpi")
    if d.ends_per_inch is None:
        print(d.note)
        return 1
    print(
        f"ends/inch (warp) {d.ends_per_inch:.1f}  picks/inch (weft) {d.picks_per_inch:.1f}  "
        f"[{d.tiles} tiles agree within {100 * max(d.ends_spread, d.picks_spread):.1f}%, "
        f"swatch skew {d.skew_deg:+.1f} deg]"
    )
    gsm = args.gsm or (args.oz * OZ_PER_SQYD_IN_GSM if args.oz else None)
    if gsm is None:
        print("yarn count: weigh the swatch (--gsm or --oz) to compute it")
        return 0
    lo = yarn_count_ne(gsm, d.ends_per_inch, d.picks_per_inch, 0.06, 0.04, args.weft_to_warp)
    hi = yarn_count_ne(gsm, d.ends_per_inch, d.picks_per_inch, 0.14, 0.10, args.weft_to_warp)
    print(
        f"yarn count at {gsm:.0f} g/m2 ({gsm / OZ_PER_SQYD_IN_GSM:.1f} oz/yd2), crimp 6-14%: "
        f"warp Ne {lo[0]:.1f}-{hi[0]:.1f}, weft Ne {lo[1]:.1f}-{hi[1]:.1f} "
        f"(weft assumed {args.weft_to_warp:g} x warp count; cotton count)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
