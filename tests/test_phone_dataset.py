"""The team's phone photos through the FabricDataset interface."""

from pathlib import Path

import pytest

from services.vision.datasets.phone import PhoneDataset, label_family, typed_composition

HEADER = "id,garment_type,label_text,fabric_structure,photographer,phone_model,notes\n"


def _set(tmp_path: Path, rows: str, photos: list[str]) -> Path:
    (tmp_path / "ground_truth.csv").write_text("﻿" + HEADER + rows, encoding="utf-8")
    for name in photos:
        p = tmp_path / "AT" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    return tmp_path


def test_rows_become_samples_with_both_photos(tmp_path):
    root = _set(
        tmp_path,
        "001_AT,pants,98% COTTON 2% ELASTANE,denim,AT,iPhone 13,\n",
        ["001_AT_garment.jpg", "001_AT_label.jpg"],
    )
    [s] = list(PhoneDataset(root))
    assert s.group_id == "001_AT" and s.garment_type == "pants" and s.fabric == "denim"
    assert s.image_path.name == "001_AT_garment.jpg"
    assert s.label_image_path.name == "001_AT_label.jpg"
    assert s.fibre_family == "cellulosic"  # elastane at 2% is below the 15% floor


def test_missing_garment_photo_is_listed_not_hidden(tmp_path):
    ds = PhoneDataset(_set(tmp_path, "001_AT,pants,100% COTTON,,AT,x,\n", []))
    assert len(ds) == 0 and ds.missing == ["001_AT"]


@pytest.mark.parametrize(
    "text,family",
    [
        ("100% COTTON", "cellulosic"),
        ("SHELL: 60% COTTON 40% POLYESTER / LINING: 100% POLYESTER", "blend"),
        ("80% POLYAMIDE 20% ELASTANE", "synthetic"),
        ("100% LUREX", None),
    ],
)
def test_label_family(text, family):
    assert label_family(text) == family


def test_typed_composition_reads_the_shell():
    got = typed_composition("LINING: 100% POLYESTER / SHELL: 80% PA 20% EA")
    assert [(f.name, f.pct) for f in got] == [("nylon", 80.0), ("elastane_spandex", 20.0)]
