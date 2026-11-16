"""Tiny synthetic workflow tables, never collected QC evidence."""

from dataclasses import replace

import pytest

from training.qc import workflow_metrics as wm


def synthetic_event(status="ACCEPT", spec="synthetic-v1", sequence=1, attempt=1):
    return wm.DecisionEvent(
        "synthetic-selection",
        "synthetic-group",
        "synthetic-sample",
        spec,
        status,
        status in {"ACCEPT", "HOLD"},
        attempt,
        sequence,
    )


def synthetic_reference(**truth):
    return wm.Reference("synthetic-selection", truth or {"synthetic-v1": "NONCONFORMING"}, True)


def test_any_accept_survives_hold_retries_and_spec_revision():
    events = [
        synthetic_event(),
        synthetic_event("RECAPTURE", sequence=2, attempt=2),
        replace(synthetic_event("HOLD", "synthetic-v2", 3, 3), sample_id="synthetic-successor"),
    ]
    out = wm.reduce_workflow(
        events,
        synthetic_reference(**{"synthetic-v1": "NONCONFORMING", "synthetic-v2": "NONCONFORMING"}),
    )
    assert (out.enrolled, out.accepted, out.failure) == (1, 1, 1)
    assert out.final_state_failure == 0
    assert (out.capture_sets, out.spec_versions) == (3, 2)
    assert wm.aggregate([out]).independent_groups == 1


def test_stricter_spec_does_not_relabel_earlier_conforming_accept():
    out = wm.reduce_workflow(
        [synthetic_event(), synthetic_event("HOLD", "synthetic-v2", 2)],
        synthetic_reference(**{"synthetic-v1": "CONFORMING", "synthetic-v2": "NONCONFORMING"}),
    )
    assert out.accepted == 1 and out.failure == 0
    assert out.reference_nonconforming == 0


@pytest.mark.parametrize(
    "ref",
    [
        None,
        synthetic_reference(**{"synthetic-v1": "UNDETERMINED"}),
        wm.Reference("synthetic-selection", {}, False),
    ],
)
def test_unknown_reference_never_counts_clean(ref):
    counts = wm.aggregate([wm.reduce_workflow([synthetic_event()], ref)])
    assert counts.conservative_failures == counts.undetermined_accepts == 1
    assert counts.undetermined_reference_groups == 1


def test_unfinished_denominator_and_capture_burden_have_missing_reasons():
    missing = wm.unfinished_unit("synthetic-missing", "synthetic-missing-group", "NOT_COLLECTED")
    retry = wm.reduce_workflow([synthetic_event("RECAPTURE")], synthetic_reference())
    counts = wm.aggregate([missing, retry])
    assert (counts.enrolled_units, counts.completed_units, counts.capture_sets) == (2, 0, 1)
    assert missing.missing_reason == "NOT_COLLECTED"
    assert retry.missing_reason == "WORKFLOW_UNFINISHED"


def test_duplicate_tiles_and_correlated_selections_never_raise_n():
    out = wm.reduce_workflow([synthetic_event()], synthetic_reference())
    counts = wm.aggregate([out, out, replace(out, selection_id="synthetic-correlated")])
    assert counts.accepted_independent_units == counts.failures == counts.independent_groups == 1
    assert counts.enrolled_units == counts.capture_sets == 2
    with pytest.raises(ValueError, match="selection"):
        wm.aggregate([out, replace(out, independent_group_id="synthetic-forged-group")])


def test_accept_hold_overlap_and_unknown_hold():
    out = wm.reduce_workflow([synthetic_event(), synthetic_event("HOLD", sequence=2)], None)
    counts = wm.aggregate([out])
    assert counts.automatic_independent_units == 1
    assert counts.held_independent_units == counts.undetermined_holds == 1
    assert counts.holds_on_nonconforming == 0


@pytest.mark.parametrize(
    "event",
    [
        replace(synthetic_event(), automatic=False),
        replace(synthetic_event(), capture_attempt=4),
        replace(synthetic_event(), status="PASS"),
    ],
)
def test_invalid_events_raise(event):
    with pytest.raises(ValueError):
        wm.reduce_workflow([event], synthetic_reference())


def test_group_bootstrap_seeded_resamples_groups_not_tiles():
    a = wm.reduce_workflow([synthetic_event()], synthetic_reference())
    b = replace(
        a,
        selection_id="synthetic-b",
        independent_group_id="synthetic-b",
        accepted=0,
        failure=0,
        held=0,
        final_state_failure=0,
        final_status="MANUAL_REVIEW",
    )
    ci = wm.grouped_uncertainty([a, b], seed=17, replicates=80)
    assert ci == wm.grouped_uncertainty([a, b, a], seed=17, replicates=80)
    assert ci == wm.grouped_uncertainty([b, a], seed=17, replicates=80)
    assert ci["all_submission_coverage"].point == 0.5
    assert ci["prevalence"].point == ci["false_accept"].point == 1
    assert ci["false_accept"].undefined_replicates > 0
    assert ci["all_submission_coverage"].lower <= 0.5 <= ci["all_submission_coverage"].upper


def test_macro_f1_uses_labels_not_accept_accuracy():
    a = wm.reduce_workflow([synthetic_event()], synthetic_reference())
    rows = [
        replace(
            a,
            selection_id=f"synthetic-{i}",
            independent_group_id=f"synthetic-{i}",
            fabric_reference_label=t,
            fabric_predicted_label=p,
        )
        for i, (t, p) in enumerate([("woven", "woven"), ("knit", "woven")])
    ]
    assert wm.grouped_uncertainty(rows, seed=2, replicates=40)[
        "fabric_macro_f1"
    ].point == pytest.approx(1 / 3)


def test_reference_eligibility_defaults_to_unverified():
    ref = wm.Reference("synthetic-selection", {"synthetic-v1": "CONFORMING"})
    out = wm.reduce_workflow([synthetic_event()], ref)
    assert out.undetermined_accept == 1


def test_final_state_endpoint_has_its_own_accept_denominator():
    a = wm.reduce_workflow(
        [synthetic_event(), synthetic_event("HOLD", sequence=2)], synthetic_reference()
    )
    b = replace(
        wm.reduce_workflow([synthetic_event()], synthetic_reference()),
        selection_id="synthetic-b",
        independent_group_id="synthetic-b",
    )
    counts = wm.aggregate([a, b])
    assert counts.accepted_independent_units == 2
    assert counts.final_state_accepted_groups == counts.final_state_failures == 1


def test_final_status_must_agree_with_accept_flags():
    row = wm.UnitOutcome("s1", "g1", 1, 0, 0, 0, 0, 0, 0, "ACCEPT", 0, True, 1, 1, 0, None, True)
    with pytest.raises(ValueError):
        wm.aggregate([row])
