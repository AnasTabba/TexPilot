"""Calibration maths (spec §6.3). Skipped without numpy."""

import pytest

np = pytest.importorskip("numpy")

from training.scanner.calibration import abstain_threshold, ece, fit_temperature  # noqa: E402


def test_temperature_recovers_known_overconfidence():
    rng = np.random.default_rng(0)
    true = rng.normal(size=(4000, 5)) * 2
    p = np.exp(true) / np.exp(true).sum(1, keepdims=True)
    y = np.array([rng.choice(5, p=row) for row in p])
    assert fit_temperature(3.0 * true, y) == pytest.approx(3.0, rel=0.1)


def test_ece_is_small_when_calibrated_and_large_when_not():
    rng = np.random.default_rng(1)
    conf = rng.uniform(0.5, 1.0, 20000)
    correct = rng.uniform(size=conf.size) < conf
    probs = np.stack([conf, 1 - conf], 1)
    y = np.where(correct, 0, 1)
    assert ece(probs, y) < 0.02
    assert ece(probs, np.ones_like(y)) > 0.4


@pytest.mark.parametrize(
    "target,expected",
    [(0.75, (0.6, 1.0)), (0.9, (0.8, 0.5))],
)
def test_threshold_is_the_lowest_that_meets_the_target(target, expected):
    conf = np.array([0.9, 0.8, 0.7, 0.6])
    correct = np.array([1, 1, 0, 1], bool)
    assert abstain_threshold(conf, correct, target) == pytest.approx(expected)


def test_tied_confidences_are_kept_together():
    # Cutting between the two 0.8s would promise accuracy the threshold cannot deliver.
    conf = np.array([0.9, 0.8, 0.8])
    correct = np.array([1, 1, 0], bool)
    assert abstain_threshold(conf, correct, 0.9) == pytest.approx((0.9, 1 / 3))


def test_unreachable_target_abstains_on_everything():
    tau, coverage = abstain_threshold(np.array([0.9, 0.8]), np.array([0, 0], bool), 0.9)
    assert tau > 1.0 and coverage == 0.0
