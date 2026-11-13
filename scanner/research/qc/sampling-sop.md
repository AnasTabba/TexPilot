# Incoming-fabric QC sampling and blinded reference SOP — T09 / C07

Sampling owner: [unfilled — G1/G2 authority to nominate]
Reference collection owner: [unfilled — G7 authority to nominate]
Independent observer identities, qualifications, signed protocol, sampling plan and sealed
cohort hashes: not yet collected — external gates G1/G2/G4/G7.
This is a protocol, not a completed factory study. Default mode is REVIEW_ONLY.

## Selection before results

Authorize factory access, capture/research consent, retention/deletion/backup policy and QC
risk/tolerance authority before collection. If unavailable, use only separately consented lab
rolls and label the study lab-only; make no factory generalization claim.

Freeze the randomized plan before seeing model results. Record plan version/hash, factory,
supplier, lot, roll, independent group, seed, draw index/probability, cohort, physical location,
face, planned sampled area and method. Record actual usable area or its missingness reason.
Unknown plan/roll/face is ineligible, never repaired by choosing a convenient value. Challenge
locations selected because a flaw is conspicuous remain CHALLENGE across all their photos and
cannot enter confirmatory enrollment. No post-result cohort switching. Register missing and
excluded selections and reasons before unblinding; keep them in all-submission denominators.

One physical selection and its repeat photos/recaptures/linked specification evaluations are
one submitted unit. They are not independent trials. Choose one preregistered sample per
independent roll for confirmatory binomial analysis, or the higher dependent lot/process group
when required. Other observations remain descriptive clustered evidence and sensitivity
analyses. Tiles and phone shots do not add independent n. Two factories cannot certify unseen
factories. No percentage roll coverage without measured area and roll dimensions; no
four-point points/100yd² without inspected area, defect size and an authorized scheme.
Surface sampling cannot expose hidden/internal defects.

## Independent physical reference before model unblinding

Two DISTINCT qualified observers independently inspect the same physical sample, face,
registered location and applicable immutable spec. Qualification records and signed observation
records: not yet collected — external gate G7. Both record raw repeated ends/picks (woven)
or wales/courses (knit), counted lengths, explicit in/cm units, uncertainty, fabric labels,
physical defect findings, measured size and overview/location/physical-inspection provenance.
A model heatmap is not defect ground truth. Retain raw counts and repeatability.

Use `contracts/qc-research-reference.schema.json` for external register interchange. The
closed record (parsed with `parse_reference`) includes timestamps, observer and qualification reference, sample/selection/spec
hash binding, raw counts/lengths/units, labels/physical defects, uncertainty, status, parent IDs
and embedded raw observations. Sign/verify external register records before ingestion; signing
identity/verification evidence is not yet collected — external gates G7/G8. Schema validation
and software eligibility are not signature verification or proof of physical qualification.

The record's observed_at is the register's sealed observation timestamp, recorded before the
model result can be unblinded. model_unblinded_at is the actual result access timestamp, or
null while still sealed. Never backdate an observation. Access-log/seal proof: not yet collected
— external gate G7. Each parent must precede the earliest unblinding timestamp in the pair.
Invalid timestamps, missing counts/lengths/units/qualification, repeated observer identity,
wrong sample/spec/location/face, uncertain status or unresolved disagreement are release-
ineligible. Retain UNDETERMINED separately; never count it as a clean negative.

`validate_reference(record, selection)` accepts the research `SelectionRef` adapter with
resolved sample-to-frozen-spec hashes. The public SamplingSelection alone has no sample/spec
binding; passing it without resolution fails closed with SELECTION_BINDING_UNRESOLVED.
The ingestion/T11 owner must resolve linked samples and historical specs, then construct the
adapter. Family-wide membership in a set of spec hashes is insufficient. The consensus embeds
the two original RAW observations; the optional parents argument supports an external immutable
parent store. Both representations must agree if both are supplied.

A consensus must preserve observer labels and physical findings and satisfy the preregistered
count-repeatability/uncertainty criterion. Criterion authority: not yet collected — external
gate G7. Operational supervisor adjudication never replaces blinded truth. ADJUDICATED status
remains release-ineligible until a separate signed physical remeasurement protocol is approved;
it cannot erase disagreement. `ReferenceEligibility.in_denominator` remains true for every
outcome, including invalid, excluded, challenge and UNDETERMINED records.

## Cohort sealing and specification changes

Keep development, calibration and final release cohorts disjoint by highest independent group
and time. Reference collection may precede the final model only under blinding and sealing;
never expose release results for tuning. New active-learning annotations stay outside sealed
test. Include random accepted and held samples as well as abstentions, logging probabilities;
never train on unadjudicated model labels or selected disagreements alone.

Preserve every applicable frozen spec. A later stricter spec does not retrospectively make a
conforming old-spec acceptance a model error. T11 traverses each physical-selection family
and any automatic ACCEPT history: ACCEPT under v1 with reference nonconforming under v1,
then HOLD under v2, remains one accepted independent unit and one failure. Never increase n
for changed PO versions or reuse old capture bytes silently. Preregister the primary endpoint
and version; separately report specification changes and unknown cross-version truth.

## Reporting and stopping

Preregister domain/endpoint alpha allocation, one-sided risk target, stopping rules and fixed
audit sample before unblinding. Authority and numbers: not yet collected — external gates
G2/G7. No repeated unadjusted peeking. The primary estimand is reference nonconforming given
automatic ACCEPT on independent held-out units. Report the reverse conditional, prevalence,
HOLD precision, review/recapture rates, eligible-submission coverage, all-submission coverage,
ACCEPT-only coverage, missing/excluded/undetermined counts and reasons. Keep reference,
image and pixel denominators explicit. Coverage targets and authorized risk are external.

A failed release requires a new independently evaluated version/cohort; never tune on release
failures and reuse that cohort. Sparse or infeasible domains stay REVIEW_ONLY. Lot disposition
and factory QC authority remain external; no software eligibility result grants ACCEPT/HOLD.
