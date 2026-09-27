"""TexPilot scanner API.

    make api           # stub: every scan abstains; the app can build against it anywhere
    make api-scanner   # the real models, on the M3 (TEXPILOT_VISION=scanner)

Configuration is by environment (services/api/config.py). With the scanner, models load
at startup; if any fails, the server does not start.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from services.api.config import Settings, build_ocr, build_predictor
from services.api.pipeline import run_scan
from services.api.schemas import ScanResult
from services.api.uploads import check_upload
from services.vision.errors import UnsupportedImage
from services.vision.predictor import Predictor, StubPredictor

_state: dict = {"predictor": StubPredictor(), "ocr": None, "model_version": "stub-0"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = Settings.from_env()
    predictor, version = build_predictor(settings)
    _state.update(predictor=predictor, ocr=build_ocr(settings), model_version=version)
    yield


app = FastAPI(title="TexPilot Scanner", version="0.2.0", lifespan=lifespan)


def get_predictor() -> Predictor:
    return _state["predictor"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/scan", response_model=ScanResult)
async def scan(
    surface_image: UploadFile = File(...),
    label_image: UploadFile | None = File(default=None),
    label_text: str | None = Form(default=None),
) -> ScanResult:
    """Scan a garment (or a fabric close-up), cross-checked against its care label.

    ``label_image`` is read by server-side OCR; ``label_text``, if given, overrides it.
    Undecodable images (e.g. HEIC) are a 422.
    """
    data = await surface_image.read()
    label = await label_image.read() if label_image is not None else None
    try:
        check_upload(data, "surface_image")
        if label is not None:
            check_upload(label, "label_image")
        return run_scan(
            get_predictor(),
            data,
            label_text,
            label_image=label,
            ocr=_state["ocr"],
            model_version=_state["model_version"],
        )
    except UnsupportedImage as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
