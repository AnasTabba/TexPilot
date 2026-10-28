"""Classifier views (spec §4.6). Skipped where numpy/scipy are absent (CI core)."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")

from services.vision.crop import FabricCropper, masked_crop, patch_boxes  # noqa: E402


def _disk(h=120, w=200, cy=60, cx=100, r=50):
    yy, xx = np.mgrid[:h, :w]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def _image(h=120, w=200):
    return np.full((h, w, 3), 100, np.uint8)


def test_masked_crop_is_square_with_white_background():
    out = masked_crop(_image(), _disk())
    assert out.shape[0] == out.shape[1] == 101
    assert (out[0, 0] == 255).all()  # corner lies outside the disk
    assert (out[50, 50] == 100).all()  # centre is garment


def test_patches_lie_inside_the_eroded_mask_and_do_not_overlap():
    mask = _disk()
    boxes = patch_boxes(mask, n=3)
    assert 1 <= len(boxes) <= 3
    for y0, x0, s in boxes:
        assert mask[y0 : y0 + s, x0 : x0 + s].all()
    for i, (ya, xa, s) in enumerate(boxes):
        for yb, xb, _ in boxes[i + 1 :]:
            assert abs(ya - yb) >= s or abs(xa - xb) >= s


def test_patches_never_leave_the_image_when_the_mask_touches_its_edge():
    mask = np.zeros((100, 100), bool)
    mask[:, :60] = True
    for y0, x0, s in patch_boxes(mask):
        assert y0 >= 0 and x0 >= 0 and y0 + s <= 100 and x0 + s <= 100


def test_a_sliver_of_mask_yields_no_patches():
    mask = np.zeros((100, 100), bool)
    mask[40:44, 10:90] = True
    assert patch_boxes(mask) == []


def test_empty_mask_is_an_error_not_a_blank_view():
    with pytest.raises(ValueError):
        masked_crop(_image(), np.zeros((120, 200), bool))


def test_cropper_views():
    img, mask = _image(), _disk()
    assert len(FabricCropper().views(img, mask)) == 1
    assert len(FabricCropper(patches=True).views(img, mask)) > 1
