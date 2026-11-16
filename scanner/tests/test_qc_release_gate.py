"""Synthetic arithmetic and authority doubles; no actual release approvals."""

import math
from dataclasses import asdict, replace

import pytest

from services.api.qc_schemas import canonical_json, sha256_hex
from training.qc import calibrate as cal
from training.qc import release_gate as gate
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
from training.qc.workflow_metrics import DecisionEvent, Reference, aggregate, reduce_workflow


def synthetic_hash(label):
    return sha256_hex("synthetic:" + label)


def synthetic_audit(rows, purpose="release-evaluation"):
    """A clean audit of a synthetic manifest carrying the same selections and groups."""
    items = tuple(
        ManifestItem(
            f"item-{row.selection_id}",
            "synthetic-source",
            synthetic_hash("img:" + row.selection_id),
            "release_test",
            "normal",
            "valid-clean",
            mask_sha256=synthetic_hash("mask"),
            roll_id=f"roll-{row.independent_group_id}",
            lot_id=f"lot-{row.independent_group_id}",
            cohort="CONFIRMATORY",
            selection_id=row.selection_id,
            plan_sha256=synthetic_hash("plan"),
            face="face",
            location_ref=f"loc-{row.selection_id}",
            selection_probability=0.5,
            factory_id="synthetic-factory",
            supplier_id="synthetic-supplier",
            sampling_method="synthetic-randomized",
            planned_area_cm2=1.0,
            usable_area_cm2=1.0,
        )
        for row in rows
    )
    manifest = DatasetManifest(
        "synthetic-manifest",
        "1",
        purpose,
        (
            SourceRecord(
                "synthetic-source", "1", "synthetic://double", "CC-BY-4.0", (purpose,)
            ),
        ),
        items,
    )
    return manifest, audit_splits(manifest)


def resealed(report, authority, **changes):
    """Re-seal the plan with new decision parameters; the authority must follow them."""
    plan = replace(authority.plan, **changes)
    authority = replace(authority, plan=plan, **changes)
    return replace(report, plan_sha256=plan.sha256()), authority


def synthetic_inputs(tmp_path, n=3, status="ACCEPT", truth="CONFORMING", alpha=0.05):
    rows = tuple(
        reduce_workflow(
            [
                DecisionEvent(
                    f"synthetic-{i}",
                    f"synthetic-{i}",
                    f"synthetic-{i}",
                    "synthetic-v1",
                    status,
                    True,
                    1,
                    1,
                )
            ],
            Reference(f"synthetic-{i}", {"synthetic-v1": truth}, True),
        )
        for i in range(n)
    )
    plan = gate.ReleasePlan(
        (
            gate.DomainPlan(
                "synthetic-domain",
                n,
                alpha,
                enrollments=tuple((o.selection_id, o.independent_group_id) for o in rows),
            ),
        ),
        "2000-01-01T00:00:00Z",
        bootstrap_seed=19,
        bootstrap_replicates=40,
        risk_target=0.9,
        family_alpha=alpha,
        hold_criterion=None,
    )
    authority = gate.Authority(
        "synthetic-authority-double",
        0.9,
        alpha,
        "synthetic-signatory-double",
        synthetic_hash("sampling"),
        synthetic_hash("authority"),
        plan=plan,
        cohort_registry=str(tmp_path / "synthetic-registry.sqlite"),
    )
    domain = gate.DomainReport(
        "synthetic-domain",
        alpha,
        aggregate(rows),
        n,
        1,
        n,
        n,
        n if truth == "CONFORMING" else 0,
        outcomes=rows,
    )
    manifest, audit = synthetic_audit(rows)
    report = gate.ReleaseReport(
        synthetic_hash("release"),
        synthetic_hash("calibration"),
        ("synthetic-calibration",),
        tuple(r.independent_group_id for r in rows),
        (domain,),
        "2000-01-01T00:00:00Z",
        "2000-01-02T00:00:00Z",
        False,
        synthetic_hash("binding"),
        synthetic_hash("binding"),
        True,
        manifest_sha256=manifest.sha256(),
        audit_sha256=sha256_hex(canonical_json(asdict(audit))),
        audit=audit,
        plan_sha256=plan.sha256(),
        bootstrap_replicates=40,
        bootstrap_seed=19,
    )
    return report, authority


def test_exact_zero_boundary_all_failures():
    assert gate.false_accept_upper(0, 298, 0.05) > 0.01
    assert gate.false_accept_upper(0, 299, 0.05) <= 0.01
    for n in (1, 4, 298, 299, 10000):
        assert gate.false_accept_upper(0, n, 0.05) == pytest.approx(1 - 0.05 ** (1 / n))
        assert gate.false_accept_upper(n, n, 0.05) == 1
    assert gate.false_accept_upper(0, 0, 0.05) == 1


@pytest.mark.parametrize("x,n,a", [(1, 3, 0.05), (2, 8, 0.025), (7, 9, 0.1), (3, 30, 0.01)])
def test_nonzero_bound_independent_binomial_tail(x, n, a):
    p = gate.false_accept_upper(x, n, a)
    assert sum(math.comb(n, k) * p**k * (1 - p) ** (n - k) for k in range(x + 1)) == pytest.approx(
        a, rel=1e-11
    )


@pytest.mark.parametrize(
    "x,n,a",
    [
        (-1, 3, 0.05),
        (4, 3, 0.05),
        (0, -1, 0.05),
        (True, 3, 0.05),
        (0, 3.0, 0.05),
        (0, 3, 0),
        (0, 3, 1),
        (0, 3, float("nan")),
        (0, 3, True),
        (0, 3, "0.05"),
    ],
)
def test_invalid_bound_inputs(x, n, a):
    with pytest.raises(ValueError):
        gate.false_accept_upper(x, n, a)


def test_candidate_requires_t12_g8(tmp_path):
    r, a = synthetic_inputs(tmp_path)
    result = gate.evaluate_release(r, a)
    assert result.state == "STATISTICAL_CANDIDATE" and not result.activatable
    assert result.mode == "REVIEW_ONLY"
    assert result.activation_requirements == ("T12_TARGET_PROOF", "G8")
    d = result.domains[0]
    assert d.accept_released and not d.hold_released
    assert "HOLD_CRITERION_MISSING" in d.reasons
    assert d.prevalence == 0 and d.uncertainty["all_submission_coverage"].point == 1


@pytest.mark.parametrize(
    "field,value,reason",
    [
        ("risk_target", None, "AUTHORITY_RISK_TARGET_MISSING"),
        ("risk_target", float("nan"), "AUTHORITY_RISK_TARGET_MISSING"),
        ("sampling_agreement_sha256", None, "SAMPLING_AGREEMENT_MISSING"),
        ("independent_signatory", " SYNTHETIC-AUTHORITY-DOUBLE ", "SIGNATORY_NOT_INDEPENDENT"),
        ("independent_signatory", None, "INDEPENDENT_SIGNATORY_MISSING"),
        ("plan", None, "PREDECLARED_PLAN_MISSING"),
        ("cohort_registry", None, "COHORT_REGISTRY_REQUIRED"),
    ],
)
def test_required_authority(tmp_path, field, value, reason):
    r, a = synthetic_inputs(tmp_path)
    out = gate.evaluate_release(r, replace(a, **{field: value}))
    assert out.state == "NO_RELEASE" and reason in out.reasons


def test_zero_sparse_and_high_classifier_f1_cannot_override_qc_failure(tmp_path):
    r, a = synthetic_inputs(tmp_path, n=0)
    assert gate.evaluate_release(r, a).state == "NO_RELEASE"
    r, a = synthetic_inputs(tmp_path / "sparse")
    r, a = resealed(r, a, risk_target=0.01)
    out = gate.evaluate_release(r, a)
    assert out.review_only_domains == ("synthetic-domain",)
    assert "SPARSE_DOMAIN" in out.domains[0].reasons
    r, a = synthetic_inputs(tmp_path / "bad", truth="NONCONFORMING")
    r = replace(r, domains=(replace(r.domains[0], fabric_macro_f1=1.0),))
    assert gate.evaluate_release(r, a).state == "NO_RELEASE"


def test_alpha_split_and_predeclared_plan(tmp_path):
    assert gate.false_accept_upper(0, 299, 0.025) > 0.01
    assert math.ceil(math.log(0.025) / math.log(0.99)) > 299
    r, a = synthetic_inputs(tmp_path)
    r = replace(r, domains=(replace(r.domains[0], alpha=0.025),))
    assert "PLAN_MISMATCH" in gate.evaluate_release(r, a).reasons


def test_hold_endpoints_share_family_alpha(tmp_path):
    r, a = synthetic_inputs(tmp_path)
    plan = replace(
        a.plan,
        domains=(
            replace(
                a.plan.domains[0],
                accept_alpha=0.05,
                hold_precision_alpha=0.025,
                hold_rate_alpha=0.025,
            ),
        ),
        hold_criterion=gate.HoldCriterion(0.5, 0.5),
    )
    r = replace(r, plan_sha256=plan.sha256())
    a = replace(a, plan=plan, hold_criterion=gate.HoldCriterion(0.5, 0.5))
    assert "ALPHA_ALLOCATION_EXCEEDS_FAMILY" in gate.evaluate_release(r, a).reasons


@pytest.mark.parametrize(
    "change,reason",
    [({"looks": 2}, "UNPLANNED_INTERIM_LOOK"), ({"planned_units": 4}, "PLAN_MISMATCH")],
)
def test_fixed_stopping(tmp_path, change, reason):
    r, a = synthetic_inputs(tmp_path)
    out = gate.evaluate_release(replace(r, domains=(replace(r.domains[0], **change),)), a)
    assert out.state == "NO_RELEASE"
    assert reason in out.reasons or reason in out.domains[0].reasons


def test_cannot_inflate_counts(tmp_path):
    r, a = synthetic_inputs(tmp_path)
    d = r.domains[0]
    out = gate.evaluate_release(
        replace(r, domains=(replace(d, counts=replace(d.counts, accepted_independent_units=299)),)),
        a,
    )
    assert out.state == "NO_RELEASE" and "COUNTS_MISMATCH" in out.reasons


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"calibration_group_ids": ("synthetic-0",)}, "CALIBRATION_RELEASE_OVERLAP"),
        (
            {"serving_binding_sha256": synthetic_hash("changed")},
            "CALIBRATION_DOES_NOT_MATCH_SERVING",
        ),
        ({"reference_records_eligible": False}, "REFERENCE_RECORDS_INELIGIBLE"),
        (
            {"thresholds_frozen_at": "2000-01-03T00:00:00Z"},
            "THRESHOLDS_NOT_FROZEN_BEFORE_UNBLINDING",
        ),
    ],
)
def test_bindings_and_references(tmp_path, change, reason):
    r, a = synthetic_inputs(tmp_path)
    out = gate.evaluate_release(replace(r, **change), a)
    assert out.state == "NO_RELEASE" and reason in out.reasons


def test_failed_cohort_persistently_frozen_after_tuning_and_hash_change(tmp_path):
    r, a = synthetic_inputs(tmp_path)
    r, a = resealed(r, a, risk_target=0.01)
    first = gate.evaluate_release(r, a)
    assert first.state == "NO_RELEASE" and first.cohort_frozen
    out = gate.evaluate_release(replace(r, release_cohort_sha256=synthetic_hash("renamed")), a)
    assert out.state == "NO_RELEASE" and "RELEASE_COHORT_REUSED" in out.reasons


def test_hold_everything_is_not_useful_coverage(tmp_path):
    r, a = synthetic_inputs(tmp_path, status="HOLD")
    plan = replace(
        a.plan,
        domains=(
            replace(
                a.plan.domains[0],
                accept_alpha=0.02,
                hold_precision_alpha=0.015,
                hold_rate_alpha=0.015,
            ),
        ),
        hold_criterion=gate.HoldCriterion(0.8, 0.1),
    )
    a = replace(a, plan=plan, hold_criterion=gate.HoldCriterion(0.8, 0.1))
    r = replace(r, domains=(replace(r.domains[0], alpha=0.02),), plan_sha256=plan.sha256())
    out = gate.evaluate_release(r, a)
    assert out.state == "NO_RELEASE"
    d = out.domains[0]
    assert d.all_submission_coverage == 1 and d.useful_coverage == 0
    assert not d.hold_released and d.hold_precision == 0


def synthetic_binding():
    return cal.CalibrationBinding(
        synthetic_hash("weights"),
        sha256_hex(canonical_json([0.2, -0.1, 0.0, 0.0])),
        2.0,
        ("woven", "knit"),
        (("plain", "woven"), ("twill", "woven")),
        ("drop",),
        synthetic_hash("preprocess"),
        ("structure", "overview"),
        "mean-probability",
        synthetic_hash("calibration"),
        source_labels=("plain", "twill", "knit", "drop"),
        view_selection_sha256=synthetic_hash("view-selection"),
    )


def synthetic_probabilities(**changes):
    b = synthetic_binding()
    args = dict(
        view_logits=[[1.0, 0.0, -1.0, 9.0], [0.0, 1.0, 0.0, -3.0]],
        source_labels=b.source_labels,
        binding=b,
        logit_bias=[0.2, -0.1, 0.0, 0.0],
        view_roles=("structure", "overview"),
        view_selection_sha256=synthetic_hash("view-selection"),
    )
    return cal.sample_probabilities(**{**args, **changes})


def test_calibration_multiview_merge_drop_bias_temperature_parity():
    p = synthetic_probabilities()
    expected = []
    for row in [[1.0, 0.0, -1.0], [0.0, 1.0, 0.0]]:
        z = [math.exp((x + b) / 2) for x, b in zip(row, [0.2, -0.1, 0.0], strict=True)]
        expected.append((z[0] + z[1]) / sum(z))
    assert p["woven"] == pytest.approx(sum(expected) / 2)
    assert sum(p.values()) == pytest.approx(1)
    assert synthetic_probabilities() == p
    fit = cal.fit_accept_threshold(
        [0.5, 0.5, 0.9],
        [False] * 3,
        ["synthetic-a", "synthetic-b", "synthetic-c"],
        risk_target=0.9,
        alpha=0.05,
        cohort_sha256=synthetic_hash("calibration"),
        cohort_role="calibration",
    )
    assert fit.threshold == 0.5 and fit.accepted_groups == 3


@pytest.mark.parametrize(
    "change",
    [
        {"logit_bias": [0.0, 0.0, 0.0, 0.0]},
        {"logit_bias": None},
        {"view_roles": ("defect", "overview")},
        {"view_selection_sha256": synthetic_hash("changed")},
        {"source_labels": ("twill", "plain", "knit", "drop")},
        {"view_logits": [[float("nan"), 0.0, 0.0, 0.0]]},
    ],
)
def test_calibration_input_drift(change):
    with pytest.raises(ValueError):
        synthetic_probabilities(**change)


@pytest.mark.parametrize(
    "field,value",
    [
        ("weights_sha256", synthetic_hash("changed")),
        ("logit_bias_sha256", synthetic_hash("changed")),
        ("temperature", 3.0),
        ("capture_roles", ("structure",)),
        ("aggregation", "max"),
        ("view_selection_sha256", synthetic_hash("changed")),
        ("label_scope", ("knit", "woven")),
        ("merge_map", ()),
        ("dropped_labels", ()),
        ("preprocessing_sha256", synthetic_hash("changed")),
        ("source_labels", ("knit", "twill", "plain", "drop")),
        ("cohort_sha256", synthetic_hash("changed")),
    ],
)
def test_every_binding_change_invalidates_saved_calibration(field, value):
    b = synthetic_binding()
    changed = replace(b, **{field: value})
    assert changed.sha256() != b.sha256()
    with pytest.raises(ValueError, match="binding"):
        cal.assert_binding(changed, b.sha256())


def test_threshold_calibration_only_grouped_validated():
    args = dict(
        scores=[0.9] * 3,
        nonconforming=[False] * 3,
        groups=["synthetic-same"] * 3,
        risk_target=0.9,
        alpha=0.05,
        cohort_sha256=synthetic_hash("calibration"),
        cohort_role="calibration",
    )
    assert cal.fit_accept_threshold(**args).threshold is None
    for change in ({"cohort_role": "release"}, {"scores": [float("nan")] * 3}):
        with pytest.raises(ValueError):
            cal.fit_accept_threshold(**{**args, **change})
    with pytest.raises(ValueError):
        cal.assert_disjoint(["synthetic-a"], ["synthetic-a"])


def test_predeclared_enrollment_rejects_silent_dropout(tmp_path):
    r, a = synthetic_inputs(tmp_path)
    enrollment = tuple((o.selection_id, o.independent_group_id) for o in r.domains[0].outcomes)
    plan = replace(
        a.plan,
        domains=(
            replace(
                a.plan.domains[0],
                enrollments=enrollment + (("synthetic-uncollected", "synthetic-0"),),
            ),
        ),
    )
    out = gate.evaluate_release(replace(r, plan_sha256=plan.sha256()), replace(a, plan=plan))
    assert out.state == "NO_RELEASE" and "ENROLLMENT_MISMATCH" in out.reasons


def test_calibration_production_entry_uses_raw_multiview_inputs_and_saved_binding():
    b = synthetic_binding()
    samples = tuple(
        cal.CalibrationSample(
            f"synthetic-{i}",
            f"synthetic-{i}",
            ((1.0, 0.0, -1.0, 9.0), (0.0, 1.0, 0.0, -3.0)),
            ("structure", "overview"),
            synthetic_hash("view-selection"),
            "woven",
            False,
        )
        for i in range(3)
    )
    fitted = cal.fit_sample_threshold(
        samples,
        b,
        [0.2, -0.1, 0.0, 0.0],
        serving_binding_sha256=b.sha256(),
        risk_target=0.9,
        alpha=0.05,
        cohort_role="calibration",
    )
    assert fitted.binding_sha256 == b.sha256()
    assert fitted.fit.accepted_groups == 3
    assert fitted.fit.threshold == pytest.approx(synthetic_probabilities()["woven"])
    with pytest.raises(ValueError, match="binding"):
        cal.fit_sample_threshold(
            samples,
            b,
            [0.2, -0.1, 0.0, 0.0],
            serving_binding_sha256=synthetic_hash("changed"),
            risk_target=0.9,
            alpha=0.05,
            cohort_role="calibration",
        )


def test_non_normalised_group_ids_counted_as_one_group(tmp_path):
    r, a = synthetic_inputs(tmp_path, n=2)
    rows = list(r.domains[0].outcomes)
    rows = [
        replace(rows[0], independent_group_id="Roll-7"),
        replace(rows[1], independent_group_id="roll-7 "),
    ]
    counts = aggregate(rows)
    assert counts.independent_groups == 1


def test_calibration_groups_reserved_across_looks(tmp_path):
    reg = tmp_path / "shared-reg.sqlite"
    r1, a1 = synthetic_inputs(tmp_path, n=3)
    r1 = replace(r1, calibration_group_ids=("cal-X",))
    a1 = replace(a1, cohort_registry=str(reg))
    o1 = gate.evaluate_release(r1, a1)
    assert o1.state == "STATISTICAL_CANDIDATE"

    # Look 2: fresh cohort hash; cal-X is now a release group; calibration is cal-Y
    r2, a2 = synthetic_inputs(tmp_path, n=3)
    mapping = {"synthetic-0": "cal-X", "synthetic-1": "fresh-1", "synthetic-2": "fresh-2"}
    rows = tuple(
        replace(
            o,
            independent_group_id=mapping.get(o.independent_group_id, o.independent_group_id),
        )
        for o in r2.domains[0].outcomes
    )
    dom = (replace(r2.domains[0], outcomes=rows, counts=aggregate(rows)),)
    enroll = tuple((s, mapping.get(g, g)) for s, g in a2.plan.domains[0].enrollments)
    plan = replace(a2.plan, domains=(replace(a2.plan.domains[0], enrollments=enroll),))
    r2 = replace(
        r2,
        domains=dom,
        release_group_ids=tuple(mapping.get(g, g) for g in r2.release_group_ids),
        plan_sha256=plan.sha256(),
        release_cohort_sha256=synthetic_hash("second-cohort"),
        calibration_group_ids=("cal-Y",),
    )
    a2 = replace(a2, plan=plan, cohort_registry=str(reg))
    o2 = gate.evaluate_release(r2, a2)
    assert o2.state == "NO_RELEASE"
    assert "RELEASE_COHORT_REUSED" in o2.reasons




@pytest.mark.parametrize(
    "x,n,a", [(1, 300, 0.05), (3, 1000, 0.05), (50, 100, 0.05), (100, 10000, 0.05)]
)
def test_bound_never_rounds_below_exact_tail(x, n, a):
    from fractions import Fraction
    from math import comb

    p = Fraction(gate.false_accept_upper(x, n, a))
    tail = sum(comb(n, k) * p**k * (1 - p) ** (n - k) for k in range(x + 1))
    assert tail <= Fraction(a)


def test_risk_target_is_sealed_in_the_plan(tmp_path):
    r, a = synthetic_inputs(tmp_path / "x", n=3)
    out = gate.evaluate_release(r, replace(a, risk_target=0.5))
    assert "PLAN_MISMATCH" in out.reasons
    assert out.state == "NO_RELEASE"


def test_nbsp_variant_signatory_is_not_independent(tmp_path):
    r, a = synthetic_inputs(tmp_path / "x")
    a = replace(a, name="Factory QC Owner", independent_signatory="Factory QC Owner")
    assert "SIGNATORY_NOT_INDEPENDENT" in gate.evaluate_release(r, a).reasons
