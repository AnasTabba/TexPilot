import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { portalFixture, migrate, dir, legacyMigrations, liveShapedRows } from './portal-fixture.mjs';
import { audit } from '../server/erp-utils.mjs';

test('audit rows cannot be updated or deleted', async () => {
  const f = await portalFixture();
  await f.env.DB.batch([audit(f.env.DB, await f.member('Anas'), 'lot.arrived', crypto.randomUUID())]);
  assert.throws(() => f.sql.exec("UPDATE erp_audit_events SET action='x'"), /immutable audit/);
  assert.throws(() => f.sql.exec('DELETE FROM erp_audit_events'), /immutable audit/);
});
test('rejections, dismissals, holds and interventions without a reason are refused by the database', async () => {
  const f = await portalFixture(), m = await f.member('Anas'), id = crypto.randomUUID();
  for (const verb of ['rejected','dismissed','held','suspended','cancelled','adjusted','overridden']) {
    for (const reason of [null, '', '    ', 'four']) await assert.rejects(f.env.DB.batch([audit(f.env.DB,m,`bid.${verb}`,id,{},'staff',{reason})]), /reason required/);
    await f.env.DB.batch([audit(f.env.DB,m,`bid.${verb}`,id,{},'staff',{reason:'Price above budget'})]);
  }
  await assert.rejects(f.env.DB.batch([audit(f.env.DB,m,'lot.arrived',id,{},'staff',{intervention:' '})]), /reason required/);
  await f.env.DB.batch([audit(f.env.DB,m,'lot.arrived',id,{},'staff',{intervention:'Covering absent supervisor'})]);
});
test('each row records user, role, action, object type and id, old and new values, reason and time', async () => {
  const f = await portalFixture(), id = await f.person('Saima','dispatch');
  assert.equal((await f.call('/erp/admin/users/update',{id,role:'supervisor'})).status,200);
  const row = f.sql.prepare('SELECT * FROM erp_audit_events').get();
  assert.equal(row.actor_id,f.adminId); assert.equal(row.actor_role,'admin'); assert.equal(row.action,'user.role_changed');
  assert.equal(row.object_type,'user'); assert.equal(row.record_id,id);
  assert.deepEqual(JSON.parse(row.old_json),{role:'dispatch'}); assert.deepEqual(JSON.parse(row.new_json),{role:'supervisor'});
  assert.equal(row.reason,null); assert.equal(typeof row.created_at,'number');
  assert.equal(row.created_by,row.actor_id); assert.equal(row.status,'recorded'); assert.equal(row.updated_at,row.created_at);
  await f.env.DB.batch([audit(f.env.DB,{workspace_id:f.workspaceId,user_id:'external'},'bid.submitted',id,{},'supplier')]);
  const external=f.sql.prepare("SELECT * FROM erp_audit_events WHERE actor_id='external'").get();
  assert.equal(external.actor_role,'supplier'); assert.equal(external.old_json,null); assert.equal(external.new_json,null);
});
test('admin reads the whole log with filters and pages; other roles cannot', async () => {
  const f = await portalFixture(), m=await f.member('Anas'), id=crypto.randomUUID();
  // Equal timestamps exercise the id tie-breaker at the page boundary.
  const original=Date.now; Date.now=()=>1800000000000;
  try { await f.env.DB.batch(Array.from({length:105},(_,i)=>audit(f.env.DB,m,i%2?'user.created':'lot.arrived',id,{i},'staff',{intervention:i===0?'Covering absent supervisor':null}))); } finally { Date.now=original; }
  const page=await f.call('/erp/admin/audit'); assert.equal(page.status,200); assert.equal(page.data.events.length,100); assert.ok(page.data.next);
  const second=await f.call('/erp/admin/audit?before='+encodeURIComponent(page.data.next)); assert.equal(second.data.events.length,5); assert.equal(second.data.next,null);
  const rows=[...page.data.events,...second.data.events]; assert.equal(new Set(rows.map(r=>r.id)).size,105);
  assert.deepEqual(rows.map(r=>r.id),rows.map(r=>r.id).sort().reverse()); assert.equal(rows[0].actor_name,'Anas');
  for (const [filter,n] of [['objectType=user',52],['action=user.created',52],['actor='+f.adminId,100],['objectId='+id,100],['interventions=1',1],['from=1800000000001',0],['to=1799999999999',0],['from=1800000000000&to=1800000000000&objectType=user',52],['actor=missing',0]]) {
    const r=await f.call('/erp/admin/audit?'+filter); assert.equal(r.status,200); assert.equal(r.data.events.length,n,filter);
  }
  for (const filter of ['before=invalid','from=abc','to=-1']) assert.equal((await f.call('/erp/admin/audit?'+filter)).status,422);
  for (const role of ['purchase_manager','quality_inspector','supervisor','sales_manager','dispatch']) { await f.person(role,role); assert.equal((await f.call('/erp/admin/audit',undefined,role)).status,403); }
  f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run('other','Other factory',Date.now());
  await f.env.DB.batch([audit(f.env.DB,{...m,workspace_id:'other'},'user.created',id)]);
  assert.equal((await f.call('/erp/admin/audit?actor='+f.adminId)).data.events.every(r=>r.created_at===1800000000000),true);
});
test('audit rows written before this migration survive it', () => {
  const sql=new DatabaseSync(':memory:'); migrate(sql,legacyMigrations); liveShapedRows(sql);
  migrate(sql,readdirSync(dir).filter(f=>f.endsWith('.sql')&&f>='0004'&&f<'0006').sort());
  const old={...sql.prepare('SELECT * FROM erp_audit_events').get()}; migrate(sql,['0006_audit.sql']);
  const row=sql.prepare('SELECT * FROM erp_audit_events').get(); for(const [key,value] of Object.entries(old)) assert.equal(row[key],value);
  assert.equal(row.actor_role,''); assert.equal(row.object_type,'');
});
async function bidFixture() {
  const f=await portalFixture(), sid=crypto.randomUUID(), rid=crypto.randomUUID(), id=crypto.randomUUID(), now=Date.now();
  f.sql.prepare("INSERT INTO suppliers(id,workspace_id,name,contact_name,email,phone,city,website,status,created_at,updated_at) VALUES(?,?,'Mill','Contact','mill@test.com','+923001234567','Karachi','','approved',?,?)").run(sid,f.workspaceId,now,now);
  f.sql.prepare("INSERT INTO procurement_rfqs(id,workspace_id,reference,title,category_id,specifications,quantity_milli,unit,delivery_location,deadline_at,requested_delivery_at,status,request_hash,created_by,created_at) VALUES(?,?,'RFQ-test','Cotton','cotton','Cotton yarn',1000,'kg','Karachi',?,?,'open','hash',?,?)").run(rid,f.workspaceId,now+86400000,now+86400000,f.adminId,now);
  f.sql.prepare("INSERT INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) VALUES(?,?,'{}',?)").run(rid,sid,now);
  f.sql.prepare("INSERT INTO supplier_bids(id,rfq_id,supplier_id,quantity_milli,price_minor,currency,payment_terms,delivery_at,valid_until,note,status,created_at,updated_at) VALUES(?,?,?,1000,10000,'PKR','Net 30',?,?,'Freight included','submitted',?,?)").run(id,rid,sid,now+86400000,now+86400000,now,now);
  f.sql.prepare("INSERT INTO supplier_bid_history(id,bid_id,version,snapshot,actor_id,created_at) VALUES(?,?,1,'{}',?,?)").run(crypto.randomUUID(),id,f.adminId,now);
  return {...f,id};
}
test('legacy bid rejection survives migration 0006 and audits once', async () => {
  const f=await bidFixture(), body={id:f.id,version:1,reason:'Price above budget'};
  assert.equal((await f.call('/erp/bids/reject',{...body,version:2})).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM erp_audit_events').get().n,0);
  assert.equal((await f.call('/erp/bids/reject',body)).status,200);
  const rows=f.sql.prepare('SELECT * FROM erp_audit_events').all(); assert.equal(rows.length,1); assert.equal(rows[0].reason,body.reason);
  assert.equal(rows[0].actor_role,'admin'); assert.equal(rows[0].object_type,'bid'); assert.equal(rows[0].created_by,f.adminId); assert.equal(rows[0].updated_at,rows[0].created_at); assert.equal(rows[0].status,'recorded');
  const history=f.sql.prepare('SELECT * FROM supplier_bid_history').all();
  for(const version of [1,2]) assert.equal((await f.call('/erp/bids/reject',{...body,version})).status,409);
  assert.deepEqual(f.sql.prepare('SELECT * FROM supplier_bid_history').all(),history); assert.deepEqual(f.sql.prepare('SELECT * FROM erp_audit_events').all(),rows);
});
test('supplier and buyer reviews store reasons and actual before/after statuses', async () => {
  const f=await bidFixture(), supplierId=f.sql.prepare('SELECT supplier_id FROM supplier_bids WHERE id=?').get(f.id).supplier_id;
  const buyerId=await f.insertBuyer({status:'active'});
  for(const [object,id,previous,path] of [['supplier',supplierId,'approved','/erp/suppliers/review'],['buyer',buyerId,'active','/erp/sales/buyers/review']]) {
    const body={id,status:'suspended',version:1,reason:'Company review required',...(object==='supplier'?{categories:['cotton']}:{interventionReason:'Covering for the sales manager'})};
    assert.equal((await f.call(path,{...body,reason:'bad'})).status,422);
    assert.equal((await f.call(path,body)).status,200);
    const row=f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=?').get(object+'.suspended');
    assert.equal(row.reason,body.reason); assert.deepEqual(JSON.parse(row.old_json),{status:previous}); assert.deepEqual(JSON.parse(row.new_json),{status:'suspended'});
    assert.equal((await f.call(path,body)).status,409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM erp_audit_events WHERE action=?').get(object+'.suspended').n,1);
  }
});
test('a buyer review that loses a race writes no audit or status change', async () => {
  const f=await portalFixture(), id=await f.insertBuyer({status:'active'});
  const before=f.sql.prepare('SELECT * FROM erp_audit_events').all(), batch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
    f.sql.prepare('UPDATE buyers SET version=version+1 WHERE id=?').run(id);
    return batch(statements);
  };
  assert.equal((await f.call('/erp/sales/buyers/review',{id,status:'suspended',version:1,reason:'Company review required',interventionReason:'Covering for the sales manager'})).status,409);
  assert.equal(f.sql.prepare('SELECT status FROM buyers WHERE id=?').get(id).status,'active');
  assert.deepEqual(f.sql.prepare('SELECT * FROM erp_audit_events').all(),before);
});
test('a bid rejection losing at the same timestamp emits no duplicate audit', async () => {
  const f=await bidFixture(), m=await f.member('Anas'), batch=f.env.DB.batch, now=Date.now(), original=Date.now;
  Date.now=()=>now;
  try {
    f.env.DB.batch=async statements=>{
      f.sql.prepare("UPDATE supplier_bids SET status='rejected',rejection_reason='Price above budget',updated_at=? WHERE id=?").run(now,f.id);
      await batch([audit(f.env.DB,m,'bid.rejected',f.id,{},'staff',{reason:'Price above budget'})]);
      return batch(statements);
    };
    assert.equal((await f.call('/erp/bids/reject',{id:f.id,version:1,reason:'Price above budget'})).status,409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM erp_audit_events').get().n,1);
  } finally { Date.now=original; }
});
