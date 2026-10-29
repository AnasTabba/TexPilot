import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { remindersScheduled } from '../server/notify.mjs';
const fixture = async () => { const f = await portalFixture(); await f.person('Pervaiz', 'purchase_manager'); await f.person('Inspector', 'quality_inspector'); return f; };
const status = (f, id) => f.sql.prepare('SELECT status FROM suppliers WHERE id=?').get(id).status;
const version = (f, id) => f.sql.prepare('SELECT version FROM suppliers WHERE id=?').get(id).version;
const review = (f, id, to, extra = {}, as = 'Pervaiz') => f.call('/erp/suppliers/review', { id, status: to, version: version(f, id), ...extra }, as);
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=? ORDER BY created_at').all(action);

test('the purchase manager approves or rejects pending suppliers; rejection needs a reason', async () => {
  const f = await fixture(), s = await f.insertSupplier({});
  assert.equal((await f.call('/erp/suppliers/review', { id: s, status: 'rejected', version: 1 }, 'Pervaiz')).status, 422);
  assert.equal(status(f, s), 'pending');
  assert.equal((await review(f, s, 'rejected', { reason: 'Could not verify the NTN' })).status, 200);
  assert.equal(status(f, s), 'rejected');
  const [row] = audits(f, 'supplier.rejected');
  assert.equal(row.reason, 'Could not verify the NTN'); assert.equal(row.old_json, '{"status":"pending"}'); assert.equal(row.actor_role, 'purchase_manager');
  const rev = f.sql.prepare('SELECT created_by,actor_id,created_at,updated_at FROM supplier_registration_reviews WHERE supplier_id=?').get(s);
  assert.equal(rev.created_by, rev.actor_id); assert.equal(rev.updated_at, rev.created_at);
});
test('nobody adds suppliers from the factory side', async () => {
  const f = await fixture(), body = { id: crypto.randomUUID(), name: 'Directory Mill', contactName: 'Desk', email: 'd@mill.test', phone: '+923001234567', categories: ['cotton'] };
  for (const as of ['Pervaiz', 'Anas']) assert.equal((await f.call('/erp/suppliers', body, as)).status, 404);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n, 0);
});
test('statuses move only pending to approved or rejected and approved to and from suspended', async () => {
  const f = await fixture(), s = await f.insertSupplier({}), r = await f.insertSupplier({}), p = await f.insertSupplier({});
  await review(f, r, 'rejected', { reason: 'Could not verify the NTN' });
  const blocked = await review(f, r, 'approved'); assert.equal(blocked.status, 409); assert.match(blocked.data.error ?? blocked.text, /cannot move from rejected to approved/);
  assert.equal((await review(f, p, 'suspended', { reason: 'Not yet approved' })).status, 409);
  assert.equal((await review(f, s, 'approved')).status, 200);
  assert.equal((await review(f, s, 'suspended')).status, 422); assert.equal(status(f, s), 'approved');
  assert.equal((await review(f, s, 'suspended', { reason: 'Late deliveries again' })).status, 200); assert.equal(status(f, s), 'suspended');
  assert.equal((await review(f, s, 'approved')).status, 200); assert.equal(status(f, s), 'approved');
});
test('the list filters by status and category and hides directory contacts', async () => {
  const f = await fixture(), dyes = await f.insertSupplier({ categories: ['dyes'] });
  await f.insertSupplier({}); await f.insertSupplier({ status: 'directory' }); await f.insertSupplier({ status: 'approved', categories: ['dyes'] });
  const list = async q => (await f.call('/erp/suppliers' + q, undefined, 'Pervaiz')).data.suppliers;
  assert.equal((await list('')).length, 3); assert.ok((await list('')).every(s => s.status !== 'directory'));
  assert.deepEqual((await list('?status=pending&category=dyes')).map(s => s.id), [dyes]);
  assert.equal((await list('?status=approved')).length, 1);
  assert.equal((await f.call('/erp/suppliers?status=directory', undefined, 'Pervaiz')).status, 422);
  assert.equal((await f.call('/erp/suppliers', undefined, 'Inspector')).status, 403);
});
test('other roles cannot review; an admin needs an intervention reason', async () => {
  const f = await fixture(), s = await f.insertSupplier({});
  assert.equal((await review(f, s, 'approved', {}, 'Inspector')).status, 403);
  assert.equal((await review(f, s, 'approved', {}, 'Anas')).status, 422); assert.equal(status(f, s), 'pending');
  assert.equal((await review(f, s, 'approved', { interventionReason: 'Purchase manager away this week' }, 'Anas')).status, 200);
  assert.equal(audits(f, 'supplier.approved')[0].intervention_reason, 'Purchase manager away this week');
});
test('the profile edit is versioned, audited with before and after, and replaces categories', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' });
  const edit = (extra, v = version(f, s)) => f.call('/erp/suppliers/profile', { id: s, version: v, ...extra }, 'Pervaiz');
  assert.equal((await edit({ city: 'Lahore', phone: '+923111234567', categories: ['dyes', 'cotton'] })).status, 200);
  const row = f.sql.prepare('SELECT city,phone,version FROM suppliers WHERE id=?').get(s);
  assert.deepEqual({ ...row }, { city: 'Lahore', phone: '+923111234567', version: 2 });
  assert.deepEqual(f.sql.prepare('SELECT category_id FROM supplier_category_links WHERE supplier_id=? ORDER BY 1').all(s).map(c => c.category_id), ['cotton', 'dyes']);
  const [a] = audits(f, 'supplier.profile_updated'); assert.equal(JSON.parse(a.old_json).city, 'Karachi'); assert.equal(JSON.parse(a.new_json).city, 'Lahore');
  assert.equal((await edit({ city: 'Multan' }, 1)).status, 409); assert.equal(f.sql.prepare('SELECT city FROM suppliers WHERE id=?').get(s).city, 'Lahore');
  assert.equal((await edit({ name: 'Renamed' })).status, 422);
});
test('ratings are 1 to 5, kept as history and averaged on the profile', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' });
  const rate = (rating, extra = {}) => f.call('/erp/suppliers/rate', { id: crypto.randomUUID(), supplierId: s, rating, ...extra }, 'Pervaiz');
  assert.equal((await rate(4, { feedback: 'On time' })).status, 200); assert.equal((await rate(5)).status, 200);
  const profile = (await f.call('/erp/suppliers/' + s, undefined, 'Pervaiz')).data;
  assert.deepEqual(profile.performance, { manualAverage: 4.5, ratingCount: 2 });
  assert.deepEqual(profile.ratings.map(r => r.rating).sort(), [4, 5]); assert.equal(profile.ratings.find(r => r.rating === 4).created_by_name, 'Pervaiz');
  assert.equal(profile.supplier.id, s);
  assert.equal((await rate(6)).status, 422); assert.equal((await rate(0)).status, 422);
  assert.equal(audits(f, 'supplier.rated').length, 2);
  assert.throws(() => f.sql.exec('UPDATE supplier_ratings SET rating=1'));
  assert.throws(() => f.sql.exec('DELETE FROM supplier_ratings'));
  assert.equal((await f.call('/erp/suppliers/' + crypto.randomUUID(), undefined, 'Pervaiz')).status, 404);
});
test('categories include dyes, chemicals and packaging', async () => {
  const f = await fixture(), list = (await f.call('/erp/categories', undefined, 'Pervaiz')).data.categories;
  assert.equal(list.length, 9); assert.deepEqual(list.slice(-3).map(c => c.id), ['dyes', 'chemicals', 'packaging']);
  assert.ok(f.sql.prepare('SELECT * FROM supplier_categories').all().every(c => c.status === 'active' && c.created_at > 0 && c.updated_at === c.created_at && c.created_by === 'system:seed'));
});
test('a supplier pending over 24 hours reminds purchase managers', async () => {
  const f = await fixture(), now = Date.now(); await f.insertSupplier({ createdAt: now - 25 * 3600000 }); await f.insertSupplier({ createdAt: now - 3600000 });
  assert.deepEqual(await remindersScheduled(f.env, now), { checked: 1, created: 1 });
  const rows = f.sql.prepare("SELECT role,object_type FROM notifications WHERE event='reminder'").all();
  assert.deepEqual(rows.map(r => ({ ...r })), [{ role: 'purchase_manager', object_type: 'supplier' }]);
});
test('a profile edit that loses a race writes no audit, category or field change', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' }), batch = f.env.DB.batch;
  f.env.DB.batch = async statements => { f.sql.prepare('UPDATE suppliers SET version=version+1 WHERE id=?').run(s); return batch(statements); };
  const before = f.sql.prepare('SELECT COUNT(*) AS n FROM erp_audit_events').get().n;
  assert.equal((await f.call('/erp/suppliers/profile', { id: s, version: 1, city: 'Lahore', categories: ['dyes'] }, 'Pervaiz')).status, 409);
  assert.equal(f.sql.prepare('SELECT city FROM suppliers WHERE id=?').get(s).city, 'Karachi');
  assert.deepEqual(f.sql.prepare('SELECT category_id FROM supplier_category_links WHERE supplier_id=?').all(s).map(c => c.category_id), ['cotton']);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM erp_audit_events').get().n, before);
});
