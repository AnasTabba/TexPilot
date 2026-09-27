"""Reject unusable uploads at the API boundary, in every mode. Stdlib only.

The stub never decodes images, so without this check the app team (who build against
the stub) would first meet the scanner's 422 for HEIC in the demo. File signatures are
enough to tell an image format apart; full decoding still happens in scanner mode.
"""

from __future__ import annotations

from services.vision.errors import UnsupportedImage

_SIGNATURES = (
    (b"\xff\xd8\xff", "JPEG"),
    (b"\x89PNG\r\n\x1a\n", "PNG"),
    (b"GIF87a", "GIF"),
    (b"GIF89a", "GIF"),
    (b"BM", "BMP"),
)
#: ISO base-media brands used by HEIC/HEIF/AVIF, the iPhone default.
_HEIF_BRANDS = (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1", b"heif", b"avif")


def image_format(data: bytes) -> str | None:
    for signature, name in _SIGNATURES:
        if data.startswith(signature):
            return name
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def check_upload(data: bytes, field: str) -> None:
    """Raise UnsupportedImage (-> HTTP 422) unless ``data`` looks like a supported image."""
    if not data:
        raise UnsupportedImage(f"{field} is empty")
    if data[4:8] == b"ftyp" and data[8:12] in _HEIF_BRANDS:
        raise UnsupportedImage(
            f"{field} is HEIC/HEIF, which is not supported; send JPEG "
            "(iPhone: Settings -> Camera -> Formats -> Most Compatible)"
        )
    if image_format(data) is None:
        raise UnsupportedImage(f"{field} is not a JPEG, PNG, WebP, GIF or BMP image")
