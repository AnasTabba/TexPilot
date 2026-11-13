import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendQCToScanner } from '../server/scanner-proxy.mjs';

test('QC scanner transport uses a fixed upstream, refuses redirects and strips browser credentials', async () => {
  let seen;
  const upstreamSendDouble = async request => { seen = request; return new Response('{}'); };
  await sendQCToScanner({ TEXPILOT_API_URL:'https://scanner.test/untrusted/path', TEXPILOT_API_TOKEN:'provider-double' }, { path:'analyze', body:new FormData(), assertion:'signed-double', deadline_at:Date.now()+1000 }, upstreamSendDouble);
  assert.equal(seen.url,'https://scanner.test/api/v2/qc/analyze'); assert.equal(seen.headers.get('Cookie'),null); assert.equal(seen.headers.get('Authorization'),'Bearer provider-double'); assert.equal(seen.headers.get('X-QC-Assertion'),'signed-double'); assert.equal(seen.redirect,'manual');
  await assert.rejects(sendQCToScanner({TEXPILOT_API_URL:'https://scanner.test'}, {path:'analyze',body:new FormData(),assertion:'double',deadline_at:Date.now()+1000}, async function redirectDouble() { return new Response(null,{status:302,headers:{Location:'https://foreign.test'}}); }));
});

import { portalFixture } from './portal-fixture.mjs';
import worker from '../server/cloudflare.mjs';
import { canonicalJson, sha256Hex, contentSha256, HASH_EXCLUDES, violation } from '../server/qc-contract.mjs';
import { readFileSync } from 'node:fs';
const uuid = () => crypto.randomUUID(), H = 'a'.repeat(64), ORIGIN = 'https://yarnflow.test';
const image = new Uint8Array(readFileSync(new URL('../../scanner/tests/fixtures/qc-images/swatch.png', import.meta.url)));
const validFixtures = JSON.parse(readFileSync(new URL('../../scanner/tests/fixtures/qc-v2/valid.json', import.meta.url)));
const example = type => structuredClone(validFixtures.find(f => f.type === type).value);
const counts = sql => Object.fromEntries(['balances','movements','stock_deltas','claims','goods_receipts','qc_inspections'].map(t => [t,sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
const rows = sql => Object.fromEntries(['qc_decisions','qc_evidence','qc_decision_events'].map(t => [t,sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
function ok(r, status = 200) { assert.equal(r.status,status,JSON.stringify(r.data)); return r.data; }
async function setupQC() {
  const f = await portalFixture();
  await f.person('Inspector Double','quality_inspector'); await f.person('Purchaser Double','purchase_manager'); await f.person('Reviewer Double','supervisor');
  const supplier = await f.insertSupplier({status:'approved'}), {orderId} = await f.insertPO({supplierId:supplier});
  const cookies = {};
  for(const name of ['Anas','Inspector Double','Purchaser Double','Reviewer Double']) cookies[name] = (await f.login(name)).cookie;
  async function call(path,body,name='Inspector Double',options={}) {
    const headers={Origin:ORIGIN,Cookie:cookies[name],'Idempotency-Key':options.key??uuid(),...options.headers};
    if(!(body instanceof FormData)) headers['Content-Type']??='application/json';
    const response=await worker.fetch(new Request(ORIGIN+'/api/qc/v2'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})}),f.env);
    return {status:response.status,data:response.headers.get('Content-Type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer()),headers:response.headers};
  }
  const specBody={purchase_order_id:orderId,expected_spec_version:null,construction:'woven',allowed_fabric_labels:['plain'],taxonomy_version:'test-double-taxonomy',density:['ends','picks'].map(axis=>({axis,unit:'count/in',target:80,lower:70,upper:90,candidate:null})),confirmation_reason:'Confirmed only for API test double'};
  const spec=ok(await call('/specs',specBody,'Purchaser Double'),201);
  const selection=ok(await call('/selections',{purchase_order_id:orderId,plan_version:'test-double-plan',plan_sha256:null,randomization_seed:null,draw_index:null,selection_probability:null,cohort:'OPERATIONAL',independent_group_id:uuid(),lot_ref:'test-double-lot',roll_ref:'test-double-roll',location_ref:'test-double-location',face:'face',planned_area_cm2:100,method:'test-double-manual'}),201);
  const sample=ok(await call('/samples',{selection_id:selection.id,spec_id:spec.id,spec_version:1,predecessor_sample_id:null,expected_predecessor_revision:null,reason:null}),201);
  const consent=ok(await call('/consent-authorities',{authority_evidence_sha256:H,operational_capture:true,operational_retention_days:1,research_use:false,training_use:false,export_destinations:[],valid_from:new Date(Date.now()-10000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()},'Anas'),201);
  let current=sample;
  async function newSet() { current=ok(await call(`/samples/${sample.sample.id}`)); current=ok(await call(`/samples/${sample.sample.id}/capture-sets`,{expected_revision:current.revision}),201); return current.capture_sets.find(s=>s.state==='OPEN'); }
  async function upload(set,role,options={}) {
    const bytes=options.bytes??image,hash=await sha256Hex(bytes),meta={capture_id:options.capture_id??uuid(),role,expected_revision:options.expected_revision??current.revision,sha256:hash,taken_at:new Date().toISOString(),device_profile_id:'test-double-device',calibration_id:null,consent_record_id:options.consent_record_id??consent.id,attestation:{image_sha256:hash,capture_mode:'IMPORTED',device_model:null,lens_id:null,zoom_factor:null,focus_mode:null,exposure_mode:null,resolution:null,orientation:null,processing:null,captured_at:new Date().toISOString()},...options.meta};
    const form=new FormData(); form.set('meta',JSON.stringify(meta)); form.set('original',new Blob([bytes],{type:options.type??'image/png'}),'swatch.png');
    const result=await call(`/capture-sets/${set.id}/captures`,form,options.name??'Inspector Double',{key:options.key}); if(result.status<300) current=result.data;
    return {...result,meta};
  }
  async function closedSet() {const set=await newSet();for(const role of ['overview','structure','scale'])ok(await upload(set,role),201);current=ok(await call(`/capture-sets/${set.id}/close`,{expected_revision:current.revision}));return set;}
  return {...f,call,spec,specBody,selection,sample,consent,newSet,upload,closedSet,cookies,get current(){return current;}};
}
/** An explicit scanner test double; no result from it is evidence of a trained artifact or external gate. */
async function candidateDouble(request, automatic=false) {
  const evidence=example('Evidence'); evidence.id=uuid();evidence.sample_id=request.sample_id;evidence.capture_ids=request.captures.map(c=>c.capture.id);evidence.spec_sha256=request.spec.content_sha256;evidence.domain_id=request.domain?.id??null;evidence.created_at=request.context.evaluated_at;
  for(const stage of ['quality','fabric','defects','metrology','domain'])evidence[stage]={state:'DISABLED',value:null,reasons:[stage==='domain'?'DOMAIN_UNVALIDATED':'STAGE_UNAVAILABLE'],artifact_sha256:null,duration_ms:0};
  evidence.manifest_sha256=await contentSha256(evidence,HASH_EXCLUDES.Evidence);
  const candidate={evidence,draft:{status:automatic?'ACCEPT':'MANUAL_REVIEW',automatic,reasons:automatic?[]:['STAGE_UNAVAILABLE'],scope:'INSPECTED_SAMPLE'},binding:{spec_sha256:request.spec.content_sha256,policy_sha256:request.policy.sha256,release_sha256:request.release?.sha256??null,capture_sha256s:request.captures.map(c=>c.verified_sha256),attempt:request.attempt,expected_revision:request.expected_revision,request_id:request.context.request_id,request_generation:request.context.request_generation,deadline_at:request.context.deadline_at}};
  assert.equal(violation('AnalysisCandidate',candidate),null);return candidate;
}
function upstreamDouble(env, mutate=async()=>{},automatic=false) {
  env.TEXPILOT_API_URL='https://scanner.test';env.QC_SERVICE_KEY='qc-service-test-double-key';
  env.QC_SEND=async function scannerSendDouble(httpRequest) {const form=await httpRequest.formData(),request=JSON.parse(form.get('request'));assert.equal(httpRequest.headers.get('Cookie'),null);await mutate(request);return Response.json(await candidateDouble(request,automatic));};
}
async function insertedReleaseDouble(f) {
  const domain=example('DomainManifest'),policy=example('Policy'); policy.mode='AUTOMATIC';policy.sha256=await contentSha256(policy,HASH_EXCLUDES.Policy);
  const release=example('Release');release.id=uuid();release.workspace_id=f.workspaceId;release.state='ACTIVE';release.domain_sha256=domain.sha256;release.policy_sha256=policy.sha256;release.operations_proof_sha256=H;release.monitoring_protocol_sha256=H;release.expires_at=new Date(Date.now()+10000).toISOString();release.sha256=await contentSha256(release,HASH_EXCLUDES.Release);
  f.sql.prepare("INSERT INTO qc_releases(workspace_id,id,state,sha256,json,domain_json,policy_json,expires_at,created_by,created_at,updated_at) VALUES(?,?,'STATISTICAL_CANDIDATE',?,?,?,?,?,?,?,?)").run(f.workspaceId,release.id,release.sha256,JSON.stringify(release),JSON.stringify(domain),JSON.stringify(policy),Date.parse(release.expires_at),f.adminId,Date.now(),Date.now());
  f.sql.prepare("UPDATE qc_releases SET state='ACTIVE' WHERE workspace_id=? AND id=?").run(f.workspaceId,release.id);
  return release;
}

test('complete sample upload/close/analyze/replay preserves originals and all ERP row counts',async()=>{
  const f=await setupQC(),set=await f.closedSet(),before=counts(f.sql); upstreamDouble(f.env);
  const key=uuid(),body={expected_revision:f.current.revision,capture_set_id:set.id};
  const result=ok(await f.call(`/samples/${f.sample.sample.id}/analyze`,body,'Inspector Double',{key}));assert.equal(result.decision.status,'MANUAL_REVIEW');assert.equal(result.mode,'REVIEW_ONLY');assert.deepEqual(counts(f.sql),before);
  assert.deepEqual(ok(await f.call(`/samples/${f.sample.sample.id}/analyze`,body,'Inspector Double',{key})),result);
  const request=f.sql.prepare('SELECT request_id FROM qc_idempotency WHERE client_key=?').get(key);assert.equal(ok(await f.call('/requests/'+request.request_id)).state,'COMPLETED');assert.deepEqual(counts(f.sql),before);
  const original=await f.call(`/captures/${result.captures[0].id}/original`);assert.deepEqual(original.data,image);assert.equal(original.headers.get('Cache-Control'),'private,no-store');
});

test('duplicate upload and concurrent close advance neither revision nor attempt twice; fourth set is refused',async()=>{
  const f=await setupQC();let last;
  for(let attempt=1;attempt<=3;attempt++){
    const set=await f.newSet(),first=await f.upload(set,'overview'),rev=f.current.revision;ok(first,201);
    const again=await f.upload(set,'overview',{capture_id:first.meta.capture_id,expected_revision:first.meta.expected_revision,meta:{taken_at:first.meta.taken_at,attestation:first.meta.attestation}});ok(again);assert.equal(f.current.revision,rev);
    for(const role of ['structure','scale'])ok(await f.upload(set,role),201);
    const key=uuid(),body={expected_revision:f.current.revision};const results=await Promise.all([f.call(`/capture-sets/${set.id}/close`,body,'Inspector Double',{key}),f.call(`/capture-sets/${set.id}/close`,body,'Inspector Double',{key})]);for(const result of results)ok(result);assert.equal(results[0].data.family.attempts_used,attempt);
    last=ok(await f.call(`/samples/${f.sample.sample.id}`));
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM qc_capture_sets WHERE state='CLOSED'").get().n,3);
  const refused=await f.call(`/samples/${f.sample.sample.id}/capture-sets`,{expected_revision:last.revision});assert.equal(refused.status,409);assert.ok(refused.data.error.reasons.includes('RECAPTURE_LIMIT'));
});

for(const race of ['spec','release-suspend','release-expire','logout','pin-reset','deactivate','role-change','session-expire','deadline'])test(`analysis ${race} race commits zero evidence, decisions and events`,async()=>{
  const f=await setupQC(),set=await f.closedSet();let release;
  if(race.startsWith('release'))release=await insertedReleaseDouble(f);
  const before=rows(f.sql),erp=counts(f.sql),actor=f.sql.prepare("SELECT id FROM users WHERE name='Inspector Double'").get().id;
  upstreamDouble(f.env,async request=>{
    if(race==='spec')ok(await f.call('/specs',{...f.specBody,expected_spec_version:1},'Purchaser Double'),201);
    if(race==='release-suspend')ok(await f.call(`/releases/${release.id}/suspend`,{reason:'Containment during test double inference'},'Anas'));
    if(race==='release-expire')f.env.QC_NOW=()=>Date.parse(release.expires_at);
    if(race==='logout')f.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(actor);
    if(race==='pin-reset')f.sql.prepare("UPDATE users SET pin_hash='reset-test-double' WHERE id=?").run(actor);
    if(race==='deactivate')f.sql.prepare("UPDATE users SET deactivated_at=? WHERE id=?").run(Date.now(),actor);
    if(race==='role-change')f.sql.prepare("UPDATE users SET portal_role='dispatch' WHERE id=?").run(actor);
    if(race==='session-expire')f.sql.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(Date.now()-1,actor);
    if(race==='deadline')f.env.QC_NOW=()=>Date.parse(request.context.deadline_at);
  });
  const key=uuid(),body={expected_revision:f.current.revision,capture_set_id:set.id};const result=await f.call(`/samples/${f.sample.sample.id}/analyze`,body,'Inspector Double',{key});
  assert.equal(result.status,race==='deadline'?504:409,JSON.stringify(result.data));
  const after=rows(f.sql);assert.equal(after.qc_decisions,before.qc_decisions);assert.equal(after.qc_evidence,before.qc_evidence);assert.equal(after.qc_decision_events,before.qc_decision_events+(['spec','release-suspend'].includes(race)?1:0));assert.deepEqual(counts(f.sql),erp);
  if(race==='deadline'){assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE client_key=?').get(key).state,'EXPIRED');assert.equal((await f.call(`/samples/${f.sample.sample.id}/analyze`,body,'Inspector Double',{key})).status,504);}
});

for(const status of [429,503,504,'transport'])test(`upstream ${status} returns its failure without any committed decision`,async()=>{
  const f=await setupQC(),set=await f.closedSet(),before=rows(f.sql),erp=counts(f.sql);upstreamDouble(f.env);
  f.env.QC_SEND=async function failureDouble(){if(status==='transport')throw new Error('private upstream internals');return new Response('{}',{status});};
  const result=await f.call(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id});assert.equal(result.status,status==='transport'?503:status);assert.deepEqual(rows(f.sql),before);assert.deepEqual(counts(f.sql),erp);assert.ok(!JSON.stringify(result.data).includes('private'));
});

test('automatic ACCEPT test double persists only with a Worker-selected ACTIVE release',async()=>{
  for(const active of [false,true]){const f=await setupQC(),set=await f.closedSet(),before=rows(f.sql),erp=counts(f.sql);if(active)await insertedReleaseDouble(f);upstreamDouble(f.env,undefined,true);
    const result=await f.call(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id});assert.equal(result.status,active?200:503,JSON.stringify(result.data));if(active){assert.equal(result.data.decision.automatic,true);assert.equal(result.data.decision.status,'ACCEPT');}else assert.deepEqual(rows(f.sql),before);assert.deepEqual(counts(f.sql),erp);
  }
});

test('upload limits, consent, hash, magic bytes and pixel bounds fail before any object is stored',async()=>{
  const f=await setupQC(),set=await f.newSet(),before=rows(f.sql),objects=f.storage.size;
  for(const [file,type,status] of [['fake.heic','image/heic',415],['truncated-14.jpg','image/jpeg',422],['over-pixel-limit.png','image/png',413],['animated.webp','image/webp',415]]){
    const bytes=new Uint8Array(readFileSync(new URL('../../scanner/tests/fixtures/qc-images/'+file,import.meta.url)));
    assert.equal((await f.upload(set,'overview',{bytes,type})).status,status,file);assert.equal(f.storage.size,objects);assert.deepEqual(rows(f.sql),before);
  }
  assert.equal((await f.upload(set,'overview',{consent_record_id:uuid()})).status,403);assert.equal(f.storage.size,objects);
  assert.equal((await f.upload(set,'overview',{meta:{sha256:'0'.repeat(64)}})).status,422);assert.equal(f.storage.size,objects);
  assert.equal((await f.upload(set,'overview',{bytes:new Uint8Array(12*1024*1024+1)})).status,413);assert.equal(f.storage.size,objects);
  f.sql.prepare('UPDATE qc_consent_authorities SET withdrawn_at=? WHERE id=?').run(Date.now(),f.consent.id);
  assert.equal((await f.upload(set,'overview')).status,403);assert.equal(f.storage.size,objects);
});

test('bounded multipart uploads retain byte-identical JPEG, PNG, WebP and EXIF originals',async()=>{
  const f=await setupQC(),set=await f.newSet();
  for(const [file,type,role] of [['swatch-exif6.jpg','image/jpeg','overview'],['swatch.png','image/png','structure'],['swatch.webp','image/webp','scale']]){
    const bytes=new Uint8Array(readFileSync(new URL('../../scanner/tests/fixtures/qc-images/'+file,import.meta.url))),result=ok(await f.upload(set,role,{bytes,type}),201),capture=result.captures.find(c=>c.role===role);
    assert.equal(capture.width,640);assert.equal(capture.height,480);assert.deepEqual(ok(await f.call(`/captures/${capture.id}/original`)),bytes);
  }
});

test('open/stale capture sets and missing service configuration never invoke scanner or create decision rows',async()=>{
  const f=await setupQC(),set=await f.newSet();let calls=0;upstreamDouble(f.env);f.env.QC_SEND=async function forbiddenCallDouble(){calls++;throw Error('must not call');};
  const analyze=()=>f.call(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id});
  assert.equal((await analyze()).status,409);assert.equal(calls,0);
  delete f.env.QC_SERVICE_KEY;assert.equal((await analyze()).status,503);assert.equal(calls,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_decisions').get().n,0);
});

test('new-spec linked evaluations preserve the immutable history and family attempts',async()=>{
  const f=await setupQC(),set=await f.closedSet();upstreamDouble(f.env);const old=ok(await f.call(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id}));
  const next=ok(await f.call('/specs',{...f.specBody,expected_spec_version:1},'Purchaser Double'),201),before=rows(f.sql);
  assert.equal((await f.call(`/samples/${old.sample.id}/analyze`,{expected_revision:old.revision,capture_set_id:set.id})).status,409);assert.deepEqual(rows(f.sql),before);
  const linked=ok(await f.call('/samples',{selection_id:f.selection.id,spec_id:next.id,spec_version:2,predecessor_sample_id:old.sample.id,expected_predecessor_revision:old.revision,reason:'Reevaluate under the newly confirmed requirements'}),201);
  assert.equal(linked.family.attempts_used,1);assert.equal(linked.family.predecessor_sample_id,old.sample.id);assert.equal(linked.sample.spec_version,2);
  const historical=ok(await f.call(`/samples/${old.sample.id}`));assert.deepEqual(historical.decision,old.decision);assert.equal(historical.family.spec_is_current,false);assert.deepEqual(historical.family.successor_sample_ids,[linked.sample.id]);
});

test('adjudications append and supersede without rewriting model decisions; admin needs a separate intervention reason',async()=>{
  const f=await setupQC(),set=await f.closedSet();upstreamDouble(f.env);let current=ok(await f.call(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id}));const model=current.decision,erp=counts(f.sql),path=`/samples/${current.sample.id}/adjudications`;
  current=ok(await f.call(path,{expected_revision:current.revision,outcome:'UNDETERMINED',reason:'Physical reference still needs a second observer',reference_ids:['test-double-reference-a'],supersedes_id:null},'Reviewer Double'),201);const first=current.current_human_disposition;
  assert.equal((await f.call(path,{expected_revision:current.revision,outcome:'CONFORMING',reason:'The physical counter confirmed these requirements',reference_ids:[],supersedes_id:first.id},'Anas')).status,403);
  current=ok(await f.call(path,{expected_revision:current.revision,outcome:'CONFORMING',reason:'The physical counter confirmed these requirements',reference_ids:['test-double-reference-b'],supersedes_id:first.id,interventionReason:'Supervisor is unavailable for the recorded physical finding'},'Anas'),201);
  assert.equal(current.adjudications.length,2);assert.equal(current.current_human_disposition.supersedes_id,first.id);assert.ok(current.current_human_disposition.intervention_reason);assert.deepEqual(current.decision,model);assert.deepEqual(counts(f.sql),erp);
  assert.equal((await f.call(path,{expected_revision:current.revision-1,outcome:'UNDETERMINED',reason:'Stale result should never overwrite the new result',reference_ids:[],supersedes_id:first.id},'Reviewer Double')).status,409);
});

test('reauth proof is idempotent; candidates need fresh payload-bound proofs and activation needs all gates',async()=>{
  const f=await setupQC(),domain=example('DomainManifest'),policy=example('Policy');policy.mode='AUTOMATIC';policy.sha256=await contentSha256(policy,HASH_EXCLUDES.Policy);
  const body={version:'test-double-release',domain,policy,bundle_sha256:H,calibration_sha256:H,statistics_report_sha256:H,operations_proof_sha256:H,monitoring_protocol_sha256:H,authority_record_sha256:H,independent_signatory:'Independent Signatory Double',expires_at:new Date(Date.now()+86400000).toISOString(),predecessor_release_id:null};
  assert.equal((await f.call('/releases',body,'Anas')).status,403);
  const reauthBody={pin:'2468',payload_sha256:await sha256Hex(canonicalJson(body))},key=uuid(),fresh=ok(await f.call('/reauth',reauthBody,'Anas',{key}));
  assert.deepEqual(ok(await f.call('/reauth',reauthBody,'Anas',{key})),fresh);
  const candidate=ok(await f.call('/releases',{...body,proof:fresh.proof},'Anas'),201);assert.equal(candidate.state,'STATISTICAL_CANDIDATE');
  assert.equal((await f.call('/releases',{...body,version:'changed-test-double',proof:fresh.proof},'Anas')).status,403);
  assert.equal((await f.call(`/releases/${candidate.id}/activate`,{},'Anas')).status,403);
  f.env.QC_AUTOMATION_GATES=JSON.stringify(Object.fromEntries(Array.from({length:8},(_,i)=>['G'+(i+1),H])));
  assert.equal((await f.call(`/releases/${candidate.id}/activate`,{},'Anas')).status,403);
  const activation=ok(await f.call('/reauth',{pin:'2468',payload_sha256:await sha256Hex(canonicalJson({release_id:candidate.id}))},'Anas'));
  assert.equal(ok(await f.call(`/releases/${candidate.id}/activate`,{proof:activation.proof},'Anas')).state,'ACTIVE');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_releases').get().n,1);
});

test('same live analysis key returns 202; actor-only request polling and held response resolve once',async()=>{
  const f=await setupQC(),set=await f.closedSet();let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});upstreamDouble(f.env,async()=>{entered();await held;});
  const key=uuid(),body={expected_revision:f.current.revision,capture_set_id:set.id},first=f.call(`/samples/${f.sample.sample.id}/analyze`,body,'Inspector Double',{key});await started;
  const pending=ok(await f.call(`/samples/${f.sample.sample.id}/analyze`,body,'Inspector Double',{key}),202);assert.equal(pending.state,'IN_PROGRESS');assert.equal(ok(await f.call('/requests/'+pending.request_id)).state,'IN_PROGRESS');assert.equal((await f.call('/requests/'+pending.request_id,undefined,'Anas')).status,404);
  release();ok(await first);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_decisions').get().n,1);
});

test('credential is rechecked inside final batch and audit insertion failure rolls everything back',async()=>{
  for(const fault of ['logout-before-batch','audit-failure']){
    const f=await setupQC(),set=await f.closedSet(),before=rows(f.sql),erp=counts(f.sql);upstreamDouble(f.env);
    if(fault==='audit-failure')f.sql.exec("CREATE TRIGGER qc_test_double_audit_failure BEFORE INSERT ON qc_decision_events WHEN NEW.event='decision.committed' BEGIN SELECT RAISE(ABORT,'test double unavailable');END");
    else {const original=f.env.DB.batch;f.env.DB.batch=async function batchDouble(statements){if(statements.length>5&&f.sql.prepare("SELECT 1 FROM qc_idempotency WHERE state='IN_PROGRESS'").get())f.sql.prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE name='Inspector Double')").run();return original(statements);};}
    const result=await f.call(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id});assert.equal(result.status,fault==='audit-failure'?503:409);assert.deepEqual(rows(f.sql),before);assert.deepEqual(counts(f.sql),erp);
  }
});

test('foreign tenant identifiers are invisible for every object endpoint and mutation family',async()=>{
  const f=await setupQC(),set=await f.closedSet(),foreign=uuid(),row=await import('../server/auth.mjs').then(m=>m.userRow({workspaceId:foreign,name:'Foreign Inspector Double',pin:'2468',role:'quality_inspector'}));f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(foreign,'Foreign workspace double',Date.now());f.sql.prepare(row.sql).run(...row.args);
  const login=await f.login('Foreign Inspector Double');f.cookies['Foreign Inspector Double']=login.cookie;
  const foreignCall=(path,body)=>f.call(path,body,'Foreign Inspector Double');
  for(const path of [`/samples/${f.sample.sample.id}`,`/specs/${f.spec.id}`,`/captures/${f.current.captures[0].id}/original`,`/samples?purchase_order_id=${f.spec.purchase_order_id}`])assert.equal((await foreignCall(path)).status,404,path);
  for(const [path,body] of [[`/samples/${f.sample.sample.id}/capture-sets`,{expected_revision:f.current.revision}],[`/capture-sets/${set.id}/close`,{expected_revision:f.current.revision}],['/samples',{selection_id:f.selection.id,spec_id:f.spec.id,spec_version:1,predecessor_sample_id:null,expected_predecessor_revision:null,reason:null}]])assert.equal((await foreignCall(path,body)).status,404,path);
  upstreamDouble(f.env);assert.equal((await foreignCall(`/samples/${f.sample.sample.id}/analyze`,{expected_revision:f.current.revision,capture_set_id:set.id})).status,404);
});

test('OCR provenance survives immutable spec versions and candidate fields are strictly validated',async()=>{
  const f=await setupQC(),candidate={document_sha256:H,page:2,span:[10,20],raw_value:'31.5',raw_unit:'count/cm',ocr_confidence:0.7,candidate_id:uuid(),corrects_id:uuid()},body={...f.specBody,expected_spec_version:1,density:f.specBody.density.map(d=>({...d,candidate}))};
  const spec=ok(await f.call('/specs',body,'Purchaser Double'),201);assert.equal(spec.version,2);assert.equal(spec.density[0].provenance.document_sha256,H);assert.equal(spec.density[0].provenance.raw_unit,'count/cm');assert.equal(spec.density[0].provenance.corrects_id,candidate.corrects_id);
  assert.equal(ok(await f.call(`/specs/${spec.id}?version=1`)).spec.version,1);
  assert.equal((await f.call('/specs',{...body,expected_spec_version:2,density:body.density.map(d=>({...d,candidate:{...candidate,workspace_id:uuid()}}))},'Purchaser Double')).status,422);
});

test('fresh proofs reject wrong payload, another session, expiration and reuse',async()=>{
  for(const failure of ['payload','session','expired','reused']){
    const f=await setupQC(),domain=example('DomainManifest'),policy=example('Policy');policy.mode='AUTOMATIC';policy.sha256=await contentSha256(policy,HASH_EXCLUDES.Policy);
    const body={version:'test-double-'+failure,domain,policy,bundle_sha256:H,calibration_sha256:H,statistics_report_sha256:H,operations_proof_sha256:H,monitoring_protocol_sha256:H,authority_record_sha256:H,independent_signatory:'Independent Signatory Double',expires_at:new Date(Date.now()+86400000).toISOString(),predecessor_release_id:null};
    const proof=ok(await f.call('/reauth',{pin:'2468',payload_sha256:await sha256Hex(canonicalJson(body))},'Anas'));
    if(failure==='session')f.cookies.Anas=(await f.login('Anas')).cookie;
    if(failure==='expired')f.env.QC_NOW=()=>Date.now()+5*60000;
    if(failure==='reused')ok(await f.call('/releases',{...body,proof:proof.proof},'Anas'),201);
    const before=f.sql.prepare('SELECT COUNT(*) AS n FROM qc_releases').get().n,result=await f.call('/releases',{...body,...(failure==='payload'?{version:'different-test-double'}:{}),proof:proof.proof},'Anas');assert.equal(result.status,403,JSON.stringify(result.data));assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_releases').get().n,before);
  }
});

test('foreign consent and release ids stay invisible, including mutations',async()=>{
  const f=await setupQC(),set=await f.newSet();
  const foreign=uuid(),row=await import('../server/auth.mjs').then(m=>m.userRow({workspaceId:foreign,name:'Foreign Admin Double',pin:'2468',role:'admin'}));f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(foreign,'Foreign admin workspace double',Date.now());f.sql.prepare(row.sql).run(...row.args);f.cookies['Foreign Admin Double']=(await f.login('Foreign Admin Double')).cookie;
  const release=await insertedReleaseDouble(f);
  for(const [suffix,body]of [['activate',{}],['suspend',{reason:'Foreign release must stay invisible'}]])assert.equal((await f.call(`/releases/${release.id}/${suffix}`,body,'Foreign Admin Double')).status,404);
  f.sql.prepare('INSERT INTO qc_consent_authorities(workspace_id,id,operational_capture,retention_days,valid_from,expires_at,json,created_by,created_at) VALUES(?,?,1,1,?,?,?, ?,?)').run(foreign,uuid(),Date.now()-1000,Date.now()+86400000,'{}',row.args[0],Date.now());
  const foreignConsent=f.sql.prepare('SELECT id FROM qc_consent_authorities WHERE workspace_id=?').get(foreign).id;
  assert.equal((await f.upload(set,'overview',{consent_record_id:foreignConsent})).status,404);
  assert.equal(f.storage.size,0);
});
