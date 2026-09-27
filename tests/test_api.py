import io

import pytest
from fastapi.testclient import TestClient

from services.api import main
from services.api.main import app
from services.ocr.engines.base import TextLine
from services.vision.errors import UnsupportedImage
from services.vision.predictor import GarmentOutput, Note, StubPredictor, VisionOutput

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_scan_abstains_with_the_stub_predictor():
    r = client.post(
        "/api/v1/scan",
        files={"surface_image": ("a.jpg", b"not-a-real-image", "image/jpeg")},
        data={"label_text": "60% COTTON 40% POLYESTER"},
    )
    assert r.status_code == 200
    body = r.json()
    # No model yet -> the service must abstain, never guess.
    assert body["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert body["structure"] is None


def test_scan_still_parses_the_label_without_a_model():
    r = client.post(
        "/api/v1/scan",
        files={"surface_image": ("a.jpg", b"x", "image/jpeg")},
        data={"label_text": "60% COTTON 40% POLYESTER"},
    )
    comp = r.json()["stated_composition"]
    assert comp["source"] == "care_label"
    assert {f["name"] for f in comp["fibers"]} == {"cotton", "polyester"}


@pytest.fixture
def state():
    saved = dict(main._state)
    yield main._state
    main._state.clear()
    main._state.update(saved)


def _png():
    Image = pytest.importorskip("PIL.Image")
    buf = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(buf, format="PNG")
    return buf.getvalue()


class FakeOcr:
    name = "fake"

    def __init__(self, lines=(), error=None):
        self.lines, self.error, self.calls = list(lines), error, 0

    def read(self, image):
        self.calls += 1
        if self.error:
            raise self.error
        return self.lines


class FakePredictor:
    def __init__(self, out=None, error=None):
        self.out, self.error = out, error

    def predict(self, image_bytes):
        if self.error:
            raise self.error
        return self.out


def test_label_photo_is_read_by_ocr(state):
    state["ocr"] = FakeOcr([TextLine("SHELL: 80% PA 20% EA", 0.95, (0, 0, 100, 10))])
    r = client.post(
        "/api/v1/scan",
        files={
            "surface_image": ("g.jpg", b"x", "image/jpeg"),
            "label_image": ("l.png", _png(), "image/png"),
        },
    )
    comp = r.json()["stated_composition"]
    assert r.status_code == 200
    assert comp["source"] == "care_label" and comp["section"] == "shell"
    assert {f["name"] for f in comp["fibers"]} == {"nylon", "elastane_spandex"}
    assert comp["ocr_confidence"] == pytest.approx(0.95)


def test_typed_label_text_overrides_the_photo(state):
    ocr = FakeOcr([TextLine("100% POLYESTER", 0.9, (0, 0, 1, 1))])
    state["ocr"] = ocr
    r = client.post(
        "/api/v1/scan",
        files={
            "surface_image": ("g.jpg", b"x", "image/jpeg"),
            "label_image": ("l.png", _png(), "image/png"),
        },
        data={"label_text": "100% COTTON"},
    )
    assert [f["name"] for f in r.json()["stated_composition"]["fibers"]] == ["cotton"]
    assert ocr.calls == 0


def test_unreadable_label_explains_itself(state):
    state["ocr"] = FakeOcr([TextLine("MADE IN PAKISTAN", 0.9, (0, 0, 1, 1))])
    r = client.post(
        "/api/v1/scan",
        files={
            "surface_image": ("g.jpg", b"x", "image/jpeg"),
            "label_image": ("l.png", _png(), "image/png"),
        },
    )
    body = r.json()
    assert body["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert {"code": "NO_LABEL_TEXT", "severity": "info"}.items() <= body["flags"][0].items()


def test_failing_ocr_is_an_info_flag_not_a_500(state):
    state["ocr"] = FakeOcr(error=RuntimeError("engine died"))
    r = client.post(
        "/api/v1/scan",
        files={
            "surface_image": ("g.jpg", b"x", "image/jpeg"),
            "label_image": ("l.png", _png(), "image/png"),
        },
    )
    assert r.status_code == 200
    assert [f["code"] for f in r.json()["flags"]] == ["COMPONENT_FAILED"]


def test_garment_and_notes_reach_the_response(state):
    state["predictor"] = FakePredictor(
        VisionOutput(
            None,
            None,
            None,
            garment=GarmentOutput("pants", 0.8, (0.1, 0.2, 0.9, 0.95)),
            notes=(Note("COMPONENT_FAILED", "segmenter failed: RuntimeError"),),
        )
    )
    body = client.post(
        "/api/v1/scan", files={"surface_image": ("g.jpg", b"x", "image/jpeg")}
    ).json()
    assert body["garment"] == {"label": "pants", "confidence": 0.8, "box": [0.1, 0.2, 0.9, 0.95]}
    assert body["flags"][0]["severity"] == "info"


def test_undecodable_photo_is_a_422(state):
    # Review Focus 3: an iPhone HEIC upload must be a clear client error.
    state["predictor"] = FakePredictor(error=UnsupportedImage("cannot decode image: heic"))
    r = client.post("/api/v1/scan", files={"surface_image": ("g.heic", b"x", "image/heic")})
    assert r.status_code == 422 and "decode" in r.json()["detail"]


def test_stub_is_still_the_default(state):
    assert isinstance(main._state["predictor"], StubPredictor)
