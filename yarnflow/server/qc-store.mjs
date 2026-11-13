/**
 * Incoming-fabric QC v2 storage API for C04. Times are UTC epoch milliseconds; db is the
 * existing D1-compatible {prepare,batch} adapter. All Promise-returning functions are async.
 * AuthContext = {user_id,workspace_id,name,role,admin,session_hash,session_expires_at,auth_epoch};
 * auth_epoch is the current users.pin_hash. Workspace is always derived from this context.
 * Idem = {route:string,key:UUID,bodySha:sha256,requestId?:UUID}; bodySha MUST be the hash of
 * canonicalJson of the validated request body. Mutation input may carry idem and intervention
 * (the separately audited admin intervention reason). No browser-supplied workspace is accepted.
 * Mutation<T> = {status:number,body:T,replayed?:boolean}. Low-level legacy mutation helpers
 * return Mutation<T>; createSampleEvaluation returns QCResult directly (also on replay).
 * All storage errors are QCProblem {code,reasons,message}; codes use ErrorEnvelope/ErrorCode.
 * Common failures: NOT_FOUND (including foreign tenant), VALIDATION_FAILED, FORBIDDEN,
 * CONFLICT (lost revision/current spec/lease/session/release), SERVICE_UNAVAILABLE (failed
 * atomic storage/audit). SQL assertion statements abort the ENTIRE D1 batch.
 *
 * Specifications and selection:
 * confirmSpec(db,ctx,input,now)->Mutation<PurchaseSpec>; input={purchase_order_id,
 * expected_spec_version:number|null,construction,allowed_fabric_labels,taxonomy_version,
 * density:[{axis,unit,target,lower,upper,candidate?:POCandidate|null}],confirmation_reason,
 * intervention?,idem?}; also CONFLICT/PO_VERSION_STALE or VALIDATION_FAILED/PO_CONFLICT.
 * getSpec(db,workspaceId,id,version?)->{spec:PurchaseSpec,current:boolean,versions:number[]}; NOT_FOUND.
 * listPurchaseOrders(db,workspaceId)->Array<{purchase_order_id,reference,supplier_name,status,
 * current_spec:{id,version,confirmed_at,construction}|null}>.
 * currentSpecRow(db,workspaceId,purchaseOrderId)->SQL spec row|null.
 * createSelection(db,ctx,input,now)->Mutation<SamplingSelection>; input is SamplingSelection
 * minus id/workspace_id/created_by/created_at, plus intervention?/idem?.
 * registerConsent(db,ctx,input,now)->Mutation<ConsentAuthority>; input={authority_evidence_sha256,
 * operational_capture,operational_retention_days,research_use,training_use,export_destinations?,
 * valid_from,expires_at,idem?}. listConsent(db,workspaceId,now)->ConsentAuthority[].
 * withdrawConsent(db,ctx,{id,reason,idem?},now)->Mutation<ConsentAuthority>.
 * consentFor(db,workspaceId,consentId,now)->SQL consent row; FORBIDDEN before staging any bytes.
 *
 * Samples and capture:
 * createSampleEvaluation(db,authContext,input,now)->QCResult; input={selection_id,spec_id,
 * spec_version,predecessor_sample_id:null|UUID,expected_predecessor_revision:null|number,
 * reason:null|string,disposition?:SELECTED|MISSING|EXCLUDED,exclusion_reason?,intervention?,idem?}.
 * Initial and linked evaluations freeze their own spec, share the selection's attempt budget.
 * loadResult(db,workspaceId,sampleId,now=Date.now())->QCResult; NOT_FOUND.
 * listSamples(db,workspaceId,purchaseOrderId=null)->Array<{sample_id,roll_ref,location_ref,
 * spec_version,revision,status:DecisionStatus|null,disposition,created_at}>.
 * createCaptureSet(db,ctx,{sample_id,expected_revision,idem?},now)->Mutation<QCResult>.
 * stageCapture(db,bucket,ctx,input,now)->Mutation<QCResult> (alias addCapture); input={capture_set_id,
 * meta:{capture_id,role,expected_revision,sha256,taken_at,device_profile_id,calibration_id,
 * consent_record_id,attestation:AcquisitionAttestation},bytes:Uint8Array,width,height,mediaType,
 * idem?,beforeReference?:async test barrier}. Consent precedes put. PENDING -> REFERENCED is
 * fenced against GC in the capture/revision/event batch. PAYLOAD_TOO_LARGE for original/set limits.
 * closeCaptureSet(db,ctx,{capture_set_id,expected_revision,idem?},now)->Mutation<QCResult>;
 * allocates one family attempt (max 3); CONFLICT/RECAPTURE_LIMIT, VALIDATION_FAILED for missing roles.
 * objectKey(workspaceId,captureId,sha)->string. bodyBytes(body)->Uint8Array (stream or bytes).
 * collectQCBlobs(db,bucket,now,graceMs=DAY)->{claimed,deleted,failed}; unreferenced claims only.
 *
 * Durable requests:
 * beginRequest(db,ctx,idem,now)->{started:{request_id,generation,deadline_at}} |
 * {pending:{request_id}} | {replay:Mutation<QCResult>}; CONFLICT for changed body,
 * DEADLINE_EXCEEDED for elapsed deadline. Expired leases increment the fencing generation.
 * completeRequest(db,ctx,started,status,body,now)->Mutation<typeof body>; guarded durable response,
 * CONFLICT for stale generation/actor/lease; DEADLINE_EXCEEDED after deadline.
 * failRequest(db,ctx,started,error:{code,reasons?},now)->void; only the live actor and current lease may change state.
 * getRequest(db,ctx,requestId,now)->{schema_version:'2',request_id,
 * state:IN_PROGRESS|COMPLETED|EXPIRED|FAILED,result:QCResult|null,error:ErrorBody|null};
 * requestState is its compatibility alias. NOT_FOUND for a different actor/workspace.
 * replayOf(db,ctx,idem)->Mutation<unknown>|null; CONFLICT for changed body or unfinished key.
 *
 * Analysis (no JS policy evaluation):
 * buildAnalyzeInputs(db,authContext,sampleId,captureSetId,expectedRevision,now)->PreparedInputs;
 * PreparedInputs={sample:SQLRow,set:SQLRow,spec:PurchaseSpec,policy:Policy,release:Release|null,
 * domain:DomainManifest|null,captures:ValidatedCapture[],captureRows:SQLRow[]}.
 * C04 supplies verified image bytes plus request context {evaluated_at,clock_source:'WORKER_UTC',
 * deadline_at,calibration_records_sha256,capture_binding_sha256,request_id,request_generation}.
 * prepareAnalysis(db,bucket,ctx,{sample_id,capture_set_id,expected_revision},started,now)->
 * Prepared={request:AnalyzeRequest,files:[{id,bytes:Uint8Array,type}],sample,set,spec,policy,release,domain};
 * performs readback/hash validation; CONFLICT for stale spec/incomplete or already analysed set.
 * checkCandidate(candidate:AnalysisCandidate,prepared:Prepared)->AnalysisCandidate;
 * SERVICE_UNAVAILABLE if schema/hash/binding or Worker-selected automation authority fails.
 * finalizeQC(db,authContext,{prepared,candidate,started},expectedRevision,now)->Decision;
 * one aborting batch rechecks revision, latest spec, release id/state/hash/expiry, active session,
 * active user/same role/credential epoch, request actor/generation/lease/deadline and captures.
 * Losing any precondition writes NOTHING (including evidence/events/pointer/idempotent success).
 * DEADLINE_EXCEEDED or CONFLICT; invalid scanner candidate SERVICE_UNAVAILABLE.
 * appendAdjudication(db,ctx,{sample_id,expected_revision,outcome,reason,reference_ids,
 * supersedes_id,intervention?,idem?},now)->Mutation<QCResult>; model evidence/decision immutable.
 *
 * Releases and fresh credentials:
 * registerCandidate(db,ctx,input,now)->Mutation<Release> (alias registerRelease); input={domain,
 * policy,version,bundle_sha256,calibration_sha256,statistics_report_sha256,operations_proof_sha256?,
 * monitoring_protocol_sha256?,authority_record_sha256,independent_signatory,expires_at,
 * predecessor_release_id?,proof,payloadSha,idem?}; registers STATISTICAL_CANDIDATE only.
 * activate(db,ctx,{id,gates:{G1..G8:sha256},proof,payloadSha,idem?},now)->Mutation<Release>
 * (alias activateRelease); FORBIDDEN/POLICY_UNRELEASED until every external gate is evidenced.
 * suspend(db,ctx,{id,reason,idem?},now)->Mutation<Release> (alias suspendRelease); immediate containment.
 * activeRelease(db,workspaceId,now)->{release,domain,policy}|null. releaseOf(SQLRow)->Release.
 * issueProof(db,ctx,payloadSha,now,token)->{proof,expires_at}; token is 64 hex random characters,
 * issued only AFTER C04 verifies the fresh PIN. Five minute lifetime bound to session/actor/body.
 * consumeProof(db,ctx,proof,payloadSha,key,now)->void; FORBIDDEN for expired/reused/wrong binding;
 * release mutations consume within THEIR batch, never call consumeProof before a release write.
 * reviewOnlyPolicy()->Policy. missingGates(gates)->string[].
 * authGuard(db,ctx,now)->PreparedStatement; event(db,ctx,name,recordId,options,now)->PreparedStatement;
 * options={sampleId?,detail?,reason?,intervention?,requestId?}. batchProblem(error)->QCProblem.
 * qcFail(code,reasons=[],detail='')->never (throws QCProblem). Constants: DAY,REQUEST_DEADLINE_MS,
 * LEASE_MS,PROOF_MS,MAX_ATTEMPTS,DEFAULT_REQUIRED_ROLES,GATES. No stock/receipts/claims/v1 writes.
 */
import { all, one, query } from './erp-utils.mjs';
import { ERROR_STATUS, HASH_EXCLUDES, LIMITS, canonicalJson, contentSha256, isoTime, sha256Hex, violation, withDefaults } from './qc-contract.mjs';

export class QCProblem extends Error {
  constructor(code, reasons = [], detail = '') { super(detail || code); this.code = code; this.reasons = reasons; this.status = ERROR_STATUS[code]?.status ?? 500; }
}
export const qcFail = (code, reasons = [], detail = '') => { throw new QCProblem(code, reasons, detail); };
export const DAY = 86400000, REQUEST_DEADLINE_MS = LIMITS.request_deadline_s * 1000, LEASE_MS = 45000, PROOF_MS = 5 * 60000;
export const MAX_ATTEMPTS = LIMITS.max_capture_sets;
/** Engineering default until a released domain manifest names its own roles (no validated domain exists yet). */
export const DEFAULT_REQUIRED_ROLES = ['overview', 'structure', 'scale'];
const STAGES = ['quality', 'fabric', 'defects', 'metrology', 'domain'];
const uuid = () => crypto.randomUUID();
/** Fails the whole batch unless the row exists: SQLite and D1 both abort on the malformed JSON. */
const guard = (db, sql, ...args) => query(db, `SELECT json('!') WHERE NOT EXISTS(${sql})`, ...args);
const valid = (type, value, code = 'VALIDATION_FAILED') => { const failed = violation(type, value); if (failed) qcFail(code, [], `${failed.path} ${failed.message}`); return value; };

/** The default policy: review only. Its hash is fixed by its content. */
let reviewOnly;
export async function reviewOnlyPolicy() {
  if (!reviewOnly) { const policy = { schema_version: '2', version: 'review-only-1', mode: 'REVIEW_ONLY', required_stages: STAGES, max_capture_sets: 3 }; reviewOnly = { ...policy, sha256: await contentSha256(policy) }; }
  return reviewOnly;
}

/** The initiating session must still be the same live session of the same active person in the same role, at commit time. */
export const authGuard = (db, ctx, now) => guard(db, `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.id=? AND u.workspace_id=? AND u.status='active' AND u.deactivated_at IS NULL AND u.portal_role=? AND u.pin_hash=?`,
  ctx.session_hash, now, ctx.user_id, ctx.workspace_id, ctx.role, ctx.auth_epoch);
export const event = (db, ctx, name, recordId, { sampleId = null, detail = {}, reason = null, intervention = null, requestId = null } = {}, now) =>
  query(db, 'INSERT INTO qc_decision_events(id,workspace_id,sample_id,record_id,event,actor_id,actor_role,request_id,detail_json,reason,intervention_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    uuid(), ctx.workspace_id, sampleId, recordId, name, ctx.user_id, ctx.role, requestId, JSON.stringify(detail), reason, intervention, now);


const authorize = (ctx, role, input = {}) => {
  if (ctx.role === role) return;
  const reason = input.intervention ?? input.interventionReason;
  if (ctx.role !== 'admin' || (role !== 'admin' && (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 2000))) qcFail('FORBIDDEN', [], 'This action requires the assigned role or an audited admin intervention reason.');
};

// ---------------------------------------------------------------------------- idempotency
const idemRow = (db, ctx, idem) => one(db, 'SELECT * FROM qc_idempotency WHERE workspace_id=? AND actor_id=? AND route=? AND client_key=?', ctx.workspace_id, ctx.user_id, idem.route, idem.key);
async function stored(db, ctx, row) {
  return { status: row.response_status, body: JSON.parse(row.response_json), replayed: true };
}
/** The stored response for this key, null when the key is new. A different body under the same key is a conflict. */
export async function replayOf(db, ctx, idem) {
  if (!idem) return null;
  const row = await idemRow(db, ctx, idem);
  if (!row) return null;
  if (row.body_sha256 !== idem.bodySha) qcFail('CONFLICT', [], 'This Idempotency-Key was used for a different request.');
  if (row.state === 'COMPLETED') return stored(db, ctx, row);
  qcFail('CONFLICT', [], 'This Idempotency-Key belongs to a request that did not complete.');
}
const completed = (db, ctx, idem, status, body, now, pointer = null) => {
  const projection = pointer ? durableResult(ctx.workspace_id, pointer, now) : null;
  return query(db, `INSERT INTO qc_idempotency(workspace_id,actor_id,route,client_key,request_id,body_sha256,state,deadline_at,lease_expires_at,generation,response_status,response_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'COMPLETED',?,?,1,?,${projection ? '(' + projection.sql + ')' : '?'},?,?)`,
    ctx.workspace_id, ctx.user_id, idem.route, idem.key, idem.requestId ?? uuid(), idem.bodySha, now, now, status, ...(projection ? projection.args : [JSON.stringify(body)]), now, now);
};
/** Storage refused the batch: a lost precondition is a conflict; anything else means nothing was recorded. */
export function batchProblem(error) {
  if (error instanceof QCProblem) return error;
  const message = String(error?.message ?? error);
  if (/malformed JSON|qc: |constraint failed|UNIQUE|FOREIGN KEY/i.test(message)) return new QCProblem('CONFLICT', /capture attempt|three/.test(message) ? ['RECAPTURE_LIMIT'] : ['EVIDENCE_STALE'], 'The record changed before this request was saved. Nothing was written.');
  return new QCProblem('SERVICE_UNAVAILABLE', ['AUDIT_UNAVAILABLE'], 'Storage or audit was unavailable. Nothing was written.');
}
/** One guarded atomic write: session check, the caller's statements and the durable response, or nothing at all. */
async function commit(db, ctx, idem, now, statements, status, body, pointer = null) {
  const batch = [authGuard(db, ctx, now), ...statements];
  if (idem) batch.push(completed(db, ctx, idem, status, body, now, pointer));
  try { await db.batch(batch); } catch (error) {
    const again = idem && await replayOf(db, ctx, idem).catch(() => null);
    if (again) return again;
    throw batchProblem(error);
  }
  return { status, body: pointer ? await loadResult(db, ctx.workspace_id, pointer, now) : body };
}

/** Long requests (analysis): a durable IN_PROGRESS row with a deadline, a lease and a fencing generation. */
export async function beginRequest(db, ctx, idem, now) {
  if (!idem || !/^[a-f\d]{64}$/.test(idem.bodySha) || typeof idem.route !== 'string' || !/^[a-f\d-]{36}$/.test(idem.key)) qcFail('VALIDATION_FAILED');
  let row = await idemRow(db, ctx, idem);
  if (!row) {
    const requestId = uuid(), deadline = now + REQUEST_DEADLINE_MS;
    try {
      await db.batch([authGuard(db, ctx, now), query(db, "INSERT INTO qc_idempotency(workspace_id,actor_id,route,client_key,request_id,body_sha256,state,deadline_at,lease_expires_at,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,'IN_PROGRESS',?,?,1,?,?)",
        ctx.workspace_id, ctx.user_id, idem.route, idem.key, requestId, idem.bodySha, deadline, now + LEASE_MS, now, now)]);
      return { started: { request_id: requestId, generation: 1, deadline_at: deadline } };
    } catch { row = await idemRow(db, ctx, idem); if (!row) qcFail('SERVICE_UNAVAILABLE', ['AUDIT_UNAVAILABLE']); }
  }
  if (row.body_sha256 !== idem.bodySha) qcFail('CONFLICT', [], 'This Idempotency-Key was used for a different request.');
  if (row.state === 'COMPLETED') return { replay: await stored(db, ctx, row) };
  if (row.state === 'EXPIRED' || now >= row.deadline_at) {
    qcFail('DEADLINE_EXCEEDED', [], 'This request passed its deadline without a decision. Start a new request.');
  }
  if (row.state === 'IN_PROGRESS' && row.lease_expires_at > now) return { pending: { request_id: row.request_id } };
  // A failed attempt or an expired lease: the next generation takes over, and the old one can no longer finalise.
  let claimed;
  try { [, claimed] = await db.batch([authGuard(db, ctx, now), query(db, "UPDATE qc_idempotency SET state='IN_PROGRESS',generation=generation+1,lease_expires_at=?,response_status=NULL,response_json=NULL,updated_at=? WHERE request_id=? AND workspace_id=? AND actor_id=? AND generation=? AND state IN ('IN_PROGRESS','FAILED') AND deadline_at>?",
    now + LEASE_MS, now, row.request_id, ctx.workspace_id, ctx.user_id, row.generation, now)]); }
  catch (error) { throw batchProblem(error); }
  if (claimed.meta.changes !== 1) return { pending: { request_id: row.request_id } };
  return { started: { request_id: row.request_id, generation: row.generation + 1, deadline_at: row.deadline_at } };
}
/** Records why this generation stopped. The same key may retry before the deadline; after it the request is EXPIRED. */
export async function failRequest(db, ctx, started, error, now) {
  const expired = error.code === 'DEADLINE_EXCEEDED' || now >= started.deadline_at;
  const leaseGuard = expired ? 'deadline_at<=?' : 'lease_expires_at>? AND deadline_at>?';
  const guardTime = expired ? [now] : [now, now];
  try { await db.batch([authGuard(db, ctx, now), query(db, `UPDATE qc_idempotency SET state=?,response_status=NULL,response_json=?,updated_at=? WHERE request_id=? AND workspace_id=? AND actor_id=? AND generation=? AND state='IN_PROGRESS' AND ${leaseGuard}`,
    expired ? 'EXPIRED' : 'FAILED', JSON.stringify({ code: error.code, reasons: error.reasons ?? [] }), now, started.request_id, ctx.workspace_id, ctx.user_id, started.generation, ...guardTime)]); }
  catch (failure) { throw batchProblem(failure); }
}
export async function requestState(db, ctx, requestId, now) {
  const row = await one(db, 'SELECT * FROM qc_idempotency WHERE request_id=? AND workspace_id=? AND actor_id=?', requestId, ctx.workspace_id, ctx.user_id);
  if (!row) qcFail('NOT_FOUND');
  const state = row.state !== 'COMPLETED' && row.state !== 'EXPIRED' && now >= row.deadline_at ? 'EXPIRED' : row.state;
  const parsed = row.response_json ? JSON.parse(row.response_json) : null;
  const result = state === 'COMPLETED' ? (await stored(db, ctx, row)).body : null;
  const failure = state === 'EXPIRED' ? { code: 'DEADLINE_EXCEEDED', reasons: [] } : state === 'FAILED' ? parsed : null;
  return { schema_version: '2', request_id: requestId, state, result, error: failure ? { code: failure.code, reasons: failure.reasons ?? [], retryable: state === 'FAILED', request_id: requestId } : null };
}

// ---------------------------------------------------------------------------- reads
export async function activeRelease(db, workspaceId, now) {
  const row = await one(db, "SELECT * FROM qc_releases WHERE workspace_id=? AND state='ACTIVE' AND expires_at>?", workspaceId, now);
  return row ? { release: { ...JSON.parse(row.json), state: 'ACTIVE' }, domain: JSON.parse(row.domain_json), policy: JSON.parse(row.policy_json) } : null;
}
export const releaseOf = row => ({ ...JSON.parse(row.json), state: row.state });
export const currentSpecRow = (db, workspaceId, purchaseOrderId) => one(db, 'SELECT * FROM qc_po_specs WHERE workspace_id=? AND purchase_order_id=? ORDER BY version DESC LIMIT 1', workspaceId, purchaseOrderId);
const consentOf = row => ({ ...JSON.parse(row.json), withdrawn_at: row.withdrawn_at === null ? null : isoTime(row.withdrawn_at) });
export const listConsent = async (db, workspaceId, now) => (await all(db, 'SELECT * FROM qc_consent_authorities WHERE workspace_id=? ORDER BY (withdrawn_at IS NULL AND valid_from<=? AND expires_at>?) DESC,created_at DESC LIMIT 100', workspaceId, now, now)).map(consentOf);
const familyAttempts = async (db, workspaceId, selectionId) => (await one(db, "SELECT COUNT(*) AS n FROM qc_capture_sets c JOIN qc_samples s ON s.workspace_id=c.workspace_id AND s.id=c.sample_id WHERE c.workspace_id=? AND s.selection_id=? AND c.state='CLOSED'", workspaceId, selectionId)).n;
const sampleRow = async (db, workspaceId, sampleId) => await one(db, 'SELECT * FROM qc_samples WHERE workspace_id=? AND id=?', workspaceId, sampleId) ?? qcFail('NOT_FOUND');

/** The one envelope every create / upload / close / analyze / reload returns. */
export async function loadResult(db, workspaceId, sampleId, now = Date.now()) {
  const row = await sampleRow(db, workspaceId, sampleId);
  const [selectionRow, sets, captures, decisions, adjudications, successors, recalls, latest, release, attempts] = await Promise.all([
    one(db, 'SELECT json FROM qc_selections WHERE workspace_id=? AND id=?', workspaceId, row.selection_id),
    all(db, 'SELECT * FROM qc_capture_sets WHERE workspace_id=? AND sample_id=? ORDER BY created_at,id', workspaceId, sampleId),
    all(db, 'SELECT capture_set_id,json,original_state FROM qc_captures WHERE workspace_id=? AND sample_id=? ORDER BY created_at,id', workspaceId, sampleId),
    all(db, 'SELECT id,evidence_id,json FROM qc_decisions WHERE workspace_id=? AND sample_id=? ORDER BY revision', workspaceId, sampleId),
    all(db, 'SELECT json FROM qc_adjudications WHERE workspace_id=? AND sample_id=? ORDER BY revision', workspaceId, sampleId),
    all(db, 'SELECT id FROM qc_samples WHERE workspace_id=? AND predecessor_sample_id=? ORDER BY created_at', workspaceId, sampleId),
    all(db, 'SELECT DISTINCT decision_id FROM qc_recalls WHERE workspace_id=? AND sample_id=? LIMIT 50', workspaceId, sampleId),
    one(db, 'SELECT MAX(version) AS v FROM qc_po_specs WHERE workspace_id=? AND id=?', workspaceId, row.spec_id),
    activeRelease(db, workspaceId, now), familyAttempts(db, workspaceId, row.selection_id),
  ]);
  const selection = JSON.parse(selectionRow.json), current = decisions.find(d => d.id === row.current_decision_id) ?? null;
  const evidence = current ? JSON.parse((await one(db, 'SELECT json FROM qc_evidence WHERE workspace_id=? AND id=?', workspaceId, current.evidence_id)).json) : null;
  const human = adjudications.map(a => JSON.parse(a.json));
  return {
    schema_version: '2', mode: release ? 'AUTOMATIC' : 'REVIEW_ONLY',
    sample: { schema_version: '2', id: row.id, workspace_id: workspaceId, purchase_order_id: row.purchase_order_id, spec_id: row.spec_id, spec_version: row.spec_version, lot_ref: selection.lot_ref, roll_ref: selection.roll_ref, location_ref: selection.location_ref,
      sample_plan_version: selection.plan_version, capture_attempt: row.capture_attempt, revision: row.revision, predecessor_sample_id: row.predecessor_sample_id, selection_id: row.selection_id, face: selection.face, planned_area_cm2: selection.planned_area_cm2,
      usable_area_cm2: row.usable_area_cm2, sampling_method: selection.method, independent_group_id: selection.independent_group_id, disposition: row.disposition, exclusion_reason: row.exclusion_reason, created_by: row.created_by, created_at: isoTime(row.created_at) },
    captures: captures.map(c => ({ ...JSON.parse(c.json), original_state: c.original_state })),
    capture_sets: sets.map(s => ({ id: s.id, sample_id: sampleId, state: s.state, required_roles: JSON.parse(s.required_roles), capture_ids: captures.filter(c => c.capture_set_id === s.id).map(c => JSON.parse(c.json).id), revision: s.revision, attempt: s.attempt })),
    evidence, decision: current ? JSON.parse(current.json) : null, history: decisions.map(d => JSON.parse(d.json)), adjudications: human, current_human_disposition: human.at(-1) ?? null,
    recalled_decision_ids: recalls.map(r => r.decision_id),
    family: { selection_id: row.selection_id, predecessor_sample_id: row.predecessor_sample_id, successor_sample_ids: successors.map(s => s.id), attempts_used: attempts, attempts_max: 3, spec_is_current: latest.v === row.spec_version, current_spec_version: latest.v },
    revision: row.revision,
  };
}

// ---------------------------------------------------------------------------- PO specification
/** Confirms the next immutable spec version for a purchase order. Actor, workspace, time and hash are server-derived. */
export async function confirmSpec(db, ctx, input, now) {
  authorize(ctx, 'purchase_manager', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, order = await one(db, 'SELECT id FROM supplier_purchase_orders WHERE workspace_id=? AND id=?', w, input.purchase_order_id);
  if (!order) qcFail('NOT_FOUND');
  const latest = await currentSpecRow(db, w, order.id), version = (latest?.version ?? 0) + 1;
  if ((input.expected_spec_version ?? 0) !== version - 1) qcFail('CONFLICT', ['PO_VERSION_STALE'], 'The specification changed. Reload it before confirming a new version.');
  const at = isoTime(now), candidates = [];
  const density = input.density.map(d => {
    const c = d.candidate ?? null;
    if (c) candidates.push({ axis: d.axis, ...c });
    return { axis: d.axis, unit: d.unit, target: d.target, lower: d.lower, upper: d.upper, provenance: withDefaults('Provenance', { source: 'PO_CONFIRMED', source_id: order.id, source_version: String(version), actor_id: ctx.user_id, observed_at: at, image_sha256: null,
      ...(c ? { document_sha256: c.document_sha256 ?? null, page: c.page ?? null, span: c.span ?? null, raw_value: c.raw_value ?? null, raw_unit: c.raw_unit ?? null, ocr_confidence: c.ocr_confidence ?? null, candidate_id: c.candidate_id ?? null, corrects_id: c.corrects_id ?? null } : {}) }) };
  });
  const body = { schema_version: '2', id: latest?.id ?? uuid(), version, workspace_id: w, purchase_order_id: order.id, construction: input.construction, allowed_fabric_labels: input.allowed_fabric_labels, taxonomy_version: input.taxonomy_version,
    density, confirmed_by: ctx.user_id, confirmed_at: at, supersedes_version: version === 1 ? null : version - 1 };
  const spec = { ...body, content_sha256: await contentSha256(body) };
  const failed = violation('PurchaseSpec', spec);
  if (failed) qcFail('VALIDATION_FAILED', [/unit/.test(failed.path) ? 'UNIT_UNSUPPORTED' : 'PO_CONFLICT'], `${failed.path} ${failed.message}`);
  return commit(db, ctx, input.idem, now, [
    query(db, 'INSERT INTO qc_po_specs(workspace_id,id,version,purchase_order_id,content_sha256,json,candidates_json,confirmed_by,reason,intervention_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      w, spec.id, version, order.id, spec.content_sha256, JSON.stringify(spec), JSON.stringify(candidates), ctx.user_id, input.confirmation_reason, input.intervention ?? null, now),
    event(db, ctx, 'spec.confirmed', spec.id, { detail: { version, content_sha256: spec.content_sha256, purchase_order_id: order.id }, reason: input.confirmation_reason, intervention: input.intervention ?? null }, now),
  ], 201, spec);
}

export async function registerConsent(db, ctx, input, now) {
  authorize(ctx, 'admin', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const record = valid('ConsentAuthority', { id: uuid(), version: 1, workspace_id: ctx.workspace_id, authority_evidence_sha256: input.authority_evidence_sha256, operational_capture: input.operational_capture, operational_retention_days: input.operational_retention_days,
    research_use: input.research_use, training_use: input.training_use, export_destinations: input.export_destinations ?? [], valid_from: input.valid_from, expires_at: input.expires_at, withdrawn_at: null });
  const from = Date.parse(record.valid_from), until = Date.parse(record.expires_at);
  if (!(until > from)) qcFail('VALIDATION_FAILED', [], 'expires_at must be after valid_from');
  return commit(db, ctx, input.idem, now, [
    query(db, 'INSERT INTO qc_consent_authorities(workspace_id,id,json,operational_capture,retention_days,valid_from,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', ctx.workspace_id, record.id, JSON.stringify(record), record.operational_capture ? 1 : 0, record.operational_retention_days, from, until, ctx.user_id, now),
    event(db, ctx, 'consent.registered', record.id, { detail: { authority_evidence_sha256: record.authority_evidence_sha256 } }, now),
  ], 201, record);
}
/** Withdrawal ends new capture under this record and is written to the monotonic ledger; it grants nothing. */
export async function withdrawConsent(db, ctx, input, now) {
  authorize(ctx, 'admin', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const row = await one(db, 'SELECT * FROM qc_consent_authorities WHERE workspace_id=? AND id=?', ctx.workspace_id, input.id);
  if (!row) qcFail('NOT_FOUND');
  if (row.withdrawn_at !== null) qcFail('CONFLICT', [], 'This consent record is already withdrawn.');
  return commit(db, ctx, input.idem, now, [
    query(db, 'UPDATE qc_consent_authorities SET withdrawn_at=? WHERE workspace_id=? AND id=?', now, ctx.workspace_id, input.id),
    query(db, "INSERT INTO qc_retention_events(id,workspace_id,kind,consent_id,actor_id,reason,created_at) VALUES(?,?,'WITHDRAWAL',?,?,?,?)", uuid(), ctx.workspace_id, input.id, ctx.user_id, input.reason, now),
    event(db, ctx, 'consent.withdrawn', input.id, { reason: input.reason }, now),
  ], 200, { ...consentOf(row), withdrawn_at: isoTime(now) });
}

export async function createSelection(db, ctx, input, now) {
  authorize(ctx, 'quality_inspector', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id;
  if (!await one(db, 'SELECT id FROM supplier_purchase_orders WHERE workspace_id=? AND id=?', w, input.purchase_order_id)) qcFail('NOT_FOUND');
  const { idem, intervention, ...fields } = input;
  const selection = valid('SamplingSelection', { id: uuid(), workspace_id: w, ...fields, created_by: ctx.user_id, created_at: isoTime(now) });
  return commit(db, ctx, idem, now, [
    query(db, 'INSERT INTO qc_selections(workspace_id,id,purchase_order_id,cohort,json,created_by,created_at) VALUES(?,?,?,?,?,?,?)', w, selection.id, selection.purchase_order_id, selection.cohort, JSON.stringify(selection), ctx.user_id, now),
    event(db, ctx, 'selection.created', selection.id, { detail: { cohort: selection.cohort, roll_ref: selection.roll_ref, location_ref: selection.location_ref }, intervention: intervention ?? null }, now),
  ], 201, selection);
}

// ---------------------------------------------------------------------------- samples
/**
 * The one sample-create helper, for an initial evaluation and for a linked evaluation under a newly confirmed spec (design §20).
 * A sample's spec binding never changes; the linked sample shares the physical selection and its three-attempt budget.
 */
export async function createSampleEvaluation(db, authContext, input, now) {
  const ctx = authContext, w = ctx.workspace_id;
  authorize(ctx, 'quality_inspector', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay.body;
  const selectionRow = await one(db, 'SELECT * FROM qc_selections WHERE workspace_id=? AND id=?', w, input.selection_id);
  if (!selectionRow) qcFail('NOT_FOUND');
  const latest = await currentSpecRow(db, w, selectionRow.purchase_order_id);
  if (!latest) qcFail('CONFLICT', ['SPEC_MISSING'], 'Confirm the purchase order specification first.');
  if (latest.id !== input.spec_id) qcFail('NOT_FOUND');
  if (latest.version !== input.spec_version) qcFail('CONFLICT', ['PO_VERSION_STALE'], 'A newer specification version is confirmed. Reload it.');
  const disposition = input.disposition ?? 'SELECTED', id = uuid(), guards = [];
  const predecessorId = input.predecessor_sample_id ?? null;
  if (predecessorId) {
    const previous = await one(db, 'SELECT * FROM qc_samples WHERE workspace_id=? AND id=?', w, predecessorId);
    if (!previous || previous.selection_id !== input.selection_id) qcFail('NOT_FOUND');
    if (previous.spec_version >= latest.version) qcFail('CONFLICT', [], 'That evaluation already uses the current specification.');
    if (previous.revision !== input.expected_predecessor_revision) qcFail('CONFLICT', ['EVIDENCE_STALE'], 'The earlier evaluation changed. Reload it.');
    if (!input.reason) qcFail('VALIDATION_FAILED', [], 'A linked evaluation needs a reason.');
    guards.push(guard(db, 'SELECT 1 FROM qc_samples WHERE workspace_id=? AND id=? AND revision=?', w, predecessorId, previous.revision));
  } else {
    if (input.expected_predecessor_revision != null) qcFail('VALIDATION_FAILED', [], 'expected_predecessor_revision needs a predecessor.');
    if (await one(db, 'SELECT 1 AS x FROM qc_samples WHERE workspace_id=? AND selection_id=?', w, input.selection_id)) qcFail('CONFLICT', [], 'This selection already has an evaluation. Link a new one to it, or draw a new selection.');
  }
  // The version confirmed when this request was read must still be the current one when it commits.
  guards.push(guard(db, 'SELECT 1 FROM qc_po_specs p WHERE p.workspace_id=? AND p.id=? AND p.version=? AND p.version=(SELECT MAX(version) FROM qc_po_specs WHERE workspace_id=p.workspace_id AND id=p.id)', w, latest.id, latest.version));
  return (await commit(db, ctx, input.idem, now, [...guards,
    query(db, 'INSERT INTO qc_samples(workspace_id,id,selection_id,purchase_order_id,spec_id,spec_version,predecessor_sample_id,disposition,exclusion_reason,reason,intervention_reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      w, id, input.selection_id, selectionRow.purchase_order_id, latest.id, latest.version, predecessorId, disposition, input.exclusion_reason ?? null, input.reason ?? null, input.intervention ?? null, ctx.user_id, now),
    event(db, ctx, predecessorId ? 'sample.linked' : 'sample.created', id, { sampleId: id, detail: { selection_id: input.selection_id, spec_version: latest.version, predecessor_sample_id: predecessorId, disposition }, reason: input.reason ?? input.exclusion_reason ?? null, intervention: input.intervention ?? null }, now),
  ], 201, null, id)).body;
}
export async function listSamples(db, workspaceId, purchaseOrderId = null) {
  const rows = await all(db, `SELECT s.id,s.spec_version,s.revision,s.disposition,s.created_at,x.json AS selection,d.status FROM qc_samples s JOIN qc_selections x ON x.workspace_id=s.workspace_id AND x.id=s.selection_id
    LEFT JOIN qc_decisions d ON d.workspace_id=s.workspace_id AND d.id=s.current_decision_id WHERE s.workspace_id=? AND (? IS NULL OR s.purchase_order_id=?) ORDER BY s.created_at DESC,s.id LIMIT 200`, workspaceId, purchaseOrderId, purchaseOrderId);
  return rows.map(r => { const selection = JSON.parse(r.selection); return { sample_id: r.id, roll_ref: selection.roll_ref, location_ref: selection.location_ref, spec_version: r.spec_version, revision: r.revision, status: r.status ?? null, disposition: r.disposition, created_at: isoTime(r.created_at) }; });
}
export async function listPurchaseOrders(db, workspaceId) {
  const rows = await all(db, `SELECT p.id,p.reference,p.status,s.name AS supplier_name,q.id AS spec_id,q.version,q.json FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id AND s.workspace_id=p.workspace_id
    LEFT JOIN qc_po_specs q ON q.workspace_id=p.workspace_id AND q.purchase_order_id=p.id AND q.version=(SELECT MAX(version) FROM qc_po_specs WHERE workspace_id=p.workspace_id AND purchase_order_id=p.id)
    WHERE p.workspace_id=? ORDER BY p.created_at DESC,p.id LIMIT 200`, workspaceId);
  return rows.map(r => { const spec = r.json ? JSON.parse(r.json) : null; return { purchase_order_id: r.id, reference: r.reference, supplier_name: r.supplier_name, status: r.status, current_spec: spec ? { id: spec.id, version: spec.version, confirmed_at: spec.confirmed_at, construction: spec.construction } : null }; });
}

// ---------------------------------------------------------------------------- capture sets
const revisionGuard = (db, w, sampleId, revision) => guard(db, 'SELECT 1 FROM qc_samples WHERE workspace_id=? AND id=? AND revision=?', w, sampleId, revision);
const bump = (db, w, sampleId, extra = '', ...args) => query(db, `UPDATE qc_samples SET revision=revision+1${extra} WHERE workspace_id=? AND id=?`, ...args, w, sampleId);
function expectRevision(sample, expected) { if (sample.revision !== expected) qcFail('CONFLICT', ['EVIDENCE_STALE'], 'This sample changed. Reload it before continuing.'); }

export async function createCaptureSet(db, ctx, input, now) {
  authorize(ctx, 'quality_inspector', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, sample = await sampleRow(db, w, input.sample_id);
  expectRevision(sample, input.expected_revision);
  if (['MISSING', 'EXCLUDED'].includes(sample.disposition)) qcFail('CONFLICT', [], 'A missing or excluded selection has no captures.');
  if ((await one(db, 'SELECT MAX(version) AS v FROM qc_po_specs WHERE workspace_id=? AND id=?', w, sample.spec_id)).v !== sample.spec_version) qcFail('CONFLICT', ['PO_VERSION_STALE'], 'The specification was revised. Start a linked evaluation under the current version.');
  if (await familyAttempts(db, w, sample.selection_id) >= MAX_ATTEMPTS) qcFail('CONFLICT', ['RECAPTURE_LIMIT'], 'This selection has used its three capture attempts. A supervisor reviews it now.');
  if (await one(db, "SELECT 1 AS x FROM qc_capture_sets WHERE workspace_id=? AND sample_id=? AND state='OPEN'", w, sample.id)) qcFail('CONFLICT', [], 'This sample already has an open capture set.');
  const id = uuid();
  return commit(db, ctx, input.idem, now, [revisionGuard(db, w, sample.id, sample.revision),
    query(db, "INSERT INTO qc_capture_sets(workspace_id,id,sample_id,state,required_roles,revision,created_by,created_at) VALUES(?,?,?,'OPEN',?,0,?,?)", w, id, sample.id, JSON.stringify((await activeRelease(db, w, now))?.domain.required_roles ?? DEFAULT_REQUIRED_ROLES), ctx.user_id, now),
    bump(db, w, sample.id), event(db, ctx, 'capture_set.created', id, { sampleId: sample.id }, now),
  ], 201, null, sample.id);
}

export const objectKey = (workspaceId, captureId, sha) => `qc/${workspaceId.replaceAll('-', '')}/${captureId.replaceAll('-', '')}/${sha.slice(0, 32)}`;
/** Consent is checked before any byte is staged: unknown, foreign, expired, withdrawn or research-only permission stores nothing. */
export async function consentFor(db, workspaceId, consentId, now) {
  const row = await one(db, 'SELECT * FROM qc_consent_authorities WHERE workspace_id=? AND id=?', workspaceId, consentId);
  if (!row || !row.operational_capture || row.withdrawn_at !== null || row.valid_from > now || row.expires_at <= now) qcFail('FORBIDDEN', [], 'No valid capture consent record covers this upload. Nothing was stored.');
  return row;
}
/**
 * Stores one original and publishes its reference. Bytes are staged under a PENDING claim, read back and verified, and only
 * then referenced in the same batch that records the capture; a claim the collector took first can no longer be referenced.
 */
export async function addCapture(db, bucket, ctx, input, now) {
  authorize(ctx, 'quality_inspector', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, { meta, bytes } = input;
  const set = await one(db, 'SELECT * FROM qc_capture_sets WHERE workspace_id=? AND id=?', w, input.capture_set_id);
  if (!set) qcFail('NOT_FOUND');
  const sample = await sampleRow(db, w, set.sample_id);
  const same = await one(db, 'SELECT capture_set_id,original_sha256 FROM qc_captures WHERE workspace_id=? AND id=?', w, meta.capture_id);
  if (same) {
    // The same file sent again: nothing advances, no second attempt, no second revision.
    if (same.capture_set_id === set.id && same.original_sha256 === meta.sha256) return { status: 200, body: await loadResult(db, w, sample.id, now), replayed: true };
    qcFail('CONFLICT', [], 'This capture ID already holds a different original.');
  }
  expectRevision(sample, meta.expected_revision);
  if (set.state !== 'OPEN') qcFail('CONFLICT', [], 'This capture set is closed.');
  const existing = await all(db, 'SELECT role FROM qc_captures WHERE workspace_id=? AND capture_set_id=?', w, set.id);
  if (existing.length >= LIMITS.max_originals_per_set) qcFail('PAYLOAD_TOO_LARGE', [], 'A capture set holds at most four originals.');
  if (existing.some(c => c.role === meta.role)) qcFail('CONFLICT', [], `This capture set already has its ${meta.role} photo.`);
  const consent = await consentFor(db, w, meta.consent_record_id, now);
  if (!bucket) qcFail('SERVICE_UNAVAILABLE', ['AUDIT_UNAVAILABLE'], 'Photo storage is unavailable. Nothing was stored.');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > LIMITS.max_original_bytes) qcFail('PAYLOAD_TOO_LARGE');
  const usedBytes = await one(db, "SELECT COALESCE(SUM(json_extract(json,'$.byte_size')),0) AS n FROM qc_captures WHERE workspace_id=? AND capture_set_id=?", w, set.id);
  if (usedBytes.n + bytes.length > LIMITS.max_set_bytes) qcFail('PAYLOAD_TOO_LARGE');
  const digest = await sha256Hex(bytes);
  if (digest !== meta.sha256 || meta.attestation.image_sha256 !== digest) qcFail('VALIDATION_FAILED', [], 'The uploaded bytes do not match the stated SHA-256.');
  if (Date.parse(meta.taken_at) > now + LIMITS.max_future_skew_s * 1000) qcFail('VALIDATION_FAILED', [], 'taken_at is in the future.');
  const attestationSha = await sha256Hex(canonicalJson(meta.attestation));
  const capture = { id: meta.capture_id, sample_id: sample.id, capture_set_id: set.id, original_sha256: digest, role: meta.role, taken_at: meta.taken_at, device_profile_id: meta.device_profile_id, calibration_id: meta.calibration_id ?? null,
    width: input.width, height: input.height, preprocessing_version: 'qc-original-1', consent_record_id: meta.consent_record_id, byte_size: bytes.length, media_type: input.mediaType, original_state: 'AVAILABLE', attestation_sha256: attestationSha };
  valid('Capture', capture);
  const key = objectKey(w, capture.id, digest), claim = await one(db, 'SELECT state FROM qc_blob_claims WHERE object_key=?', key);
  if (claim && claim.state !== 'PENDING') qcFail('CONFLICT', [], 'This upload was cleaned up before it was referenced. Send it again with a new capture ID.');
  if (!claim) await query(db, "INSERT INTO qc_blob_claims(object_key,workspace_id,sha256,size,state,created_at,updated_at) VALUES(?,?,?,?,'PENDING',?,?)", key, w, digest, bytes.length, now, now).run();
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: input.mediaType } });
    const back = await bucket.get(key);
    if (!back || await sha256Hex(await bodyBytes(back.body)) !== digest) throw new Error('readback mismatch');
  } catch { qcFail('SERVICE_UNAVAILABLE', ['AUDIT_UNAVAILABLE'], 'The original could not be stored and verified. Nothing was recorded; send it again.'); }
  await input.beforeReference?.();
  try { return await commit(db, ctx, input.idem, now, [revisionGuard(db, w, sample.id, sample.revision),
    guard(db, "SELECT 1 FROM qc_blob_claims WHERE workspace_id=? AND object_key=? AND state='PENDING'", w, key),
    // Claim/reference acquisition is mutually exclusive with GC.
    query(db, "UPDATE qc_blob_claims SET state='REFERENCED',updated_at=? WHERE object_key=?", now, key),
    query(db, "INSERT INTO qc_captures(workspace_id,id,sample_id,capture_set_id,role,original_sha256,object_key,original_state,consent_id,json,attestation_json,retain_until,created_by,created_at) VALUES(?,?,?,?,?,?,?,'AVAILABLE',?,?,?,?,?,?)",
      w, capture.id, sample.id, set.id, capture.role, digest, key, meta.consent_record_id, JSON.stringify(capture), JSON.stringify(meta.attestation), now + consent.retention_days * DAY, ctx.user_id, now),
    query(db, 'UPDATE qc_capture_sets SET revision=revision+1 WHERE workspace_id=? AND id=?', w, set.id),
    bump(db, w, sample.id), event(db, ctx, 'capture.uploaded', capture.id, { sampleId: sample.id, detail: { role: capture.role, original_sha256: digest, capture_set_id: set.id } }, now),
  ], 201, null, sample.id); }
  catch (error) {
    // A put may finish AFTER GC's delete. The collector already won and no reference can
    // publish, so retain a retryable deletion claim before cleaning up this late write.
    const lost = await one(db, 'SELECT state FROM qc_blob_claims WHERE object_key=?', key);
    if (lost && ['GC_CLAIMED', 'DELETED'].includes(lost.state)) {
      await query(db, "UPDATE qc_blob_claims SET state='GC_CLAIMED',purpose='ORPHAN_RETRY',updated_at=? WHERE object_key=? AND state IN ('GC_CLAIMED','DELETED')", now, key).run();
      try { await bucket.delete(key); await query(db, "UPDATE qc_blob_claims SET state='DELETED',updated_at=? WHERE object_key=? AND state='GC_CLAIMED' AND purpose='ORPHAN_RETRY'", now, key).run(); } catch { /* collector retries the retained claim */ }
    }
    throw error;
  }
}
export async function bodyBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Freezes the exact members and allocates one attempt for the whole selection family, atomically. */
export async function closeCaptureSet(db, ctx, input, now) {
  authorize(ctx, 'quality_inspector', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, set = await one(db, 'SELECT * FROM qc_capture_sets WHERE workspace_id=? AND id=?', w, input.capture_set_id);
  if (!set) qcFail('NOT_FOUND');
  const sample = await sampleRow(db, w, set.sample_id);
  if (set.state === 'CLOSED') return { status: 200, body: await loadResult(db, w, sample.id, now), replayed: true };
  expectRevision(sample, input.expected_revision);
  const roles = (await all(db, 'SELECT role FROM qc_captures WHERE workspace_id=? AND capture_set_id=?', w, set.id)).map(c => c.role);
  const missing = JSON.parse(set.required_roles).filter(role => !roles.includes(role));
  if (missing.length) qcFail('VALIDATION_FAILED', [], `Add the ${missing.join(', ')} photo before closing this capture set.`);
  const used = await familyAttempts(db, w, sample.selection_id);
  if (used >= MAX_ATTEMPTS) qcFail('CONFLICT', ['RECAPTURE_LIMIT'], 'This selection has used its three capture attempts.');
  return commit(db, ctx, input.idem, now, [revisionGuard(db, w, sample.id, sample.revision),
    guard(db, 'SELECT 1 WHERE (SELECT COUNT(*) FROM qc_captures WHERE workspace_id=? AND capture_set_id=?)=?', w, set.id, roles.length),
    query(db, "UPDATE qc_capture_sets SET state='CLOSED',attempt=?,revision=revision+1,closed_at=? WHERE workspace_id=? AND id=?", used + 1, now, w, set.id),
    bump(db, w, sample.id, ",capture_attempt=?,disposition='SUBMITTED'", used + 1),
    event(db, ctx, 'capture_set.closed', set.id, { sampleId: sample.id, detail: { attempt: used + 1, roles } }, now),
  ], 200, null, sample.id);
}

// ---------------------------------------------------------------------------- analysis
/** Everything the private analysis needs, selected and hashed by the Worker; nothing in it comes from the browser. */
export async function buildAnalyzeInputs(db, ctx, sampleId, captureSetId, expectedRevision, now) {
  authorize(ctx, 'quality_inspector');
  const w = ctx.workspace_id, sample = await sampleRow(db, w, sampleId);
  expectRevision(sample, expectedRevision);
  const set = await one(db, 'SELECT * FROM qc_capture_sets WHERE workspace_id=? AND id=? AND sample_id=?', w, captureSetId, sample.id);
  if (!set) qcFail('NOT_FOUND');
  if (set.state !== 'CLOSED') qcFail('CONFLICT', [], 'Close the capture set before analysing it.');
  if (await one(db, 'SELECT 1 AS x FROM qc_evidence WHERE workspace_id=? AND capture_set_id=?', w, set.id)) qcFail('CONFLICT', [], 'This capture set already has a recorded result.');
  const specRow = await one(db, 'SELECT * FROM qc_po_specs WHERE workspace_id=? AND id=? AND version=?', w, sample.spec_id, sample.spec_version);
  const latest = await currentSpecRow(db, w, sample.purchase_order_id);
  if (latest.version !== sample.spec_version) qcFail('CONFLICT', ['PO_VERSION_STALE'], 'The specification was revised. Start a linked evaluation under the current version.');
  const spec = JSON.parse(specRow.json), selected = await activeRelease(db, w, now), policy = selected?.policy ?? await reviewOnlyPolicy();
  const rows = await all(db, 'SELECT c.*,b.state AS claim_state FROM qc_captures c JOIN qc_blob_claims b ON b.object_key=c.object_key WHERE c.workspace_id=? AND c.capture_set_id=? ORDER BY c.created_at,c.id', w, set.id);
  if (!rows.length || rows.length > LIMITS.max_originals_per_set || JSON.parse(set.required_roles).some(role => !rows.some(row => row.role === role))) qcFail('CONFLICT', ['EVIDENCE_STALE'], 'The closed set has missing capture references.');
  const captures = rows.map(row => ({ capture: { ...JSON.parse(row.json), original_state: row.original_state }, original_storage_reference: row.object_key, verified_sha256: row.original_sha256, acquisition_attestation_sha256: JSON.parse(row.json).attestation_sha256, attestation: JSON.parse(row.attestation_json), geometry_artifact_sha256: null, calibration: null, reference: null, axis_registration: null }));
  return { sample, set, spec, policy, release: selected?.release ?? null, domain: selected?.domain ?? null, captures, captureRows: rows };
}

export async function prepareAnalysis(db, bucket, ctx, input, started, now) {
  const inputs = await buildAnalyzeInputs(db, ctx, input.sample_id, input.capture_set_id, input.expected_revision, now);
  const { sample, set, spec, policy, captureRows: rows } = inputs, w = ctx.workspace_id, selected = inputs.release ? inputs : null;
  const captures = [], files = [];
  for (const row of rows) {
    if (row.original_state !== 'AVAILABLE' || row.claim_state !== 'REFERENCED') qcFail('CONFLICT', ['EVIDENCE_STALE'], 'An original of this capture set is no longer available.');
    const object = bucket ? await bucket.get(row.object_key) : null, bytes = object ? await bodyBytes(object.body) : null;
    // A missing or altered original blocks the analysis: no decision is ever bound to bytes that could not be read back.
    if (!bytes || await sha256Hex(bytes) !== row.original_sha256) qcFail('SERVICE_UNAVAILABLE', ['AUDIT_UNAVAILABLE'], 'A stored original could not be read back intact. No decision was made.');
    const capture = { ...JSON.parse(row.json), original_state: 'AVAILABLE' };
    captures.push({ capture, original_storage_reference: row.object_key, verified_sha256: row.original_sha256, acquisition_attestation_sha256: capture.attestation_sha256, attestation: JSON.parse(row.attestation_json),
      geometry_artifact_sha256: null, calibration: null, reference: null, axis_registration: null });
    files.push({ id: capture.id, bytes, type: capture.media_type });
  }
  const request = { schema_version: '2', sample_id: sample.id, workspace_id: w, spec, policy, release: selected?.release ?? null, domain: selected?.domain ?? null, attempt: set.attempt, expected_revision: sample.revision,
    context: { evaluated_at: isoTime(now), clock_source: 'WORKER_UTC', deadline_at: isoTime(started.deadline_at), calibration_records_sha256: await sha256Hex(canonicalJson([])),
      capture_binding_sha256: await sha256Hex(canonicalJson(captures.map(c => [c.capture.id, c.verified_sha256]))), request_id: started.request_id, request_generation: started.generation },
    captures };
  valid('AnalyzeRequest', request, 'INTERNAL_ERROR');
  return { request, files, sample, set, spec, policy, release: selected?.release ?? null, domain: selected?.domain ?? null };
}
/** The candidate must be the answer to exactly the request the Worker signed, and its draft must be one the Worker may store. */
export async function checkCandidate(candidate, prepared) {
  const { request, policy, release } = prepared, bad = detail => qcFail('SERVICE_UNAVAILABLE', ['STAGE_UNAVAILABLE'], detail);
  const failed = violation('AnalysisCandidate', candidate);
  if (failed) bad(`The scanner answer is not a valid analysis: ${failed.path} ${failed.message}`);
  const { binding, evidence, draft } = candidate, shas = request.captures.map(c => c.verified_sha256), ids = request.captures.map(c => c.capture.id);
  const expected = { spec_sha256: request.spec.content_sha256, policy_sha256: policy.sha256, release_sha256: release?.sha256 ?? null, capture_sha256s: shas, attempt: request.attempt, expected_revision: request.expected_revision,
    request_id: request.context.request_id, request_generation: request.context.request_generation, deadline_at: request.context.deadline_at };
  if (canonicalJson(binding) !== canonicalJson(expected)) bad('The scanner answer is bound to a different request.');
  if (evidence.sample_id !== request.sample_id || evidence.spec_sha256 !== request.spec.content_sha256 || canonicalJson([...evidence.capture_ids].sort()) !== canonicalJson([...ids].sort())) bad('The scanner evidence describes a different sample.');
  if (evidence.manifest_sha256 !== await contentSha256(evidence, HASH_EXCLUDES.Evidence)) bad('The scanner evidence does not match its manifest hash.');
  // Fail-closed clamp, not a policy: an automatic status is refused unless this Worker itself selected an active release
  // and an AUTOMATIC policy for this very request. The policy evaluator stays the scanner's Python evaluate_qc.
  if (draft.automatic && !(release && release.state === 'ACTIVE' && policy.mode === 'AUTOMATIC' && prepared.domain && evidence.domain_id === prepared.domain.id)) bad('The scanner proposed an automatic status without a released domain. Nothing was recorded.');
  return candidate;
}
/**
 * Atomic finalisation. Every precondition is rechecked inside the batch at commit time: the request generation and deadline,
 * the initiating session and role, the sample revision, the current spec version, the capture set and its originals, and the
 * release. Losing any of them writes nothing: no evidence, no decision, no audit event, no pointer, no stored success.
 * `result` = { prepared, candidate, started: {request_id, generation, deadline_at} }.
 */
export async function finalizeQC(db, authContext, result, expectedRevision, now) {
  const ctx = authContext, w = ctx.workspace_id, { prepared, candidate, started } = result, { sample, set, release, policy } = prepared;
  if (now >= started.deadline_at) qcFail('DEADLINE_EXCEEDED', [], 'The analysis finished after its deadline. No decision was recorded.');
  authorize(ctx, 'quality_inspector');
  await checkCandidate(candidate, prepared);
  if (prepared.request.sample_id !== sample.id || prepared.request.workspace_id !== w || prepared.request.expected_revision !== expectedRevision || prepared.request.context.request_id !== started.request_id || prepared.request.context.request_generation !== started.generation || Date.parse(prepared.request.context.deadline_at) !== started.deadline_at) qcFail('CONFLICT', ['EVIDENCE_STALE']);
  const before = await loadResult(db, w, sample.id, now);
  const evidence = { ...candidate.evidence, id: uuid() }, revision = expectedRevision + 1;
  const decision = { ...candidate.draft, schema_version: '2', id: uuid(), sample_id: sample.id, evidence_id: evidence.id, spec_id: sample.spec_id, spec_version: sample.spec_version, revision, policy_version: policy.version,
    release_id: candidate.draft.automatic ? release.id : null, evaluated_at: isoTime(now) };
  const body = { ...before, sample: { ...before.sample, revision }, revision, evidence, decision, history: [...before.history, decision] };
  const failed = violation('QCResult', body);
  if (failed) qcFail('INTERNAL_ERROR', [], `${failed.path} ${failed.message}`);
  const batch = [authGuard(db, ctx, now),
    guard(db, "SELECT 1 FROM qc_idempotency WHERE workspace_id=? AND actor_id=? AND request_id=? AND state='IN_PROGRESS' AND generation=? AND deadline_at=? AND deadline_at>? AND lease_expires_at>?", w, ctx.user_id, started.request_id, started.generation, started.deadline_at, now, now),
    guard(db, 'SELECT 1 FROM qc_samples s WHERE s.workspace_id=? AND s.id=? AND s.revision=? AND s.spec_version=(SELECT MAX(version) FROM qc_po_specs WHERE workspace_id=s.workspace_id AND id=s.spec_id)', w, sample.id, expectedRevision),
    guard(db, "SELECT 1 FROM qc_capture_sets WHERE workspace_id=? AND id=? AND sample_id=? AND state='CLOSED' AND attempt=?", w, set.id, sample.id, set.attempt),
    guard(db, "SELECT 1 WHERE (SELECT COUNT(*) FROM qc_captures c JOIN qc_blob_claims b ON b.object_key=c.object_key WHERE c.workspace_id=? AND c.capture_set_id=? AND c.original_state='AVAILABLE' AND b.state='REFERENCED')=?", w, set.id, prepared.request.captures.length),
    ...prepared.request.captures.map(c => guard(db, "SELECT 1 FROM qc_captures c JOIN qc_blob_claims b ON b.object_key=c.object_key WHERE c.workspace_id=? AND c.id=? AND c.sample_id=? AND c.capture_set_id=? AND c.original_sha256=? AND c.original_state='AVAILABLE' AND b.state='REFERENCED'", w, c.capture.id, sample.id, set.id, c.verified_sha256)),
    release
      ? guard(db, "SELECT 1 FROM qc_releases WHERE workspace_id=? AND id=? AND state='ACTIVE' AND expires_at>? AND sha256=?", w, release.id, now, release.sha256)
      : guard(db, "SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM qc_releases WHERE workspace_id=? AND state='ACTIVE' AND expires_at>?)", w, now),
    query(db, 'INSERT INTO qc_evidence(workspace_id,id,sample_id,capture_set_id,spec_id,spec_version,manifest_sha256,json,created_at) VALUES(?,?,?,?,?,?,?,?,?)', w, evidence.id, sample.id, set.id, sample.spec_id, sample.spec_version, evidence.manifest_sha256, JSON.stringify(evidence), now),
    query(db, 'INSERT INTO qc_decisions(workspace_id,id,sample_id,evidence_id,spec_id,spec_version,revision,status,automatic,release_id,domain_id,policy_version,request_id,json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      w, decision.id, sample.id, evidence.id, sample.spec_id, sample.spec_version, revision, decision.status, decision.automatic ? 1 : 0, decision.release_id, evidence.domain_id, policy.version, started.request_id, JSON.stringify(decision), ctx.user_id, now),
    event(db, ctx, 'decision.committed', decision.id, { sampleId: sample.id, requestId: started.request_id, detail: { status: decision.status, reasons: decision.reasons, automatic: decision.automatic, evidence_id: evidence.id, manifest_sha256: evidence.manifest_sha256,
      spec_sha256: prepared.spec.content_sha256, policy_sha256: policy.sha256, release_id: decision.release_id, attempt: set.attempt, generation: started.generation } }, now),
    query(db, 'UPDATE qc_samples SET revision=revision+1,current_decision_id=? WHERE workspace_id=? AND id=?', decision.id, w, sample.id),
    query(db, "UPDATE qc_idempotency SET state='COMPLETED',response_status=200,response_json=?,updated_at=? WHERE request_id=?", JSON.stringify(body), now, started.request_id),
  ];
  try { await db.batch(batch); } catch (error) {
    const problem = batchProblem(error);
    // Which precondition was lost decides the answer: a passed deadline is a 504, everything else a 409.
    if (problem.code === 'CONFLICT' && now >= started.deadline_at) qcFail('DEADLINE_EXCEEDED');
    throw problem;
  }
  return decision;
}

// ---------------------------------------------------------------------------- adjudication
/** Appends a reviewer's finding. The model decision and evidence stay exactly as they were. */
export async function appendAdjudication(db, ctx, input, now) {
  authorize(ctx, 'supervisor', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, sample = await sampleRow(db, w, input.sample_id);
  expectRevision(sample, input.expected_revision);
  const latest = await one(db, 'SELECT id FROM qc_adjudications WHERE workspace_id=? AND sample_id=? ORDER BY revision DESC LIMIT 1', w, sample.id);
  if ((input.supersedes_id ?? null) !== (latest?.id ?? null)) qcFail('CONFLICT', ['EVIDENCE_STALE'], 'Another review was recorded first. Reload this sample.');
  const record = valid('Adjudication', { id: uuid(), sample_id: sample.id, revision: sample.revision + 1, outcome: input.outcome, reason: input.reason, reference_ids: input.reference_ids ?? [], actor_id: ctx.user_id, created_at: isoTime(now),
    supersedes_id: input.supersedes_id ?? null, intervention_reason: input.intervention ?? null });
  return commit(db, ctx, input.idem, now, [revisionGuard(db, w, sample.id, sample.revision),
    query(db, 'INSERT INTO qc_adjudications(workspace_id,id,sample_id,revision,outcome,supersedes_id,json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)', w, record.id, sample.id, record.revision, record.outcome, record.supersedes_id, JSON.stringify(record), ctx.user_id, now),
    bump(db, w, sample.id), event(db, ctx, 'adjudication.appended', record.id, { sampleId: sample.id, detail: { outcome: record.outcome, supersedes_id: record.supersedes_id }, reason: record.reason, intervention: record.intervention_reason }, now),
  ], 201, null, sample.id);
}

// ---------------------------------------------------------------------------- releases and fresh credentials
export async function issueProof(db, ctx, payloadSha, now, token) {
  authorize(ctx, 'admin');
  if (!/^[a-f\d]{64}$/.test(token) || !/^[a-f\d]{64}$/.test(payloadSha)) qcFail('VALIDATION_FAILED');
  await db.batch([authGuard(db, ctx, now),
    query(db, 'INSERT INTO qc_reauth_proofs(proof_hash,workspace_id,actor_id,session_hash,payload_sha256,expires_at,created_at) VALUES(?,?,?,?,?,?,?)', await sha256Hex(token), ctx.workspace_id, ctx.user_id, ctx.session_hash, payloadSha, now + PROOF_MS, now)]);
  return { proof: token, expires_at: isoTime(now + PROOF_MS) };
}
/** Guard + single use, inside the caller's batch: right session, actor, workspace and payload, unexpired, never used before. */
async function proofStatements(db, ctx, proof, payloadSha, key, now) {
  if (typeof proof !== 'string' || !/^[a-f\d]{64}$/.test(proof)) qcFail('FORBIDDEN', ['POLICY_UNRELEASED'], 'Confirm your PIN again for this exact change.');
  const hash = await sha256Hex(proof);
  return [guard(db, 'SELECT 1 FROM qc_reauth_proofs WHERE proof_hash=? AND workspace_id=? AND actor_id=? AND session_hash=? AND payload_sha256=? AND expires_at>? AND used_at IS NULL', hash, ctx.workspace_id, ctx.user_id, ctx.session_hash, payloadSha, now),
    query(db, 'UPDATE qc_reauth_proofs SET used_at=?,used_key=? WHERE proof_hash=?', now, key, hash)];
}
const proofProblem = error => { const problem = batchProblem(error); return problem.code === 'CONFLICT' ? new QCProblem('FORBIDDEN', ['POLICY_UNRELEASED'], 'The fresh credential proof is missing, expired, already used or for a different change.') : problem; };

/** Registers a statistical candidate. It authorises nothing: activation is a separate, gated step. */
export async function registerRelease(db, ctx, input, now) {
  authorize(ctx, 'admin', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, { domain, policy } = input;
  valid('DomainManifest', domain); valid('Policy', policy);
  if (domain.sha256 !== await contentSha256(domain, HASH_EXCLUDES.DomainManifest) || policy.sha256 !== await contentSha256(policy, HASH_EXCLUDES.Policy)) qcFail('VALIDATION_FAILED', [], 'The domain or policy hash does not match its content.');
  if (policy.mode !== 'AUTOMATIC') qcFail('VALIDATION_FAILED', [], 'A release carries an AUTOMATIC policy; review-only needs no release.');
  if (input.independent_signatory.trim().toLowerCase() === ctx.name.trim().toLowerCase()) qcFail('VALIDATION_FAILED', [], 'The independent signatory must be a different person.');
  if (input.predecessor_release_id && !await one(db, 'SELECT 1 AS x FROM qc_releases WHERE workspace_id=? AND id=?', w, input.predecessor_release_id)) qcFail('NOT_FOUND');
  const body = { id: uuid(), version: input.version, workspace_id: w, domain_sha256: domain.sha256, policy_sha256: policy.sha256, bundle_sha256: input.bundle_sha256, calibration_sha256: input.calibration_sha256,
    statistics_report_sha256: input.statistics_report_sha256, operations_proof_sha256: input.operations_proof_sha256 ?? null, monitoring_protocol_sha256: input.monitoring_protocol_sha256 ?? null, authority_record_sha256: input.authority_record_sha256,
    approved_by: ctx.user_id, independent_signatory: input.independent_signatory, expires_at: input.expires_at, predecessor_release_id: input.predecessor_release_id ?? null };
  const release = valid('Release', { ...body, state: 'STATISTICAL_CANDIDATE', sha256: await contentSha256(body) });
  if (!(Date.parse(release.expires_at) > now)) qcFail('VALIDATION_FAILED', [], 'expires_at must be in the future.');
  const { state, ...frozen } = release;
  try {
    return await commit(db, ctx, input.idem, now, [...await proofStatements(db, ctx, input.proof, input.payloadSha, input.idem?.key ?? release.id, now),
      query(db, "INSERT INTO qc_releases(workspace_id,id,state,sha256,json,domain_json,policy_json,expires_at,created_by,created_at,updated_at) VALUES(?,?,'STATISTICAL_CANDIDATE',?,?,?,?,?,?,?,?)", w, release.id, release.sha256, JSON.stringify(frozen), JSON.stringify(domain), JSON.stringify(policy), Date.parse(release.expires_at), ctx.user_id, now, now),
      event(db, ctx, 'release.registered', release.id, { detail: { sha256: release.sha256, domain_id: domain.id } }, now)], 201, release);
  } catch (error) { throw proofProblem(error); }
}
/**
 * Activation is unavailable unless the deployment itself carries evidence hashes for every external gate G1..G8 and the
 * release carries operations and monitoring proof. Passing tests never satisfies this; no gate is approved by code.
 */
export async function activateRelease(db, ctx, input, now) {
  authorize(ctx, 'admin', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, row = await one(db, 'SELECT * FROM qc_releases WHERE workspace_id=? AND id=?', w, input.id);
  if (!row) qcFail('NOT_FOUND');
  const missing = missingGates(input.gates), release = releaseOf(row);
  if (missing.length || release.operations_proof_sha256 === null || release.monitoring_protocol_sha256 === null) qcFail('FORBIDDEN', ['POLICY_UNRELEASED'], `Automatic decisions stay disabled: ${missing.length ? `missing external gate evidence ${missing.join(', ')}` : 'the release has no operations or monitoring proof'}.`);
  if (row.state !== 'STATISTICAL_CANDIDATE') qcFail('CONFLICT', [], 'Only a statistical candidate can be activated.');
  if (row.expires_at <= now) qcFail('CONFLICT', [], 'This release has expired.');
  if (await one(db, "SELECT 1 AS x FROM qc_releases WHERE workspace_id=? AND state='ACTIVE'", w)) qcFail('CONFLICT', [], 'Suspend the active release first.');
  try {
    return await commit(db, ctx, input.idem, now, [...await proofStatements(db, ctx, input.proof, input.payloadSha, input.idem?.key ?? row.id, now),
      guard(db, "SELECT 1 FROM qc_releases WHERE workspace_id=? AND id=? AND state='STATISTICAL_CANDIDATE' AND expires_at>?", w, row.id, now),
      query(db, "UPDATE qc_releases SET state='ACTIVE',activated_by=?,updated_at=? WHERE workspace_id=? AND id=?", ctx.user_id, now, w, row.id),
      event(db, ctx, 'release.activated', row.id, { detail: { sha256: row.sha256, gates: input.gates } }, now)], 200, { ...release, state: 'ACTIVE' });
  } catch (error) { throw proofProblem(error); }
}
export const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];
export const missingGates = gates => GATES.filter(gate => !/^[0-9a-f]{64}$/.test(gates?.[gate] ?? ''));
/** Containment is immediate: current admin authorisation only, no proof, no signatory. */
export async function suspendRelease(db, ctx, input, now) {
  authorize(ctx, 'admin', input);
  const replay = await replayOf(db, ctx, input.idem); if (replay) return replay;
  const w = ctx.workspace_id, row = await one(db, 'SELECT * FROM qc_releases WHERE workspace_id=? AND id=?', w, input.id);
  if (!row) qcFail('NOT_FOUND');
  if (row.state === 'SUSPENDED') qcFail('CONFLICT', [], 'This release is already suspended.');
  return commit(db, ctx, input.idem, now, [
    query(db, "UPDATE qc_releases SET state='SUSPENDED',suspended_by=?,suspend_reason=?,updated_at=? WHERE workspace_id=? AND id=?", ctx.user_id, input.reason, now, w, row.id),
    event(db, ctx, 'release.suspended', row.id, { reason: input.reason, detail: { previous: row.state } }, now)], 200, { ...releaseOf(row), state: 'SUSPENDED' });
}

// ---------------------------------------------------------------------------- orphaned blob collection
/**
 * Deletes originals that were staged but never referenced. Claiming a key for collection and publishing its reference are the
 * two exits from PENDING, and the transition trigger lets exactly one of them happen; the grace period only avoids wasted work.
 * A failed deletion stays GC_CLAIMED and is retried. A REFERENCED key is never touched here: governed purge is qc-retention.
 */
export async function collectQCBlobs(db, bucket, now, graceMs = DAY) {
  const report = { claimed: 0, deleted: 0, failed: 0, lost: 0 };
  for (const row of await all(db, "SELECT object_key FROM qc_blob_claims WHERE state='PENDING' AND updated_at<=? ORDER BY updated_at LIMIT 200", now - graceMs)) {
    const claimed = await query(db, "UPDATE qc_blob_claims SET state='GC_CLAIMED',purpose='ORPHAN',updated_at=? WHERE object_key=? AND state='PENDING'", now, row.object_key).run().catch(() => ({ meta: { changes: 0 } }));
    if (claimed.meta.changes === 1) report.claimed++; else report.lost++;
  }
  for (const row of await all(db, "SELECT object_key FROM qc_blob_claims WHERE state='GC_CLAIMED' AND purpose IN ('ORPHAN','ORPHAN_RETRY') ORDER BY updated_at LIMIT 200")) {
    try { await bucket.delete(row.object_key); await query(db, "UPDATE qc_blob_claims SET state='DELETED',updated_at=? WHERE object_key=? AND state='GC_CLAIMED'", now, row.object_key).run(); report.deleted++; }
    catch { await query(db, 'UPDATE qc_blob_claims SET attempts=attempts+1,updated_at=? WHERE object_key=?', now, row.object_key).run().catch(() => {}); report.failed++; }
  }
  return report;
}


export async function getSpec(db, workspaceId, id, version = null) {
  const rows = await all(db, 'SELECT version,json FROM qc_po_specs WHERE workspace_id=? AND id=? ORDER BY version', workspaceId, id);
  const row = version == null ? rows.at(-1) : rows.find(r => r.version === version);
  if (!row) qcFail('NOT_FOUND');
  return { spec: JSON.parse(row.json), current: row.version === rows.at(-1).version, versions: rows.map(r => r.version) };
}
export const stageCapture = addCapture;
export const getRequest = requestState;
export const registerCandidate = registerRelease;
export const activate = activateRelease;
export const suspend = suspendRelease;
export async function consumeProof(db, ctx, proof, payloadSha, key, now) {
  authorize(ctx, 'admin');
  try { await db.batch([authGuard(db, ctx, now), ...await proofStatements(db, ctx, proof, payloadSha, key, now)]); }
  catch (error) { throw proofProblem(error); }
}
export async function completeRequest(db, ctx, started, status, body, now) {
  if (now >= started.deadline_at) qcFail('DEADLINE_EXCEEDED');
  try { await db.batch([authGuard(db, ctx, now),
    guard(db, "SELECT 1 FROM qc_idempotency WHERE workspace_id=? AND actor_id=? AND request_id=? AND generation=? AND state='IN_PROGRESS' AND deadline_at=? AND deadline_at>? AND lease_expires_at>?", ctx.workspace_id, ctx.user_id, started.request_id, started.generation, started.deadline_at, now, now),
    query(db, "UPDATE qc_idempotency SET state='COMPLETED',response_status=?,response_json=?,updated_at=? WHERE request_id=?", status, JSON.stringify(body), now, started.request_id)]); }
  catch (error) { throw batchProblem(error); }
  return { status, body };
}

// The response is materialized INSIDE the same batch as the mutation. A pointer replay would
// return later revisions and would not resolve a lost HTTP response to the original outcome.
function durableResult(workspaceId, sampleId, now) {
  const time = col => `strftime('%Y-%m-%dT%H:%M:%fZ',${col}/1000.0,'unixepoch')`;
  return { args: [now, workspaceId, sampleId], sql: `SELECT json_object(
    'schema_version','2','mode',CASE WHEN EXISTS(SELECT 1 FROM qc_releases r WHERE r.workspace_id=s.workspace_id AND r.state='ACTIVE' AND r.expires_at>t.now) THEN 'AUTOMATIC' ELSE 'REVIEW_ONLY' END,
    'sample',json_object('schema_version','2','id',s.id,'workspace_id',s.workspace_id,'purchase_order_id',s.purchase_order_id,'spec_id',s.spec_id,'spec_version',s.spec_version,
      'lot_ref',json_extract(x.json,'$.lot_ref'),'roll_ref',json_extract(x.json,'$.roll_ref'),'location_ref',json_extract(x.json,'$.location_ref'),'sample_plan_version',json_extract(x.json,'$.plan_version'),
      'capture_attempt',s.capture_attempt,'revision',s.revision,'predecessor_sample_id',s.predecessor_sample_id,'selection_id',s.selection_id,'face',json_extract(x.json,'$.face'),
      'planned_area_cm2',json_extract(x.json,'$.planned_area_cm2'),'usable_area_cm2',s.usable_area_cm2,'sampling_method',json_extract(x.json,'$.method'),'independent_group_id',json_extract(x.json,'$.independent_group_id'),
      'disposition',s.disposition,'exclusion_reason',s.exclusion_reason,'created_by',s.created_by,'created_at',${time('s.created_at')}),
    'captures',json((SELECT json_group_array(json(j)) FROM (SELECT json_set(c.json,'$.original_state',c.original_state) AS j FROM qc_captures c WHERE c.workspace_id=s.workspace_id AND c.sample_id=s.id ORDER BY c.created_at,c.id))),
    'capture_sets',json((SELECT json_group_array(json(j)) FROM (SELECT json_object('id',c.id,'sample_id',s.id,'state',c.state,'required_roles',json(c.required_roles),
      'capture_ids',json((SELECT json_group_array(id) FROM (SELECT id FROM qc_captures WHERE workspace_id=s.workspace_id AND capture_set_id=c.id ORDER BY created_at,id))),
      'revision',c.revision,'attempt',c.attempt) AS j FROM qc_capture_sets c WHERE c.workspace_id=s.workspace_id AND c.sample_id=s.id ORDER BY c.created_at,c.id))),
    'evidence',json((SELECT e.json FROM qc_evidence e JOIN qc_decisions d ON d.workspace_id=e.workspace_id AND d.evidence_id=e.id WHERE d.workspace_id=s.workspace_id AND d.id=s.current_decision_id)),
    'decision',json((SELECT json FROM qc_decisions WHERE workspace_id=s.workspace_id AND id=s.current_decision_id)),
    'history',json((SELECT json_group_array(json(j)) FROM (SELECT json AS j FROM qc_decisions WHERE workspace_id=s.workspace_id AND sample_id=s.id ORDER BY revision))),
    'adjudications',json((SELECT json_group_array(json(j)) FROM (SELECT json AS j FROM qc_adjudications WHERE workspace_id=s.workspace_id AND sample_id=s.id ORDER BY revision))),
    'current_human_disposition',json((SELECT json FROM qc_adjudications WHERE workspace_id=s.workspace_id AND sample_id=s.id ORDER BY revision DESC LIMIT 1)),
    'recalled_decision_ids',json((SELECT json_group_array(decision_id) FROM (SELECT DISTINCT decision_id FROM qc_recalls WHERE workspace_id=s.workspace_id AND sample_id=s.id LIMIT 50))),
    'family',json_object('selection_id',s.selection_id,'predecessor_sample_id',s.predecessor_sample_id,
      'successor_sample_ids',json((SELECT json_group_array(id) FROM (SELECT id FROM qc_samples WHERE workspace_id=s.workspace_id AND predecessor_sample_id=s.id ORDER BY created_at))),
      'attempts_used',(SELECT COUNT(*) FROM qc_capture_sets c JOIN qc_samples f ON f.workspace_id=c.workspace_id AND f.id=c.sample_id WHERE f.workspace_id=s.workspace_id AND f.selection_id=s.selection_id AND c.state='CLOSED'),
      'attempts_max',3,'spec_is_current',json(CASE WHEN s.spec_version=(SELECT MAX(version) FROM qc_po_specs WHERE workspace_id=s.workspace_id AND id=s.spec_id) THEN 'true' ELSE 'false' END),
      'current_spec_version',(SELECT MAX(version) FROM qc_po_specs WHERE workspace_id=s.workspace_id AND id=s.spec_id)),
    'revision',s.revision) AS json
    FROM qc_samples s JOIN qc_selections x ON x.workspace_id=s.workspace_id AND x.id=s.selection_id CROSS JOIN (SELECT ? AS now) t WHERE s.workspace_id=? AND s.id=?` };
}
