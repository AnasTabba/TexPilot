"""Metrics that every reported number goes through. Skipped where numpy is absent (CI core)."""

import pytest

np = pytest.importorskip("numpy")

from training.textilenet.metrics import minority_recall, summarize, topk_accuracy  # noqa: E402

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
    assert s["weighted_f1"] == pytest.approx((2 / 3 + 0.8) / 2)
    assert s["micro_f1"] == pytest.approx(0.75)
    assert s["balanced_accuracy"] == pytest.approx(0.75)
    assert s["classes_absent"] == ["c", "d", "e", "f"]
    assert s["per_class"]["c"]["recall"] is None


def test_weighted_f1_uses_support_and_balanced_accuracy_uses_class_recall():
    y = np.array([0, 0, 0, 1])
    pred = np.array([0, 0, 1, 1])
    s = summarize(_onehot_logits(pred), y, CLASSES)
    # a: F1=.8, recall=2/3; b: F1=2/3, recall=1.
    assert s["weighted_f1"] == pytest.approx((3 * 0.8 + 2 / 3) / 4)
    assert s["micro_f1"] == pytest.approx(0.75)
    assert s["balanced_accuracy"] == pytest.approx((2 / 3 + 1) / 2)


def test_confused_pairs_are_row_normalised_and_ranked():
    y = np.array([0, 0, 0, 0, 1, 1])
    pred = np.array([2, 2, 2, 0, 0, 1])  # a->c 3/4, b->a 1/2
    s = summarize(_onehot_logits(pred), y, CLASSES)
    first, second = s["confused_pairs"][:2]
    assert (first["true"], first["pred"], first["count"], first["rate"]) == ("a", "c", 3, 0.75)
    assert (second["true"], second["pred"]) == ("b", "a")
    assert np.array(s["confusion_matrix"]).sum() == len(y)


def test_weighted_f1_and_balanced_accuracy():
    y = np.array([0, 0, 0, 1])
    pred = np.array([0, 0, 1, 1])
    s = summarize(_onehot_logits(pred), y, CLASSES)
    # a: P=1, R=2/3 -> F1=.8 (support 3) ; b: P=.5, R=1 -> F1=2/3 (support 1)
    assert s["weighted_f1"] == pytest.approx((0.8 * 3 + 2 / 3) / 4)
    assert s["balanced_accuracy"] == pytest.approx((2 / 3 + 1) / 2)  # absent classes skipped


def test_minority_recall_averages_rare_train_classes_present_in_test():
    y = np.array([0, 0, 1, 1])
    pred = np.array([0, 1, 1, 0])  # recall a=.5, b=.5
    s = summarize(_onehot_logits(pred), y, CLASSES)
    counts = {"a": 1000, "b": 5, "c": 5, "d": 1000, "e": 1000, "f": 1000}
    m = minority_recall(s, counts, share=0.01)
    assert m["classes"] == ["b", "c"]  # under 1% of 4010 train images
    assert m["mean_recall"] == pytest.approx(0.5)  # c is absent from y, so not averaged
