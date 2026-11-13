# Confirmatory enrollment feasibility worksheet — T09 / C07

Worksheet owner: [unfilled — G1 authority to nominate]
Risk/tolerance authority: [unfilled — G2 authority to nominate]
Consent/rights authority: [unfilled — G4 authority to nominate]
Independent statistical signatory: [unfilled — G7 authority to nominate]
All entries below are uncollected planning inputs. No factory access, recruitment, consent,
funding, staffing or approvals are asserted. Default outcome remains REVIEW_ONLY.

| Required input | Value / evidence |
| --- | --- |
| Authorized factory/lab and domain scope | not yet collected — external gate G1 |
| Highest independent roll/lot/process group | not yet collected — external gates G1/G7 |
| Authorized independent groups per week | not yet collected — external gates G1/G4 |
| Selection eligibility and attrition range | not yet collected — external gates G1/G7 |
| ACCEPT-only coverage range | not yet collected — external gates G6/G7 |
| Accepted independent units required per domain/endpoint | not yet collected — external gates G2/G7 |
| Risk target, alpha, multiplicity allocation and stopping rule | not yet collected — external gates G2/G7 |
| Separate calibration enrollment and sealed confirmatory enrollment | not yet collected — external gate G7 |
| Two-observer minutes per selection, remeasurement fraction and person-hours | not yet collected — external gates G1/G7 |
| Available qualified observers and access windows | not yet collected — external gates G1/G7 |
| Consent, retention, withdrawal/deletion and backup expiry agreement | not yet collected — external gate G4 |
| Start date, eligible weeks and projected cohort completion date | not yet collected — external gates G1/G4/G7 |
| Feasible domains and signed no-release fallback | not yet collected — external gates G2/G7 |

## Arithmetic and sensitivity protocol

`required_enrollment(accepted_required, acceptance_fraction, attrition_fraction)` returns
ceil(accepted_required / (acceptance_fraction × (1 − attrition_fraction))). Counts must be
positive integers; acceptance must be in (0, 1], attrition in [0, 1). Zero acceptance and
non-finite/out-of-range inputs reject. Zero attrition is valid. This is one ceiling over the
whole expression, not two rounded intermediate stages. Inputs refer to independent groups,
not tiles, photos or repeated evaluations of a selection.

Illustration only, not an authorized target: a single endpoint with risk 1%, alpha 0.05 and
zero failures needs 299 accepted independent units. At 0.30 ACCEPT coverage, ceil(299/0.30)
= 997 independent submissions before attrition. With 0.20 attrition the complete expression
requires ceil(299/(0.30×0.80)) = 1246. These figures are planning arithmetic, not observations.
Lower acceptance, more attrition or smaller independent-group yield cannot reduce the need.
Splitting alpha across more domains/endpoints tightens alpha, increases accepted n and never
reduces total enrollment. `zero_failure_units` computes only the illustrated zero-failure
case; independent statistics must define nonzero-failure analysis and actual authority.

Keep calibration groups separate and add their independently planned recruitment; they do
not count toward the sealed release total. Sum per-domain/endpoint requirements using the
approved alpha allocation; do not assume a shared or reused cohort creates independent n.
`feasibility` is a planning helper: domain multiplication assumes the supplied accepted n is
already appropriate to its alpha allocation. It never allocates alpha or approves a release.
Project weeks = required independent submissions / authorized independent groups per week.
Sensitivity runs use the conservative coverage/eligibility/group-yield bounds. Person-hours
= selections × two-observer time plus independently estimated repeat/disagreement work;
all time/rate estimates remain not yet collected — external gates G1/G7.

## Proposed checkpoints and honest fallback

These are the design's proposed study schedule, not achieved dates or signed commitments:

- By 15 Dec 2026: complete this worksheet conditional on access/consent, with independent
  groups/week, eligibility/attrition and coverage ranges, observer person-hours, separate
  calibration/release recruitment, date projection and alpha/domain allocation.
- By 31 Jan 2027: freeze feasible domains, or preregister no automatic release in May if the
  independent cohort cannot finish by 31 Mar 2027.
- By 31 Mar 2027: projected independent confirmatory cohort completion, conditional on all
  access/rights/reference gates and the preregistered stopping plan.

Zero authorized recruitment, infeasible completion, absent signatures or unknown inputs means
lab-only/REVIEW_ONLY and an explicit no-release outcome. Do not fabricate a trial, extrapolate
factory generalization from lab photos, weaken risk/alpha after results or treat missing values
as a zero-loss/fully covered study. Missing G1/G2/G4/G7 evidence remains an external gate.
