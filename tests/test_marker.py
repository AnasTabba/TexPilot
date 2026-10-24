"""Phone photos with the printed TexPilot card: the card's marker gives the scale and undoes
the camera's tilt, so threads can be counted without a flatbed scanner."""

import math

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

from services.vision.marker import CARD_ID, MARKER_MM, find_card  # noqa: E402
from services.vision.threads import thread_density  # noqa: E402
from tests.fabric_sim import degrade, render  # noqa: E402


def phone_photo(ends, picks, ppi, tilt=0.0, turn=0.0, scale=0.8, weave="3/1 twill", seed=0):
    """Fabric at ``ppi`` with the card on it, photographed at an angle: ``tilt`` degrees out of
    plane, the card turned ``turn`` degrees on the fabric, then blur + phone JPEG."""
    img = render(weave, ends, picks, ppi, size=2800, seed=seed)
    side = round(MARKER_MM / 25.4 * ppi)
    m = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50),
                                      CARD_ID, side)  # fmt: skip
    pad = side // 6  # the card's white border
    card = cv2.copyMakeBorder(m, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)
    rot = cv2.getRotationMatrix2D((card.shape[1] / 2, card.shape[0] / 2), turn, 1.0)
    n = int(card.shape[0] * 1.5)
    rot[:, 2] += (n - card.shape[0]) / 2
    card = cv2.warpAffine(card, rot, (n, n), borderValue=0)
    inside = cv2.warpAffine(np.full_like(m, 255, shape=(side + 2 * pad,) * 2), rot, (n, n)) > 0
    y0 = x0 = 150
    img[y0 : y0 + n, x0 : x0 + n][inside] = card[inside]
    h, w = img.shape
    t = math.tan(math.radians(tilt)) * 0.35
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[w * t, 0], [w * (1 - t), 0], [w, h], [0, h]]) * scale
    H = cv2.getPerspectiveTransform(src, dst)
    photo = cv2.warpPerspective(img, H, (int(w * scale), int(h * scale)), borderValue=40)
    return degrade(photo, blur=0.7, jpeg=88)


@pytest.mark.parametrize(
    "tilt,turn", [(0, 0), (12, 0), (0, 25), (15, 40)], ids=["flat", "tilted", "turned", "both"]
)
def test_the_card_gives_scale_and_counts_through_tilt_and_turn(tilt, turn):
    photo = phone_photo(64, 42, 600, tilt=tilt, turn=turn)
    card = find_card(photo)
    assert card is not None
    d = thread_density(card.gray, card.ppi, max_tpi=min(200, card.ppi / 2.5))
    assert d.ends_per_inch == pytest.approx(64, rel=0.03)
    assert d.picks_per_inch == pytest.approx(42, rel=0.03)


def test_the_rectified_photo_keeps_the_photos_orientation_not_the_cards():
    """Ends stay ends: the card may lie at any angle; the phone is held along the selvedge."""
    card = find_card(phone_photo(110, 70, 600, turn=60, weave="plain"))
    d = thread_density(card.gray, card.ppi, max_tpi=min(200, card.ppi / 2.5))
    assert d.ends_per_inch == pytest.approx(110, rel=0.03)
    assert d.picks_per_inch == pytest.approx(70, rel=0.03)


def test_the_measured_area_leaves_the_card_out():
    card = find_card(phone_photo(64, 42, 600))
    (x0, y0, x1, y1), (mx0, my0, mx1, my1) = card.box, card.marker_box
    assert x1 <= mx0 or x0 >= mx1 or y1 <= my0 or y0 >= my1  # no overlap
    assert card.gray.shape == (y1 - y0, x1 - x0)
    assert min(card.gray.shape) >= 400


def test_a_photo_without_the_card_is_not_guessed():
    assert find_card(degrade(render("plain", 80, 60, 600, size=1200), jpeg=88)) is None


def test_a_card_printed_at_another_size_can_be_measured_and_given():
    photo = phone_photo(64, 42, 600)
    big = find_card(photo, marker_mm=1.5 * MARKER_MM).ppi
    assert big == pytest.approx(find_card(photo).ppi / 1.5)
