"""The composed scanner with fake parts. Skipped without numpy/PIL (CI core)."""

import io

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.vision.errors import UnsupportedImage  # noqa: E402
from services.vision.garment import Detection  # noqa: E402
from services.vision.predictor import HeadOutput, VisionOutput  # noqa: E402
from services.vision.scanner import ScannerPredictor  # noqa: E402


def _jpeg(w=200, h=100):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "gray").save(buf, format="JPEG")
    return buf.getvalue()


class Det:
    name, default_min_score = "fake", 0.3

    def __init__(self, dets=(), error=None):
        self.dets, self.error = list(dets), error

    def detect(self, image):
        if self.error:
            raise self.error
        return self.dets


class Seg:
    def __init__(self, error=None):
        self.error = error

    def segment(self, image, box):
        if self.error:
            raise self.error
        m = np.zeros(image.shape[:2], bool)
        m[10:90, 50:150] = True
        return m


class Crop:
    def __init__(self):
        self.masks = []

    def views(self, image, mask):
        self.masks.append(mask)
        return [image[:10, :10]]


class Heads:
    def __init__(self, error=None):
        self.views, self.error = [], error

    def predict(self, views):
        if self.error:
            raise self.error
        self.views.append(views)
        return VisionOutput(HeadOutput("denim", 0.9, []), None, None)


def _scanner(det=None, seg=None, heads=None, crop=None):
    return ScannerPredictor(
        det or Det([Detection("pants", 0.8, (50, 10, 150, 90))]),
        seg or Seg(),
        crop or Crop(),
        heads or Heads(),
    )


def test_garment_found_cut_out_and_classified():
    heads = Heads()
    out = _scanner(heads=heads).predict(_jpeg())
    assert out.structure.label == "denim"
    assert out.garment.label == "pants"
    assert out.garment.box == pytest.approx((0.25, 0.1, 0.75, 0.9))
    assert out.notes == ()
    assert heads.views[0][0].shape == (10, 10, 3)  # the cropper's view, not the frame


def test_no_garment_classifies_the_whole_photo_and_says_so():
    heads = Heads()
    out = _scanner(det=Det([]), heads=heads).predict(_jpeg())
    assert out.garment is None
    assert [n.code for n in out.notes] == ["NO_GARMENT_DETECTED"]
    assert heads.views[0][0].shape == (100, 200, 3)


def test_detection_below_threshold_counts_as_no_garment():
    out = _scanner(det=Det([Detection("pants", 0.1, (50, 10, 150, 90))])).predict(_jpeg())
    assert out.garment is None


def test_failing_detector_abstains_with_a_reason_instead_of_crashing():
    out = _scanner(det=Det(error=RuntimeError("boom"))).predict(_jpeg())
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED", "NO_GARMENT_DETECTED"]
    assert "garment detector" in out.notes[0].message


def test_failing_segmenter_falls_back_to_the_box():
    crop = Crop()
    out = _scanner(seg=Seg(error=RuntimeError("x")), crop=crop).predict(_jpeg())
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED"]
    assert crop.masks[0][10:90, 50:150].all() and crop.masks[0].sum() == 80 * 100


def test_failing_heads_leave_every_head_empty():
    out = _scanner(heads=Heads(error=RuntimeError("x"))).predict(_jpeg())
    assert out.structure is None and out.fibre_family is None
    assert out.garment.label == "pants"
    assert [n.code for n in out.notes] == ["COMPONENT_FAILED"]


def test_undecodable_upload_is_rejected():
    with pytest.raises(UnsupportedImage):
        _scanner().predict(b"not an image")


def test_capture_quality_is_measured_on_the_photo_and_the_garment_box():
    out = _scanner().predict(_jpeg())
    assert set(out.quality) == {"blur", "exposure", "framing"}
    assert (out.quality["exposure"], out.quality["framing"]) == ("ok", "ok")


def test_a_failing_quality_measure_leaves_the_scan_alone(monkeypatch):
    import services.vision.scanner as scanner

    def boom(image, box):
        raise ValueError("bad pixels")

    monkeypatch.setattr(scanner, "capture_quality", boom)
    out = _scanner().predict(_jpeg())
    assert out.quality is None and out.notes == () and out.structure.label == "denim"
