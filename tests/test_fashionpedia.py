"""Fashionpedia restricted to the 14 garment classes (spec §4.1, §4.2 B). Stdlib only."""

import json
from pathlib import Path

import pytest

from training.detector.fashionpedia import CLASSES, Example, holdout, load, to_coco

CATS = [{"id": 0, "name": "shirt, blouse"}, {"id": 6, "name": "pants"},
        {"id": 23, "name": "shoe"}, {"id": 31, "name": "sleeve"}]  # fmt: skip


def _json(tmp_path, images, anns):
    p = tmp_path / "ann.json"
    p.write_text(json.dumps({"images": images, "annotations": anns, "categories": CATS}))
    return p


def _img(i):
    return {"id": i, "file_name": f"{i}.jpg", "width": 100, "height": 200}


def _ann(i, image, cat, bbox=(10, 10, 50, 80), crowd=0):
    return {"id": i, "image_id": image, "category_id": cat, "bbox": list(bbox),
            "iscrowd": crowd, "area": 1}  # fmt: skip


def test_garments_map_to_the_vocabulary_and_everything_else_is_dropped(tmp_path):
    anns = [_ann(1, 1, 0), _ann(2, 1, 6), _ann(3, 1, 23), _ann(4, 1, 31)]
    [e] = load(_json(tmp_path, [_img(1)], anns))
    assert [CLASSES[i] for i in e.labels] == ["shirt_blouse", "pants"]
    assert e.boxes == ((10.0, 10.0, 50.0, 80.0),) * 2 and (e.width, e.height) == (100, 200)


def test_a_photo_with_no_garment_stays_as_a_negative(tmp_path):
    [e] = load(_json(tmp_path, [_img(1)], [_ann(1, 1, 23)]))  # only a shoe
    assert e.labels == () and e.boxes == ()


def test_crowd_and_empty_boxes_are_dropped(tmp_path):
    anns = [_ann(1, 1, 6, crowd=1), _ann(2, 1, 6, bbox=(5, 5, 0, 30))]
    [e] = load(_json(tmp_path, [_img(1)], anns))
    assert e.labels == ()


def test_the_classes_are_the_vocabulary_in_order():
    from services.vision.garment import GARMENT_VOCAB, canonical

    assert tuple(GARMENT_VOCAB) == CLASSES
    assert all(canonical(c) == c for c in CLASSES)  # the detector's label names map to themselves


def test_the_holdout_is_stable_disjoint_and_about_five_percent():
    examples = [Example(i, f"{i}.jpg", 10, 10, (), ()) for i in range(2000)]
    train, held = holdout(examples)
    assert not {e.image_id for e in train} & {e.image_id for e in held}
    assert len(train) + len(held) == 2000 and 60 <= len(held) <= 140
    # More images never move an image between the two: selection stays out of training.
    assert holdout(examples[:1000])[1] == [e for e in held if e.image_id < 1000]


def test_ground_truth_goes_back_out_in_coco_form_for_scoring(tmp_path):
    examples = load(_json(tmp_path, [_img(1), _img(2)], [_ann(1, 1, 6)]))
    gt = to_coco(examples)
    assert [c["name"] for c in gt["categories"]] == list(CLASSES)
    assert [(a["image_id"], a["category_id"], a["bbox"], a["area"]) for a in gt["annotations"]] == [
        (1, CLASSES.index("pants"), [10.0, 10.0, 50.0, 80.0], 4000.0)
    ]
    assert [i["id"] for i in gt["images"]] == [1, 2]


def test_the_real_val_annotations_load():
    path = Path("data/fashionpedia/annotations/instances_attributes_val2020.json")
    if not path.exists():
        pytest.skip("Fashionpedia val annotations not on this machine")
    examples = load(path)
    assert len(examples) == 1158 and sum(len(e.labels) for e in examples) > 1000
