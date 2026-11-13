"""Which models the API serves, from the environment. Spec §7.

Stdlib at import time: models load only in build_*(), at startup, and any failure
stops the server with a message. Misconfiguration must be loud.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from services.vision.predictor import Predictor, StubPredictor

log = logging.getLogger(__name__)

DEFAULT_BROWSER_ORIGINS = (
    "https://yarnflow-factory-glass.thryuil.chatgpt.site",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
)


def browser_origins(env=os.environ) -> tuple[str, ...]:
    """Explicit browser clients; never allow arbitrary origins or credentials."""
    configured = env.get("TEXPILOT_CORS_ORIGINS")
    if configured is None:
        return DEFAULT_BROWSER_ORIGINS
    origins = tuple(
        origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()
    )
    if "*" in origins:
        raise ValueError("TEXPILOT_CORS_ORIGINS must list exact origins, not '*'")
    return origins


@dataclass(frozen=True)
class Settings:
    vision: str = "stub"  # stub | scanner
    bundle: Path = Path("models/scanner-v8")
    detector: str = "owlv2"  # owlv2 | gdino | rtdetr | florence2
    ocr: str = "none"  # none | apple | paddle | florence2
    device: str = "auto"
    store: str = "none"  # none | a folder that keeps every scan (parent spec §9)
    fault_model: Path | None = None  # TEXPILOT_FAULT_MODEL: fault model folder; None = not served

    @classmethod
    def from_env(cls, env=os.environ) -> Settings:
        vision = env.get("TEXPILOT_VISION", "stub")
        return cls(
            vision=vision,
            bundle=Path(env.get("TEXPILOT_MODEL_BUNDLE", "models/scanner-v8")),
            detector=env.get("TEXPILOT_GARMENT_DETECTOR", "owlv2"),
            # OCR defaults on only with the scanner, so stub mode runs on any OS.
            ocr=env.get("TEXPILOT_OCR_BACKEND", "apple" if vision == "scanner" else "none"),
            device=env.get("TEXPILOT_DEVICE", "auto"),
            # Scans are kept with the real scanner; stub scans are not worth the disk.
            store=env.get("TEXPILOT_SCAN_STORE", "data/scans" if vision == "scanner" else "none"),
            fault_model=Path(fault) if (fault := env.get("TEXPILOT_FAULT_MODEL")) else None,
        )


def build_predictor(s: Settings) -> tuple[Predictor, str]:
    if s.vision == "stub":
        return StubPredictor(), "stub-0"
    if s.vision != "scanner":
        raise ValueError(f"TEXPILOT_VISION must be 'stub' or 'scanner', not {s.vision!r}")
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    device = pick_device(s.device)
    try:
        predictor = build_scanner(s.bundle, s.detector, device, fault_dir=s.fault_model)
    except Exception as e:  # noqa: BLE001 -- the fault stage is optional; the scanner must start
        if s.fault_model is None:
            raise
        log.warning(
            "fault model not loaded from %s, serving without it: %s: %s",
            s.fault_model,
            type(e).__name__,
            e,
        )
        predictor = build_scanner(s.bundle, s.detector, device)
    taught = "".join(f"+{h.name}={h.digest}" for h in predictor.heads.custom)
    fault = getattr(predictor, "fault", None)
    named_fault = "" if fault is None else f"+fault={fault.version}"
    return predictor, (
        f"scanner-v{predictor.heads.version}+det={s.detector}+ocr={s.ocr}{taught}{named_fault}"
    )


def build_ocr(s: Settings):
    if s.ocr == "none":
        return None
    from services.ocr.engines import load_engine

    return load_engine(s.ocr, s.device)


def build_store(s: Settings):
    if s.store == "none":
        return None
    from services.api.store import ScanStore

    return ScanStore(Path(s.store))
