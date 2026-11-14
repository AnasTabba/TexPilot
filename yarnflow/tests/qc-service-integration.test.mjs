import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import worker from '../server/cloudflare.mjs';
import { sha256Hex, violation } from '../server/qc-contract.mjs';
import { portalFixture } from './portal-fixture.mjs';

const ORIGIN = 'https://yarnflow.test', uuid = () => crypto.randomUUID();
const images = new URL('../../scanner/tests/fixtures/qc-images/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', images)));
const scannerDir = fileURLToPath(new URL('../../scanner/', import.meta.url));
const defaultViews = [['overview','swatch.jpg'],['structure','swatch.png'],['scale','swatch.webp']];
// This audit table also contains consent/spec/capture events created before analysis.
const decisionRows = sql => Object.fromEntries(['qc_decisions','qc_evidence','qc_decision_events'].map(table => [table,sql.prepare(`SELECT COUNT(*) AS n FROM ${table}${table==='qc_decision_events'?" WHERE event='decision.committed'":''}`).get().n]));
const erpRows = sql => Object.fromEntries(['balances','movements','stock_deltas','claims','goods_receipts','qc_inspections'].map(table => [table,sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
function ok(result, status = 200, type = 'QCResult') {
  assert.equal(result.status,status,JSON.stringify(result.data));
  assert.equal(violation(type,result.data),null,JSON.stringify(result.data));
  assert.equal(result.headers.get('Cache-Control'),'no-store');
  return result.data;
}
function errorEnvelope(result, statuses, code, retryable = false) {
  assert.ok(statuses.includes(result.status),JSON.stringify(result));
  assert.equal(violation('ErrorEnvelope',result.data),null,JSON.stringify(result.data));
  assert.equal(result.data.error.code,code); assert.equal(result.data.error.retryable,retryable);
  assert.match(result.data.error.request_id,/^[a-f\d-]{36}$/);
  assert.equal(result.headers.get('Cache-Control'),'no-store');
}
function review(result) {
  assert.equal(result.mode,'REVIEW_ONLY');
  assert.ok(['MANUAL_REVIEW','RECAPTURE'].includes(result.decision.status));
  assert.equal(result.decision.automatic,false);
  for (const stage of ['fabric','defects','domain']) {
    assert.notEqual(result.evidence[stage].state,'OK');
    assert.equal(result.evidence[stage].value,null);
    assert.equal(result.evidence[stage].artifact_sha256,null);
    assert.ok(result.evidence[stage].reasons.includes(stage === 'domain' ? 'DOMAIN_UNVALIDATED' : 'STAGE_UNAVAILABLE'));
  }
}
async function image(file) {
  const bytes = new Uint8Array(readFileSync(new URL(file,images)));
  assert.equal(bytes.length,manifest[file].bytes,file);
  assert.equal(await sha256Hex(bytes),manifest[file].sha256,file);
  return {bytes,hash:manifest[file].sha256,type:file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'image/jpeg'};
}

async function startScanner(t) {
  const temporary = await mkdtemp(join(tmpdir(),'texpilot-qc-service-'));
  let stop = async () => {};
  t.after(async () => { try { await stop(); } finally { await rm(temporary,{recursive:true,force:true}); } });
  const listener = createServer();
  await new Promise((resolve,reject) => { listener.once('error',reject); listener.listen(0,'127.0.0.1',resolve); });
  const port = listener.address().port;
  await new Promise((resolve,reject) => listener.close(error => error ? reject(error) : resolve()));
  const key = randomBytes(32).toString('hex'), url = `http://127.0.0.1:${port}`;
  const child = spawn(process.env.QC_PYTHON || '../.venv/bin/python',['-m','uvicorn','services.api.main:app','--host','127.0.0.1','--port',String(port)],{
    cwd:scannerDir,stdio:['ignore','pipe','pipe'],
    env:{...process.env,TEXPILOT_VISION:'stub',TEXPILOT_OCR_BACKEND:'none',TEXPILOT_SCAN_STORE:'none',TEXPILOT_FAULT_MODEL:'',TEXPILOT_QC_SERVICE_KEY:key,TEXPILOT_QC_SERVICE_KID:'qc-local-1',TMPDIR:temporary,TMP:temporary,TEMP:temporary,PYTHONDONTWRITEBYTECODE:'1'},
  });
  let logs = '', spawnError;
  for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk => { logs = (logs + chunk.toString()).slice(-12000); });
  child.on('error',error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close',(code,signal) => resolve({code,signal})));
  let stopped = false;
  stop = async () => {
    if (stopped) return; stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([closed,new Promise((_,reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Scanner did not terminate after SIGTERM')); },5000); })]);
    } finally { clearTimeout(timer); await closed; }
  };
  // The after hook is registered before startup so assertion/import failures also reap the process.
  const deadline = Date.now()+20000;
  while (Date.now()<deadline) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) throw Error(`Scanner startup failed: ${spawnError?.message ?? logs}`);
    try {
      const response = await fetch(url+'/health',{signal:AbortSignal.timeout(500)});
      if (response.ok && (await response.json()).status === 'ok') return {url,key,stop};
    } catch { /* The process may still be importing the stub service. */ }
    await delay(50);
  }
  throw Error('Scanner health deadline exceeded: '+logs);
}

/** Identity, PO, signed-register reference and bucket are test doubles; inference is real ASGI. */
async function fixture(t, service) {
  const f = await portalFixture(); t.after(() => f.sql.close());
  await f.person('Integration Inspector Double','quality_inspector');
  await f.person('Integration Purchaser Double','purchase_manager');
  const cookies = {};
  for (const name of ['Anas','Integration Inspector Double','Integration Purchaser Double']) {
    const login = await f.login(name); assert.equal(login.status,200,login.text); cookies[name] = login.cookie;
  }
  Object.assign(f.env,{TEXPILOT_API_URL:service.url,QC_SERVICE_KEY:service.key,QC_SERVICE_KID:'qc-local-1'});
  assert.equal(Object.hasOwn(f.env,'QC_SEND'),false,'Use the real fetch transport');
  async function call(path,body,name='Integration Inspector Double',options={}) {
    const headers = {Origin:ORIGIN,Cookie:cookies[name],'Idempotency-Key':options.key??uuid()};
    if (!(body instanceof FormData)) headers['Content-Type']='application/json';
    const response = await worker.fetch(new Request(ORIGIN+'/api/qc/v2'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})}),f.env);
    return {status:response.status,headers:response.headers,data:response.headers.get('Content-Type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer())};
  }
  const supplierId = await f.insertSupplier({status:'approved'}), {orderId} = await f.insertPO({supplierId});
  const spec = ok(await call('/specs',{purchase_order_id:orderId,expected_spec_version:null,construction:'woven',allowed_fabric_labels:['plain'],taxonomy_version:'integration-test-double-taxonomy',density:['ends','picks'].map(axis=>({axis,unit:'count/in',target:80,lower:70,upper:90,candidate:null})),confirmation_reason:'PO facts supplied only by the integration test double'},'Integration Purchaser Double'),201,'PurchaseSpec');
  const consent = ok(await call('/consent-authorities',{authority_evidence_sha256:await sha256Hex('consent authority test double; no external approval'),operational_capture:true,operational_retention_days:1,research_use:false,training_use:false,export_destinations:[],valid_from:new Date(Date.now()-10000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()},'Anas'),201,'ConsentAuthority');
  const selection = ok(await call('/selections',{purchase_order_id:orderId,plan_version:'integration-test-double-plan',plan_sha256:null,randomization_seed:null,draw_index:null,selection_probability:null,cohort:'OPERATIONAL',independent_group_id:uuid(),lot_ref:'test-double-lot',roll_ref:'test-double-roll',location_ref:'test-double-location',face:'face',planned_area_cm2:100,method:'test-double-manual'}),201,'SamplingSelection');
  let current = ok(await call('/samples',{selection_id:selection.id,spec_id:spec.id,spec_version:spec.version,predecessor_sample_id:null,expected_predecessor_revision:null,reason:null}),201);
  const sampleId = current.sample.id;
  current = ok(await call(`/samples/${sampleId}/capture-sets`,{expected_revision:current.revision}),201);
  const set = current.capture_sets.find(item=>item.state==='OPEN'); assert.ok(set);
  const uploaded = new Map();
  async function upload(role,file) {
    const original = await image(file), captureId = uuid(), takenAt = new Date().toISOString();
    const meta = {capture_id:captureId,role,expected_revision:current.revision,sha256:original.hash,taken_at:takenAt,device_profile_id:'integration-test-double-device',calibration_id:null,consent_record_id:consent.id,attestation:{image_sha256:original.hash,capture_mode:'IMPORTED',device_model:null,lens_id:null,zoom_factor:null,focus_mode:null,exposure_mode:null,resolution:null,orientation:null,processing:null,captured_at:takenAt}};
    const form = new FormData(); form.set('meta',JSON.stringify(meta)); form.set('original',new Blob([original.bytes],{type:original.type}),file);
    const result = await call(`/capture-sets/${set.id}/captures`,form);
    if (result.status===201) { current = ok(result,201); uploaded.set(captureId,original); }
    return result;
  }
  async function close(views=defaultViews) {
    for (const [role,file] of views) ok(await upload(role,file),201);
    current = ok(await call(`/capture-sets/${set.id}/close`,{expected_revision:current.revision}));
  }
  async function analyze(key=uuid()) { return call(`/samples/${sampleId}/analyze`,{expected_revision:current.revision,capture_set_id:set.id},undefined,{key}); }
  return {...f,call,sampleId,set,upload,uploaded,close,analyze,get current(){return current;}};
}

test('real Worker to scanner QC service integration', {timeout:60000}, async t => {
  const service = await startScanner(t);
  await t.test('public operator path decodes JPEG/PNG/WebP, persists review, reloads and replays exactly',async t => {
    const f = await fixture(t,service);
    const status = await f.call('/status'); assert.equal(status.status,200); assert.equal(status.data.scanner,'CONNECTED');
    assert.equal(violation('Readiness',status.data.readiness),null); assert.equal(status.data.readiness.ready,false);
    await f.close(); const before = erpRows(f.sql), key = uuid();
    const result = ok(await f.analyze(key)); review(result);
    assert.deepEqual(decisionRows(f.sql),{qc_decisions:1,qc_evidence:1,qc_decision_events:1});
    for (const capture of result.captures) {
      const original = await f.call(`/captures/${capture.id}/original`);
      assert.equal(original.status,200); assert.equal(original.headers.get('Cache-Control'),'private,no-store');
      assert.equal(original.headers.get('Content-Type'),f.uploaded.get(capture.id).type);
      assert.deepEqual(original.data,f.uploaded.get(capture.id).bytes);
      assert.equal(await sha256Hex(original.data),capture.original_sha256);
    }
    const reload = ok(await f.call(`/samples/${f.sampleId}`)); assert.deepEqual(reload,result);
    const replay = ok(await f.analyze(key)); assert.deepEqual(replay,result);
    assert.equal(replay.decision.id,result.decision.id); assert.equal(replay.revision,result.revision);
    assert.deepEqual(decisionRows(f.sql),{qc_decisions:1,qc_evidence:1,qc_decision_events:1}); assert.deepEqual(erpRows(f.sql),before);
  });
  await t.test('EXIF rotation reaches ASGI with upright dimensions while preserving encoded original metadata',async t => {
    const f = await fixture(t,service); await f.close([['overview','swatch-exif6.jpg'],...defaultViews.slice(1)]);
    const result = ok(await f.analyze()); review(result);
    const capture = result.captures.find(item=>item.role==='overview'); assert.equal(capture.width,640); assert.equal(capture.height,480);
    assert.deepEqual((await f.call(`/captures/${capture.id}/original`)).data,f.uploaded.get(capture.id).bytes);
  });
  await t.test('full phone resolution reaches the real decoder without shrinking the source',async t => {
    const f = await fixture(t,service); await f.close([['overview','swatch.jpg'],['structure','phone-4032x3024.jpg'],['scale','swatch.webp']]);
    const result = ok(await f.analyze()); review(result);
    const capture = result.captures.find(item=>item.role==='structure'); assert.equal(capture.width,4032); assert.equal(capture.height,3024);
    assert.deepEqual((await f.call(`/captures/${capture.id}/original`)).data,f.uploaded.get(capture.id).bytes);
  });
  await t.test('wrong Worker service key produces an ErrorEnvelope and no evidence or decision rows',async t => {
    const f = await fixture(t,service); await f.close(); f.env.QC_SERVICE_KEY = randomBytes(32).toString('hex');
    const result = await f.analyze(); errorEnvelope(result,[503],'SERVICE_UNAVAILABLE',true);
    assert.deepEqual(decisionRows(f.sql),{qc_decisions:0,qc_evidence:0,qc_decision_events:0});
  });
  for (const [file,status,code] of [['truncated-14.jpg',422,'VALIDATION_FAILED'],['over-pixel-limit.png',413,'PAYLOAD_TOO_LARGE']]) {
    await t.test(`${file} is refused before a blob or decision can be stored`,async t => {
      const f = await fixture(t,service), revision = f.current.revision;
      errorEnvelope(await f.upload('overview',file),[status],code);
      assert.equal(f.storage.size,0); assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_captures').get().n,0);
      assert.deepEqual(decisionRows(f.sql),{qc_decisions:0,qc_evidence:0,qc_decision_events:0});
      assert.equal(ok(await f.call(`/samples/${f.sampleId}`)).revision,revision);
    });
  }
  await t.test('a killed scanner returns a retryable unavailable error and commits no decision',async t => {
    const f = await fixture(t,service); await f.close(); await service.stop();
    const result = await f.analyze();
    assert.ok([503,504].includes(result.status),JSON.stringify(result.data));
    errorEnvelope(result,[503,504],result.status===503?'SERVICE_UNAVAILABLE':'DEADLINE_EXCEEDED',true);
    assert.deepEqual(decisionRows(f.sql),{qc_decisions:0,qc_evidence:0,qc_decision_events:0});
  });
});
