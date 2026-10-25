"""A scan says which yarn to order: the typical yarn for the fabric the scanner named
(kb.yaml), and the blend when a label states one. Never guessed from an abstention."""

from services.consistency.engine import load_kb, yarn_advice
from services.ocr.parser import FiberPct


def test_every_fabric_the_scanner_names_has_typical_yarn():
    fabrics = load_kb()["fabrics"]
    assert all(f.get("yarn") for f in fabrics.values()), [
        k for k, f in fabrics.items() if not f.get("yarn")
    ]


def test_denim_gets_its_warp_and_weft_counts():
    lines = yarn_advice("denim", None)
    assert any("Warp" in x and "Ne" in x for x in lines) and any("Weft" in x for x in lines)


def test_no_fabric_and_no_label_means_no_advice():
    assert yarn_advice(None, None) == []


def test_a_cotton_rich_poly_blend_is_named_cvc_and_comes_first():
    lines = yarn_advice("jersey", [FiberPct("cotton", 60.0), FiberPct("polyester", 40.0)])
    assert "CVC 60/40" in lines[0] and "label" in lines[0]


def test_a_polyester_rich_blend_is_pc_and_spandex_means_stretch():
    assert (
        "PC 65/35" in yarn_advice(None, [FiberPct("polyester", 65.0), FiberPct("cotton", 35.0)])[0]
    )
    line = yarn_advice(None, [FiberPct("cotton", 97.0), FiberPct("elastane_spandex", 3.0)])[0]
    assert "spandex" in line.lower() and "core-spun" in line


def test_the_scan_result_carries_the_advice():
    from services.api.pipeline import run_scan
    from services.vision.predictor import HeadOutput, VisionOutput

    class Predictor:
        def predict(self, _):
            return VisionOutput(HeadOutput("denim", 0.97, []), None, None)

    r = run_scan(Predictor(), b"x")
    assert r.yarn_advice == yarn_advice("denim", None) and r.yarn_advice
