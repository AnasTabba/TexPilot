"""QC v2 image decoding: the upright, full-resolution original, inside hard limits.

v1 (``imageio.decode_image``) shrinks everything to 1600 px because detectors and heads need no
more. Quality and metrology do: a thread two source pixels wide cannot be recovered from a
smaller copy. So v2 keeps the original raster, records the EXIF turn it applied, and makes
every smaller copy an explicit, recorded derivative (design §17, §21). v1 is unchanged.

Limits are checked before the raster is allocated: bytes while reading, pixels from the header.
"""

from __future__ import annotations

import hashlib
import io
import warnings
from dataclasses import dataclass
from typing import BinaryIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from services.api.qc_schemas import MAX_DECODED_PIXELS, MAX_ORIGINAL_BYTES

DECODER_VERSION = "qc-imageio-1"
MAX_SIDE = 20_000
_HEIF_BRANDS = (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1", b"heif", b"avif")
_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class QCImageError(Exception):
    """An original that cannot be evidence. ``code`` is a v2 ErrorCode; ``detail`` is a fixed,
    sanitised phrase (never file content or a library message)."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code, self.detail = code, detail


class QCImageTooLargeError(QCImageError):
    """413: original byte or header pixel bounds exceeded."""

    def __init__(self, detail: str):
        super().__init__("PAYLOAD_TOO_LARGE", detail)


class QCUnsupportedMediaError(QCImageError):
    """415: unsupported container or animation."""

    def __init__(self, detail: str):
        super().__init__("UNSUPPORTED_MEDIA", detail)


class QCImageDecodeError(QCImageError):
    """422: allowed signature but corrupt raster."""

    def __init__(self, detail: str):
        super().__init__("VALIDATION_FAILED", detail)


@dataclass(frozen=True)
class DecodedOriginal:
    rgb: np.ndarray  # H x W x 3 uint8, upright, source resolution
    sha256: str  # of the raw uploaded bytes
    media_type: str
    byte_size: int
    stored_size: tuple[int, int]  # (width, height) as encoded in the file
    upright_size: tuple[int, int]  # (width, height) after the EXIF turn
    exif_orientation: int  # 1-8; 1 when absent
    decoder_version: str = DECODER_VERSION

    @property
    def transform(self) -> dict:
        """What was done to the stored raster: only the EXIF turn, never a resize."""
        return {
            "decoder_version": self.decoder_version,
            "exif_orientation": self.exif_orientation,
            "stored_size": list(self.stored_size),
            "upright_size": list(self.upright_size),
            "resampled": False,
        }


def read_bounded(stream: BinaryIO, limit: int = MAX_ORIGINAL_BYTES, chunk: int = 65536) -> bytes:
    """Read at most ``limit`` bytes; one more is a 413. A Content-Length header is never proof."""
    if not 0 < limit <= MAX_ORIGINAL_BYTES or chunk <= 0:
        raise ValueError("invalid read bounds")
    parts, size = [], 0
    while True:
        block = stream.read(min(chunk, limit - size + 1))
        if not block:
            return b"".join(parts)
        size += len(block)
        if size > limit:
            raise QCImageTooLargeError("original exceeds the byte limit")
        parts.append(block)


def sniff_media_type(data: bytes) -> str:
    """Media type from the file signature. HEIC is named explicitly so the client can say how
    to fix it (convert or recapture) instead of a generic failure."""
    if data[4:8] == b"ftyp" and data[8:12] in _HEIF_BRANDS:
        raise QCUnsupportedMediaError("HEIC/HEIF is not supported; send JPEG")
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise QCUnsupportedMediaError("original must be JPEG, PNG or WebP")


def _bounded_dimensions(width: int, height: int) -> None:
    if width < 1 or height < 1:
        raise QCImageDecodeError("original has invalid dimensions")
    if max(width, height) > MAX_SIDE:
        raise QCImageTooLargeError("original exceeds the side limit")
    if width * height > MAX_DECODED_PIXELS:
        raise QCImageTooLargeError("original exceeds the pixel limit")


def _probe_header(data: bytes, media_type: str) -> tuple[int, int]:
    """Read container dimensions without constructing a raster decoder (including libwebp).

    Pillow's WebP open constructs a native decoder, so Image.open alone is too late for this
    bound. All size-bearing WebP chunks must agree. Pillow still validates the full container.
    """

    def invalid():
        raise QCImageDecodeError("original cannot be decoded")

    if media_type == "image/png":
        if len(data) < 33 or data[12:16] != b"IHDR" or int.from_bytes(data[8:12], "big") != 13:
            invalid()
        size = (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"))
        _bounded_dimensions(*size)
        offset = 8
        while offset + 12 <= len(data):
            length = int.from_bytes(data[offset : offset + 4], "big")
            kind = data[offset + 4 : offset + 8]
            if offset + length + 12 > len(data):
                invalid()
            if kind == b"acTL":
                raise QCUnsupportedMediaError("animated images are not supported")
            offset += length + 12
        return size
    if media_type == "image/jpeg":
        offset = 2
        sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while offset + 1 < len(data):
            if data[offset] != 0xFF:
                invalid()
            while offset < len(data) and data[offset] == 0xFF:
                offset += 1
            if offset >= len(data):
                invalid()
            marker = data[offset]
            offset += 1
            if marker in (0xD9, 0xDA):
                invalid()
            if marker == 0x01 or 0xD0 <= marker <= 0xD7:
                continue
            length = int.from_bytes(data[offset : offset + 2], "big")
            if length < 2 or offset + length > len(data):
                invalid()
            if marker in sof:
                if length < 8:
                    invalid()
                size = (
                    int.from_bytes(data[offset + 5 : offset + 7], "big"),
                    int.from_bytes(data[offset + 3 : offset + 5], "big"),
                )
                _bounded_dimensions(*size)
                return size
            offset += length
        invalid()
    # RIFF WebP: VP8X canvas, VP8 lossy frame or VP8L lossless dimensions.
    if len(data) < 20 or int.from_bytes(data[4:8], "little") + 8 != len(data):
        invalid()
    offset, size = 12, None
    while offset + 8 <= len(data):
        kind = data[offset : offset + 4]
        length = int.from_bytes(data[offset + 4 : offset + 8], "little")
        start = offset + 8
        if start + length > len(data):
            invalid()
        frame = None
        if kind == b"VP8X":
            if length != 10:
                invalid()
            if data[start] & 0x02:
                raise QCUnsupportedMediaError("animated images are not supported")
            frame = (
                1 + int.from_bytes(data[start + 4 : start + 7], "little"),
                1 + int.from_bytes(data[start + 7 : start + 10], "little"),
            )
        elif kind == b"VP8L":
            if length < 5 or data[start] != 0x2F:
                invalid()
            bits = int.from_bytes(data[start + 1 : start + 5], "little")
            frame = (1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF))
        elif kind == b"VP8 ":
            if length < 10 or data[start + 3 : start + 6] != b"\x9d\x01\x2a":
                invalid()
            frame = (
                int.from_bytes(data[start + 6 : start + 8], "little") & 0x3FFF,
                int.from_bytes(data[start + 8 : start + 10], "little") & 0x3FFF,
            )
        elif kind in (b"ANIM", b"ANMF"):
            raise QCUnsupportedMediaError("animated images are not supported")
        if frame is not None:
            _bounded_dimensions(*frame)
            if size is not None and frame != size:
                invalid()
            size = frame
        offset = start + length + (length & 1)
    if size is None:
        invalid()
    return size


def decode_original(data: bytes) -> DecodedOriginal:
    """The upright full-resolution raster of one uploaded original.

    413: too many bytes or pixels (checked from the header, before decoding).
    415: not single-frame JPEG/PNG/WebP. 422: the right signature but not a decodable image.
    """
    if not data:
        raise QCImageDecodeError("original is empty")
    if len(data) > MAX_ORIGINAL_BYTES:
        raise QCImageTooLargeError("original exceeds the byte limit")
    media_type = sniff_media_type(data)
    header_size = _probe_header(data, media_type)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(io.BytesIO(data), formats=list(_FORMATS))
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        raise QCImageTooLargeError("original exceeds the pixel limit") from e
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise QCImageDecodeError("original cannot be decoded") from e
    with im:
        if _FORMATS.get(im.format or "") != media_type:
            raise QCUnsupportedMediaError("file signature and content disagree")
        width, height = im.size
        if im.size != header_size:
            raise QCImageDecodeError("original has inconsistent dimensions")
        if width < 1 or height < 1 or max(width, height) > MAX_SIDE:
            raise QCImageTooLargeError("original exceeds the side limit")
        if width * height > MAX_DECODED_PIXELS:
            raise QCImageTooLargeError("original exceeds the pixel limit")
        if getattr(im, "n_frames", 1) != 1:
            raise QCUnsupportedMediaError("animated images are not supported")
        try:
            orientation = int(im.getexif().get(0x0112, 1) or 1)
            if not 1 <= orientation <= 8:
                orientation = 1
            upright = ImageOps.exif_transpose(im).convert("RGB")
            rgb = np.asarray(upright).copy()
        except (OSError, SyntaxError, ValueError, EOFError, MemoryError) as e:
            raise QCImageDecodeError("original cannot be decoded") from e
    return DecodedOriginal(
        rgb=rgb,
        sha256=hashlib.sha256(data).hexdigest(),
        media_type=media_type,
        byte_size=len(data),
        stored_size=(width, height),
        upright_size=(rgb.shape[1], rgb.shape[0]),
        exif_orientation=orientation,
    )


def derivative(image: np.ndarray, max_side: int, purpose: str) -> tuple[np.ndarray, dict]:
    """A smaller copy for a model that needs no more, with the record of how it was made.

    Pixels only: EXIF (and so GPS) never reaches a derivative. The record goes into the stage's
    artifact binding so a changed resize invalidates the calibration that assumed it."""
    import cv2

    h, w = image.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    out = image
    if scale < 1.0:
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        out = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    return out, {
        "purpose": purpose,
        "source_size": [w, h],
        "size": [out.shape[1], out.shape[0]],
        "max_side": max_side,
        "interpolation": "area" if scale < 1.0 else "none",
        "decoder_version": DECODER_VERSION,
    }


def decode_qc_image(data: bytes) -> DecodedOriginal:
    """Public v2 decoder alias; preserves decode_original for existing callers."""
    return decode_original(data)
