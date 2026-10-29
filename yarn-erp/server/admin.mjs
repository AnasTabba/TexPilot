import { ROLES, userRow, validPin, randomHex, pinHash } from './auth.mjs';
import { all, one, query, json, fail, keys, text, recordId, role, viewer, audit } from './erp-utils.mjs';
const roleOf = value => { if (!ROLES.includes(value)) fail(422, 'Choose a valid role.'); return value; };
const pinOf = value => { if (!validPin(value)) fail(422, 'The PIN must be exactly 4 digits.'); return value; };

export async function adminApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id;
  if (request.method === 'GET') {
    viewer(member);
    if (path !== '/api/erp/admin/users') fail(404, 'API route not found.');
    const users = await all(db, 'SELECT id,name,portal_role AS role,status,deactivated_at,created_at,locked_until FROM users WHERE workspace_id=? ORDER BY name COLLATE NOCASE', w);
    return json({ users: users.map(({ deactivated_at, locked_until, ...user }) => ({ ...user, status: deactivated_at === null ? user.status : 'deactivated', locked: locked_until > Date.now() })) });
  }
  role(member, data, 'admin');
  if (path === '/api/erp/admin/users') {
    keys(data, ['name','pin','role','interventionReason']);
    const row = await userRow({ workspaceId: w, name: text(data.name, 'Name', 2, 40), pin: pinOf(data.pin), role: roleOf(data.role), createdBy: member.user_id });
    try { await db.batch([query(db, row.sql, ...row.args), audit(db, member, 'user.created', row.args[0], { name: data.name.trim(), role: data.role })]); }
    catch (error) { if (/UNIQUE constraint failed: users.name_key/.test(String(error))) fail(409, 'That name is already taken.'); throw error; }
    return json({ id: row.args[0] }, 201);
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
    events.push(audit(db, member, 'user.role_changed', target.id, { from: target.portal_role, to: nextRole }));
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
