"""Every scan kept: its result, its photos, its typed label (parent spec §9). No models."""

import sqlite3

import pytest

from services.api.schemas import ScanResult
from services.api.store import ScanStore

JPEG = b"\xff\xd8\xff\xe0 not decoded here"
PNG = b"\x89PNG\r\n\x1a\n not decoded here"


def _result(scan_id="s1"):
    return ScanResult(scan_id=scan_id, verdict="PASS", model_version="scanner-v1", kb_version="3")


def _rows(root):
    con = sqlite3.connect(root / "scans.sqlite3")
    try:
        return con.execute("select scan_id, verdict, label_text, result from scans").fetchall()
    finally:
        con.close()


def test_a_saved_scan_keeps_its_result_label_and_photos_named_like_the_phone_set(tmp_path):
    r = _result()
    ScanStore(tmp_path).save(r, JPEG, PNG, "100% COTTON")
    [(scan_id, verdict, label_text, result)] = _rows(tmp_path)
    assert (scan_id, verdict, label_text) == ("s1", "PASS", "100% COTTON")
    assert ScanResult.model_validate_json(result) == r
    assert (tmp_path / "photos" / "s1_garment.jpg").read_bytes() == JPEG
    assert (tmp_path / "photos" / "s1_label.png").read_bytes() == PNG


def test_without_a_label_photo_only_the_garment_is_written(tmp_path):
    ScanStore(tmp_path).save(_result(), JPEG, None, None)
    assert [p.name for p in (tmp_path / "photos").iterdir()] == ["s1_garment.jpg"]


def test_a_failed_photo_write_leaves_no_row_pointing_at_it(tmp_path, monkeypatch):
    store = ScanStore(tmp_path)

    def disk_full(self, data):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr("pathlib.Path.write_bytes", disk_full)
    with pytest.raises(OSError):
        store.save(_result(), JPEG, None, None)
    assert _rows(tmp_path) == []


def test_scans_accumulate_in_one_database(tmp_path):
    store = ScanStore(tmp_path)
    store.save(_result("a"), JPEG, None, None)
    ScanStore(tmp_path).save(_result("b"), JPEG, None, None)  # a restarted server
    assert [row[0] for row in _rows(tmp_path)] == ["a", "b"]
