"""The shared Florence-2 model: one per (checkpoint, device), freed when unused. No weights."""

import gc
import weakref

import services.vision.florence2 as f2


class FakeModel:
    made = 0

    def __init__(self, device, model_id=f2.MODEL_ID):
        FakeModel.made += 1
        self.device, self.model_id = device, model_id


def _fresh(monkeypatch):
    monkeypatch.setattr(f2, "Florence2", FakeModel)
    monkeypatch.setattr(f2, "_shared", weakref.WeakValueDictionary())
    FakeModel.made = 0


def test_detector_and_ocr_share_one_model_per_device(monkeypatch):
    _fresh(monkeypatch)
    a, b, c = f2.load("mps"), f2.load("mps"), f2.load("cpu")
    assert a is b and c is not a and FakeModel.made == 2


def test_the_model_is_freed_once_nothing_uses_it(monkeypatch):
    _fresh(monkeypatch)
    m = f2.load("mps")
    del m
    gc.collect()
    f2.load("mps")
    assert FakeModel.made == 2  # the bake-off holds one backend at a time


def test_any_cpu_device_gets_float32_and_the_gpu_float16():
    torch = __import__("pytest").importorskip("torch")
    assert f2.dtype_for("cpu:0") is torch.float32  # TEXPILOT_DEVICE=cpu:0 was float16
    assert f2.dtype_for(torch.device("cpu")) is torch.float32
    assert f2.dtype_for("mps") is torch.float16
