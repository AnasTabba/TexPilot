"""PaddleOCR PP-OCRv5 through a worker in its own venv. Spec §5.1, engine 1."""

from __future__ import annotations

import base64
import io
import json
import select
import subprocess
from pathlib import Path

from services.ocr.engines.base import TextLine

WORKER = Path(__file__).with_name("paddle_worker.py")


def encode_request(image) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(image).save(buf, format="PNG")
    return json.dumps({"png": base64.b64encode(buf.getvalue()).decode("ascii")})


def decode_reply(line: str) -> list[TextLine]:
    reply = json.loads(line)
    if "error" in reply:
        raise RuntimeError(f"PaddleOCR worker: {reply['error']}")
    return [TextLine(t, float(s), tuple(float(v) for v in b)) for t, s, b in reply["lines"]]


class PaddleEngine:
    name = "paddle"

    def __init__(self, python: str = ".venv-paddle/bin/python", timeout_s: float = 120.0):
        if not Path(python).exists():
            raise FileNotFoundError(f"{python} not found; run `make setup-paddle` first")
        self.timeout_s = timeout_s
        self.proc = subprocess.Popen(
            [python, "-u", str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
        )
        if self._readline() != "ready":
            raise RuntimeError("PaddleOCR worker did not start")

    def _readline(self) -> str:
        ready, _, _ = select.select([self.proc.stdout], [], [], self.timeout_s)
        if not ready:
            self.proc.kill()
            raise TimeoutError(f"PaddleOCR worker silent for {self.timeout_s:.0f}s")
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError(f"PaddleOCR worker exited ({self.proc.poll()})")
        return line.strip()

    def read(self, image) -> list[TextLine]:
        self.proc.stdin.write(encode_request(image) + "\n")
        self.proc.stdin.flush()
        return decode_reply(self._readline())

    def close(self) -> None:
        self.proc.terminate()
