"""The results roll-up for the report: every number with its domain and n. Stdlib only."""

import json

from training.scanner.results import build


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data) if isinstance(data, dict) else data)


def test_with_nothing_measured_every_section_says_pending(tmp_path):
    page = build(tmp_path)
    assert page.count("Not measured yet") >= 4 and "Traceback" not in page


def test_the_benchmark_headline_is_chosen_on_val_and_set_against_the_baseline(tmp_path):
    for seed, (val, test) in enumerate([(0.70, 0.72), (0.71, 0.72), (0.69, 0.72)]):
        _write(tmp_path / f"runs/fabric/probe/seed{seed}/test_metrics.json",
               {"partition": "fabric", "tag": "probe", "best": {"val_top1": val},
                "test": {"top1": test, "n": 40970}})  # fmt: skip
    page = build(tmp_path)
    assert "72.00 ± 0.00" in page and "+4.68" in page  # vs ViT-Tiny's published 67.32
    assert "catalog" in page and "40,970" in page


def test_each_bundle_head_is_listed_with_its_domain_and_n(tmp_path):
    head = {"val": {"n": 9474, "top1": 0.7057}, "test": {"n": 40970, "top1": 0.7199},
            "coverage_val": 0.4887, "ece_val_before": 0.0769, "ece_val_after": 0.0126}  # fmt: skip
    _write(tmp_path / "models/scanner-v1/bundle.json", {"version": 1, "heads": {"structure": head}})
    page = build(tmp_path)
    assert "scanner-v1" in page and "structure" in page
    assert "0.720" in page and "49%" in page and "0.077 → 0.013" in page and "40,970" in page


def test_the_phone_bake_off_is_included_when_it_exists(tmp_path):
    _write(tmp_path / "results/bakeoff/bakeoff.md", "# Bake-off (domain: phone, n = 87)\n\nrows")
    page = build(tmp_path)
    assert "domain: phone, n = 87" in page and "rows" in page
