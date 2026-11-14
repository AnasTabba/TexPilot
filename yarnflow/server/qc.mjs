/** Incoming sample QC boundary. Identity/persistence live in Yarnflow; policy stays in Python. */
import * as store from './qc-store.mjs';
import { ERROR_STATUS, LIMITS, SCHEMA, canonicalJson, sha256Hex, violation, withDefaults } from './qc-contract.mjs';
import { all, one, query, json, keys, text, integer, recordId, reason, role, readJson, ErpProblem } from './erp-utils.mjs';
import { pinHash, randomHex, validPin, LOCK_AFTER, LOCK_MS } from './auth.mjs';
import { issueQCAssertion } from './qc-service-auth.mjs';
import { sendQCToScanner } from './scanner-proxy.mjs';
const PREFIX = '/api/qc/v2', encoder = new TextEncoder(), UUID = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/;
export const isQCPath = path => path === PREFIX || path.startsWith(PREFIX + '/');
const fail = (code, reasons = []) => { throw Object.assign(new Error(code), { code, reasons }); };
const callStore = async (name, ...args) => { if (typeof store[name] !== 'function') fail('SERVICE_UNAVAILABLE'); return store[name](...args); };
const valid = (type, value) => { if (violation(type, value)) fail('VALIDATION_FAILED'); return value; };
const optionalId = value => value == null ? null : recordId(value);
const reply = result => json(result.body, result.status);
const own = (value, allowed) => keys(value, allowed);
const nowOf = env => typeof env.QC_NOW === 'function' ? env.QC_NOW() : Date.now();
const retryable = code => ERROR_STATUS[code].retryable;
export function qcErrorResponse(error, requestId = crypto.randomUUID()) {
  const byStatus = Object.fromEntries(Object.entries(ERROR_STATUS).map(([code, value]) => [value.status, code]));
  const code = Object.hasOwn(ERROR_STATUS, error?.code) ? error.code : error instanceof ErpProblem ? byStatus[error.status] ?? 'INTERNAL_ERROR' : 'INTERNAL_ERROR';
  const allowed = SCHEMA.$defs.ErrorBody.properties.reasons.items.enum;
  return json({ schema_version: '2', error: { code, reasons: (error?.reasons ?? []).filter(r => allowed.includes(r)), retryable: retryable(code), request_id: requestId } }, ERROR_STATUS[code].status);
}
/** Allocated before all QC work, including DB/session lookup and body parsing in inventory. */
export async function qcErrorBoundary(request, work) {
  const requestId = crypto.randomUUID();
  try { return await work(requestId); } catch (error) { return qcErrorResponse(error, requestId); }
}
const ROUTES = [
  ['GET', /^\/status$/, 'status'], ['GET', /^\/purchase-orders$/, 'orders'], ['POST', /^\/specs$/, 'spec', 'purchase_manager'], ['GET', /^\/specs\/([^/]+)$/, 'getSpec'],
  ['GET', /^\/consent-authorities$/, 'consents'], ['POST', /^\/consent-authorities$/, 'consent', 'admin'], ['POST', /^\/selections$/, 'selection', 'quality_inspector'], ['POST', /^\/samples$/, 'sample', 'quality_inspector'],
  ['GET', /^\/samples$/, 'samples'], ['GET', /^\/samples\/([^/]+)$/, 'getSample'], ['POST', /^\/samples\/([^/]+)\/capture-sets$/, 'set', 'quality_inspector'], ['POST', /^\/capture-sets\/([^/]+)\/captures$/, 'upload', 'quality_inspector'],
  ['POST', /^\/capture-sets\/([^/]+)\/close$/, 'close', 'quality_inspector'], ['POST', /^\/samples\/([^/]+)\/analyze$/, 'analyze', 'quality_inspector'], ['GET', /^\/requests\/([^/]+)$/, 'request'], ['GET', /^\/captures\/([^/]+)\/original$/, 'original'],
  ['POST', /^\/samples\/([^/]+)\/adjudications$/, 'adjudicate', 'supervisor'], ['POST', /^\/reauth$/, 'reauth', 'admin'], ['GET', /^\/releases$/, 'releases'], ['POST', /^\/releases$/, 'release', 'admin'], ['POST', /^\/releases\/([^/]+)\/activate$/, 'activate', 'admin'], ['POST', /^\/releases\/([^/]+)\/suspend$/, 'suspend', 'admin'],
];
function gatesOf(env) { try { return JSON.parse(env.QC_AUTOMATION_GATES ?? '{}'); } catch { return {}; } }
const permit = (ctx, input, required) => { if (!required || ctx.role === required) return null; if (required === 'admin' || typeof input?.interventionReason !== 'string' || input.interventionReason.trim().length < 5) fail('FORBIDDEN'); return role(ctx, input, required); };
function routeFor(path, method) {
  const matching = ROUTES.filter(r => r[1].test(path)), route = matching.find(r => r[0] === method);
  if (!route) fail(matching.length ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND');
  return { name: route[2], required: route[3], id: path.match(route[1])[1] };
}
export async function handleQC(request, env, authContext) {
  const url = new URL(request.url); if (!isQCPath(url.pathname)) return null;
  return qcErrorBoundary(request, async requestId => {
    if (!env.DB) fail('SERVICE_UNAVAILABLE');
    const ctx = authContext, db = env.DB, now = nowOf(env), path = url.pathname.slice(PREFIX.length).replace(/\/$/, '') || '/';
    if (!ctx || !(ctx.session_expires_at > now)) fail('UNAUTHENTICATED');
    if (request.method !== 'GET' && (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')) fail('FORBIDDEN');
    const r = routeFor(path, request.method), w = ctx.workspace_id;
    if (r.required && ctx.role !== r.required && ctx.role !== 'admin') fail('FORBIDDEN');
    if (r.id && !UUID.test(r.id)) fail('NOT_FOUND');
    // A foreign tenant's release is indistinguishable from a missing one: existence is decided in the caller's
    // workspace before any proof or gate check that could answer 403 and confirm the id exists elsewhere.
    if ((r.name === 'activate' || r.name === 'suspend') && !await one(db, 'SELECT id FROM qc_releases WHERE workspace_id=? AND id=?', w, r.id)) fail('NOT_FOUND');
    if (request.method === 'GET') {
      if (r.name === 'status') {
        const selected = await callStore('activeRelease', db, w, now), missing = await callStore('missingGates', gatesOf(env));
        let readiness = null;
        if (env.QC_SERVICE_KEY && env.TEXPILOT_API_URL) try {
          const deadline_at = new Date(now + 8000).toISOString(), assertion = await issueQCAssertion(ctx, await sha256Hex(new Uint8Array()), requestId, now, { key: env.QC_SERVICE_KEY, kid: env.QC_SERVICE_KID, deadline_at });
          const answer = await sendQCToScanner(env, { path: 'readiness', assertion, deadline_at: Date.parse(deadline_at) }, env.QC_SEND ?? fetch);
          if (answer.ok) { const data = await answer.json(); if (!violation('Readiness', data)) readiness = data; }
        } catch { /* Truthful unavailable state, never synthetic readiness. */ }
        return json({ schema_version: '2', mode: selected ? 'AUTOMATIC' : 'REVIEW_ONLY', automation: { enabled: !!selected && missing.length === 0, missing_gates: missing }, readiness, scanner: readiness ? 'CONNECTED' : 'UNAVAILABLE', limits: LIMITS, role: ctx.role,
          can: { confirm_spec: ['purchase_manager','admin'].includes(ctx.role), create_sample: ['quality_inspector','admin'].includes(ctx.role), capture: ['quality_inspector','admin'].includes(ctx.role), adjudicate: ['supervisor','admin'].includes(ctx.role), manage_release: ctx.role === 'admin' } });
      }
      if (r.name === 'orders') return json({ items: await callStore('listPurchaseOrders', db, w) });
      if (r.name === 'consents') return json({ items: await callStore('listConsent', db, w, now) });
      if (r.name === 'samples') {
        const po = url.searchParams.get('purchase_order_id');
        if (po && !await one(db, 'SELECT id FROM supplier_purchase_orders WHERE workspace_id=? AND id=?', w, recordId(po))) fail('NOT_FOUND');
        return json({ items: await callStore('listSamples', db, w, po) });
      }
      if (r.name === 'getSample') return json(await callStore('loadResult', db, w, r.id, now));
      if (r.name === 'request') return json(await callStore('requestState', db, ctx, r.id, now));
      if (r.name === 'getSpec') {
        if ([...url.searchParams.keys()].some(k => k !== 'version')) fail('VALIDATION_FAILED');
        const versions = await all(db, 'SELECT version,json FROM qc_po_specs WHERE workspace_id=? AND id=? ORDER BY version', w, r.id);
        if (!versions.length) fail('NOT_FOUND');
        const raw = url.searchParams.get('version'), version = raw === null ? versions.at(-1).version : /^\d+$/.test(raw) ? Number(raw) : NaN;
        integer(version, 'Version'); const row = versions.find(v => v.version === version); if (!row) fail('NOT_FOUND');
        return json({ spec: JSON.parse(row.json), current: version === versions.at(-1).version, versions: versions.map(v => v.version) });
      }
      if (r.name === 'releases') { const rows = await all(db, 'SELECT * FROM qc_releases WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w); const active = rows.find(v => v.state === 'ACTIVE' && v.expires_at > now); return json({ items: await Promise.all(rows.map(row => callStore('releaseOf',row))), active_release_id: active?.id ?? null }); }
      if (r.name === 'original') {
        const capture = await one(db, 'SELECT * FROM qc_captures WHERE workspace_id=? AND id=?', w, r.id);
        if (!capture || capture.original_state !== 'AVAILABLE') fail('NOT_FOUND');
        if (!env.BUCKET) fail('SERVICE_UNAVAILABLE'); const object = await env.BUCKET.get(capture.object_key); if (!object) fail('NOT_FOUND');
        const bytes = await callStore('bodyBytes', object.body); if (await sha256Hex(bytes) !== capture.original_sha256) fail('SERVICE_UNAVAILABLE', ['AUDIT_UNAVAILABLE']);
        return new Response(bytes, { headers: { 'Content-Type': JSON.parse(capture.json).media_type, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
    }
    const key = request.headers.get('Idempotency-Key'); if (!UUID.test(key ?? '')) fail('VALIDATION_FAILED');
    let data, upload;
    if (r.name === 'upload') { upload = await readUpload(request); data = upload.meta; } else data = await readJson(request);
    const intervention = permit(ctx, data, r.required);
    const bodySha = await sha256Hex(canonicalJson(data)), idem = { key, route: request.method + ' ' + url.pathname, bodySha, requestId };
    const input = { idem, intervention };
    if (r.name === 'spec') {
      own(data, ['purchase_order_id','expected_spec_version','construction','allowed_fabric_labels','taxonomy_version','density','confirmation_reason','interventionReason']);
      recordId(data.purchase_order_id); if (data.expected_spec_version !== null) integer(data.expected_spec_version, 'Version');
      reason(data.confirmation_reason, 'Confirmation reason');
      if (!Array.isArray(data.density) || data.density.length !== 2) fail('VALIDATION_FAILED');
      for (const density of data.density) { own(density, ['axis','unit','target','lower','upper','candidate']); if (density.candidate != null) {
        own(density.candidate,['document_sha256','page','span','raw_value','raw_unit','ocr_confidence','candidate_id','corrects_id']);
        valid('Provenance',withDefaults('Provenance',{source:'OCR_CANDIDATE',source_id:data.purchase_order_id,source_version:'candidate',actor_id:null,observed_at:new Date(now).toISOString(),image_sha256:null,...density.candidate}));
      } }
      return reply(await callStore('confirmSpec', db, ctx, { ...data, ...input }, now));
    }
    if (r.name === 'consent') {
      own(data, ['authority_evidence_sha256','operational_capture','operational_retention_days','research_use','training_use','export_destinations','valid_from','expires_at']);
      return reply(await callStore('registerConsent', db, ctx, { ...data, ...input }, now));
    }
    if (r.name === 'selection') {
      own(data, ['purchase_order_id','plan_version','plan_sha256','randomization_seed','draw_index','selection_probability','cohort','independent_group_id','lot_ref','roll_ref','location_ref','face','planned_area_cm2','method','interventionReason']);
      const { interventionReason, ...fields } = data; return reply(await callStore('createSelection', db, ctx, { ...fields, ...input }, now));
    }
    if (r.name === 'sample') {
      own(data, ['selection_id','spec_id','spec_version','predecessor_sample_id','expected_predecessor_revision','reason','disposition','exclusion_reason','interventionReason']);
      recordId(data.selection_id); recordId(data.spec_id); integer(data.spec_version,'Version'); optionalId(data.predecessor_sample_id);
      if (data.expected_predecessor_revision != null) integer(data.expected_predecessor_revision,'Revision',0);
      if (data.reason != null) reason(data.reason); if (data.disposition && !['SELECTED','MISSING','EXCLUDED'].includes(data.disposition)) fail('VALIDATION_FAILED');
      if (['MISSING','EXCLUDED'].includes(data.disposition)) reason(data.exclusion_reason); else if (data.exclusion_reason != null) fail('VALIDATION_FAILED');
      return json(await callStore('createSampleEvaluation', db, ctx, { ...data, ...input }, now), 201);
    }
    if (r.name === 'set' || r.name === 'close') {
      own(data, ['expected_revision','interventionReason']); integer(data.expected_revision,'Revision',0);
      return reply(await callStore(r.name === 'set' ? 'createCaptureSet' : 'closeCaptureSet', db, ctx, { ...data, ...input, ...(r.name === 'set' ? {sample_id:r.id} : {capture_set_id:r.id}) }, now));
    }
    if (r.name === 'upload') {
      own(data, ['capture_id','role','expected_revision','sha256','taken_at','device_profile_id','calibration_id','consent_record_id','attestation','interventionReason']);
      recordId(data.capture_id); recordId(data.consent_record_id); integer(data.expected_revision,'Revision',0); valid('AcquisitionAttestation', data.attestation);
      // Missing and foreign IDs are indistinguishable; unusable local authority stays 403.
      if (!await one(db, 'SELECT id FROM qc_consent_authorities WHERE workspace_id=? AND id=?', w, data.consent_record_id)) fail('NOT_FOUND');
      await callStore('consentFor', db, w, data.consent_record_id, now);
      const set = await one(db, 'SELECT id FROM qc_capture_sets WHERE workspace_id=? AND id=?', w, r.id); if (!set) fail('NOT_FOUND');
      const totals = await all(db, 'SELECT json FROM qc_captures WHERE workspace_id=? AND capture_set_id=?', w, r.id);
      const duplicate = totals.some(c => JSON.parse(c.json).id === data.capture_id);
      if (!duplicate && totals.reduce((n,c) => n + JSON.parse(c.json).byte_size, upload.bytes.length) > LIMITS.max_set_bytes) fail('PAYLOAD_TOO_LARGE');
      if (await sha256Hex(upload.bytes) !== data.sha256) fail('VALIDATION_FAILED');
      const dimensions = imageDimensions(upload.bytes, upload.type);
      return reply(await callStore('addCapture', db, env.BUCKET, ctx, { ...input, capture_set_id:r.id, meta:data, bytes:upload.bytes, ...dimensions }, now));
    }
    if (r.name === 'analyze') {
      own(data, ['expected_revision','capture_set_id','interventionReason']); integer(data.expected_revision,'Revision',0); recordId(data.capture_set_id);
      // No request/decision is begun when a required private service setting is missing.
      if (!env.QC_SERVICE_KEY || !env.TEXPILOT_API_URL) fail('SERVICE_UNAVAILABLE', ['STAGE_UNAVAILABLE']);
      const begun = await callStore('beginRequest', db, ctx, idem, now);
      if (begun.replay) return reply(begun.replay);
      if (begun.pending) return json({ schema_version:'2',request_id:begun.pending.request_id,state:'IN_PROGRESS',status_url:`${PREFIX}/requests/${begun.pending.request_id}` },202);
      const started = begun.started;
      try {
        const prepared = await callStore('prepareAnalysis', db, env.BUCKET, ctx, { ...data, sample_id:r.id }, started, now);
        // Public capture metadata describes the encoded original. The private decoder requires
        // EXIF-upright raster dimensions; derive those from the same verified bytes before signing.
        for (const file of prepared.files) {
          const capture = prepared.request.captures.find(view => view.capture.id === file.id).capture;
          const {width,height} = imageDimensions(file.bytes,file.type,true);
          Object.assign(capture,{width,height});
        }
        const payload = canonicalJson(prepared.request), assertion = await issueQCAssertion(ctx, await sha256Hex(encoder.encode(payload)), started.request_id, nowOf(env), { key:env.QC_SERVICE_KEY,kid:env.QC_SERVICE_KID,deadline_at:prepared.request.context.deadline_at,request_generation:started.generation });
        const form = new FormData(); form.set('request',payload); for (const file of prepared.files) form.set(`capture_${file.id}`,new Blob([file.bytes],{type:file.type}),file.id);
        let answer;
        try { answer = await sendQCToScanner(env,{path:'analyze',body:form,assertion,deadline_at:started.deadline_at},env.QC_SEND ?? fetch); }
        catch (error) { fail(error?.name === 'TimeoutError' || nowOf(env) >= started.deadline_at ? 'DEADLINE_EXCEEDED' : 'SERVICE_UNAVAILABLE'); }
        if (nowOf(env) >= started.deadline_at) fail('DEADLINE_EXCEEDED');
        if (!answer.ok) fail(({429:'CAPACITY_LIMIT',503:'SERVICE_UNAVAILABLE',504:'DEADLINE_EXCEEDED',413:'PAYLOAD_TOO_LARGE',415:'UNSUPPORTED_MEDIA',422:'VALIDATION_FAILED'})[answer.status] ?? 'SERVICE_UNAVAILABLE');
        let candidate; try { candidate = await answer.json(); } catch { fail('SERVICE_UNAVAILABLE'); }
        await callStore('checkCandidate',candidate,prepared);
        await callStore('finalizeQC',db,ctx,{prepared,candidate,started},data.expected_revision,nowOf(env));
        // Replay returns the exact response stored in the finalising batch.
        return reply(await callStore('replayOf',db,ctx,idem));
      } catch (error) { await callStore('failRequest',db,started,error,nowOf(env)); throw error; }
    }
    if (r.name === 'adjudicate') {
      own(data,['expected_revision','outcome','reason','reference_ids','supersedes_id','interventionReason']); integer(data.expected_revision,'Revision',0); reason(data.reason); optionalId(data.supersedes_id);
      return reply(await callStore('appendAdjudication',db,ctx,{...data,...input,sample_id:r.id},now));
    }
    if (r.name === 'reauth') {
      own(data,['pin','payload_sha256']); if (!validPin(data.pin) || !/^[a-f\d]{64}$/.test(data.payload_sha256)) fail('VALIDATION_FAILED');
      const replay = await callStore('replayOf',db,ctx,idem); if (replay) return reply(replay);
      const user = await one(db,'SELECT * FROM users WHERE id=? AND workspace_id=?',ctx.user_id,w); if (!user || user.locked_until > now) fail('FORBIDDEN');
      if (await pinHash(data.pin,user.pin_salt) !== user.pin_hash) { const attempts = user.failed_attempts + 1, locked = attempts >= LOCK_AFTER; await query(db,'UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?',locked ? 0 : attempts,locked ? now + LOCK_MS : 0,user.id).run(); fail(locked ? 'CAPACITY_LIMIT' : 'FORBIDDEN'); }
      await query(db,'UPDATE users SET failed_attempts=0,locked_until=0 WHERE id=?',user.id).run();
      const begun = await callStore('beginRequest',db,ctx,idem,now);
      if (begun.replay) return reply(begun.replay);
      if (begun.pending) fail('CONFLICT');
      try {
        const body = await callStore('issueProof',db,ctx,data.payload_sha256,now,randomHex(32));
        return reply(await callStore('completeRequest',db,ctx,begun.started,200,body,nowOf(env)));
      } catch (error) { await callStore('failRequest',db,begun.started,error,nowOf(env)); throw error; }
    }
    if (r.name === 'release') {
      own(data,['version','domain','policy','bundle_sha256','calibration_sha256','statistics_report_sha256','operations_proof_sha256','monitoring_protocol_sha256','authority_record_sha256','independent_signatory','expires_at','predecessor_release_id','proof']);
      text(data.version,'Version',1,120); text(data.independent_signatory,'Signatory',1,120); valid('DomainManifest',data.domain); valid('Policy',data.policy);
      const {proof,...payload} = data; return reply(await callStore('registerRelease',db,ctx,{...data,...input,payloadSha:await sha256Hex(canonicalJson(payload))},now));
    }
    if (r.name === 'activate') { own(data,['proof']); return reply(await callStore('activateRelease',db,ctx,{...data,...input,id:r.id,gates:gatesOf(env),payloadSha:await sha256Hex(canonicalJson({release_id:r.id}))},now)); }
    if (r.name === 'suspend') { own(data,['reason']); reason(data.reason); return reply(await callStore('suspendRelease',db,ctx,{...data,...input,id:r.id},now)); }
    fail('NOT_FOUND');
  });
}

/** Streaming multipart parser: count each file before keeping its next chunk; never decode an unbounded body. */
async function readUpload(request) {
  const contentType = request.headers.get('Content-Type') ?? '', match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]{1,200})"|([^;\s]{1,200}))\s*$/i.exec(contentType);
  if (!match) fail(contentType.startsWith('multipart/') ? 'MALFORMED_REQUEST' : 'UNSUPPORTED_MEDIA');
  const boundary = match[1] ?? match[2], marker = encoder.encode('\r\n--' + boundary), start = encoder.encode('--' + boundary + '\r\n');
  const reader = request.body?.getReader(); if (!reader) fail('MALFORMED_REQUEST');
  let pending = new Uint8Array(), state = 'start', current = null, total = 0; const parts = new Map();
  const append = chunk => { const joined = new Uint8Array(pending.length + chunk.length); joined.set(pending); joined.set(chunk,pending.length); pending = joined; };
  const index = (bytes, needle) => { outer: for (let i=0;i<=bytes.length-needle.length;i++) { for(let j=0;j<needle.length;j++) if(bytes[i+j]!==needle[j]) continue outer; return i; } return -1; };
  const keep = bytes => { if (!bytes.length) return; current.size += bytes.length; if (current.size > (current.name === 'original' ? LIMITS.max_original_bytes : 65536)) fail('PAYLOAD_TOO_LARGE'); current.chunks.push(bytes.slice()); };
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (value) { total += value.length; if (total > LIMITS.max_original_bytes + 80000) fail('PAYLOAD_TOO_LARGE'); }
      for (let offset=0;offset<(value?.length ?? 1);offset+=65536) {
      if (value) append(value.subarray(offset,offset+65536));
      let progress = true;
      while (progress) {
        progress = false;
        if (state === 'start' && pending.length >= start.length) { if(index(pending,start)!==0) fail('MALFORMED_REQUEST'); pending=pending.slice(start.length); state='headers'; progress=true; }
        if (state === 'headers') {
          const end=index(pending,encoder.encode('\r\n\r\n'));
          if (end < 0) { if(pending.length>8192) fail('PAYLOAD_TOO_LARGE'); }
          else {
            const header=new TextDecoder('utf-8',{fatal:true}).decode(pending.slice(0,end)), disposition=/^Content-Disposition:\s*form-data;[^\r\n]*\bname="([^"]+)"/im.exec(header);
            if (!disposition || !['meta','original'].includes(disposition[1]) || parts.has(disposition[1])) fail('MALFORMED_REQUEST');
            const name=disposition[1], type=/^Content-Type:\s*([^\r\n;]+)/im.exec(header)?.[1].trim().toLowerCase();
            if (name==='original' && !/\bfilename="[^"]*"/.test(header)) fail('MALFORMED_REQUEST');
            if (name==='original' && !['image/jpeg','image/png','image/webp'].includes(type)) fail('UNSUPPORTED_MEDIA');
            current={name,type,chunks:[],size:0}; parts.set(name,current); pending=pending.slice(end+4); state='body'; progress=true;
          }
        }
        if (state === 'body') {
          const end=index(pending,marker);
          if(end>=0) { keep(pending.slice(0,end)); pending=pending.slice(end+marker.length); state='delimiter'; progress=true; }
          else if(pending.length>marker.length+2) { const count=pending.length-marker.length-2; keep(pending.slice(0,count)); pending=pending.slice(count); }
        }
        if(state==='delimiter' && pending.length>=2) {
          if(pending[0]===45&&pending[1]===45) { pending=pending.slice(2); state='done'; }
          else if(pending[0]===13&&pending[1]===10) { pending=pending.slice(2); state='headers'; progress=true; }
          else fail('MALFORMED_REQUEST');
        }
        if(state==='done' && pending.length>2) fail('MALFORMED_REQUEST');
      }
      }
      if(done) break;
    }
    if(state!=='done' || (pending.length && !(pending.length===2&&pending[0]===13&&pending[1]===10)) || parts.size!==2) fail('MALFORMED_REQUEST');
    const flatten = part => { const bytes=new Uint8Array(part.size); let offset=0; for(const chunk of part.chunks) { bytes.set(chunk,offset); offset+=chunk.length; } return bytes; };
    let meta; try { meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(flatten(parts.get('meta')))); } catch { fail('MALFORMED_REQUEST'); }
    return {meta,bytes:flatten(parts.get('original')),type:parts.get('original').type};
  } catch(error) { await reader.cancel().catch(()=>{}); if(error instanceof TypeError) fail('MALFORMED_REQUEST'); throw error; }
}
/** Header geometry bounds allocation; the private scanner still fully decodes the protected original. */
function imageDimensions(bytes, type, upright = false) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), ascii=(at,n)=>new TextDecoder().decode(bytes.slice(at,at+n));
  let width,height,mediaType;
  if(bytes.length>=33&&ascii(1,3)==='PNG'&&bytes[0]===137&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10) {
    mediaType='image/png'; if(ascii(12,4)!=='IHDR'||view.getUint32(8)!==13) fail('VALIDATION_FAILED'); width=view.getUint32(16); height=view.getUint32(20);
    let at=8,ended=false,hasData=false;
    while(at+12<=bytes.length) { const size=view.getUint32(at),tag=ascii(at+4,4); if(size>bytes.length-at-12) fail('VALIDATION_FAILED'); if(tag==='acTL') fail('UNSUPPORTED_MEDIA'); if(tag==='IDAT') hasData=true; at+=size+12; if(tag==='IEND') {ended=at===bytes.length;break;} }
    if(!ended||!hasData) fail('VALIDATION_FAILED');
  } else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216) {
    mediaType='image/jpeg'; if(bytes.at(-2)!==255||bytes.at(-1)!==217) fail('VALIDATION_FAILED'); let at=2,orientation=1;
    while(at+4<=bytes.length) { if(bytes[at++]!==255) fail('VALIDATION_FAILED'); while(bytes[at]===255)at++; const tag=bytes[at++]; if(tag===218||tag===217)break; if(tag===1||(tag>=208&&tag<=215))continue; const size=view.getUint16(at); if(size<2||at+size>bytes.length)fail('VALIDATION_FAILED'); if(upright&&tag===225&&size>=8&&ascii(at+2,6)==='Exif\0\0')orientation=exifOrientation(view,at+8,at+size); if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(tag)) { if(size<8)fail('VALIDATION_FAILED');height=view.getUint16(at+3);width=view.getUint16(at+5); } at+=size; }
    // Scanner decodes EXIF-upright pixels; metadata must describe that raster, retaining raw bytes.
    if(orientation>=5&&orientation<=8)[width,height]=[height,width];
  } else if(bytes.length>=20&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP') {
    mediaType='image/webp'; if(view.getUint32(4,true)+8!==bytes.length)fail('VALIDATION_FAILED'); let at=12,frames=0;
    while(at+8<=bytes.length) { const tag=ascii(at,4),size=view.getUint32(at+4,true),p=at+8; if(size>bytes.length-p)fail('VALIDATION_FAILED');
      if(tag==='ANIM'||tag==='ANMF')fail('UNSUPPORTED_MEDIA');
      if(tag==='VP8X') { if(size<10||(bytes[p]&2))fail('UNSUPPORTED_MEDIA'); width=1+bytes[p+4]+(bytes[p+5]<<8)+(bytes[p+6]<<16); height=1+bytes[p+7]+(bytes[p+8]<<8)+(bytes[p+9]<<16); }
      if(tag==='VP8 ') { frames++;if(size<10||bytes[p+3]!==157||bytes[p+4]!==1||bytes[p+5]!==42)fail('VALIDATION_FAILED');width=view.getUint16(p+6,true)&16383;height=view.getUint16(p+8,true)&16383; }
      if(tag==='VP8L') { frames++;if(size<5||bytes[p]!==47)fail('VALIDATION_FAILED');const bits=view.getUint32(p+1,true);width=1+(bits&16383);height=1+((bits>>>14)&16383); }
      at=p+size+(size%2);
    }
    if(frames!==1||at!==bytes.length)fail('VALIDATION_FAILED');
  } else fail('UNSUPPORTED_MEDIA');
  if(mediaType!==type)fail('UNSUPPORTED_MEDIA');
  if(!(width>0&&height>0))fail('VALIDATION_FAILED'); if(width*height>LIMITS.max_decoded_pixels)fail('PAYLOAD_TOO_LARGE');
  return {width,height,mediaType};
}
/** Read only TIFF IFD0's orientation inside the bounded JPEG APP1 segment. */
function exifOrientation(view,start,end) {
  const fits=(at,size)=>at>=start&&at+size<=end;
  if(!fits(start,8))fail('VALIDATION_FAILED');
  const order=view.getUint16(start),little=order===0x4949;
  if((!little&&order!==0x4d4d)||view.getUint16(start+2,little)!==42)fail('VALIDATION_FAILED');
  const directory=start+view.getUint32(start+4,little);
  if(!fits(directory,2))fail('VALIDATION_FAILED');
  const count=view.getUint16(directory,little);
  if(!fits(directory+2,count*12))fail('VALIDATION_FAILED');
  for(let i=0;i<count;i++) {
    const entry=directory+2+i*12;
    if(view.getUint16(entry,little)!==0x0112)continue;
    if(view.getUint16(entry+2,little)!==3||view.getUint32(entry+4,little)!==1)fail('VALIDATION_FAILED');
    const value=view.getUint16(entry+8,little);
    return value>=1&&value<=8?value:1;
  }
  return 1;
}
