import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { portalFixture, liveShapedRows, migrate, legacyMigrations } from './portal-fixture.mjs';
import { dueAt, karachiDate, noteSale, recordAcceptance, PKT_OFFSET_MS } from '../server/sales.mjs';
import { settingsOf } from '../server/governance.mjs';
import { remindersScheduled } from '../server/notify.mjs';

const DAY = 86400000, sales = '/erp/sales', settings = '/erp/admin/settings';
const uuid = () => crypto.randomUUID();
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const count = (f, sql, ...args) => f.sql.prepare(`SELECT COUNT(*) n FROM (${sql})`).get(...args).n;
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=?').all(action);
const rfqState = async (f, id, as = 'Sana') => (await f.call(sales, undefined, as)).data.rfqs.find(r => r.id === id).state;
const quoteBody = (rfqId, extra = {}) => ({ id: uuid(), poId: rfqId, priceMinor: 125000, specifications: 'Combed cotton single jersey, 180 GSM',
  requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30 days after delivery', creditDays: 30, ...extra });
async function setup() {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  f.sana = await f.member('Sana');
  return f;
}
/** Quotes and sends version 1 (or the next version) of an RFQ through the API as Sana. */
async function sentQuote(f, rfqId, extra = {}) {
  const draft = await f.call(`${sales}/quotes`, quoteBody(rfqId, extra), 'Sana');
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const sent = await f.call(`${sales}/quotes/send`, { id: draft.data.revision.id }, 'Sana');
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  return draft.data.revision;
}
const accept = (f, buyerId, revision, extra = {}) => recordAcceptance(f.env.DB, { workspaceId: f.workspaceId, revisionId: revision.id, version: revision.version, buyerId, acceptedBy: 'Buyer Contact', now: Date.now(), ...extra });
const rejection = (promise, status, message) => assert.rejects(promise, error => error.status === status && (!message || error.message.includes(message)));

test('the sales manager approves or rejects pending buyers; rejection needs a reason and closes their RFQs', async () => {
  const f = await setup(), buyerId = await f.insertBuyer(), rfqId = await f.insertBuyerRfq({ buyerId });
  const review = `${sales}/buyers/review`, body = { id: buyerId, status: 'rejected', version: 1 };
  assert.equal((await f.call(review, body, 'Sana')).status, 422);
  assert.equal((await f.call(review, { ...body, reason: 'bad' }, 'Sana')).status, 422);
  assert.equal(one(f, 'SELECT status FROM buyers WHERE id=?', buyerId).status, 'pending');
  assert.equal((await f.call(review, { ...body, reason: 'NTN does not match the company' }, 'Sana')).status, 200);
  assert.equal(one(f, 'SELECT status FROM buyers WHERE id=?', buyerId).status, 'rejected');
  assert.equal(one(f, 'SELECT status FROM buyer_purchase_orders WHERE id=?', rfqId).status, 'cancelled');
  assert.equal(await rfqState(f, rfqId), 'closed');
  const [event] = audits(f, 'buyer.rejected');
  assert.equal(event.reason, 'NTN does not match the company'); assert.equal(event.actor_role, 'sales_manager');
  assert.deepEqual([JSON.parse(event.old_json), JSON.parse(event.new_json)], [{ status: 'pending' }, { status: 'rejected' }]);
  assert.equal((await f.call(review, { ...body, reason: 'NTN does not match the company' }, 'Sana')).status, 409, 'stale version');
});

test('RFQs from pending buyers wait as awaiting buyer approval and cannot be quoted', async () => {
  const f = await setup(), buyerId = await f.insertBuyer(), rfqId = await f.insertBuyerRfq({ buyerId });
  assert.equal(await rfqState(f, rfqId), 'awaiting_buyer_approval');
  const refused = await f.call(`${sales}/quotes`, quoteBody(rfqId), 'Sana');
  assert.equal(refused.status, 409); assert.equal(refused.data.error, 'Respond only to RFQs from approved buyers.');
  assert.equal(count(f, 'SELECT 1 FROM sales_quote_revisions'), 0);
  assert.equal((await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'active', version: 1 }, 'Sana')).status, 200);
  const notices = f.sql.prepare("SELECT * FROM notifications WHERE event='buyer_rfq.received' AND user_id=?").all(f.sana.user_id);
  assert.equal(notices.length, 1); assert.deepEqual([notices[0].object_type, notices[0].object_id], ['buyer_rfq', rfqId]);
  assert.equal(await rfqState(f, rfqId), 'open');
  assert.equal((await f.call(`${sales}/quotes`, quoteBody(rfqId), 'Sana')).status, 201);
  assert.equal(audits(f, 'buyer.approved').length, 1);
});

test('a quotation carries rate, specifications, payment terms and credit days in the factory currency', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), rfqId = await f.insertBuyerRfq({ buyerId });
  assert.equal((await f.call(`${sales}/quotes`, quoteBody(rfqId, { currency: 'USD' }), 'Sana')).status, 422);
  assert.equal((await f.call(`${sales}/quotes`, quoteBody(rfqId, { creditDays: 400 }), 'Sana')).status, 422);
  const { creditDays, ...withoutCredit } = quoteBody(rfqId);
  assert.equal((await f.call(`${sales}/quotes`, withoutCredit, 'Sana')).status, 422);
  assert.equal(count(f, 'SELECT 1 FROM sales_quote_revisions'), 0);
  const body = quoteBody(rfqId, { creditDays: 45 }), created = await f.call(`${sales}/quotes`, body, 'Sana');
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const revision = created.data.revision;
  assert.deepEqual([revision.currency, revision.credit_days, revision.price_minor, revision.payment_terms, revision.status], ['PKR', 45, 125000, 'Net 30 days after delivery', 'draft']);
  assert.equal((await f.call(`${sales}/quotes`, body, 'Sana')).status, 200, 'same request id and values replays');
  assert.equal((await f.call(`${sales}/quotes`, { ...body, creditDays: 60 }, 'Sana')).status, 409, 'same request id, different values');
  assert.equal(count(f, 'SELECT 1 FROM sales_quote_revisions'), 1);
  assert.equal((await f.call(`${sales}/quotes/send`, { id: revision.id }, 'Sana')).status, 200);
  assert.equal(await rfqState(f, rfqId), 'quoted');
  const rfq = one(f, 'SELECT * FROM buyer_purchase_orders WHERE id=?', rfqId);
  assert.deepEqual([rfq.sent_revision_id, rfq.sent_version], [revision.id, 1]);
  assert.equal(audits(f, 'sales.quote_sent').length, 1);
});

test('a sale is noted only after the buyer accepts, and its invoice carries 18% GST', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), rfqId = await f.insertBuyerRfq({ buyerId });
  const revision = await sentQuote(f, rfqId), saleId = uuid();
  const early = await f.call(`${sales}/sales`, { id: saleId, revisionId: revision.id }, 'Sana');
  assert.equal(early.status, 409); assert.equal(early.data.error, 'The buyer has not accepted this quotation yet.');
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 0);
  const { acceptance, already } = await accept(f, buyerId, revision);
  assert.equal(already, false); assert.equal(acceptance.revision_id, revision.id);
  const noted = await f.call(`${sales}/sales`, { id: saleId, revisionId: revision.id }, 'Sana');
  assert.equal(noted.status, 201, JSON.stringify(noted.data));
  const { order, invoice } = noted.data;
  assert.equal(order.id, saleId); assert.equal(order.status, 'confirmed');
  assert.deepEqual([invoice.subtotal_minor, invoice.tax_rate_bp, invoice.tax_minor, invoice.total_minor, invoice.currency], [12500000, 1800, 2250000, 14750000, 'PKR']);
  assert.equal(invoice.number, `INV-${karachiDate(invoice.issued_at).slice(0, 4)}-0001`);
  assert.equal(invoice.due_at, dueAt(invoice.issued_at, 30));
  assert.deepEqual([invoice.payment_terms, invoice.credit_days, invoice.locked, invoice.created_by], ['Net 30 days after delivery', 30, 1, f.sana.user_id]);
  assert.equal(await rfqState(f, rfqId), 'sold');
  assert.equal(audits(f, 'sale.noted').length, 1); assert.equal(audits(f, 'invoice.issued').length, 1);
  assert.equal(audits(f, 'quotation.accepted')[0].actor_type, 'buyer');
  assert.equal(one(f, 'SELECT COUNT(*) n FROM sales_order_lines WHERE sales_order_id=?', saleId).n, 1);
  const again = await f.call(`${sales}/sales`, { id: saleId, revisionId: revision.id }, 'Sana');
  assert.equal(again.status, 200); assert.equal(again.data.invoice.id, invoice.id);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 1);
  const document = await f.call(`${sales}/invoices/${invoice.id}`, undefined, 'Sana');
  assert.equal(document.status, 200);
  for (const line of ['GST (18%)', 'Subtotal', 'PKR 125000.00', 'PKR 22500.00', 'PKR 147500.00', invoice.number, karachiDate(invoice.due_at)]) assert.ok(document.text.includes(line), line);
  assert.ok(!document.text.includes('Taxes are not shown'));
});

test('invoice numbers run INV-YYYY-NNNN and restart each Karachi calendar year', async () => {
  const f = await setup(), db = f.env.DB, [x, y, z] = [await f.acceptedQuote(), await f.acceptedQuote(), await f.acceptedQuote()];
  const note = (q, at) => noteSale(db, f.sana, { id: uuid(), revisionId: q.revisionId }, at);
  assert.equal((await note(x, Date.UTC(2026, 11, 31, 18, 0))).invoice.number, 'INV-2026-0001');
  assert.equal((await note(y, Date.UTC(2026, 11, 31, 19, 30))).invoice.number, 'INV-2027-0001');
  assert.equal((await note(z, Date.UTC(2027, 0, 1, 3, 0))).invoice.number, 'INV-2027-0002');
});

test('two sales noted back to back never share a number', async () => {
  const f = await setup(), db = f.env.DB, x = await f.acceptedQuote(), y = await f.acceptedQuote();
  const [a, b] = await Promise.all([x, y].map(q => noteSale(db, f.sana, { id: uuid(), revisionId: q.revisionId })));
  assert.notEqual(a.invoice.number, b.invoice.number);
  assert.deepEqual([a, b].map(r => r.invoice.number.slice(-4)).sort(), ['0001', '0002']);
});

test('admin-edited format and tax rate apply to the next invoice; currency follows its accepted quotation', async () => {
  const f = await setup(), db = f.env.DB, year = karachiDate(Date.now()).slice(0, 4);
  assert.equal((await f.call(settings, { key: 'invoice_format', value: 'FAZ-{YYYY}-{NNNN}' })).status, 200);
  assert.equal((await f.call(settings, { key: 'tax_rate_bp', value: 1700 })).status, 200);
  const first = await f.acceptedQuote(), { invoice: pkr } = await noteSale(db, f.sana, { id: uuid(), revisionId: first.revisionId });
  assert.match(pkr.number, /^FAZ-\d{4}-\d{4}$/); assert.equal(pkr.number, `FAZ-${year}-0001`);
  assert.deepEqual([pkr.tax_rate_bp, pkr.tax_minor, pkr.total_minor, pkr.currency], [1700, 2125000, 14625000, 'PKR']);
  const blocked = await f.call(settings, { key: 'currency', value: 'USD' });
  assert.equal(blocked.status, 409, 'unpaid invoice blocks the switch');
  const credit = amountMinor => f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: pkr.id, amountMinor, reason: 'Settled by agreement' }, 'Sana');
  assert.equal((await credit(pkr.total_minor)).status, 201);
  assert.equal((await f.call(settings, { key: 'currency', value: 'USD' })).status, 200);
  const second = await f.acceptedQuote(), { invoice: usd } = await noteSale(db, f.sana, { id: uuid(), revisionId: second.revisionId });
  assert.equal(one(f, 'SELECT currency FROM sales_quote_revisions WHERE id=?', second.revisionId).currency, 'USD');
  assert.deepEqual([usd.number, usd.currency, usd.tax_minor], [`FAZ-${year}-0002`, 'USD', 2125000]);
  assert.equal((await f.call(settings, { key: 'currency', value: 'PKR' })).status, 409, 'unpaid USD invoice blocks the switch back');
  await f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: usd.id, amountMinor: usd.total_minor, reason: 'Settled by agreement' }, 'Sana');
  assert.equal((await f.call(settings, { key: 'currency', value: 'PKR' })).status, 200);
  assert.equal((await settingsOf(db, f.workspaceId)).currency, 'PKR');
  assert.equal(one(f, 'SELECT currency FROM invoices WHERE id=?', usd.id).currency, 'USD', 'a later setting never relabels an issued invoice');
  assert.throws(() => f.sql.prepare("INSERT INTO invoices(id,workspace_id,number,sales_order_id,revision_id,buyer_id,lines_json,total_minor,currency,issued_at) SELECT ?,workspace_id,'X-1',sales_order_id,revision_id,buyer_id,lines_json,total_minor,'GBP',issued_at FROM invoices WHERE id=?").run(uuid(), usd.id), /accepted quotation currency/);
});

test('issued invoices are locked; corrections are credit notes with a reason', async () => {
  const f = await setup(), q = await f.acceptedQuote(), { invoice } = await noteSale(f.env.DB, f.sana, { id: uuid(), revisionId: q.revisionId });
  const snapshot = one(f, 'SELECT * FROM invoices WHERE id=?', invoice.id);
  assert.throws(() => f.sql.exec('UPDATE invoices SET total_minor=1'), /invoices are immutable/);
  assert.throws(() => f.sql.exec('DELETE FROM invoices'), /invoices are immutable/);
  assert.deepEqual(one(f, 'SELECT * FROM invoices WHERE id=?', invoice.id), snapshot);
  const note = (extra = {}) => f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: invoice.id, amountMinor: 1000000, reason: 'Two cones short on delivery', ...extra }, 'Sana');
  assert.equal((await note({ reason: undefined })).status, 422);
  assert.equal((await note({ reason: 'bad' })).status, 422);
  assert.equal(count(f, 'SELECT 1 FROM credit_notes'), 0);
  const body = { id: uuid(), invoiceId: invoice.id, amountMinor: 1000000, reason: 'Two cones short on delivery' };
  const created = await f.call(`${sales}/credit-notes`, body, 'Sana');
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.creditNote.number, `CN-${invoice.number}-1`);
  assert.equal((await f.call(`${sales}/credit-notes`, body, 'Sana')).status, 200, 'replay of the same request id');
  assert.equal(count(f, 'SELECT 1 FROM credit_notes'), 1);
  assert.equal((await note({ amountMinor: 13750001 })).status, 409, 'more than the remaining 13750000');
  assert.equal(count(f, 'SELECT 1 FROM credit_notes'), 1); assert.equal(audits(f, 'invoice.credited').length, 1);
  assert.equal((await note({ amountMinor: 13750000 })).data.creditNote.number, `CN-${invoice.number}-2`);
  const [event] = audits(f, 'invoice.credited');
  assert.equal(event.reason, 'Two cones short on delivery'); assert.equal(event.record_id, created.data.creditNote.id);
  assert.throws(() => f.sql.exec('UPDATE credit_notes SET amount_minor=1'), /credit notes are immutable/);
  assert.throws(() => f.sql.exec('DELETE FROM credit_notes'), /credit notes are immutable/);
  assert.throws(() => f.sql.prepare("INSERT INTO credit_notes(id,workspace_id,invoice_id,number,amount_minor,reason,created_by,created_at,updated_at) VALUES(?,?,?,'CN-X',1,'Over the balance',?,1,1)").run(uuid(), f.workspaceId, invoice.id, f.adminId), /credit exceeds/);
});

test('only sales managers quote and note sales; dispatch cannot change invoices, prices or terms', async () => {
  const f = await setup(), q = await f.acceptedQuote(), { invoice } = await noteSale(f.env.DB, f.sana, { id: uuid(), revisionId: q.revisionId });
  await f.person('Danish', 'dispatch');
  const rfqId = await f.insertBuyerRfq({ buyerId: await f.insertBuyer({ status: 'active' }) });
  for (const [path, body] of [['/quotes', quoteBody(rfqId)], ['/quotes/send', { id: uuid() }], ['/sales', { id: uuid(), revisionId: q.revisionId }],
    ['/credit-notes', { id: uuid(), invoiceId: invoice.id, amountMinor: 100, reason: 'Short delivery' }], ['/buyers/review', { id: q.buyerId, status: 'suspended', version: 1, reason: 'Review needed' }]])
    assert.equal((await f.call(sales + path, body, 'Danish')).status, 403, path);
  assert.equal((await f.call(sales, undefined, 'Danish')).status, 403);
  assert.equal((await f.call(`${sales}/invoices/${invoice.id}`, undefined, 'Danish')).status, 403);
  assert.equal(count(f, 'SELECT 1 FROM credit_notes'), 0);
  const withoutReason = await f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: invoice.id, amountMinor: 100, reason: 'Short delivery' });
  assert.equal(withoutReason.status, 422, 'an admin must give an intervention reason');
  const intervened = await f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: invoice.id, amountMinor: 100, reason: 'Short delivery', interventionReason: 'Sana is away today' });
  assert.equal(intervened.status, 201);
  assert.equal(audits(f, 'invoice.credited')[0].intervention_reason, 'Sana is away today');
});

test('staff cannot create buyers or enter buyer RFQs', async () => {
  const f = await setup();
  for (const as of ['Sana', 'Anas']) {
    assert.equal((await f.call(`${sales}/buyers`, { id: uuid(), name: 'Buyer Mill', contactName: 'Contact', email: 'b@test.com', phone: '+923001234567' }, as)).status, 404);
    assert.equal((await f.call(`${sales}/pos`, { id: uuid(), buyerId: uuid() }, as)).status, 404);
  }
  assert.equal(count(f, 'SELECT 1 FROM buyers'), 0);
});

test('due dates are the Karachi date plus the credit days, across month and year ends', () => {
  const PKT = PKT_OFFSET_MS;
  assert.equal(new Date(dueAt(Date.UTC(2026, 0, 31, 20, 0), 30)).toISOString(), '2026-03-03T18:59:59.999Z');
  assert.equal(dueAt(Date.UTC(2026, 0, 31, 20, 0), 30), Date.UTC(2026, 2, 3, 18, 59, 59, 999));
  assert.equal(dueAt(Date.UTC(2025, 11, 28, 7) - PKT, 30), Date.UTC(2026, 0, 27, 18, 59, 59, 999), 'Dec 28 to Jan 27 end of day PKT');
  assert.equal(dueAt(Date.UTC(2025, 11, 31, 7) - PKT, 30), Date.UTC(2026, 0, 30, 18, 59, 59, 999), 'Dec 31 to Jan 30');
  assert.equal(dueAt(Date.UTC(2026, 0, 5, 7) - PKT, 30), Date.UTC(2026, 1, 4, 18, 59, 59, 999), 'Jan 5 to Feb 4');
  assert.equal(dueAt(Date.UTC(2026, 0, 5, 7) - PKT, 0), Date.UTC(2026, 0, 5, 18, 59, 59, 999), 'zero credit days is due the same Karachi day');
});

test('accepted credit days and buyer eligibility are guarded atomically', async () => {
  const f = await setup(), db = f.env.DB, q = await f.acceptedQuote({ creditDays: 30 });
  assert.throws(() => f.sql.exec('UPDATE sales_quote_revisions SET credit_days=45'), /quoted terms are immutable/);
  assert.equal(one(f, 'SELECT credit_days FROM sales_quote_revisions WHERE id=?', q.revisionId).credit_days, 30);
  const accepted = one(f, 'SELECT * FROM quotation_acceptances WHERE revision_id=?', q.revisionId);
  assert.deepEqual([accepted.created_by, accepted.accepted_by, accepted.status, accepted.version], [`buyer:${q.buyerId}`, 'Buyer Contact', 'accepted', 1]);
  assert.throws(() => f.sql.exec("UPDATE quotation_acceptances SET note='x'"), /acceptances are immutable/);
  assert.throws(() => f.sql.exec('DELETE FROM quotation_acceptances'), /acceptances are immutable/);

  const buyerId = await f.insertBuyer({ status: 'active' }), rfqId = await f.insertBuyerRfq({ buyerId }), revision = await sentQuote(f, rfqId);
  const before = [count(f, 'SELECT 1 FROM quotation_acceptances'), count(f, "SELECT 1 FROM erp_audit_events WHERE action='quotation.accepted'")];
  await rejection(accept(f, await f.insertBuyer({ status: 'active' }), revision), 404);
  await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'suspended', version: 1, reason: 'Credit check pending' }, 'Sana');
  await rejection(accept(f, buyerId, revision), 409);
  assert.deepEqual([count(f, 'SELECT 1 FROM quotation_acceptances'), count(f, "SELECT 1 FROM erp_audit_events WHERE action='quotation.accepted'")], before);
  assert.equal(one(f, 'SELECT status FROM sales_quote_revisions WHERE id=?', revision.id).status, 'sent');

  // The buyer is suspended after noteSale read it but before its transaction commits.
  const batch = db.batch, raced = await f.acceptedQuote();
  db.batch = async statements => { db.batch = batch; f.sql.prepare("UPDATE buyers SET status='suspended' WHERE id=?").run(raced.buyerId); return batch(statements); };
  await rejection(noteSale(db, f.sana, { id: uuid(), revisionId: raced.revisionId }), 409);
  await f.call(`${sales}/buyers/review`, { id: q.buyerId, status: 'suspended', version: 1, reason: 'Credit check pending' }, 'Sana');
  await rejection(noteSale(db, f.sana, { id: uuid(), revisionId: q.revisionId }), 409);
  assert.deepEqual([count(f, 'SELECT 1 FROM sales_orders'), count(f, 'SELECT 1 FROM invoices'), count(f, "SELECT 1 FROM erp_audit_events WHERE action='sale.noted'")], [0, 0, 0]);
});

test('accept versus resend cannot accept superseded terms', async () => {
  const draftTwo = async () => {
    const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), rfqId = await f.insertBuyerRfq({ buyerId });
    const v1 = await sentQuote(f, rfqId), v2 = (await f.call(`${sales}/quotes`, quoteBody(rfqId, { priceMinor: 130000 }), 'Sana')).data.revision;
    assert.deepEqual([v1.version, v2.version], [1, 2]);
    const race = async before => { const batch = f.env.DB.batch; f.env.DB.batch = async statements => { f.env.DB.batch = batch; await before(); return batch(statements); }; };
    return { f, buyerId, rfqId, v1, v2, race };
  };
  { // The buyer's acceptance of v1 lands first: v2 must not be sent.
    const { f, buyerId, rfqId, v1, v2, race } = await draftTwo();
    await race(() => accept(f, buyerId, v1));
    const sent = await f.call(`${sales}/quotes/send`, { id: v2.id }, 'Sana');
    assert.equal(sent.status, 409);
    assert.deepEqual([one(f, 'SELECT status FROM sales_quote_revisions WHERE id=?', v1.id).status, one(f, 'SELECT status FROM sales_quote_revisions WHERE id=?', v2.id).status], ['approved', 'draft']);
    assert.equal(one(f, 'SELECT sent_revision_id FROM buyer_purchase_orders WHERE id=?', rfqId).sent_revision_id, v1.id);
    assert.equal(count(f, 'SELECT 1 FROM quotation_acceptances'), 1); assert.equal(audits(f, 'sales.quote_sent').length, 1);
  }
  { // Publishing v2 lands first: the buyer's acceptance of v1 is refused.
    const { f, buyerId, rfqId, v1, v2, race } = await draftTwo();
    await race(async () => assert.equal((await f.call(`${sales}/quotes/send`, { id: v2.id }, 'Sana')).status, 200));
    await rejection(accept(f, buyerId, v1), 409, 'This quotation was replaced. Accept the latest revision.');
    assert.equal(count(f, 'SELECT 1 FROM quotation_acceptances'), 0); assert.equal(audits(f, 'quotation.accepted').length, 0);
    assert.deepEqual([one(f, 'SELECT status FROM sales_quote_revisions WHERE id=?', v1.id).status, one(f, 'SELECT sent_revision_id FROM buyer_purchase_orders WHERE id=?', rfqId).sent_revision_id], ['sent', v2.id]);
  }
});

test('an identical acceptance repeats safely; a different one is refused without a second audit', async () => {
  const f = await setup(), q = await f.acceptedQuote();
  const revision = one(f, 'SELECT * FROM sales_quote_revisions WHERE id=?', q.revisionId);
  const again = await accept(f, q.buyerId, revision);
  assert.equal(again.already, true); assert.equal(again.acceptance.revision_id, q.revisionId);
  await rejection(accept(f, q.buyerId, revision, { note: 'Different note' }), 409);
  await rejection(accept(f, q.buyerId, revision, { version: 2 }), 409);
  assert.equal(count(f, 'SELECT 1 FROM quotation_acceptances'), 1); assert.equal(audits(f, 'quotation.accepted').length, 1);
  const late = await f.call(`${sales}/quotes`, quoteBody(q.rfqId), 'Sana');
  assert.equal(late.status, 409, 'no new revision once a quotation was accepted');
  assert.equal(count(f, 'SELECT 1 FROM sales_quote_revisions'), 1); assert.equal(audits(f, 'sales.quote_drafted').length, 0);
});

test('a skipped draft on a sold RFQ does not lock the factory currency', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), rfqId = await f.insertBuyerRfq({ buyerId });
  const v1 = await sentQuote(f, rfqId);
  assert.equal((await f.call(`${sales}/quotes`, quoteBody(rfqId, { priceMinor: 130000 }), 'Sana')).status, 201, 'v2 stays a draft');
  await accept(f, buyerId, v1);
  const { invoice } = await noteSale(f.env.DB, f.sana, { id: uuid(), revisionId: v1.id });
  assert.equal((await f.call(settings, { key: 'currency', value: 'USD' })).status, 409, 'the unpaid invoice blocks');
  assert.equal((await f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: invoice.id, amountMinor: invoice.total_minor, reason: 'Settled by agreement' }, 'Sana')).status, 201);
  assert.equal((await f.call(settings, { key: 'currency', value: 'USD' })).status, 200);
});

test('a number clash skips the clashing number once', async () => {
  const f = await setup(), at = Date.UTC(2026, 5, 1, 6), note = async () => noteSale(f.env.DB, f.sana, { id: uuid(), revisionId: (await f.acceptedQuote()).revisionId }, at);
  await note(); await note();
  f.sql.exec("UPDATE document_counters SET next_number=1");
  assert.equal((await note()).invoice.number, 'INV-2026-0003');
});

test('the buyer portal records acceptance and leaves the sale to the sales manager', async () => {
  const f = await setup(), password = 'A strong buyer password 2026', email = 'hina@buyer.test';
  const registered = await f.call('/buyer/register', { company: 'Hina Fabrics', contactName: 'Hina Khan', email, phone: '+923331234567', city: 'Lahore', password }, null);
  assert.equal(registered.status, 201);
  const buyerId = one(f, 'SELECT buyer_id FROM buyer_users WHERE email=?', email).buyer_id;
  assert.equal(one(f, 'SELECT created_by FROM buyers WHERE id=?', buyerId).created_by.startsWith('buyer:'), true);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notifications WHERE event='buyer.pending' AND user_id=?").get(f.sana.user_id).n, 1);
  assert.equal((await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'active', version: 1 }, 'Sana')).status, 200);
  const login = await f.call('/buyer/login', { email, password }, null), cookie = login.headers.get('set-cookie').split(';')[0];
  const rfq = await f.call('/buyer/pos', { id: uuid(), reference: 'PO-HINA-1', specifications: 'Combed cotton single jersey, 180 GSM', quantityMilli: 100000, unit: 'kg', requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30' }, null, { Cookie: cookie });
  assert.equal(rfq.status, 201, JSON.stringify(rfq.data));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notifications WHERE event='buyer_rfq.received' AND object_id=?").get(rfq.data.po.id).n, 1);
  const revision = await sentQuote(f, rfq.data.po.id);
  const approve = body => f.call('/buyer/approve', body, null, { Cookie: cookie });
  const first = await approve({ revisionId: revision.id, version: revision.version, note: 'Approved as quoted' });
  assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.already, false);
  assert.equal(count(f, 'SELECT 1 FROM sales_orders'), 0); assert.equal(count(f, 'SELECT 1 FROM invoices'), 0);
  const stored = one(f, 'SELECT * FROM quotation_acceptances WHERE revision_id=?', revision.id);
  assert.deepEqual([stored.accepted_by, stored.created_by, stored.note], ['Hina Khan', `buyer:${buyerId}`, 'Approved as quoted']);
  assert.equal((await approve({ revisionId: revision.id, version: revision.version, note: 'Approved as quoted' })).data.already, true);
  assert.equal((await approve({ revisionId: revision.id, version: revision.version, note: 'Another note' })).status, 409);
  assert.equal((await approve({ revisionId: revision.id, version: 9 })).status, 409);
  assert.equal(count(f, 'SELECT 1 FROM quotation_acceptances'), 1);
  assert.equal((await f.call(`${sales}/sales`, { id: uuid(), revisionId: revision.id }, 'Sana')).status, 201);
});

test('pending buyers and open RFQs from approved buyers are reminded to the sales manager', async () => {
  const f = await setup(), pendingId = await f.insertBuyer(), held = await f.insertBuyerRfq({ buyerId: pendingId });
  const buyerId = await f.insertBuyer({ status: 'active' }), open = await f.insertBuyerRfq({ buyerId }), quoted = await f.insertBuyerRfq({ buyerId });
  await sentQuote(f, quoted);
  const later = Date.now() + 25 * 3600000, result = await remindersScheduled(f.env, later);
  assert.equal(result.created, 2);
  const reminders = f.sql.prepare("SELECT object_type,object_id,user_id FROM notifications WHERE event='reminder' ORDER BY object_type").all().map(r => ({ ...r }));
  assert.deepEqual(reminders, [{ object_type: 'buyer', object_id: pendingId, user_id: f.sana.user_id }, { object_type: 'buyer_rfq', object_id: open, user_id: f.sana.user_id }]);
  assert.ok(![held, quoted].some(id => reminders.some(r => r.object_id === id)));
});

test('the 0004 audit rebuild keeps every row and admits the buyer actor', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  migrate(sql, legacyMigrations); liveShapedRows(sql);
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id, staffId = sql.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  const insert = sql.prepare('INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)');
  insert.run(uuid(), workspaceId, staffId, 'staff', 'test.before', uuid(), '{}', Date.now());
  assert.throws(() => insert.run(uuid(), workspaceId, 'buyer-1', 'buyer', 'test.before', uuid(), '{}', Date.now()), /CHECK constraint failed/);
  const before = sql.prepare('SELECT COUNT(*) n FROM erp_audit_events').get().n;
  migrate(sql, ['0004_sales.sql']);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM erp_audit_events').get().n, before);
  assert.doesNotThrow(() => insert.run(uuid(), workspaceId, 'buyer-1', 'buyer', 'test.after', uuid(), '{}', Date.now()));
  assert.throws(() => insert.run(uuid(), workspaceId, 'x', 'machine', 'test.after', uuid(), '{}', Date.now()), /CHECK constraint failed/);
  assert.throws(() => sql.prepare('UPDATE erp_audit_events SET action=?').run('x'), /immutable audit/);
});

test('buyers only see and act on their own records', async () => {
  const f = await setup(), password = 'A strong buyer password 2026';
  const portal = async (company, email) => {
    assert.equal((await f.call('/buyer/register', { company, contactName: `${company} Contact`, email, phone: '+923331234567', city: 'Lahore', password }, null)).status, 201);
    const buyerId = one(f, 'SELECT buyer_id FROM buyer_users WHERE email=?', email).buyer_id;
    assert.equal((await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'active', version: 1 }, 'Sana')).status, 200);
    const cookie = (await f.call('/buyer/login', { email, password }, null)).headers.get('set-cookie').split(';')[0];
    return { buyerId, get: path => f.call(path, undefined, null, { Cookie: cookie }), post: (path, body) => f.call(path, body, null, { Cookie: cookie }), cookie };
  };
  const a = await portal('Hina Fabrics', 'hina@buyer.test'), b = await portal('Zain Textiles', 'zain@buyer.test');
  const rfq = await a.post('/buyer/pos', { id: uuid(), reference: 'PO-A-1', specifications: 'Combed cotton single jersey, 180 GSM', quantityMilli: 100000, unit: 'kg', requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30' });
  assert.equal(rfq.status, 201);
  const revision = await sentQuote(f, rfq.data.po.id);
  assert.equal((await a.post('/buyer/approve', { revisionId: revision.id, version: 1 })).status, 200);
  const { invoice } = (await f.call(`${sales}/sales`, { id: uuid(), revisionId: revision.id }, 'Sana')).data;
  const own = (await a.get('/buyer/workspace')).data;
  assert.deepEqual([own.pos.length, own.revisions.length, own.orders.length, own.invoices.length], [1, 1, 1, 1]);
  assert.equal((await a.get(`/buyer/invoices/${invoice.id}`)).status, 200);
  const other = await b.get('/buyer/workspace');
  assert.equal(other.status, 200);
  for (const key of ['pos', 'revisions', 'orders', 'invoices', 'dispatches', 'receivables', 'payments']) assert.deepEqual(other.data[key], [], key);
  assert.equal((await b.get(`/buyer/invoices/${invoice.id}`)).status, 404);
  assert.equal((await b.post('/buyer/approve', { revisionId: revision.id, version: 1 })).status, 404);
  assert.equal((await f.call('/buyer/workspace', undefined, null)).status, 401, 'no session');
  assert.equal(count(f, 'SELECT 1 FROM quotation_acceptances WHERE buyer_id=?', b.buyerId), 0);
});
