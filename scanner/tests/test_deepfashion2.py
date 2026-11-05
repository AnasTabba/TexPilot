import json

import pytest

from training.textilenet.deepfashion2 import Item, positive_pairs, read_items


def item(path, source, style=1, category=1, split="train", pair_id=7):
    return Item(path, "item1", split, source, pair_id, style, category, (0, 0, 10, 10))


def test_positive_pairs_require_same_split_identity_style_and_category():
    rows = [
        item("shop.jpg", "shop"),
        item("user.jpg", "user"),
        item("unknown.jpg", "user", style=0),
        item("different.jpg", "user", style=2),
        item("skirt.jpg", "user", category=9),
        item("val.jpg", "user", split="validation"),
        item("other.jpg", "user", pair_id=8),
    ]
    pairs = list(positive_pairs(rows))
    assert [(shop.path, user.path) for shop, user in pairs] == [("shop.jpg", "user.jpg")]


def test_product_group_keeps_all_styles_and_categories_together():
    a = item("a.jpg", "shop")
    b = item("b.jpg", "user", style=2, category=9)
    assert a.group_id == b.group_id
    assert a.identity != b.identity


def test_does_not_pair_items_within_same_image():
    assert not list(positive_pairs([item("a.jpg", "shop"), item("a.jpg", "user")]))


def test_unknown_product_id_never_creates_a_positive_pair():
    assert not list(
        positive_pairs(
            [
                item("shop.jpg", "shop", pair_id=0),
                item("user.jpg", "user", pair_id=0),
            ]
        )
    )


def test_read_items_preserves_official_annotations(tmp_path):
    folder = tmp_path / "train/annos"
    folder.mkdir(parents=True)
    (tmp_path / "train/image").mkdir()
    (tmp_path / "train/image/000001.jpg").write_bytes(b"image")
    (folder / "000001.json").write_text(
        json.dumps(
            {
                "source": "user",
                "pair_id": 7,
                "item1": {"category_id": 1, "style": 1, "bounding_box": [0, 0, 10, 10]},
            }
        )
    )
    rows = list(read_items(tmp_path, "train"))
    assert rows == [item("train/image/000001.jpg", "user")]


def test_unlocalized_unknown_style_is_preserved_but_cannot_form_a_pair(tmp_path):
    folder = tmp_path / "train/annos"
    folder.mkdir(parents=True)
    (tmp_path / "train/image").mkdir()
    (tmp_path / "train/image/000001.jpg").write_bytes(b"image")
    (folder / "000001.json").write_text(
        json.dumps(
            {
                "source": "user",
                "pair_id": 7,
                "item1": {"category_id": 1, "style": 0, "bounding_box": [0, 0, 0, 0]},
            }
        )
    )
    rows = list(read_items(tmp_path, "train"))
    assert rows[0].bbox == (0, 0, 0, 0)
    assert not list(positive_pairs(rows + [item("shop.jpg", "shop")]))


def test_missing_image_fails_instead_of_silently_shrinking_manifest(tmp_path):
    folder = tmp_path / "train/annos"
    folder.mkdir(parents=True)
    (folder / "000001.json").write_text(json.dumps({"source": "user", "pair_id": 7}))
    with pytest.raises(ValueError, match="missing image"):
        list(read_items(tmp_path, "train"))
