# Incoming-fabric QC statistical release protocol

Status: protocol only. No cohort, model result, calibration profile, release, authority
approval, or signatory approval has been collected here. Synthetic tests prove software
mechanics only. G2 and G7 remain OPEN. Activation additionally requires the matching T12
target-runtime proof and G8; a statistical candidate always remains REVIEW_ONLY here.

## Authority record — unfilled

| Required record | Value |
|---|---|
| Factory QC risk authority / signed register reference | [not yet collected / external gate G2] |
| Authority-approved maximum P(nonconforming given automatic ACCEPT) | [not yet collected / external gate G2] |
| Total family alpha and domain/primary-endpoint allocation | [not yet collected / external gate G7] |
| Sampling agreement and immutable enrollment manifest | [not yet collected / external gates G2/G7] |
| Automatic HOLD minimum precision and maximum conforming-unit HOLD rate | [not yet collected / external gate G2] |
| Independent statistical signatory / signed register reference | [not yet collected / external gate G7] |
| Evidence that signatory is distinct from the risk authority | [not yet collected / external gate G7] |
| Protected durable cohort-registry location, owner, backup/recovery record | [not yet collected / external gates G7/G8] |
| Qualified blinded reference records and eligibility audit | [not yet collected / external gate G7] |
| Target operations/parity proof and monitoring protocol | [not yet collected / T12 and external gate G8] |

An absent risk target never defaults to the illustrative one percent. Missing sampling,
independent signature, signed-record hash, sealed plan, or registry means NO_RELEASE. Missing
HOLD utility/error criteria disables statistical HOLD release; ACCEPT can still be evaluated.
These tools validate record structure and bindings, not identity or signature authenticity.
The independent signatory must verify the signed source records externally before relying
on a candidate. Code does not approve an external gate.

## Before unblinding

Seal the independent grouping, sampling plan, selection roster, cohort and applicable frozen
specification references. Each DomainPlan lists every enrolled (selection_id,
independent_group_id) pair, fixed independent-group count, and separate alpha allocation for
ACCEPT risk, HOLD precision and conforming-unit HOLD rate when HOLD is proposed. Seal the
ReleasePlan, its freeze time, endpoint, single fixed look and seeded bootstrap recipe; place
its canonical hash in the signed authority record and ReleaseReport. All allocations across
all domains and primary endpoints must sum to at most the authority's family alpha. An
unplanned interim look fails. Do not omit failed/invalid/excluded/missing submissions to make
coverage or a fixed-sample requirement pass.

Use one predeclared selection per independent roll for confirmatory binomial analysis. If
rolls share a dependent lot/process, use that higher independent_group_id or explicitly limit
inference. Tiles, duplicate datasets, repeat captures, retries, linked samples and revised
PO evaluations never increase independent n. Repeated identical outcome rows are idempotent;
conflicting versions of a selection must first be reduced from its complete history. Domains
are disjoint predeclared strata; shared selections/groups across domains fail this gate rather
than spending extra alpha on dependent duplicates.

Train/model selection, calibration and sealed confirmatory cohorts must be disjoint by group
and time. This gate verifies the calibration/release group disjointness and declared hashes;
T09/T10 retain the broader split and lineage audit. Changing a group ID to disguise dependence
violates the sealed manifest and is not an authorized new selection.

## Calibration and serving binding

CalibrationSample contains raw per-view logits, capture roles, selection/group identity,
view-selection recipe hash, score label and physical nonconformance reference. Generate these
inputs through the actual bound serving recipe; cached per-image confidence is insufficient.
The T10 adapter must verify input files, weights and preprocessing provenance before emitting
these records. fit_sample_threshold applies sample_probabilities before fitting and records
the binding hash and canonical hash of its complete input table. The lower-level
fit_accept_threshold is a statistical primitive, not a released calibration artifact.

CalibrationBinding binds weights, actual ordered source labels, class merge/drop mapping,
effective label order, logit-bias hash, temperature, preprocessing, ordered capture roles,
view-selection recipe, probability aggregation and calibration cohort. The supported transform
drops excluded logits before bias/temperature softmax, sums merged probabilities, then averages
views in probability space. Bias must be supplied explicitly even when zero, and its hash must
match. Unsupported transformations, missing views/roles, nonfinite values, and changed scope
fail. Any binding change invalidates the saved calibration and dependent release; the actual
serving binding must equal the saved hash. A threshold includes exact score equality.

This repository has no matched trained artifact or collected calibration evidence. Its current
v2 serving adapter retains calibrated_probability=null. Connecting this shared transform and
raw-input generator to a real validated serving bundle requires T06/T10 integration and T12
parity proof; these synthetic tests do not establish real model/target parity.

## Workflow endpoint and references

Reduce the whole selection family, including linked evaluations under revised frozen PO
specifications. Any historical automatic ACCEPT is one accepted exposure, even if followed by
HOLD, review, a retry or a specification change. A nonconforming ACCEPT followed by HOLD is
one accepted unit and one failure. Capture-set count is burden, not independent n.

Each decision's error truth is looked up under its own spec_sha256. A conforming old-spec
ACCEPT is not retrospectively an error because a later spec is stricter. Declare the primary
reference specification for prevalence and the secondary estimand before unblinding; Reference
supports primary_spec_sha256 and otherwise uses the first frozen decision spec. Report spec
changes separately and retain final-state ACCEPT risk with its own denominator.

Reference.release_eligible defaults to false. The T09 validate_reference eligibility output
must authorize the truth adapter: physical location/sample/spec binding, blinded qualified
observers and resolved disagreement are required. Operational supervisor adjudication is not
blinded truth. Missing, ineligible and UNDETERMINED reference labels are separate counts. An
accepted group with any undetermined accepted reference is conservatively a failure in the
release bound, never a clean negative. A HOLD with any unknown reference cannot pass its
utility gate. Mixed conforming/nonconforming HOLD histories are not precision successes.

Selections without events use unfinished_unit with their selection/group IDs and missing or
exclusion reason. They remain enrolled in all-submission coverage. Incomplete recapture
workflows retain WORKFLOW_UNFINISHED; no dropout is silently removed. Eligibility must be
predeclared; all-submission coverage includes every roster member regardless of eligibility.

## Analysis, uncertainty and gate

Report both P(reference nonconforming given automatic ACCEPT) and P(automatic ACCEPT given
primary-reference nonconforming), prevalence among determined references, HOLD precision,
ACCEPT-only coverage, selective coverage among eligible submissions and all-submission
coverage. ACCEPT/HOLD overlap is counted once for coverage. Include completed, undetermined,
missing/excluded and independent-group counts, capture burden, review/recapture rates,
specification-change accounting, final-state risk and fabric macro-F1 from paired labels.
Missing classifier labels leave F1 unavailable, not fabricated. Per-domain classification
reports and the full-reference nonconformance endpoint are separate: excellent fabric F1
cannot override construction/defect false acceptance.

For the primary release gate use the exact one-sided Clopper–Pearson upper bound on
independent accepted groups. The implementation uses standard-library math, without scipy.
Zero accepted units cannot release; all failures have upper bound one. Sparse domains remain
review-only. Authority HOLD criteria use their own preallocated exact bounds and require the
ACCEPT gate as well. HOLD-everything can have full descriptive automatic coverage while useful
released coverage is zero. Descriptive coverage is never itself evidence of utility.

Illustrative arithmetic from the design, not an approved target: at alpha 0.05 with no
failures, the bound is 1 - 0.05^(1/n). For n=298 it exceeds 0.01; n=299 reaches at most 0.01.
At 30% ACCEPT coverage, about 997 independent submissions are needed before attrition.
Splitting alpha across domains/endpoints raises the required accepted n; it never lowers it.

Use seeded cluster bootstrap percentile intervals for the descriptive metrics, resampling
whole independent groups with their selection families together. Retain undefined-resample
counts where a conditional denominator is zero; do not replace undefined risk with zero.
These intervals are sensitivity/descriptive uncertainty, not a substitute for exact
confirmatory bounds or a justification for repeated peeking. Report the seed, number of
replicates, confidence level and method with every interval.

The four immutable ablation arms from T10 share full-reference truth and a paired grouped
cohort. Freeze each arm's calibration and allocate alpha to every confirmatory primary
comparison in its signed plan. Use paired grouped coverage-difference intervals; separate risk
bounds do not prove noninferiority or no risk increase. No winning-arm selection on release
data. This gate does not manufacture a four-arm comparison from a single DomainReport.

## Cohort freeze, independent review and activation

Every evaluate_release first-look attempt atomically reserves the cohort hash AND independent
group IDs in the durable SQLite registry before evaluating outcomes. Failures consume the
cohort, including invalid/missing-authority looks. Reopening the registry and presenting a
tuned model under a new cohort hash still fails if any release groups were already unblinded.
A crash after reservation leaves the cohort frozen. Unavailable registries fail closed;
in-memory registries are refused. Database triggers refuse updates/deletes to claims.

G7/G8 must protect one shared registry across runs, preserve it during recovery, bind it to
the signed protocol, and prevent replacement or group-ID relabeling. Local SQLite triggers
are not a signing identity or protection against privileged filesystem tampering. No such
protected production registry or approval is claimed here. Keep the returned GateResult and
sealed input report in the authority-controlled evidence archive. A failed gate requires new
independent enrollment and evaluation after any tuning; never reuse its release failures as
a fresh confirmatory test.

Independent review checks the signed source records, grouping, exclusions, stopped cohort,
calibration/serving binding and numerical report. A passing tool output is at most
STATISTICAL_CANDIDATE with activatable=false, mode=REVIEW_ONLY and activation requirements
T12_TARGET_PROOF and G8. The Worker/policy lifecycle owns activation; there is no runtime
ACCEPT/HOLD policy or activation endpoint in these research modules.
