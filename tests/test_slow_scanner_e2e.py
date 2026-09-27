"""The whole scanner on the Mac: real models, real bundle. `pytest -m slow`."""

import time
from pathlib import Path

import pytest

pytestmark = pytest.mark.slow
BUNDLE = Path("models/scanner-v1")
SAMPLE = next(iter(sorted(Path("data/fabric/test/denim").glob("*.jp*g"))), None)


def test_scan_returns_a_verdict_within_budget():
    if SAMPLE is None or not (BUNDLE / "bundle.json").exists():
        pytest.skip("needs TextileNet and models/scanner-v1 (Task 6)")
    from services.api.pipeline import run_scan
    from services.vision.runtime import pick_device
    from services.vision.scanner import build_scanner

    predictor = build_scanner(BUNDLE, "gdino", pick_device())
    data = SAMPLE.read_bytes()
    run_scan(predictor, data, "100% COTTON")  # warm-up
    t0 = time.perf_counter()
    result = run_scan(predictor, data, "100% COTTON")
    elapsed = time.perf_counter() - t0
    assert result.verdict.value in ("PASS", "FLAG", "INSUFFICIENT_EVIDENCE")
    assert result.garment is not None or any(f.code == "NO_GARMENT_DETECTED" for f in result.flags)
    assert elapsed <= 3.0, f"scan took {elapsed:.2f}s (target p50 <= 3 s)"
