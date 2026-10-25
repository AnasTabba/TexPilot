"""Start the real main-branch scanner, refusing missing weights and stub mode.

Usage: .venv/bin/python scripts/serve_yarnflow_scanner.py --bundle models/scanner-v6
Use a private authenticated HTTPS ingress for the hosted Yarnflow client.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=Path("models/scanner-v6"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    missing = [
        name for name in ("bundle.json", "heads.safetensors") if not (args.bundle / name).is_file()
    ]
    if missing:
        parser.error(
            f"Trained model bundle missing in {args.bundle}: {', '.join(missing)}. "
            "Copy the trained scanner-v6 bundle here, or pass --bundle /path/to/your/bundle. "
            "Weights are intentionally excluded from Git. No stub server was started."
        )
    os.environ["TEXPILOT_VISION"] = "scanner"
    os.environ["TEXPILOT_MODEL_BUNDLE"] = str(args.bundle.resolve())
    import uvicorn

    uvicorn.run("services.api.main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
