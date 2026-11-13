/**
 * Governed operational retention, separate from orphan GC and from research/training data.
 * applyQCRetention(db,bucket,now,options?) -> RetentionReport. options.ledger (or bucket.qcLedger)
 * MUST be an independently protected append-only adapter {append(event),read()->event[]}.
 * The three-argument call is safe: without that binding it reports blocked and deletes nothing.
 * A D1 bucket inside the restored database is NOT an independent recovery ledger.
 * No production ledger, signed rights register or retention approval is provided by this module.
 *
 * Before serving ANY restored DB or restoring its blobs call
 * reconcileQCRetention(db,bucket,ledger,now)->RetentionReport and refuse service if it fails.
 * Keep the ledger beyond the oldest recoverable backup, per external gates G4/G8.
 * Events use immutable globally unique ids; DB seq is local and never used as a restore cursor.
 *
 * holdQCCapture(db,adminContext,{capture_id,reason,expires_at:number},now)->RetentionEvent;
 * releaseQCHold(db,adminContext,{hold_id,reason},now)->RetentionEvent.
 * Both throw QCProblem FORBIDDEN/VALIDATION_FAILED/NOT_FOUND/CONFLICT; auth is asserted inside
 * their atomic event batch. Holds cannot be backdated after purge has acquired a claim.
 * RetentionReport={blocked,purged,deleted,held,failed,reconciled,deferred}.
 */
import { all, one, query } from './erp-utils.mjs';
import { authGuard, batchProblem, event, qcFail } from './qc-store.mjs';
const report = () => ({ blocked: false, purged: 0, deleted: 0, held: 0, failed: 0, reconciled: 0, deferred: 0 });
const guard = (db, sql, ...args) => query(db, `SELECT json('!') WHERE NOT EXISTS(${sql})`, ...args);
const columns = ['id','workspace_id','kind','capture_id','consent_id','object_key','sha256','hold_id','actor_id','reason','expires_at','created_at'];
const clean = row => Object.fromEntries(columns.map(k => [k,row[k] ?? null]));
const insertEvent = (db, row) => query(db, `INSERT OR IGNORE INTO qc_retention_events(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`, ...columns.map(k=>row[k] ?? null));
const heldSQL = `SELECT 1 FROM qc_retention_events h WHERE h.workspace_id=? AND h.capture_id=? AND h.kind='HOLD' AND h.expires_at>?
  AND NOT EXISTS(SELECT 1 FROM qc_retention_events r WHERE r.workspace_id=h.workspace_id AND r.kind='HOLD_RELEASED' AND r.hold_id=h.id)`;
const notHeld = (db,w,id,now) => guard(db, `SELECT 1 WHERE NOT EXISTS(${heldSQL})`,w,id,now);
function requireAdmin(ctx,input,now) {
  if(ctx.role!=='admin')qcFail('FORBIDDEN');
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>2000)qcFail('VALIDATION_FAILED');
  if(input.expires_at!==undefined && (!Number.isSafeInteger(input.expires_at)||input.expires_at<=now))qcFail('VALIDATION_FAILED');
}
export async function holdQCCapture(db,ctx,input,now) {
  requireAdmin(ctx,input,now);
  const capture=await one(db,'SELECT id FROM qc_captures WHERE workspace_id=? AND id=?',ctx.workspace_id,input.capture_id);if(!capture)qcFail('NOT_FOUND');
  const row=clean({id:crypto.randomUUID(),workspace_id:ctx.workspace_id,kind:'HOLD',capture_id:input.capture_id,actor_id:ctx.user_id,reason:input.reason,expires_at:input.expires_at,created_at:now});
  try {await db.batch([authGuard(db,ctx,now),guard(db,"SELECT 1 FROM qc_captures c JOIN qc_blob_claims b ON b.object_key=c.object_key WHERE c.workspace_id=? AND c.id=? AND c.original_state='AVAILABLE' AND b.state='REFERENCED'",ctx.workspace_id,input.capture_id),insertEvent(db,row),event(db,ctx,'retention.hold',row.id,{detail:{capture_id:input.capture_id,expires_at:input.expires_at},reason:input.reason},now)]);}catch(error){throw batchProblem(error);}return row;
}
export async function releaseQCHold(db,ctx,input,now) {
  requireAdmin(ctx,input,now);
  const hold=await one(db,"SELECT * FROM qc_retention_events WHERE workspace_id=? AND id=? AND kind='HOLD'",ctx.workspace_id,input.hold_id);if(!hold)qcFail('NOT_FOUND');
  const row=clean({id:crypto.randomUUID(),workspace_id:ctx.workspace_id,kind:'HOLD_RELEASED',capture_id:hold.capture_id,hold_id:hold.id,actor_id:ctx.user_id,reason:input.reason,created_at:now});
  try {await db.batch([authGuard(db,ctx,now),guard(db,"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM qc_retention_events WHERE workspace_id=? AND kind='HOLD_RELEASED' AND hold_id=?)",ctx.workspace_id,hold.id),insertEvent(db,row),event(db,ctx,'retention.hold_released',row.id,{detail:{capture_id:hold.capture_id,hold_id:hold.id},reason:input.reason},now)]);}catch(error){throw batchProblem(error);}return row;
}
async function deleteClaimed(db,bucket,now,out) {
  const rows=await all(db,"SELECT b.object_key FROM qc_blob_claims b WHERE b.state='GC_CLAIMED' AND b.purpose='RETENTION' AND EXISTS(SELECT 1 FROM qc_retention_events e WHERE e.workspace_id=b.workspace_id AND e.object_key=b.object_key AND e.kind='TOMBSTONE')");
  for(const row of rows)try {await bucket.delete(row.object_key);await query(db,"UPDATE qc_blob_claims SET state='DELETED',updated_at=? WHERE object_key=? AND state='GC_CLAIMED' AND purpose='RETENTION'",now,row.object_key).run();out.deleted++;}catch {out.failed++;await query(db,'UPDATE qc_blob_claims SET attempts=attempts+1,updated_at=? WHERE object_key=?',now,row.object_key).run();}
}
async function publishTombstone(db,row,now) {
  await db.batch([
    guard(db,"SELECT 1 FROM qc_captures c JOIN qc_blob_claims b ON b.object_key=c.object_key WHERE c.workspace_id=? AND c.id=? AND c.object_key=? AND c.original_sha256=? AND b.state='GC_CLAIMED' AND b.purpose IN ('RETENTION_PENDING','RETENTION')",row.workspace_id,row.capture_id,row.object_key,row.sha256),
    query(db,"UPDATE qc_captures SET original_state='PURGED' WHERE workspace_id=? AND id=? AND original_state='AVAILABLE'",row.workspace_id,row.capture_id),
    query(db,"UPDATE qc_blob_claims SET purpose='RETENTION',updated_at=? WHERE workspace_id=? AND object_key=?",now,row.workspace_id,row.object_key),
  ]);
}
export async function applyQCRetention(db,bucket,now,options={}) {
  const out=report(),ledger=options.ledger ?? bucket?.qcLedger;
  if(!ledger?.append||!ledger?.read||!bucket?.delete){out.blocked=true;return out;}
  // Protect rights withdrawals/holds before any destructive action; failure blocks this pass.
  try {for(const row of await all(db,"SELECT * FROM qc_retention_events WHERE kind!='TOMBSTONE' ORDER BY seq"))await ledger.append(clean(row));}
  catch {out.blocked=true;out.failed++;return out;}
  const candidates=await all(db,`SELECT c.* FROM qc_captures c JOIN qc_consent_authorities a ON a.workspace_id=c.workspace_id AND a.id=c.consent_id
    WHERE c.original_state='AVAILABLE' AND (c.retain_until<=? OR a.withdrawn_at IS NOT NULL) ORDER BY c.created_at,c.id LIMIT 200`,now);
  for(const c of candidates) {
    if(await one(db,heldSQL,c.workspace_id,c.id,now)){out.held++;continue;}
    let tombstone=await one(db,"SELECT * FROM qc_retention_events WHERE workspace_id=? AND capture_id=? AND kind='TOMBSTONE'",c.workspace_id,c.id);
    if(!tombstone){
      tombstone=clean({id:crypto.randomUUID(),workspace_id:c.workspace_id,kind:'TOMBSTONE',capture_id:c.id,object_key:c.object_key,sha256:c.original_sha256,actor_id:'system:qc-retention',reason:'Registered operational retention expired or consent withdrawn',created_at:now});
      try {await db.batch([notHeld(db,c.workspace_id,c.id,now),guard(db,"SELECT 1 FROM qc_captures c JOIN qc_consent_authorities a ON a.workspace_id=c.workspace_id AND a.id=c.consent_id JOIN qc_blob_claims b ON b.object_key=c.object_key WHERE c.workspace_id=? AND c.id=? AND c.original_state='AVAILABLE' AND (c.retain_until<=? OR a.withdrawn_at IS NOT NULL) AND b.state='REFERENCED'",c.workspace_id,c.id,now),insertEvent(db,tombstone),query(db,"UPDATE qc_blob_claims SET state='GC_CLAIMED',purpose='RETENTION_PENDING',updated_at=? WHERE workspace_id=? AND object_key=?",now,c.workspace_id,c.object_key)]);}catch {out.failed++;continue;}
    }
    try {await ledger.append(clean(tombstone));await publishTombstone(db,tombstone,now);out.purged++;}catch {out.failed++;}
  }
  await deleteClaimed(db,bucket,now,out);return out;
}
/** Mandatory restore barrier. Never assume a DB snapshot also contains the later deletion log. */
export async function reconcileQCRetention(db,bucket,ledger,now) {
  if(!ledger?.read||!ledger?.append||!bucket?.delete)qcFail('SERVICE_UNAVAILABLE',[],'Restore requires the protected monotonic deletion ledger.');
  const out=report();
  for(const raw of await ledger.read()) {
    const e=clean(raw);
    if(!['HOLD','HOLD_RELEASED','WITHDRAWAL','TOMBSTONE'].includes(e.kind)||!e.id||!e.workspace_id)qcFail('SERVICE_UNAVAILABLE');
    if(e.kind==='WITHDRAWAL'){
      const row=await one(db,'SELECT withdrawn_at FROM qc_consent_authorities WHERE workspace_id=? AND id=?',e.workspace_id,e.consent_id);
      if(!row){out.deferred++;continue;}
      await db.batch([insertEvent(db,e),query(db,'UPDATE qc_consent_authorities SET withdrawn_at=? WHERE workspace_id=? AND id=? AND withdrawn_at IS NULL',e.created_at,e.workspace_id,e.consent_id)]);
    }else {
      const row=await one(db,'SELECT * FROM qc_captures WHERE workspace_id=? AND id=?',e.workspace_id,e.capture_id);
      if(!row){if(e.kind==='TOMBSTONE')await bucket.delete(e.object_key);out.deferred++;continue;}
      if(e.kind==='TOMBSTONE'){
        if(row.object_key!==e.object_key||row.original_sha256!==e.sha256)qcFail('SERVICE_UNAVAILABLE',[],'Recovery ledger does not match the stored original.');
        await db.batch([insertEvent(db,e),query(db,"UPDATE qc_blob_claims SET state='GC_CLAIMED',purpose='RETENTION_PENDING',updated_at=? WHERE workspace_id=? AND object_key=? AND state='REFERENCED'",now,e.workspace_id,e.object_key)]);
        const claim=await one(db,'SELECT state FROM qc_blob_claims WHERE object_key=?',e.object_key);
        if(claim.state==='GC_CLAIMED')await publishTombstone(db,e,now);
        else if(claim.state!=='DELETED')qcFail('SERVICE_UNAVAILABLE');
        // Re-delete even if the restored DB already says DELETED: separately restored blobs may lag.
        await bucket.delete(e.object_key);
      }else await db.batch([insertEvent(db,e)]);
    }
    out.reconciled++;
  }
  await deleteClaimed(db,bucket,now,out);return out;
}
