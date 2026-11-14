import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { migrate, legacyMigrations, liveShapedRows, dir } from './portal-fixture.mjs';
import { fixtureDouble, uploadedDouble, analysisDouble, proofDouble, activeReleaseDouble, idemDouble } from './qc-store.test.mjs';
import * as store from '../server/qc-store.mjs';
const name='0033_incoming_fabric_qc.sql', ddl=readFileSync(new URL(name,dir),'utf8');
const prior=readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<name).sort();
const snapshot=sql=>Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'qc_%'").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
test('idempotency actor is a composite tenant parent, including direct SQL callers',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const foreign=crypto.randomUUID(),before=proofDouble(f);
 f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(foreign,'Foreign workspace double',f.now);
 assert.throws(()=>f.sql.prepare("INSERT INTO qc_idempotency(workspace_id,actor_id,route,client_key,request_id,body_sha256,state,deadline_at,lease_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'IN_PROGRESS',?,?,?,?)").run(foreign,f.ctx.user_id,'/direct-double',crypto.randomUUID(),crypto.randomUUID(),'a'.repeat(64),f.now+100,f.now+50,f.now,f.now),/FOREIGN KEY/);
 assert.deepEqual(proofDouble(f),before);assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
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
const insertDouble=(sql,table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
test('every QC child table rejects a foreign workspace through its composite foreign keys',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const release=await activeReleaseDouble(f),u=await uploadedDouble(f),a=await analysisDouble(f,u),d=await store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now),w=f.workspaceId;
 await store.appendAdjudication(f.env.DB,f.supervisor,{sample_id:f.result.sample.id,expected_revision:u.result.revision+1,outcome:'UNDETERMINED',reason:'Adjudication test double',reference_ids:[],supersedes_id:null},f.now);
 await store.issueProof(f.env.DB,f.admin,'b'.repeat(64),f.now,'c'.repeat(64));
 const incident=crypto.randomUUID(),protocol=crypto.randomUUID(),capture=u.result.captures[0];
 insertDouble(f.sql,'qc_retention_events',{id:crypto.randomUUID(),workspace_id:w,kind:'HOLD',capture_id:capture.id,actor_id:f.admin.user_id,reason:'Hold test double',expires_at:f.now+100,created_at:f.now});
 insertDouble(f.sql,'qc_audit_results',{workspace_id:w,id:crypto.randomUUID(),decision_id:d.id,outcome:'AGREE',sampling_probability:1,auditor_id:f.supervisor.user_id,created_at:f.now});
 insertDouble(f.sql,'qc_incidents',{workspace_id:w,id:incident,release_id:release.id,domain_id:'domain-test-double',kind:'incident-test-double',cutoff_at:f.now,detail_json:'{}',created_by:f.admin.user_id,created_at:f.now});
 insertDouble(f.sql,'qc_recalls',{workspace_id:w,incident_id:incident,decision_id:d.id,sample_id:f.result.sample.id,created_at:f.now});
 insertDouble(f.sql,'qc_recall_outbox',{workspace_id:w,incident_id:incident,recipient_id:f.ctx.user_id,state:'PENDING',created_at:f.now,updated_at:f.now});
 insertDouble(f.sql,'qc_monitoring_protocols',{workspace_id:w,id:protocol,version:'protocol-test-double',release_id:release.id,sha256:'a'.repeat(64),json:'{}',created_by:f.admin.user_id,created_at:f.now});
 insertDouble(f.sql,'qc_monitoring_runs',{workspace_id:w,id:crypto.randomUUID(),protocol_id:protocol,release_id:release.id,window_start:0,window_end:1,state:'UNAVAILABLE',counters_json:'{}',incident_id:incident,created_at:f.now});
 const foreign=crypto.randomUUID();insertDouble(f.sql,'workspaces',{id:foreign,name:'Foreign workspace test double',created_at:f.now});
 const tables=['qc_po_specs','qc_selections','qc_samples','qc_capture_sets','qc_captures','qc_evidence','qc_decisions','qc_adjudications','qc_idempotency','qc_decision_events','qc_retention_events','qc_reauth_proofs','qc_audit_results','qc_incidents','qc_recalls','qc_recall_outbox','qc_monitoring_protocols','qc_monitoring_runs'];
 const before=proofDouble(f);
 for(const table of tables){
  const row={...f.sql.prepare(`SELECT * FROM ${table}${table==='qc_decision_events'?' WHERE sample_id IS NOT NULL':''} LIMIT 1`).get(),workspace_id:foreign};assert.ok(Object.keys(row).length>1,`${table} fixture exists`);
  const fks=f.sql.prepare(`PRAGMA foreign_key_list(${table})`).all(),groups=Map.groupBy(fks,r=>r.id);
  assert.ok([...groups.values()].some(g=>g.length>1&&g.some(r=>r.from==='workspace_id')),`${table} has a composite tenant FK`);
  if(row.id)row.id=crypto.randomUUID();if(row.request_id&&table==='qc_idempotency')row.request_id=crypto.randomUUID();if(row.proof_hash)row.proof_hash='d'.repeat(64);if(row.seq)delete row.seq;
  if(table==='qc_captures'){
   const claim={...f.sql.prepare('SELECT * FROM qc_blob_claims WHERE object_key=?').get(row.object_key),object_key:'qc/foreign-parent-test-double',state:'PENDING'};
   insertDouble(f.sql,'qc_blob_claims',claim);f.sql.prepare("UPDATE qc_blob_claims SET state='REFERENCED' WHERE object_key=?").run(claim.object_key);row.object_key=claim.object_key;
  }
  // Isolate the FK itself from semantic BEFORE INSERT checks. DDL is transactional and
  // rolled back immediately; the existing test above also exercises the live triggers.
  f.sql.exec('SAVEPOINT fk_probe_double');
  try{
   for(const trigger of f.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND upper(sql) LIKE '%BEFORE INSERT%'").all(table))f.sql.exec(`DROP TRIGGER "${trigger.name}"`);
   assert.throws(()=>insertDouble(f.sql,table,row),/FOREIGN KEY constraint failed/,table);
  }finally{f.sql.exec('ROLLBACK TO fk_probe_double;RELEASE fk_probe_double');}
  assert.deepEqual(proofDouble(f),before,table);
 }
 assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
test('immutable specs, evidence, decisions and events reject UPDATE and DELETE without changing any row',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f),a=await analysisDouble(f,u);await store.finalizeQC(f.env.DB,f.ctx,a,u.result.revision,f.now);
 for(const table of ['qc_po_specs','qc_evidence','qc_decisions','qc_decision_events']){
  const before=f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),proof=proofDouble(f);
  assert.ok(before.length>0);for(const sql of [`UPDATE ${table} SET created_at=created_at+1`,`DELETE FROM ${table}`]){assert.throws(()=>f.sql.exec(sql),/immutable/);assert.deepEqual(f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),before);assert.deepEqual(proofDouble(f),proof);}
 }
});
const stableRowsDouble=rows=>rows.map(row=>JSON.stringify(row)).sort();
const allExistingDouble=sql=>Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name!='local_migrations' ORDER BY name").all().map(({name})=>[name,stableRowsDouble(sql.prepare(`SELECT * FROM "${name}"`).all())]));
const oldReaderDouble=sql=>{
 const source=readFileSync(new URL('../server/inventory.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('async function snapshot('),source.indexOf('\n  return { workspace, member,'));
 const queries=[...body.matchAll(/(?:first|rows)\(db,\s*(['"`])([\s\S]*?)\1,\s*w\)/g)].map(m=>m[2]);assert.equal(queries.length,11,'all /api/workspace SELECTs, including the admin branch');
 return queries.map(query=>stableRowsDouble(sql.prepare(query).all('factory')));
};
// Same local ledger and BEGIN IMMEDIATE ordering as scripts/dev-server.mjs; no server or network.
function devRunnerDouble(sql,files){
 sql.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');let applied=0;
 for(const file of files){const key=file.slice(0,-4);if(sql.prepare('SELECT name FROM local_migrations WHERE name=?').get(key))continue;
  sql.exec('BEGIN IMMEDIATE');try{sql.exec(readFileSync(new URL(file,dir),'utf8'));sql.prepare('INSERT INTO local_migrations VALUES(?)').run(key);sql.exec('COMMIT');applied++;}catch(e){sql.exec('ROLLBACK');throw e;}
 }return applied;
}
for(const mode of ['empty','populated','interrupted','dev replay'])test(`D06 migration ${mode}: every prior table/view and old reader survives with clean integrity`,async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL');migrate(sql,legacyMigrations);if(mode!=='empty')liveShapedRows(sql);migrate(sql,prior.filter(n=>!legacyMigrations.includes(n)));
 if(mode==='dev replay'){sql.exec('CREATE TABLE local_migrations(name TEXT PRIMARY KEY)');for(const file of prior)sql.prepare('INSERT INTO local_migrations VALUES(?)').run(file.slice(0,-4));}
 const before=allExistingDouble(sql),readers=oldReaderDouble(sql),qcBefore=Object.fromEntries(['qc_inspections','qc_lots'].map(table=>[table,sql.prepare(`SELECT * FROM ${table}`).all()]));
 if(mode==='interrupted'){
  // Split only at a complete CREATE statement, nearest the middle of the file.
  const offsets=[...ddl.matchAll(/^CREATE /gm)].map(m=>m.index),cut=offsets.find(n=>n>=ddl.length/2);sql.exec('BEGIN IMMEDIATE');sql.exec(ddl.slice(0,cut));sql.exec('ROLLBACK');assert.deepEqual(allExistingDouble(sql),before);
 }
 if(mode==='dev replay'){assert.equal(devRunnerDouble(sql,[...prior,name]),1);assert.equal(devRunnerDouble(sql,[...prior,name]),0);}else migrate(sql,[name]);
 for(const [table,rows] of Object.entries(before))assert.deepEqual(stableRowsDouble(sql.prepare(`SELECT * FROM "${table}"`).all()),rows,table);
 if(mode==='dev replay')assert.deepEqual(sql.prepare('SELECT name FROM local_migrations ORDER BY name').all().map(r=>r.name),[...prior,name].map(file=>file.slice(0,-4)));
 for(const [table,rows] of Object.entries(qcBefore))assert.deepEqual(sql.prepare(`SELECT * FROM ${table}`).all(),rows,table);
 assert.deepEqual(oldReaderDouble(sql),readers);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.deepEqual(Object.fromEntries(['qc_evidence','qc_decisions','qc_decision_events'].map(table=>[table,sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n])),{qc_evidence:0,qc_decisions:0,qc_decision_events:0});assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM qc_samples WHERE current_decision_id IS NOT NULL').get().n,0);
 const after=allExistingDouble(sql);if(mode==='dev replay')devRunnerDouble(sql,[name]);else migrate(sql,[name]);assert.deepEqual(allExistingDouble(sql),after);assert.deepEqual(oldReaderDouble(sql),readers);
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
