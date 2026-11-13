/**
 * T12 recalls: mark the decisions affected by one immutable monitoring incident as RECALLED,
 * without touching the decision rows themselves.
 *
 * `recallQCDecisions(db, incident, now) -> Promise<RecallReport>` re-reads the incident from the
 * database (caller-supplied selectors are never trusted), then selects every decision in exactly
 * that incident's workspace by release id, domain id, artifact hash (when the incident names one)
 * and `created_at <= cutoff_at`. Selection is keyset-paginated in pages of 100, so a tenant with
 * more than 100 historical decisions is recalled exhaustively.
 *
 * The original `qc_decisions` row is never updated or deleted. Each affected decision gets one
 * immutable `qc_recalls` row (primary key incident+decision); the design's "current validity
 * RECALLED" is that separate row. One `qc_recall_outbox` row is written per (incident, intended
 * recipient) with delivery/ack status left at PENDING/0; this module sends nothing. Replaying the
 * same incident writes no second recall, notice or audit event.
 *
 * Intended recipients are `detail_json.recipients` when the incident names them (each must be an
 * active member of the incident's own workspace), otherwise every active admin and supervisor in
 * that workspace. A foreign or unknown recipient fails closed before any recall is written.
 */
import { all, one, query } from './erp-utils.mjs';
import { qcFail } from './qc-store.mjs';

const SYSTEM = 'system:qc-recalls';
const PAGE = 100;
const isHex64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
const STAGE_PATHS = ['quality', 'fabric', 'defects', 'metrology', 'domain'];
// The incident's artifact selector, when present, must match the evidence that produced the decision.
const ARTIFACT_SQL = `(e.manifest_sha256=? OR json_extract(e.json,'$.manifest_sha256')=? OR ${STAGE_PATHS.map(stage => `json_extract(e.json,'$.${stage}.artifact_sha256')=?`).join(' OR ')})`;

async function recipientsFor(db, workspaceId, explicit) {
  if (explicit === undefined) return (await all(db, "SELECT id FROM users WHERE workspace_id=? AND status='active' AND deactivated_at IS NULL AND portal_role IN ('admin','supervisor') ORDER BY id", workspaceId)).map(row => row.id);
  if (!Array.isArray(explicit) || explicit.length > 100 || explicit.some(id => !isText(id))) qcFail('VALIDATION_FAILED', [], 'The incident recipients are not a list of member ids.');
  const ids = [...new Set(explicit)];
  for (const id of ids) if (!await one(db, "SELECT 1 AS x FROM users WHERE workspace_id=? AND id=? AND status='active' AND deactivated_at IS NULL", workspaceId, id)) qcFail('VALIDATION_FAILED', [], 'A recall recipient is not an active member of this workspace.');
  return ids.sort();
}

export async function recallQCDecisions(db, incident, now = Date.now()) {
  if (!incident || typeof incident !== 'object' || !isText(incident.id) || !isText(incident.workspace_id)) qcFail('VALIDATION_FAILED', [], 'A recall needs an incident id and workspace.');
  if (!Number.isSafeInteger(now) || now <= 0) qcFail('VALIDATION_FAILED', [], 'A recall needs a valid UTC millisecond clock.');
  const row = await one(db, 'SELECT * FROM qc_incidents WHERE workspace_id=? AND id=?', incident.workspace_id, incident.id);
  if (!row) qcFail('NOT_FOUND', [], 'That monitoring incident does not exist in this workspace.');
  const w = row.workspace_id;
  if (!isText(row.release_id) || !isText(row.domain_id) || !Number.isSafeInteger(row.cutoff_at) || row.cutoff_at <= 0) qcFail('VALIDATION_FAILED', [], 'The incident does not name a release, domain and cutoff.');
  if (row.cutoff_at > now) qcFail('VALIDATION_FAILED', [], 'The incident cutoff is after this recall time.');
  let detail;
  try { detail = JSON.parse(row.detail_json); } catch { qcFail('VALIDATION_FAILED', [], 'The incident detail is not JSON.'); }
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) qcFail('VALIDATION_FAILED', [], 'The incident detail is not an object.');
  const release = await one(db, 'SELECT sha256 FROM qc_releases WHERE workspace_id=? AND id=?', w, row.release_id);
  if (!release) qcFail('SERVICE_UNAVAILABLE', [], 'The incident release is missing; nothing was recalled.');
  if (detail.release_sha256 !== undefined && detail.release_sha256 !== release.sha256) qcFail('VALIDATION_FAILED', [], 'The incident names a different release artifact.');
  const artifact = detail.artifact_sha256;
  if (artifact !== undefined && !isHex64(artifact)) qcFail('VALIDATION_FAILED', [], 'The incident artifact hash is not SHA-256.');
  const recipients = await recipientsFor(db, w, detail.recipients);

  let sql = 'SELECT d.id,d.sample_id,d.created_at FROM qc_decisions d WHERE d.workspace_id=? AND d.release_id=? AND d.domain_id=? AND d.created_at<=?';
  const args = [w, row.release_id, row.domain_id, row.cutoff_at];
  if (artifact !== undefined) { sql += ` AND EXISTS(SELECT 1 FROM qc_evidence e WHERE e.workspace_id=d.workspace_id AND e.id=d.evidence_id AND ${ARTIFACT_SQL})`; args.push(artifact, artifact, artifact, artifact, artifact, artifact, artifact); }
  sql += ' AND (d.created_at>? OR (d.created_at=? AND d.id>?)) ORDER BY d.created_at,d.id LIMIT ' + PAGE;

  let cursorAt = -1, cursorId = '', pages = 0, recalled = 0;
  const recalledIds = [];
  for (;;) {
    const page = await all(db, sql, ...args, cursorAt, cursorId);
    if (!page.length) break;
    pages++;
    const results = await db.batch(page.map(decision => query(db, 'INSERT OR IGNORE INTO qc_recalls(workspace_id,incident_id,decision_id,sample_id,created_at) VALUES(?,?,?,?,?)', w, row.id, decision.id, decision.sample_id, now)));
    results.forEach((result, index) => { if (Number(result.meta?.changes ?? 0) === 1) { recalled++; recalledIds.push(page[index].id); } });
    cursorAt = page[page.length - 1].created_at;
    cursorId = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }

  let created = 0;
  if (recipients.length) {
    const results = await db.batch(recipients.map(recipient => query(db, "INSERT OR IGNORE INTO qc_recall_outbox(workspace_id,incident_id,recipient_id,state,attempts,delivered_at,acked_at,created_at,updated_at) VALUES(?,?,?,'PENDING',0,NULL,NULL,?,?)", w, row.id, recipient, now, now)));
    created = results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
  }

  const total = await one(db, 'SELECT COUNT(*) AS n FROM qc_recalls WHERE workspace_id=? AND incident_id=?', w, row.id);
  // At most one recall audit event per incident; a retry writes the missing event, never a second.
  await query(db, `INSERT INTO qc_decision_events(id,workspace_id,sample_id,record_id,event,actor_id,actor_role,request_id,detail_json,reason,intervention_reason,created_at)
    SELECT ?,?,NULL,?,'recall.recorded',?,?,NULL,?,?,NULL,?
    WHERE EXISTS(SELECT 1 FROM qc_recalls WHERE workspace_id=? AND incident_id=?)
      AND NOT EXISTS(SELECT 1 FROM qc_decision_events WHERE workspace_id=? AND event='recall.recorded' AND record_id=?)`,
    crypto.randomUUID(), w, row.id, SYSTEM, 'system', JSON.stringify({ incident_id: row.id, recalled: total.n, recipients: recipients.length }), `Recall for incident ${row.id}`, now, w, row.id, w, row.id).run();

  const outbox = await all(db, 'SELECT recipient_id,state,attempts,delivered_at,acked_at FROM qc_recall_outbox WHERE workspace_id=? AND incident_id=? ORDER BY recipient_id', w, row.id);
  return {
    schema_version: '2', incident_id: row.id, workspace_id: w, release_id: row.release_id, domain_id: row.domain_id, cutoff_at: row.cutoff_at,
    recalled, already_recalled: total.n - recalled, total_recalled: total.n, pages, recalled_decision_ids: recalledIds,
    notifications: { created, total: outbox.length, pending: outbox.filter(n => n.state === 'PENDING').length, delivered: outbox.filter(n => n.state === 'DELIVERED').length, failed: outbox.filter(n => n.state === 'FAILED').length, acked: outbox.filter(n => n.acked_at !== null).length },
    recipients: outbox,
  };
}
