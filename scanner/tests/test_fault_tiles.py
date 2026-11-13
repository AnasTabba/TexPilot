"""Image loading and tiling for the fault stage: RGB conversion, tile boxes that cover the image,
and max-stitching of tile maps. Small synthetic images written to tmp_path; no model needed."""

import pytest

np = pytest.importorskip("numpy")
PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

from training.fault.tiles import load_rgb, stitch, tile_boxes  # noqa: E402


def _covered(boxes, h, w):
    mask = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in boxes:
        mask[y0:y1, x0:x1] = True
    return mask


def test_load_rgb_gray16(tmp_path):
    values = (np.arange(256) * 257).astype(np.uint16).reshape(16, 16)
    path = tmp_path / "gray16.png"
    Image.fromarray(values).save(path)

    rgb = load_rgb(str(path))

    assert rgb.shape == (16, 16, 3)
    assert rgb.dtype == np.uint8
    expected = np.arange(256).reshape(16, 16)
    for c in range(3):
        assert np.array_equal(rgb[:, :, c], expected)


def test_load_rgba(tmp_path):
    rgba = np.zeros((4, 5, 4), np.uint8)
    rgba[..., 0] = 200
    rgba[..., 1] = 30
    rgba[..., 2] = 7
    rgba[..., 3] = 128
    path = tmp_path / "rgba.png"
    Image.fromarray(rgba, "RGBA").save(path)

    rgb = load_rgb(str(path))

    assert rgb.shape == (4, 5, 3) and rgb.dtype == np.uint8
    assert (rgb[..., 0] == 200).all() and (rgb[..., 1] == 30).all() and (rgb[..., 2] == 7).all()


def test_load_rgb_la_and_palette(tmp_path):
    la = Image.new("LA", (3, 2), (90, 255))
    la.save(tmp_path / "la.png")
    pal = Image.new("P", (3, 2), 1)
    pal.putpalette([0, 0, 0, 10, 20, 30] + [0] * 762)
    pal.save(tmp_path / "pal.png")

    rgb_la = load_rgb(str(tmp_path / "la.png"))
    rgb_pal = load_rgb(str(tmp_path / "pal.png"))

    assert rgb_la.shape == (2, 3, 3) and (rgb_la == 90).all()
    assert rgb_pal.shape == (2, 3, 3) and rgb_pal.dtype == np.uint8
    assert (rgb_pal == [10, 20, 30]).all()


def test_tiles_cover_wide_strip():
    h, w = 256, 4096
    boxes = tile_boxes(h, w)

    for x0, y0, x1, y1 in boxes:
        assert 0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h
    assert _covered(boxes, h, w).all()
    # the last tile ends exactly at the right edge
    assert max(b[2] for b in boxes) == w


def test_small_image_one_tile():
    assert tile_boxes(64, 64) == [(0, 0, 64, 64)]


def test_tiles_cover_non_multiple_size():
    h, w = 1000, 1500
    boxes = tile_boxes(h, w)
    assert _covered(boxes, h, w).all()
    assert all(0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h for x0, y0, x1, y1 in boxes)


def test_stitch_max():
    maps = [np.ones((1, 2), np.float32), np.full((1, 2), 2, np.float32)]
    boxes = [(0, 0, 2, 1), (1, 0, 3, 1)]

    out = stitch(maps, boxes, 1, 3)

    assert out.dtype == np.float32 and out.shape == (1, 3)
    assert out.tolist() == [[1.0, 2.0, 2.0]]


def test_stitch_full_coverage_and_shape():
    h, w = 500, 900
    boxes = tile_boxes(h, w)
    maps = [np.full((y1 - y0, x1 - x0), 0.5, np.float32) for x0, y0, x1, y1 in boxes]

    out = stitch(maps, boxes, h, w)

    assert out.shape == (h, w) and out.dtype == np.float32
    assert np.allclose(out, 0.5)


def test_stitch_rejects_uncovered_pixels():
    maps = [np.ones((2, 2), np.float32)]
    with pytest.raises(ValueError):
        stitch(maps, [(0, 0, 2, 2)], 2, 4)


def test_small_image_one_tile_stitches_back():
    # 64 px image: one tile at (0,0,64,64); the 392 px map from the model is resized back to 64
    boxes = tile_boxes(64, 64)
    maps = [np.ones((392, 392), np.float32)]
    out = stitch(maps, boxes, 64, 64)
    assert out.shape == (64, 64) and np.allclose(out, 1.0)
