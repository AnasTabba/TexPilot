"""Choosing KB thresholds for flag precision (spec §8.3)."""

from services.consistency.engine import evaluate, load_kb
from services.ocr.parser import FiberPct
from services.vision.predictor import HeadOutput, VisionOutput
from training.scanner.tune_thresholds import choose, sweep


def _rec(conf, family, stated_family, should):
    return {"structure": None, "family": (family, conf), "stated": [stated_family],
            "should_flag": should}  # fmt: skip


def test_sweep_and_choose_lowest_threshold_meeting_precision():
    records = [
        _rec(0.95, "synthetic", "cellulosic", True),  # a confident, correct flag
        _rec(0.70, "synthetic", "cellulosic", False),  # an unsure, wrong one
        _rec(0.92, "protein", "protein", False),  # agrees: never flags
    ]
    rows = sweep(records, visual=[0.7], family=[0.6, 0.8, 0.9])
    best = choose(rows, target=0.9)
    assert best["family_min_confidence"] == 0.8
    assert best["precision"] == 1.0 and best["recall"] == 1.0


def test_no_threshold_meets_the_target():
    records = [_rec(0.95, "synthetic", "cellulosic", False)]
    assert choose(sweep(records, visual=[0.7], family=[0.9]), target=0.9) is None


def test_faux_fur_is_exempt_from_the_family_check_like_the_engine():
    kb = load_kb()
    rec = {"structure": ("faux_fur", 0.95), "family": ("protein", 0.95), "stated": ["synthetic"],
           "should_flag": False}  # fmt: skip
    [row] = sweep([rec], visual=[0.7], family=[0.9], kb_fabrics=kb["fabrics"],
                  exempt=kb["family_check_exempt"])  # fmt: skip
    vision = VisionOutput(HeadOutput("faux_fur", 0.95, []), None, HeadOutput("protein", 0.95, []))
    assert evaluate(vision, [FiberPct("polyester", 100.0)]).outcome != "FLAG"
    assert row["flags"] == 0
