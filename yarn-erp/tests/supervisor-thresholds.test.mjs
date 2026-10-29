import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { thresholdOf, needsApproval } from '../server/governance.mjs';
import { userRow } from '../server/auth.mjs';
const thresholds = '/erp/admin/thresholds', personal = '/erp/admin/users/thresholds';
const rows = (f, table) => f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

test('a supervisor own limit overrides the factory limit for that supervisor only', async () => {
 const f = await portalFixture();
 const sana = await f.person('Sana', 'supervisor'), ravi = await f.person('Ravi', 'supervisor');
 assert.equal((await f.call(thresholds, { type: 'inventory_adjustment', value: 10000 })).status, 200);
 assert.equal((await f.call(thresholds, { type: 'purchase', value: 5000000 })).status, 200);
 assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: 2000 })).status, 200);
 assert.equal((await f.call(personal, { userId: sana, type: 'purchase', value: 100000, currency: 'PKR' })).status, 200);
 // Sana's stock limit is 2 kg, Ravi has none and keeps the factory 10 kg.
 assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'inventory_adjustment', sana), 2000);
 assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'inventory_adjustment', ravi), 10000);
 assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'inventory_adjustment'), 10000);
 assert.deepEqual(await needsApproval(f.env.DB, f.workspaceId, 'inventory_adjustment', 5000, sana), { required: true, threshold: 2000 });
 assert.deepEqual(await needsApproval(f.env.DB, f.workspaceId, 'inventory_adjustment', 5000, ravi), { required: false, threshold: 10000 });
 assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'purchase', sana), 100000);
 assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'purchase', ravi), 5000000);
 const read = await f.call(personal + '?userId=' + sana);
 assert.equal(read.status, 200);
 assert.deepEqual(read.data.thresholds.map(r => [r.type, r.value, r.currency]), [['inventory_adjustment', 2000, null], ['purchase', 100000, 'PKR']]);
});

test('clearing a personal limit puts the factory limit back and history records who, old and new', async () => {
 const f = await portalFixture(), sana = await f.person('Sana', 'supervisor');
 await f.call(thresholds, { type: 'inventory_adjustment', value: 10000 });
 await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: 2000 });
 assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: 2000 })).status, 200);
 assert.equal(rows(f, 'user_threshold_history').length, 1, 'an unchanged value writes nothing');
 assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: null })).status, 200);
 assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'inventory_adjustment', sana), 10000);
 const history = rows(f, 'user_threshold_history');
 assert.deepEqual(history.map(h => [h.user_id, h.type, h.old_value, h.new_value, h.changed_by]), [[sana, 'inventory_adjustment', null, 2000, f.adminId], [sana, 'inventory_adjustment', 2000, null, f.adminId]]);
 assert.equal(rows(f, 'erp_audit_events').at(-1).action, 'user_threshold.changed');
 assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: null })).status, 200);
 assert.equal(rows(f, 'user_threshold_history').length, 2);
 assert.throws(() => f.sql.exec('DELETE FROM user_threshold_history'), /immutable threshold history/);
});

test('only admins read or set personal limits; supervisors and other roles are refused', async () => {
 const f = await portalFixture(), sana = await f.person('Sana', 'supervisor');
 await f.person('Buyer', 'purchase_manager'); await f.person('Ravi', 'supervisor');
 const before = rows(f, 'user_thresholds');
 for (const as of ['Sana', 'Buyer']) {
  assert.equal((await f.call(personal + '?userId=' + sana, undefined, as)).status, 403, as);
  assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: 1 }, as)).status, 403, as);
  assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: null }, as)).status, 403, as);
 }
 assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: 1 }, null)).status, 401);
 assert.deepEqual(rows(f, 'user_thresholds'), before);
});

test('personal limits are refused for non-supervisors, bad types or numbers, other workspaces and removed people', async () => {
 const f = await portalFixture(), sana = await f.person('Sana', 'supervisor'), buyer = await f.person('Buyer', 'purchase_manager');
 await f.call(thresholds, { type: 'purchase', value: 5000000 });
 const bad = [
  [{ userId: buyer, type: 'purchase', value: 1 }, 422],
  [{ userId: sana, type: 'payroll', value: 1 }, 422],
  [{ userId: sana, type: 'inventory_adjustment', value: -1 }, 422],
  [{ userId: sana, type: 'inventory_adjustment', value: 1.5 }, 422],
  [{ userId: sana, type: 'purchase', value: 1, currency: 'BTC' }, 422],
  [{ userId: sana, type: 'purchase', value: 1, currency: 'USD' }, 409],
  [{ userId: 'b1f0c5a2-1111-4222-8333-444455556666', type: 'purchase', value: 1 }, 404],
  [{ userId: sana, type: 'purchase', value: 1, extra: true }, 422],
 ];
 for (const [body, status] of bad) assert.equal((await f.call(personal, body)).status, status, JSON.stringify(body));
 f.sql.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('other-factory','Other factory',1)").run();
 const outsider = await userRow({ workspaceId: 'other-factory', name: 'Outsider', pin: '2468', role: 'supervisor', createdBy: f.adminId });
 f.sql.prepare(outsider.sql).run(...outsider.args);
 assert.equal((await f.call(personal, { userId: outsider.args[0], type: 'inventory_adjustment', value: 1 })).status, 404);
 f.sql.prepare("UPDATE users SET removed_at=1, deactivated_at=1 WHERE id=?").run(sana);
 assert.equal((await f.call(personal, { userId: sana, type: 'inventory_adjustment', value: 1 })).status, 404);
 assert.equal(rows(f, 'user_thresholds').length, 0);
});
