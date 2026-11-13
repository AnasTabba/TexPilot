"""Private, stateless QC v2 service. Mounted separately so v1 errors stay unchanged."""

from __future__ import annotations

import asyncio
import io
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from uuid import uuid4

from fastapi import FastAPI, Request
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.responses import JSONResponse

from services.api.config import Settings, build_qc_predictor
from services.api.qc_pipeline import CaptureBatch, qc_readiness, run_qc_analysis
from services.api.qc_schemas import (
    ERROR_STATUS,
    MAX_DECODED_PIXELS,
    MAX_ORIGINAL_BYTES,
    MAX_ORIGINALS_PER_SET,
    MAX_SET_BYTES,
    AnalyzeRequest,
    ErrorBody,
    ErrorEnvelope,
    sha256_hex,
)
from services.api.qc_service_auth import (
    QCServiceError,
    check_deadline,
    timestamp,
    verify_assertion,
)
from services.vision.qc_imageio import QCImageError, decode_original

MAX_REQUEST_BYTES = 256 * 1024
MAX_MULTIPART_BYTES = MAX_SET_BYTES + MAX_REQUEST_BYTES + 64 * 1024
_inflight = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qc-analysis")
wall_time = time.time


def analysis_busy() -> bool:
    return _inflight.locked()


@lru_cache(maxsize=1)
def _load_predictor(settings: Settings):
    try:
        return build_qc_predictor(settings)
    except Exception:  # noqa: BLE001 -- no artifact is usable if its local loader fails
        return None


def get_qc_predictor():
    return _load_predictor(Settings.from_env())


def _error(code: str) -> JSONResponse:
    status, retryable = ERROR_STATUS[code]
    envelope = ErrorEnvelope(
        schema_version="2",
        error=ErrorBody(
            code=code,
            reasons=[],
            retryable=retryable,
            request_id=str(uuid4()),
        ),
    )
    return JSONResponse(
        envelope.model_dump(mode="json"), status_code=status, headers={"Cache-Control": "no-store"}
    )


class QCErrorBoundary:
    """Catch before ServerErrorMiddleware can send tracebacks, only on this sub-app."""

    def __init__(self, app, prefix=None):
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if self.prefix and not (
            scope["path"] == self.prefix or scope["path"].startswith(self.prefix + "/")
        ):
            return await self.app(scope, receive, send)

        replaced = False

        async def no_store(message):
            nonlocal replaced
            if message["type"] == "http.response.start":
                if message["status"] >= 400:
                    replaced = True
                    code = next(
                        (
                            code
                            for code, (status, _) in ERROR_STATUS.items()
                            if status == message["status"]
                        ),
                        "INTERNAL_ERROR",
                    )
                    await _error(code)(scope, receive, send)
                    return
                message["headers"] = [
                    (k, v) for k, v in message["headers"] if k.lower() != b"cache-control"
                ] + [(b"cache-control", b"no-store")]
            if not replaced:
                await send(message)

        try:
            await self.app(scope, receive, no_store)
        except QCServiceError as exc:
            await _error(exc.code)(scope, receive, no_store)
        except QCImageError as exc:
            await _error(exc.code)(scope, receive, no_store)
        except Exception:  # noqa: BLE001 -- v2 errors never disclose inputs or internal messages
            await _error("INTERNAL_ERROR")(scope, receive, no_store)


qc_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
qc_app.add_middleware(QCErrorBoundary)


@qc_app.exception_handler(HTTPException)
async def http_error(_request, exc):
    code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 400: "MALFORMED_REQUEST"}.get(
        exc.status_code, "INTERNAL_ERROR"
    )
    return _error(code)


class _BoundedMultipart(MultiPartParser):
    """Enforce bytes while receiving, probe pixel headers before allocating any raster.

    Retain the request part's exact bytes: Starlette's text decoder has a latin1 fallback
    that must never alter what the assertion hashes. Temporary upload spools are always closed.
    """

    def __init__(self, headers, stream):
        super().__init__(
            headers,
            stream,
            max_files=MAX_ORIGINALS_PER_SET + 1,
            max_fields=1,
            max_part_size=MAX_REQUEST_BYTES,
        )
        self.request_bytes = None
        self.complete = False
        self._capture_total = 0
        self._capture_count = 0
        self._names = set()

    def on_part_begin(self):
        super().on_part_begin()
        self._part_size = 0
        self._prefix = bytearray()
        self._raw_request = bytearray()

    def on_headers_finished(self):
        super().on_headers_finished()
        name = self._current_part.field_name
        if name in self._names:
            raise QCServiceError("VALIDATION_FAILED")
        self._names.add(name)
        if name == "request":
            return
        if not name.startswith("capture_") or self._current_part.file is None:
            raise QCServiceError("VALIDATION_FAILED")
        self._capture_count += 1
        if self._capture_count > MAX_ORIGINALS_PER_SET:
            raise QCServiceError("VALIDATION_FAILED")
        if self._current_part.file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise QCServiceError("UNSUPPORTED_MEDIA")

    def on_part_data(self, data, start, end):
        block = data[start:end]
        self._part_size += len(block)
        if self._current_part.field_name == "request":
            if self._part_size > MAX_REQUEST_BYTES:
                raise QCServiceError("PAYLOAD_TOO_LARGE")
            self._raw_request.extend(block)
        else:
            self._capture_total += len(block)
            if self._part_size > MAX_ORIGINAL_BYTES or self._capture_total > MAX_SET_BYTES:
                raise QCServiceError("PAYLOAD_TOO_LARGE")
            self._prefix.extend(block[: max(0, 65536 - len(self._prefix))])
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(io.BytesIO(self._prefix)) as image:
                        w, h = image.size
                        if w * h > MAX_DECODED_PIXELS or max(w, h) > 20_000:
                            raise QCServiceError("PAYLOAD_TOO_LARGE")
            except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
                raise QCServiceError("PAYLOAD_TOO_LARGE") from exc
            except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
                pass  # incomplete header; full decoder validates it after byte hashing
        super().on_part_data(data, start, end)

    def on_part_end(self):
        if self._current_part.field_name == "request":
            self.request_bytes = bytes(self._raw_request)
        super().on_part_end()

    def on_end(self):
        self.complete = True
        super().on_end()


async def _parse(request, deadline):
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "multipart/form-data":
        raise QCServiceError("UNSUPPORTED_MEDIA")

    async def bounded_stream():
        total = 0
        async for block in request.stream():
            check_deadline(deadline, wall_time())
            total += len(block)
            if total > MAX_MULTIPART_BYTES:
                raise QCServiceError("PAYLOAD_TOO_LARGE")
            # A server may hand us a large ASGI message. Feed bounded chunks to callbacks.
            for offset in range(0, len(block), 65536):
                yield block[offset : offset + 65536]

    parser = _BoundedMultipart(request.headers, bounded_stream())
    try:
        form = await asyncio.wait_for(
            parser.parse(), timeout=max(0.0, timestamp(deadline) - wall_time())
        )
        if not parser.complete:
            raise QCServiceError("MALFORMED_REQUEST")
        if parser.request_bytes is None:
            raise QCServiceError("VALIDATION_FAILED")
        return form, parser.request_bytes
    except MultiPartException as exc:
        raise QCServiceError("MALFORMED_REQUEST") from exc
    except asyncio.TimeoutError as exc:
        raise QCServiceError("DEADLINE_EXCEEDED") from exc
    finally:
        # form owns the same spools on success; closing twice on a failed parse is harmless.
        if not parser.complete or parser.request_bytes is None:
            for spool in parser._files_to_close_on_error:
                spool.close()


@qc_app.get("/readiness")
async def readiness(request: Request):
    claims = verify_assertion(request.headers.get("x-qc-assertion"), b"")
    result = await run_in_threadpool(lambda: qc_readiness(get_qc_predictor()))
    check_deadline(claims.deadline_at, wall_time())
    return result


@qc_app.post("/analyze")
async def analyze(request: Request):
    header = request.headers.get("x-qc-assertion")
    claims = verify_assertion(header)
    if not _inflight.acquire(blocking=False):
        raise QCServiceError("CAPACITY_LIMIT")
    task = None
    try:
        form, payload = await _parse(request, claims.deadline_at)
        try:
            verify_assertion(header, payload)
            try:
                payload.decode("utf-8", errors="strict")
                body = AnalyzeRequest.model_validate_json(payload)
            except (UnicodeError, ValidationError, ValueError) as exc:
                raise QCServiceError("VALIDATION_FAILED") from exc
            verify_assertion(header, payload, body)
            files = {name: value for name, value in form.multi_items() if name != "request"}
            expected = {"capture_" + v.capture.id for v in body.captures}
            if set(files) != expected or any(not isinstance(v, UploadFile) for v in files.values()):
                raise QCServiceError("VALIDATION_FAILED")
            originals = {}
            # Every member/hash is checked before decoding and before constructing a model.
            uploaded = {}
            for view in body.captures:
                part = files["capture_" + view.capture.id]
                data = await part.read(MAX_ORIGINAL_BYTES + 1)
                if len(data) > MAX_ORIGINAL_BYTES:
                    raise QCServiceError("PAYLOAD_TOO_LARGE")
                if sha256_hex(data) != view.verified_sha256:
                    raise QCServiceError("VALIDATION_FAILED")
                uploaded[view.capture.id] = data
            for view in body.captures:
                original = await run_in_threadpool(decode_original, uploaded[view.capture.id])
                capture = view.capture
                if (
                    original.byte_size != capture.byte_size
                    or original.upright_size != (capture.width, capture.height)
                    or original.media_type != capture.media_type
                    or files["capture_" + capture.id].content_type != original.media_type
                    or capture.original_state != "AVAILABLE"
                ):
                    raise QCServiceError("VALIDATION_FAILED")
                originals[capture.id] = original
            batch = CaptureBatch.from_request(body, originals)
        finally:
            await form.close()
        check_deadline(claims.deadline_at, wall_time())

        def assemble():
            return run_qc_analysis(
                batch,
                body.spec,
                body.domain,
                get_qc_predictor(),
                body.policy,
                body.release,
                body.attempt,
                body.context,
            )

        # A timed-out thread cannot be killed safely. Keep its capacity lease until it exits,
        # discard the late candidate, and allow no second run alongside it.
        task = _executor.submit(assemble)
        remaining = max(0.0, timestamp(claims.deadline_at) - wall_time())
        try:
            result = await asyncio.wait_for(
                asyncio.shield(asyncio.wrap_future(task)), timeout=remaining
            )
        except asyncio.TimeoutError as exc:
            raise QCServiceError("DEADLINE_EXCEEDED") from exc
        response = JSONResponse(result.model_dump(mode="json"))
        check_deadline(claims.deadline_at, wall_time())
        return response
    finally:
        if task is None or task.done():
            _inflight.release()
        else:
            task.add_done_callback(_release_task)


def _release_task(task):
    # Retrieve exceptions even if the HTTP request already timed out or disconnected.
    if not task.cancelled():
        task.exception()
    _inflight.release()
