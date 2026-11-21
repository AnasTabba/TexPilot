"""real_uploads: triage, coverage maths and report wording. PIL + stdlib only, no real photos."""

from __future__ import annotations

import csv
import io
import json
import random
import sqlite3
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import real_uploads as ru  # noqa: E402


def noise(seed: int, size: int = 200) -> Image.Image:
    r = random.Random(seed)
    small = Image.new("RGB", (16, 16))
    small.putdata([tuple(r.randrange(256) for _ in range(3)) for _ in range(256)])
    return small.resize((size, size), Image.NEAREST)


def blob(im: Image.Image, fmt: str, **kw) -> bytes:
    b = io.BytesIO()
    im.save(b, fmt, **kw)
    return b.getvalue()


def make_store(tmp_path: Path, files: dict[str, bytes], rows: dict[str, str] | None = None):
    """files: '<scan_id>_garment.<ext>' -> bytes. rows: scan_id -> label_text (DB row)."""
    photos = tmp_path / "photos"
    photos.mkdir()
    for name, data in files.items():
        (photos / name).write_bytes(data)
    db = tmp_path / "scans.sqlite3"
    con = sqlite3.connect(db)
    con.execute(
        "create table scans(scan_id, timestamp, verdict, model_version, kb_version,"
        " label_text, result)"
    )
    for i, (sid, label) in enumerate((rows or {}).items()):
        con.execute(
            "insert into scans values(?,?,?,?,?,?,?)",
            (sid, f"2026-11-0{i + 1}T00:00:00", "ok", f"v{i}", "k", label, "{}"),
        )
    con.commit()
    con.close()
    return photos, db


def triage(tmp_path, files, rows=None):
    photos, db = make_store(tmp_path, files, rows)
    out = tmp_path / "out"
    ru.triage(photos, db, out)
    with open(out / "manifest.csv", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f)), out


def test_dedupe_two_scans_one_row(tmp_path):
    data = blob(noise(1), "JPEG")
    m, _ = triage(
        tmp_path,
        {"a_garment.jpg": data, "b_garment.jpg": data},
        {"a": "", "b": "60% COTTON"},
    )
    assert len(m) == 1
    r = m[0]
    assert r["n_uploads"] == "2"
    assert set(r["scan_ids"].split(";")) == {"a", "b"}
    assert r["label_text_present"] == "yes"
    assert r["first_seen"] == "2026-11-01T00:00:00"
    assert set(r["model_versions"].split(";")) == {"v0", "v1"}


def test_source_and_exclusions(tmp_path):
    exif = Image.Exif()
    exif[271] = "Apple"
    files = {
        "a_garment.jpg": blob(noise(1), "JPEG", exif=exif),
        "b_garment.jpg": blob(noise(2), "JPEG"),
        "c_garment.png": blob(noise(3), "PNG"),
        "d_garment.webp": blob(noise(4), "WEBP"),
        "e_garment.jpg": blob(noise(5), "JPEG")[:300],
    }
    m, _ = triage(tmp_path, files, {k[0]: "" for k in files})
    by = {r["scan_ids"]: r for r in m}
    assert by["a"]["source"] == "camera_exif" and by["a"]["excluded"] == "no"
    assert by["b"]["source"] == "jpeg_no_exif" and by["b"]["excluded"] == "no"
    for k in "cd":
        assert by[k]["source"] == "web_format" and by[k]["excluded"] == "yes"
        assert by[k]["exclude_reason"]
    assert by["e"]["excluded"] == "yes" and by["e"]["exclude_reason"] == "undecodable"
    assert by["b"]["width"] == "200"


def test_near_duplicate_group(tmp_path):
    a = noise(1)
    files = {
        "a_garment.jpg": blob(a, "JPEG"),
        "b_garment.jpg": blob(a.resize((196, 196)), "JPEG"),
        "c_garment.jpg": blob(noise(99), "JPEG"),
    }
    m, _ = triage(tmp_path, files, {k[0]: "" for k in files})
    by = {r["scan_ids"]: r for r in m}
    assert by["a"]["group_id"] == by["b"]["group_id"]
    assert by["c"]["group_id"] != by["a"]["group_id"]
    assert by["a"]["group_id"] == min(by["a"]["image_sha"], by["b"]["image_sha"])


def test_orphans_kept_and_counted(tmp_path):
    files = {"a_garment.jpg": blob(noise(1), "JPEG"), "z_garment.jpg": blob(noise(2), "JPEG")}
    m, out = triage(tmp_path, files, {"a": ""})
    assert len(m) == 2
    assert [r["model_versions"] for r in m if r["scan_ids"] == "z"] == [""]
    text = ru.report_text(m, [], None)
    assert "no scan-store row: 1" in text


def ans(label="x"):
    return {"label": label, "confidence": 0.9, "topk": []}


def pred(i, *, structure=True, mix=None, fault=None):
    return {
        "image_sha": f"{i:04d}",
        "error": None,
        "result": {
            "structure_answer": {"label": "knit", "confidence": 0.9, "unknown": not structure},
            "fibre_family": None,
            "treatment": ans(),
            "garment": {"label": "shirt", "confidence": None, "box": [0, 0, 1, 1]},
            "custom": {"mix": mix, "wash": ans()},
            "fault": fault,
        },
    }


def flt(is_fault, reference=None, skipped=None):
    d = {"score": 1.0, "is_fault": is_fault, "threshold": 1.0, "model_version": "f"}
    if reference:
        d["reference"] = reference
    if skipped:
        d["skipped_reason"] = skipped
    return d


def mrows(n, source="jpeg_no_exif", label="no"):
    return [
        {"image_sha": f"{i:04d}", "source": source, "excluded": "no", "exclude_reason": "",
         "group_id": f"{i:04d}", "label_text_present": label, "model_versions": "v",
         "scan_ids": f"s{i}"}
        for i in range(n)
    ]  # fmt: skip


def test_coverage_maths():
    preds = (
        [pred(i, structure=i < 30, mix=ans() if i < 10 else None, fault=flt(i < 5, "trained"))
         for i in range(40)]
        + [pred(40 + i, fault=flt(False, "self_relative")) for i in range(10)]
        + [pred(50, fault=flt(False, skipped="small box")), pred(51, fault=None),
         pred(52, fault=flt(True))]
    )  # fmt: skip
    c = ru.coverage(preds)
    assert c["n"] == 53
    assert c["heads"]["structure"] == {"answered": 40 + 13 - 10, "n": 53}  # i<30 + 13 extras
    assert c["heads"]["fibre_family"]["answered"] == 0
    assert c["heads"]["custom.mix"] == {"answered": 10, "n": 53}
    assert c["heads"]["garment"]["answered"] == 53
    f = c["fault"]
    assert f["trained"] == {"n": 40, "flagged": 5}
    assert f["self_relative"] == {"n": 10, "flagged": 0}
    assert (
        f["skipped"]["n"] == 1 and f["absent"]["n"] == 1 and f["unknown"] == {"n": 1, "flagged": 1}
    )


def test_errors_are_not_in_rates():
    c = ru.coverage([pred(0), {"image_sha": "1", "result": None, "error": "too small"}])
    assert c["n"] == 1 and c["errors"] == 1


def test_low_n_gives_no_rates():
    text = ru.report_text(mrows(5), [pred(i) for i in range(5)], None)
    assert "n=5: too few to summarise" in text
    assert "answer rate" not in text
    assert "coverage on real uploads, not accuracy" in text
    assert "jpeg_no_exif: 5" in text


def test_report_full():
    m = mrows(30) + mrows(1, "camera_exif")[:0]
    text = ru.report_text(m, [pred(i, fault=flt(False, "trained")) for i in range(30)], None)
    assert "coverage on real uploads, not accuracy" in text
    assert "answer rate" in text and "0.8201" in text and "53.2" in text
    assert "composition: not measurable (0 label texts)" in text
    assert "trained" in text


def test_zero_evaluated(tmp_path):
    out = tmp_path
    (out / "manifest.csv").write_text("image_sha,excluded,source\nab,yes,web_format\n")
    assert ru.main(["report", "--out", str(out)]) == 0
    assert "no non-excluded images" in (out / "coverage.md").read_text()
    assert json.loads((out / "coverage.json").read_text())["n_evaluated"] == 0


def test_triage_empty_dir_exit0(tmp_path):
    photos, db = make_store(tmp_path, {})
    assert (
        ru.main(["triage", "--photos", str(photos), "--db", str(db), "--out", str(tmp_path / "o")])
        == 0
    )
    pytest.importorskip("PIL")
