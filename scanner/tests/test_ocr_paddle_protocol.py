"""The JSON-lines protocol between us and the PaddleOCR worker. Needs numpy/PIL."""

import base64
import io
import json

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from services.ocr.engines.base import TextLine  # noqa: E402
from services.ocr.engines.paddle import decode_reply, encode_request  # noqa: E402


def test_request_carries_a_png_of_the_image():
    img = np.zeros((5, 7, 3), np.uint8)
    png = base64.b64decode(json.loads(encode_request(img))["png"])
    assert Image.open(io.BytesIO(png)).size == (7, 5)


def test_reply_becomes_text_lines():
    line = json.dumps({"lines": [["80% PA 20% EA", 0.97, [1, 2, 30, 12]]]})
    assert decode_reply(line) == [TextLine("80% PA 20% EA", 0.97, (1.0, 2.0, 30.0, 12.0))]


def test_worker_error_raises():
    with pytest.raises(RuntimeError, match="boom"):
        decode_reply(json.dumps({"error": "ValueError: boom"}))


def test_worker_takes_its_own_folder_off_the_import_path():
    # Run as a script, the worker's folder is sys.path[0], and our sibling paddle.py
    # shadowed the real `paddle` package ("No module named 'services'").
    import importlib.util
    import sys
    from pathlib import Path

    worker = Path("services/ocr/engines/paddle_worker.py").resolve()
    here = str(worker.parent)
    sys.path.insert(0, here)
    try:
        spec = importlib.util.spec_from_file_location("paddle_worker_under_test", worker)
        spec.loader.exec_module(importlib.util.module_from_spec(spec))
        assert here not in sys.path
    finally:
        while here in sys.path:
            sys.path.remove(here)


class _Proc:
    def __init__(self, hangs=False):
        self.hangs, self.stdin_closed, self.terminated = hangs, False, False
        self.stdin = self

    def close(self):  # stdin.close()
        self.stdin_closed = True

    def wait(self, timeout=None):
        import subprocess

        if self.hangs:
            raise subprocess.TimeoutExpired("worker", timeout)
        return 0

    def terminate(self):
        self.terminated = True


def test_close_lets_the_worker_exit_instead_of_killing_it():
    # A kill signal lands in Paddle's own crash handler, which segfaults and pops a macOS
    # "Python quit unexpectedly" dialog. Closing stdin ends the worker's loop cleanly.
    from services.ocr.engines.paddle import PaddleEngine

    engine = PaddleEngine.__new__(PaddleEngine)
    engine.proc = _Proc()
    engine.close()
    assert engine.proc.stdin_closed and not engine.proc.terminated


def test_close_still_stops_a_worker_that_hangs():
    from services.ocr.engines.paddle import PaddleEngine

    engine = PaddleEngine.__new__(PaddleEngine)
    engine.proc = _Proc(hangs=True)
    engine.close()
    assert engine.proc.terminated
