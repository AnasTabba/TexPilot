"""Synthetic four-arm experiments; these are not release or performance evidence."""

from dataclasses import replace

import pytest

from services.api.qc_schemas import sha256_hex
from training.qc.ablations import ARMS, ArmManifest, ArmSpec, CohortUnit, evaluate_arms
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord


@pytest.fixture
def synthetic_arms():
    source = SourceRecord(
        "synthetic", "1", "synthetic://generated", "synthetic-test-only", ("research",)
    )
    calibration = DatasetManifest(
        "synthetic-calibration",
        "1",
        "research",
        (source,),
        (
            ManifestItem(
                "synthetic-cal",
                "synthetic",
                sha256_hex("cal"),
                "calibration",
                "normal",
                "valid-clean",
                mask_sha256=sha256_hex("synthetic-cal-mask"),
                lot_id="synthetic-cal-lot",
            ),
        ),
    )
    items, outcomes = [], []
    for n in range(20):
        item_id = f"synthetic-{n}"
        items.append(
            ManifestItem(
                item_id,
                "synthetic",
                sha256_hex(item_id),
                "release_test",
                "defective" if n >= 10 else "normal",
                "valid-defective" if n >= 10 else "valid-clean",
                lot_id=item_id,
                mask_sha256=sha256_hex(f"synthetic-mask-{n}"),
                cohort="CONFIRMATORY",
                selection_id=f"synthetic-selection-{n}",
                plan_sha256=sha256_hex("synthetic-plan"),
                roll_id=f"synthetic-roll-{n}",
                factory_id="synthetic-factory",
                face="face",
                location_ref=f"synthetic-location-{n}",
                selection_probability=0.5,
                supplier_id="synthetic-supplier", sampling_method="synthetic-randomized",
                planned_area_cm2=1.0, usable_area_cm2=1.0,
            )
        )
        accepted = frozenset(ARMS if n < 10 else ("classifier-only", "classifier+metrology"))
        outcomes.append(CohortUnit(item_id, item_id, n >= 10, accepted, frozenset(ARMS)))
    cohort = DatasetManifest("synthetic-cohort", "1", "research", (source,), tuple(items))
    specs = tuple(
        ArmSpec(
            name, sha256_hex(name), "calibration", calibration.sha256(), 0.05, ("synthetic-cal",)
        )
        for name in ARMS
    )
    manifest = ArmManifest(specs, 0.5, 7, 200, calibration, tuple(outcomes), cohort.sha256())
    return manifest, cohort


def test_synthetic_four_arms_same_full_reference_and_paired_group_intervals(synthetic_arms):
    manifest, cohort = synthetic_arms
    report = evaluate_arms(manifest, cohort)
    assert tuple(a.name for a in report.arms) == ARMS
    assert report.cohort_sha256 == cohort.sha256()
    assert report.groups == 20
    assert report.winner is None
    classifier, defects, metrology, fusion = report.arms
    assert classifier.failures == metrology.failures == 10
    assert defects.failures == fusion.failures == 0
    assert classifier.coverage == 1.0 and defects.coverage == 0.5
    assert defects.risk_upper < classifier.risk_upper
    assert defects.coverage_gain_vs_reference == -0.5
    assert defects.coverage_gain_interval95 == fusion.coverage_gain_interval95
    assert classifier.coverage_gain_interval95 == (0.0, 0.0)
    assert report.claim == "risk-bounded paired coverage gain"
    assert any("non-inferiority" in n for n in report.notes)
    assert any("Confirmatory" in n for n in report.notes)
    assert all(a.conclusion not in ("GAIN", "LOSS") for a in report.arms)
    assert evaluate_arms(manifest, cohort) == report


@pytest.mark.parametrize(
    "damage",
    [
        "missing-arm",
        "duplicate-arm",
        "release-fit",
        "same-cohort-fit",
        "release-id-fit",
        "overlapping-fit-group",
        "missing-reference",
        "missing-arm-output",
        "extra-row",
        "truncated",
        "zero-resamples",
        "bad-hash",
    ],
)
def test_synthetic_incomplete_or_leaky_arms_fail(synthetic_arms, damage):
    manifest, cohort = synthetic_arms
    first = manifest.arms[0]
    if damage == "missing-arm":
        manifest = replace(manifest, arms=manifest.arms[:-1])
    elif damage == "duplicate-arm":
        manifest = replace(manifest, arms=(*manifest.arms[:-1], first))
    elif damage == "release-fit":
        first = replace(first, fitted_on="release_test")
    elif damage == "same-cohort-fit":
        first = replace(first, fit_cohort_sha256=cohort.sha256())
    elif damage == "release-id-fit":
        first = replace(first, fit_ids=("synthetic-0",))
    elif damage == "overlapping-fit-group":
        cal = manifest.calibration
        manifest = replace(
            manifest, calibration=replace(cal, items=(replace(cal.items[0], lot_id="synthetic-0"),))
        )
    elif damage in ("missing-reference", "missing-arm-output"):
        row = manifest.outcomes[0]
        row = replace(
            row,
            **(
                {"reference_nonconforming": None}
                if damage == "missing-reference"
                else {"evaluated_by": frozenset(ARMS[:-1])}
            ),
        )
        manifest = replace(manifest, outcomes=(row, *manifest.outcomes[1:]))
    elif damage == "extra-row":
        manifest = replace(
            manifest,
            outcomes=(*manifest.outcomes, replace(manifest.outcomes[0], unit_id="synthetic-extra")),
        )
    elif damage == "truncated":
        cohort = replace(cohort, items=cohort.items[:-1])
    elif damage == "zero-resamples":
        manifest = replace(manifest, bootstrap_resamples=0)
    else:
        first = replace(first, thresholds_sha256="unpinned")
    manifest = (
        replace(manifest, arms=(first, *manifest.arms[1:]))
        if damage not in ("missing-arm", "duplicate-arm")
        else manifest
    )
    with pytest.raises(ValueError):
        evaluate_arms(manifest, cohort)


def test_synthetic_repeated_capture_does_not_inflate_independent_n(synthetic_arms):
    manifest, cohort = synthetic_arms
    extra = replace(cohort.items[0], id="synthetic-repeat", image_sha256=sha256_hex("repeat"))
    cohort = replace(cohort, items=(*cohort.items, extra))
    row = replace(manifest.outcomes[0], unit_id=extra.id)
    manifest = replace(manifest, outcomes=(*manifest.outcomes, row), cohort_sha256=cohort.sha256())
    assert evaluate_arms(manifest, cohort).groups == 20


def test_synthetic_transductive_protocol_is_bound_and_exploratory(synthetic_arms):
    manifest, cohort = synthetic_arms
    first = replace(manifest.arms[0], transductive=True)
    manifest = replace(manifest, arms=(first, *manifest.arms[1:]))
    with pytest.raises(ValueError, match="transductive"):
        evaluate_arms(manifest, cohort)
    first = replace(
        first,
        transductive_cohort_sha256=cohort.sha256(),
        chunks=(tuple(i.id for i in cohort.items),),
    )
    manifest = replace(manifest, arms=(first, *manifest.arms[1:]))
    report = evaluate_arms(manifest, cohort)
    assert report.exploratory
    assert report.transductive_protocols[first.name] == (cohort.sha256(), first.chunks)
    assert any("stationary" in n for n in report.notes)


def test_synthetic_hold_all_has_zero_useful_accept_coverage(synthetic_arms):
    manifest, cohort = synthetic_arms
    manifest = replace(
        manifest, outcomes=tuple(replace(row, accepted_by=frozenset()) for row in manifest.outcomes)
    )
    report = evaluate_arms(manifest, cohort)
    assert all(a.coverage == 0 and not a.risk_met for a in report.arms)
    assert report.winner is None
