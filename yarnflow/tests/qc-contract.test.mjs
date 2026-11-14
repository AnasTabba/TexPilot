import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson, sha256Hex, violation, schemaViolation, SCHEMA, parseSpec } from '../server/qc-contract.mjs';
import { fixtureDouble, uploadedDouble, analysisDouble, proofDouble } from './qc-store.test.mjs';
import * as store from '../server/qc-store.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`../../scanner/tests/fixtures/qc-v2/${name}.json`, import.meta.url)));
test('generated schema has no drift', () => assert.deepEqual(SCHEMA, JSON.parse(readFileSync(new URL('../../scanner/contracts/qc-v2.schema.json', import.meta.url)))));
for (const f of fixture('canonical')) test(`canonical bytes/hash: ${f.name}`, async () => { assert.equal(canonicalJson(f.value), f.canonical); assert.equal(await sha256Hex(f.canonical), f.sha256); });
for (const f of fixture('valid')) test(`valid: ${f.name}`, () => assert.equal(violation(f.type, f.value), null));
for (const f of fixture('invalid')) test(`invalid: ${f.name}`, () => assert.ok(violation(f.type, f.value)));
test('schema-only layer labels are reported honestly', () => assert.deepEqual(fixture('invalid').filter(f => Boolean(schemaViolation(f.type, f.value)) !== (f.layer === 'schema')).map(f => f.name), []));
test('canonical JSON refuses non JSON values and sparse arrays', () => { for (const x of [NaN, Infinity, undefined, () => {}, new Date(), new Map(), Array(2)]) assert.throws(() => canonicalJson(x)); });
test('Unicode lengths count code points; inherited required fields reject', () => {
  const f = fixture('valid').find(f => f.type === 'SamplingSelection').value;
  assert.equal(violation('SamplingSelection', { ...f, method: '🧵'.repeat(120) }), null);
  const v = Object.assign(Object.create({ id: f.id }), f); delete v.id; assert.ok(violation('SamplingSelection', v));
});
test('spec parser verifies content hash', async () => { const f = fixture('valid').find(f => f.name === 'spec-woven-v1').value; await parseSpec(f); await assert.rejects(parseSpec({ ...f, taxonomy_version: 'changed' }), /content_sha256/); });
test('actual create/upload/close/finalize/reload envelopes satisfy the frozen QCResult contract',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());assert.equal(violation('QCResult',f.result),null);const initial=proofDouble(f),u=await uploadedDouble(f);
 assert.equal(violation('QCResult',u.result),null);assert.equal(u.result.revision,5);assert.equal(u.result.mode,'REVIEW_ONLY');const a=await analysisDouble(f,u);assert.equal(violation('AnalyzeRequest',a.prepared.request),null);assert.equal(violation('AnalysisCandidate',a.candidate),null);
 const before=proofDouble(f),decision=await store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now),result=await store.loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now);assert.equal(violation('QCResult',result),null);assert.equal(result.mode,'REVIEW_ONLY');assert.equal(result.decision.automatic,false);assert.equal(result.decision.status,'MANUAL_REVIEW');
 assert.deepEqual(proofDouble(f),{qc_evidence:initial.qc_evidence+1,qc_decisions:initial.qc_decisions+1,qc_decision_events:before.qc_decision_events+1,samples:[{...initial.samples[0],revision:6,current_decision_id:decision.id}]});
 assert.deepEqual((await store.beginRequest(f.env.DB,f.ctx,a.idem,f.now+1)).replay.body,result);
});
for(const tamper of ['revision','hash','capture ids','unreleased automatic'])test(`scanner ${tamper} cannot cross the persistence contract`,async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u),before=proofDouble(f);
 if(tamper==='revision')a.candidate.binding.expected_revision++;
 if(tamper==='hash')a.candidate.evidence.manifest_sha256='0'.repeat(64);
 if(tamper==='capture ids')a.candidate.evidence.capture_ids=[crypto.randomUUID()];
 if(tamper==='unreleased automatic')a.candidate.draft={status:'ACCEPT',reasons:[],automatic:true,scope:'INSPECTED_SAMPLE'};
 await assert.rejects(store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now),e=>e.code==='SERVICE_UNAVAILABLE');assert.deepEqual(proofDouble(f),before);assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(a.started.request_id).state,'IN_PROGRESS');
});
