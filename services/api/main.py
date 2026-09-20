"""TexPilot scanner API.

Run: make api   ->   http://127.0.0.1:8000/docs

Ships with StubPredictor, so every scan returns INSUFFICIENT_EVIDENCE until a
trained checkpoint is wired in. That is deliberate -- the service is honest, not
broken, and P3 can build the app against a live endpoint today.
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile

from services.api.pipeline import run_scan
from services.api.schemas import ScanResult
from services.vision.predictor import Predictor, StubPredictor

app = FastAPI(title="TexPilot Scanner", version="0.1.0")

_predictor: Predictor = StubPredictor()


def get_predictor() -> Predictor:
    return _predictor


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/scan", response_model=ScanResult)
async def scan(
    surface_image: UploadFile = File(...),
    label_text: str | None = Form(default=None),
) -> ScanResult:
    """Scan a fabric surface, optionally cross-checked against care-label text.

    ``label_text`` is a stop-gap: OCR currently runs on-device in the app and
    posts its text here. When the server-side OCR backend lands it will accept a
    ``label_image`` upload instead.
    """
    data = await surface_image.read()
    return run_scan(get_predictor(), data, label_text)
