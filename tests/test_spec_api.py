"""POST /api/v1/spec: yarn spec from a flatbed scan. Synthetic scans with known counts."""

import io

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")
pytest.importorskip("scipy")
pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from services.api.main import app  # noqa: E402
from tests.fabric_sim import knit, render  # noqa: E402

client = TestClient(app)


def _png(img, dpi=None):
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG", **({"dpi": (dpi, dpi)} if dpi else {}))
    return buf.getvalue()


def _spec(scan, **form):
    files = {"scan_image": ("swatch.png", scan, "image/png")}
    return client.post("/api/v1/spec", files=files, data={k: str(v) for k, v in form.items()})


def test_a_denim_scan_gives_density_yarn_counts_and_an_order_line():
    r = _spec(_png(render("3/1 twill", 64, 42, 600, size=1600), dpi=600), oz=11.5,
              label_text="98% cotton, 2% elastane")  # fmt: skip
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["density"]["ends_per_inch"] == pytest.approx(64, rel=0.03)
    assert body["density"]["picks_per_inch"] == pytest.approx(42, rel=0.03)
    lo, hi = body["yarn"]["warp_ne"]
    assert 5 < lo <= hi < 9  # heavy denim: ~Ne 7
    assert body["yarn"]["warp_standard_ne"] in (6, 7, 8)
    order = " ".join(body["yarn_order"])
    assert "Warp" in order and "cotton" in order.lower()
    fibres = [f["name"] for f in body["stated_composition"]["fibers"]]
    assert fibres == ["cotton", "elastane_spandex"]  # the parser's canonical names


def test_dpi_comes_from_the_form_when_the_file_has_none():
    scan = _png(render("plain", 110, 80, 1200, size=1600))
    assert _spec(scan, gsm=120).status_code == 422  # no scale: never guess
    r = _spec(scan, gsm=120, dpi=1200)
    assert r.status_code == 200 and r.json()["dpi"] == 1200


def test_a_knit_scan_reports_wales_and_courses():
    r = _spec(_png(knit(32, 44, 1200, size=1600), dpi=1200), construction="knit", gsm=160)
    assert r.status_code == 200, r.text
    d = r.json()["density"]
    assert d["ends_per_inch"] == pytest.approx(32, rel=0.03)  # wales
    assert d["picks_per_inch"] == pytest.approx(44, rel=0.03)  # courses
    assert r.json()["yarn"]["weft_ne"] is None  # a weft knit has one yarn


def test_without_a_weight_there_is_density_but_no_yarn_count_and_it_says_why():
    r = _spec(_png(render("3/1 twill", 64, 42, 600, size=1600), dpi=600))
    assert r.status_code == 200 and r.json()["yarn"] is None
    assert "NO_WEIGHT" in [f["code"] for f in r.json()["flags"]]


@pytest.mark.parametrize(
    "form",
    [{"construction": "felt"}, {"gsm": -5}, {"gsm": 50000}, {"dpi": 72}],
    ids=["construction", "negative-weight", "absurd-weight", "phone-dpi"],
)
def test_bad_inputs_are_a_422_not_a_guess(form):
    scan = _png(render("3/1 twill", 64, 42, 600, size=1600), dpi=600)
    assert _spec(scan, **form).status_code == 422


def test_a_tiff_scan_is_accepted_flatbed_scanners_default_to_it():
    buf = io.BytesIO()
    Image.fromarray(render("3/1 twill", 64, 42, 600, size=1600)).save(buf, "TIFF", dpi=(600, 600))
    r = client.post("/api/v1/spec", files={"scan_image": ("s.tif", buf.getvalue(), "image/tiff")})
    assert r.status_code == 200, r.text
    assert r.json()["density"]["ends_per_inch"] == pytest.approx(64, rel=0.03)


def _jpeg(img):
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="JPEG", quality=90, dpi=(72, 72))  # as phones do
    return buf.getvalue()


def test_a_phone_photo_with_the_card_is_measured_without_a_scanner():
    from tests.test_marker import phone_photo

    r = _spec(_jpeg(phone_photo(64, 42, 600, tilt=12, turn=25)), oz=11.5)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scale_source"] == "card"
    assert body["density"]["ends_per_inch"] == pytest.approx(64, rel=0.03)
    assert body["density"]["picks_per_inch"] == pytest.approx(42, rel=0.03)
    assert "CARD_SCALE" in [f["code"] for f in body["flags"]]


def test_a_phone_photo_without_the_card_says_how_to_get_a_scale():
    r = _spec(_jpeg(render("3/1 twill", 64, 42, 600, size=1600)), oz=11.5)
    assert r.status_code == 422 and "card" in r.text


def test_a_flatbed_scan_says_where_its_scale_came_from():
    r = _spec(_png(render("3/1 twill", 64, 42, 600, size=1600), dpi=600))
    assert r.json()["scale_source"] == "file"


def test_an_absurd_card_size_is_refused():
    scan = _png(render("3/1 twill", 64, 42, 600, size=1600), dpi=600)
    assert _spec(scan, card_mm=300).status_code == 422
