"""Every scan the scanner answers, kept (parent spec §9): audit evidence, phone-domain
training data, and later the goods-in record. Stdlib only.

    <root>/scans.sqlite3   one row per scan: the full ScanResult JSON plus searchable columns
    <root>/photos/         the uploads as sent: <scan_id>_garment.<ext>, <scan_id>_label.<ext>
                           (the phone set's naming, so its tools can read them)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from services.api.schemas import ScanResult
from services.api.uploads import image_format

_SCHEMA = """
create table if not exists scans (
    scan_id text primary key,
    timestamp text not null,
    verdict text not null,
    model_version text not null,
    kb_version text not null,
    label_text text,  -- typed by the operator, if any: ground truth for retraining
    result text not null  -- the ScanResult as returned, JSON
)"""


class ScanStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.photos = self.root / "photos"
        self.photos.mkdir(parents=True, exist_ok=True)
        self._run(_SCHEMA)

    def _run(self, sql: str, args: tuple = ()) -> None:
        con = sqlite3.connect(self.root / "scans.sqlite3")
        try:
            with con:  # commits, or rolls back on error
                con.execute(sql, args)
        finally:
            con.close()

    def save(
        self, result: ScanResult, surface: bytes, label: bytes | None, label_text: str | None
    ) -> None:
        """Photos first, then the row, so a row never points at a missing photo."""
        for role, data in (("garment", surface), ("label", label)):
            if data is not None:
                fmt = image_format(data) or "BIN"
                ext = "jpg" if fmt == "JPEG" else fmt.lower()
                (self.photos / f"{result.scan_id}_{role}.{ext}").write_bytes(data)
        self._run(
            "insert into scans values (?, ?, ?, ?, ?, ?, ?)",
            (
                result.scan_id,
                result.timestamp.isoformat(),
                result.verdict.value,
                result.model_version,
                result.kb_version,
                label_text,
                result.model_dump_json(),
            ),
        )
