"""Illustrative planning arithmetic; no recruitment or risk authority is implied."""

import math
from fractions import Fraction

import pytest

from training.qc.enrollment import feasibility, required_enrollment, zero_failure_units


def test_299_accepted_at_thirty_percent_requires_997_before_attrition():
    assert required_enrollment(299, 0.30, 0) == 997


@pytest.mark.parametrize(
    "n,accept,attrition", [(299, 0.3, 0.2), (1, 0.6, 0.1), (3, 0.1, 0), (40, 1, 0.2)]
)
def test_single_ceiling_of_complete_enrollment_arithmetic(n, accept, attrition):
    expected = math.ceil(Fraction(n) / (Fraction(str(accept)) * (1 - Fraction(str(attrition)))))
    assert required_enrollment(n, accept, attrition) == expected


@pytest.mark.parametrize("accept", [0, -0.1, 1.1, float("nan"), float("inf"), True, ".3"])
def test_invalid_acceptance_rejected(accept):
    with pytest.raises(ValueError):
        required_enrollment(299, accept, 0)


@pytest.mark.parametrize("attrition", [-0.1, 1, 1.1, float("nan"), float("inf"), True, ".3"])
def test_invalid_attrition_rejected(attrition):
    with pytest.raises(ValueError):
        required_enrollment(299, 0.3, attrition)


@pytest.mark.parametrize("n", [0, -1, 1.5, True])
def test_positive_whole_accepted_requirement(n):
    with pytest.raises(ValueError):
        required_enrollment(n, 0.3, 0)


def test_lower_coverage_more_attrition_and_more_alpha_splits_never_reduce_need():
    accepted = zero_failure_units(0.01, 0.05)
    assert accepted == 299
    baseline = required_enrollment(accepted, 0.3, 0)
    assert required_enrollment(accepted, 0.2, 0) >= baseline
    assert required_enrollment(accepted, 0.3, 0.2) >= baseline
    assert required_enrollment(zero_failure_units(0.01, 0.05 / 4), 0.3, 0) >= baseline


def test_lower_independent_recruitment_more_domains_or_no_authorized_rate():
    args = dict(
        accepted_required=299, acceptance_fraction=0.3, attrition_fraction=0, weeks_available=20
    )
    base = feasibility(**args, independent_groups_per_week=100)
    slow = feasibility(**args, independent_groups_per_week=50)
    multi = feasibility(**args, independent_groups_per_week=100, domains=2)
    assert slow.weeks_needed >= base.weeks_needed
    assert multi.required_enrollment >= base.required_enrollment
    assert feasibility(**args, independent_groups_per_week=0).outcome == "REVIEW_ONLY"
    assert feasibility(**args, independent_groups_per_week=1).outcome == "REVIEW_ONLY"


@pytest.mark.parametrize(
    "field,value",
    [
        ("domains", True),
        ("domains", 1.5),
        ("independent_groups_per_week", float("nan")),
        ("weeks_available", float("inf")),
    ],
)
def test_invalid_feasibility_cannot_claim_feasible(field, value):
    args = dict(
        accepted_required=299,
        acceptance_fraction=0.3,
        attrition_fraction=0,
        independent_groups_per_week=100,
        weeks_available=20,
        domains=1,
    )
    with pytest.raises(ValueError):
        feasibility(**(args | {field: value}))
