"""One real RT-DETRv2 training epoch on synthetic photos, then detector B loads the result.
`pytest -m slow`. Downloads the 172 MB base model once; runs on the CPU in about a minute."""

import json

import pytest

pytestmark = pytest.mark.slow


def _photos(root, ids, split):
    from PIL import Image, ImageDraw

    images, annotations = [], []
    for n, i in enumerate(ids):
        img = Image.new("RGB", (160, 200), "white")
        ImageDraw.Draw(img).rectangle((40, 30, 120, 170), fill=(40, 60, 150))
        img.save(root / "images" / f"{i}.jpg")
        images.append({"id": i, "file_name": f"{i}.jpg", "width": 160, "height": 200})
        annotations.append({"id": n + 1, "image_id": i, "category_id": 6,
                            "bbox": [40, 30, 80, 140], "area": 11200, "iscrowd": 0})  # fmt: skip
    data = {"images": images, "annotations": annotations,
            "categories": [{"id": 6, "name": "pants"}, {"id": 23, "name": "shoe"}]}  # fmt: skip
    (root / "annotations" / f"instances_attributes_{split}2020.json").write_text(json.dumps(data))


def test_a_training_epoch_saves_a_checkpoint_detector_b_can_serve(tmp_path, monkeypatch):
    import numpy as np

    import training.detector.train_rtdetr as tr
    from services.vision.detectors.rtdetr import RtDetrDetector
    from services.vision.garment import GARMENT_VOCAB
    from training.detector.fashionpedia import Example, holdout

    data = tmp_path / "fashionpedia"
    (data / "images").mkdir(parents=True)
    (data / "annotations").mkdir()
    candidates = [Example(i, "", 0, 0, (), ()) for i in range(1, 200)]
    train, held = holdout(candidates, 0.5)
    _photos(data, [e.image_id for e in train[:3]] + [e.image_id for e in held[:2]], "train")
    _photos(data, [1001, 1002], "val")

    scored = []

    def fake_map(examples, detections):  # pycocotools lives on the GPU box
        for d in detections:
            assert set(d) == {"image_id", "category_id", "bbox", "score"} and len(d["bbox"]) == 4
        scored.append((len(examples), len(detections)))
        return {"map": 0.0, "ap50": 0.0}

    monkeypatch.setattr(tr, "coco_map", fake_map)
    out = tmp_path / "run"
    args = ["--data", str(data), "--out", str(out), "--epochs", "1", "--batch-size", "2",
            "--workers", "0", "--device", "cpu", "--holdout-frac", "0.5"]  # fmt: skip
    assert tr.main(args) == 0
    assert [n for n, _ in scored] == [2, 2]  # the hold-out after the epoch, then val once
    metrics = json.loads((out / "metrics.json").read_text())
    assert metrics["n"] == {"train": 3, "holdout": 2, "test_val2020": 2}

    det = RtDetrDetector("cpu", checkpoint=out / "best")
    assert det.model.config.id2label[6] == "pants"
    found = det.detect(np.full((200, 160, 3), 255, dtype=np.uint8))
    assert all(d.label in GARMENT_VOCAB and 0.0 <= d.score <= 1.0 for d in found)
