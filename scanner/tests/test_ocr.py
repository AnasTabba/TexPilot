import pytest

from services.ocr.normalizer import normalize_fiber_name
from services.ocr.parser import parse_composition


def test_normalizes_supplier_shorthand():
    assert normalize_fiber_name("PES") == "polyester"
    assert normalize_fiber_name("ny") == "nylon"
    assert normalize_fiber_name("Lycra") == "elastane_spandex"
    assert normalize_fiber_name(" COTTON ") == "cotton"


def test_unknown_shorthand_is_none_not_a_guess():
    assert normalize_fiber_name("zzz") is None
    assert normalize_fiber_name("") is None


def test_parses_percent_first():
    got = parse_composition("60% COTTON 40% POLYESTER")
    assert got == [("cotton", 60.0), ("polyester", 40.0)] or [(f.name, f.pct) for f in got] == [
        ("cotton", 60.0),
        ("polyester", 40.0),
    ]


def test_parses_name_first():
    got = parse_composition("COTTON 98%  ELASTANE 2%")
    assert [(f.name, f.pct) for f in got] == [("cotton", 98.0), ("elastane_spandex", 2.0)]


def test_rejects_composition_that_does_not_sum_to_100():
    assert parse_composition("60% COTTON 20% POLYESTER") is None


def test_rejects_when_a_component_is_unrecognised():
    # Dropping the unknown would leave 100% cotton -- a confident wrong answer.
    assert parse_composition("70% COTTON 30% ZZZFIBRE") is None


def test_empty_input():
    assert parse_composition("") is None
    assert parse_composition("   ") is None


def test_pa_is_polyamide_not_acrylic():
    # ISO 2076 / EU Reg. 1007/2011: PA is polyamide (nylon); acrylic is PAN.
    assert normalize_fiber_name("PA") == "nylon"
    assert normalize_fiber_name("PAN") == "acrylic"


@pytest.mark.parametrize(
    "raw,canonical",
    [
        ("coton", "cotton"),
        ("baumwolle", "cotton"),
        ("algodón", "cotton"),
        ("cotone", "cotton"),
        ("katoen", "cotton"),
        ("poliéster", "polyester"),
        ("poliestere", "polyester"),
        ("élasthanne", "elastane_spandex"),
        ("elastano", "elastane_spandex"),
        ("elasthan", "elastane_spandex"),
        ("laine", "wool"),
        ("wolle", "wool"),
        ("lana", "wool"),
        ("soie", "silk"),
        ("seide", "silk"),
        ("seta", "silk"),
        ("seda", "silk"),
        ("leinen", "flax_linen"),
        ("lino", "flax_linen"),
        ("linho", "flax_linen"),
        ("viscosa", "viscose_rayon"),
        ("viskose", "viscose_rayon"),
        ("poliamida", "nylon"),
        ("poliammide", "nylon"),
        ("polyamid", "nylon"),
        ("acrílico", "acrylic"),
        ("acrylique", "acrylic"),
        ("polyacryl", "acrylic"),
    ],
)
def test_common_label_languages(raw, canonical):
    assert normalize_fiber_name(raw) == canonical


def test_accented_labels_parse():
    got = parse_composition("60% ALGODÓN 40% POLIÉSTER")
    assert [(f.name, f.pct) for f in got] == [("cotton", 60.0), ("polyester", 40.0)]


def test_trailing_words_after_a_fibre_are_ignored():
    got = parse_composition("100% COTTON MADE IN PAKISTAN")
    assert [(f.name, f.pct) for f in got] == [("cotton", 100.0)]


def test_leading_qualifiers_are_ignored():
    got = parse_composition("70% RECYCLED POLYESTER 30% ORGANIC COTTON")
    assert [(f.name, f.pct) for f in got] == [("polyester", 70.0), ("cotton", 30.0)]


def test_an_unknown_fibre_still_fails_the_whole_parse():
    assert parse_composition("70% ZZZFIBRE COTTON 30% COTTON") is None


@pytest.mark.parametrize("text", ["100% POLY COTTON", "100% WOOL SILK", "100% CO POLYESTER"])
def test_a_second_fibre_in_one_component_is_not_dropped(text):
    # Final review, Important #1: the trailing-word rule turned "100% POLY COTTON" (a blend)
    # into 100% polyester. A dropped word that itself names a fibre means we do not know
    # the split, so the parse must fail rather than guess.
    assert parse_composition(text) is None
