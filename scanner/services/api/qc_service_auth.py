"""Worker-to-scanner assertions. No browser identity or policy decisions live here."""

from __future__ import annotations

import base64
import binascii
import hmac
import os
import re
import time
from datetime import datetime, timezone

from pydantic import ValidationError

from services.api.qc_schemas import (
    MAX_FUTURE_SKEW_S,
    AnalyzeRequest,
    AssertionClaims,
    sha256_hex,
)


class QCServiceError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()


def check_deadline(deadline: str, now: float | None = None) -> None:
    if (time.time() if now is None else now) >= timestamp(deadline):
        raise QCServiceError("DEADLINE_EXCEEDED")


def _decode(segment: str) -> bytes:
    if not segment or not re.fullmatch(r"[A-Za-z0-9_-]+", segment):
        raise ValueError("invalid base64url")
    decoded = base64.b64decode(segment + "=" * (-len(segment) % 4), altchars=b"-_", validate=True)
    if base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii") != segment:
        raise ValueError("noncanonical base64url")
    return decoded


def verify_assertion(
    header: str | None,
    payload: bytes | None = None,
    body: AnalyzeRequest | None = None,
    *,
    now: float | None = None,
) -> AssertionClaims:
    """Verify signature before trusting claims; optionally bind exact request-part bytes.

    The first call authenticates before multipart parsing. A second call binds its raw UTF-8
    bytes and validated context. No nonce/result cache: replay with another payload fails its
    hash, and the Worker owns same-payload idempotency and generation leases.
    """
    key = os.environ.get("TEXPILOT_QC_SERVICE_KEY")
    if not key:
        raise QCServiceError("SERVICE_UNAVAILABLE")
    current = time.time() if now is None else now
    try:
        if not header or len(header) > 8192:
            raise ValueError("missing assertion")
        version, encoded, signature = header.split(".")
        if version != "v1":
            raise ValueError("wrong version")
        signed = ("v1." + encoded).encode("ascii")
        expected = hmac.digest(key.encode("utf-8"), signed, "sha256")
        if not hmac.compare_digest(expected, _decode(signature)):
            raise ValueError("signature mismatch")
        claims = AssertionClaims.model_validate_json(_decode(encoded))
        if not hmac.compare_digest(
            claims.kid.encode(), os.environ.get("TEXPILOT_QC_SERVICE_KID", "qc-local-1").encode()
        ):
            raise ValueError("key id mismatch")
        if current >= claims.exp or claims.iat > current + MAX_FUTURE_SKEW_S:
            raise ValueError("invalid assertion time")
        timestamp(claims.deadline_at)
        if payload is not None and not hmac.compare_digest(
            claims.payload_sha256, sha256_hex(payload)
        ):
            raise ValueError("payload mismatch")
        if body is not None and (
            claims.workspace_id != body.workspace_id
            or claims.request_id != body.context.request_id
            or claims.request_generation != body.context.request_generation
            or claims.deadline_at != body.context.deadline_at
        ):
            raise ValueError("context mismatch")
    except (ValueError, TypeError, UnicodeError, binascii.Error, ValidationError) as exc:
        raise QCServiceError("FORBIDDEN") from exc
    check_deadline(claims.deadline_at, current)
    return claims
