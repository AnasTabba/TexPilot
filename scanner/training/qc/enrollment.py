"""Enrolment arithmetic for the confirmatory study (design §7, §19; plan T09).

These are planning calculations, not approvals. The risk target and confidence come from the
factory authority (G2/G7); the 1 % / 95 % figures in the design are illustrations only and are
never defaulted here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction


def zero_failure_units(risk_target: float, alpha: float) -> int:
    """Smallest n with 1 - alpha**(1/n) <= risk_target: accepted independent units needed when
    not one of them fails. 0.01 at alpha 0.05 gives 299."""
    if not 0.0 < risk_target < 1.0 or not 0.0 < alpha < 1.0:
        raise ValueError("risk_target and alpha must be strictly between 0 and 1")
    n = max(1, math.ceil(math.log(alpha) / math.log1p(-risk_target)) - 1)
    while 1.0 - alpha ** (1.0 / n) > risk_target:
        n += 1
    return n


def required_enrollment(
    accepted_required: int, acceptance_fraction: float, attrition_fraction: float
) -> int:
    """Independent submissions to enrol so that ``accepted_required`` are automatically
    accepted, given the fraction accepted and the fraction lost before analysis. Always rounds
    up. 299 at 0.30 acceptance and no attrition gives 997."""
    if isinstance(accepted_required, bool) or not isinstance(accepted_required, int):
        raise ValueError("accepted_required must be a whole number")
    if accepted_required < 1:
        raise ValueError("accepted_required must be at least 1")
    for name, value in (("acceptance", acceptance_fraction), ("attrition", attrition_fraction)):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
            raise ValueError(f"{name}_fraction must be a number")
    if not 0.0 < acceptance_fraction <= 1.0:
        raise ValueError("acceptance_fraction must be in (0, 1]: zero acceptance never finishes")
    if not 0.0 <= attrition_fraction < 1.0:
        raise ValueError("attrition_fraction must be in [0, 1)")
    accept = Fraction(str(acceptance_fraction))
    keep = 1 - Fraction(str(attrition_fraction))
    return math.ceil(Fraction(accepted_required) / (accept * keep))


@dataclass(frozen=True)
class Feasibility:
    required_enrollment: int
    weeks_needed: float | None  # None: no authorised recruitment
    feasible: bool
    outcome: str  # "FEASIBLE" | "REVIEW_ONLY"
    reason: str


def feasibility(
    *,
    accepted_required: int,
    acceptance_fraction: float,
    attrition_fraction: float,
    independent_groups_per_week: float,
    weeks_available: float,
    domains: int = 1,
) -> Feasibility:
    """Can the cohort finish in the time available? More domains multiply the need; nothing
    here can reduce it. A zero authorised rate is review-only, not a smaller study."""
    if isinstance(domains, bool) or not isinstance(domains, int) or domains < 1:
        raise ValueError("domains must be at least 1")
    for value in (independent_groups_per_week, weeks_available):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise ValueError("recruitment rate and time must be finite numbers")
    need = required_enrollment(accepted_required, acceptance_fraction, attrition_fraction) * domains
    if independent_groups_per_week <= 0 or weeks_available <= 0:
        return Feasibility(
            need, None, False, "REVIEW_ONLY", "No authorised recruitment rate or time (G1)."
        )
    weeks = need / independent_groups_per_week
    if weeks > weeks_available:
        return Feasibility(
            need,
            weeks,
            False,
            "REVIEW_ONLY",
            f"{need} independent submissions need {weeks:.1f} weeks; {weeks_available:g} "
            "are available. Predeclare a no-release outcome or narrow the domains.",
        )
    return Feasibility(need, weeks, True, "FEASIBLE", "Projected cohort fits the window.")
