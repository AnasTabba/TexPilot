"""The fault stage: scanner wiring with fakes, and FaultDetector with a stub network."""

import base64
import io
import json
import sys
import types

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.fault import FaultDetector  # noqa: E402
from services.vision.garment import Detection  # noqa: E402
from services.vision.predictor import (  # noqa: E402
    FaultOutput,
    FaultRegion,
    HeadOutput,
    VisionOutput,
)
from services.vision.scanner import ScannerPredictor, build_scanner  # noqa: E402


def _jpeg(w=200, h=100):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "gray").save(buf, format="JPEG")
    return buf.getvalue()


class Det:
    name, default_min_score = "fake", 0.3

    def detect(self, image):
        return [Detection("pants", 0.8, (50, 10, 150, 90))]


class Seg:
    def segment(self, image, box):
        m = np.zeros(image.shape[:2], bool)
        m[10:90, 50:150] = True
        return m


class Crop:
    def views(self, image, mask):
        return [image[:10, :10]]


class Heads:
    def predict(self, views):
        return VisionOutput(HeadOutput("denim", 0.9, []), None, None)


class FakeFault:
    """Duck-typed stand-in for FaultDetector.detect."""

    def __init__(self, out=None, error=None):
        self.out, self.error, self.calls = out, error, []

    def detect(self, image, box):
        self.calls.append(box)
        if self.error:
            raise self.error
        return self.out


def _scanner(fault=None):
    return ScannerPredictor(Det(), Seg(), Crop(), Heads(), fault=fault)


def test_no_fault_stage_leaves_output_unchanged():
    out = _scanner().predict(_jpeg())
    assert out.fault is None
    assert "fault_model" not in out.timings_ms
    assert out.notes == ()


def test_fault_stage_result_and_timing_are_reported():
    fault = FakeFault(FaultOutput(0.9, True, 0.5, (), None, "v1"))
    out = _scanner(fault).predict(_jpeg())
    assert out.fault.is_fault
    assert "fault_model" in out.timings_ms
    assert fault.calls == [(50 / 200, 10 / 100, 150 / 200, 90 / 100)]  # the garment box


def test_failing_fault_detector_abstains_with_a_note():
    out = _scanner(FakeFault(error=RuntimeError("boom"))).predict(_jpeg())
    assert out.fault is None
    assert out.structure.label == "denim"  # the rest of the scan is untouched
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED"]
    assert out.notes[0].message == "fault detector failed: RuntimeError"


def test_missing_fault_folder_is_a_clear_file_not_found(tmp_path, monkeypatch):
    import services.vision.crop as crop
    import services.vision.detectors as detectors
    import services.vision.heads as heads

    monkeypatch.setattr(detectors, "load_detector", lambda name, device: Det())
    monkeypatch.setattr(heads, "LinearHeads", lambda bundle, device: Heads())
    monkeypatch.setattr(crop, "FabricCropper", lambda patches: Crop())
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "bundle.json").write_text(json.dumps({"views": "whole"}))
    with pytest.raises(FileNotFoundError, match="fault model folder not found"):
        build_scanner(bundle, "fake", "cpu", fault_dir=tmp_path / "nope")


def _model_dir(tmp_path, thresholds=None):
    d = tmp_path / "fault"
    d.mkdir(parents=True)
    cfg = {
        "backbone": "vit_s",
        "image_size": 392,
        "thresholds": thresholds or {"default": 0.5},
        "version": "test-1",
    }
    (d / "config.json").write_text(json.dumps(cfg))
    (d / "weights.pt").write_bytes(b"x")
    return d


class StubDetector(FaultDetector):
    """Network replaced by a function of the tile: anomaly = red channel / 255."""

    def __init__(self, model_dir, score_fn=None):
        super().__init__(model_dir, "cpu")
        self.tile_shapes = []
        self.score_fn = score_fn or (lambda t: t[:, :, 0].astype(np.float32) / 255.0)

    def _load_model(self):
        return None

    def _score_tiles(self, tiles):
        self.tile_shapes += [t.shape[:2] for t in tiles]
        return [self.score_fn(t) for t in tiles]


def _hot_square_image(h=300, w=400):
    img = np.full((h, w, 3), 30, np.uint8)
    img[100:160, 200:260] = 255  # the synthetic defect: x 200-260, y 100-160
    return img


def test_missing_config_or_weights_raises_file_not_found(tmp_path):
    d = _model_dir(tmp_path)
    (d / "weights.pt").unlink()
    with pytest.raises(FileNotFoundError, match="weights.pt"):
        StubDetector(d)


def test_threshold_is_default_key_else_max(tmp_path):
    assert StubDetector(_model_dir(tmp_path / "a", {"default": 0.4, "a": 0.9})).threshold == 0.4
    d = _model_dir(tmp_path / "b", {"a": 0.3, "b": 0.7})
    assert StubDetector(d).threshold == 0.7


def test_small_box_is_skipped_with_a_reason(tmp_path):
    det = StubDetector(_model_dir(tmp_path))
    out = det.detect(_hot_square_image(), (0.0, 0.0, 0.3, 0.3))  # 9 % of the image
    assert out.skipped_reason == "garment too small for a close-up fault check"
    assert (out.score, out.is_fault, out.regions, out.heatmap_png_b64) == (0, False, (), None)
    assert det.tile_shapes == []  # the network never ran


def test_fabric_unlike_the_trained_ones_is_judged_against_its_own_level(tmp_path):
    d = _model_dir(tmp_path)
    cfg = json.loads((d / "config.json").read_text())
    (d / "config.json").write_text(json.dumps(cfg | {"max_map_median": 0.2, "relative_z": 7.5}))
    rng = np.random.default_rng(0)
    plain = np.full((300, 400, 3), 120, np.uint8)  # whole map raised (0.47), above the 0.5 gate's
    plain[:, :, 0] = rng.integers(115, 126, (300, 400))  # fixed threshold for none of it: no fault
    out = StubDetector(d).detect(plain, None)
    assert out.skipped_reason is None and not out.is_fault and out.heatmap_png_b64
    spot = plain.copy()
    spot[100:160, 200:260, 0] = 255  # one hot square on the same raised fabric: a fault, located
    out = StubDetector(d).detect(spot, None)
    assert out.is_fault and len(out.regions) == 1
    assert out.regions[0].box == pytest.approx((0.5, 1 / 3, 0.65, 160 / 300), abs=0.01)


def test_region_boxes_land_on_the_hot_square(tmp_path):
    out = StubDetector(_model_dir(tmp_path)).detect(_hot_square_image(), None)
    assert out.is_fault and out.skipped_reason is None
    assert out.score == pytest.approx(1.0)
    assert len(out.regions) == 1
    region = out.regions[0]
    assert isinstance(region, FaultRegion) and region.type is None
    x0, y0, x1, y1 = region.box
    assert (x0, y0, x1, y1) == pytest.approx((200 / 400, 100 / 300, 260 / 400, 160 / 300), abs=0.01)


def test_crop_to_box_maps_regions_back_to_the_full_image(tmp_path):
    det = StubDetector(_model_dir(tmp_path))
    out = det.detect(_hot_square_image(), (0.5, 0.0, 1.0, 1.0))  # right half
    assert max(w for _, w in det.tile_shapes) <= 200  # only the crop was scored
    x0, y0, x1, y1 = out.regions[0].box
    assert (x0, y0, x1, y1) == pytest.approx((200 / 400, 100 / 300, 260 / 400, 160 / 300), abs=0.01)


def test_at_most_six_tiles_even_for_a_tall_crop(tmp_path):
    det = StubDetector(_model_dir(tmp_path))
    det.detect(np.full((3000, 400, 3), 30, np.uint8), None)
    assert 1 <= len(det.tile_shapes) <= 6
    assert all(h <= 392 and w <= 392 for h, w in det.tile_shapes)


def test_heatmap_is_a_png_no_larger_than_512(tmp_path):
    out = StubDetector(_model_dir(tmp_path)).detect(_hot_square_image(), None)
    raw = base64.b64decode(out.heatmap_png_b64)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    im = Image.open(io.BytesIO(raw))
    assert im.format == "PNG" and max(im.size) <= 512


def _write_cfg(d, cfg):
    (d / "config.json").write_text(json.dumps(cfg))


def _selfref_dir(tmp_path):
    """A selfref fault folder: encoder file present, no weights.pt, no backbone key."""
    d = tmp_path / "fault-sr"
    (d / "encoders").mkdir(parents=True)
    (d / "encoders" / "dinov2.pt").write_bytes(b"x")
    _write_cfg(
        d,
        {
            "method": "selfref",
            "encoder_file": "encoders/dinov2.pt",
            "params": {"layers": [5, 8, 11], "k": 3},
            "image_size": 392,
            "thresholds": {"default": 0.5},
            "version": "sr-1",
        },
    )
    return d


@pytest.fixture
def fake_selfref(monkeypatch):
    """Replace training.fault.methods.selfref; returns the list of constructed instances."""
    made = []

    class SelfReference:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.tile_shapes = []
            made.append(self)

        def fit(self, train):
            pass

        def score_tiles(self, tiles):
            self.tile_shapes += [(t.shape, t.dtype) for t in tiles]
            maps = []
            for _ in tiles:
                m = np.full((392, 392), 0.1, np.float32)
                m[100:160, 200:260] = 0.9  # the hot square, in tile pixels
                maps.append(m)
            return maps

    mod = types.ModuleType("training.fault.methods.selfref")
    mod.SelfReference = SelfReference
    monkeypatch.setitem(sys.modules, "training.fault.methods.selfref", mod)
    return made


def test_config_without_method_takes_the_dinomaly_path(tmp_path, monkeypatch):
    seen = {}

    class Dinomaly:
        def __init__(self, repo, backbone, device):
            seen.update(repo=repo, backbone=backbone, device=device)

        def load(self, path):
            seen["weights"] = path

        def score_tiles(self, tiles):
            return [np.zeros(t.shape[:2], np.float32) for t in tiles]

    mod = types.ModuleType("training.fault.methods.dinomaly")
    mod.Dinomaly = Dinomaly
    monkeypatch.setitem(sys.modules, "training.fault.methods.dinomaly", mod)
    d = _model_dir(tmp_path)
    det = FaultDetector(d, "cpu")
    assert det.method == "dinomaly"
    assert seen == {
        "repo": str(d / "Dinomaly"),
        "backbone": "vit_s",
        "device": "cpu",
        "weights": d / "weights.pt",
    }


def test_selfref_needs_no_weights_and_forwards_params(tmp_path, fake_selfref):
    d = _selfref_dir(tmp_path)
    det = FaultDetector(d, "cpu")
    assert det.backbone == "dinov2reg_vit_base_14"  # optional for selfref
    (sr,) = fake_selfref
    assert sr.kwargs["encoder_file"] == str(d / "encoders" / "dinov2.pt")
    assert sr.kwargs["device"] == "cpu"
    assert sr.kwargs["layers"] == (5, 8, 11) and isinstance(sr.kwargs["layers"], tuple)
    assert sr.kwargs["k"] == 3
    out = det.detect(_hot_square_image(), None)
    assert np.isfinite(out.score) and out.is_fault
    assert out.heatmap_png_b64
    assert out.regions


def test_selfref_non_392_tiles_are_resized_in_and_map_back(tmp_path, fake_selfref):
    det = FaultDetector(_selfref_dir(tmp_path), "cpu")
    out = det.detect(np.full((300, 500, 3), 30, np.uint8), None)
    (sr,) = fake_selfref
    assert sr.tile_shapes
    assert all(shape == (392, 392, 3) and dt == np.uint8 for shape, dt in sr.tile_shapes)
    assert np.isfinite(out.score) and out.heatmap_png_b64


def test_selfref_missing_encoder_file_is_a_clear_file_not_found(tmp_path, fake_selfref):
    d = _selfref_dir(tmp_path)
    (d / "encoders" / "dinov2.pt").unlink()
    with pytest.raises(FileNotFoundError, match="fault model file missing.*dinov2.pt"):
        FaultDetector(d, "cpu")


def test_selfref_without_encoder_file_names_the_key(tmp_path, fake_selfref):
    d = _selfref_dir(tmp_path)
    cfg = json.loads((d / "config.json").read_text())
    del cfg["encoder_file"]
    _write_cfg(d, cfg)
    with pytest.raises(ValueError, match="encoder_file"):
        FaultDetector(d, "cpu")


def test_unknown_method_is_a_value_error(tmp_path):
    d = _model_dir(tmp_path)
    cfg = json.loads((d / "config.json").read_text())
    cfg["method"] = "bogus"
    _write_cfg(d, cfg)
    with pytest.raises(ValueError, match="bogus"):
        FaultDetector(d, "cpu")


def _gated(tmp_path, gate):
    d = _model_dir(tmp_path)
    cfg = json.loads((d / "config.json").read_text())
    (d / "config.json").write_text(json.dumps(cfg | {"max_map_median": gate, "relative_z": 7.5}))
    return d


def _raised_fabric(spot=False):
    rng = np.random.default_rng(0)
    img = np.full((300, 400, 3), 120, np.uint8)
    img[:, :, 0] = rng.integers(115, 126, (300, 400))
    if spot:
        img[100:160, 200:260, 0] = 255
    return img


def test_relative_branch_reports_self_relative(tmp_path):
    d = _gated(tmp_path, 0.2)
    assert StubDetector(d).detect(_raised_fabric(), None).reference == "self_relative"
    assert StubDetector(d).detect(_raised_fabric(spot=True), None).reference == "self_relative"


def test_trained_branch_reports_trained(tmp_path):
    d0 = _model_dir(tmp_path)
    assert StubDetector(d0).detect(_hot_square_image(), None).reference == "trained"
    d = _gated(tmp_path / "g", 0.9)  # map median 0.12 is below the gate
    assert StubDetector(d).detect(_hot_square_image(), None).reference == "trained"


def test_skipped_check_has_no_reference(tmp_path):
    out = StubDetector(_model_dir(tmp_path)).detect(_hot_square_image(), (0.0, 0.0, 0.01, 0.01))
    assert out.skipped_reason and out.reference is None


def test_reference_does_not_change_the_numbers(tmp_path):
    # trained: stub map is red/255, hot square = 1.0, fixed threshold 0.5
    out = StubDetector(_model_dir(tmp_path)).detect(_hot_square_image(), None)
    assert (out.score, out.threshold, out.is_fault) == (1.0, 0.5, True)
    assert len(out.regions) == 1 and out.regions[0].score == 1.0
    # relative: threshold = median + 7.5 * 1.4826 * MAD of the same map, worked out by hand
    img = _raised_fabric(spot=True)
    amap = img[:, :, 0].astype(np.float32) / 255.0
    med = float(np.median(amap))
    mad = float(np.median(np.abs(amap - med)))
    out = StubDetector(_gated(tmp_path / "r", 0.2)).detect(img, None)
    assert out.score == pytest.approx(1.0)
    assert out.threshold == pytest.approx(med + 7.5 * 1.4826 * mad, abs=0.01)
    assert out.is_fault and len(out.regions) == 1
    assert out.regions[0].score == pytest.approx(1.0)


def test_uniform_photo_on_relative_branch_is_not_a_fault(tmp_path):
    out = StubDetector(_gated(tmp_path, 0.2)).detect(np.full((300, 400, 3), 120, np.uint8), None)
    assert out.reference == "self_relative" and out.is_fault is False
