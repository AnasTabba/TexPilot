import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { buyerPosition, dueAt } from '../server/sales.mjs';

const DAY = 86400000, base = '/erp/sales', uuid = () => crypto.randomUUID();
const limitPath = `${base}/buyers/credit-limit`, profilePath = `${base}/buyers/profile`;
// The admin assigns credit limits and invoice settings; the fixture admin is 'Anas'.
const admin = 'Anas';
async function setup() {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  await f.person('Qasim', 'quality_inspector');
  return f;
}
const rejects = (result, status, message) => { assert.equal(result.status, status, result.text); if (message) assert.match(result.data.error, new RegExp(message)); };
const buyerRow = async (f, buyerId) => (await f.call(`${base}/buyers/summary`, undefined, 'Sana')).data.buyers.find(b => b.id === buyerId);

test('credit limits: validation, clearing and the database pairing guard', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  const saved = { id: buyerId, amountMinor: 1000000, currency: 'PKR' };
  for (const amountMinor of [-1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) rejects(await f.call(limitPath, { ...saved, amountMinor }, admin), 422);
  rejects(await f.call(limitPath, { id: buyerId, amountMinor: 100 }, admin), 422);
  rejects(await f.call(limitPath, { ...saved, currency: 'INR' }, admin), 422, 'PKR, USD, EUR or GBP');
  rejects(await f.call(limitPath, { id: buyerId, amountMinor: null, currency: 'PKR' }, admin), 422, 'Clear the limit');
  rejects(await f.call(limitPath, { ...saved, extra: true }, admin), 422);
  rejects(await f.call(limitPath, { ...saved, id: 'not-an-id' }, admin), 422);
  rejects(await f.call(limitPath, { ...saved, id: uuid() }, admin), 404);

  const zero = await f.call(limitPath, { ...saved, amountMinor: 0 }, admin);
  assert.equal(zero.status, 200, 'a zero limit is allowed, and the admin needs no intervention reason');
  assert.deepEqual(zero.data, { saved: true, credit_limit_minor: 0, credit_limit_currency: 'PKR' });
  assert.equal((await f.call(limitPath, { ...saved, currency: 'USD' }, admin)).status, 200);
  assert.equal((await buyerRow(f, buyerId)).credit_limit_currency, 'USD');

  assert.equal((await f.call(limitPath, { id: buyerId, amountMinor: null }, admin)).status, 200);
  assert.deepEqual([(await buyerRow(f, buyerId)).credit_limit_minor, (await buyerRow(f, buyerId)).credit_limit_currency], [null, null]);
  const audits = f.sql.prepare("SELECT old_json,new_json FROM erp_audit_events WHERE action='buyer.credit_limit_changed' ORDER BY created_at,id").all();
  assert.equal(audits.length, 3, 'each saved change is audited, refused ones are not');
  assert.deepEqual(JSON.parse(audits[0].old_json), { credit_limit_minor: null, credit_limit_currency: null });

  assert.throws(() => f.sql.prepare("UPDATE buyers SET credit_limit_currency='PKR' WHERE id=?").run(buyerId), /needs both an amount and a currency/);
  rejects(await f.call(limitPath, { id: buyerId, amountMinor: 5, currency: 'PKR' }, 'Qasim'), 403);

  const archived = await f.insertBuyer({ status: 'active' });
  f.sql.prepare("UPDATE buyers SET status='archived' WHERE id=?").run(archived);
  rejects(await f.call(limitPath, { id: archived, amountMinor: 5, currency: 'PKR' }, admin), 404);
});

test('quality inspectors cannot read the buyer summary, set limits or change settings', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  rejects(await f.call(`${base}/buyers/summary`, undefined, 'Qasim'), 403);
  rejects(await f.call(`${base}/settings`, undefined, 'Qasim'), 403);
  rejects(await f.call(`${base}/settings`, { key: 'tax_rate_bp', value: 1000 }, 'Qasim'), 403);
  rejects(await f.call(limitPath, { id: buyerId, amountMinor: 5, currency: 'PKR' }, 'Qasim'), 403);
  assert.equal(f.sql.prepare('SELECT credit_limit_minor FROM buyers WHERE id=?').get(buyerId).credit_limit_minor, null);
  assert.equal((await f.call(`${base}/buyers/summary`, undefined, 'Sana')).status, 200);
});

test('the sales manager sees sold quantity, invoices, days left and credit use for a real sale, and limits only warn', async () => {
  const f = await setup();
  const q = await f.acceptedQuote({ priceMinor: 125000, creditDays: 30 }); // 100 kg at PKR 1,250.00 plus 18% GST = PKR 147,500.00
  assert.equal((await f.call(`${base}/sales`, { id: uuid(), revisionId: q.revisionId }, 'Sana')).status, 201);
  let row = await buyerRow(f, q.buyerId);
  assert.deepEqual(row.sold, [{ unit: 'kg', quantity_milli: 100000 }]);
  assert.deepEqual(row.invoiced, [{ currency: 'PKR', total_minor: 14750000, invoices: 1 }]);
  assert.deepEqual(row.outstanding, [{ currency: 'PKR', outstanding_minor: 14750000 }]);
  assert.equal(row.days_left, 30); assert.deepEqual(row.overdue, []);
  assert.equal(row.credit_limit_minor, null); assert.equal(row.credit_used_minor, null); assert.equal(row.over_limit, false);

  assert.equal((await f.call(limitPath, { id: q.buyerId, amountMinor: 10000000, currency: 'PKR' }, admin)).status, 200);
  row = await buyerRow(f, q.buyerId);
  assert.equal(row.credit_used_minor, 14750000); assert.equal(row.over_limit, true, 'used above the limit is flagged');
  // Warn only: the buyer can still receive a new quotation and the limit blocks nothing.
  const rfq = await f.insertBuyerRfq({ buyerId: q.buyerId });
  const quote = { id: uuid(), poId: rfq, priceMinor: 125000, specifications: 'Combed cotton single jersey, 180 GSM', requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30 days after delivery', creditDays: 30 };
  assert.equal((await f.call(`${base}/quotes`, quote, 'Sana')).status, 201, 'a quotation is not blocked by the limit');

  const invoice = f.sql.prepare('SELECT id FROM invoices WHERE buyer_id=?').get(q.buyerId).id;
  assert.equal((await f.call(`${base}/payments`, { id: uuid(), invoiceId: invoice, amountMinor: 4750000, receivedAt: Date.now(), note: 'Part payment' }, 'Sana')).status, 201);
  row = await buyerRow(f, q.buyerId);
  assert.equal(row.outstanding[0].outstanding_minor, 10000000); assert.equal(row.credit_used_minor, 10000000);
  assert.equal(row.over_limit, false, 'equal to the limit is within it');
  assert.equal((await f.call(limitPath, { id: q.buyerId, amountMinor: 14750000, currency: 'PKR' }, admin)).status, 200);
  assert.equal((await buyerRow(f, q.buyerId)).over_limit, false);
});

test('days left and over-limit math on a fixture buyer: negative days are overdue, settled invoices are ignored', () => {
  const now = Date.parse('2026-10-30T06:00:00+05:00');
  const invoices = [
    { currency: 'PKR', total_minor: 1000, credited_minor: 0, paid_minor: 0, due_at: dueAt(now, -3) },   // 3 days overdue
    { currency: 'PKR', total_minor: 5000, credited_minor: 0, paid_minor: 1000, due_at: dueAt(now, 10) }, // 4000 open, due in 10 days
    { currency: 'USD', total_minor: 200, credited_minor: 0, paid_minor: 0, due_at: dueAt(now, 2) },
    { currency: 'PKR', total_minor: 300, credited_minor: 300, paid_minor: 0, due_at: dueAt(now, -20) }, // settled
  ];
  const fixture = { credit_limit_minor: 4000, credit_limit_currency: 'PKR' };
  const position = buyerPosition(fixture, invoices, now);
  assert.deepEqual(position.outstanding, [{ currency: 'PKR', outstanding_minor: 5000 }, { currency: 'USD', outstanding_minor: 200 }]);
  assert.deepEqual(position.overdue, [{ currency: 'PKR', overdue_minor: 1000 }]);
  assert.equal(position.days_left, -3, 'the earliest open due date decides, negative means overdue');
  assert.equal(position.next_due_at, dueAt(now, -3));
  assert.equal(position.credit_used_minor, 5000);
  assert.equal(position.over_limit, true);
  assert.equal(buyerPosition({ ...fixture, credit_limit_minor: 5000 }, invoices, now).over_limit, false);
  assert.equal(buyerPosition({ credit_limit_minor: 150, credit_limit_currency: 'USD' }, invoices, now).over_limit, true);
  const none = buyerPosition({ credit_limit_minor: null, credit_limit_currency: null }, [], now);
  assert.deepEqual([none.outstanding, none.days_left, none.credit_used_minor, none.over_limit], [[], null, null, false]);
  assert.equal(buyerPosition({ credit_limit_minor: null, credit_limit_currency: null }, invoices.slice(1, 2), now).days_left, 10);
});

test('sales settings: the sales manager reads them, only the admin changes them, with the same validation', async () => {
  const f = await setup();
  const read = await f.call(`${base}/settings`, undefined, 'Sana');
  assert.equal(read.data.settings.tax_rate_bp, 1800);
  rejects(await f.call(`${base}/settings`, { key: 'tax_rate_bp', value: 1700 }, 'Sana'), 403);
  assert.equal((await f.call(`${base}/settings`, undefined, 'Sana')).data.settings.tax_rate_bp, 1800, 'a refused change is not saved');
  assert.equal((await f.call(`${base}/settings`, { key: 'tax_rate_bp', value: 1700 }, admin)).status, 200, 'the admin saves without an intervention reason');
  assert.equal((await f.call(`${base}/settings`, undefined, 'Sana')).data.settings.tax_rate_bp, 1700);
  rejects(await f.call(`${base}/settings`, { key: 'tax_rate_bp', value: 20000 }, admin), 422);
  rejects(await f.call(`${base}/settings`, { key: 'unknown', value: 1 }, admin), 422);
  rejects(await f.call(`${base}/settings`, { key: 'currency', value: 'INR' }, admin), 422);
  rejects(await f.call(`${base}/settings`, { key: 'tax_rate_bp', value: 1700, interventionReason: 'Not needed for the admin' }, admin), 422, 'Unexpected');
});

test('buyer profile: contact details save with validation, a version check and an audit row; quality inspectors are refused', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  const edit = { id: buyerId, version: 1, contactName: 'Ayesha Khan', phone: '+923007654321', city: 'Karachi', notes: 'Prefers weekly calls' };
  const saved = await f.call(profilePath, edit, 'Sana');
  assert.equal(saved.status, 200, saved.text);
  const row = await buyerRow(f, buyerId);
  assert.deepEqual([row.contact_name, row.phone, row.city, row.notes, row.version], ['Ayesha Khan', '+923007654321', 'Karachi', 'Prefers weekly calls', 2]);

  // The first save moved the record to version 2, so a stale form is refused and changes nothing.
  rejects(await f.call(profilePath, { ...edit, city: 'Lahore' }, 'Sana'), 409, 'changed');
  assert.equal((await buyerRow(f, buyerId)).city, 'Karachi');

  rejects(await f.call(profilePath, { id: buyerId, version: 2, phone: '0300-1234567' }, 'Sana'), 422, 'country code');
  rejects(await f.call(profilePath, { id: buyerId, version: 2, contactName: 'A' }, 'Sana'), 422, 'Contact name');
  rejects(await f.call(profilePath, { id: buyerId, version: 2, city: 'x'.repeat(101) }, 'Sana'), 422, 'City');
  rejects(await f.call(profilePath, { id: buyerId, version: 2 }, 'Sana'), 422, 'Change at least one');
  rejects(await f.call(profilePath, { id: buyerId, version: 2, email: 'new@buyer.test' }, 'Sana'), 422, 'Unexpected');
  rejects(await f.call(profilePath, { id: 'not-an-id', version: 2, city: 'Lahore' }, 'Sana'), 422);
  rejects(await f.call(profilePath, { id: uuid(), version: 2, city: 'Lahore' }, 'Sana'), 404);
  rejects(await f.call(profilePath, { id: buyerId, version: 2, city: 'Lahore' }, 'Qasim'), 403);
  rejects(await f.call(profilePath, { id: buyerId, version: 2, city: 'Lahore' }, admin), 422, 'Intervention reason');

  const adminSaved = await f.call(profilePath, { id: buyerId, version: 2, city: 'Lahore', interventionReason: 'Covering for the sales manager' }, admin);
  assert.equal(adminSaved.status, 200, adminSaved.text);
  assert.equal((await buyerRow(f, buyerId)).city, 'Lahore');
  const audits = f.sql.prepare("SELECT record_id,new_json FROM erp_audit_events WHERE action='buyer.profile_updated' ORDER BY created_at,id").all();
  assert.equal(audits.length, 2, 'each saved profile change is audited, refused ones are not');
  assert.ok(audits.every(a => a.record_id === buyerId));
});
