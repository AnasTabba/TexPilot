"""Private, scale-to-zero CPU deployment of the existing TexPilot scanner.

Read deployment/README.md and set the account's spend limit to $0 before deploying.
Run from the repository root: modal deploy deployment/modal_scanner.py
Only serving source and the selected model bundles are uploaded, never the ledger.
"""

from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
app = modal.App("texpilot-scanner")
scan_store = modal.Volume.from_name("texpilot-scanner-scans", create_if_missing=True)


def warm_models():
    """Cache public weights and Paddle assets in the image, before serving traffic."""
    from services.api.config import Settings, build_ocr, build_predictor

    settings = Settings.from_env()
    predictor, version = build_predictor(settings)
    ocr = build_ocr(settings)
    assert predictor.heads.version == 8 and "stub" not in version
    if hasattr(ocr, "close"):
        ocr.close()


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0", "libgomp1")
    .pip_install(
        "torch==2.14.0", "torchvision==0.29.0", index_url="https://download.pytorch.org/whl/cpu"
    )
    .pip_install_from_requirements(str(ROOT / "deployment/requirements-serving.txt"))
    .workdir("/app")
    .run_commands(
        "python -m venv /app/.venv-paddle",
        "/app/.venv-paddle/bin/pip install paddlepaddle==3.3.1 paddleocr==3.7.0",
    )
    .env(
        {
            "PYTHONPATH": "/app",
            "TEXPILOT_VISION": "scanner",
            "TEXPILOT_MODEL_BUNDLE": "/app/models/scanner-v8",
            "TEXPILOT_CUSTOM_HEADS": "/app/models/custom",
            "TEXPILOT_GARMENT_DETECTOR": "owlv2",
            "TEXPILOT_OCR_BACKEND": "paddle",
            "TEXPILOT_DEVICE": "cpu",
            "TEXPILOT_SCAN_STORE": "/app/data/scans",
            "TEXPILOT_CORS_ORIGINS": "",  # Requests arrive through the authenticated Worker.
            "OMP_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
            "HF_HOME": "/opt/hf-cache",
        }
    )
    .add_local_dir(ROOT / "services", "/app/services", copy=True, ignore=["**/__pycache__/**"])
    .add_local_dir(ROOT / "models/scanner-v8", "/app/models/scanner-v8", copy=True)
    .add_local_dir(ROOT / "models/custom", "/app/models/custom", copy=True)
    .run_function(warm_models, cpu=2, memory=12288, timeout=1200, include_source=False)
)


@app.function(
    image=image,
    cpu=2,
    memory=12288,
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
    timeout=180,
    startup_timeout=240,
    volumes={"/app/data/scans": scan_store},
    include_source=False,
)
@modal.concurrent(max_inputs=1)
@modal.asgi_app(requires_proxy_auth=True)
def scanner():
    from services.api.main import app as api

    return api
