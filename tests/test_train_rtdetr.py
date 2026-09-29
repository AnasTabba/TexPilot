"""RT-DETR training plumbing that needs no model. Stdlib (pycocotools only where noted)."""

import pytest

from training.detector.fashionpedia import CLASSES, Example
from training.detector.train_rtdetr import coco_detections, coco_map, coco_target, hflip


def test_a_flipped_photo_has_its_boxes_mirrored():
    assert hflip(((10.0, 5.0, 30.0, 40.0),), 100) == ((60.0, 5.0, 30.0, 40.0),)


def test_the_target_is_what_the_rtdetr_processor_reads():
    e = Example(7, "7.jpg", 100, 200, ((10.0, 10.0, 50.0, 80.0),), (CLASSES.index("pants"),))
    assert coco_target(e, e.boxes) == {
        "image_id": 7,
        "annotations": [{"bbox": [10.0, 10.0, 50.0, 80.0], "category_id": CLASSES.index("pants"),
                         "area": 4000.0, "iscrowd": 0}],
    }  # fmt: skip


def test_a_negative_photo_has_an_empty_target():
    assert coco_target(Example(8, "8.jpg", 10, 10, (), ()), ())["annotations"] == []


def test_predictions_become_coco_results_with_width_and_height():
    got = coco_detections(7, [0.9], [3], [[10.0, 20.0, 60.0, 100.0]])
    assert got == [
        {"image_id": 7, "category_id": 3, "bbox": [10.0, 20.0, 50.0, 80.0], "score": 0.9}
    ]


def test_a_perfect_detector_scores_map_one():
    pytest.importorskip("pycocotools")
    e = Example(7, "7.jpg", 100, 200, ((10.0, 10.0, 50.0, 80.0),), (2,))
    score = coco_map([e], coco_detections(7, [0.9], [2], [[10.0, 10.0, 60.0, 90.0]]))
    assert score["map"] == pytest.approx(1.0)


def test_no_detections_score_zero_not_a_crash():
    pytest.importorskip("pycocotools")
    e = Example(7, "7.jpg", 100, 200, ((10.0, 10.0, 50.0, 80.0),), (2,))
    assert coco_map([e], []) == {"map": 0.0, "ap50": 0.0}
