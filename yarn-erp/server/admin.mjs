import { ROLES, userRow, validPin, randomHex, pinHash } from './auth.mjs';
import { all, one, query, json, fail, keys, text, recordId, integer, role, viewer, audit } from './erp-utils.mjs';
import { THRESHOLDS, DEFAULT_SETTINGS, settingsOf, settingValue } from './governance.mjs';
import { notifyRole } from './notify.mjs';
const roleOf = value => { if (!ROLES.includes(value)) fail(422, 'Choose a valid role.'); return value; };
const pinOf = value => { if (!validPin(value)) fail(422, 'The PIN must be exactly 4 digits.'); return value; };

export async function adminApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id;
  if (request.method === 'GET') {
    viewer(member);
    if (path === '/api/erp/admin/settings') return json({ settings: await settingsOf(db, w) });
    if (path === '/api/erp/admin/thresholds') return json({
      thresholds: await all(db, `SELECT t.type,t.value,t.currency,u.name AS updated_by_name,t.updated_at FROM thresholds t
        LEFT JOIN users u ON u.id=t.updated_by AND u.workspace_id=t.workspace_id WHERE t.workspace_id=? ORDER BY t.type`, w),
      history: await all(db, `SELECT h.type,h.old_value,h.new_value,h.old_currency,h.new_currency,u.name AS changed_by_name,h.changed_at FROM threshold_history h
        LEFT JOIN users u ON u.id=h.changed_by AND u.workspace_id=h.workspace_id WHERE h.workspace_id=? ORDER BY h.changed_at DESC,h.rowid DESC`, w),
    });
    if (path === '/api/erp/admin/audit') {
      const params = new URL(request.url).searchParams, where = ['e.workspace_id=?'], args = [w];
      for (const [key, column] of [['actor','actor_id'],['action','action'],['objectType','object_type'],['objectId','record_id']]) {
        if (params.has(key)) { where.push(`e.${column}=?`); args.push(text(params.get(key), key)); }
      }
      const timestamp = value => {
        if (!/^\d+$/.test(value)) fail(422, 'Use an epoch millisecond timestamp.');
        return integer(Number(value), 'Timestamp', 0, Number.MAX_SAFE_INTEGER);
      };
      for (const [key, operator] of [['from','>='],['to','<=']]) if (params.has(key)) { where.push(`e.created_at${operator}?`); args.push(timestamp(params.get(key))); }
      if (params.get('interventions') === '1') where.push('e.intervention_reason IS NOT NULL');
      if (params.has('before')) {
        const parts = params.get('before').split(':');
        if (parts.length !== 2) fail(422, 'Use a valid audit cursor.');
        const at = timestamp(parts[0]), id = text(parts[1], 'Audit ID');
        where.push('(e.created_at<? OR (e.created_at=? AND e.id<?))'); args.push(at, at, id);
      }
      const rows = await all(db, `SELECT e.id,e.actor_id,u.name AS actor_name,e.actor_role,e.action,e.object_type,e.record_id,e.old_json,e.new_json,e.reason,e.intervention_reason,e.detail_json,e.created_at
        FROM erp_audit_events e LEFT JOIN users u ON u.id=e.actor_id AND u.workspace_id=e.workspace_id
        WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC,e.id DESC LIMIT 101`, ...args);
      const events = rows.slice(0,100), last = events.at(-1);
      return json({ events, next: rows.length > 100 ? `${last.created_at}:${last.id}` : null });
    }
    if (path !== '/api/erp/admin/users') fail(404, 'API route not found.');
    const users = await all(db, 'SELECT id,name,portal_role AS role,status,deactivated_at,created_at,locked_until FROM users WHERE workspace_id=? AND removed_at IS NULL ORDER BY name COLLATE NOCASE', w);
    return json({ users: users.map(({ deactivated_at, locked_until, ...user }) => ({ ...user, status: deactivated_at === null ? user.status : 'deactivated', locked: locked_until > Date.now() })) });
  }
  role(member, data, 'admin');
  if (path === '/api/erp/admin/thresholds' || path === '/api/erp/admin/settings') {
    const threshold = path.endsWith('/thresholds');
    keys(data, [threshold ? 'type' : 'key','value','interventionReason']);
    const key = threshold ? data.type : data.key;
    if (threshold && !THRESHOLDS.includes(key)) fail(422, 'Choose a valid threshold.');
    const value = threshold ? integer(data.value, 'Threshold', 0, Number.MAX_SAFE_INTEGER) : settingValue(key, data.value);
    const table = threshold ? 'thresholds' : 'settings', column = threshold ? 'type' : 'key';
    const previous = await one(db, `SELECT * FROM ${table} WHERE workspace_id=? AND ${column}=?`, w, key);
    const settings = await settingsOf(db, w), currency = threshold && ['purchase','claim'].includes(key) ? settings.currency : null;
    const before = threshold ? previous?.value ?? null : previous ? JSON.parse(previous.value_json) : DEFAULT_SETTINGS[key];
    const now = Math.max(Date.now(), (previous?.updated_at ?? 0) + 1);
    // A missing-required-value insert aborts the whole batch if our snapshot lost a race.
    const guard = query(db, `INSERT INTO ${table}(workspace_id,${column}) SELECT ?,? WHERE
      (SELECT updated_at FROM ${table} WHERE workspace_id=? AND ${column}=?) IS NOT ?
      OR (SELECT ${threshold ? 'value' : 'value_json'} FROM ${table} WHERE workspace_id=? AND ${column}=?) IS NOT ?
      ${threshold ? "OR (SELECT currency FROM thresholds WHERE workspace_id=? AND type=?) IS NOT ?" : ''}`,
      w, key, w, key, previous?.updated_at ?? null, w, key, threshold ? previous?.value ?? null : previous?.value_json ?? null,
      ...(threshold ? [w,key,previous?.currency ?? null] : []));
    const write = threshold ? query(db, `INSERT INTO thresholds(workspace_id,type,value,currency,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,type) DO UPDATE SET value=excluded.value,currency=excluded.currency,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      w,key,value,currency,member.user_id,now,member.user_id,now)
      : query(db, `INSERT INTO settings(workspace_id,key,value_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      w,key,JSON.stringify(value),member.user_id,now,member.user_id,now);
    try { await db.batch([guard, write, audit(db, member, threshold ? 'threshold.changed' : 'setting.changed', key,
      threshold ? { old_currency: previous?.currency ?? null, new_currency: currency } : {}, 'staff', { before: { value: before }, after: { value } })]); }
    catch (error) {
      if (/Close open bids/.test(String(error))) fail(409, 'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.');
      if (/constraint failed|factory currency/i.test(String(error))) fail(409, 'This configuration changed. Refresh and try again.');
      throw error;
    }
    return json({ saved: true });
  }
  if (path === '/api/erp/admin/users') {
    keys(data, ['name','pin','role','interventionReason']);
    const row = await userRow({ workspaceId: w, name: text(data.name, 'Name', 2, 40), pin: pinOf(data.pin), role: roleOf(data.role), createdBy: member.user_id });
    try { await db.batch([query(db, row.sql, ...row.args), notifyRole(db, w, 'admin', 'user.added', 'user', row.args[0], data.name.trim(), member.user_id), audit(db, member, 'user.created', row.args[0], { name: data.name.trim(), role: data.role })]); }
    catch (error) { if (/UNIQUE constraint failed: users.name_key/.test(String(error))) fail(409, 'That name is already taken.'); throw error; }
    return json({ id: row.args[0] }, 201);
  }
  if (path === '/api/erp/admin/users/remove') {
    // Soft delete: history keeps pointing at the row; sessions end now. Admins are never removable.
    keys(data, ['userId']);
    const target = await one(db, 'SELECT * FROM users WHERE id=? AND workspace_id=?', recordId(data.userId), w);
    if (!target) fail(404, 'This person was not found.');
    if (target.id === member.user_id) fail(403, "You can't remove yourself.");
    if (target.portal_role === 'admin' || target.role === 'admin') fail(403, 'Admins cannot be removed.');
    if (target.removed_at !== null) fail(409, 'This person was already removed.');
    const now = Date.now();
    // Abort the batch if another account edit won after our read, as the update path does.
    const guard = query(db, 'INSERT INTO users(id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE id=? AND removed_at IS NULL AND portal_role IS ?)', target.id, target.id, target.portal_role);
    try {
      await db.batch([guard,
        query(db, 'UPDATE users SET deactivated_at=?,deactivated_by=?,removed_at=?,updated_at=? WHERE id=?', now, member.user_id, now, Math.max(now, (target.updated_at ?? 0) + 1), target.id),
        query(db, 'DELETE FROM sessions WHERE user_id=?', target.id),
        notifyRole(db, w, 'admin', 'user.removed', 'user', target.id, target.name, member.user_id),
        audit(db, member, 'user.removed', target.id, { name: target.name, role: target.portal_role }, 'staff', { before: { removed: false }, after: { removed: true } })]);
    } catch (error) {
      if (/constraint failed: users\./i.test(String(error))) fail(409, 'This account changed. Refresh and try again.');
      throw error;
    }
    return json({ saved: true });
  }
  if (path !== '/api/erp/admin/users/update') fail(404, 'API route not found.');
  keys(data, ['id','role','pin','active','interventionReason']);
  const target = await one(db, 'SELECT * FROM users WHERE id=? AND workspace_id=?', recordId(data.id), w);
  if (!target) fail(404, 'This person was not found.');
  if (data.active !== undefined && typeof data.active !== 'boolean') fail(422, 'Choose active or deactivated.');
  if (data.active === false && target.id === member.user_id) fail(409, "You can't deactivate yourself.");
  const nextRole = data.role === undefined ? target.portal_role : roleOf(data.role);
  if (data.active === true && !nextRole) fail(422, 'Choose a valid role.');
  const now = Date.now(), changes = [], events = [];
  if (data.role !== undefined && nextRole !== target.portal_role) {
    changes.push(query(db, "UPDATE users SET portal_role=?,role=?,permissions='[]' WHERE id=?", nextRole, nextRole === 'admin' ? 'admin' : 'member', target.id));
    events.push(audit(db, member, 'user.role_changed', target.id, { from: target.portal_role, to: nextRole }, 'staff', { before: { role: target.portal_role }, after: { role: nextRole } }));
  }
  if (data.active === false && target.deactivated_at === null) {
    changes.push(query(db, 'UPDATE users SET deactivated_at=?,deactivated_by=? WHERE id=?', now, member.user_id, target.id));
    events.push(audit(db, member, 'user.deactivated', target.id, {}));
  }
  if (data.active === true && (target.deactivated_at !== null || target.status !== 'active')) {
    changes.push(query(db, "UPDATE users SET deactivated_at=NULL,deactivated_by=NULL,status='active' WHERE id=?", target.id));
    events.push(audit(db, member, 'user.reactivated', target.id, {}));
  }
  if (data.pin !== undefined) {
    const salt = randomHex(), hash = await pinHash(pinOf(data.pin), salt);
    changes.push(query(db, 'UPDATE users SET pin_salt=?,pin_hash=?,failed_attempts=0,locked_until=0 WHERE id=?', salt, hash, target.id));
    events.push(audit(db, member, 'user.pin_reset', target.id, {}));
  }
  if (data.active === false || data.pin !== undefined) changes.push(query(db, 'DELETE FROM sessions WHERE user_id=?', target.id));
  if (changes.length) {
    // Abort the batch if another account edit won after our read; audit must describe the actual transition.
    const guard = query(db, `INSERT INTO users(id) SELECT ? WHERE NOT EXISTS (
      SELECT 1 FROM users WHERE id=? AND portal_role IS ? AND status=? AND deactivated_at IS ? AND updated_at IS ? AND pin_hash=?)`,
      target.id, target.id, target.portal_role, target.status, target.deactivated_at, target.updated_at, target.pin_hash);
    try { await db.batch([guard, ...changes, query(db, 'UPDATE users SET updated_at=? WHERE id=?', Math.max(now, (target.updated_at ?? 0) + 1), target.id), ...events]); }
    catch (error) {
      if (/Keep at least one admin/.test(String(error))) fail(409, 'Keep at least one admin.');
      if (/constraint failed: users\./i.test(String(error))) fail(409, 'This account changed. Refresh and try again.');
      throw error;
    }
  }
  return json({ saved: true });
}
