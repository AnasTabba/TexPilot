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
