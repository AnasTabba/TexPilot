import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
const remove = '/erp/admin/users/remove', users = '/erp/admin/users';
test('an admin removes a regular member: sessions end, sign-in fails, and the person leaves the team list', async () => {
  const f = await portalFixture(), id = await f.person('Saima', 'supervisor');
  const signedIn = await f.login('Saima'); assert.equal(signedIn.status, 200);
  const removed = await f.call(remove, { userId: id });
  assert.equal(removed.status, 200);
  assert.equal((await f.call('/workspace', undefined, null, { Cookie: signedIn.cookie })).status, 401);
  assert.equal((await f.login('Saima')).status, 403);
  assert.ok(!(await f.call(users)).data.users.some(p => p.id === id));
  assert.ok(!(await f.call('/auth/people', undefined, null)).data.people.includes('Saima'));
  const row = f.sql.prepare('SELECT removed_at,deactivated_at FROM users WHERE id=?').get(id);
  assert.ok(row.removed_at > 0 && row.deactivated_at === row.removed_at);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM erp_audit_events WHERE action=? AND record_id=?').get('user.removed', id).n, 1);
});
test('admins cannot be removed, nobody removes themselves, and non-admins get 403', async () => {
  const f = await portalFixture(), saima = await f.person('Saima', 'supervisor');
  const fahad = (await f.member('Fahad')).user_id;
  assert.equal((await f.call(remove, { userId: fahad })).status, 403);
  assert.equal((await f.call(remove, { userId: f.adminId })).status, 403);
  assert.equal((await f.call(remove, { userId: saima }, 'Saima')).status, 403);
  assert.equal((await f.call(remove, { userId: saima }, 'Saima')).data.error, 'Your role cannot do this. Ask an admin.');
  assert.equal((await f.login('Saima')).status, 200);
});
test('unknown and already-removed people get 404 and 409', async () => {
  const f = await portalFixture(), id = await f.person('Saima', 'supervisor');
  assert.equal((await f.call(remove, { userId: '00000000-0000-4000-8000-000000000000' })).status, 404);
  assert.equal((await f.call(remove, { userId: id })).status, 200);
  assert.equal((await f.call(remove, { userId: id })).status, 409);
});
