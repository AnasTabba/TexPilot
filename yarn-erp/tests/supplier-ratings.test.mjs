import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
const fixture = async () => { const f = await portalFixture(); await f.person('Pervaiz', 'purchase_manager'); await f.person('Inspector', 'quality_inspector'); return f; };
const body = (supplierId, extra = {}) => ({ id: crypto.randomUUID(), supplierId, delivery: 5, quality: 4, terms: 4, ...extra });
const list = async (f, as = 'Pervaiz') => (await f.call('/erp/suppliers', undefined, as)).data.suppliers;

test('a rating is saved per criterion and the supplier list shows the averages', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' }), idle = await f.insertSupplier({ status: 'approved' });
  assert.equal((await f.call('/erp/suppliers/ratings', body(s), 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/suppliers/ratings', body(s, { delivery: 3, quality: 4, terms: 5, comment: '  Two days late  ' }), 'Pervaiz')).status, 200);
  const row = f.sql.prepare('SELECT delivery,quality,terms,feedback FROM supplier_ratings WHERE supplier_id=? AND feedback!=?').get(s, '');
  assert.deepEqual({ ...row }, { delivery: 3, quality: 4, terms: 5, feedback: 'Two days late' });
  const byId = Object.fromEntries((await list(f)).map(x => [x.id, x]));
  // Six criteria: (5+4+4+3+4+5)/6 = 4.1666… → 4.2; per criterion 4, 4, 4.5.
  assert.deepEqual(byId[s].rating, { average: 4.2, delivery: 4, quality: 4, terms: 4.5, count: 2 });
  assert.equal(byId[idle].rating, null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM erp_audit_events WHERE action='supplier.rated'").get().n, 2);
  assert.equal((await f.call('/erp/suppliers/ratings', body(s), 'Pervaiz')).status, 200, 'a new record ID is accepted');
});

test('each criterion must be a whole number from 1 to 5, and the comment at most 500 characters', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' });
  for (const bad of [{ delivery: 0 }, { quality: 6 }, { terms: 2.5 }, { terms: undefined }, { comment: 'x'.repeat(501) }]) {
    const r = await f.call('/erp/suppliers/ratings', body(s, bad), 'Pervaiz');
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
  assert.equal((await f.call('/erp/suppliers/ratings', body(s, { comment: 'x'.repeat(500) }), 'Pervaiz')).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_ratings').get().n, 1);
});

test('an unknown supplier, or one that is not approved, cannot be rated', async () => {
  const f = await fixture(), pending = await f.insertSupplier({});
  assert.equal((await f.call('/erp/suppliers/ratings', body(crypto.randomUUID()), 'Pervaiz')).status, 404);
  assert.equal((await f.call('/erp/suppliers/ratings', body(pending), 'Pervaiz')).status, 409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_ratings').get().n, 0);
});

test('a role without supplier access cannot rate, and nothing is written', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' });
  assert.equal((await f.call('/erp/suppliers/ratings', body(s), 'Inspector')).status, 403);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_ratings').get().n, 0);
  assert.equal((await f.call('/erp/suppliers', undefined, 'Inspector')).status, 403);
});
