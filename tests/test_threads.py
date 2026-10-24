"""Thread density from a scan of known resolution, and yarn count from density + weight."""

import math

import pytest

np = pytest.importorskip("numpy")

from services.vision.threads import (  # noqa: E402
    knit_density,
    thread_density,
    yarn_count_knit_ne,
    yarn_count_ne,
)
from tests.fabric_sim import degrade, knit, render  # noqa: E402

PPI = 600  # a 600 dpi flatbed scan


def _weave(ends, picks, size=1200, angle_deg=0.0, noise=0.0, seed=0):
    """Grey image of crossing threads: ends repeat across x, picks along y, optionally rotated."""
    y, x = np.mgrid[0:size, 0:size].astype(float)
    a = math.radians(angle_deg)
    xr, yr = x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)
    img = (
        0.5
        + 0.25 * np.cos(2 * np.pi * xr * ends / PPI)
        + 0.2 * np.cos(2 * np.pi * yr * picks / PPI)
    )
    img += np.random.default_rng(seed).normal(0, noise, img.shape)
    return np.clip(img * 255, 0, 255).astype(np.uint8)


@pytest.mark.parametrize(
    "angle,noise", [(0, 0.0), (5, 0.0), (0, 0.3)], ids=["square", "5deg-skew", "noisy"]
)
def test_density_recovers_ends_and_picks_per_inch(angle, noise):
    d = thread_density(_weave(64, 42, angle_deg=angle, noise=noise), PPI)
    assert d.ends_per_inch == pytest.approx(64, rel=0.03)  # denim-like 64 x 42
    assert d.picks_per_inch == pytest.approx(42, rel=0.03)
    assert d.tiles >= 4 and d.ends_spread < 0.05  # a uniform weave measures the same everywhere


def _woven(ends, picks, ppi, weave, size=1600, angle_deg=0.0, seed=0):
    """Rendered weave: warp (dark) or weft (light) on top at each crossing, yarns shaded."""
    y, x = np.mgrid[0:size, 0:size].astype(float)
    a = math.radians(angle_deg)
    x, y = x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)
    i, j = np.floor(x * ends / ppi).astype(int), np.floor(y * picks / ppi).astype(int)
    up = (i - j) % 4 != 3 if weave == "3/1 twill" else (i + j) % 2 == 0
    shade_x = 0.6 + 0.4 * np.cos(np.pi * ((x * ends / ppi) % 1 - 0.5)) ** 2
    shade_y = 0.6 + 0.4 * np.cos(np.pi * ((y * picks / ppi) % 1 - 0.5)) ** 2
    img = np.where(up, 60 * shade_x, 220 * shade_y)
    img += np.random.default_rng(seed).normal(0, 12, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


@pytest.mark.parametrize(
    "weave,ends,picks,angle",
    [
        ("3/1 twill", 64, 42, 0),
        ("3/1 twill", 64, 42, 4),
        ("plain", 110, 80, 0),
        ("plain", 140, 90, 0),
    ],
    ids=["denim", "denim-skewed", "shirting", "fine-shirting"],
)
def test_density_counts_threads_not_the_weave_pattern(weave, ends, picks, angle):
    d = thread_density(_woven(ends, picks, 1200, weave, angle_deg=angle), 1200)
    assert d.ends_per_inch == pytest.approx(ends, rel=0.03)
    assert d.picks_per_inch == pytest.approx(picks, rel=0.03)


@pytest.mark.parametrize(
    "make,ends,picks,ppi",
    [
        (lambda: render("2/1 twill", 70, 50, 1200, size=1600), 70, 50, 1200),
        (lambda: render("2/2 twill", 80, 60, 1200, size=1600), 80, 60, 1200),
        (lambda: render("5-satin", 120, 90, 1200, size=1600), 120, 90, 1200),
        (lambda: render("basket 2x2", 50, 50, 600, size=1600), 50, 50, 600),
        (lambda: render("plain", 144, 76, 1200, size=1600), 144, 76, 1200),
        (lambda: render("plain", 110, 80, 600, size=1600), 110, 80, 600),
        (lambda: render("3/1 twill", 64, 42, 1200, size=1600, angle=7), 64, 42, 1200),
        (lambda: degrade(render("3/1 twill", 64, 42, 1200, size=1600), blur=1.5), 64, 42, 1200),
        (lambda: degrade(render("3/1 twill", 64, 42, 1200, size=1600), jpeg=50), 64, 42, 1200),
        (lambda: degrade(render("3/1 twill", 64, 42, 1200, size=1600), light=0.4), 64, 42, 1200),
        (lambda: render("3/1 twill", 64, 42, 1200, size=1600, jitter=1, thick=0.25), 64, 42, 1200),
        (lambda: render("3/1 twill", 64, 42, 1200, size=1600, warp_tone=90, weft_tone=120),
         64, 42, 1200),
    ],
    ids=["2/1-twill", "2/2-twill", "satin", "basket", "fine-poplin", "poplin-600dpi", "skew-7deg",
         "blur", "jpeg-q50", "uneven-light", "slub", "low-contrast"],
)  # fmt: skip
def test_density_holds_on_harder_weaves_and_real_scan_defects(make, ends, picks, ppi):
    d = thread_density(make(), ppi)
    assert d.ends_per_inch == pytest.approx(ends, rel=0.03)
    assert d.picks_per_inch == pytest.approx(picks, rel=0.03)


def test_irregular_yarns_show_up_as_tile_disagreement():
    even = thread_density(render("3/1 twill", 64, 42, 1200, size=1600), 1200)
    slub = thread_density(
        render("3/1 twill", 64, 42, 1200, size=1600, jitter=1.0, thick=0.25), 1200
    )
    assert even.ends_spread < 0.01 < slub.ends_spread  # the spread is the honesty signal


def test_density_reports_a_too_coarse_scan_instead_of_guessing():
    d = thread_density(_weave(140, 90), 150)  # 150 dpi cannot resolve 140 threads/inch
    assert d.ends_per_inch is None and "resolution" in d.note


def test_yarn_count_round_trips_through_the_fabric_weight_formula():
    ne_warp, ne_weft, ends, picks, cw, cf = 10.0, 12.0, 64, 42, 0.10, 0.06
    gsm = 23.248 * (ends * (1 + cw) / ne_warp + picks * (1 + cf) / ne_weft)
    w, f = yarn_count_ne(gsm, ends, picks, warp_crimp=cw, weft_crimp=cf, weft_to_warp=1.2)
    assert w == pytest.approx(10.0, rel=1e-3) and f == pytest.approx(12.0, rel=1e-3)


@pytest.mark.parametrize("wales,courses", [(40, 55), (28, 38)])
def test_knit_density_counts_wales_not_loop_legs(wales, courses):
    d = knit_density(knit(wales, courses, 1200, size=1600), 1200)
    assert d.ends_per_inch == pytest.approx(wales, rel=0.03)  # each wale shows two legs
    assert d.picks_per_inch == pytest.approx(courses, rel=0.03)


def test_knit_yarn_count_round_trips_through_the_tightness_relation():
    ne, wpi, cpi, tf = 30.0, 32, 44, 1.45
    tex = 590.5 / ne
    stitches_per_cm2 = (wpi / 2.54) * (cpi / 2.54)
    gsm = stitches_per_cm2 * (tex**0.5 / tf) * tex / 100  # loop length (mm) = sqrt(tex) / TF
    assert yarn_count_knit_ne(gsm, wpi, cpi, tightness=tf) == pytest.approx(30.0, rel=1e-3)


def test_the_finest_count_a_resolution_allows_is_not_refused_by_rounding():
    ppi = 480.02770222981763  # from a card photo: ppi / 2.5 * 2.5 > ppi in floating point
    d = thread_density(render("plain", 110, 70, ppi, size=1200), ppi, max_tpi=ppi / 2.5)
    assert d.ends_per_inch is not None
