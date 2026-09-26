"""Metrics that every reported number goes through. Skipped where numpy is absent (CI core)."""

import pytest

np = pytest.importorskip("numpy")

from training.textilenet.metrics import summarize, topk_accuracy  # noqa: E402

CLASSES = ["a", "b", "c", "d", "e", "f"]


def _onehot_logits(preds, n=6):
    logits = np.zeros((len(preds), n))
    logits[np.arange(len(preds)), preds] = 1.0
    return logits


def test_top1_and_top5():
    logits = np.array([[5, 4, 3, 2, 1, 0], [5, 4, 3, 2, 1, 0], [5, 4, 3, 2, 1, 0]], float)
    y = np.array([0, 4, 5])
    assert topk_accuracy(logits, y, 1) == pytest.approx(1 / 3)
    assert topk_accuracy(logits, y, 5) == pytest.approx(2 / 3)


def test_macro_f1_matches_hand_computation():
    y = np.array([0, 0, 1, 1])
    pred = np.array([0, 1, 1, 1])
    s = summarize(_onehot_logits(pred), y, CLASSES)
    # class a: P=1, R=.5 -> F1=2/3 ; class b: P=2/3, R=1 -> F1=.8 ; others absent
    assert s["macro_f1"] == pytest.approx((2 / 3 + 0.8) / 2)
    assert s["classes_absent"] == ["c", "d", "e", "f"]
    assert s["per_class"]["c"]["recall"] is None


def test_confused_pairs_are_row_normalised_and_ranked():
    y = np.array([0, 0, 0, 0, 1, 1])
    pred = np.array([2, 2, 2, 0, 0, 1])  # a->c 3/4, b->a 1/2
    s = summarize(_onehot_logits(pred), y, CLASSES)
    first, second = s["confused_pairs"][:2]
    assert (first["true"], first["pred"], first["count"], first["rate"]) == ("a", "c", 3, 0.75)
    assert (second["true"], second["pred"]) == ("b", "a")
    assert np.array(s["confusion_matrix"]).sum() == len(y)
