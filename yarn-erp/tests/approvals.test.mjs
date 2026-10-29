import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { needsApproval, approvalQueries, approvalsApi } from '../server/governance.mjs';
import { query, ErpProblem } from '../server/erp-utils.mjs';
const base='/api/erp/approvals';
const changed='The item changed since this request was raised. Reload and review it again.';
const decided='This request was already decided. Reload.';
const rows=(f,table)=>f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
async function fixture(){
 const f=await portalFixture(), db=f.env.DB, admin=await f.member('Anas');
 f.sql.exec('CREATE TABLE marker(v TEXT CHECK(v=\'approved\'))');
 const handlers={escalation:{approve:async db=>[query(db,"INSERT INTO marker VALUES('approved')")],reject:async()=>[],describe:async(db,r)=>({objectType:r.object_type,objectId:r.object_id,label:'Test escalation',currency:r.currency,evidence:{photos:['photo-id'],issues:['Issue']},proposed:r.payload})}};
 async function call(path=base,body,as=admin,map=handlers){
  try{const r=await approvalsApi(new Request('https://yarnflow.test'+path,{method:body===undefined?'GET':'POST'}),f.env,as,path.split('?')[0],body,map);return {status:r.status,data:await r.json()};}
  catch(e){if(e instanceof ErpProblem)return {status:e.status,data:{error:e.message}};throw e;}
 }
 async function raise(overrides={}){const request={id:crypto.randomUUID(),type:'escalation',objectType:'qc_inspection',objectId:crypto.randomUUID(),amount:0,threshold:null,unit:'none',payload:{disposition:'hold'},...overrides};await db.batch(approvalQueries(db,admin,request,Date.now()));return request.id;}
 const decide=(id,decision='approve',reason,as=admin,map=handlers)=>call(base+'/decide',{id,decision,...(reason===undefined?{}:{reason})},as,map);
 return {...f,db,admin,handlers,call,raise,decide};
}
test('at or above the threshold waits for admin; below is final',async()=>{
 const f=await fixture();f.sql.prepare("INSERT INTO thresholds(workspace_id,type,value,currency,created_by,created_at,updated_by,updated_at) VALUES(?,'claim',100,'PKR',?,1,?,1)").run(f.workspaceId,f.adminId,f.adminId);
 assert.deepEqual(await needsApproval(f.db,f.workspaceId,'claim',99),{required:false,threshold:100});
 for(const amount of [100,101])assert.equal((await needsApproval(f.db,f.workspaceId,'claim',amount)).required,true);
 assert.deepEqual(await needsApproval(f.db,f.workspaceId,'purchase',10**12),{required:false,threshold:null});
});
test('admin approves once; the effect, the decision and the audit row land together',async()=>{
 const f=await fixture(),id=await f.raise();assert.equal((await f.decide(id)).status,200);
 const r=rows(f,'approval_requests')[0],a=rows(f,'erp_audit_events').at(-1);
 assert.equal(rows(f,'marker').length,1);assert.equal(r.status,'approved');assert.equal(r.decided_by,f.adminId);assert.equal(r.created_by,f.adminId);assert.ok(r.decided_at);assert.equal(a.action,'approval.approved');assert.deepEqual(JSON.parse(a.old_json),{status:'pending'});assert.deepEqual(JSON.parse(a.new_json),{status:'approved'});assert.equal(a.object_type,'approval');
 assert.deepEqual(await f.decide(id),{status:409,data:{error:decided}});assert.equal(rows(f,'marker').length,1);
});
test('a rejection needs a reason and has no effect',async()=>{
 const f=await fixture(),id=await f.raise();for(const reason of [undefined,'four','x'.repeat(1001)])assert.equal((await f.decide(id,'reject',reason)).status,422);
 assert.equal((await f.decide(id,'reject','Over budget this quarter')).status,200);assert.equal(rows(f,'marker').length,0);assert.equal(rows(f,'approval_requests')[0].reason,'Over budget this quarter');const a=rows(f,'erp_audit_events').at(-1);assert.equal(a.action,'approval.rejected');assert.equal(a.reason,'Over budget this quarter');
});
test('only admins list or decide approvals',async()=>{
 const f=await fixture(),id=await f.raise();await f.person('Supervisor','supervisor');const m=await f.member('Supervisor');
 assert.equal((await f.call(base,undefined,m)).status,403);assert.equal((await f.decide(id,'approve',undefined,m)).status,403);
 assert.equal((await f.call(base,undefined,{...f.admin,workspace_id:'other'})).data.approvals.length,0);assert.equal((await f.decide(id,'approve',undefined,{...f.admin,workspace_id:'other'})).status,404);
});
test('a failing effect rolls the decision back',async()=>{
 const f=await fixture(),id=await f.raise(),before=rows(f,'erp_audit_events');const handlers={escalation:{...f.handlers.escalation,approve:async db=>[query(db,"INSERT INTO marker VALUES('approved')"),query(db,"INSERT INTO marker VALUES('invalid')")]}};
 assert.deepEqual(await f.decide(id,'approve',undefined,f.admin,handlers),{status:409,data:{error:changed}});assert.equal(rows(f,'approval_requests')[0].status,'pending');assert.equal(rows(f,'marker').length,0);assert.deepEqual(rows(f,'erp_audit_events'),before);
});
test('two admins deciding at once: exactly one decision lands',async()=>{
 const f=await fixture(),id=await f.raise(),fahad=await f.member('Fahad');const [a,b]=await Promise.all([f.decide(id),f.decide(id,'approve',undefined,fahad)]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);assert.equal(rows(f,'marker').length,1);assert.equal(rows(f,'erp_audit_events').filter(r=>r.record_id===id).length,1);
});
test('a later threshold change does not re-judge a pending request',async()=>{
 const f=await fixture();await f.db.batch([query(f.db,"INSERT INTO thresholds(workspace_id,type,value,currency,created_by,created_at,updated_by,updated_at) VALUES(?,'claim',100,'PKR',?,1,?,1)",f.workspaceId,f.adminId,f.adminId)]);
 const id=await f.raise({amount:150,threshold:100,payload:{amount:150}});f.sql.exec("UPDATE thresholds SET value=1000");
 let payload;f.handlers.escalation.approve=async(db,r,request)=>{payload=request.payload;return [query(db,"INSERT INTO marker VALUES('approved')")];};
 assert.equal((await f.decide(id)).status,200);assert.deepEqual(payload,{amount:150});assert.equal(rows(f,'approval_requests')[0].threshold,100);
});
test('one pending request per object',async()=>{
 const f=await fixture(),objectId=crypto.randomUUID(),id=await f.raise({objectId});await assert.rejects(f.raise({objectId}),/UNIQUE/);await f.decide(id);await f.raise({objectId});assert.equal(rows(f,'approval_requests').length,2);
});
test('approval details include immutable request terms and complete domain evidence',async()=>{
 const f=await fixture(),id=await f.raise({amount:150,threshold:100,unit:'minor'});await f.db.batch([query(f.db,"INSERT INTO settings(workspace_id,key,value_json,created_by,created_at,updated_by,updated_at) VALUES(?,'currency','\"USD\"',?,1,?,1)",f.workspaceId,f.adminId,f.adminId)]);
 const r=await f.call(base+'/'+id);assert.equal(r.status,200);assert.deepEqual([r.data.approval.amount,r.data.approval.threshold,r.data.approval.currency],[150,100,'PKR']);assert.deepEqual(r.data.object,{objectType:'qc_inspection',objectId:r.data.approval.object_id,label:'Test escalation',currency:'PKR',evidence:{photos:['photo-id'],issues:['Issue']},proposed:{disposition:'hold'}});
 assert.equal((await f.call(base+'/'+id,undefined,{...f.admin,workspace_id:'other'})).status,404);assert.equal((await f.call(base+'/'+id,undefined,{...f.admin,role:'supervisor'})).status,403);
 assert.equal((await f.call(base+'/'+id,undefined,f.admin,{})).status,409);
 for(const describe of [undefined,async()=>({}),async()=>({...r.data.object,currency:'USD'}),async()=>({...r.data.object,evidence:null})])assert.equal((await f.call(base+'/'+id,undefined,f.admin,{escalation:{...f.handlers.escalation,describe}})).status,409);
 assert.equal((await f.decide(id,'approve',undefined,f.admin,{})).status,409);
 assert.equal((await f.call(base+'?status=pending&type=escalation')).data.approvals.length,1);assert.equal((await f.call(base+'?status=approved')).data.approvals.length,0);assert.equal((await f.call(base+'?type=claim')).data.approvals.length,0);
});
test('admin cannot rewrite a decided request',async()=>{
 const f=await fixture(),id=await f.raise();await f.decide(id);const original=rows(f,'approval_requests')[0],before=rows(f,'erp_audit_events');assert.equal((await f.decide(id,'reject','Change my mind')).status,409);assert.deepEqual(rows(f,'approval_requests')[0],original);assert.deepEqual(rows(f,'erp_audit_events'),before);
 const compensation=await f.raise({objectId:original.object_id,payload:{compensatesId:id,reason:'Correct the original disposition'}});assert.notEqual(compensation,id);assert.equal((await f.decide(compensation,'approve','Correct the original disposition')).status,200);assert.deepEqual(rows(f,'approval_requests')[0],original);assert.equal(rows(f,'approval_requests')[1].reason,'Correct the original disposition');assert.equal(rows(f,'erp_audit_events').at(-1).record_id,compensation);
});
test('database guards protect pending terms and prohibit deletion or rewriting decisions',async()=>{
 const f=await fixture(),id=await f.raise();
 for(const change of ["type='claim'","object_type='other'","object_id='other'","amount=1","threshold=1","unit='grams'","payload_json='{}'","requested_by='other'","requested_role='other'","workspace_id='other'","created_by='other'","currency='USD'","created_at=0","id='other'"])assert.throws(()=>f.sql.exec(`UPDATE approval_requests SET ${change}`));
 assert.throws(()=>f.sql.exec("UPDATE approval_requests SET status='rejected',reason='no'"),/reason required/);assert.throws(()=>f.sql.exec('DELETE FROM approval_requests'));
 await f.decide(id);assert.throws(()=>f.sql.exec("UPDATE approval_requests SET reason='Edited reason'"),/approval already decided/);assert.throws(()=>f.sql.exec('DELETE FROM approval_requests'));
});
test('router mounts approvals and validates decision fields',async()=>{
 const f=await fixture();assert.equal((await portalFixture().then(p=>p.call('/erp/approvals'))).status,200);
 const id=await f.raise();for(const body of [{id,decision:'other'},{id,decision:'approve',extra:true}])assert.equal((await f.call(base+'/decide',body)).status,422);
 assert.equal((await f.call(base+'?status=invalid')).status,422);assert.equal((await f.call(base+'?type=invalid')).status,422);
});
