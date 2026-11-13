"""Live fabric fault check on a camera, an IP-camera URL or a video file.

Every --every-th frame is scored; a STOP latches after K of the last N frames are faults.

    .venv/bin/python scripts/fault_stream.py --source 0 --model models/fault-v1/vit_s
    .venv/bin/python scripts/fault_stream.py --source rtsp://... --webhook http://host/stop
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # run as a script: repo root on path

from services.vision.fault import StopLatch  # noqa: E402


def _post_stop(url: str, score: float, frame: int, t: float) -> None:
    body = json.dumps({"event": "STOP", "score": score, "frame": frame, "t": t}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=2).close()
    except Exception as e:  # never stop the stream over a webhook
        print(f"webhook failed: {e}", file=sys.stderr)


def _p95(xs: list[float]) -> float:
    s = sorted(xs)
    return s[math.ceil(0.95 * len(s)) - 1]


def main(argv: list[str] | None = None, detector=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", required=True, help="camera index, rtsp/http URL or video file")
    ap.add_argument("--model", default="models/fault-v1/vit_s", help="FaultDetector folder")
    ap.add_argument("--every", type=int, default=3, help="process every Nth frame")
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--webhook", help="POST the STOP event here")
    ap.add_argument("--log", type=Path, help="JSONL log (default runs/fault/stream/<time>.jsonl)")
    ap.add_argument("--show", action="store_true", help="show the frames in a window")
    args = ap.parse_args(argv)

    import cv2

    src = int(args.source) if args.source.isdigit() else args.source
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        print(f"cannot open source: {args.source}", file=sys.stderr)
        return 2

    if detector is None:
        from services.vision.fault import FaultDetector
        from services.vision.runtime import pick_device

        detector = FaultDetector(Path(args.model), pick_device())

    try:
        latch = StopLatch(args.k, args.n)
    except ValueError as e:
        print(f"bad --k/--n: {e}", file=sys.stderr)
        cap.release()
        return 2

    log = args.log or Path("runs/fault/stream") / f"{time.strftime('%Y%m%d-%H%M%S')}.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    frames = processed = alarms = 0
    was = False  # latch state after the last processed frame
    latencies: list[float] = []
    with log.open("w") as out:
        try:
            while True:
                ok, frame = cap.read()
                if not ok:  # end of video or camera lost
                    break
                frames += 1
                if (frames - 1) % args.every == 0:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    t0 = time.perf_counter()
                    res = detector.detect(rgb, None)
                    latency_ms = (time.perf_counter() - t0) * 1000
                    processed += 1
                    latencies.append(latency_ms)
                    prev, was = was, latch.update(res.is_fault)
                    t = round(time.time(), 3)
                    out.write(
                        json.dumps(
                            {
                                "t": t,
                                "frame": frames - 1,
                                "score": round(float(res.score), 4),
                                "is_fault": bool(res.is_fault),
                                "latched": was,
                                "latency_ms": round(latency_ms, 2),
                            }
                        )
                        + "\n"
                    )
                    if was and not prev:  # rising edge only
                        alarms += 1
                        print("=" * 60)
                        print(
                            f"!!! STOP: fabric fault at frame {frames - 1}, score {res.score:.3f}"
                        )
                        print("=" * 60, flush=True)
                        if args.webhook:
                            _post_stop(args.webhook, float(res.score), frames - 1, t)
                if args.show:
                    cv2.imshow("fault", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
        except KeyboardInterrupt:
            pass
        finally:
            cap.release()
            if args.show:
                cv2.destroyAllWindows()
        summary = {
            "frames": frames,
            "processed": processed,
            "alarms": alarms,
            "mean_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
            "p95_latency_ms": round(_p95(latencies), 2) if latencies else None,
        }
        out.write(json.dumps(summary) + "\n")
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
