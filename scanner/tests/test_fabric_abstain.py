"""Abstain logic for the fabric head: threshold decision, confidence, risk-coverage and the
{label, confidence, unknown} answer. Small hand-checked cases; no model needed."""

import pytest

np = pytest.importorskip("numpy")

from services.vision.heads import decide  # noqa: E402
from services.vision.predictor import HeadOutput, VisionOutput, structure_answer  # noqa: E402
from training.scanner.calibration import aurc, confidences  # noqa: E402


def test_decide_abstains_strictly_below_threshold():
    classes = ["a", "b"]
    assert decide(np.array([0.6, 0.4]), classes, 0.67) is None
    out = decide(np.array([0.7, 0.3]), classes, 0.67)
    assert out.label == "a" and out.confidence == pytest.approx(0.7)


def test_aurc_matches_hand_computed_risk_coverage():
    # Kept most-confident first: error rates among kept answers are 0, 0, 1/3, 1/2.
    conf = np.array([0.9, 0.8, 0.7, 0.6])
    correct = np.array([1, 1, 0, 0], bool)
    assert aurc(conf, correct) == pytest.approx((0 + 0 + 1 / 3 + 1 / 2) / 4)


def test_maxprob_is_the_top_softmax_probability():
    logits = np.array([[2.0, 0.0, -1.0], [0.1, 0.2, 0.3]])
    scores, p = confidences(logits, 1.0)
    assert scores["maxprob"] == pytest.approx(p.max(1))
    assert scores["margin"][0] == pytest.approx(p[0, 0] - p[0, 1])


def _out(structure=None, candidates=None) -> VisionOutput:
    return VisionOutput(
        structure=structure, treatment=None, fibre_family=None, candidates=candidates or {}
    )


def test_answered_fabric_is_not_unknown():
    h = HeadOutput("satin", 0.91, [("satin", 0.91)])
    assert structure_answer(_out(structure=h)) == {
        "label": "satin",
        "confidence": 0.91,
        "unknown": False,
    }


def test_abstained_fabric_is_unknown_with_its_most_likely_class():
    cands = {"structure": [("lace", 0.41), ("tulle", 0.22)]}
    assert structure_answer(_out(candidates=cands)) == {
        "label": "lace",
        "confidence": 0.41,
        "unknown": True,
    }


def test_no_structure_head_gives_no_answer():
    assert structure_answer(_out()) is None
