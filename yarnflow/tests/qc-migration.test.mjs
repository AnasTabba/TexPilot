import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { migrate, legacyMigrations, liveShapedRows, dir } from './portal-fixture.mjs';
import { fixtureDouble, uploadedDouble, analysisDouble } from './qc-store.test.mjs';
import * as store from '../server/qc-store.mjs';
const name='0033_incoming_fabric_qc.sql', ddl=readFileSync(new URL(name,dir),'utf8');
const prior=readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<name).sort();
const snapshot=sql=>Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'qc_%'").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
test('0032 is highest predecessor; migration is expand-only and has monitoring/recall tables',()=>{
 assert.equal(prior.at(-1),'0032_chat_updates.sql');assert.doesNotMatch(ddl,/\b(?:DROP|ALTER)\s+(?:TABLE|TRIGGER|INDEX)\b/i);
 for(const n of ['qc_incidents','qc_recalls','qc_monitoring_protocols','qc_monitoring_runs','qc_recall_outbox'])assert.match(ddl,new RegExp(`CREATE TABLE IF NOT EXISTS ${n} \\(`));
});
for(const populated of [false,true])test(`migration empty/populated=${populated}, interrupted rollback and replay preserve legacy values`,t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');migrate(sql,legacyMigrations);if(populated)liveShapedRows(sql);
 migrate(sql,prior.filter(n=>!legacyMigrations.includes(n)));const before=snapshot(sql);
 // Simulate an interrupted atomic migration; the original app must remain usable.
 sql.exec('BEGIN');sql.exec(ddl.slice(0,ddl.indexOf('CREATE TABLE IF NOT EXISTS qc_samples')));sql.exec('ROLLBACK');assert.deepEqual(snapshot(sql),before);
 migrate(sql,[name]);migrate(sql,[name]);assert.deepEqual(snapshot(sql),before);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 if(populated){assert.equal(sql.prepare("SELECT grams FROM stock_deltas WHERE id='receive1raw'").get().grams,10000);assert.equal(sql.prepare("SELECT quantity_milli FROM goods_receipts WHERE id='receipt'").get().quantity_milli,2000);
  for(const action of ["UPDATE erp_audit_events SET action='tamper' WHERE id='audit'","DELETE FROM erp_audit_events WHERE id='audit'"])assert.throws(()=>sql.exec(action),/immutable|append|audit/i);
 }
});
test('partially applied migration resumes idempotently without rewriting existing tables',t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');migrate(sql,prior);
 sql.exec(ddl.slice(0,ddl.indexOf('CREATE TABLE IF NOT EXISTS qc_samples')));migrate(sql,[name]);migrate(sql,[name]);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('tenant composite FKs reject foreign PO, selection, consent, sample and release parents',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const w=crypto.randomUUID();f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(w,'Other tenant double',f.now);
 assert.throws(()=>f.sql.prepare('INSERT INTO qc_selections(workspace_id,id,purchase_order_id,cohort,json,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(w,crypto.randomUUID(),f.spec.purchase_order_id,'OPERATIONAL','{}',f.ctx.user_id,f.now),/FOREIGN KEY/);
 assert.throws(()=>f.sql.prepare('INSERT INTO qc_po_specs(workspace_id,id,version,purchase_order_id,content_sha256,json,confirmed_by,reason,created_at) VALUES(?,?,1,?,?,?,?,?,?)').run(w,crypto.randomUUID(),f.spec.purchase_order_id,'a'.repeat(64),'{}',f.ctx.user_id,'Foreign parent double',f.now),/FOREIGN KEY/);
 assert.throws(()=>f.sql.prepare("INSERT INTO qc_capture_sets(workspace_id,id,sample_id,state,required_roles,created_by,created_at) VALUES(?,?,?,'OPEN','[]',?,?)").run(w,crypto.randomUUID(),f.result.sample.id,f.ctx.user_id,f.now),/FOREIGN KEY/);
 assert.throws(()=>f.sql.prepare("INSERT INTO qc_retention_events(id,workspace_id,kind,capture_id,actor_id,reason,expires_at,created_at) VALUES(?,?,'HOLD',?,?,?,?,?)").run(crypto.randomUUID(),w,crypto.randomUUID(),f.admin.user_id,'Foreign hold double',f.now+100,f.now),/FOREIGN KEY/);
 await assert.rejects(store.loadResult(f.env.DB,w,f.result.sample.id),e=>e.code==='NOT_FOUND');assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('evidence, decision and pointer cannot cross sample/spec boundaries; immutable records abort',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u);const d=await store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now);
 for(const table of ['qc_po_specs','qc_selections','qc_evidence','qc_decisions','qc_decision_events'])for(const op of [`UPDATE ${table} SET created_at=created_at+1`,`DELETE FROM ${table}`])assert.throws(()=>f.sql.exec(op),/immutable|kept|audit/);
 assert.throws(()=>f.sql.prepare('UPDATE qc_samples SET revision=revision+1,current_decision_id=? WHERE id=?').run(crypto.randomUUID(),f.result.sample.id),/FOREIGN KEY|pointer|decision/i);
 assert.equal(f.sql.prepare('SELECT id FROM qc_decisions').get().id,d.id);assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
