# Reviewer 11 — serving/export/edge parity

Scope: independent source review of the incoming-QC design and implementation plan, 12 November 2026. No product changes, deployment, installations, model jobs or external approvals performed. Proposed v2 behavior is not shipped behavior. No P0 found.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (§§2–4, 6, 8–12, integrated acceptance details).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (contract/endpoints/DAG, T04–T12, integrated acceptance details).
- `scanner/deployment/{modal_scanner.py,requirements-serving.txt}`.
- `scanner/services/api/{main.py,uploads.py}`; `scanner/services/vision/{scanner.py,imageio.py,heads.py,backbone.py,fault.py}`.
- `scanner/training/scanner/{export_head_a.py,install_head_a.py}`; `scanner/training/fault/bench.py`; fault method score/preprocessing implementations.
- `scanner/tests/test_head_a_serving.py`.
- `yarnflow/server/{cloudflare.mjs,scanner-proxy.mjs}`, `yarnflow/wrangler.jsonc`, `yarnflow/src/scanner-client.ts`.

## Findings

### P1 — Original upload preservation does not remove the server's unconditional 1600-pixel reduction

**Existing evidence:** `scanner/services/vision/imageio.py:12–24` defaults every decode to longest-side 1600 after EXIF normalization; `scanner/services/vision/scanner.py:45–49` calls that default before any model. `scanner/services/vision/fault.py:134–143` then independently reduces a crop until at most six tiles remain. Keeping the uploaded file unchanged therefore does not mean inference used its physical resolution.

**Proposed gap:** Design §6 correctly requires original-resolution close-ups and invalidates unprofiled downsampling. T04 explicitly forbids the arrival client's shrink, but neither T04 nor T06 names the existing decoder as an ownership boundary or asserts that server decoding preserves source support. A detector-independent adapter can still inherit the existing reduction. High-frequency thread/defect evidence may be lost before quality or metrology can assess it.

**Correction:** Make the v2 decode/transform contract explicit in T04/T06 and include `imageio.py` or a v2-owned decoder in the file ownership list. Preserve bounded original raster for physical assessment, use separate explicitly versioned classifier/defect derivatives, and bind each resize to source dimensions and the calibrated profile; preserve v1's current default. This does not require unlimited decoding.

**Test assertion:** A bounded 4032×3024 image with EXIF rotation reaches v2 quality/metrology with the expected upright original dimensions and source-pixel Jacobian; any model derivative records its exact resize. An unvalidated 1600-pixel or six-tile reduction yields review/recapture, never silently inherits the original's resolution eligibility. Existing v1 decode tests retain their current behavior. Physical validity remains G3 authority, not a synthetic-test conclusion.

### P1 — The claimed no-decision-on-timeout invariant lacks a distributed deadline/finalization contract

**Existing evidence:** `yarnflow/src/scanner-client.ts:263–289` implements a browser AbortController timeout; `yarnflow/server/scanner-proxy.mjs:13–23` creates a new upstream Request with no propagated signal or deadline. `scanner/deployment/modal_scanner.py:71–72` allows 180 seconds of execution and 240 seconds startup. Client abort alone cannot prove that downstream execution or an eventual write stopped.

**Proposed gap:** Plan endpoint map promises a 60-second analyze deadline and “no durable decision on timeout”; T06 mentions bounded deadlines, while design §9 finalization rechecks revisions/hashes and its integrated details recheck release/calibration expiry. There is no specified request deadline binding or commit-time deadline check. A valid, unchanged release can still produce a late decision after the promised request timeout. Conversely, a response lost after a successful commit cannot truthfully guarantee no decision merely because the client timed out.

**Correction:** Define server deadline separately from client transport timeout. Bind an absolute Worker deadline to the asserted request and enforce it again at atomic finalization; a late service result cannot commit. Document that a client timeout after a commit has an unknown outcome resolved by the durable idempotency key/GET, rather than asserting it never committed. Propagate cancellation where useful, without treating it as transactional proof.

**Test assertion:** Hold inference beyond the server deadline, then release it with otherwise valid evidence: no decision/event commit, and replay cannot finalize that expired execution. Separately drop the response after a timely commit: retry returns exactly that committed result with no additional revision. Cold-start time is included in the declared end-to-end deadline. This is an implementation proof; G8 still controls hosted readiness.

### P2 — Serving proof occurs after the task that produces a signed release

**Existing evidence:** Modal image warmup asserts only scanner version/nonstub (`scanner/deployment/modal_scanner.py:17–24`), copies fixed scanner-v8/custom artifacts (`:45–59`) and constrains capacity (`:64–77`). Existing export emits head metadata and safetensors (`scanner/training/scanner/export_head_a.py:138–152`); the serving head uses device-dependent precision and may fall back from half to float (`scanner/services/vision/heads.py:105–106,177–197`). Neither a successful export nor warmup establishes target runtime or end-to-end decision parity.

**Proposed contradiction:** Design §12 schedules serving parity in February before March release, and §4 requires security/persistence verification for automatic mode. Plan DAG instead puts T12 after T11; T11 explicitly produces a signed release and consumes only T04/T09/T10, while actual target benchmarking/parity, credential mismatch, capacity and recovery proof are T12. The global external-gate language mitigates this, but the task interfaces do not identify how the T11 output remains unactivatable pending T12.

**Correction:** Split statistical eligibility from activation: T11 produces a signed statistical candidate, and activation requires a separately bound T12 operations/parity evidence hash plus G8 approval. Alternatively move minimum target parity/security proof before release. Bind runtime/precision and serving transform identity into that proof; optional ONNX/INT8 work remains optional. A local review-only demo need not await production certification.

**Test assertion:** A statistically successful candidate without matching target operations/parity proof is rejected by the release activation endpoint. Changing target precision/preprocessing/artifact invalidates the bound proof; the threshold-adjacent corpus must pass actual Worker→private service→finalization decision parity before activation. This is a release dependency test, not a replacement for independent G7 statistics or G8 signoff.

## Final recommendation

Revise the deadline contract and server-resolution ownership before implementation; make statistical release versus deployment activation explicit in the DAG. Keep v2 review-only until the actual target, independently authorized physical/statistical evidence and operations signoff agree. Existing private-auth reconciliation, fault-loader absence, taxonomy/calibration mismatch and published Worker routing are already acknowledged in the draft/integrated acceptance details and are not additional findings here.

Verification: read-only source trace, with exact line evidence above; no runtime parity or physical performance claimed. Only this review document was authored.
