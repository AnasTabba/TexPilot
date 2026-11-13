"""Bounded local QC probe; JSON only, no network, persistence or learned test doubles.

Run from scanner/: ../.venv/bin/python scripts/qc_benchmark.py
The checked-in synthetic 4032x3024 image is acquisition input, never a trained artifact.
Four originals exercise the maximum capture count. All absent stages stay unavailable.
This is local engineering timing, not target-hardware proof or external gate G6/G8.
"""

from __future__ import annotations

import base64
import copy
import hmac
import json
import os
import platform
import resource
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def utc(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def main():
    # Ephemeral process-local protocol credential, never printed, saved or a release identity.
    os.environ["TEXPILOT_QC_SERVICE_KEY"] = os.urandom(32).hex()
    key = os.environ["TEXPILOT_QC_SERVICE_KEY"].encode()
    imported_at = time.perf_counter()
    from fastapi.testclient import TestClient

    from services.api.main import app
    from services.api.qc_schemas import content_sha256, sha256_hex

    import_wall = time.perf_counter() - imported_at
    template = next(
        entry["value"]
        for entry in json.loads((ROOT / "tests/fixtures/qc-v2/valid.json").read_text())
        if entry["name"] == "analyze-request"
    )
    source = ROOT / "tests/fixtures/qc-images/phone-4032x3024.jpg"
    data = source.read_bytes()
    digest = sha256_hex(data)
    fourth = copy.deepcopy(template["captures"][-1])
    fourth["capture"].update(id=str(uuid4()), role="defect")
    template["captures"].append(fourth)
    for view in template["captures"]:
        view["axis_registration"] = None
        view["calibration"] = view["reference"] = None
        capture = view["capture"]
        capture.update(
            original_sha256=digest,
            byte_size=len(data),
            width=4032,
            height=3024,
            media_type="image/jpeg",
            calibration_id=None,
        )
        view["verified_sha256"] = digest
        view["attestation"].update(image_sha256=digest, resolution=[4032, 3024], orientation=1)
        attestation_hash = content_sha256(view["attestation"])
        capture["attestation_sha256"] = view["acquisition_attestation_sha256"] = attestation_hash

    def probe(barrier=None):
        body = copy.deepcopy(template)
        now = time.time()
        body["context"].update(
            evaluated_at=utc(now), deadline_at=utc(now + 60), request_id=str(uuid4())
        )
        payload = json.dumps(body).encode()
        claims = dict(
            kid=os.environ.get("TEXPILOT_QC_SERVICE_KID", "qc-local-1"),
            aud="texpilot-scanner-qc",
            iat=int(now),
            exp=int(now) + 30,
            nonce=uuid4().hex,
            request_id=body["context"]["request_id"],
            request_generation=1,
            workspace_id=body["workspace_id"],
            actor_id="local-benchmark-probe",
            payload_sha256=sha256_hex(payload),
            deadline_at=body["context"]["deadline_at"],
        )
        signed = "v1." + b64(json.dumps(claims).encode())
        assertion = signed + "." + b64(hmac.digest(key, signed.encode(), "sha256"))
        files = [("request", (None, payload, "application/json"))] + [
            ("capture_" + v["capture"]["id"], ("original.jpg", data, "image/jpeg"))
            for v in body["captures"]
        ]
        if barrier:
            barrier.wait(timeout=5)
        wall, cpu = time.perf_counter(), time.process_time()
        response = TestClient(app).post(
            "/api/v2/qc/analyze", files=files, headers={"X-QC-Assertion": assertion}
        )
        result = response.json()
        output = dict(
            status=response.status_code,
            wall_s=round(time.perf_counter() - wall, 4),
            cpu_s=round(time.process_time() - cpu, 4),
        )
        if response.status_code == 200:
            output.update(
                decision=result["draft"]["status"],
                stages={
                    name: result["evidence"][name]["state"]
                    for name in ("quality", "fabric", "defects", "metrology", "domain")
                },
            )
        else:
            output["error"] = result["error"]["code"]
        return output

    cold = probe()
    warm = probe()
    barrier = threading.Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(probe, barrier) for _ in range(2)]
        concurrent = [f.result(timeout=65) for f in futures]
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_bytes = rss if sys.platform == "darwin" else rss * 1024
    report = dict(
        scope="local ASGI; synthetic acquisition fixture; no external gate proof",
        hardware=dict(
            system=platform.system(),
            machine=platform.machine(),
            processor=platform.processor(),
            logical_cpus=os.cpu_count(),
        ),
        vision=os.environ.get("TEXPILOT_VISION", "stub"),
        originals=4,
        pixels_per_original=4032 * 3024,
        total_original_bytes=4 * len(data),
        import_wall_s=round(import_wall, 4),
        cold=cold,
        warm=warm,
        concurrent=concurrent,
        peak_rss_bytes=rss_bytes,
        contention_429_observed=any(r["status"] == 429 for r in concurrent),
        external_gates="not yet collected / external gates G3, G6, G8",
    )
    print(json.dumps(report, separators=(",", ":")))
    return (
        0
        if cold["status"] == warm["status"] == 200
        and sorted(r["status"] for r in concurrent) == [200, 429]
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
