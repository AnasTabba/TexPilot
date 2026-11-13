"""The fault stage: scanner wiring with fakes, and FaultDetector with a stub network."""

import base64
import io
import json

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
