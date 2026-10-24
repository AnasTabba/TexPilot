"""Yarn spec from a flatbed scan (POST /api/v1/spec): what to order to make this fabric again.

Thread density is measured on the scan (services/vision/threads.py; the scan's dpi is the
scale, or for a phone photo the printed card lying on the fabric, services/vision/marker.py),
the yarn count follows from the density and the fabric's weight, the fibre comes from
the care label. Every assumption behind a number is stated next to it, and an input that
cannot give a trustworthy answer is refused (422) rather than guessed at.
"""

from __future__ import annotations

import io
import math
import uuid

from services.api.pipeline import stated_composition
from services.api.schemas import FlagModel, SpecDensity, SpecResult, YarnCount
from services.vision.errors import UnsupportedImage

OZ_PER_SQYD_IN_GSM = 33.906
MIN_DPI, MAX_PIXELS = 300, 100_000_000
GSM_RANGE = (30.0, 1200.0)
#: Cotton counts a spinner commonly sells.
STANDARD_NE = (4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 26, 28, 30, 32, 34, 36, 40, 50, 60, 80, 100)
IRREGULAR_SPREAD = 0.05


def standard_ne(lo: float, hi: float) -> int:
    """The standard count nearest the middle of a range (geometric: counts are reciprocal)."""
    mid = math.sqrt(lo * hi)
    return min(STANDARD_NE, key=lambda n: abs(math.log(n / mid)))


def _flag(code: str, message: str, severity: str = "info") -> FlagModel:
    return FlagModel(code=code, message=message, severity=severity)


def _fibres(stated) -> str:
    fibres = stated.fibers
    if not fibres:
        return "fibre: add the care label"
    return " + ".join(f"{f.pct:g}% {f.name.replace('_', '/')}" for f in fibres)


def run_spec(
    scan: bytes,
    *,
    dpi: float | None = None,
    construction: str = "woven",
    gsm: float | None = None,
    oz: float | None = None,
    label_text: str | None = None,
    label_image: bytes | None = None,
    ocr=None,
    card_mm: float | None = None,
) -> SpecResult:
    import numpy as np
    from PIL import Image

    from services.vision.marker import MARKER_MM, find_card
    from services.vision.threads import (
        MIN_PERIOD_PX,
        knit_density,
        thread_density,
        yarn_count_knit_ne,
        yarn_count_ne,
    )

    if construction not in ("woven", "knit"):
        raise UnsupportedImage("construction must be 'woven' or 'knit'")
    if card_mm is not None and not 10 <= card_mm <= 100:
        raise UnsupportedImage(f"card_mm {card_mm:g}: the card's marker is about 30 mm wide")
    if gsm is None and oz is not None:
        gsm = oz * OZ_PER_SQYD_IN_GSM
    if gsm is not None and not GSM_RANGE[0] <= gsm <= GSM_RANGE[1]:
        raise UnsupportedImage(
            f"fabric weight {gsm:g} g/m2 is outside {GSM_RANGE}: check the units"
        )

    try:
        im = Image.open(io.BytesIO(scan))
        if im.width * im.height > MAX_PIXELS:
            raise UnsupportedImage("scan too large: crop it to the swatch")
        file_dpi = (im.info.get("dpi") or (None,))[0]
        gray = np.asarray(im.convert("L"))
    except UnsupportedImage:
        raise
    except Exception as e:  # noqa: BLE001 -- an undecodable upload is the client's 422
        raise UnsupportedImage(f"scan_image could not be decoded: {type(e).__name__}") from e
    flags: list[FlagModel] = []
    card = None if dpi else find_card(gray, card_mm or MARKER_MM)
    if card is not None:  # a phone photo with the card: straightened, scale from the marker
        gray, dpi, source = card.gray, card.ppi, "card"
        msg = f"Scale from the printed card ({card_mm or MARKER_MM:g} mm marker): check that it "
        flags.append(_flag("CARD_SCALE", msg + "printed at that size, or enter what it measures."))
    else:
        source = "form" if dpi else "file"
        dpi = float(dpi or file_dpi or 0)
    if dpi < MIN_DPI:
        if source == "card":
            raise UnsupportedImage(
                f"the photo resolves only {dpi:.0f} pixels per inch: hold the phone closer, so "
                "the card fills about a quarter of the photo's width"
            )
        raise UnsupportedImage(
            "scan resolution unknown or below 300 dpi: scan the swatch flat on a flatbed scanner "
            "at 600-1200 dpi, or lay the printed TexPilot card on the fabric and photograph both, "
            "or pass the dpi you scanned at"
        )

    max_tpi = min(200.0, dpi / MIN_PERIOD_PX)
    if max_tpi < 200:
        msg = f"At {dpi:.0f} dpi only up to {max_tpi:.0f} threads per inch can be resolved; "
        fix = "photograph from closer" if source == "card" else "scan at 1200 dpi"
        flags.append(_flag("LOW_DPI", msg + f"for fine shirting {fix}."))
    measure = knit_density if construction == "knit" else thread_density
    d = measure(gray, dpi, max_tpi=max_tpi)
    if d.ends_per_inch is None:
        raise UnsupportedImage(d.note)
    spread = max(d.ends_spread, d.picks_spread)
    if spread > IRREGULAR_SPREAD:
        flags.append(_flag("IRREGULAR_SPACING", f"Thread spacing varies {100 * spread:.0f}% "
                           "across the swatch (slub or distorted fabric): confirm with a pick "
                           "glass.", "medium"))  # fmt: skip
    if d.tiles < 4:
        flags.append(_flag("SMALL_SCAN", "Scan at least 1 x 1 inch of fabric for a firm count.",
                           "medium"))  # fmt: skip

    _, stated = stated_composition(label_text, label_image, ocr, flags)
    fibre = _fibres(stated)
    ends, picks = d.ends_per_inch, d.picks_per_inch
    if construction == "knit":
        construction_line = (
            f"Construction: weft knit, {ends:.0f} wales x {picks:.0f} courses per inch"
        )
    else:
        construction_line = f"Construction: woven, {ends:.0f} ends x {picks:.0f} picks per inch"

    yarn, order = None, []
    if gsm is None:
        flags.append(_flag("NO_WEIGHT", "Weigh a 10 x 10 cm swatch (grams x 100 = g/m2), or use "
                                        "the GSM cutter, to get the yarn count."))  # fmt: skip
    elif construction == "knit":
        lo, hi = sorted(yarn_count_knit_ne(gsm, ends, picks, t) for t in (1.3, 1.6))
        yarn = YarnCount(warp_ne=(round(lo, 1), round(hi, 1)), warp_standard_ne=standard_ne(lo, hi),
                         basis="tightness factor 1.3-1.6 (cotton jersey)")  # fmt: skip
        order.append(f"Yarn: Ne {yarn.warp_standard_ne}s (range {lo:.1f}-{hi:.1f}), {fibre}")
    else:
        lo = yarn_count_ne(gsm, ends, picks, 0.06, 0.04)
        hi = yarn_count_ne(gsm, ends, picks, 0.14, 0.10)
        w, f = sorted((lo[0], hi[0])), sorted((lo[1], hi[1]))
        yarn = YarnCount(
            warp_ne=(round(w[0], 1), round(w[1], 1)),
            weft_ne=(round(f[0], 1), round(f[1], 1)),
            warp_standard_ne=standard_ne(*w),
            weft_standard_ne=standard_ne(*f),
            basis="crimp 6-14% warp, 4-10% weft; weft assumed the same count as the warp",
        )
        order += [
            f"Warp yarn: Ne {yarn.warp_standard_ne}s (range {w[0]:.1f}-{w[1]:.1f}), {fibre}",
            f"Weft yarn: Ne {yarn.weft_standard_ne}s (range {f[0]:.1f}-{f[1]:.1f}), {fibre}",
        ]
        flags.append(_flag("WEFT_ASSUMED", "Warp and weft are assumed to be the same count; "
                           "unravel and weigh one pick to confirm the weft."))  # fmt: skip
    weight = f", {gsm:.0f} g/m2 ({gsm / OZ_PER_SQYD_IN_GSM:.1f} oz/yd2)" if gsm else ""
    order.append(construction_line + weight)

    return SpecResult(
        spec_id=str(uuid.uuid4()),
        construction=construction,
        dpi=dpi,
        scale_source=source,
        density=SpecDensity(
            ends_per_inch=round(ends, 1),
            picks_per_inch=round(picks, 1),
            spread_pct=round(100 * spread, 1),
            tiles=d.tiles,
            skew_deg=round(d.skew_deg, 1),
        ),
        weight_gsm=round(gsm, 1) if gsm else None,
        yarn=yarn,
        stated_composition=stated,
        yarn_order=order,
        flags=flags,
    )
