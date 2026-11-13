"""Synthetic parity-gate mechanics only; no model/export/hardware proof (G6/G8).

Real comparisons must use outputs of the single qc_policy evaluator, never infer decisions here.
The status values below are synthetic fixtures, not evaluated model results.
All numbers/threshold-adjacent tags below are synthetic, not deployment tolerances.
"""

from __future__ import annotations

from copy import deepcopy
from math import isfinite

import pytest


def compare_parity(reference, candidate, *, score_tolerance, density_tolerance):
    """Compare supplied outputs, with exact per-sample region-set agreement.

    Region order is immaterial; capture, transform, label and normalized box must
    match exactly. No IoU matching can hide a disappeared/shifted region. Scores
    include every compared head/view/region score under stable caller-supplied keys.
    Densities are already normalized count/in; errors retain those units. Caller
    tags boundary cases before comparison and supplies independently approved limits.
    A true parity_passed is only a comparison result, never release authority.
    """
    for tolerance in (score_tolerance, density_tolerance):
        _finite_number(tolerance)
        if tolerance < 0:
            raise ValueError("negative tolerance")
    left, right = _parity_rows(reference), _parity_rows(candidate)
    if left.keys() != right.keys():
        raise ValueError("sample IDs differ")
    score_errors, density_errors, changed, adjacent_changed = [], [], [], []
    region_matches = 0
    for sample_id in sorted(left):
        a, b = left[sample_id], right[sample_id]
        if a["threshold_adjacent"] != b["threshold_adjacent"]:
            raise ValueError("boundary tags differ")
        for field, errors in (("scores", score_errors), ("densities", density_errors)):
            if a[field].keys() != b[field].keys():
                raise ValueError("output keys differ")
            errors.extend(abs(a[field][key] - b[field][key]) for key in a[field])
        region_matches += set(a["regions"]) == set(b["regions"])
        if a["status"] != b["status"]:
            changed.append(sample_id)
            if a["threshold_adjacent"]:
                adjacent_changed.append(sample_id)
    max_score, max_density = max(score_errors), max(density_errors)
    return {
        "maximum_score_error": max_score,
        "maximum_density_error": max_density,
        "region_agreement": region_matches / len(left),
        "decision_status_equal": not changed,
        "status_changes": tuple(changed),
        "threshold_adjacent_status_changes": tuple(adjacent_changed),
        "parity_passed": (
            not changed
            and region_matches == len(left)
            and max_score <= score_tolerance
            and max_density <= density_tolerance
        ),
    }


def _finite_number(value):
    if type(value) not in (int, float) or not isfinite(value):
        raise ValueError("finite numeric value required")


def _parity_rows(table):
    if not isinstance(table, (list, tuple)) or not table:
        raise ValueError("nonempty table required")
    rows = {}
    fields = {
        "id",
        "scores",
        "densities",
        "density_unit",
        "regions",
        "status",
        "threshold_adjacent",
    }
    for row in table:
        if not isinstance(row, dict) or row.keys() != fields:
            raise ValueError("incomplete/unknown row fields")
        sample_id = row["id"]
        if not isinstance(sample_id, str) or not sample_id or sample_id in rows:
            raise ValueError("unique sample ID required")
        if row["status"] not in ("ACCEPT", "HOLD", "RECAPTURE", "MANUAL_REVIEW"):
            raise ValueError("invalid decision status")
        if type(row["threshold_adjacent"]) is not bool or row["density_unit"] != "count/in":
            raise ValueError("explicit boundary tag and canonical density unit required")
        for field in ("scores", "densities"):
            values = row[field]
            if not isinstance(values, dict) or not values:
                raise ValueError("nonempty output map required")
            for key, value in values.items():
                if not isinstance(key, str) or not key:
                    raise ValueError("named output required")
                _finite_number(value)
                if field == "densities" and value < 0:
                    raise ValueError("negative density")
        if not isinstance(row["regions"], (list, tuple)):
            raise ValueError("explicit regions required")
        for region in row["regions"]:
            if not isinstance(region, tuple) or len(region) != 4:
                raise ValueError("region needs capture, transform, label and box")
            capture, transform, label, box = region
            if any(not isinstance(v, str) or not v for v in (capture, transform)):
                raise ValueError("region provenance required")
            if label is not None and (not isinstance(label, str) or not label):
                raise ValueError("invalid region label")
            if not isinstance(box, tuple) or len(box) != 4:
                raise ValueError("four normalized box coordinates required")
            for value in box:
                _finite_number(value)
                if not 0 <= value <= 1:
                    raise ValueError("box outside image")
            if not (box[0] < box[2] and box[1] < box[3]):
                raise ValueError("unordered box")
        if len(set(row["regions"])) != len(row["regions"]):
            raise ValueError("duplicate region")
        rows[sample_id] = row
    return rows


def synthetic_table():
    """Tiny synthetic FP32-output table with canonical count/in density values."""
    return [
        {
            "id": "synthetic-below-score-boundary",
            "scores": {"fabric": 0.9, "defect": 0.199999},
            "densities": {"ends": 72.000001, "picks": 68.0},
            "density_unit": "count/in",
            "regions": [
                ("synthetic-capture-a", "synthetic-transform", "spot", (0.1, 0.2, 0.3, 0.4))
            ],
            "status": "ACCEPT",
            "threshold_adjacent": True,
        },
        {
            "id": "synthetic-at-boundary",
            "scores": {"fabric": 0.9, "defect": 0.2},
            "densities": {"ends": 72.0, "picks": 68.0},
            "density_unit": "count/in",
            "regions": [],
            "status": "MANUAL_REVIEW",
            "threshold_adjacent": True,
        },
        {
            "id": "synthetic-above-density-boundary",
            "scores": {"fabric": 0.9, "defect": 0.200001},
            "densities": {"ends": 71.999999, "picks": 68.0},
            "density_unit": "count/in",
            "regions": [],
            "status": "HOLD",
            "threshold_adjacent": True,
        },
        {
            "id": "synthetic-unavailable",
            "scores": {"fabric": 0.1, "defect": 0.3},
            "densities": {"ends": 75.0, "picks": 68.0},
            "density_unit": "count/in",
            "regions": [],
            "status": "MANUAL_REVIEW",
            "threshold_adjacent": False,
        },
    ]


def synthetic_comparison(reference, candidate, **limits):
    return compare_parity(
        reference,
        candidate,
        score_tolerance=limits.get("score_tolerance", 0.001),
        density_tolerance=limits.get("density_tolerance", 0.01),
    )


def test_synthetic_identical_tables_align_by_id_not_row_order_and_do_not_mutate():
    reference = synthetic_table()
    before = deepcopy(reference)
    report = synthetic_comparison(reference, list(reversed(deepcopy(reference))))
    assert report == {
        "maximum_score_error": 0.0,
        "maximum_density_error": 0.0,
        "region_agreement": 1.0,
        "decision_status_equal": True,
        "status_changes": (),
        "threshold_adjacent_status_changes": (),
        "parity_passed": True,
    }
    assert reference == before


def test_synthetic_maximum_errors_and_region_disagreement_are_reported():
    reference = synthetic_table()
    candidate = deepcopy(reference)
    candidate[0]["scores"]["fabric"] += 0.0005
    candidate[1]["densities"]["picks"] += 0.005
    candidate[0]["regions"] = []
    report = synthetic_comparison(reference, candidate)
    assert report["maximum_score_error"] == pytest.approx(0.0005)
    assert report["maximum_density_error"] == pytest.approx(0.005)
    assert report["region_agreement"] == 0.75
    assert report["decision_status_equal"] is True
    assert report["parity_passed"] is False


@pytest.mark.parametrize("index", [0, 1, 2])
@pytest.mark.parametrize("status", ["ACCEPT", "HOLD", "RECAPTURE", "MANUAL_REVIEW"])
def test_synthetic_single_boundary_status_change_blocks_even_with_tiny_error(index, status):
    reference = synthetic_table()
    candidate = deepcopy(reference)
    original = candidate[index]["status"]
    candidate[index]["status"] = status
    candidate[index]["scores"]["defect"] += 0.0000001
    report = synthetic_comparison(reference, candidate)
    assert report["maximum_score_error"] < 0.001
    assert report["parity_passed"] is (status == original)
    assert report["decision_status_equal"] is (status == original)
    expected = () if status == original else (reference[index]["id"],)
    assert report["threshold_adjacent_status_changes"] == expected


def test_synthetic_nonboundary_status_change_also_blocks():
    reference = synthetic_table()
    candidate = deepcopy(reference)
    candidate[3]["status"] = "ACCEPT"
    report = synthetic_comparison(reference, candidate)
    assert report["status_changes"] == ("synthetic-unavailable",)
    assert report["threshold_adjacent_status_changes"] == ()
    assert report["parity_passed"] is False


@pytest.mark.parametrize(
    "field,key,delta", [("scores", "fabric", 0.002), ("densities", "ends", 0.02)]
)
def test_synthetic_numeric_tolerance_violation_blocks_unchanged_decisions(field, key, delta):
    reference = synthetic_table()
    candidate = deepcopy(reference)
    candidate[0][field][key] += delta
    report = synthetic_comparison(reference, candidate)
    assert report["decision_status_equal"] is True
    assert report["parity_passed"] is False


def test_synthetic_regions_preserve_capture_transform_label_and_box():
    reference = synthetic_table()
    candidate = deepcopy(reference)
    region = reference[0]["regions"][0]
    reference[0]["regions"].append(("synthetic-capture-b", *region[1:]))
    candidate = deepcopy(reference)
    candidate[0]["regions"].reverse()
    assert synthetic_comparison(reference, candidate)["region_agreement"] == 1.0
    candidate[0]["regions"] = [region, region]
    with pytest.raises(ValueError):
        synthetic_comparison(reference, candidate)


@pytest.mark.parametrize("component", ["capture", "transform", "label", "box"])
def test_synthetic_region_provenance_or_geometry_change_blocks(component):
    reference = synthetic_table()
    candidate = deepcopy(reference)
    capture, transform, label, box = candidate[0]["regions"][0]
    replacement = {
        "capture": ("synthetic-other-capture", transform, label, box),
        "transform": (capture, "synthetic-other-transform", label, box),
        "label": (capture, transform, "synthetic-other-label", box),
        "box": (capture, transform, label, (0.100001, 0.2, 0.3, 0.4)),
    }
    candidate[0]["regions"] = [replacement[component]]
    report = synthetic_comparison(reference, candidate)
    assert report["region_agreement"] == 0.75
    assert report["parity_passed"] is False


@pytest.mark.parametrize(
    "field", ["scores", "densities", "regions", "status", "threshold_adjacent"]
)
def test_synthetic_missing_fields_fail_closed(field):
    reference = synthetic_table()
    candidate = deepcopy(reference)
    del candidate[0][field]
    with pytest.raises(ValueError):
        synthetic_comparison(reference, candidate)


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), float("-inf"), True, "0.2"])
@pytest.mark.parametrize("field,key", [("scores", "defect"), ("densities", "ends")])
def test_synthetic_invalid_numbers_fail_closed(bad, field, key):
    reference = synthetic_table()
    candidate = deepcopy(reference)
    candidate[0][field][key] = bad
    with pytest.raises(ValueError):
        synthetic_comparison(reference, candidate)


@pytest.mark.parametrize(
    "malformation",
    ["empty", "missing-row", "duplicate-id", "keys", "unit", "status", "tag", "region"],
)
def test_synthetic_incomplete_or_invalid_tables_fail_closed(malformation):
    reference = synthetic_table()
    candidate = deepcopy(reference)
    if malformation == "empty":
        reference = candidate = []
    elif malformation == "missing-row":
        candidate.pop()
    elif malformation == "duplicate-id":
        candidate.append(deepcopy(candidate[0]))
    elif malformation == "keys":
        del candidate[0]["densities"]["picks"]
    elif malformation == "unit":
        candidate[0]["density_unit"] = "count/cm"
    elif malformation == "status":
        candidate[0]["status"] = "PASS"
    elif malformation == "tag":
        candidate[0]["threshold_adjacent"] = False
    else:
        candidate[0]["regions"] = [
            ("synthetic-capture-a", "transform", "spot", (0.4, 0.2, 0.1, 0.4))
        ]
    with pytest.raises(ValueError):
        synthetic_comparison(reference, candidate)


@pytest.mark.parametrize("bad", [-1, None, float("nan"), float("inf"), True])
@pytest.mark.parametrize("limit", ["score_tolerance", "density_tolerance"])
def test_synthetic_invalid_tolerances_fail_closed(bad, limit):
    with pytest.raises(ValueError):
        synthetic_comparison(synthetic_table(), synthetic_table(), **{limit: bad})


@pytest.mark.skip(reason="External gates G6/G8: no real bundle, export or target hardware here")
def test_real_bundle_fp32_export_target_parity():
    """Requires held-out/challenge and boundary tables from the actual target execution."""
