"""The one incoming-fabric QC decision rule (design §4, §14-§16, §21).

``evaluate_qc`` is pure: no model code, no database, no clock (the Worker injects the time in
``context``). It returns a draft; the Worker binds IDs and revisions and re-checks authority
inside its own transaction. There is no second copy of these rules in JavaScript or Swift.

The order below is the safety argument. Anything that removes authority or evidence is
collected first and always wins; only fully valid evidence inside a released domain can reach
ACCEPT or HOLD. HOLD is gated exactly like ACCEPT: it is not a catch-all for unvalidated
results.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from services.api.qc_schemas import (
    CAPTURE_FIXABLE,
    MAX_CAPTURE_SETS,
    MAX_FUTURE_SKEW_S,
    REQUIRED_AXES,
    STAGE_NAMES,
    DecisionDraft,
    DomainManifest,
    EvaluationContext,
    Evidence,
    Policy,
    PurchaseSpec,
    Release,
    normalize_density,
)

POLICY_VERSION = "qc-policy-1"
_CHECK_REASON = {
    "blur": "QUALITY_BLUR",
    "glare": "QUALITY_GLARE",
    "moire": "QUALITY_MOIRE",
    "fold": "QUALITY_FOLD",
    "framing": "QUALITY_FRAMING",
    "resolution": "RESOLUTION_LOW",
    "marker_geometry": "SCALE_INVALID",
}
#: A stage that merely abstained for a capture-fixable reason can be retried by recapturing.
#: Only these two stages look at how the photo was taken.
_RECAPTURABLE_STAGES = ("quality", "metrology")


def _time(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


class _Findings:
    """Three ordered, de-duplicated reason lists."""

    def __init__(self) -> None:
        self.authority: list[str] = []  # evidence or authority is missing: a person must look
        self.fixable: list[str] = []  # the capture itself can be retaken
        self.hold: list[str] = []  # valid evidence of nonconformance

    @staticmethod
    def _add(target: list[str], *reasons: str) -> None:
        for r in reasons:
            if r not in target:
                target.append(r)

    def need_review(self, *reasons: str) -> None:
        self._add(self.authority, *reasons)

    def need_recapture(self, *reasons: str) -> None:
        self._add(self.fixable, *reasons)

    def nonconforming(self, *reasons: str) -> None:
        self._add(self.hold, *reasons)


def _check_authority(
    f: _Findings,
    evidence: Evidence,
    spec: PurchaseSpec,
    policy: Policy,
    release: Release | None,
    domain: DomainManifest | None,
    now: datetime,
) -> None:
    if spec.content_sha256 != spec.expected_sha256():
        f.need_review("PO_CONFLICT")
    if evidence.spec_sha256 != spec.content_sha256:
        f.need_review("EVIDENCE_STALE")
    if evidence.manifest_sha256 != evidence.expected_manifest_sha256():
        f.need_review("EVIDENCE_STALE")
    if _time(evidence.created_at) > now + timedelta(seconds=MAX_FUTURE_SKEW_S):
        f.need_review("EVIDENCE_STALE")
    f.need_review(*evidence.contradictions)
    if any(d.provenance.source != "PO_CONFIRMED" for d in spec.density):
        f.need_review("PO_UNCONFIRMED")

    if policy.sha256 != policy.expected_sha256() or policy.mode != "AUTOMATIC":
        f.need_review("POLICY_UNRELEASED")
        return
    if (
        release is None
        or release.state != "ACTIVE"
        or release.sha256 != release.expected_sha256()
        or release.policy_sha256 != policy.sha256
        or release.workspace_id != spec.workspace_id
        or now >= _time(release.expires_at)  # expiry is inclusive: at the instant, expired
    ):
        f.need_review("POLICY_UNRELEASED")
    if (
        domain is None
        or release is None
        or domain.sha256 != domain.expected_sha256()
        or domain.sha256 != release.domain_sha256
        or evidence.domain_id != domain.id
        or domain.construction != spec.construction
        or not set(spec.allowed_fabric_labels) <= set(domain.effective_labels)
    ):
        f.need_review("DOMAIN_UNVALIDATED")


def _check_stages(
    f: _Findings, evidence: Evidence, spec: PurchaseSpec, domain: DomainManifest | None
) -> None:
    for name in STAGE_NAMES:
        stage = getattr(evidence, name)
        fixable = [r for r in stage.reasons if r in CAPTURE_FIXABLE]
        other = [r for r in stage.reasons if r not in CAPTURE_FIXABLE]
        f.need_recapture(*fixable)
        if stage.state == "OK":
            # A stage that ran can still name a blocking reason; it counts like any other.
            f.need_review(*other)
            continue
        retakeable = name in _RECAPTURABLE_STAGES and stage.state == "ABSTAINED"
        if other or not retakeable:
            f.need_review(*(other or ["STAGE_UNAVAILABLE"]))

    quality = evidence.quality
    if quality.state == "OK":
        checks = quality.value.checks.model_dump()
        f.need_recapture(*(_CHECK_REASON[k] for k, passed in checks.items() if not passed))
        if domain is not None and quality.artifact_sha256 != domain.quality_thresholds_sha256:
            f.need_review("DOMAIN_UNVALIDATED")

    assessed = evidence.domain
    if assessed.state == "OK":
        if not assessed.value.in_domain:
            f.need_review("OOD")
        if domain is not None and (
            assessed.artifact_sha256 != domain.unknown_assessment_sha256
            or assessed.value.profile_sha256 not in domain.profile_sha256s
        ):
            f.need_review("DOMAIN_UNVALIDATED")

    fabric = evidence.fabric
    if fabric.state == "OK":
        value = fabric.value
        if value.unknown:
            f.need_review("UNKNOWN_FABRIC")
        else:
            if value.taxonomy_version != spec.taxonomy_version or (
                domain is not None and value.label not in domain.effective_labels
            ):
                f.need_review("DOMAIN_UNVALIDATED")
            elif value.label not in spec.allowed_fabric_labels:
                f.nonconforming("FABRIC_MISMATCH")
            if value.calibrated_probability is None:
                # No calibration matching the served logits: the answer is shown, not trusted.
                f.need_review("DOMAIN_UNVALIDATED")

    defects = evidence.defects
    if defects.state == "OK":
        score = defects.value.score
        views = defects.value.views
        if domain is None:
            f.need_review("DOMAIN_UNVALIDATED")  # a score means nothing without its transform
        elif not views or not math.isclose(score, max(v.score for v in views), abs_tol=1e-9):
            # The aggregate is the largest single view (DefectValue): a score that is not that
            # maximum, or that stands for no view at all, is not the record it claims to be.
            f.need_review("STAGE_UNAVAILABLE")
        elif score >= domain.defect_hold_at_or_above:
            f.nonconforming("DEFECT_SUSPECTED")
        elif score >= domain.defect_accept_below:
            f.need_review("DEFECT_SUSPECTED")  # grey zone, lower bound included

    metrology = evidence.metrology
    if metrology.state == "OK":
        measured = {m.axis: m for m in metrology.value}
        if set(measured) != REQUIRED_AXES[spec.construction]:
            f.need_review("MEASUREMENT_UNCERTAIN")
            return
        if domain is not None and metrology.artifact_sha256 != domain.metrology_validation_sha256:
            f.need_review("DOMAIN_UNVALIDATED")
        for wanted in spec.density:
            low, high = measured[wanted.axis].interval95
            lower = normalize_density(wanted.lower, wanted.unit)
            upper = normalize_density(wanted.upper, wanted.unit)
            if lower <= low and high <= upper:
                continue  # the whole interval is inside, limits included
            if high < lower or low > upper:
                f.nonconforming("CONSTRUCTION_OUTSIDE_TOLERANCE")
            else:
                f.need_review("MEASUREMENT_UNCERTAIN")  # the interval crosses a limit


def evaluate_qc(
    evidence: Evidence,
    spec: PurchaseSpec,
    policy: Policy,
    release: Release | None,
    attempt: int,
    context: EvaluationContext,
    *,
    domain: DomainManifest | None = None,
) -> DecisionDraft:
    """Decide one inspected sample. ``domain`` is the manifest the release binds (thresholds and
    label scope); without it nothing automatic is possible."""
    if isinstance(attempt, bool) or not isinstance(attempt, int):
        raise TypeError("attempt must be an integer")
    if not 1 <= attempt <= MAX_CAPTURE_SETS:
        raise ValueError(f"attempt must be 1..{MAX_CAPTURE_SETS}")
    now = _time(context.evaluated_at)
    f = _Findings()
    if now >= _time(context.deadline_at):
        f.need_review("EVIDENCE_STALE")
    _check_authority(f, evidence, spec, policy, release, domain, now)
    _check_stages(f, evidence, spec, domain)

    def review(*extra: str) -> DecisionDraft:
        reasons = list(dict.fromkeys([*extra, *f.authority, *f.fixable, *f.hold]))
        return DecisionDraft(
            status="MANUAL_REVIEW", reasons=reasons, automatic=False, scope="INSPECTED_SAMPLE"
        )

    review_only = policy.mode != "AUTOMATIC"
    # Under REVIEW_ONLY the unreleased policy alone does not make a blurry photo a review case:
    # asking for a retake is not a decision about the fabric.
    blocking = [r for r in f.authority if not (review_only and r == "POLICY_UNRELEASED")]
    if review_only and policy.sha256 != policy.expected_sha256():
        blocking.append("POLICY_UNRELEASED")
    if f.fixable and not blocking:
        if attempt >= MAX_CAPTURE_SETS:
            return review("RECAPTURE_LIMIT")
        return DecisionDraft(
            status="RECAPTURE",
            reasons=list(f.fixable),
            automatic=False,
            scope="INSPECTED_SAMPLE",
        )
    if f.authority or f.fixable:
        return review()
    if f.hold:
        return DecisionDraft(
            status="HOLD", reasons=list(f.hold), automatic=True, scope="INSPECTED_SAMPLE"
        )
    return DecisionDraft(status="ACCEPT", reasons=[], automatic=True, scope="INSPECTED_SAMPLE")
