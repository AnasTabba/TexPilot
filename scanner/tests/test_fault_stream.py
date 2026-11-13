"""Live fault stream: K-of-N latch, stream loop on a synthetic video, failure paths."""

import json
from types import SimpleNamespace

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from scripts.fault_stream import main  # noqa: E402
from services.vision.fault import StopLatch  # noqa: E402


def test_stoplatch_latches_on_fifth_update_and_stays():
    latch = StopLatch(3, 5)
    seq = [False, True, False, True, True]
    out = [latch.update(x) for x in seq]
    assert out == [False, False, False, False, True]
    assert latch.update(False) is True
    assert latch.update(False) is True


def test_stoplatch_reset_clears_latch_and_history():
    latch = StopLatch(3, 5)
    for x in [True, True, True]:
        latch.update(x)
    latch.reset()
    assert latch.update(False) is False
    assert latch.update(True) is False
    assert latch.update(True) is False


def test_stoplatch_rejects_bad_k_n():
    with pytest.raises(ValueError):
        StopLatch(0, 5)
    with pytest.raises(ValueError):
        StopLatch(6, 5)


class FakeDetector:
    def __init__(self, is_fault=False):
        self.is_fault = is_fault
        self.calls = 0

    def detect(self, image, box):
        assert image.shape[2] == 3 and box is None
        self.calls += 1
        return SimpleNamespace(score=0.9 if self.is_fault else 0.1, is_fault=self.is_fault)


def _write_video(tmp_path, frames=20):
    """Write a synthetic video with the first codec that reads back `frames` frames."""
    for codec, ext in (("mp4v", ".mp4"), ("MJPG", ".avi")):
        path = tmp_path / f"clip{ext}"
        w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), 10, (96, 64))
        if not w.isOpened():
            continue
        rng = np.random.default_rng(2026)
        for _ in range(frames):
            w.write(rng.integers(0, 255, (64, 96, 3), dtype=np.uint8))
        w.release()
        cap = cv2.VideoCapture(str(path))
        n = 0
        while cap.read()[0]:
            n += 1
        cap.release()
        if n == frames:
            return path
    pytest.skip("OpenCV cannot write a readable test video on this machine")


def _rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_stream_video_writes_rows_and_summary(tmp_path, capsys):
    video = _write_video(tmp_path)
    log = tmp_path / "out.jsonl"
    det = FakeDetector()
    rc = main(["--source", str(video), "--every", "3", "--log", str(log)], detector=det)
    assert rc == 0
    rows = _rows(log)
    frame_rows, summary = rows[:-1], rows[-1]
    assert len(frame_rows) == -(-20 // 3) == 7
    assert det.calls == 7
    assert set(frame_rows[0]) == {"t", "frame", "score", "is_fault", "latched", "latency_ms"}
    assert summary["frames"] == 20
    assert summary["processed"] == len(frame_rows) == 7
    assert summary["alarms"] == 0
    assert summary["mean_latency_ms"] >= 0 and summary["p95_latency_ms"] >= 0


def test_stream_latches_and_prints_banner(tmp_path, capsys):
    video = _write_video(tmp_path)
    log = tmp_path / "out.jsonl"
    rc = main(
        ["--source", str(video), "--every", "1", "--log", str(log)],
        detector=FakeDetector(is_fault=True),
    )
    assert rc == 0
    summary = _rows(log)[-1]
    assert summary["alarms"] == 1
    assert summary["processed"] == 20
    assert "STOP" in capsys.readouterr().out


def test_unopenable_source_returns_2(tmp_path, capsys):
    rc = main(
        ["--source", str(tmp_path / "missing.mp4"), "--log", str(tmp_path / "x.jsonl")],
        detector=FakeDetector(),
    )
    assert rc == 2
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert captured.err.strip()


def test_closed_webhook_port_does_not_stop_stream(tmp_path, capsys):
    video = _write_video(tmp_path)
    log = tmp_path / "out.jsonl"
    # Port 9 on localhost is closed; the POST fails fast and must not end the stream.
    rc = main(
        [
            "--source",
            str(video),
            "--every",
            "1",
            "--log",
            str(log),
            "--webhook",
            "http://127.0.0.1:9/stop",
        ],
        detector=FakeDetector(is_fault=True),
    )
    assert rc == 0
    rows = _rows(log)
    assert rows[-1]["processed"] == len(rows) - 1 == 20
    assert "webhook" in capsys.readouterr().err.lower()
