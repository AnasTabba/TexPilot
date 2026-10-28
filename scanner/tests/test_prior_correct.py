"""Prior correction of a Head A trained on a resampled class mix. numpy only."""

import pytest

np = pytest.importorskip("numpy")

from training.scanner.prior_correct import choose_tau, prior_shift  # noqa: E402


def test_prior_shift_restores_the_true_class_mix_from_an_irus_mix():
    counts = np.array([900, 100, 10])
    shift = prior_shift(counts, cap=100)  # IRUS saw 100 : 100 : 10
    seen = np.log(np.array([100, 100, 10]) / 210)
    true = np.log(counts / counts.sum())
    assert np.allclose(shift, true - seen)
    assert np.allclose(prior_shift(counts, cap=0), 0)  # no resampling, nothing to undo


def test_choose_tau_picks_the_correction_that_maximises_val_macro_f1():
    # class 0 is 90% of val but the logits favour class 1: a big enough shift fixes it
    y = np.array([0] * 9 + [1])
    logits = np.tile([0.0, 0.5], (10, 1))
    logits[-1] = [0.0, 3.0]
    shift = np.array([1.0, -1.0])
    tau, scores = choose_tau(logits, y, shift, ["a", "b"])
    assert tau >= 0.25 and scores[0.0] < max(scores.values())  # ties at 0.25 go to class a
