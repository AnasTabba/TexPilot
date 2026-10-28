"""Choosing KB thresholds for flag precision (spec §8.3)."""

from services.consistency.engine import evaluate, load_kb
from services.ocr.parser import FiberPct
from services.vision.predictor import HeadOutput, VisionOutput
from training.scanner.tune_thresholds import choose, evidence_grid, sweep


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


def test_grid_starts_at_the_lowest_confidence_the_data_shows():
    # Heads abstain below their own threshold, so every grid value under the lowest
    # observed confidence flags the same pairs; choosing one would claim untested ground.
    assert evidence_grid([0.934, 0.97], [0.5, 0.9, 0.95], current=0.9) == [0.93, 0.95]
    assert evidence_grid([], [0.5, 0.9], current=0.7) == [0.7]  # no evidence: keep kb value


def test_the_sweep_flags_exactly_what_the_engine_flags():
    # The sweep re-implements engine.evaluate's rules so it can try thresholds without
    # rewriting kb.yaml; this pins the two together across every rule and both sides of
    # every threshold.
    import itertools

    kb, tol = load_kb(), load_kb()["tolerance"]
    fibre = {"cellulosic": "cotton", "protein": "wool", "synthetic": "polyester"}
    structures = [None] + [(f, c) for f in ("denim", "tweed", "faux_fur", "lace", "nope")
                           for c in (0.6, 0.95)]  # fmt: skip
    treatments = [None] + [(t, c) for t in ("yarn_dyed", "printed") for c in (0.6, 0.95)]
    families = [None] + [(f, c) for f in fibre for c in (0.85, 0.95)]
    for s, t, f, stated in itertools.product(structures, treatments, families, fibre):
        rec = {"structure": s, "treatment": t, "family": f, "stated": [stated],
               "should_flag": False}  # fmt: skip
        [row] = sweep([rec], [tol["min_visual_confidence"]], [tol["family_min_confidence"]],
                      kb_fabrics=kb["fabrics"], exempt=kb["family_check_exempt"])  # fmt: skip
        vision = VisionOutput(*(HeadOutput(x[0], x[1], []) if x else None for x in (s, t, f)))
        engine = evaluate(vision, [FiberPct(fibre[stated], 100.0)]).outcome == "FLAG"
        assert (row["flags"] == 1) == engine, (s, t, f, stated)
