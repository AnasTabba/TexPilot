"""Which garment a photo is about. Pure logic, so it runs in CI."""

import pytest

from services.vision.garment import (
    GARMENT_VOCAB,
    PROMPTS,
    Detection,
    canonical,
    choose_primary,
    to_detections,
)


@pytest.mark.parametrize(
    "phrase,expected",
    [
        ("shirt", "shirt_blouse"),
        ("t - shirt", "top_tshirt_sweatshirt"),  # Grounding DINO splits hyphens
        ("Sweatshirt", "top_tshirt_sweatshirt"),
        ("jeans", "pants"),
        ("a photo of a dupatta", "scarf"),  # OWLv2 query form
        ("overcoat", "coat"),
        ("shoe", None),
        ("", None),
    ],
)
def test_detector_phrases_map_to_canonical_garments(phrase, expected):
    assert canonical(phrase) == expected


def test_every_prompt_maps_back_to_its_own_garment():
    for garment, synonyms in GARMENT_VOCAB.items():
        for synonym in synonyms:
            assert canonical(synonym) == garment, synonym


def test_vocabulary_is_the_fourteen_fabric_garments():
    assert len(GARMENT_VOCAB) == 14
    assert len(PROMPTS) == len(set(PROMPTS))


def test_to_detections_maps_clips_and_drops():
    dets = to_detections(
        ["jeans", "shoe", "t-shirt"],
        [0.8, 0.9, 0.5],
        [(-5, 10, 50, 120), (0, 0, 5, 5), (10, 10, 10, 20)],  # last one has zero width
        100,
        100,
    )
    assert dets == [Detection("pants", 0.8, (0.0, 10.0, 50.0, 100.0))]


def test_large_central_garment_beats_small_corner_one():
    corner = Detection("scarf", 0.9, (0, 0, 10, 10))
    central = Detection("dress", 0.6, (20, 20, 80, 80))
    assert choose_primary([corner, central], 100, 100) == central


def test_detections_below_the_threshold_leave_no_garment():
    assert choose_primary([Detection("dress", 0.2, (20, 20, 80, 80))], 100, 100) is None
    assert choose_primary([], 100, 100) is None


def test_scoreless_backend_ranks_by_size_and_centre():
    small = Detection("skirt", None, (40, 40, 50, 50))
    big = Detection("coat", None, (10, 10, 90, 90))
    assert choose_primary([small, big], 100, 100, min_score=0.9) == big


def test_worn_outfit_resolves_to_one_garment_deterministically():
    # Review Focus 5: a person wearing a top and pants. One must win, the same one every time.
    top = Detection("top_tshirt_sweatshirt", 0.60, (30, 10, 70, 50))
    pants = Detection("pants", 0.55, (30, 50, 70, 98))
    assert choose_primary([pants, top], 100, 100) == top
    assert choose_primary([top, pants], 100, 100) == top
