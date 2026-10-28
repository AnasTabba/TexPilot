"""A scan says which yarn to order only from what it read (the label's blend); counts come from the
Yarn spec measurement. Nothing is looked up from the fabric name. And it reports its timings."""

from services.consistency.engine import load_kb, yarn_advice
from services.ocr.parser import FiberPct


def test_a_fabric_name_alone_gives_no_yarn_advice_nothing_is_looked_up():
    # Yarn to buy comes from what was read (the label) or measured (the card), never a table.
    assert yarn_advice(None) == []
    assert not any(f.get("yarn") for f in load_kb()["fabrics"].values())


def test_a_cotton_rich_poly_blend_is_named_cvc_and_comes_first():
    lines = yarn_advice([FiberPct("cotton", 60.0), FiberPct("polyester", 40.0)])
    assert "CVC 60/40" in lines[0] and "label" in lines[0]


def test_a_polyester_rich_blend_is_pc_and_spandex_means_stretch():
    assert "PC 65/35" in yarn_advice([FiberPct("polyester", 65.0), FiberPct("cotton", 35.0)])[0]
    line = yarn_advice([FiberPct("cotton", 97.0), FiberPct("elastane_spandex", 3.0)])[0]
    assert "spandex" in line.lower() and "core-spun" in line


def test_the_scan_result_carries_the_advice():
    from services.api.pipeline import run_scan
    from services.vision.predictor import HeadOutput, VisionOutput

    class Predictor:
        def predict(self, _):
            return VisionOutput(HeadOutput("denim", 0.97, []), None, None)

    r = run_scan(Predictor(), b"x", "60% cotton 40% polyester")
    assert r.yarn_advice == ["Fibre (from the label): 60% cotton / 40% polyester; order CVC 60/40"]


def test_a_scan_reports_how_long_each_model_took():
    from services.api.pipeline import run_scan
    from services.vision.predictor import HeadOutput, VisionOutput

    class Predictor:
        def predict(self, _):
            timings = {"garment_detector": 412.0, "fabric_model": 180.5}
            return VisionOutput(HeadOutput("denim", 0.97, []), None, None, timings_ms=timings)

    r = run_scan(Predictor(), b"x")
    assert r.timings_ms["garment_detector"] == 412.0 and r.timings_ms["fabric_model"] == 180.5
    assert r.timings_ms["total"] >= 0
