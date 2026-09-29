"""Which models the API serves, from the environment. Spec §7.

Stdlib at import time: models load only in build_*(), at startup, and any failure
stops the server with a message. Misconfiguration must be loud.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from services.vision.predictor import Predictor, StubPredictor


@dataclass(frozen=True)
class Settings:
    vision: str = "stub"  # stub | scanner
    bundle: Path = Path("models/scanner-v1")
    detector: str = "gdino"  # gdino | owlv2 | rtdetr | florence2
    ocr: str = "none"  # none | apple | paddle | florence2
    device: str = "auto"
    store: str = "none"  # none | a folder that keeps every scan (parent spec §9)

    @classmethod
    def from_env(cls, env=os.environ) -> Settings:
        vision = env.get("TEXPILOT_VISION", "stub")
        return cls(
            vision=vision,
            bundle=Path(env.get("TEXPILOT_MODEL_BUNDLE", "models/scanner-v1")),
            detector=env.get("TEXPILOT_GARMENT_DETECTOR", "gdino"),
            # OCR defaults on only with the scanner, so stub mode runs on any OS.
            ocr=env.get("TEXPILOT_OCR_BACKEND", "apple" if vision == "scanner" else "none"),
            device=env.get("TEXPILOT_DEVICE", "auto"),
            # Scans are kept with the real scanner; stub scans are not worth the disk.
            store=env.get("TEXPILOT_SCAN_STORE", "data/scans" if vision == "scanner" else "none"),
        )


def build_predictor(s: Settings) -> tuple[Predictor, str]:
    if s.vision == "stub":
        return StubPredictor(), "stub-0"
    if s.vision != "scanner":
        raise ValueError(f"TEXPILOT_VISION must be 'stub' or 'scanner', not {s.vision!r}")
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    predictor = build_scanner(s.bundle, s.detector, pick_device(s.device))
    return predictor, f"scanner-v{predictor.heads.version}+det={s.detector}+ocr={s.ocr}"


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
