"""From OCR lines to one trustworthy composition (spec §5.3). Mostly stdlib."""

import pytest

from services.ocr.engines.base import TextLine
from services.ocr.extract import extract, reading_order


def L(text, row, x=0.0, conf=0.9):  # one OCR line on "row" (10 px rows)
    return TextLine(text, conf, (x, row * 10.0, x + 100.0, row * 10.0 + 8.0))


def fibres(ex):
    return [(f.name, f.pct) for f in ex.fibers] if ex.fibers else None


def test_single_line_label():
    ex = extract([L("60% COTTON 40% POLYESTER", 0)])
    assert fibres(ex) == [("cotton", 60.0), ("polyester", 40.0)] and ex.section is None


def test_composition_split_over_two_lines():
    assert fibres(extract([L("60% COTTON", 0), L("40% POLYESTER", 1)])) == [
        ("cotton", 60.0),
        ("polyester", 40.0),
    ]


def test_shell_is_reported_even_when_lining_comes_first():
    ex = extract([L("LINING: 100% PES", 0), L("SHELL: 80% PA 20% EA", 1)])
    assert fibres(ex) == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.section == "shell"


def test_only_a_lining_composition_is_unreadable_not_a_guess():
    ex = extract([L("LINING: 100% POLYESTER", 0)])
    assert ex.fibers is None and ex.reason == "UNREADABLE"


def test_multilingual_repeats_agree_and_raise_confidence():
    ex = extract(
        [
            L("80% POLYAMIDE 20% ELASTANE", 0),
            L("80% POLIAMIDA 20% ELASTANO", 1),
            L("80% POLYAMID 20% ELASTHAN", 2),
        ]
    )
    assert fibres(ex) == [("nylon", 80.0), ("elastane_spandex", 20.0)]
    assert ex.confidence > 0.9


def test_disagreeing_compositions_are_unreadable():
    ex = extract([L("100% COTTON", 0), L("100% POLYESTER", 3)])
    assert ex.fibers is None and ex.reason == "UNREADABLE"


def test_text_without_composition_is_no_label_text():
    ex = extract([L("MADE IN PAKISTAN", 0), L("MACHINE WASH 30", 1)])
    assert ex.fibers is None and ex.reason == "NO_LABEL_TEXT"
    assert extract([]).reason == "NO_LABEL_TEXT"


def test_reading_order_rows_then_columns():
    lines = [L("B", 1, x=0), L("A2", 0, x=120), L("A1", 0, x=0)]
    assert [line.text for line in reading_order(lines)] == ["A1", "A2", "B"]


def test_sideways_label_is_read_after_rotation():
    np = pytest.importorskip("numpy")
    from services.ocr.extract import read_composition

    class SidewaysOnly:  # sees text only when the 20x40 image is turned to 40x20
        name = "fake"

        def read(self, image):
            return [L("100% COTTON", 0)] if image.shape[:2] == (40, 20) else []

    ex = read_composition(SidewaysOnly(), np.zeros((20, 40, 3), np.uint8))
    assert fibres(ex) == [("cotton", 100.0)]
