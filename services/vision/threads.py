"""Thread density from a scan of known resolution, and yarn count from density + weight.

Measurement, not learning: a flatbed scan fixes the pixels per inch, so the spacing of the
threads is a physical distance. Convention: the warp runs vertically in the scan, so ends
repeat across x and picks along y.

The image is averaged along each thread direction before its spacing is measured: over a
weave repeat every end shows warp and weft in the same proportion, so the interlacing
pattern (the twill diagonal, the plain weave's alternation) cancels and only the yarn
spacing remains. That needs the swatch square to the axes, so its skew (up to 8 degrees) is
found first as the rotation that gives the sharpest thread spacing. Full-resolution tiles
then vote with their median; their spread says how far to trust the answer.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

#: g/m2 that one thread per inch of a Ne 1 cotton yarn adds: 39.37 in/m x 590.5 tex / 1000.
G_PER_M2 = 39.37 * 590.5 / 1000
#: Below ~2.5 pixels per thread a scan cannot resolve the yarns (it aliases to a false count).
MIN_PERIOD_PX = 2.5
MAX_SKEW_DEG = 8.0
#: Relaxed single jersey: courses per inch ~ 1.3 x wales per inch (Munden's loop shape factor).
KNIT_SHAPE_FACTOR = 1.3


@dataclass(frozen=True)
class Density:
    ends_per_inch: float | None
    picks_per_inch: float | None
    ends_spread: float | None = None  # interquartile range / median across tiles
    picks_spread: float | None = None
    tiles: int = 0
    skew_deg: float = 0.0
    note: str = ""


def _power(profile: np.ndarray) -> np.ndarray:
    """Power spectrum of a detrended, windowed profile, zero-padded 4x (finer steps)."""
    p = (profile - profile.mean()) * np.hanning(len(profile))
    return np.abs(np.fft.rfft(p, 4 * len(p))) ** 2


def _peak_of(power: np.ndarray, fmin: float, fmax: float) -> tuple[float, float]:
    """(frequency in cycles/pixel, power) of the strongest peak of ``power`` in [fmin, fmax]."""
    m = 2 * (len(power) - 1)
    f = np.arange(len(power)) / m
    band = np.flatnonzero((f >= fmin) & (f <= fmax))
    k = int(band[power[band].argmax()])
    a, b, c = np.log(power[k - 1 : k + 2] + 1e-12)
    shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) < 0 else 0.0
    return (k + shift) / m, float(power[k])


def _peak(profile: np.ndarray, fmin: float, fmax: float) -> tuple[float, float]:
    """(frequency in cycles/pixel, power) of the strongest periodicity in [fmin, fmax]."""
    return _peak_of(_power(profile), fmin, fmax)


def _count(profile: np.ndarray, f0: float) -> float | None:
    """Threads per pixel by counting, as a pick glass does: band-pass the profile around the
    spectral estimate ``f0`` (one oscillation per yarn), count its rising zero crossings, and
    divide by the distance they span. Unbiased when the spacing is irregular (slub), where
    the spectrum's peak drifts; None if too few threads to count."""
    n = len(profile)
    f = np.fft.rfftfreq(n)
    gain = np.exp(-0.5 * ((f - f0) / (0.35 * f0)) ** 2)
    x = np.fft.irfft(np.fft.rfft(profile - profile.mean()) * gain, n)
    rising = np.flatnonzero((x[:-1] < 0) & (x[1:] >= 0))
    if len(rising) < 8:
        return None
    pos = rising + x[rising] / (x[rising] - x[rising + 1])  # sub-pixel crossing
    return (len(pos) - 1) / (pos[-1] - pos[0])


def _unrotate(img: np.ndarray, deg: float) -> np.ndarray:
    from scipy import ndimage

    return ndimage.rotate(img, deg, reshape=False, order=1, mode="reflect")


def _skew(img: np.ndarray, fmin: float, fmax: float) -> float:
    """Rotation (degrees) that squares the weave to the axes: the strongest thread spacing.
    Absolute power, not peak/total: at a wrong angle the threads smear out of the averages,
    and a weak sub-harmonic left behind can look relatively sharp (poplin at 600 dpi did)."""
    side = min(img.shape[0], img.shape[1], 1024)
    y0, x0 = (img.shape[0] - side) // 2, (img.shape[1] - side) // 2
    centre = img[y0 : y0 + side, x0 : x0 + side]
    inner = slice(side // 6, side - side // 6)  # drop corners the rotation filled in

    def sharpness(deg):
        r = _unrotate(centre, deg)[inner, inner]
        return _peak(r.mean(0), fmin, fmax)[1] + _peak(r.mean(1), fmin, fmax)[1]

    coarse = max(np.arange(-MAX_SKEW_DEG, MAX_SKEW_DEG + 0.01, 0.5), key=sharpness)
    return float(max(np.arange(coarse - 0.5, coarse + 0.51, 0.1), key=sharpness))


def thread_density(
    gray: np.ndarray, ppi: float, min_tpi: float = 15, max_tpi: float = 200, tile: int = 512
) -> Density:
    """Ends and picks per inch of a woven fabric scanned at ``ppi`` pixels per inch."""
    if ppi < MIN_PERIOD_PX * max_tpi * (1 - 1e-9):  # max_tpi = ppi / 2.5 may round up
        return Density(
            None,
            None,
            note=f"scan resolution too low: {ppi:.0f} ppi resolves at most "
            f"{ppi / MIN_PERIOD_PX:.0f} threads/inch; scan at >= {MIN_PERIOD_PX * max_tpi:.0f} dpi",
        )
    img = gray.astype(float)
    if img.ndim == 3:
        img = img.mean(2)
    fmin, fmax = min_tpi / ppi, max_tpi / ppi
    skew = _skew(img, fmin, fmax)
    img = _unrotate(img, skew)
    h, w = img.shape
    margin = int(np.ceil(np.sin(np.radians(abs(skew))) * max(h, w)))  # rotation fill
    img = img[margin : h - margin, margin : w - margin]
    h, w = img.shape
    size = min(tile, h, w)
    step = max(size // 2, 1)  # half-overlapping tiles: more votes from a small swatch
    tiles = [
        img[y : y + size, x : x + size]
        for y in range(0, h - size + 1, step)
        for x in range(0, w - size + 1, step)
    ]
    # The answer is the peak of the tiles' summed spectra (Welch): the thread spacing adds up
    # across tiles while noise averages out, so weak threads that lose in some tiles still win.
    # Then the threads are counted across the whole scan (_count), which stays unbiased when
    # the spacing is irregular. Each tile's own peak only reports how much the tiles disagree.
    result = []
    for axis in (0, 1):  # column means -> ends (x); row means -> picks (y)
        spectra = [_power(t.mean(axis)) for t in tiles]
        f, _ = _peak_of(np.sum(spectra, axis=0), fmin, fmax)
        counted = _count(img.mean(axis), f)  # across the whole scan, guided by the spectrum
        f = counted if counted and abs(counted / f - 1) < 0.15 else f
        per_tile = np.array([_peak_of(s, fmin, fmax)[0] for s in spectra])
        q1, q3 = np.percentile(per_tile, [25, 75])
        result += [f * ppi, float((q3 - q1) / f)]
    return Density(result[0], result[2], result[1], result[3], len(tiles), skew)


def yarn_count_ne(
    gsm: float,
    ends: float,
    picks: float,
    warp_crimp: float = 0.10,
    weft_crimp: float = 0.06,
    weft_to_warp: float = 1.0,
) -> tuple[float, float]:
    """Cotton count (Ne) of warp and weft for a woven fabric from its weight and density:
    g/m2 = 23.248 x (EPI (1 + warp crimp) / Ne_warp + PPI (1 + weft crimp) / Ne_weft).
    One equation, two unknowns: the weft is taken as ``weft_to_warp`` x the warp count."""
    ne_warp = G_PER_M2 * (ends * (1 + warp_crimp) + picks * (1 + weft_crimp) / weft_to_warp) / gsm
    return ne_warp, ne_warp * weft_to_warp


def knit_density(
    gray: np.ndarray, ppi: float, min_tpi: float = 10, max_tpi: float = 200, tile: int = 512
) -> Density:
    """Wales (in ``ends_per_inch``) and courses (``picks_per_inch``) per inch of a weft knit's
    face. Each wale shows two loop legs, which read as one stripe or two depending on the
    resolution, so the count across is either the wales or twice them; the reading whose
    course/wale ratio is nearer the loop shape factor wins."""
    d = thread_density(gray, ppi, min_tpi, max_tpi, tile)
    if d.ends_per_inch is None:
        return d
    across, courses = d.ends_per_inch, d.picks_per_inch
    wales = min((across, across / 2), key=lambda w: abs(courses / w - KNIT_SHAPE_FACTOR))
    return replace(d, ends_per_inch=wales, note="knit: ends = wales, picks = courses")


def yarn_count_knit_ne(
    gsm: float, wales_per_inch: float, courses_per_inch: float, tightness: float = 1.45
) -> float:
    """Cotton count (Ne) of a weft knit from its weight and stitch density, via the tightness
    factor TF = sqrt(tex) / loop length (mm), ~1.3-1.6 for cotton jersey:
    g/m2 = stitches per cm2 x loop length (mm) x tex / 100, so tex = (100 TF g/m2 / S)^(2/3)."""
    stitches_per_cm2 = (wales_per_inch / 2.54) * (courses_per_inch / 2.54)
    tex = (100 * tightness * gsm / stitches_per_cm2) ** (2 / 3)
    return 590.5 / tex
