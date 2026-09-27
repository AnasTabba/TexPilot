"""PaddleOCR worker. Runs inside .venv-paddle (make setup-paddle) and imports nothing
from `services`. Protocol: one JSON request per stdin line -> one JSON reply per stdout
line. Paddle's own logging is pushed to stderr so it cannot corrupt the protocol."""

import base64
import io
import json
import os
import sys

# Run as a script, this folder is sys.path[0], and the sibling paddle.py (our engine)
# would shadow the real `paddle` package that PaddleOCR imports. Take the folder off.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != _HERE]


def main() -> None:
    proto = os.fdopen(os.dup(1), "w")  # protocol channel = the original stdout
    os.dup2(2, 1)  # anything else written to fd 1 (Paddle logs) goes to stderr
    import numpy as np
    from paddleocr import PaddleOCR
    from PIL import Image

    ocr = PaddleOCR(
        lang="en",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=True,
    )
    proto.write("ready\n")
    proto.flush()
    for raw in sys.stdin:
        try:
            png = base64.b64decode(json.loads(raw)["png"])
            bgr = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))[:, :, ::-1]
            res = ocr.predict(np.ascontiguousarray(bgr))[0]
            lines = [
                [str(t), float(s), [float(v) for v in b]]
                for t, s, b in zip(
                    res["rec_texts"], res["rec_scores"], res["rec_boxes"], strict=True
                )
            ]
            reply = {"lines": lines}
        except Exception as e:  # noqa: BLE001 -- report it; the caller decides
            reply = {"error": f"{type(e).__name__}: {e}"}
        proto.write(json.dumps(reply) + "\n")
        proto.flush()


if __name__ == "__main__":
    main()
