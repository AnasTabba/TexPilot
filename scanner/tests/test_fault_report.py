"""Results report: every number comes from a JSON file, missing values render as a dash."""

import json
from pathlib import Path

from training.fault.report import render


def _row(category: str, **kw) -> dict:
    base = {
        "dataset": "mvtec",
        "category": category,
        "method": "dino",
        "mode": "ft",
        "perturbation": None,
        "auroc": 0.9,
        "ap": None,
        "pixel_auroc": None,
        "pixel_ap": None,
        "aupro": None,
        "f1": None,
        "recall": 0.9,
        "precision": None,
        "false_alarms_per_1000": 10.0,
        "fa_ci95": None,
        "n_good": 100,
        "n_defect": 10,
        "threshold": 0.5,
        "latency_ms": 40.0,
        "tiles_per_image": 4,
    }
    base.update(kw)
    return base


def _write(folder: Path, name: str, rows: list[dict]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(rows), encoding="utf-8")


def test_table_has_both_rows_values_and_source_file(tmp_path: Path):
    _write(
        tmp_path,
        "mvtec__dino__ft.json",
        [
            _row("carpet", auroc=0.9, pixel_auroc=None, aupro=0.8, latency_ms=40.0),
            _row("grid", auroc=0.7, pixel_auroc=0.6, aupro=None, latency_ms=60.0),
        ],
    )
    out = render([tmp_path])
    # image AUROC mean over the two categories: (90 + 70) / 2
    assert "| mvtec | dino | ft | 2 | 80.0 | 60.0 | 80.0 |" in out
    # ms/image mean: (40 + 60) / 2
    assert "50.0 |" in out
    assert "`mvtec__dino__ft.json`" in out
    assert "None" not in out
    assert "nan" not in out


def test_missing_metric_renders_dash(tmp_path: Path):
    _write(tmp_path, "mvtec__dino__ft.json", [_row("carpet", f1=None, recall=None)])
    out = render([tmp_path])
    table_line = next(line for line in out.splitlines() if line.startswith("| mvtec | dino"))
    cells = [c.strip() for c in table_line.strip("|").split("|")]
    assert cells[7] == "—"  # F1 column
    assert "None" not in out
    assert "nan" not in out


def test_jury_bar_pass_and_miss(tmp_path: Path):
    _write(
        tmp_path,
        "aitex__good__ft.json",
        [
            _row("01", dataset="aitex", method="good", auroc=0.98, recall=0.95,
                 n_defect=20, false_alarms_per_1000=2.0, n_good=500),
            _row("02", dataset="aitex", method="good", auroc=0.98, recall=0.95,
                 n_defect=20, false_alarms_per_1000=2.0, n_good=500),
        ],
    )
    _write(
        tmp_path,
        "aitex__weak__ft.json",
        [
            _row("01", dataset="aitex", method="weak", auroc=0.95, recall=0.85,
                 n_defect=20, false_alarms_per_1000=9.0, n_good=500),
        ],
    )
    out = render([tmp_path])
    good = next(line for line in out.splitlines() if line.startswith("| good |"))
    weak = next(line for line in out.splitlines() if line.startswith("| weak |"))
    assert "PASS (98.0 %)" in good
    assert "PASS (95.0 %)" in good
    assert "PASS (2.0 / 1000)" in good
    assert "MISS (95.0 %)" in weak
    assert "MISS (85.0 %)" in weak
    assert "MISS (9.0 / 1000)" in weak


def test_empty_directory_says_no_results(tmp_path: Path):
    empty = tmp_path / "empty"
    empty.mkdir()
    out = render([empty, tmp_path / "does-not-exist"])
    assert "No results found" in out
