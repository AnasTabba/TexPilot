from services.consistency.engine import evaluate
from services.ocr.parser import FiberPct
from services.vision.predictor import HeadOutput, VisionOutput


def _vision(structure: str, conf: float = 0.95, treatment=None):
    return VisionOutput(
        structure=HeadOutput(structure, conf, []),
        treatment=treatment,
        fibre_family=None,
    )


def test_flags_polyester_tweed():
    v = evaluate(_vision("tweed"), [FiberPct("polyester", 100.0)])
    assert v.outcome == "FLAG"
    assert v.flags[0].code == "COMPOSITION_IMPLAUSIBLE"


def test_passes_cotton_denim():
    v = evaluate(_vision("denim"), [FiberPct("cotton", 98.0), FiberPct("elastane_spandex", 2.0)])
    assert v.outcome == "PASS"


def test_abstains_below_confidence_threshold():
    v = evaluate(_vision("tweed", conf=0.40), [FiberPct("polyester", 100.0)])
    assert v.outcome == "INSUFFICIENT_EVIDENCE"


def test_abstains_without_a_label():
    assert evaluate(_vision("tweed"), None).outcome == "INSUFFICIENT_EVIDENCE"


def test_abstains_without_a_structure_prediction():
    blank = VisionOutput(None, None, None)
    assert evaluate(blank, [FiberPct("cotton", 100.0)]).outcome == "INSUFFICIENT_EVIDENCE"


def test_permissive_structures_never_flag():
    # Jersey is a construction, not a fibre commitment. Flagging it would be noise.
    v = evaluate(_vision("jersey"), [FiberPct("polyester", 100.0)])
    assert v.outcome == "PASS"


def test_minor_components_do_not_trigger_flags():
    # 2% elastane in a tweed jacket is normal and must not raise a flag.
    v = evaluate(_vision("tweed"), [FiberPct("wool", 98.0), FiberPct("elastane_spandex", 2.0)])
    assert v.outcome == "PASS"


def test_unexpected_treatment_is_flagged():
    v = evaluate(
        _vision("denim", treatment=HeadOutput("printed", 0.9, [])),
        [FiberPct("cotton", 100.0)],
    )
    assert v.outcome == "FLAG"
    assert any(f.code == "TREATMENT_UNEXPECTED" for f in v.flags)
