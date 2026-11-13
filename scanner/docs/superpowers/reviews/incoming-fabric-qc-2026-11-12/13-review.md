# Reviewer 13 — security, authentication and tenant boundaries

Independent source review, 12 November 2026. Scope: proposed design and execution plan versus actual source; no product changes or runtime security certification. Recommendation: **revise before implementing security-sensitive mutations**. No P0 identified; two P1 contract gaps and one P2 inconsistency follow.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (especially §§3,4,9,12,14,15).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (endpoint contract, T02,T05,T06,T12 and integrated acceptance details).
- `yarnflow/server/{auth,inventory,admin,erp-utils,scanner-proxy,cloudflare,worker}.mjs`.
- `scanner/services/api/main.py`; `scanner/deployment/modal_scanner.py`.

## P1 — Promotion reauthentication is required in prose but absent from the executable contract

**Evidence:** Design line 143 requires reauthentication for promotion; line 103 requires independent evidence beyond admin authority. Actual `yarnflow/server/auth.mjs:17` permits 30-day sessions, and `yarnflow/server/inventory.mjs:235–240` checks session validity/current user but has no recent-authentication property. Login at `inventory.mjs:271–277` creates the ordinary session. Plan line 40 specifies release creation with current session/CSRF and signatory evidence, but no fresh-auth proof, validity window or consumption rule; T05 line 100 has no promotion reauthentication assertion. A valid old shared-device admin session plus already available release evidence can therefore satisfy the explicit planned API checks without the required reauthentication.

**Correction:** T01/T05 must specify a server-verifiable fresh-auth mechanism for release promotion, bound to the current session, actor, workspace and promotion payload, with bounded lifetime and replay handling. Reuse the existing credential/account boundary rather than invent client trust. Document whether suspension deliberately requires only current admin authorization so containment is not blocked by independent promotion approval. G8 security authority chooses/approves the mechanism and PIN suitability; documentation cannot supply that approval.

**Test assertion:** An otherwise authorized old admin session with valid independent evidence cannot promote without fresh proof; wrong actor/workspace/session/body, expired proof and replay for another release fail without release/audit-success writes; freshly authenticated authorized promotion succeeds exactly once. Logout/PIN reset invalidates the proof.

## P1 — Commit-time current-role check does not explicitly revalidate the session that initiated inference

**Evidence:** Design line 200 adds commit-time current-role, suspension and expiry checks, but does not name session revocation/expiry; line 145 lists spec/release/capture/revision checks. T05 passes only `member` to `handleQC` (plan line 98) and its race tests at line 100 cover PO/release changes, not logout or credential reset. Existing `inventory.mjs:110` resolves membership once; `currentMember` returns only user/workspace/name/role/permissions (`:240`), discarding session identity. Logout deletes the session (`:249–252`), and PIN reset deletes sessions while retaining the same role (`yarnflow/server/admin.mjs:202–207`). Thus re-reading the role alone cannot detect a revoked session during the proposed up-to-60-second inference window.

**Correction:** Preserve an internal authentication context and require the initiating session to remain valid, unexpired and bound to the same active user/workspace at finalization. Enforce this together with current role in the atomic commit guard, rather than a separate unprotected pre-commit read. Extend T02/T05 assertions; do not forward browser session cookies to scanner.

**Test assertion:** Pause inference, then logout, reset PIN, deactivate user, change role or expire the initiating session before commit. Resuming must commit neither Decision nor successful decision event; retries with revoked credentials fail, while a fresh authorized session can explicitly retry. Include the race between the final authorization read and batch commit. This is a proposed finalization gap, not a claim that shipped v1 performs authoritative QC finalization.

## P2 — Admin intervention requires a field the stated adjudication schema rejects

**Evidence:** Design line 103 says admin intervention remains explicit and reasoned. Actual `yarnflow/server/erp-utils.mjs:53–56` allows an admin to exercise another role only with `data.interventionReason`; its audit helper separately stores ordinary reason and intervention (`:64–68`). Plan line 40 gives the adjudication input exactly `{expected_revision,outcome,reason,reference_ids}`, omitting `interventionReason`; design line 35 says unknown write fields are rejected. T05 line 100 asks for role mapping but has no admin-intervention fixture. Using the existing helper makes legitimate admin adjudication fail; bypassing it risks silently dropping the explicit intervention audit requirement. Ordinary adjudication reason does not state that the actor intervened outside the supervisor role.

**Correction:** Specify admin override behavior for each role-owned mutation and add the optional bounded intervention field to the canonical write schema where override is allowed; require and audit it when the actor is admin acting outside the named operational role. Alternatively explicitly prohibit that override. Align T01 fixtures and T05 role tests with the chosen rule.

**Test assertion:** Supervisor adjudication succeeds with ordinary reason; admin override without intervention reason is rejected; authorized admin override with both reasons persists both separately; dispatch/sales cannot override by supplying the field; unknown fields still fail. Apply the same rule to spec confirmation and sample operations where admin override is permitted.

## Existing safeguards and external gates

Tenant-derived identity and foreign-object 404 requirements already exist in the proposal (design lines 93–95,145); these are proposed guarantees, not verified new tables/routes. Existing photo lookup scopes metadata by workspace (`inventory.mjs:114–119`), and v2 should preserve that ownership pattern. The plan already recognizes the actual multipart route-order problem, private assertion requirement, fixed upstream, provider-auth mismatch and service limits; these are not counted again as missing requirements. Actual FastAPI v1 handlers in `scanner/services/api/main.py` have no application authentication dependency; deployed Modal adds proxy authentication (`modal_scanner.py:77`), while `scanner-proxy.mjs:9–11` emits optional bearer auth. The design correctly makes actual provider/service-auth integration proof mandatory rather than assuming compatibility.

G4 consent/rights/retention, G7 independent statistical authority and G8 authentication/storage/recovery signoff remain external gates, not approvals implied by this review. No collection, promotion, deployment or purchase is authorized here. Review-only/local demonstration remains the stated fallback; security corrections above still apply to authenticated data mutations even when automation is disabled.

## Verification and final recommendation

Proof was static source tracing with numbered source reads and contract comparison; no proposed runtime was represented as implemented and no product test was run. Resolve the three findings in design/T01/T02/T05 and retain the existing tenant/service-auth/failure tests before security-sensitive implementation acceptance. Field promotion remains blocked until the separately named external authorities and measured operational gates actually pass.
