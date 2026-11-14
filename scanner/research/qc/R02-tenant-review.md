# R02 — Tenant, role and session review of incoming-fabric QC v2

**Date:** 14 November 2026
**Reviewer:** independent, read-only review
**Target:** `yarnflow/server/qc.mjs`, `yarnflow/server/qc-store.mjs`, and the session/authority code they depend on (`inventory.mjs`, `admin.mjs`, `auth.mjs`), plus `drizzle/0033_incoming_fabric_qc.sql`.
**Claim tested:** a signed-in person can never read or change another workspace's QC data, never act above their role, and never act with a dead, logged-out or superseded session.

## Result

**0 P0, 0 P1, 2 P2 proven findings.** No cross-workspace read or write, no role escalation, and no use of a dead/expired/superseded session was reproduced. The two P2 gaps concern an account lockout that does not end an existing session, and an independent-signatory identity check that is bypassed by trivial Unicode/whitespace variants. Neither breaks tenant isolation.

| Class | Attack covered | Outcome |
|---|---|---|
| A | Foreign workspace IDs on every route and every id-taking store export | Held — 404 identical to a missing id; no writes |
| B | SQL on `qc_*` tables without `workspace_id` | Held — workspace-scoped at every id boundary; unscoped updates fenced |
| C | Idempotency replay across users/workspaces and key reuse with a different body | Held — per actor/workspace/route/body |
| D | Per-route lowest-role enforcement and client-supplied authority fields | Held — 403/422; authority always derived from the session |
| E | Dead, expired, superseded, locked, removed sessions; late finalisation | Mostly held — **R02-01 (P2)** for lockout; everything else refused |
| F | Blob/object-key cross-tenant read/write and key guessability | Held — keys are server-derived and workspace-prefixed |
| G | Release/signatory proof cross-tenant actions and `approved_by` equality | Cross-tenant held; **R02-02 (P2)** for signatory aliasing |
| H | CSRF, method and idempotency-header enforcement | Held — origin/method/key enforced before parsing |

Baseline before the review: `node --test tests/qc-api.test.mjs tests/qc-store.test.mjs` → **45 pass, 0 fail, 1 todo** (the pre-existing todo is `registered sampling-plan/roll/face authority rejects an unknown binding`). The 16 targeted tests in this review all pass.

---

## R02-01 — An account lockout does not end an existing session

**Severity:** P2 (defence in depth; tenant isolation and role limits unaffected)
**Where:**
- `yarnflow/server/inventory.mjs:294` — the per-request session lookup filters on `s.expires_at`, `u.status`, `u.deactivated_at` and `u.portal_role`, but **not** `u.locked_until`.
- `yarnflow/server/qc-store.mjs:127` — `authGuard` repeats the same filters at commit time, again without `locked_until`.
- `yarnflow/server/qc.mjs:183` — only the `/reauth` route checks `user.locked_until > now`.

**Attack.** Sign in normally, then make the account fail enough PIN attempts to lock it (or have an owner lock it). A new sign-in is refused with 429, but the already-issued session cookie keeps working for every route its role can reach. The test locks Quincy (`quality_inspector`) after creating a fresh selection, then creates a sample through the HTTP boundary. The mutation succeeds with `201`; `/reauth` is the only route that refuses (`403`).

**Observed:**

| Request | Observed |
|---|---|
| `POST /api/auth/login` with the right PIN while locked | `429` |
| `POST /api/qc/v2/samples` with the existing session | **`201`** (new sample created) |
| `POST /api/qc/v2/reauth` with the existing session | `403 FORBIDDEN` |

**Expected.** A lock is the system's containment response to PIN guessing. If it is meant to contain a suspected-compromised account, it must also stop the existing session, as PIN reset (`admin.mjs:207`) and deactivation/removal (`admin.mjs:166,207`) already do. Either state that a lock is sign-in-only (and remove the expectation that it contains a live session), or fence the session on `u.locked_until` in both the read lookup and `authGuard`, and/or delete the user's sessions when the lock is applied.

**Impact.** Someone holding a session (shared device, stolen cookie, or a session established before the operator reacted) keeps full role ability for the duration of the lock. It does not cross a workspace boundary and does not raise a role.

**Reproduction** (run with the harness in Appendix A):

````js
test('E: an account lockout does not end an existing session (observed)', async () => {
  const A = f.ids, user = f.sql.prepare('SELECT * FROM users WHERE id=?').get(f.http.Quincy.ctx.user_id);
  const po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id;
  // A fresh selection so the audit below is a real, successful write rather than a duplicate-sample conflict.
  const fresh = await qc(f, '/selections', { token: f.http.Quincy.token, body: selectionBody(po) });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
  const attack = () => qc(f, '/samples', { token: f.http.Quincy.token, body: sampleBody(fresh.data.id, A.spec) });
  f.sql.prepare('UPDATE users SET failed_attempts=0,locked_until=? WHERE id=?').run(Date.now() + 300000, user.id);
  const login = await api(f, '/api/auth/login', { body: { name: 'Quincy', pin: '2468' } });
  assert.equal(login.status, 429, 'the lockout stops a new sign-in');
  const mutation = await attack();
  console.log('OBSERVED locked account mutation:', mutation.status, code(mutation));
  assert.equal(mutation.status, 201, 'the mutation reaches the workspace and is authorised despite the lock');
  const pin = await qc(f, '/reauth', { token: f.http.Quincy.token, body: { pin: '2468', payload_sha256: hex } });
  assert.equal(pin.status, 403, 'but /reauth does honour the lock');
  f.sql.prepare('UPDATE users SET locked_until=0 WHERE id=?').run(user.id);
});
````

---

## R02-02 — The independent-signatory check is defeated by whitespace and zero-width characters

**Severity:** P2 (policy/attestation control defeated; activation remains gated)
**Where:** `yarnflow/server/qc-store.mjs:667`

```js
if (input.independent_signatory.trim().toLowerCase() === ctx.name.trim().toLowerCase())
  qcFail('VALIDATION_FAILED', [], 'The independent signatory must be a different person.');
```

**Attack.** Register a statistical-candidate release as the sole admin. The route requires a valid fresh-PIN proof, which the attacker has. Send `independent_signatory` as `'A n a s'` or `'Anas\u200B'` instead of `'Anas'`. `trim()` removes only the ends and `toLowerCase()` does not remove internal whitespace or Unicode format characters, so the equality check fails open. The release is created with `approved_by` equal to the admin's own user id and a signatory string that is the admin's name plus formatting.

**Observed:**

| `independent_signatory` | Observed |
|---|---|
| `'Anas'` | `422 VALIDATION_FAILED` |
| `' ANAS '` | `422 VALIDATION_FAILED` |
| `'A n a s'` | **`201`** release created |
| `'Anas\u200B'` | **`201`** release created |
| `'Nobody At All'` | **`201`** release created (any free text is accepted) |

In both bypass cases the stored `json.approved_by` is the admin's user id and the stored signatory satisfies `signatory.trim().toLowerCase() !== admin.name.trim().toLowerCase()`.

**Expected.** The control should compare an identity, not a rendering of a name. Either bind the signatory to `users.id` (and require a different active person, ideally not in the same workspace), or canonicalize both sides with NFKC, removal of all `\p{White_Space}` and `\p{Cf}` characters, and case folding before comparing, and reject a signatory that does not resolve to a real authority record. The `authority_record_sha256` is currently supplied by the same admin and is not resolved server-side.

**Impact.** A sole admin can produce a candidate whose four-eyes/independence attestation is their own name disguised by a space or a zero-width character. Activation is still blocked unless deployment-level gates G1–G8 and operations/monitoring hashes are present, and it still needs a fresh PIN proof, so this does not by itself enable automatic decisions. It does falsify the release record that reviewers and auditors rely on.

**Reproduction** (run with the harness in Appendix A):

````js
test('G: the independent-signatory check is defeated by whitespace and unicode, not by case or padding', async () => {
  const A = f.ids, admin = f.http.Anas.ctx;
  async function attempt(signatory) {
    const body = releaseBody({ independent_signatory: signatory, predecessor_release_id: A.release });
    const { proof, ...payload } = body;
    const payloadSha = await sha256Hex(canonicalJson(payload));
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
    await store.issueProof(f.env.DB, admin, payloadSha, Date.now(), token);
    return qc(f, '/releases', { token: f.http.Anas.token, body: { ...body, proof: token } });
  }
  assert.equal((await attempt('Anas')).status, 422, 'the same name is refused');
  assert.equal((await attempt(' ANAS ')).status, 422, 'case and padding are normalised');
  const spaced = await attempt('A n a s');
  const zeroWidth = await attempt('Anas\u200B');
  const invented = await attempt('Nobody At All');
  console.log('OBSERVED signatory variants:', spaced.status, zeroWidth.status, invented.status);
  assert.equal(spaced.status, 201);
  assert.equal(zeroWidth.status, 201);
  assert.equal(invented.status, 201, 'any name nobody holds is accepted');
  for (const r of [spaced, zeroWidth, invented]) {
    const row = f.sql.prepare('SELECT json FROM qc_releases WHERE id=?').get(r.data.id), saved = JSON.parse(row.json);
    assert.equal(saved.approved_by, admin.user_id);
    assert.equal(saved.independent_signatory.trim().toLowerCase() !== admin.name.trim().toLowerCase(), true);
  }
});
````

---

## Held — attacks that were tried and did not work

Each row names the test in Appendix B that proves it. All 16 tests pass in one run. A "held" result means the test **asserts the refusal**, so a passing test is evidence the attack failed.

| # | Attack | Observed on refusal | Test |
|---|---|---|---|
| 1 | Foreign workspace id on all 14 id-taking routes: `GET /specs/:id`, `/samples/:id`, `/requests/:id`, `/captures/:id/original`; `POST /specs`, `/selections`, `/samples`, `/samples/:id/capture-sets`, `/capture-sets/:id/close`, `/samples/:id/analyze`, `/samples/:id/adjudications`, `/releases/:id/activate`, `/releases/:id/suspend`, `/capture-sets/:id/captures` | Every foreign id produced exactly the same status, code, reasons and retryable flag as a random missing id: `404 NOT_FOUND`. No table in either workspace changed (the only rows written were `FAILED` idempotency rows in the attacker's own workspace). | `A: every route returns 404 for a foreign id exactly as for a missing id` |
| 2 | Call every id-taking store export with workspace B's context and workspace A's ids: `getSpec`, `loadResult`, `createCaptureSet`, `addCapture`, `closeCaptureSet`, `buildAnalyzeInputs`, `prepareAnalysis`, `appendAdjudication`, `activateRelease`, `suspendRelease`, `withdrawConsent`, `registerRelease` (predecessor), `requestState` | `NOT_FOUND` / `FORBIDDEN` / `VALIDATION_FAILED`; A's release state, proof count and evidence/decision counts unchanged; B's lists empty. | `A: store functions called with workspace B and an A id find nothing` |
| 3 | Forge workspace B's context with A's `started` analysis request: `completeRequest`, `finalizeQC`, `failRequest` | `completeRequest` → `CONFLICT`; `finalizeQC` → `CONFLICT`/`FORBIDDEN`; `failRequest` is a silent no-op because its `UPDATE` carries `workspace_id` and `actor_id`. The request stayed `IN_PROGRESS`. The `qc_idempotency` `UPDATE` inside `finalizeQC` (`qc-store.mjs:613`) is not workspace-scoped in its own `WHERE`, but the batch's guard at line 599 fences it, and the test confirms no row moves. | `B: an unscoped UPDATE cannot reach another workspace through a forged started request` |
| 4 | `requestState` / `expireRequest` on another workspace's request | Foreign request → `404`; the row stays `IN_PROGRESS`. The owner's own past-deadline request → `EXPIRED`. | `B: expireRequest only ever expires the caller's own request` |
| 5 | Blob/object-key attacks: supply `object_key` in capture metadata; upload into A's capture set from B; replay A's capture id with different bytes | Client `object_key` → `422`; foreign set → `404` with zero bucket growth; same capture id → `409` and the stored bytes are byte-identical. Keys are server-generated with a `qc/<workspace-hex>/` prefix (`qc-store.mjs`), and `qc_captures.object_key` is globally unique (`0033_incoming_fabric_qc.sql:127`). | `B: cannot fetch A originals and cannot write into A object keys` |
| 6 | Idempotency: same actor/key different body; same key different actor in the same workspace; same key/body in another workspace; cross-actor replay of a completed analysis | Same actor/key + same body → exact stored response; same key different body → `CONFLICT`; different actor → a different row/result; different workspace → a fresh row in that workspace; another actor's request id → `404` and never the stored result. Keys are selected by `(workspace_id, actor_id, route, client_key)` (`0033:199`) and `replayOf` also compares `body_sha256` (`qc-store.mjs:152-159`). | `B: idempotency keys are per actor, per workspace and per body` |
| 7 | Every mutation with every lower role, with and without `interventionReason`; every non-admin route as admin without a reason; client-supplied `workspace_id`, `actor_id`, `role`, `automatic`, `status`, `approved_by`, `admin` | Lower role → `403 FORBIDDEN` with and without the reason; admin without a reason → `403`; the eight authority fields → `422 VALIDATION_FAILED`; no table changed. `permit` (`qc.mjs:37`) only lets an admin through with a ≥5-character audited reason, and `own()` allow-lists every body field. | `D: every mutation refuses each lower role server-side…`; `D: client-supplied authority fields are rejected…` |
| 8 | Session death and supersession: logout, expiry, PIN change, deactivation, removal, role change, a session row re-inserted for a deactivated user, role/PIN/logout between read and commit, late `finalizeQC`/`failRequest` after logout/expiry | Logout/expiry/PIN change/deactivation/removal/re-inserted session → `401 UNAUTHENTICATED`; a downgraded inspector's very next request → `403`; the read-then-commit race → `CONFLICT` with no writes; late finalisation/failure → no evidence/decision and the request stays `IN_PROGRESS`. `authGuard` (`qc-store.mjs:127`) rechecks the live session, role and PIN epoch inside the commit batch; `inventory.mjs:294` re-resolves the session on every request. | `E: dead, expired and superseded sessions cannot mutate`; `E: a role, PIN or session change between read and commit writes nothing`; `E: late finalisation after logout or expiry writes nothing`; `E: a role change applies on the next request and a resurrected session row is still refused` |
| 9 | Release/proof attacks: B activates/suspends A's release; B consumes A's proof; A reuses a consumed proof on another release; A replays the same proof | Foreign release → `404`, identical to a missing id, and the state stays `ACTIVE`; B's release list is empty; B's `consumeProof` → `FORBIDDEN`; a consumed proof on a second release → `403`; replay on the already-active release → `409` (state), never a second activation. A proof row binds `workspace_id`, `actor_id`, `session_hash`, `payload_sha256`, expiry and `used_at IS NULL` (`qc-store.mjs:651-657`). | `F: only the owning workspace can activate, suspend or cite a release…` |
| 10 | CSRF/method/header: missing or foreign `Origin`, `Sec-Fetch-Site: cross-site`, missing/malformed/uppercase `Idempotency-Key`, GET on a mutation route, multipart POST without a key | No/foreign origin or cross-site → `403`; missing/malformed/uppercase key → `422`; multipart body rejected before parsing when the key is absent; GET on a POST-only path → `405`. | `H: mutations without a same-origin Request and an idempotency key are refused before parsing` |
| 11 | Reads above one's role (sales/dispatch reading samples, decisions, releases, originals) | Allowed by design: `scanner/research/qc/contract-decisions.md:65-83` specifies "any signed-in" for `/status`, `/purchase-orders`, `/specs/:id`, `/consent-authorities`, `/samples`, `/samples/:id`, `/captures/:id/original` and `/releases`. Not reported as a finding; noted so the read surface is not mistaken for an omission. | Covered by the route table and `contract-decisions.md` |

---

## Not tested

- **Real D1, R2 and cross-isolate concurrency.** The harness uses `fixtureDouble()`'s in-memory SQLite and a `Map` bucket. The guards are synchronous inside one batch and were exercised sequentially, not under a stress race. A future test should interleave two Workers against one D1 database.
- **Cloudflare Workers runtime and cookie semantics.** `SameSite`, `Secure`, `HttpOnly`, path scoping and TLS termination were not inspected; the tests inject a `yf_session` cookie directly.
- **Maintenance/global SQL in `qc-monitoring.mjs:101` and `qc-retention.mjs`.** These are not request-path queries and only claim `PENDING`/`GC_CLAIMED` rows. I did not audit them for cross-workspace effects; they are out of this claim's scope.
- **The Python scanner and service-to-service assertion.** `issueQCAssertion`, the `QC_SERVICE_KEY`, and `sendQCToScanner` were treated as trusted. A compromised scanner or service key is a different threat model.
- **Denial of service, rate limiting, upload bombs beyond the declared limits, and log/PII exposure.** Not part of the tenant/role/session claim.
- **Clock behaviour beyond the injected `QC_NOW`.** Deadline and lease tests use the fixture clock; real clock skew between Workers was not measured.
- **The pre-existing todo** `registered sampling-plan/roll/face authority rejects an unknown binding` (`tests/qc-store.test.mjs:67`) was not analysed. It is unrelated to tenant, role or session boundaries.

---

## Reproducing

The review left no source changes. To rerun everything, recreate `yarnflow/tests/_r02_tmp/` with the three files below and run from `yarnflow/`:

```sh
node --test tests/_r02_tmp/t1-tenant.mjs tests/_r02_tmp/t2-authz.mjs
```

The harness reuses the canonical fixture helpers already kept in `yarnflow/tests/qc-store.test.mjs` (`fixtureDouble`, `uploadedDouble`, `analysisDouble`, `idemDouble`, `proofDouble`, `doubleRecord`). Those helpers only self-register tests when their own file is the entry point, so importing them is safe.

### Appendix A — `tests/_r02_tmp/fixture.mjs`

````js
// R02 review harness: throwaway, deleted after the review.
import { readFileSync } from 'node:fs';
import { sqliteBinding } from '../../server/sqlite.mjs';
import { userRow, sha256, randomHex } from '../../server/auth.mjs';
import * as store from '../../server/qc-store.mjs';
import { contentSha256, HASH_EXCLUDES } from '../../server/qc-contract.mjs';
import { inventoryApi } from '../../server/inventory.mjs';
import { fixtureDouble, uploadedDouble, analysisDouble, idemDouble, doubleRecord } from '../qc-store.test.mjs';

export const ORIGIN = 'https://yarnflow.test';
export const DAY = 86400000;
export const hex = 'a'.repeat(64);

/** A real JPEG-shaped original the upload route accepts (41 bytes, 100x100). */
export function jpeg() {
  const app0 = [0x4a,0x46,0x49,0x46,0x00, 1,1, 0, 0,1, 0,1, 0,0];
  const sof = [8, 0,100, 0,100, 3, 1,0x11,0, 2,0x11,1, 3,0x11,1];
  return Uint8Array.from([0xff,0xd8, 0xff,0xe0,0x00,0x10, ...app0, 0xff,0xc0,0x00,0x11, ...sof, 0xff,0xd9]);
}

export async function sessionFor(sql, userId, expiresAt = Date.now() + 100 * DAY) {
  const token = randomHex(32), tokenHash = await sha256(token);
  sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(tokenHash, userId, expiresAt, Date.now());
  return { token, sessionHash: tokenHash };
}

/** Create a workspace and one signed-in person per [name, role]. */
export async function addWorkspace(sql, people) {
  const workspaceId = crypto.randomUUID(), now = Date.now(), users = {};
  sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(workspaceId, 'R02 ' + workspaceId.slice(0, 8), now);
  for (const [name, role] of people) {
    const row = await userRow({ workspaceId, name, role, pin: '2468', createdBy: 'r02' });
    sql.prepare(row.sql).run(...row.args);
    const user = sql.prepare('SELECT * FROM users WHERE id=?').get(row.args[0]);
    const { token, sessionHash } = await sessionFor(sql, user.id);
    users[name] = { token, id: user.id, role, user,
      ctx: { user_id: user.id, workspace_id: workspaceId, name, role, admin: role === 'admin', session_hash: sessionHash, session_expires_at: now + 100 * DAY, auth_epoch: user.pin_hash } };
  }
  return { workspaceId, users };
}

/** Attach an HTTP-capable session to each fixtureDouble context, then add workspace B and A's extra people. */
export async function harness() {
  const f = await fixtureDouble();
  const aNames = { Anas: 'admin', 'QC double': 'quality_inspector', 'PO double': 'purchase_manager', 'Review double': 'supervisor' };
  f.http = {};
  for (const [name] of Object.entries(aNames)) {
    const user = f.sql.prepare('SELECT * FROM users WHERE name=?').get(name);
    const { token, sessionHash } = await sessionFor(f.sql, user.id);
    f.http[name] = { token, ctx: { ...(name === 'Anas' ? f.admin : name === 'QC double' ? f.ctx : name === 'PO double' ? f.manager : f.supervisor), session_hash: sessionHash, auth_epoch: user.pin_hash } };
  }
  // A second quality inspector inside workspace A (other-user idempotency tests).
  const quincyId = await f.person('Quincy', 'quality_inspector');
  const quincy = f.sql.prepare('SELECT * FROM users WHERE id=?').get(quincyId), qs = await sessionFor(f.sql, quincyId);
  f.http.Quincy = { token: qs.token, ctx: { user_id: quincyId, workspace_id: f.workspaceId, name: 'Quincy', role: 'quality_inspector', admin: false, session_hash: qs.sessionHash, session_expires_at: Date.now() + 100 * DAY, auth_epoch: quincy.pin_hash } };
  for (const [name, role] of [['Rhea', 'quality_inspector'], ['Sohail', 'sales_manager'], ['Daud', 'dispatch'], ['Tobias', 'quality_inspector'], ['Uma', 'quality_inspector']]) {
    const id = await f.person(name, role), user = f.sql.prepare('SELECT * FROM users WHERE id=?').get(id), s = await sessionFor(f.sql, id);
    f.http[name] = { token: s.token, ctx: { user_id: id, workspace_id: f.workspaceId, name, role, admin: false, session_hash: s.sessionHash, session_expires_at: Date.now() + 100 * DAY, auth_epoch: user.pin_hash } };
  }
  const B = await addWorkspace(f.sql, [['Bea', 'admin'], ['Bilal', 'purchase_manager'], ['Bina', 'quality_inspector'], ['Babar', 'supervisor']]);
  f.B = B;
  f.env.QC_AUTOMATION_GATES = JSON.stringify(Object.fromEntries(['G1','G2','G3','G4','G5','G6','G7','G8'].map(g => [g, hex])));
  return f;
}

/** A statistical candidate release in the fixture workspace, with operations and monitoring proof. */
export async function candidateRelease(f, extra = {}) {
  const release = { ...doubleRecord('release-active'), id: crypto.randomUUID(), workspace_id: f.workspaceId, version: 'r02-release-' + crypto.randomUUID().slice(0, 8),
    approved_by: f.admin.user_id, independent_signatory: 'R02 independent signatory', expires_at: new Date(Date.now() + 3600_000).toISOString(),
    operations_proof_sha256: hex, monitoring_protocol_sha256: hex, ...extra };
  release.sha256 = await contentSha256(release, HASH_EXCLUDES.Release);
  const { state, ...frozen } = release;
  f.sql.prepare("INSERT INTO qc_releases(workspace_id,id,state,sha256,json,domain_json,policy_json,expires_at,created_by,created_at,updated_at) VALUES(?,?,'STATISTICAL_CANDIDATE',?,?,?,?,?,?,?,?)")
    .run(f.workspaceId, release.id, release.sha256, JSON.stringify(frozen), JSON.stringify(doubleRecord('domain-manifest')), JSON.stringify(doubleRecord('policy-automatic')), Date.parse(release.expires_at), f.admin.user_id, Date.now(), Date.now());
  return release;
}

export function proofFor(f, ctx, id) {
  // The route hashes canonicalJson of the body without `proof`.
  return null;
}

async function request(f, path, { method = 'POST', body, token, key, headers = {}, form } = {}) {
  const h = { Origin: ORIGIN, ...(token ? { Cookie: `yf_session=${token}` } : {}), ...headers };
  if (key !== null) h['Idempotency-Key'] = key ?? crypto.randomUUID();
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] ??= 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  const response = await inventoryApi(new Request(ORIGIN + '/api/qc/v2' + path, { method, headers: h, ...(payload === undefined ? {} : { body: payload }) }), f.env);
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
export { request };
export const qc = (f, path, options) => request(f, path, options);
export const api = async (f, path, options = {}) => {
  const h = { Origin: ORIGIN, 'Content-Type': 'application/json', ...(options.token ? { Cookie: `yf_session=${options.token}` } : {}), ...options.headers };
  const response = await inventoryApi(new Request(ORIGIN + path, { method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), headers: h, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }), f.env);
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
};

/** Selection/sample/adjudication bodies built from the frozen valid fixtures. */
export const selectionBody = purchase_order_id => { const { id, workspace_id, created_by, created_at, ...rest } = doubleRecord('selection-operational'); return { ...rest, purchase_order_id }; };
export const specBody = purchase_order_id => ({ purchase_order_id, expected_spec_version: null, construction: 'woven', allowed_fabric_labels: ['twill'], taxonomy_version: 'r02-taxonomy', density: ['ends', 'picks'].map(axis => ({ axis, unit: 'count/in', target: 70, lower: 65, upper: 75 })), confirmation_reason: 'R02 spec confirmation reason' });
export const sampleBody = (selection_id, spec_id, spec_version = 1) => ({ selection_id, spec_id, spec_version, predecessor_sample_id: null, expected_predecessor_revision: null, reason: null });
export const adjudicationBody = (expected_revision) => ({ expected_revision, outcome: 'UNDETERMINED', reason: 'R02 review of the sample', reference_ids: [], supersedes_id: null });
export const releaseBody = extra => ({ version: 'r02-candidate', domain: doubleRecord('domain-manifest'), policy: doubleRecord('policy-automatic'), bundle_sha256: hex, calibration_sha256: hex,
  statistics_report_sha256: hex, operations_proof_sha256: hex, monitoring_protocol_sha256: hex, authority_record_sha256: hex, independent_signatory: 'R02 Independent',
  expires_at: new Date(Date.now() + 3600_000).toISOString(), ...extra });

export async function uploadBody(f, selection, consentId, role = 'overview', extraMeta = {}) {
  const bytes = jpeg(), hash = await sha256HexBytes(bytes);
  const form = new FormData();
  form.set('meta', JSON.stringify({ capture_id: crypto.randomUUID(), role, expected_revision: 0, sha256: hash, taken_at: new Date().toISOString(),
    device_profile_id: 'r02-device', calibration_id: null, consent_record_id: consentId, attestation: { ...doubleRecord('attestation-web-unobserved'), image_sha256: hash }, ...extraMeta }));
  form.set('original', new Blob([bytes], { type: 'image/jpeg' }), 'original.jpg');
  return form;
}
async function sha256HexBytes(bytes) { const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join(''); }

/** Fully populated workspace A: open sample with three originals, one closed set, one decision, one adjudication, one candidate release. */
export async function populated() {
  const f = await harness();
  const u = await uploadedDouble(f);
  const a = await analysisDouble(f, u);
  const decision = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now);
  const after = await store.loadResult(f.env.DB, f.workspaceId, f.result.sample.id, f.now);
  const adjudication = (await store.appendAdjudication(f.env.DB, f.supervisor, { ...adjudicationBody(after.revision), sample_id: f.result.sample.id, supersedes_id: null }, f.now)).body;
  const release = await candidateRelease(f);
  const second = await store.loadResult(f.env.DB, f.workspaceId, f.result.sample.id, f.now);
  return { ...f, u, a, decision, after: second, adjudication, release, requestId: a.started.request_id,
    ids: { spec: f.spec.id, selection: f.selection.id, sample: f.result.sample.id, set: u.set.id, capture: second.captures[0].id, consent: f.consent.id, release: release.id, request: a.started.request_id, adjudication: adjudication.current_human_disposition.id } };
}
````

### Appendix B — `tests/_r02_tmp/t1-tenant.mjs`

````js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../server/qc-store.mjs';
import { canonicalJson } from '../../server/qc-contract.mjs';
import { idemDouble, doubleRecord, uploadedDouble, analysisDouble } from '../qc-store.test.mjs';
import { populated, qc, specBody, selectionBody, sampleBody, adjudicationBody, uploadBody, hex } from './fixture.mjs';

const id = () => crypto.randomUUID();
const outcome = r => ({ status: r.status, code: r.data?.error?.code ?? null, reasons: r.data?.error?.reasons ?? null, retryable: r.data?.error?.retryable ?? null });
const tables = ['qc_po_specs', 'qc_selections', 'qc_samples', 'qc_capture_sets', 'qc_captures', 'qc_decisions', 'qc_adjudications', 'qc_evidence', 'qc_consent_authorities', 'qc_releases', 'qc_idempotency', 'qc_blob_claims', 'qc_reauth_proofs', 'qc_decision_events'];
const snapshot = f => Object.fromEntries(tables.map(t => [t, f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map(r => ({ ...r }))]));

let f;
test.before(async () => { f = await populated(); });
test.after(() => f.sql.close());

test('A: every route returns 404 for a foreign id exactly as for a missing id', async () => {
  const A = f.ids, B = f.B.users;
  const consent = (await store.registerConsent(f.env.DB, B.Bea.ctx, { authority_evidence_sha256: hex, operational_capture: true, operational_retention_days: 1, research_use: false, training_use: false, export_destinations: [], valid_from: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, Date.now())).body;
  const cases = [];
  const get = (label, path, token) => cases.push({ label, pair: target => qc(f, path(target), { method: 'GET', token, key: null }) });
  const post = (label, path, token, body, extra = {}) => cases.push({ label, pair: target => qc(f, path(target), { method: 'POST', token, body: body(target), ...extra }) });
  get('GET /specs/:id', t => `/specs/${t}`, B.Bea.token);
  get('GET /samples/:id', t => `/samples/${t}`, B.Bea.token);
  get('GET /requests/:id', t => `/requests/${t}`, B.Bea.token);
  get('GET /captures/:id/original', t => `/captures/${t}/original`, B.Bea.token);
  post('POST /specs', () => '/specs', B.Bilal.token, t => specBody(t));
  post('POST /selections', () => '/selections', B.Bina.token, t => selectionBody(t));
  post('POST /samples', () => '/samples', B.Bina.token, t => sampleBody(t, A.spec));
  post('POST /samples/:id/capture-sets', t => `/samples/${t}/capture-sets`, B.Bina.token, () => ({ expected_revision: 0 }));
  post('POST /capture-sets/:id/close', t => `/capture-sets/${t}/close`, B.Bina.token, () => ({ expected_revision: 0 }));
  post('POST /samples/:id/analyze', t => `/samples/${t}/analyze`, B.Bina.token, () => ({ expected_revision: 0, capture_set_id: A.set }));
  post('POST /samples/:id/adjudications', t => `/samples/${t}/adjudications`, B.Babar.token, () => adjudicationBody(0));
  post('POST /releases/:id/activate', t => `/releases/${t}/activate`, B.Bea.token, () => ({ proof: 'b'.repeat(64) }));
  post('POST /releases/:id/suspend', t => `/releases/${t}/suspend`, B.Bea.token, () => ({ reason: 'R02 cross tenant suspend attempt' }));
  cases.push({ label: 'POST /capture-sets/:id/captures', pair: async target => qc(f, `/capture-sets/${target}/captures`, { method: 'POST', token: B.Bina.token, form: await uploadBody(f, null, consent.id) }) });
  f.env.QC_SERVICE_KEY = 'r02-service-key'; f.env.TEXPILOT_API_URL = 'https://scanner.r02.test';
  const before = snapshot(f), seen = new Map();
  const foreign = { 'GET /specs/:id': A.spec, 'GET /samples/:id': A.sample, 'GET /requests/:id': A.request, 'GET /captures/:id/original': A.capture,
    'POST /specs': f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id, 'POST /selections': f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id,
    'POST /samples': A.selection, 'POST /samples/:id/capture-sets': A.sample, 'POST /capture-sets/:id/close': A.set, 'POST /samples/:id/analyze': A.sample,
    'POST /samples/:id/adjudications': A.sample, 'POST /releases/:id/activate': A.release, 'POST /releases/:id/suspend': A.release, 'POST /capture-sets/:id/captures': A.set };
  for (const c of cases) {
    const foreignOutcome = outcome(await c.pair(foreign[c.label]));
    const missingOutcome = outcome(await c.pair(id()));
    assert.equal(foreignOutcome.status, 404, c.label);
    assert.deepEqual(foreignOutcome, missingOutcome, c.label);
    seen.set(c.label, foreignOutcome);
  }
  // Nothing in workspace A or B moved: a foreign id is never a write.
  const after = snapshot(f);
  for (const table of tables.filter(t => !['qc_idempotency'].includes(t))) assert.deepEqual(after[table], before[table], table);
  // A itself can reach the very objects B was refused.
  assert.equal((await qc(f, `/samples/${A.sample}`, { method: 'GET', token: f.http['QC double'].token, key: null })).status, 200);
  assert.equal((await qc(f, `/specs/${A.spec}`, { method: 'GET', token: f.http['QC double'].token, key: null })).status, 200);
  assert.equal((await qc(f, `/captures/${A.capture}/original`, { method: 'GET', token: f.http['QC double'].token, key: null })).status, 200);
  assert.equal((await qc(f, `/requests/${A.request}`, { method: 'GET', token: f.http['QC double'].token, key: null })).status, 200);
  assert.equal((await qc(f, `/releases`, { method: 'GET', token: f.B.users.Bea.token, key: null })).data.items.length, 0);
  assert.equal((await qc(f, `/samples`, { method: 'GET', token: f.B.users.Bea.token, key: null })).data.items.length, 0);
  assert.equal((await qc(f, `/purchase-orders`, { method: 'GET', token: f.B.users.Bea.token, key: null })).data.items.length, 0);
  assert.equal((await qc(f, `/consent-authorities`, { method: 'GET', token: f.B.users.Bea.token, key: null })).data.items.length, 1);
  assert.equal((await qc(f, `/consent-authorities`, { method: 'GET', token: f.B.users.Bea.token, key: null })).data.items[0].id, consent.id);
});

test('A: store functions called with workspace B and an A id find nothing', async () => {
  const A = f.ids, b = f.B.users, db = f.env.DB, wB = f.B.workspaceId, now = Date.now();
  const releasesBefore = f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state;
  const proofBefore = f.sql.prepare('SELECT COUNT(*) AS n FROM qc_reauth_proofs').get().n;
  const checks = [
    ['getSpec', () => store.getSpec(db, wB, A.spec)],
    ['loadResult', () => store.loadResult(db, wB, A.sample, now)],
    ['sampleRow via createCaptureSet', () => store.createCaptureSet(db, b.Bina.ctx, { sample_id: A.sample, expected_revision: 0 }, now)],
    ['addCapture', () => store.addCapture(db, f.env.BUCKET, b.Bina.ctx, { capture_set_id: A.set, meta: { capture_id: id(), role: 'overview', expected_revision: 0, sha256: hex, taken_at: new Date(now).toISOString(), device_profile_id: 'r02', calibration_id: null, consent_record_id: A.consent, attestation: doubleRecord('attestation-web-unobserved') }, bytes: new Uint8Array([1]) }, now)],
    ['closeCaptureSet', () => store.closeCaptureSet(db, b.Bina.ctx, { capture_set_id: A.set, expected_revision: 0 }, now)],
    ['buildAnalyzeInputs', () => store.buildAnalyzeInputs(db, b.Bina.ctx, A.sample, A.set, 0, now)],
    ['prepareAnalysis', () => store.prepareAnalysis(db, f.env.BUCKET, b.Bina.ctx, { sample_id: A.sample, capture_set_id: A.set, expected_revision: 0 }, { request_id: id(), generation: 1, deadline_at: now + 60000 }, now)],
    ['appendAdjudication', () => store.appendAdjudication(db, b.Babar.ctx, { sample_id: A.sample, expected_revision: 0, outcome: 'UNDETERMINED', reason: 'R02 cross tenant review' }, now)],
    ['activateRelease', () => store.activateRelease(db, b.Bea.ctx, { id: A.release, gates: {}, payloadSha: hex, proof: 'c'.repeat(64) }, now)],
    ['suspendRelease', () => store.suspendRelease(db, b.Bea.ctx, { id: A.release, reason: 'R02 cross tenant suspension' }, now)],
    ['withdrawConsent', () => store.withdrawConsent(db, b.Bea.ctx, { id: A.consent, reason: 'R02 cross tenant withdrawal' }, now)],
    ['registerRelease predecessor', () => store.registerRelease(db, b.Bea.ctx, { version: 'x', domain: doubleRecord('domain-manifest'), policy: doubleRecord('policy-automatic'), bundle_sha256: hex, calibration_sha256: hex, statistics_report_sha256: hex, authority_record_sha256: hex, independent_signatory: 'Other', expires_at: new Date(now + 3600000).toISOString(), predecessor_release_id: A.release, proof: 'c'.repeat(64), payloadSha: hex }, now)],
    ['requestState', () => store.requestState(db, b.Bea.ctx, A.request, now)],
  ];
  for (const [name, call] of checks) await assert.rejects(call, error => ['NOT_FOUND', 'FORBIDDEN', 'VALIDATION_FAILED'].includes(error.code), name);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_reauth_proofs').get().n, proofBefore);
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state, releasesBefore);
  assert.equal((await store.activeRelease(db, wB, now))?.release.id, undefined);
  assert.deepEqual(await store.listSamples(db, wB), []);
  assert.deepEqual((await store.listConsent(db, wB, now)).map(c => c.id), [f.sql.prepare('SELECT id FROM qc_consent_authorities WHERE workspace_id=?').get(wB).id]);
  assert.equal(await store.currentSpecRow(db, wB, f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id), null);
  assert.equal(await store.replayOf(db, b.Bea.ctx, { route: '/analyze', key: f.a.idem.key, bodySha: 'f'.repeat(64) }), null);
  await assert.rejects(store.consentFor(db, wB, A.consent, now), error => error.code === 'FORBIDDEN');
  await assert.rejects(store.finalizeQC(db, b.Bina.ctx, f.a, f.u.result.revision, now), error => ['CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code));
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state, releasesBefore);
});

test('B: an unscoped UPDATE cannot reach another workspace through a forged started request', async () => {
  const A = f.ids, b = f.B.users, db = f.env.DB, now = Date.now();
  const started = f.a.started, row = () => ({ ...f.sql.prepare('SELECT state,response_status,response_json,generation FROM qc_idempotency WHERE request_id=?').get(started.request_id) });
  const before = row();
  await assert.rejects(store.completeRequest(db, b.Bina.ctx, started, 200, { stolen: true }, now), error => error.code === 'CONFLICT');
  assert.deepEqual(row(), before);
  // failRequest is workspace-scoped in its own WHERE: it changes nothing and does not throw.
  assert.equal(await store.failRequest(db, b.Bina.ctx, started, { code: 'SERVICE_UNAVAILABLE' }, now), undefined);
  assert.deepEqual(row(), before);
  // The unfinished-row UPDATE in finalizeQC is fenced by its own batch guard too.
  const counts = () => ['qc_evidence', 'qc_decisions'].map(t => f.sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  const evidenceBefore = counts();
  f.result = await store.loadResult(db, f.workspaceId, f.ids.sample, now);
  const u2 = await uploadedDouble(f), a2 = await analysisDouble(f, u2);
  await assert.rejects(store.finalizeQC(db, b.Bina.ctx, a2, u2.result.revision, now), error => ['CONFLICT', 'FORBIDDEN'].includes(error.code));
  assert.deepEqual(counts(), evidenceBefore);
  assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(a2.started.request_id).state, 'IN_PROGRESS');
});

test('B: expireRequest only ever expires the caller\'s own request', async () => {
  const A = f.ids, db = f.env.DB, now = Date.now(), requestId = id();
  f.sql.prepare("INSERT INTO qc_idempotency(workspace_id,actor_id,route,client_key,request_id,body_sha256,state,deadline_at,lease_expires_at,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,'IN_PROGRESS',?,?,1,?,?)")
    .run(f.workspaceId, f.ctx.user_id, '/r02/past', id(), requestId, hex, now - 1000, now - 1000, now - 5000, now - 5000);
  await assert.rejects(store.requestState(db, f.B.users.Bina.ctx, requestId, now), error => error.code === 'NOT_FOUND');
  assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(requestId).state, 'IN_PROGRESS');
  const own = await store.requestState(db, f.ctx, requestId, now);
  assert.equal(own.state, 'EXPIRED');
  assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(requestId).state, 'EXPIRED');
});

test('B: cannot fetch A originals and cannot write into A object keys', async () => {
  const A = f.ids, b = f.B.users;
  const key = f.sql.prepare('SELECT object_key FROM qc_captures WHERE id=?').get(A.capture).object_key;
  assert.ok(key.startsWith(`qc/${f.workspaceId.replaceAll('-', '')}/`), key);
  const storageBefore = f.storage.size;
  const consent = f.sql.prepare('SELECT id FROM qc_consent_authorities WHERE workspace_id=?').get(f.B.workspaceId).id;
  // The object key itself is never client-supplied.
  assert.equal((await qc(f, `/capture-sets/${A.set}/captures`, { token: b.Bina.token, form: await uploadBody(f, null, consent, 'overview', { object_key: key }) })).data.error.code, 'VALIDATION_FAILED');
  // Nor can an upload name another workspace's set, capture id or key.
  const denied = await qc(f, `/capture-sets/${A.set}/captures`, { token: b.Bina.token, form: await uploadBody(f, null, consent) });
  assert.equal(denied.status, 404); assert.equal(f.storage.size, storageBefore);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_captures WHERE workspace_id=?').get(f.B.workspaceId).n, 0);
  // A same-workspace replay with a different original cannot overwrite the stored bytes.
  const bytesBefore = f.storage.get(key);
  const sameId = await uploadBody(f, null, A.consent);
  const meta = JSON.parse(sameId.get('meta')); meta.capture_id = A.capture;
  sameId.set('meta', JSON.stringify(meta));
  const conflict = await qc(f, `/capture-sets/${A.set}/captures`, { token: f.http['QC double'].token, form: sameId });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
  assert.deepEqual(f.storage.get(key), bytesBefore);
});

test('B: idempotency keys are per actor, per workspace and per body', async () => {
  const db = f.env.DB, b = f.B.users, now = Date.now(), po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(f.ids.sample).purchase_order_id;
  const body = selectionBody(po), key = id();
  const qi = f.http['QC double'].ctx, quincy = f.http.Quincy.ctx, bina = f.B.users.Bina.ctx;
  const first = (await store.createSelection(db, qi, { ...body, idem: await idemDouble('/r02/selections', body) }, now)).body;
  const replay = (await store.createSelection(db, qi, { ...body, idem: { route: '/r02/selections', key: id(), bodySha: 'd'.repeat(64) } }, now)).body;
  assert.notEqual(replay.id, first.id);
  // Same key, same route, same body, other actor in the same workspace: a new row, never A's response.
  const idem = { route: '/r02/selections', key, bodySha: await (async () => (await import('../../server/qc-contract.mjs')).sha256Hex(canonicalJson(body)))() };
  const mine = (await store.createSelection(db, quincy, { ...body, idem }, now)).body;
  const theirs = (await store.createSelection(db, qi, { ...body, idem }, now)).body;
  assert.notEqual(mine.id, theirs.id);
  assert.equal((await store.createSelection(db, quincy, { ...body, idem }, now)).body.id, mine.id);
  const changed = { ...body, lot_ref: 'r02-different-lot' };
  const changedIdem = { route: idem.route, key, bodySha: await (await import('../../server/qc-contract.mjs')).sha256Hex(canonicalJson(changed)) };
  await assert.rejects(store.createSelection(db, quincy, { ...changed, idem: changedIdem }, now), error => error.code === 'CONFLICT');
  // Another workspace, same key and body, its own route-level actor: a fresh row, never a stored cross-tenant replay.
  const consentBody = { authority_evidence_sha256: hex, operational_capture: true, operational_retention_days: 1, research_use: false, training_use: false, export_destinations: [], valid_from: new Date(now - 1000).toISOString(), expires_at: new Date(now + 86400000).toISOString() };
  const consentIdem = { route: '/r02/consent', key, bodySha: await (await import('../../server/qc-contract.mjs')).sha256Hex(canonicalJson(consentBody)) };
  const aConsent = (await store.registerConsent(db, f.admin, { ...consentBody, idem: consentIdem }, now)).body;
  const bConsent = (await store.registerConsent(db, b.Bea.ctx, { ...consentBody, idem: consentIdem }, now)).body;
  assert.notEqual(aConsent.id, bConsent.id);
  assert.equal(f.sql.prepare('SELECT workspace_id FROM qc_consent_authorities WHERE id=?').get(bConsent.id).workspace_id, b.Bea.ctx.workspace_id);
  // Cross-actor replay of a durable analysis request starts a new request, never the other actor's outcome.
  const idem2 = await idemDouble('/r02/analyze', { x: 1 });
  const started = await store.beginRequest(db, qi, idem2, now);
  await store.completeRequest(db, qi, started.started, 200, { owner: 'QC double' }, now);
  const stolen = await store.beginRequest(db, quincy, idem2, now);
  assert.ok(stolen.started, JSON.stringify(stolen));
  assert.notEqual(stolen.started?.request_id, started.started.request_id);
  await assert.rejects(store.requestState(db, quincy, started.started.request_id, now), error => error.code === 'NOT_FOUND');
  assert.equal((await store.requestState(db, qi, started.started.request_id, now)).result.owner, 'QC double');
});
````

### Appendix C — `tests/_r02_tmp/t2-authz.mjs`

````js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../server/qc-store.mjs';
import { canonicalJson, sha256Hex } from '../../server/qc-contract.mjs';
import { fixtureDouble, uploadedDouble, analysisDouble, proofDouble, doubleRecord } from '../qc-store.test.mjs';
import { populated, qc, api, specBody, selectionBody, sampleBody, adjudicationBody, releaseBody, uploadBody, hex, candidateRelease, sessionFor } from './fixture.mjs';

const id = () => crypto.randomUUID();
const code = r => r.data?.error?.code ?? null;
const tables = ['qc_po_specs', 'qc_selections', 'qc_samples', 'qc_capture_sets', 'qc_captures', 'qc_decisions', 'qc_adjudications', 'qc_evidence', 'qc_consent_authorities', 'qc_releases', 'qc_reauth_proofs', 'qc_decision_events'];
const snapshot = f => Object.fromEntries(tables.map(t => [t, f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map(r => ({ ...r }))]));

let f;
test.before(async () => { f = await populated(); f.env.QC_SERVICE_KEY = 'r02-service-key'; f.env.TEXPILOT_API_URL = 'https://scanner.r02.test'; });
test.after(() => f.sql.close());

test('D: every mutation refuses each lower role server-side, with or without an intervention reason', async () => {
  const A = f.ids, rev = f.after.revision;
  const po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id;
  const consent = { authority_evidence_sha256: hex, operational_capture: true, operational_retention_days: 1, research_use: false, training_use: false, export_destinations: [], valid_from: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
  const routes = [
    ['/specs', 'purchase_manager', () => ({ ...specBody(po), expected_spec_version: 1 })],
    ['/consent-authorities', 'admin', () => consent],
    ['/selections', 'quality_inspector', () => selectionBody(po)],
    ['/samples', 'quality_inspector', () => sampleBody(A.selection, A.spec)], 
    [`/samples/${A.sample}/capture-sets`, 'quality_inspector', () => ({ expected_revision: rev })],
    [`/samples/${A.sample}/analyze`, 'quality_inspector', () => ({ expected_revision: rev, capture_set_id: A.set })],
    [`/samples/${A.sample}/adjudications`, 'supervisor', () => adjudicationBody(rev)],
    ['/reauth', 'admin', () => ({ pin: '2468', payload_sha256: hex })],
    ['/releases', 'admin', () => releaseBody()],
    [`/releases/${A.release}/activate`, 'admin', () => ({ proof: 'b'.repeat(64) })],
    [`/releases/${A.release}/suspend`, 'admin', () => ({ reason: 'R02 role matrix suspension' })],
  ];
  const people = { 'PO double': 'purchase_manager', 'QC double': 'quality_inspector', 'Review double': 'supervisor', Sohail: 'sales_manager', Daud: 'dispatch' };
  const before = snapshot(f);
  for (const [path, allowed, body] of routes) for (const [name, role] of Object.entries(people)) {
    if (role === allowed) continue;
    const plain = await qc(f, path, { token: f.http[name].token, body: body() });
    assert.equal(plain.status, 403, `${role} -> ${path}`);
    assert.equal(code(plain), 'FORBIDDEN', `${role} -> ${path}`);
    const escalated = await qc(f, path, { token: f.http[name].token, body: { ...body(), interventionReason: 'A lower role asking for an intervention' } });
    assert.equal(escalated.status, 403, `${role} + reason -> ${path}`);
    assert.equal(code(escalated), 'FORBIDDEN', `${role} + reason -> ${path}`);
  }
  // An admin still needs the audited intervention reason for a non-admin route.
  for (const [path, , body] of routes.filter(r => r[1] !== 'admin')) {
    const direct = await qc(f, path, { token: f.http.Anas.token, body: body() });
    assert.equal(direct.status, 403, `admin without reason -> ${path}`);
    assert.equal(code(direct), 'FORBIDDEN');
  }
  assert.deepEqual(snapshot(f), before);
});

test('D: client-supplied authority fields are rejected, never ignored or trusted', async () => {
  const A = f.ids, rev = f.after.revision;
  const po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id;
  const fields = { workspace_id: f.workspaceId, actor_id: f.http.Anas.ctx.user_id, role: 'admin', automatic: true, status: 'ACCEPT', approved_by: f.http.Anas.ctx.user_id, admin: true };
  const targets = [
    ['/specs', 'PO double', () => ({ ...specBody(po), expected_spec_version: 1 })],
    ['/samples', 'QC double', () => sampleBody(A.selection, A.spec)],
    [`/samples/${A.sample}/adjudications`, 'Review double', () => adjudicationBody(rev)],
    ['/releases', 'Anas', () => releaseBody()],
    ['/selections', 'QC double', () => selectionBody(po)],
  ];
  const before = snapshot(f);
  for (const [path, who, body] of targets) for (const [field, value] of Object.entries(fields)) {
    const r = await qc(f, path, { token: f.http[who].token, body: { ...body(), [field]: value } });
    assert.equal(r.status, 422, `${field} on ${path}`);
    assert.equal(code(r), 'VALIDATION_FAILED');
  }
  const consent = f.sql.prepare('SELECT id FROM qc_consent_authorities WHERE workspace_id=?').get(f.workspaceId).id;
  const form = await uploadBody(f, null, consent, 'overview', { automatic: true, workspace_id: f.workspaceId });
  assert.equal((await qc(f, `/capture-sets/${A.set}/captures`, { token: f.http['QC double'].token, form })).status, 422);
  assert.deepEqual(snapshot(f), before);
});

test('E: dead, expired and superseded sessions cannot mutate', async () => {
  const A = f.ids, po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id;
  const attack = token => qc(f, '/samples', { token, body: sampleBody(A.selection, A.spec) });
  const tobias = f.http.Tobias, tobiasUser = f.sql.prepare('SELECT * FROM users WHERE id=?').get(tobias.ctx.user_id);
  assert.notEqual((await attack(tobias.token)).status, 401);
  // logout
  assert.equal((await api(f, '/api/auth/logout', { method: 'POST', token: tobias.token })).status, 200);
  assert.equal((await attack(tobias.token)).status, 401); assert.equal(code(await attack(tobias.token)), 'UNAUTHENTICATED');
  // sign in again, then expire the session row
  const login = await api(f, '/api/auth/login', { body: { name: 'Tobias', pin: '2468' } });
  assert.equal(login.status, 200);
  const cookie = login.data && (await api(f, '/api/auth/login', { body: { name: 'Tobias', pin: '2468' } }));
  assert.equal(cookie.status, 200);
  // the login route sets a cookie; read it from a raw inventory call instead
  const raw = await (await import('../../server/inventory.mjs')).inventoryApi(new Request('https://yarnflow.test/api/auth/login', { method: 'POST', headers: { Origin: 'https://yarnflow.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tobias', pin: '2468' }) }), f.env);
  const token2 = raw.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.notEqual((await attack(token2)).status, 401);
  const hash2 = await sha256Hex(token2);
  f.sql.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now() - 1, hash2);
  assert.equal((await attack(token2)).status, 401);
  // PIN change ends every session
  const changed = await api(f, '/api/erp/admin/users/update', { token: f.http.Anas.token, body: { id: tobiasUser.id, pin: '1357' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(tobiasUser.id).n, 0);
  assert.equal((await attack(token2)).status, 401);
  assert.equal((await api(f, '/api/auth/login', { body: { name: 'Tobias', pin: '1357' } })).status, 200);
  // removal ends the session too
  const uma = f.http.Uma;
  assert.equal((await attack(uma.token)).status === 401, false);
  assert.equal((await api(f, '/api/erp/admin/users/remove', { token: f.http.Anas.token, body: { userId: uma.ctx.user_id } })).status, 200);
  assert.equal((await attack(uma.token)).status, 401);
  // deactivation ends the session
  const rhea = f.http.Rhea;
  assert.equal((await api(f, '/api/erp/admin/users/update', { token: f.http.Anas.token, body: { id: rhea.ctx.user_id, active: false } })).status, 200);
  assert.equal((await attack(rhea.token)).status, 401);
});

test('E: an account lockout does not end an existing session (observed)', async () => {
  const A = f.ids, user = f.sql.prepare('SELECT * FROM users WHERE id=?').get(f.http.Quincy.ctx.user_id);
  const po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id;
  // A fresh selection so the audit below is a real, successful write rather than a duplicate-sample conflict.
  const fresh = await qc(f, '/selections', { token: f.http.Quincy.token, body: selectionBody(po) });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
  const attack = () => qc(f, '/samples', { token: f.http.Quincy.token, body: sampleBody(fresh.data.id, A.spec) });
  f.sql.prepare('UPDATE users SET failed_attempts=0,locked_until=? WHERE id=?').run(Date.now() + 300000, user.id);
  const login = await api(f, '/api/auth/login', { body: { name: 'Quincy', pin: '2468' } });
  assert.equal(login.status, 429, 'the lockout stops a new sign-in');
  const mutation = await attack();
  console.log('OBSERVED locked account mutation:', mutation.status, code(mutation));
  assert.equal(mutation.status, 201, 'the mutation reaches the workspace and is authorised despite the lock');
  const pin = await qc(f, '/reauth', { token: f.http.Quincy.token, body: { pin: '2468', payload_sha256: hex } });
  assert.equal(pin.status, 403, 'but /reauth does honour the lock');
  f.sql.prepare('UPDATE users SET locked_until=0 WHERE id=?').run(user.id);
});

test('E: a role, PIN or session change between read and commit writes nothing', async () => {
  for (const change of ['role', 'pin', 'logout']) {
    const g = await fixtureDouble();
    const po = g.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(g.result.sample.id).purchase_order_id;
    const before = snapshot(g), input = { ...selectionBody(po), idem: { route: '/r02/commit', key: id(), bodySha: hex } };
    const db = { ...g.env.DB, async batch(statements) {
      if (change === 'role') g.sql.prepare("UPDATE users SET portal_role='dispatch' WHERE id=?").run(g.ctx.user_id);
      if (change === 'pin') g.sql.prepare("UPDATE users SET pin_hash='rotated' WHERE id=?").run(g.ctx.user_id);
      if (change === 'logout') g.sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(g.ctx.session_hash);
      return g.env.DB.batch(statements);
    } };
    await assert.rejects(store.createSelection(db, g.ctx, input, g.now), error => error.code === 'CONFLICT');
    assert.deepEqual(snapshot(g), before);
    g.sql.close();
  }
});

test('E: late finalisation after logout or expiry writes nothing', async () => {
  for (const change of ['logout', 'expire']) {
    const g = await fixtureDouble(), u = await uploadedDouble(g), a = await analysisDouble(g, u), before = proofDouble(g);
    if (change === 'logout') g.sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(g.ctx.session_hash);
    else g.sql.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(g.now, g.ctx.session_hash);
    await assert.rejects(store.finalizeQC(g.env.DB, g.ctx, a, u.result.revision, g.now));
    assert.deepEqual(proofDouble(g), before);
    assert.equal(g.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(a.started.request_id).state, 'IN_PROGRESS');
    await assert.rejects(store.failRequest(g.env.DB, g.ctx, a.started, { code: 'SERVICE_UNAVAILABLE' }, g.now));
    assert.equal(g.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(a.started.request_id).state, 'IN_PROGRESS');
    g.sql.close();
  }
});

test('E: a role change applies on the next request and a resurrected session row is still refused', async () => {
  const A = f.ids, po = f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id;
  const nadia = await f.person('Nadia', 'quality_inspector'), s = await sessionFor(f.sql, nadia);
  const fresh = await qc(f, '/selections', { token: s.token, body: selectionBody(po) });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
  const changed = await api(f, '/api/erp/admin/users/update', { token: f.http.Anas.token, body: { id: nadia, role: 'dispatch' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  // The session row survived the role change; the next mutation reads the new role and refuses.
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(nadia).n, 1);
  const denied = await qc(f, '/samples', { token: s.token, body: sampleBody(fresh.data.id, A.spec) });
  assert.equal(denied.status, 403); assert.equal(code(denied), 'FORBIDDEN');
  // Re-inserting a session row for an account that was deactivated out of band must not revive it.
  const uma = f.sql.prepare('SELECT id FROM users WHERE name=?').get('Uma');
  const ghost = await sessionFor(f.sql, uma.id);
  const revived = await qc(f, '/samples', { token: ghost.token, body: sampleBody(fresh.data.id, A.spec) });
  assert.equal(revived.status, 401); assert.equal(code(revived), 'UNAUTHENTICATED');
});

test('F: only the owning workspace can activate, suspend or cite a release, and a proof is single-use', async () => {
  const A = f.ids, b = f.B.users, db = f.env.DB, at = Date.now(), rand = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
  const payloadSha = await sha256Hex(canonicalJson({ release_id: A.release })), token = rand();
  await store.issueProof(db, f.http.Anas.ctx, payloadSha, at, token);
  const activated = await qc(f, `/releases/${A.release}/activate`, { token: f.http.Anas.token, body: { proof: token } });
  assert.equal(activated.status, 200, JSON.stringify(activated.data));
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state, 'ACTIVE');
  // The same proof cannot be replayed onto the same release (already ACTIVE) ...
  const replayProof = await qc(f, `/releases/${A.release}/activate`, { token: f.http.Anas.token, body: { proof: token } });
  assert.equal(replayProof.status, 409);
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state, 'ACTIVE');
  // B cannot suspend or cite it.
  const bSuspend = await qc(f, `/releases/${A.release}/suspend`, { token: b.Bea.token, body: { reason: 'R02 foreign suspension' } });
  const bSuspendMissing = await qc(f, `/releases/${id()}/suspend`, { token: b.Bea.token, body: { reason: 'R02 foreign suspension' } });
  assert.deepEqual([bSuspend.status, code(bSuspend)], [bSuspendMissing.status, code(bSuspendMissing)]);
  assert.equal(bSuspend.status, 404);
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state, 'ACTIVE');
  // B cannot consume A's proof: it is bound to workspace, actor, session and payload.
  const payloadSha2 = await sha256Hex(canonicalJson({ release_id: A.release })), token2 = rand();
  await store.issueProof(db, f.http.Anas.ctx, payloadSha2, at, token2);
  await assert.rejects(store.consumeProof(db, b.Bea.ctx, token2, payloadSha2, 'r02', at), error => error.code === 'FORBIDDEN');
  await store.consumeProof(db, f.http.Anas.ctx, token2, payloadSha2, 'r02', at);
  // A cites its own predecessor and suspends; B's release listing never shows it.
  const bReleases = await qc(f, '/releases', { token: b.Bea.token, method: 'GET', key: null });
  assert.deepEqual(bReleases.data.items, []);
  assert.equal((await qc(f, '/releases', { token: f.http.Anas.token, method: 'GET', key: null })).data.items.length >= 1, true);
  const suspended = await qc(f, `/releases/${A.release}/suspend`, { token: f.http.Anas.token, body: { reason: 'R02 owner suspension' } });
  assert.equal(suspended.status, 200);
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(A.release).state, 'SUSPENDED');
  // A consumed proof cannot be spent on a different release, even one in the same workspace.
  const second = await candidateRelease(f);
  const reused = await qc(f, `/releases/${second.id}/activate`, { token: f.http.Anas.token, body: { proof: token2 } });
  assert.equal(reused.status, 403, JSON.stringify(reused.data));
  assert.equal(f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(second.id).state, 'STATISTICAL_CANDIDATE');
});

test('G: the independent-signatory check is defeated by whitespace and unicode, not by case or padding', async () => {
  const A = f.ids, admin = f.http.Anas.ctx;
  async function attempt(signatory) {
    const body = releaseBody({ independent_signatory: signatory, predecessor_release_id: A.release });
    const { proof, ...payload } = body;
    const payloadSha = await sha256Hex(canonicalJson(payload));
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
    await store.issueProof(f.env.DB, admin, payloadSha, Date.now(), token);
    return qc(f, '/releases', { token: f.http.Anas.token, body: { ...body, proof: token } });
  }
  assert.equal((await attempt('Anas')).status, 422, 'the same name is refused');
  assert.equal((await attempt(' ANAS ')).status, 422, 'case and padding are normalised');
  const spaced = await attempt('A n a s');
  const zeroWidth = await attempt('Anas\u200B');
  const invented = await attempt('Nobody At All');
  console.log('OBSERVED signatory variants:', spaced.status, zeroWidth.status, invented.status);
  assert.equal(spaced.status, 201);
  assert.equal(zeroWidth.status, 201);
  assert.equal(invented.status, 201, 'any name nobody holds is accepted');
  for (const r of [spaced, zeroWidth, invented]) {
    const row = f.sql.prepare('SELECT json FROM qc_releases WHERE id=?').get(r.data.id), saved = JSON.parse(row.json);
    assert.equal(saved.approved_by, admin.user_id);
    assert.equal(saved.independent_signatory.trim().toLowerCase() !== admin.name.trim().toLowerCase(), true);
  }
});

test('H: mutations without a same-origin Request and an idempotency key are refused before parsing', async () => {
  const A = f.ids, consent = f.sql.prepare('SELECT id FROM qc_consent_authorities WHERE workspace_id=?').get(f.workspaceId).id;
  const body = { ...selectionBody(f.sql.prepare('SELECT purchase_order_id FROM qc_samples WHERE id=?').get(A.sample).purchase_order_id) };
  const token = f.http['QC double'].token;
  const noOrigin = await qc(f, '/selections', { token, body, headers: { Origin: '' } });
  assert.equal(noOrigin.status, 403); assert.equal(code(noOrigin), 'FORBIDDEN');
  const foreign = await qc(f, '/selections', { token, body, headers: { Origin: 'https://evil.test' } });
  assert.equal(foreign.status, 403);
  const crossSite = await qc(f, '/selections', { token, body, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const noKey = await qc(f, '/selections', { token, body, key: null });
  assert.equal(noKey.status, 422); assert.equal(code(noKey), 'VALIDATION_FAILED');
  const badKey = await qc(f, '/selections', { token, body, key: 'not-a-uuid' });
  assert.equal(badKey.status, 422);
  const upperKey = await qc(f, '/selections', { token, body, key: id().toUpperCase() });
  assert.equal(upperKey.status, 422);
  // An upload body is not read at all when the key is missing.
  const form = await uploadBody(f, null, consent);
  assert.equal((await qc(f, `/capture-sets/${A.set}/captures`, { token, form, key: null })).status, 422);
  // Reads never need a key; a GET on a mutation route is a method error.
  assert.equal((await qc(f, `/samples/${A.sample}`, { method: 'GET', token, key: null })).status, 200);
  assert.equal((await qc(f, `/samples/${A.sample}/capture-sets`, { method: 'GET', token, key: null })).status, 405);
});
````
