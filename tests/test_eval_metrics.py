"""Bake-off metrics. Pure and stdlib, so they run in CI."""

import pytest

from services.ocr.parser import FiberPct
from training.scanner.eval_metrics import (
    cer,
    composition_match,
    latency,
    precision_recall,
    swap_pairs,
    type_accuracy,
)


def test_type_accuracy_counts_abstentions_as_wrong():
    assert type_accuracy(["pants", None, "dress"], ["pants", "skirt", "coat"]) == pytest.approx(
        1 / 3
    )


def test_composition_match_is_order_free_and_tolerates_rounding():
    a = [FiberPct("cotton", 60.0), FiberPct("polyester", 40.0)]
    b = [FiberPct("polyester", 40.4), FiberPct("cotton", 59.6)]
    assert composition_match(a, b)
    assert not composition_match(a, [FiberPct("cotton", 100.0)])
    assert not composition_match(None, a)


def test_character_error_rate():
    assert cer("80% PA 20% EA", "80% PA 20% EA") == 0.0
    assert cer("80% PA 20% FA", "80% PA 20% EA") == pytest.approx(1 / 13)
    assert cer("  80%  pa ", "80% PA") == 0.0  # case and spacing are not errors


def test_latency_percentiles():
    assert latency([1.0, 2.0, 3.0, 4.0]) == {"p50": 2.5, "p95": pytest.approx(3.85)}


def test_swapped_labels_only_should_flag_across_families():
    pairs = swap_pairs({"a": "cellulosic", "b": "cellulosic", "c": "synthetic"})
    own = [(g, lab, s) for g, lab, s in pairs if g == lab]
    assert all(not s for _, _, s in own) and len(own) == 3
    cross = {(g, lab): s for g, lab, s in pairs if g != lab}
    assert cross[("a", "c")] is True and ("a", "b") not in cross  # same family: not a mislabel


def test_precision_and_recall():
    assert precision_recall([True, True, False, False], [True, False, True, False]) == (0.5, 0.5)
    assert precision_recall([False, False], [True, False]) == (1.0, 0.0)  # no flags: vacuous
