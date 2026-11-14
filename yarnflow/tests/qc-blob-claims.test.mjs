import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureDouble, uploadedDouble, isCode, proofDouble } from './qc-store.test.mjs';
import { d1Bucket } from '../server/d1-bucket.mjs';
import { addCapture, collectQCBlobs, loadResult, objectKey, DAY } from '../server/qc-store.mjs';
import { sha256Hex } from '../server/qc-contract.mjs';
async function bucketDouble(kind,f,t) {
 if(kind==='D1')return d1Bucket(f.env.DB);
 if(kind==='Map')return f.env.BUCKET;
 const dir=await mkdtemp(join(tmpdir(),'qc-c03-blobs-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=key=>join(dir,Buffer.from(key).toString('hex'));
 return {async put(key,bytes){await writeFile(path(key),bytes);},async get(key){try{return {body:new Uint8Array(await readFile(path(key)))};}catch(e){if(e.code==='ENOENT')return null;throw e;}},async delete(key){try{await unlink(path(key));}catch(e){if(e.code!=='ENOENT')throw e;}}};
}
for(const kind of ['Map','D1','filesystem']) {
 test(`${kind}: GC wins claim before reference; bytes and metadata are never published`,async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());f.env.BUCKET=await bucketDouble(kind,f,t);const u=await uploadedDouble(f,{close:false,count:1});
  const input={...u.uploads[0],meta:{...u.uploads[0].meta,capture_id:crypto.randomUUID(),role:'structure',expected_revision:u.result.revision}};
  input.beforeReference=()=>collectQCBlobs(f.env.DB,f.env.BUCKET,f.now+DAY+1,0);
  await assert.rejects(addCapture(f.env.DB,f.env.BUCKET,f.ctx,input,f.now),isCode('CONFLICT'));
  const r=await loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now);assert.equal(r.captures.length,1);assert.equal(r.revision,u.result.revision);
  assert.equal(await f.env.BUCKET.get(objectKey(f.workspaceId,input.meta.capture_id,input.meta.sha256)),null);
 });
 test(`${kind}: reference wins; orphan GC cannot delete live bytes`,async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());f.env.BUCKET=await bucketDouble(kind,f,t);const u=await uploadedDouble(f,{close:false,count:1});
  assert.equal((await collectQCBlobs(f.env.DB,f.env.BUCKET,f.now+2*DAY,0)).deleted,0);const c=u.result.captures[0];assert.ok(await f.env.BUCKET.get(objectKey(f.workspaceId,c.id,c.original_sha256)));
 });
 test(`${kind}: deletion failure remains claimed and retries safely`,async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const bucket=await bucketDouble(kind,f,t),key='qc/orphan-double',bytes=new Uint8Array([1,2]);
  f.sql.prepare("INSERT INTO qc_blob_claims(object_key,workspace_id,sha256,size,state,created_at,updated_at) VALUES(?,?,?,2,'PENDING',?,?)").run(key,f.workspaceId,await sha256Hex(bytes),f.now,f.now);await bucket.put(key,bytes);
  const r=await collectQCBlobs(f.env.DB,{...bucket,async delete(){throw new Error('delete failure double');}},f.now+DAY,0);assert.equal(r.failed,1);assert.equal(f.sql.prepare('SELECT state FROM qc_blob_claims WHERE object_key=?').get(key).state,'GC_CLAIMED');
  assert.equal((await collectQCBlobs(f.env.DB,bucket,f.now+DAY+1,0)).deleted,1);assert.equal(await bucket.get(key),null);assert.equal((await collectQCBlobs(f.env.DB,bucket,f.now+DAY+2,0)).deleted,0);
 });
 test(`${kind}: GC during put cannot leave resurrected bytes or publish reference`,async t=>{
  const f=await fixtureDouble();t.after(()=>f.sql.close());const bucket=await bucketDouble(kind,f,t);f.env.BUCKET=bucket;const u=await uploadedDouble(f,{close:false,count:0});
  // Build an upload through the normal test-double path, pause the put until GC has deleted it.
  let key;const interleaved={...bucket,async put(k,bytes,opts){key=k;await collectQCBlobs(f.env.DB,bucket,f.now+DAY,0);await bucket.put(k,bytes,opts);}};
  f.env.BUCKET=interleaved;
  const original={...u,uploads:[]};
  const template=await fixtureDouble();t.after(()=>template.sql.close());const upload=(await uploadedDouble(template,{close:false,count:1})).uploads[0];
  const input={...upload,capture_set_id:original.set.id,meta:{...upload.meta,consent_record_id:f.consent.id,expected_revision:u.result.revision}};
  await assert.rejects(addCapture(f.env.DB,interleaved,f.ctx,input,f.now));await collectQCBlobs(f.env.DB,bucket,f.now+DAY+1,0);assert.equal(await bucket.get(key),null);
 });
}
test('consent refusal precedes every byte put: unknown, foreign, expired, withdrawn, research-only',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f,{close:false,count:1});let puts=0;const bucket={...f.env.BUCKET,async put(){puts++;}};
 for(const kind of ['unknown','foreign','expired','withdrawn','research-only']){
  const id=crypto.randomUUID();if(kind!=='unknown'){
   const w=kind==='foreign'?crypto.randomUUID():f.workspaceId;if(w!==f.workspaceId)f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(w,'Foreign double',f.now);
   f.sql.prepare('INSERT INTO qc_consent_authorities(workspace_id,id,json,operational_capture,retention_days,valid_from,expires_at,withdrawn_at,created_by,created_at) VALUES(?,?,?,?,1,?,?,?,?,?)').run(w,id,'{}',kind==='research-only'?0:1,f.now-DAY,kind==='expired'?f.now:f.now+DAY,kind==='withdrawn'?f.now:null,f.admin.user_id,f.now);
  }
  const input={...u.uploads[0],meta:{...u.uploads[0].meta,capture_id:crypto.randomUUID(),role:'structure',expected_revision:u.result.revision,consent_record_id:id}};
  await assert.rejects(addCapture(f.env.DB,bucket,f.ctx,input,f.now),isCode('FORBIDDEN'));
 }
 assert.equal(puts,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_blob_claims').get().n,1);
});
test('failed put/readback or final audit leaves only recoverable pending claim',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f,{close:false,count:1});
 for(const mode of ['put','readback','audit']){
  const input={...u.uploads[0],meta:{...u.uploads[0].meta,capture_id:crypto.randomUUID(),role:'structure',expected_revision:u.result.revision}};
  const bucket={...f.env.BUCKET,...(mode==='put'?{async put(){throw new Error('put double');}}:mode==='readback'?{async get(){return {body:new Uint8Array([0])};}}:{})};
  if(mode==='audit')f.sql.exec("CREATE TRIGGER upload_audit_failure_double BEFORE INSERT ON qc_decision_events WHEN NEW.event='capture.uploaded' BEGIN SELECT RAISE(ABORT,'audit failure double'); END");
  await assert.rejects(addCapture(f.env.DB,bucket,f.ctx,input,f.now));assert.equal((await loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now)).revision,u.result.revision);
 }
 const report=await collectQCBlobs(f.env.DB,f.env.BUCKET,f.now+DAY,0);assert.equal(report.deleted,3);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_captures').get().n,1);
});
for(const kind of ['Map','D1'])for(const order of ['reference first','GC first','delete fails'])test(`D06 ${kind} ${order}: exact transaction footprint and retryable claims`,async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const bucket=await bucketDouble(kind,f,t);f.env.BUCKET=bucket;const u=await uploadedDouble(f,{close:false,count:1}),before=proofDouble(f);
 const input={...u.uploads[0],meta:{...u.uploads[0].meta,capture_id:crypto.randomUUID(),role:'structure',expected_revision:u.result.revision}},key=objectKey(f.workspaceId,input.meta.capture_id,input.meta.sha256);
 if(order==='reference first'){
  const r=(await addCapture(f.env.DB,bucket,f.ctx,input,f.now)).body,committed=proofDouble(f);assert.deepEqual(committed,{...before,qc_decision_events:before.qc_decision_events+1,samples:[{...before.samples[0],revision:before.samples[0].revision+1}]});
  let deletes=0;const spyDouble={...bucket,async delete(k){deletes++;return bucket.delete(k);}};assert.deepEqual(await collectQCBlobs(f.env.DB,spyDouble,f.now+2*DAY,0),{claimed:0,deleted:0,failed:0,lost:0});assert.equal(deletes,0);
  assert.equal(f.sql.prepare('SELECT state FROM qc_blob_claims WHERE object_key=?').get(key).state,'REFERENCED');assert.deepEqual(new Uint8Array((await bucket.get(key)).body),input.bytes);assert.deepEqual(proofDouble(f),committed);assert.equal(r.revision,u.result.revision+1);
 }else if(order==='GC first'){
  let report;input.beforeReference=async()=>{report=await collectQCBlobs(f.env.DB,bucket,f.now+DAY,0);};
  await assert.rejects(addCapture(f.env.DB,bucket,f.ctx,input,f.now),isCode('CONFLICT'));assert.equal(report.deleted,1);assert.equal(f.sql.prepare('SELECT state FROM qc_blob_claims WHERE object_key=?').get(key).state,'DELETED');
  assert.equal(await bucket.get(key),null);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_captures WHERE id=?').get(input.meta.capture_id).n,0);assert.deepEqual(proofDouble(f),before);
 }else{
  f.sql.prepare("INSERT INTO qc_blob_claims(object_key,workspace_id,sha256,size,state,created_at,updated_at) VALUES(?,?,?,?,'PENDING',?,?)").run(key,f.workspaceId,input.meta.sha256,input.bytes.length,f.now,f.now);await bucket.put(key,input.bytes);
  const brokenDouble={...bucket,async delete(){throw new Error('Deletion failure test double');}};const failed=await collectQCBlobs(f.env.DB,brokenDouble,f.now+DAY,0);assert.equal(failed.failed,1);
  assert.deepEqual({...f.sql.prepare('SELECT state,attempts,purpose FROM qc_blob_claims WHERE object_key=?').get(key)},{state:'GC_CLAIMED',attempts:1,purpose:'ORPHAN'});assert.ok(await bucket.get(key));assert.deepEqual(proofDouble(f),before);
  assert.equal((await collectQCBlobs(f.env.DB,bucket,f.now+DAY+1,0)).deleted,1);assert.equal(await bucket.get(key),null);assert.deepEqual(proofDouble(f),before);
 }
 assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
