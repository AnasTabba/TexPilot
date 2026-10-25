"""Per-class logit bias tuned on val for macro F1: a rare class the head under-predicts gets
its share back. Val only; the test set is never used to tune."""

import numpy as np
import pytest

pytest.importorskip("sklearn")
from training.scanner.export_head_a import macro_f1, tune_class_bias  # noqa: E402


def test_bias_tuning_recovers_an_under_predicted_class():
    rng = np.random.default_rng(0)
    y = np.repeat([0, 1, 2], [400, 400, 60])  # class 2 is rare
    logits = rng.normal(0, 1, (len(y), 3))
    logits[np.arange(len(y)), y] += 2.0
    logits[:, 2] -= 2.5  # the head almost never says class 2
    bias = tune_class_bias(logits, y, 3)
    assert macro_f1(logits + bias, y, 3) > macro_f1(logits, y, 3) + 0.1
    assert bias[2] > 0 and np.isclose(bias.mean(), 0)  # centred: only differences matter
