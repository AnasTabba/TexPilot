"""Upload decoding: upright, RGB, bounded. Skipped where numpy/PIL are absent (CI core)."""

import io

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.errors import UnsupportedImage  # noqa: E402
from services.vision.imageio import decode_image  # noqa: E402


def _encode(img, fmt="JPEG", **kw):
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kw)
    return buf.getvalue()


def test_exif_rotated_phone_photo_is_decoded_upright():
    img = Image.new("RGB", (40, 20), "red")  # stored landscape
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90° clockwise to display", as phones write it
    assert decode_image(_encode(img, exif=exif)).shape == (40, 20, 3)  # displayed portrait


def test_twelve_megapixel_photos_are_bounded():
    out = decode_image(_encode(Image.new("RGB", (4032, 3024), "blue")), max_side=1600)
    assert out.shape == (1200, 1600, 3)


@pytest.mark.parametrize("mode", ["RGBA", "L", "P"])
def test_any_pixel_mode_becomes_rgb(mode):
    out = decode_image(_encode(Image.new(mode, (8, 6)), fmt="PNG"))
    assert out.shape == (6, 8, 3)
    assert out.dtype == np.uint8


@pytest.mark.parametrize(
    "data", [b"not an image", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64], ids=["junk", "heic"]
)
def test_undecodable_bytes_raise_unsupported_image(data):
    with pytest.raises(UnsupportedImage):
        decode_image(data)
