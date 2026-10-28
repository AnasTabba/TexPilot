"""Capture quality of the garment photo: raw numbers now; the phone set sets the cut-offs."""

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

from services.vision.quality import capture_quality  # noqa: E402


def _checker(side, cell):
    y, x = np.indices((side, side)) // cell
    g = ((x + y) % 2 * 200 + 28).astype(np.uint8)
    return np.dstack([g, g, g])


def test_a_blurred_photo_scores_far_lower_than_a_sharp_one():
    sharp = _checker(800, 16)
    blurred = cv2.GaussianBlur(sharp, (0, 0), 6)
    assert capture_quality(blurred, None)["blur"] < capture_quality(sharp, None)["blur"] / 5


def test_sharpness_does_not_depend_on_the_phone_resolution():
    same_photo = _checker(1024, 16), _checker(2048, 32)  # twice the pixels, same content
    a, b = (capture_quality(img, None)["blur"] for img in same_photo)
    assert 0.5 < a / b < 2


@pytest.mark.parametrize("value,expected", [(0, "under"), (255, "over"), (128, "ok")])
def test_exposure(value, expected):
    assert capture_quality(np.full((300, 300, 3), value, np.uint8), None)["exposure"] == expected


@pytest.mark.parametrize(
    "box,expected",
    [
        (None, None),  # no garment found: nothing to frame
        ((0.1, 0.1, 0.9, 0.9), "ok"),
        ((0.4, 0.4, 0.6, 0.6), "too_small"),  # 4% of the frame
        ((0.0, 0.2, 0.7, 1.0), "cut_off"),  # runs off the left and bottom edges
    ],
)
def test_framing_comes_from_the_garment_box(box, expected):
    assert capture_quality(np.full((300, 300, 3), 128, np.uint8), box)["framing"] == expected


def test_a_white_background_does_not_make_a_well_lit_garment_over_exposed():
    photo = np.full((400, 400, 3), 255, np.uint8)  # studio or wall white
    photo[100:300, 100:300] = _checker(200, 10)  # the garment, properly exposed
    assert capture_quality(photo, None)["exposure"] == "over"  # the whole frame is
    assert capture_quality(photo, (0.25, 0.25, 0.75, 0.75))["exposure"] == "ok"  # the garment isn't
