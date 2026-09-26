"""Write the scanner API's OpenAPI schema to a file, without starting a server.

The app generates its TypeScript types from this (app/scripts/gen-api-types.sh),
so services/api/schemas.py stays the single source of truth for the wire contract.

Usage: python scripts/export_openapi.py [OUT_PATH]   (default: stdout)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.api.main import app  # noqa: E402


def main() -> None:
    schema = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(schema, encoding="utf-8")
    else:
        sys.stdout.write(schema)


if __name__ == "__main__":
    main()
