import ast
import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from training.fault.data import Sample
from training.fault.kaggle.full_a2 import GIB, ROW_KEYS, inventory, resource_budget, validate_rows


def dataset(tmp_path):
    rows = []
    for cat in ("carpet", "grid", "leather", "tile", "wood"):
        for split, label in (("train", 0), ("calib", 0), ("test", 0), ("test", 1)):
            path = tmp_path / f"{cat}_{split}_{label}.png"
            Image.new("RGB", (32, 16)).save(path)
            mask = None
            if label:
                mask = str(tmp_path / f"{cat}_mask.png")
                Image.fromarray(np.full((16, 32), 255, np.uint8)).save(mask)
            rows.append(Sample(str(path), label, mask, cat, "mvtec", split))
    return rows


def test_inventory_complete_geometry_masks_and_hashes(tmp_path):
    rows = dataset(tmp_path)
    inv = inventory(rows, "mvtec")
    assert inv["train_tiles"] == 5 and inv["test_tiles"] == 10
    assert len(inv["file_sha256"]) == 25
    assert inv["categories"]["wood"]["dimensions"] == {"32x16": 4}
    assert inv["categories"]["wood"]["masked_defects"] == 1
    json.dumps(inv, allow_nan=False)


@pytest.mark.parametrize(
    "failure",
    [
        "duplicate",
        "wrong_dataset",
        "train_label",
        "missing_category",
        "missing_calib",
        "missing_mask",
        "empty_mask",
        "geometry",
    ],
)
def test_inventory_rejects_bad_data(tmp_path, failure):
    rows = dataset(tmp_path)
    if failure == "duplicate":
        rows.append(rows[0])
    elif failure == "wrong_dataset":
        rows[0] = replace(rows[0], dataset="wfdd")
    elif failure == "train_label":
        rows[0] = replace(rows[0], label=1)
    elif failure == "missing_category":
        rows = [s for s in rows if s.category != "wood"]
    elif failure == "missing_calib":
        rows = [s for s in rows if s.split != "calib"]
    elif failure == "missing_mask":
        rows[3] = replace(rows[3], mask=None)
    else:
        Image.new("L", (1, 1) if failure == "geometry" else (32, 16)).save(rows[3].mask)
    with pytest.raises(ValueError):
        inventory(rows, "mvtec")


def test_mask_union_and_expected_category(tmp_path):
    rows = dataset(tmp_path)
    mask = tmp_path / "second.png"
    Image.new("L", (32, 16), 255).save(mask)
    Image.new("L", (32, 16)).save(rows[3].mask)
    rows[3] = replace(rows[3], mask=rows[3].mask + ";" + str(mask))
    assert inventory(rows, "mvtec")["categories"]["carpet"]["mask_components"] == 2
    with pytest.raises(ValueError, match="coverage"):
        inventory(rows, "mvtec", {"unexpected"})


def test_resource_gate_uses_actual_available_allocation(tmp_path):
    inv = inventory(dataset(tmp_path), "mvtec")
    host = {"available_bytes": 32 * GIB, "disk_free_bytes": 10 * GIB}
    budget = resource_budget(inv, host)
    assert budget["host_required_bytes"] > 4 * GIB
    with pytest.raises(RuntimeError, match="RAM"):
        resource_budget(inv, dict(host, available_bytes=2 * GIB))
    with pytest.raises(RuntimeError, match="time/disk"):
        resource_budget(inv, dict(host, disk_free_bytes=GIB))
    inv["test_tiles"] = 10000000
    with pytest.raises(RuntimeError, match="time/disk"):
        resource_budget(inv, host)


def test_output_requires_every_category_count_and_finite_metric(tmp_path):
    inv = inventory(dataset(tmp_path), "mvtec")
    rows = []
    for cat in inv["categories"]:
        row = dict.fromkeys(ROW_KEYS, 1.0)
        row.update(
            dataset="mvtec",
            category=cat,
            method="dinomaly_vitb",
            mode="unified",
            perturbation=None,
            n_good=1,
            n_defect=1,
            fa_ci95=[0.0, 1.0],
        )
        rows.append(row)
    validate_rows(rows, inv)
    with pytest.raises(RuntimeError):
        validate_rows(rows[:-1], inv)
    rows[0]["threshold"] = float("nan")
    with pytest.raises(RuntimeError, match="nonfinite"):
        validate_rows(rows, inv)


def test_isolated_settings_and_source_manifest():
    root = Path(__file__).parents[1]
    for name in ("mvtec", "wfdd", "aitex"):
        folder = root / "training/fault/kaggle" / f"a2_{name}"
        metadata = json.loads((folder / "kernel-metadata.json").read_text())
        assert metadata["id"] == f"anastabba/texpilot-a2-{name}-amp-10k"
        assert metadata["is_private"] and len(metadata["dataset_sources"]) == 2
        source = (folder / "run.py").read_text()
        assert f'DATASET = "{name}"' in source
        assert "ITERS = 10000" in source and "AMP = True" in source
        manifest = json.loads((folder / "source-manifest.json").read_text())
        assert "training/fault/methods/_upstream.py" in manifest

        # These archived launch snapshots pin code/7; live working source may advance.
        # Validate their immutable manifest against the embedded snapshot contract.
        tree = ast.parse(source)
        embedded = next(
            ast.literal_eval(n.value)
            for n in tree.body
            if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "EXPECTED" for t in n.targets)
        )
        assert embedded == manifest


@pytest.mark.parametrize("name", ["mvtec", "wfdd", "aitex"])
def test_probe_forces_preflight_even_without_cli_args(monkeypatch, name):
    import runpy
    import signal
    import sys

    import training.fault.kaggle.full_a2 as full

    root = Path(__file__).parents[1].resolve()
    calls = []
    alarms = []
    monkeypatch.setattr(full, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    monkeypatch.setattr(Path, "rglob", lambda *_: iter([root / "training/fault/bench.py"]))
    monkeypatch.setattr(signal, "alarm", alarms.append)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(sys, "path", sys.path.copy())
    folder = root / "training/fault/kaggle" / f"a2_{name}_probe"
    runpy.run_path(str(folder / "run.py"), run_name="__main__")
    assert calls[0][0][0] == name
    assert calls[0][1] == {"preflight_only": True}
    assert alarms == [900]
    metadata = json.loads((folder / "kernel-metadata.json").read_text())
    assert metadata["id"] == f"anastabba/texpilot-a2-{name}-preflight"
    assert metadata["enable_internet"] is False
    assert metadata["dataset_sources"] == calls[0][0][3]
