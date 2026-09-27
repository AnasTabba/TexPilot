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
    text = "\n".join(cps.check(root)[0])
    assert "001_AT: garment_type 'trousers' is not one of the 14" in text
    assert "002_AT: label_text does not parse" in text
    assert "002_AT: fabric_structure 'denimm' is not one of the 27" in text
    assert "002_AT: duplicate id" in text
    assert "003_AT: no garment photo" in text
    assert "002_AT_label.heic: HEIC" in text
    assert "009_AT_garment.jpg: photo has no row" in text
