import { all, one, fail, integer, text, multiline, query, audit, role, viewer, reason, keys, recordId, json } from './erp-utils.mjs';
import { notifyRole } from './notify.mjs';
export const THRESHOLDS = ['purchase','inventory_adjustment','claim','dispatch_stock_issue'];
export const DEFAULT_SETTINGS = { currency: 'PKR', tax_rate_bp: 1800, invoice_format: 'INV-{YYYY}-{NNNN}', reminder_hours: 24, credit_alert_days: [7, 3] };
export async function settingsOf(db, workspaceId) {
  const settings = { ...DEFAULT_SETTINGS, credit_alert_days: [...DEFAULT_SETTINGS.credit_alert_days] };
  for (const row of await all(db, 'SELECT key,value_json FROM settings WHERE workspace_id=?', workspaceId)) settings[row.key] = JSON.parse(row.value_json);
  return settings;
}
// A supervisor's own limit (user_thresholds) wins when it is in the factory currency; otherwise the workspace threshold applies.
export async function thresholdOf(db, workspaceId, type, userId = null) {
  if (userId) {
    const personal = await one(db, `SELECT value FROM user_thresholds WHERE workspace_id=? AND user_id=? AND type=? AND
      (currency IS NULL OR currency=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=? AND key='currency'),'PKR'))`, workspaceId, userId, type, workspaceId);
    if (personal) return personal.value;
  }
  const row = await one(db, `SELECT value FROM thresholds WHERE workspace_id=? AND type=? AND
    (currency IS NULL OR currency=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=? AND key='currency'),'PKR'))`, workspaceId, type, workspaceId);
  return row?.value ?? null;
}
export function settingValue(key, value) {
  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) fail(422, 'Choose a valid setting.');
  if (key === 'currency') { if (!['PKR','USD','EUR','GBP'].includes(value)) fail(422, 'Choose a supported currency.'); return value; }
  if (key === 'tax_rate_bp') return integer(value, 'Tax rate', 0, 10000);
  if (key === 'reminder_hours') return integer(value, 'Reminder hours', 1, 720);
  if (key === 'invoice_format') {
    const format = text(value, 'Invoice format', 6, 40);
    if (format !== value || (format.match(/\{YYYY\}/g) ?? []).length !== 1 || (format.match(/\{NNNN\}/g) ?? []).length !== 1 || !/^[A-Za-z0-9/-]*$/.test(format.replace('{YYYY}', '').replace('{NNNN}', ''))) fail(422, 'Use exactly one {YYYY} and one {NNNN}, with letters, numbers, / or -.');
    return format;
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 5 || new Set(value).size !== value.length) fail(422, 'Choose 1–5 distinct credit alert days.');
  return value.map(day => integer(day, 'Credit alert days', 1, 90)).sort((a,b) => b-a);
}

// Corrections are new rows in erp_reversals (migration 0031), never edits. The client request ID is the row ID,
// so a repeated request finds its earlier row and does nothing twice.
export const reversalReason = value => multiline(value, 'Reason', 3, 500);
export async function replayed(db, id, action, objectId) {
  const prior = await one(db, 'SELECT action,object_id FROM erp_reversals WHERE id=?', id);
  if (!prior) return false;
  if (prior.action !== action || prior.object_id !== objectId) fail(409, 'This request ID was already used for a different correction.');
  return true;
}
export const reversalRow = (db, member, id, action, objectId, reasonText, now) => query(db, 'INSERT INTO erp_reversals(id,workspace_id,action,object_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',
  id, member.workspace_id, action, objectId, reasonText, member.user_id, now);

const APPROVAL_TYPES = ['purchase_award','po_change','inventory_adjustment','claim','dispatch_stock_issue','escalation'];
const APPROVAL_CHANGED = 'The item changed since this request was raised. Reload and review it again.';
const APPROVAL_DECIDED = 'This request was already decided. Reload.';
export async function needsApproval(db, workspaceId, thresholdType, amount, userId = null) {
  const threshold = await thresholdOf(db, workspaceId, thresholdType, userId);
  return { required: threshold !== null && amount >= threshold, threshold };
}
export function approvalQueries(db, member, { id = crypto.randomUUID(), type, objectType, objectId, amount, threshold, unit, payload = {} }, now) {
  // Capture currency in the INSERT, keeping the statement-array interface synchronous.
  return [query(db, `INSERT INTO approval_requests(id,workspace_id,type,object_type,object_id,amount,threshold,unit,currency,payload_json,requested_by,requested_role,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,CASE WHEN ?='minor' THEN COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=? AND key='currency'),'PKR') ELSE NULL END,?,?,?,?,?,?)`,
    id, member.workspace_id, type, objectType, objectId, amount, threshold, unit, unit, member.workspace_id, JSON.stringify(payload), member.user_id, member.role, member.user_id, now, now),
    notifyRole(db, member.workspace_id, 'admin', type === 'purchase_award' ? 'award.pending_approval' : 'approval.pending', 'approval', id, type)];
}
const approvalRow = row => ({ ...row, payload: JSON.parse(row.payload_json) });
const FINAL = 'This decision is final. Record a correction in its own screen instead.';
async function undoState(db, approval, handlers) {
  if (approval.status !== 'approved') return null;
  if (await one(db, "SELECT id FROM erp_reversals WHERE action='approval.undone' AND object_id=?", approval.id)) return { available: false, message: 'This decision was already undone.' };
  const handler = handlers[approval.type];
  if (typeof handler?.undoability !== 'function') return { available: false, message: FINAL };
  return handler.undoability(db, approval);
}
const objectValue = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export async function approvalsApi(request, env, member, path, data, handlers) {
  const db = env.DB, base = '/api/erp/approvals';
  if (request.method === 'GET') {
    viewer(member, 'admin');
    if (path === base) {
      const params = new URL(request.url).searchParams, status = params.get('status') ?? 'pending', type = params.get('type');
      if (!['pending','approved','rejected'].includes(status) || (type && !APPROVAL_TYPES.includes(type))) fail(422, 'Choose a valid approval status and type.');
      const rows = await all(db, `SELECT * FROM approval_requests WHERE workspace_id=? AND status=?${type ? ' AND type=?' : ''} ORDER BY created_at DESC,id DESC`, member.workspace_id, status, ...(type ? [type] : []));
      // An approved request says whether its decision can be undone, and why not when it cannot.
      const approvals = await Promise.all(rows.map(async row => ({ ...approvalRow(row), undo: await undoState(db, approvalRow(row), handlers) })));
      return json({ approvals });
    }
    if (path.startsWith(base + '/')) {
      const row = await one(db, 'SELECT * FROM approval_requests WHERE id=? AND workspace_id=?', recordId(path.slice(base.length + 1)), member.workspace_id);
      if (!row) fail(404, 'Approval request not found.');
      const approval = approvalRow(row), handler = handlers[approval.type];
      if (typeof handler?.describe !== 'function') fail(409, APPROVAL_CHANGED);
      let object;
      try { object = await handler.describe(db, approval); } catch { fail(409, APPROVAL_CHANGED); }
      if (!objectValue(object) || object.objectType !== approval.object_type || object.objectId !== approval.object_id || typeof object.label !== 'string' || !object.label.trim()
        || object.currency !== approval.currency || !objectValue(object.evidence) || !objectValue(object.proposed)) fail(409, APPROVAL_CHANGED);
      return json({ approval, object });
    }
  } else {
    role(member, data, 'admin');
    if (request.method === 'POST' && path === base + '/undo') {
      // Only where the handler can compensate with its own reversal (an award is undone by cancelling its PO).
      keys(data, ['id','requestId','reason','interventionReason']);
      const id = recordId(data.id), requestId = recordId(data.requestId), text = reversalReason(data.reason);
      const row = await one(db, 'SELECT * FROM approval_requests WHERE id=? AND workspace_id=?', id, member.workspace_id);
      if (!row) fail(404, 'Approval request not found.');
      if (await replayed(db, requestId, 'approval.undone', id)) return json({ approval: approvalRow(row) });
      if (row.status !== 'approved') fail(409, 'Only an approved request can be undone.');
      if (await one(db, "SELECT id FROM erp_reversals WHERE action='approval.undone' AND object_id=?", id)) fail(409, 'This decision was already undone.');
      const handler = handlers[row.type];
      if (typeof handler?.undo !== 'function') fail(409, FINAL);
      const now = Date.now(), effects = await handler.undo(db, member, approvalRow(row), { reason: text, now, requestId });
      try {
        await db.batch([...effects, reversalRow(db, member, requestId, 'approval.undone', id, text, now),
          audit(db, member, 'approval.undone', id, { type: row.type }, 'staff', { objectType: 'approval', before: { status: 'approved' }, after: { status: 'undone' }, reason: text })]);
      } catch { fail(409, 'The order changed while undoing this decision. Reload first.'); }
      return json({ approval: approvalRow(await one(db, 'SELECT * FROM approval_requests WHERE id=? AND workspace_id=?', id, member.workspace_id)) });
    }
    if (request.method === 'POST' && path === base + '/decide') {
      keys(data, ['id','decision','reason','interventionReason']);
      const id = recordId(data.id), decision = data.decision;
      if (!['approve','reject'].includes(decision)) fail(422, 'Choose approve or reject.');
      const row = await one(db, 'SELECT * FROM approval_requests WHERE id=? AND workspace_id=?', id, member.workspace_id);
      if (!row) fail(404, 'Approval request not found.');
      if (row.status !== 'pending') fail(409, APPROVAL_DECIDED);
      const decisionReason = decision === 'reject' || data.reason !== undefined ? reason(data.reason) : null;
      const handler = handlers[row.type];
      if (typeof handler?.[decision] !== 'function') fail(409, APPROVAL_CHANGED);
      const now = Date.now(), status = decision === 'approve' ? 'approved' : 'rejected';
      try {
        const effects = await handler[decision](db, member, approvalRow(row), { reason: decisionReason, now });
        // Do not filter by pending: the trigger must abort the whole batch if another admin won.
        await db.batch([
          query(db, 'UPDATE approval_requests SET status=?,decided_by=?,decided_at=?,updated_at=?,reason=? WHERE id=? AND workspace_id=?', status, member.user_id, now, now, decisionReason, id, member.workspace_id),
          ...effects,
          notifyRole(db, member.workspace_id, row.requested_role, 'approval.decided', 'approval', id, row.type),
          audit(db, member, 'approval.' + status, id, { type: row.type }, 'staff', { objectType: 'approval', before: { status: 'pending' }, after: { status }, reason: decisionReason }),
        ]);
      } catch (error) { fail(409, String(error.message).includes('approval already decided') ? APPROVAL_DECIDED : APPROVAL_CHANGED); }
      return json({ approval: approvalRow(await one(db, 'SELECT * FROM approval_requests WHERE id=? AND workspace_id=?', id, member.workspace_id)) });
    }
  }
  fail(404, 'Approval route not found.');
}
