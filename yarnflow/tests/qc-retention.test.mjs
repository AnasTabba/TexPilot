import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureDouble, uploadedDouble } from './qc-store.test.mjs';
import { DAY, loadResult, objectKey, withdrawConsent } from '../server/qc-store.mjs';
import { applyQCRetention, reconcileQCRetention, holdQCCapture, releaseQCHold } from '../server/qc-retention.mjs';
import { d1Bucket } from '../server/d1-bucket.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
// Independently protected monotonic log double: it is deliberately never part of the DB snapshot.
export function ledgerDouble(){const entries=new Map();return {async append(e){const old=entries.get(e.id);if(old)assert.deepEqual(old,e);else entries.set(e.id,structuredClone(e));},async read(){return [...entries.values()].map(e=>structuredClone(e));}};}
test('no protected recovery ledger means no destructive purge',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());await uploadedDouble(f,{close:false,count:1});const r=await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+2*DAY);assert.equal(r.blocked,true);assert.equal(r.purged,0);
});
for(const kind of ['Map','D1'])test(`${kind}: expiration tombstones capture; metadata/hash/evidence preserved`,async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());if(kind==='D1')f.env.BUCKET=d1Bucket(f.env.DB);const u=await uploadedDouble(f,{close:false,count:1}),ledger=ledgerDouble(),before=f.sql.prepare('SELECT * FROM qc_captures').get();
 assert.equal((await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+DAY-1,{ledger})).purged,0);
 assert.equal((await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+DAY,{ledger})).purged,1);
 const r=await loadResult(f.env.DB,f.workspaceId,f.result.sample.id,f.now+DAY);assert.equal(r.captures[0].original_state,'PURGED');assert.equal(r.captures[0].original_sha256,u.result.captures[0].original_sha256);assert.equal(r.revision,u.result.revision);
 const after=f.sql.prepare('SELECT * FROM qc_captures').get();assert.equal(after.json,before.json);assert.equal(await f.env.BUCKET.get(before.object_key),null);
 assert.equal((await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+DAY+1,{ledger})).purged,0);assert.equal((await ledger.read()).filter(e=>e.kind==='TOMBSTONE').length,1);
});
test('audited hold expires or releases; withdrawal blocks new access and eventually purges',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());const u=await uploadedDouble(f,{close:false,count:1}),ledger=ledgerDouble(),id=u.result.captures[0].id;
 const hold=await holdQCCapture(f.env.DB,f.admin,{capture_id:id,reason:'Legal hold double',expires_at:f.now+3*DAY},f.now);
 assert.equal((await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+2*DAY,{ledger})).held,1);await withdrawConsent(f.env.DB,f.admin,{id:f.consent.id,reason:'Consent withdrawn double'},f.now+2*DAY);
 assert.equal((await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+2*DAY,{ledger})).held,1);
 await releaseQCHold(f.env.DB,f.admin,{hold_id:hold.id,reason:'Hold released double'},f.now+2*DAY);
 assert.equal((await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+2*DAY,{ledger})).purged,1);
});
test('purge deletion failure keeps inaccessible tombstone and retryable claim',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());await uploadedDouble(f,{close:false,count:1});const ledger=ledgerDouble(),broken={...f.env.BUCKET,async delete(){throw new Error('delete failure double');}};
 const first=await applyQCRetention(f.env.DB,broken,f.now+DAY,{ledger});assert.equal(first.failed,1);assert.equal(f.sql.prepare('SELECT original_state FROM qc_captures').get().original_state,'PURGED');assert.equal(f.sql.prepare('SELECT state FROM qc_blob_claims').get().state,'GC_CLAIMED');
 const second=await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+DAY+1,{ledger});assert.equal(second.deleted,1);assert.equal(f.storage.size,0);
});
test('protected ledger failure prevents deletion or tombstone publication',async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());await uploadedDouble(f,{close:false,count:1});const ledger={async read(){return [];},async append(){throw new Error('protected log unavailable double');}};
 const r=await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+DAY,{ledger});assert.equal(r.failed,1);assert.equal(f.sql.prepare('SELECT original_state FROM qc_captures').get().original_state,'AVAILABLE');assert.equal(f.storage.size,1);
});
for(const kind of ['Map','D1'])test(`${kind}: old snapshot restore must replay monotonic deletion/withdrawal ledger before serving`,async t=>{
 const f=await fixtureDouble();t.after(()=>f.sql.close());if(kind==='D1')f.env.BUCKET=d1Bucket(f.env.DB);await uploadedDouble(f,{close:false,count:1});const ledger=ledgerDouble(),dir=mkdtempSync(join(tmpdir(),'qc-c03-restore-')),path=join(dir,'snapshot.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 f.sql.prepare('VACUUM INTO ?').run(path);const oldBytes=new Map(f.storage);
 await withdrawConsent(f.env.DB,f.admin,{id:f.consent.id,reason:'Withdrawal double'},f.now+100);await applyQCRetention(f.env.DB,f.env.BUCKET,f.now+DAY,{ledger});
 const restored=new DatabaseSync(path);t.after(()=>restored.close());restored.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL');const db=sqliteBinding(restored);
 const mapBucket={async put(k,v){oldBytes.set(k,v);},async get(k){return oldBytes.has(k)?{body:oldBytes.get(k)}:null;},async delete(k){oldBytes.delete(k);}};const bucket=kind==='D1'?d1Bucket(db):mapBucket;
 assert.equal(restored.prepare('SELECT original_state FROM qc_captures').get().original_state,'AVAILABLE');await reconcileQCRetention(db,bucket,ledger,f.now+DAY+1);
 assert.equal(restored.prepare('SELECT original_state FROM qc_captures').get().original_state,'PURGED');assert.ok(restored.prepare('SELECT withdrawn_at FROM qc_consent_authorities').get().withdrawn_at);
 const row=restored.prepare('SELECT object_key FROM qc_captures').get();assert.equal(await bucket.get(row.object_key),null);assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
 await reconcileQCRetention(db,bucket,ledger,f.now+DAY+2);assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM qc_retention_events WHERE kind='TOMBSTONE'").get().n,1);
});
