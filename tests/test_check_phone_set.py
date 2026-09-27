"""What the collectors see when they run the checker."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("cps", Path("scripts/check_phone_set.py"))
cps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cps)

HEADER = "id,garment_type,label_text,fabric_structure,photographer,phone_model,notes\n"


def _root(tmp_path, rows, photos):
    (tmp_path / "ground_truth.csv").write_text("﻿" + HEADER + rows, encoding="utf-8")
    for n in photos:
        (tmp_path / n).write_bytes(b"x")
    return tmp_path


def test_a_clean_set_has_no_problems(tmp_path):
    root = _root(
        tmp_path,
        "001_AT,pants,100% COTTON,denim,AT,x,\n",
        ["001_AT_garment.jpg", "001_AT_label.jpg"],
    )
    problems, summary = cps.check(root)
    assert problems == []
    assert summary["garments"] == 1 and summary["by_family"] == {"cellulosic": 1}


def test_each_mistake_is_named(tmp_path):
    rows = (
        "001_AT,Trousers,100% COTTON,,AT,x,\n"  # not a vocabulary key
        "002_AT,pants,100% LUREX,denimm,AT,x,\n"  # unparseable label, bad class
        "002_AT,pants,100% COTTON,,AT,x,\n"  # duplicate id
        "003_AT,pants,100% COTTON,,AT,x,\n"  # no photos
    )
    root = _root(
        tmp_path,
        rows,
        [
            "001_AT_garment.jpg",
            "001_AT_label.jpg",
            "002_AT_garment.jpg",
            "002_AT_label.heic",
            "009_AT_garment.jpg",
        ],
    )
    problems, summary = cps.check(root)
    text = "\n".join(problems)
    assert "001_AT: garment_type 'trousers' is not one of the 14" in text
    assert summary["unparsed"] == ["002_AT"]  # a warning, not a problem
    assert "002_AT: fabric_structure 'denimm' is not one of the 27" in text
    assert "002_AT: duplicate id" in text
    assert "003_AT: no garment photo" in text
    assert "002_AT_label.heic: HEIC" in text
    assert "009_AT_garment.jpg: photo has no row" in text


def test_a_csv_not_saved_as_utf8_is_named_not_a_crash(tmp_path):
    (tmp_path / "ground_truth.csv").write_bytes(
        (HEADER + "001_AT,pants,100% ALGODÓN,,AT,x,\n").encode("cp1252")
    )
    problems, _ = cps.check(tmp_path)
    assert any("CSV UTF-8" in p for p in problems)


def test_a_label_we_cannot_parse_is_a_warning_not_a_problem(tmp_path):
    # LUREX is copied correctly; the fix is to leave it out of scoring, not to edit it.
    rows = "001_AT,pants,100% LUREX,,AT,x,\n002_AT,pants,,,AT,x,\n"
    photos = [f"00{i}_AT_{r}.jpg" for i in (1, 2) for r in ("garment", "label")]
    problems, summary = cps.check(_root(tmp_path, rows, photos))
    assert problems == ["002_AT: label_text is empty"]
    assert summary["unparsed"] == ["001_AT"]


def test_a_row_with_data_but_no_id_is_named_by_row_number(tmp_path):
    rows = ",pants,100% COTTON,,AT,x,\n,,,,,,\n"  # the second is Excel's blank trailing row
    problems, _ = cps.check(_root(tmp_path, rows, []))
    assert problems == ["row 2: has data but no id"]


def test_two_photos_with_the_same_name_are_named(tmp_path):
    root = _root(tmp_path, "001_AT,pants,100% COTTON,,AT,x,\n",
                 ["001_AT_garment.jpg", "001_AT_label.jpg"])  # fmt: skip
    (tmp_path / "old").mkdir()
    (tmp_path / "old" / "001_AT_garment.png").write_bytes(b"x")
    text = "\n".join(cps.check(root)[0])
    assert "001_AT_garment: two photos with this name" in text
