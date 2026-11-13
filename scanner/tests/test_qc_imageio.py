"""QC v2 decoder: full-resolution upright originals inside hard limits (design §17, §21)."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from services.vision import imageio as v1
from services.vision.qc_imageio import (
    QCImageError,
    decode_original,
    derivative,
    read_bounded,
    sniff_media_type,
)

FIX = Path(__file__).parent / "fixtures" / "qc-images"
MANIFEST = json.loads((FIX / "manifest.json").read_text())


def _load(name: str) -> bytes:
    return (FIX / name).read_bytes()


def test_manifest_hashes_match_the_checked_in_files():
    assert len(MANIFEST) == 9
    for name, row in MANIFEST.items():
        data = _load(name)
        assert hashlib.sha256(data).hexdigest() == row["sha256"], name
        assert len(data) == row["bytes"], name


@pytest.mark.parametrize(
    ("name", "media"),
    [("swatch.jpg", "image/jpeg"), ("swatch.png", "image/png"), ("swatch.webp", "image/webp")],
)
def test_real_jpeg_png_webp_decode_at_source_resolution(name, media):
    d = decode_original(_load(name))
    assert d.media_type == media
    assert d.rgb.shape == (480, 640, 3) and d.rgb.dtype == np.uint8
    assert d.stored_size == d.upright_size == (640, 480)
    assert d.sha256 == MANIFEST[name]["sha256"]  # hash is of the raw uploaded bytes
    assert d.transform["resampled"] is False and d.exif_orientation == 1


def test_exif_rotation_is_applied_and_recorded():
    d = decode_original(_load("swatch-exif6.jpg"))
    assert d.exif_orientation == 6
    assert d.stored_size == (640, 480) and d.upright_size == (480, 640)
    assert d.rgb.shape == (640, 480, 3)
    # The stored top-left red corner is at the top-right once upright (90 degrees clockwise).
    r, g, b = d.rgb[20, -20]
    assert r > 180 and g < 90 and b < 90
    assert d.transform["exif_orientation"] == 6


def test_a_12_megapixel_original_is_not_shrunk_unlike_v1():
    """4032x3024 is the phone original design §17 names; v1 would cut it to 1600 px."""
    buf = io.BytesIO()
    Image.new("RGB", (4032, 3024), (90, 120, 150)).save(buf, "JPEG", quality=70)
    data = buf.getvalue()
    d = decode_original(data)
    assert d.rgb.shape == (3024, 4032, 3)
    assert max(v1.decode_image(data).shape) == 1600  # v1 default is unchanged
    assert v1.MAX_SIDE == 1600


def test_signature_valid_truncated_jpeg_is_a_422_not_a_crash():
    data = _load("truncated-14.jpg")
    assert len(data) == 14 and data.startswith(b"\xff\xd8\xff")
    with pytest.raises(QCImageError) as e:
        decode_original(data)
    assert e.value.code == "VALIDATION_FAILED"
    assert "cannot be decoded" in e.value.detail  # fixed phrase, no library text


def test_over_pixel_limit_is_refused_from_the_header_before_allocation(monkeypatch):
    data = _load("over-pixel-limit.png")
    assert len(data) < 100_000  # tiny on disk: a byte limit alone would let it through
    loaded = []
    monkeypatch.setattr(Image.Image, "load", lambda self: loaded.append(1))
    with pytest.raises(QCImageError) as e:
        decode_original(data)
    assert e.value.code == "PAYLOAD_TOO_LARGE"
    assert loaded == []  # the raster was never decoded


def test_byte_limit_is_enforced_while_reading_not_from_a_header():
    with pytest.raises(QCImageError) as e:
        read_bounded(io.BytesIO(b"x" * 1025), limit=1024, chunk=100)
    assert e.value.code == "PAYLOAD_TOO_LARGE"
    assert read_bounded(io.BytesIO(b"x" * 1024), limit=1024, chunk=100) == b"x" * 1024
    with pytest.raises(QCImageError) as e:
        decode_original(b"\xff\xd8\xff" + b"0" * (12 * 1024 * 1024))
    assert e.value.code == "PAYLOAD_TOO_LARGE"


def test_heic_is_an_explicit_415_with_guidance():
    with pytest.raises(QCImageError) as e:
        decode_original(_load("fake.heic"))
    assert e.value.code == "UNSUPPORTED_MEDIA" and "HEIC" in e.value.detail


@pytest.mark.parametrize(
    "data", [b"GIF89a" + b"\0" * 20, b"BM" + b"\0" * 20, b"II*\x00" + b"\0" * 9]
)
def test_other_formats_are_415(data):
    with pytest.raises(QCImageError) as e:
        sniff_media_type(data)
    assert e.value.code == "UNSUPPORTED_MEDIA"


def test_animated_webp_is_refused():
    with pytest.raises(QCImageError) as e:
        decode_original(_load("animated.webp"))
    assert e.value.code == "UNSUPPORTED_MEDIA"


def test_signature_that_disagrees_with_content_is_refused():
    png = _load("swatch.png")
    with pytest.raises(QCImageError) as e:
        decode_original(b"\xff\xd8\xff" + png[3:])
    assert e.value.code in ("VALIDATION_FAILED", "UNSUPPORTED_MEDIA")


def test_empty_original_is_422():
    with pytest.raises(QCImageError) as e:
        decode_original(b"")
    assert e.value.code == "VALIDATION_FAILED"


def test_derivatives_record_their_resize_and_never_upsample():
    d = decode_original(_load("swatch.jpg"))
    small, rec = derivative(d.rgb, 224, "fabric-classifier")
    assert max(small.shape[:2]) == 224
    assert rec["source_size"] == [640, 480] and rec["size"] == [224, 168]
    assert rec["interpolation"] == "area" and rec["purpose"] == "fabric-classifier"
    same, rec2 = derivative(d.rgb, 4000, "defects")
    assert same.shape == d.rgb.shape and rec2["interpolation"] == "none"


def test_checked_in_phone_original_exists_and_preserves_source_resolution():
    d = decode_original(_load("phone-4032x3024.jpg"))
    assert d.stored_size == d.upright_size == (4032, 3024)
    assert d.rgb.shape == (3024, 4032, 3)


def test_public_decoder_alias_and_typed_errors():
    from services.vision.qc_imageio import (
        QCImageDecodeError,
        QCImageTooLargeError,
        QCUnsupportedMediaError,
        decode_qc_image,
    )

    assert decode_qc_image(_load("swatch.png")).upright_size == (640, 480)
    for data, error in [
        (_load("over-pixel-limit.png"), QCImageTooLargeError),
        (_load("fake.heic"), QCUnsupportedMediaError),
        (_load("truncated-14.jpg"), QCImageDecodeError),
    ]:
        with pytest.raises(error):
            decode_qc_image(data)


def test_animated_png_is_refused_before_raster_load(monkeypatch):
    buf = io.BytesIO()
    frames = [Image.new("RGB", (64, 64), color) for color in ("red", "blue")]
    frames[0].save(buf, "PNG", save_all=True, append_images=frames[1:])
    loaded = []
    original_load = Image.Image.load

    def spy(self, *args, **kwargs):
        loaded.append(self.size)
        return original_load(self, *args, **kwargs)

    monkeypatch.setattr(Image.Image, "load", spy)
    with pytest.raises(QCImageError) as error:
        decode_original(buf.getvalue())
    assert error.value.code == "UNSUPPORTED_MEDIA" and loaded == []


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_pixel_header_is_checked_before_opening_any_pillow_decoder(monkeypatch, fmt):
    buf = io.BytesIO()
    Image.new("RGB", (4001, 4000), (128, 128, 128)).save(buf, fmt)

    def forbidden_open(*args, **kwargs):
        pytest.fail("pixel header must be bounded before the image decoder is constructed")

    monkeypatch.setattr(Image, "open", forbidden_open)
    with pytest.raises(QCImageError) as error:
        decode_original(buf.getvalue())
    assert error.value.code == "PAYLOAD_TOO_LARGE"
