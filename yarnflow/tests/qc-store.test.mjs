import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { portalFixture } from './portal-fixture.mjs';
import * as store from '../server/qc-store.mjs';
import { canonicalJson, sha256Hex, contentSha256, HASH_EXCLUDES, violation } from '../server/qc-contract.mjs';
const validFixtures = JSON.parse(readFileSync(new URL('../../scanner/tests/fixtures/qc-v2/valid.json', import.meta.url)));
export const doubleRecord = name => structuredClone(validFixtures.find(f => f.name === name).value);
export const idemDouble = async (route, body = {}) => ({ route, key: crypto.randomUUID(), bodySha: await sha256Hex(canonicalJson(body)) });
export const isCode = code => error => error.code === code;
export async function fixtureDouble() {
  const f = await portalFixture(), { sql, env, workspaceId } = f, now = Date.now();
  for (const [name,role] of [['QC double','quality_inspector'],['PO double','purchase_manager'],['Review double','supervisor']]) await f.person(name,role);
  function context(name) {
    const u = sql.prepare('SELECT * FROM users WHERE name=?').get(name), session = crypto.randomUUID();
    sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(session, u.id, now + 100 * store.DAY, now);
    return { user_id:u.id,workspace_id:workspaceId,name:u.name,role:u.portal_role,admin:u.portal_role==='admin',session_hash:session,session_expires_at:now+100*store.DAY,auth_epoch:u.pin_hash };
  }
  const ctx = context('QC double'), manager = context('PO double'), supervisor = context('Review double'), admin = context('Anas');
  const { orderId } = await f.insertPO({ supplierId: await f.insertSupplier({ status:'approved' }) });
  const specInput = { purchase_order_id:orderId,expected_spec_version:null,construction:'woven',allowed_fabric_labels:['twill'],taxonomy_version:'test-double-taxonomy',density:['ends','picks'].map(axis=>({axis,unit:'count/in',target:70,lower:65,upper:75})),confirmation_reason:'Test double confirmation' };
  const spec = (await store.confirmSpec(env.DB,manager,specInput,now)).body;
  const {id,workspace_id,created_by,created_at,...selectionInput} = doubleRecord('selection-operational');
  const selection = (await store.createSelection(env.DB,ctx,{...selectionInput,purchase_order_id:orderId},now)).body;
  const input = {selection_id:selection.id,spec_id:spec.id,spec_version:1,predecessor_sample_id:null,expected_predecessor_revision:null,reason:null};
  const created = await store.createSampleEvaluation(env.DB,ctx,input,now), result = created.body ?? created;
  const consent = (await store.registerConsent(env.DB,admin,{authority_evidence_sha256:'a'.repeat(64),operational_capture:true,operational_retention_days:1,research_use:false,training_use:false,export_destinations:[],valid_from:new Date(now-1000).toISOString(),expires_at:new Date(now+30*store.DAY).toISOString()},now)).body;
  return {...f,now,ctx,manager,supervisor,admin,context,spec,specInput,selection,input,result,consent};
}
export async function uploadedDouble(f,{close=true,count=3}={}) {
  const {env,ctx,now}=f;
  let result=(await store.createCaptureSet(env.DB,ctx,{sample_id:f.result.sample.id,expected_revision:f.result.revision},now)).body;
  const set=result.capture_sets.find(s=>s.state==='OPEN'),uploads=[];
  for(const role of ['overview','structure','scale'].slice(0,count)) {
    const bytes=new Uint8Array([1,2,3,role.length]),hash=await sha256Hex(bytes),attestation={...doubleRecord('attestation-web-unobserved'),image_sha256:hash};
    const input={capture_set_id:set.id,meta:{capture_id:crypto.randomUUID(),role,expected_revision:result.revision,sha256:hash,taken_at:new Date(now).toISOString(),device_profile_id:'test-double-device',calibration_id:null,consent_record_id:f.consent.id,attestation},bytes,width:100,height:100,mediaType:'image/jpeg'};
    uploads.push(input);result=(await store.addCapture(env.DB,env.BUCKET,ctx,input,now)).body;
  }
  if(close)result=(await store.closeCaptureSet(env.DB,ctx,{capture_set_id:set.id,expected_revision:result.revision},now)).body;
  return {result,set,uploads};
}
export async function analysisDouble(f,u,at=f.now) {
  const idem=await idemDouble('/analyze',{sample_id:u.result.sample.id,capture_set_id:u.set.id,expected_revision:u.result.revision});
  const {started}=await store.beginRequest(f.env.DB,f.ctx,idem,at);
  const prepared=await store.prepareAnalysis(f.env.DB,f.env.BUCKET,f.ctx,{sample_id:u.result.sample.id,capture_set_id:u.set.id,expected_revision:u.result.revision},started,at);
  const evidence={...doubleRecord('evidence-review-only-stages-unavailable'),sample_id:prepared.sample.id,spec_sha256:prepared.spec.content_sha256,capture_ids:prepared.request.captures.map(c=>c.capture.id),created_at:new Date(at).toISOString()};
  evidence.manifest_sha256=await contentSha256(evidence,HASH_EXCLUDES.Evidence);
  return {prepared,started,idem,candidate:{evidence,draft:doubleRecord('draft-manual-review'),binding:{spec_sha256:prepared.spec.content_sha256,policy_sha256:prepared.policy.sha256,release_sha256:prepared.release?.sha256??null,capture_sha256s:prepared.request.captures.map(c=>c.verified_sha256),attempt:prepared.set.attempt,expected_revision:prepared.sample.revision,request_id:started.request_id,request_generation:started.generation,deadline_at:prepared.request.context.deadline_at}}};
}
export const countsDouble=f=>Object.fromEntries(['qc_evidence','qc_decisions','qc_decision_events'].map(t=>[t,f.sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 test('C04 required public helpers exist',()=>{for(const n of ['getSpec','stageCapture','completeRequest','getRequest','buildAnalyzeInputs','registerCandidate','activate','suspend','consumeProof'])assert.equal(typeof store[n],'function',n);});
 test('sample create returns QCResult and exact durable replay after later mutations',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const {id,workspace_id,created_by,created_at,...fields}=f.selection;
  const sel=(await store.createSelection(f.env.DB,f.ctx,fields,f.now)).body,input={...f.input,selection_id:sel.id,idem:await idemDouble('/samples',fields)};
  const initial=await store.createSampleEvaluation(f.env.DB,f.ctx,input,f.now);assert.equal(violation('QCResult',initial),null);
  await store.createCaptureSet(f.env.DB,f.ctx,{sample_id:initial.sample.id,expected_revision:0},f.now);
  assert.deepEqual(await store.createSampleEvaluation(f.env.DB,f.ctx,input,f.now),initial);
  await assert.rejects(store.createSampleEvaluation(f.env.DB,f.ctx,{...input,idem:{...input.idem,bodySha:'b'.repeat(64)}},f.now),isCode('CONFLICT'));
 });
 test('concurrent finalisations commit one revision and durable response',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u),b=await analysisDouble(f,u);
  const out=await Promise.allSettled([a,b].map(x=>store.finalizeQC(f.env.DB,f.ctx,x,u.result.revision,f.now)));assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_decisions').get().n,1);
  const winner=out[0].status==='fulfilled'?a:b,r=await store.loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now);assert.equal(r.revision,u.result.revision+1);assert.equal(r.mode,'REVIEW_ONLY');
  assert.deepEqual((await store.beginRequest(f.env.DB,f.ctx,winner.idem,f.now+1)).replay.body,r);
 });
 test('audit failure rolls every decision write back',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u),before=countsDouble(f);
  f.sql.exec("CREATE TRIGGER audit_failure_double BEFORE INSERT ON qc_decision_events WHEN NEW.event='decision.committed' BEGIN SELECT RAISE(ABORT,'audit unavailable double'); END");
  await assert.rejects(store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now));assert.deepEqual(countsDouble(f),before);assert.equal((await store.loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now)).revision,u.result.revision);
  assert.equal((await store.requestState(f.env.DB,f.ctx,a.started.request_id,f.now)).state,'IN_PROGRESS');
 });
 for(const change of ['logout','pin','deactivate','role','sessionExpiry','revision','spec','lease'])test(`last-moment ${change} aborts every finalization write`,async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u),before=countsDouble(f);
  const db={...f.env.DB,async batch(statements){
   if(change==='logout')f.sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(f.ctx.session_hash);
   if(change==='pin')f.sql.prepare("UPDATE users SET pin_hash='reset-double' WHERE id=?").run(f.ctx.user_id);
   if(change==='deactivate')f.sql.prepare('UPDATE users SET deactivated_at=? WHERE id=?').run(f.now,f.ctx.user_id);
   if(change==='role')f.sql.prepare("UPDATE users SET portal_role='dispatch' WHERE id=?").run(f.ctx.user_id);
   if(change==='sessionExpiry')f.sql.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(f.now,f.ctx.session_hash);
   if(change==='revision')f.sql.prepare('UPDATE qc_samples SET revision=revision+1 WHERE id=?').run(f.result.sample.id);
   if(change==='spec')await store.confirmSpec(f.env.DB,f.manager,{...f.specInput,expected_spec_version:1},f.now);
   if(change==='lease')f.sql.prepare('UPDATE qc_idempotency SET lease_expires_at=? WHERE request_id=?').run(f.now,a.started.request_id);
   return f.env.DB.batch(statements);
  }};
  await assert.rejects(store.finalizeQC(db,f.ctx,a,u.result.revision,f.now));const after=countsDouble(f);assert.equal(after.qc_evidence,before.qc_evidence);assert.equal(after.qc_decisions,before.qc_decisions);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM qc_decision_events WHERE event='decision.committed'").get().n,0);assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(a.started.request_id).state,'IN_PROGRESS');
 });
 test('expired lease next generation fences old finalization and failure',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u),at=f.now+store.LEASE_MS;
  const next=await store.beginRequest(f.env.DB,f.ctx,a.idem,at);assert.equal(next.started.generation,2);
  await assert.rejects(store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,at),isCode('CONFLICT'));await store.failRequest(f.env.DB,a.started,{code:'SERVICE_UNAVAILABLE'},at);
  assert.equal((await store.requestState(f.env.DB,f.ctx,a.started.request_id,at)).state,'IN_PROGRESS');
  a.started=next.started;a.prepared=await store.prepareAnalysis(f.env.DB,f.env.BUCKET,f.ctx,{sample_id:f.result.sample.id,capture_set_id:u.set.id,expected_revision:u.result.revision},a.started,at);a.candidate.binding.request_generation=2;await store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,at);
 });
 test('close/upload retries keep revisions; incomplete sets cannot analyze',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f,{close:false});
  assert.equal((await store.addCapture(f.env.DB,f.env.BUCKET,f.ctx,u.uploads[0],f.now)).body.revision,u.result.revision);await assert.rejects(analysisDouble(f,u),isCode('CONFLICT'));
  const input={capture_set_id:u.set.id,expected_revision:u.result.revision,idem:await idemDouble('/close')};const out=await Promise.all([store.closeCaptureSet(f.env.DB,f.ctx,input,f.now),store.closeCaptureSet(f.env.DB,f.ctx,input,f.now)]);
  assert.deepEqual(out[0].body,out[1].body);assert.equal(out[0].body.family.attempts_used,1);
  assert.equal((await store.closeCaptureSet(f.env.DB,f.ctx,{capture_set_id:u.set.id,expected_revision:u.result.revision},f.now)).body.revision,u.result.revision+1);
 });
 test('spec revision fences paused v1; linked v2 freezes binding and shares three-attempt budget',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u);
  await store.confirmSpec(f.env.DB,f.manager,{...f.specInput,expected_spec_version:1},f.now);await assert.rejects(store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now),isCode('CONFLICT'));
  const r=await store.createSampleEvaluation(f.env.DB,f.ctx,{...f.input,spec_version:2,predecessor_sample_id:f.result.sample.id,expected_predecessor_revision:u.result.revision,reason:'New spec double'},f.now);
  assert.equal(r.sample.spec_version,2);assert.equal(r.family.attempts_used,1);assert.equal(r.family.predecessor_sample_id,f.result.sample.id);
  const old=await store.loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now);assert.equal(old.sample.spec_version,1);assert.equal(old.family.spec_is_current,false);assert.deepEqual((await store.getSpec(f.env.DB,f.workspaceId,f.spec.id,1)).spec,f.spec);
  f.result=r;await uploadedDouble(f);f.result=await store.loadResult(f.env.DB,f.workspaceId,r.sample.id,f.now);await uploadedDouble(f);const current=await store.loadResult(f.env.DB,f.workspaceId,r.sample.id,f.now);
  await assert.rejects(store.createCaptureSet(f.env.DB,f.ctx,{sample_id:r.sample.id,expected_revision:current.revision},f.now),e=>e.reasons.includes('RECAPTURE_LIMIT'));
 });
 test('adjudication keeps model decision and enforces admin reason and stale revision',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u);await store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now);
  let r=await store.loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now);const decision=r.decision,input={sample_id:r.sample.id,expected_revision:r.revision,outcome:'UNDETERMINED',reason:'Reference double unresolved',reference_ids:['reference-double'],supersedes_id:null};
  await assert.rejects(store.appendAdjudication(f.env.DB,f.admin,input,f.now),isCode('FORBIDDEN'));
  const first=(await store.appendAdjudication(f.env.DB,f.supervisor,input,f.now)).body;r=(await store.appendAdjudication(f.env.DB,f.supervisor,{...input,expected_revision:first.revision,supersedes_id:first.current_human_disposition.id,outcome:'CONFORMING'},f.now)).body;
  assert.equal(r.adjudications.length,2);assert.deepEqual(r.decision,decision);await assert.rejects(store.appendAdjudication(f.env.DB,f.supervisor,input,f.now),isCode('CONFLICT'));
 });
 test('proof single use, actor/session/body/expiry bindings',async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const sha='b'.repeat(64),token='c'.repeat(64);await store.issueProof(f.env.DB,f.admin,sha,f.now,token);
  for(const ctx of [f.ctx,{...f.admin,session_hash:'wrong-double'},{...f.admin,workspace_id:crypto.randomUUID()}])await assert.rejects(store.consumeProof(f.env.DB,ctx,token,sha,'key',f.now));
  await assert.rejects(store.consumeProof(f.env.DB,f.admin,token,'d'.repeat(64),'key',f.now));await assert.rejects(store.consumeProof(f.env.DB,f.admin,token,sha,'key',f.now+store.PROOF_MS));
  await store.consumeProof(f.env.DB,f.admin,token,sha,'key',f.now);await assert.rejects(store.consumeProof(f.env.DB,f.admin,token,sha,'key',f.now));
 });
}
