"""Pattern labels match whole-photo serving and never invent labels from missing attributes."""
from training.scanner.pattern_data import fashion_rows, pattern_label, product_split, title_pattern

ATTRS = [
    {'id': 317, 'name': 'plain (pattern)', 'supercategory': 'textile pattern'},
    {'id': 325, 'name': 'floral', 'supercategory': 'textile pattern'},
    {'id': 328, 'name': 'stripe', 'supercategory': 'textile pattern'},
    {'id': 333, 'name': 'leopard', 'supercategory': 'animal'},
    {'id': 340, 'name': 'plant', 'supercategory': 'textile pattern'},
    {'id': 999, 'name': 'unmapped motif', 'supercategory': 'textile pattern'},
]


def test_whole_photo_keeps_one_nonplain_motif_and_excludes_mixed_patterns():
    assert pattern_label([317, 325], ATTRS) == 'floral'
    assert pattern_label([325, 328], ATTRS) is None
    assert pattern_label([325, 340], ATTRS) == 'floral'
    assert pattern_label([333], ATTRS) == 'animal'


def test_missing_or_unknown_pattern_is_not_solid():
    assert pattern_label([], ATTRS) is None
    assert pattern_label([317], ATTRS) == 'solid'
    assert pattern_label([317, 999], ATTRS) is None


def test_fashion_split_is_image_level_and_original_val_is_held_out():
    doc = {'attributes': ATTRS,
           'images': [{'id': 1, 'file_name': 'one.jpg'}, {'id': 2, 'file_name': 'two.jpg'}],
           'annotations': [{'image_id': 1, 'attribute_ids': [325]},
                           {'image_id': 2, 'attribute_ids': [317]}]}
    rows = fashion_rows(doc, official_split='train')
    assert len(rows) == 2 and len({r['group'] for r in rows}) == 2
    assert rows == fashion_rows(doc, official_split='train')
    assert {r['split'] for r in fashion_rows(doc, official_split='val')} == {'official_test'}


def test_shop_titles_require_an_explicit_unambiguous_pattern_and_product_split():
    assert title_pattern('Yarn dyed striped shirt') == 'stripe'
    assert title_pattern('Plain cotton pants') == 'solid'
    assert title_pattern('Printed lawn suit') is None
    assert title_pattern('Floral and striped suit') is None
    assert title_pattern('Leopard print shirt') == 'animal'
    assert product_split('store', 'product1') == product_split('store', 'product1')
