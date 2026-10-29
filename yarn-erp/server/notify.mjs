import { all, one, query, json, fail, keys, recordId, role, viewer } from './erp-utils.mjs';
import { settingsOf } from './governance.mjs';

export const EVENTS = ['supplier.pending','buyer.pending','buyer_rfq.received','bid.received','bidding.closed','award.pending_approval','lot.ready','inspection.submitted','inspection.decided','approval.pending','approval.decided','claim.created','claim.decided','stock_query.created','stock_issue.raised','payment.due_soon','payment.due_today','payment.overdue','dispatch.approval_requested','dispatch.approved','dispatch.held','dispatch.hold_notice','reminder'];
const ROLES = ['admin','purchase_manager','quality_inspector','supervisor','sales_manager','dispatch'];
// SQL generates a different UUID for every recipient of an INSERT SELECT.
const UUID = "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))";
const COLUMNS = 'id,workspace_id,user_id,role,event,object_type,object_id,label,status,created_by,created_at,updated_at,read_at,since';
function notice(db, workspaceId, field, recipient, event, objectType, objectId, label) {
  const now = Date.now();
  return query(db, `INSERT INTO notifications(${COLUMNS})
    SELECT ${UUID},workspace_id,id,portal_role,?,?,?,?,'unread','system:notifications',?,?,NULL,NULL
    FROM users WHERE workspace_id=? AND ${field}=? AND status='active' AND deactivated_at IS NULL`,
    event, objectType, objectId, label, now, now, workspaceId, recipient);
}
export const notifyRole = (db, workspaceId, role, event, objectType, objectId, label = '') => notice(db, workspaceId, 'portal_role', role, event, objectType, objectId, label);
export const notifyUser = (db, workspaceId, userId, event, objectType, objectId, label = '') => notice(db, workspaceId, 'id', userId, event, objectType, objectId, label);

export async function notificationsApi(request, env, member, path, data) {
  const db = env.DB, base = '/api/erp/notifications';
  if (request.method === 'GET') {
    viewer(member, ...ROLES);
    if (path === base) {
      const notifications = await all(db, 'SELECT id,event,object_type,object_id,label,status,created_at FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 100', member.workspace_id, member.user_id);
      const { unread } = await one(db, "SELECT COUNT(*) AS unread FROM notifications WHERE workspace_id=? AND user_id=? AND status='unread'", member.workspace_id, member.user_id);
      return json({ notifications, unread });
    }
  } else {
    role(member, data, ...ROLES);
    if (request.method === 'POST' && path === base + '/read') {
      keys(data, ['ids','all','interventionReason']);
      if (data.all !== undefined ? data.all !== true || data.ids !== undefined : !Array.isArray(data.ids)) fail(422, 'Choose notification IDs or all.');
      const ids = data.all ? [] : [...new Set(data.ids.map(recordId))];
      if (ids.length > 100) fail(422, 'Choose at most 100 notification IDs.');
      if (!data.all && !ids.length) return json({ read: 0 });
      const now = Date.now();
      const result = await query(db, `UPDATE notifications SET status='read',read_at=?,updated_at=? WHERE workspace_id=? AND user_id=? AND status='unread'${data.all ? '' : ` AND id IN (${ids.map(() => '?').join(',')})`}`, now, now, member.workspace_id, member.user_id, ...ids).run();
      return json({ read: result.meta.changes });
    }
  }
  fail(404, 'Notification route not found.');
}

export const PENDING_SOURCES = [{ objectType: 'approval', role: 'admin', sql: "SELECT id, workspace_id, type AS label, created_at AS since FROM approval_requests WHERE status='pending' AND created_at <= ?" }];
export async function remindersScheduled(env, now = Date.now()) {
  const db = env.DB;
  let checked = 0, created = 0;
  for (const workspace of await all(db, 'SELECT id FROM workspaces')) {
    const { reminder_hours } = await settingsOf(db, workspace.id), cutoff = now - reminder_hours * 3600000;
    for (const source of PENDING_SOURCES) {
      const pending = await all(db, `SELECT * FROM (${source.sql}) WHERE workspace_id=?`, cutoff, workspace.id);
      checked += pending.length;
      for (const item of pending) {
        // Re-read the pending episode inside the insert, so a decision or re-pend
        // between selection and insertion cannot emit a stale reminder.
        const [result] = await db.batch([query(db, `INSERT INTO notifications(${COLUMNS})
          SELECT ${UUID},u.workspace_id,u.id,u.portal_role,'reminder',?,p.id,p.label,'unread','system:reminders',?,?,NULL,p.since
          FROM (${source.sql}) p JOIN users u ON u.workspace_id=p.workspace_id
          WHERE p.workspace_id=? AND p.id=? AND p.since=? AND u.portal_role=? AND u.status='active' AND u.deactivated_at IS NULL
          ON CONFLICT(object_type,object_id,since,user_id) WHERE event='reminder' DO NOTHING`,
          source.objectType, now, now, cutoff, workspace.id, item.id, item.since, source.role)]);
        created += result.meta.changes;
      }
    }
  }
  return { checked, created };
}
