"""Private QC wire, assertions, streamed bounds, and v2-only error containment."""

import base64
import copy
import hmac
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from services.api import main, qc
from services.api.qc_schemas import AnalysisCandidate, ErrorEnvelope, Readiness, sha256_hex
from tests.test_qc_pipeline import IMAGES, request_double

KEY_DOUBLE = "service-key-test-double"
client = TestClient(main.app)


def utc(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def body_double(filename="swatch.png", data=None):
    req, data = request_double(data, filename)
    body = req.model_dump(mode="json")
    body["context"].update(evaluated_at=utc(time.time()), deadline_at=utc(time.time() + 60))
    return body, data


def encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def assertion_double(payload=b"", body=None, **overrides):
    now = int(time.time())
    claims = dict(
        kid="qc-local-1",
        aud="texpilot-scanner-qc",
        iat=now,
        exp=now + 30,
        nonce=uuid.uuid4().hex,
        request_id="00000000-0000-4000-8000-000000000110",
        request_generation=1,
        workspace_id="00000000-0000-4000-8000-000000000001",
        actor_id="actor-double",
        payload_sha256=sha256_hex(payload),
        deadline_at=utc(now + 60),
    )
    if body:
        claims.update(
            {k: body["context"][k] for k in ("request_id", "request_generation", "deadline_at")}
        )
        claims["workspace_id"] = body["workspace_id"]
    claims.update(overrides)
    prefix = "v1." + encode(json.dumps(claims).encode())
    return prefix + "." + encode(hmac.digest(KEY_DOUBLE.encode(), prefix.encode(), "sha256"))


def post_double(body=None, data=None, header=None, parts=None, **claims):
    if body is None:
        body, data = body_double()
    payload = json.dumps(body).encode()
    files = [("request", (None, payload, "application/json"))]
    files += (
        parts
        if parts is not None
        else [
            ("capture_" + view["capture"]["id"], ("original", data, view["capture"]["media_type"]))
            for view in body["captures"]
        ]
    )
    return client.post(
        "/api/v2/qc/analyze",
        files=files,
        headers={"X-QC-Assertion": header or assertion_double(payload, body, **claims)},
    )


def error(response, status, code):
    assert response.status_code == status, response.text
    envelope = ErrorEnvelope.model_validate(response.json())
    assert envelope.error.code == code and envelope.error.request_id
    assert envelope.error.request_id != "00000000-0000-4000-8000-000000000110"
    assert "private" not in response.text and "traceback" not in response.text.lower()
    assert response.headers["cache-control"] == "no-store"
    return envelope


@pytest.fixture(autouse=True)
def isolated_service(monkeypatch):
    monkeypatch.setenv("TEXPILOT_QC_SERVICE_KEY", KEY_DOUBLE)
    monkeypatch.delenv("TEXPILOT_QC_SERVICE_KID", raising=False)
    monkeypatch.setenv("TEXPILOT_VISION", "stub")
    monkeypatch.setattr(qc, "get_qc_predictor", lambda: main.StubPredictor())


def test_analysis_calls_policy_returns_bound_candidate_and_never_scanstore(monkeypatch):
    class ScanStoreDouble:
        def save(self, *_):
            raise AssertionError("v2 wrote legacy ScanStore")

    monkeypatch.setitem(main._state, "store", ScanStoreDouble())
    response = post_double()
    assert response.status_code == 200, response.text
    result = AnalysisCandidate.model_validate(response.json())
    assert result.draft.status == "MANUAL_REVIEW" and not result.draft.automatic


def test_readiness_requires_assertion_and_empty_payload_hash():
    error(client.get("/api/v2/qc/readiness"), 403, "FORBIDDEN")
    response = client.get("/api/v2/qc/readiness", headers={"X-QC-Assertion": assertion_double()})
    assert response.status_code == 200 and not Readiness.model_validate(response.json()).ready
    error(
        client.get(
            "/api/v2/qc/readiness", headers={"X-QC-Assertion": assertion_double(b"other payload")}
        ),
        403,
        "FORBIDDEN",
    )


@pytest.mark.parametrize(
    "header",
    [
        "",
        "garbled",
        "v2.e30.a",
        "v1.@@@.abc",
        "v1.e30.@@@@",
        "v1.e30.YQ",
        "v1..",
        "v1.e30.YQ.extra",
    ],
)
def test_missing_garbled_and_wrong_signature_assertions_are_forbidden(header):
    error(client.get("/api/v2/qc/readiness", headers={"X-QC-Assertion": header}), 403, "FORBIDDEN")


@pytest.mark.parametrize(
    "overrides",
    [
        {"kid": "wrong"},
        {"aud": "other-service"},
        {"payload_sha256": "f" * 64},
        {"workspace_id": "00000000-0000-4000-8000-000000000999"},
        {"request_id": "00000000-0000-4000-8000-000000000999"},
        {"request_generation": 2},
        {"deadline_at": "2099-01-01T00:00:00Z"},
        {"nonce": "bad"},
    ],
)
def test_assertion_claims_must_match_body_and_contract(overrides):
    error(post_double(**overrides), 403, "FORBIDDEN")


@pytest.mark.parametrize("offset,ttl", [(-30, 30), (-31, 30), (121, 30), (0, 31), (0, 0)])
def test_expiry_future_skew_and_ttl(offset, ttl):
    now = int(time.time())
    error(post_double(iat=now + offset, exp=now + offset + ttl), 403, "FORBIDDEN")


def test_signature_is_verified_and_body_tampering_or_payload_replay_fails():
    body, data = body_double()
    payload = json.dumps(body).encode()
    header = assertion_double(payload, body)
    prefix, signature = header.rsplit(".", 1)
    bad = prefix + "." + encode(bytes(32))
    error(post_double(body, data, header=bad), 403, "FORBIDDEN")
    changed = copy.deepcopy(body)
    changed["expected_revision"] += 1
    error(post_double(changed, data, header=header), 403, "FORBIDDEN")
    body["context"]["request_id"] = str(uuid.uuid4())
    error(post_double(body, data, header=header), 403, "FORBIDDEN")


def test_no_key_is_503_even_before_parsing(monkeypatch):
    monkeypatch.delenv("TEXPILOT_QC_SERVICE_KEY")
    error(client.post("/api/v2/qc/analyze", content=b"malformed"), 503, "SERVICE_UNAVAILABLE")


def test_expired_deadline_is_504():
    body, data = body_double()
    body["context"]["deadline_at"] = utc(time.time() - 1)
    error(post_double(body, data), 504, "DEADLINE_EXCEEDED")


@pytest.mark.parametrize("kind", ["hash", "missing", "extra", "duplicate"])
def test_capture_hash_and_exact_file_membership_checked_before_model(kind, monkeypatch):
    monkeypatch.setattr(qc, "get_qc_predictor", lambda: pytest.fail("model was invoked"))
    body, data = body_double()
    parts = [
        ("capture_" + v["capture"]["id"], ("original", data, "image/png")) for v in body["captures"]
    ]
    if kind == "hash":
        parts[0] = (parts[0][0], ("original", data + b"x", "image/png"))
    if kind == "missing":
        parts.pop()
    if kind == "extra":
        parts.append(("capture_unknown", ("original", data, "image/png")))
    if kind == "duplicate":
        parts.append(parts[0])
    error(post_double(body, data, parts=parts), 422, "VALIDATION_FAILED")


@pytest.mark.parametrize(
    "filename,status,code",
    [
        ("truncated-14.jpg", 422, "VALIDATION_FAILED"),
        ("over-pixel-limit.png", 413, "PAYLOAD_TOO_LARGE"),
        ("fake.heic", 415, "UNSUPPORTED_MEDIA"),
        ("animated.webp", 415, "UNSUPPORTED_MEDIA"),
    ],
)
def test_decoded_limits_and_media_before_model(filename, status, code, monkeypatch):
    monkeypatch.setattr(qc, "get_qc_predictor", lambda: pytest.fail("model was invoked"))
    body, data = body_double(data=(IMAGES / filename).read_bytes())
    error(post_double(body, data), status, code)


@pytest.mark.parametrize(
    "filename", ["swatch.jpg", "swatch.png", "swatch.webp", "swatch-exif6.jpg"]
)
def test_real_media_and_exif_are_decoded(filename):
    body, data = body_double(filename)
    response = post_double(body, data)
    assert response.status_code == 200, response.text


def test_streamed_byte_limits_do_not_trust_content_length(monkeypatch):
    monkeypatch.setattr(qc, "MAX_ORIGINAL_BYTES", 128)
    body, data = body_double()
    error(post_double(body, data), 413, "PAYLOAD_TOO_LARGE")


def test_chunked_multipart_enforces_set_bytes_without_content_length(monkeypatch):
    body, data = body_double()
    payload = json.dumps(body).encode()
    boundary = "qc-stream-boundary"
    chunks = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n'.encode(),
        payload,
        b"\r\n",
    ]
    for view in body["captures"]:
        name = "capture_" + view["capture"]["id"]
        chunks += [
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
            'filename="original"\r\nContent-Type: image/png\r\n\r\n'.encode(),
            data,
            b"\r\n",
        ]
    chunks.append(f"--{boundary}--\r\n".encode())
    monkeypatch.setattr(qc, "MAX_SET_BYTES", len(data) + 100)
    response = client.post(
        "/api/v2/qc/analyze",
        content=iter(chunks),
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-QC-Assertion": assertion_double(payload, body),
        },
    )
    assert "content-length" not in response.request.headers
    error(response, 413, "PAYLOAD_TOO_LARGE")


@pytest.mark.parametrize(
    "method,path,status,code",
    [
        ("get", "/api/v2/qc/analyze", 405, "METHOD_NOT_ALLOWED"),
        ("post", "/api/v2/qc/readiness", 405, "METHOD_NOT_ALLOWED"),
        ("get", "/api/v2/qc/missing", 404, "NOT_FOUND"),
    ],
)
def test_all_v2_errors_have_fresh_safe_envelopes(method, path, status, code):
    first = error(getattr(client, method)(path), status, code)
    second = error(getattr(client, method)(path), status, code)
    assert first.error.request_id != second.error.request_id


def test_malformed_multipart_and_validation_do_not_echo_input():
    error(
        client.post(
            "/api/v2/qc/analyze",
            content=b"private bad multipart",
            headers={"X-QC-Assertion": assertion_double(), "Content-Type": "multipart/form-data"},
        ),
        400,
        "MALFORMED_REQUEST",
    )
    body, data = body_double()
    body["private-secret"] = "private value"
    error(post_double(body, data), 422, "VALIDATION_FAILED")


def test_v2_unhandled_error_is_sanitized(monkeypatch):
    def broken():
        raise RuntimeError("private traceback credential")

    monkeypatch.setattr(qc, "get_qc_predictor", broken)
    error(post_double(), 500, "INTERNAL_ERROR")


def test_global_inflight_one_deadline_and_no_late_success(monkeypatch):
    entered, unblock = threading.Event(), threading.Event()
    real = qc.run_qc_analysis

    def held_double(*args):
        entered.set()
        assert unblock.wait(5)
        return real(*args)

    monkeypatch.setattr(qc, "run_qc_analysis", held_double)
    body, data = body_double()
    body["context"]["deadline_at"] = utc(time.time() + 0.4)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(post_double, body, data)
        try:
            assert entered.wait(3)
            error(post_double(), 429, "CAPACITY_LIMIT")
            error(first.result(timeout=2), 504, "DEADLINE_EXCEEDED")
            error(post_double(), 429, "CAPACITY_LIMIT")  # timed-out thread still occupies capacity
        finally:
            unblock.set()
    # Wait for the worker to release capacity; never reuse its discarded response.
    end = time.monotonic() + 3
    while qc.analysis_busy() and time.monotonic() < end:
        time.sleep(0.01)
    assert post_double().status_code == 200


def test_deadline_rechecked_after_evidence_assembly(monkeypatch):
    real = qc.run_qc_analysis
    clock_double = [time.time()]
    monkeypatch.setattr(qc, "wall_time", lambda: clock_double[0])

    def late_double(*args):
        result = real(*args)
        clock_double[0] += 61
        return result

    monkeypatch.setattr(qc, "run_qc_analysis", late_double)
    error(post_double(), 504, "DEADLINE_EXCEEDED")


def test_v1_error_shapes_and_routes_are_unchanged():
    assert client.get("/api/v1/scan").json() == {"detail": "Method Not Allowed"}
    assert client.post("/api/v1/spec").status_code == 422
    assert "detail" in client.post("/api/v1/spec").json()
    assert "detail" in client.post("/api/v1/scan").json()


def test_outer_cors_failure_is_also_a_v2_envelope():
    error(
        client.options(
            "/api/v2/qc/analyze",
            headers={
                "Origin": "https://invalid.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-QC-Assertion",
            },
        ),
        400,
        "MALFORMED_REQUEST",
    )


def test_request_as_blob_preserves_exact_utf8_bytes():
    body, data = body_double()
    body["captures"][0]["original_storage_reference"] = "qc/سوت"
    payload = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8")
    parts = [("request", ("blob", payload, "application/json"))] + [
        ("capture_" + v["capture"]["id"], ("original", data, "image/png")) for v in body["captures"]
    ]
    response = client.post(
        "/api/v2/qc/analyze",
        files=parts,
        headers={
            "X-QC-Assertion": assertion_double(payload, body),
        },
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("size", [5, 6])
def test_extra_file_parts_are_422_even_above_the_parser_file_limit(size):
    body, data = body_double()
    parts = [("capture_" + str(n), ("original", data, "image/png")) for n in range(size)]
    error(post_double(body, data, parts=parts), 422, "VALIDATION_FAILED")
