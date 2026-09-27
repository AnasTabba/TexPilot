from services.consistency.engine import evaluate, load_kb
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


def _family(label, conf=0.95, structure=None):
    return VisionOutput(
        structure=structure, treatment=None, fibre_family=HeadOutput(label, conf, [])
    )


def test_confident_family_mismatch_flags_even_without_a_structure():
    v = evaluate(_family("synthetic"), [FiberPct("cotton", 100.0)])
    assert v.outcome == "FLAG"
    assert [f.code for f in v.flags] == ["FAMILY_MISMATCH"]
    assert v.flags[0].severity == "medium"
    assert "cellulosic" in v.flags[0].message and "synthetic" in v.flags[0].message


def test_unsure_family_does_not_flag():
    v = evaluate(_family("synthetic", conf=0.6), [FiberPct("cotton", 100.0)])
    assert v.outcome == "INSUFFICIENT_EVIDENCE"


def test_blend_label_that_includes_the_family_does_not_flag():
    v = evaluate(_family("synthetic"), [FiberPct("cotton", 60.0), FiberPct("polyester", 40.0)])
    assert v.outcome == "INSUFFICIENT_EVIDENCE" and not v.flags


def test_family_agreement_with_a_checked_structure_passes():
    v = evaluate(
        _family("cellulosic", structure=HeadOutput("denim", 0.95, [])), [FiberPct("cotton", 100.0)]
    )
    assert v.outcome == "PASS"


def test_structure_and_family_can_both_flag():
    v = evaluate(
        _family("synthetic", structure=HeadOutput("tweed", 0.95, [])), [FiberPct("cotton", 100.0)]
    )
    assert {f.code for f in v.flags} == {"COMPOSITION_IMPLAUSIBLE", "FAMILY_MISMATCH"}


def test_kb_has_a_family_threshold_and_imitation_exemptions():
    kb = load_kb()
    assert kb["version"] == 3 and 0.5 < kb["tolerance"]["family_min_confidence"] <= 1.0
    assert set(kb["family_check_exempt"]) <= set(kb["fabrics"])


def test_faux_fur_that_looks_like_fur_is_not_a_family_mismatch():
    # Final review (re-graded to Important): Head C learned real fur, leather and suede as
    # protein, so a faux-fur coat correctly labelled 100% acrylic read as "protein" would
    # raise a false FAMILY_MISMATCH. Imitation materials are exempt from the family check.
    v = evaluate(
        _family("protein", structure=HeadOutput("faux_fur", 0.95, [])), [FiberPct("acrylic", 100.0)]
    )
    assert v.outcome == "PASS" and not v.flags


def test_a_real_family_mismatch_still_flags_on_ordinary_fabrics():
    v = evaluate(
        _family("protein", structure=HeadOutput("jersey", 0.95, [])), [FiberPct("acrylic", 100.0)]
    )
    assert [f.code for f in v.flags] == ["FAMILY_MISMATCH"]
