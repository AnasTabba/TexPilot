import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
// Who got a notice for an event, by name, sorted, so each assertion says exactly who was told.
const recipients = (f, event) => f.sql.prepare('SELECT u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event=? ORDER BY u.name').all(event).map(r => r.name);

test('supplier dispatch notifies the purchase manager and admin, never the supplier', async () => {
  const f = await portalFixture(); await f.person('Pervaiz', 'purchase_manager');
  const reg = await f.call('/portal/register', { company: 'Alpha Mills', contactName: 'Alpha Contact', email: 'alpha@supplier.test', phone: '+923001234567', city: 'Karachi', password: 'A strong test password 2026', categories: ['cotton'] }, null);
  assert.equal(reg.status, 201, reg.text);
  const supplierId = f.sql.prepare('SELECT supplier_id FROM supplier_users WHERE email=?').get('alpha@supplier.test').supplier_id;
  const version = f.sql.prepare('SELECT version FROM suppliers WHERE id=?').get(supplierId).version;
  assert.equal((await f.call('/erp/suppliers/review', { id: supplierId, status: 'approved', version, reason: 'Company and contact checked by the purchase manager' }, 'Pervaiz')).status, 200);
  const { orderId } = await f.insertPO({ supplierId });
  const login = await f.call('/portal/login', { email: 'alpha@supplier.test', password: 'A strong test password 2026' }, null);
  assert.equal(login.status, 200, login.text);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const sent = await f.call('/portal/dispatches', { id: crypto.randomUUID(), orderId, billOfLading: 'TESTBL100', carrier: 'Test carrier', containers: ['ABCD1234567'], quantityMilli: 60000, dispatchedAt: Date.now() - 1000, note: 'Dispatch test' }, null, { Cookie: cookie });
  assert.equal(sent.status, 201, sent.text);
  assert.deepEqual(recipients(f, 'shipment.dispatched'), ['Anas', 'Fahad', 'Pervaiz', 'Zuhair']);
});

test('registering a QC arrival notifies the quality inspector only', async () => {
  const f = await portalFixture(); await f.submitted({ acceptedMilli: 50000 });
  assert.deepEqual(recipients(f, 'lot.ready'), ['Qasim']);
});

test('finished-stock entry notifies admin and other supervisors, not the supervisor who entered it', async () => {
  const f = await portalFixture(); await f.person('Saima', 'supervisor'); await f.person('Ayesha', 'supervisor');
  await f.addFinished();
  assert.deepEqual(recipients(f, 'stock.received'), ['Anas', 'Ayesha', 'Fahad', 'Zuhair']);
});

test('a stock movement (adjustment) notifies admin and other supervisors, not the actor', async () => {
  const f = await portalFixture(); await f.person('Saima', 'supervisor'); await f.person('Ayesha', 'supervisor');
  const lotId = await f.addFinished({ grams: 10000 });
  const saved = await f.call('/erp/stock/adjustments', { id: crypto.randomUUID(), lotId, stage: 'finished', kind: 'write_off', deltaGrams: -100, reason: 'Spilled during packing' }, 'Saima');
  assert.equal(saved.status, 201, saved.text);
  assert.deepEqual(recipients(f, 'stock.adjusted'), ['Anas', 'Ayesha', 'Fahad', 'Zuhair']);
});

test('removing a team member notifies the other admins, not Anas who removed them', async () => {
  const f = await portalFixture(); const saima = await f.person('Saima', 'supervisor'); await f.person('Ops', 'admin');
  assert.equal((await f.call('/erp/admin/users/remove', { userId: saima })).status, 200);
  assert.deepEqual(recipients(f, 'user.removed'), ['Fahad', 'Ops', 'Zuhair']);
});
