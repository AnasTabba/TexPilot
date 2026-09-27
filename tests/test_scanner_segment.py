"""Mask clean-up rules (spec §4.5). Skipped where numpy/scipy are absent (CI core)."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")

from services.vision.segment import box_mask, clean_mask  # noqa: E402


def test_keeps_only_the_largest_region_and_fills_its_holes():
    m = np.zeros((50, 50), bool)
    m[5:30, 5:30] = True  # the garment
    m[12:15, 12:15] = False  # a hole (a print, a button) inside it
    m[40:43, 40:43] = True  # a stray blob elsewhere
    out = clean_mask(m, (0, 0, 50, 50), min_box_fraction=0.1)
    assert out[13, 13] and not out[41, 41]
    assert out.sum() == 25 * 25


def test_a_mask_far_smaller_than_its_box_falls_back_to_the_box():
    m = np.zeros((50, 50), bool)
    m[20:22, 20:22] = True  # 4 px inside a 30x30 box: segmentation failed
    out = clean_mask(m, (10, 10, 40, 40))
    assert np.array_equal(out, box_mask((50, 50), (10, 10, 40, 40)))


def test_box_mask_is_the_rectangle():
    out = box_mask((6, 8), (1.2, 2.0, 5.0, 4.6))
    assert out.sum() == 4 * 3 and out[2:5, 1:5].all()
