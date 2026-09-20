from fastapi.testclient import TestClient

from services.api.main import app

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
