"""Browser integration for Yarnflow; no heavy model imports needed."""

from fastapi.testclient import TestClient

from services.api import main
from services.api.config import browser_origins
from services.vision.predictor import StubPredictor

client = TestClient(main.app)
ORIGIN = "https://yarnflow-factory-glass.thryuil.chatgpt.site"


def test_model_info_does_not_report_a_stub_as_ready(monkeypatch):
    monkeypatch.setitem(main._state, "predictor", StubPredictor())
    monkeypatch.setitem(main._state, "model_version", "stub-0")
    assert client.get("/api/v1/model").json() == {
        "ready": False,
        "mode": "stub",
        "model_version": "stub-0",
    }


def test_model_info_exposes_the_loaded_version_without_changing_scan_contract(monkeypatch):
    monkeypatch.setitem(main._state, "predictor", object())
    monkeypatch.setitem(main._state, "model_version", "scanner-v2+det=gdino+ocr=apple")
    assert client.get("/api/v1/model").json() == {
        "ready": True,
        "mode": "scanner",
        "model_version": "scanner-v2+det=gdino+ocr=apple",
    }
    assert client.get("/health").json() == {"status": "ok"}


def test_cors_allows_only_the_configured_workspace():
    headers = {"Origin": ORIGIN, "Access-Control-Request-Method": "POST"}
    response = client.options("/api/v1/scan", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in response.headers
    headers["Origin"] = "https://unrelated.example"
    denied = client.options("/api/v1/scan", headers=headers)
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_cors_origin_configuration_is_explicit():
    assert browser_origins({"TEXPILOT_CORS_ORIGINS": " https://factory.example/ , "}) == (
        "https://factory.example",
    )
    assert browser_origins({"TEXPILOT_CORS_ORIGINS": ""}) == ()
    import pytest

    with pytest.raises(ValueError, match="exact origins"):
        browser_origins({"TEXPILOT_CORS_ORIGINS": "*"})
