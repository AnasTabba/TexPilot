import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { portalFixture } from './portal-fixture.mjs';
import { inventoryApi } from '../server/inventory.mjs';

const sales = '/erp/sales', uuid = () => crypto.randomUUID(), day = 86400000;
const count = (f, sql, ...args) => f.sql.prepare(`SELECT COUNT(*) n FROM (${sql})`).get(...args).n;
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=?').all(action);
const rejects = (result, status, message) => { assert.equal(result.status, status, result.text); if (message) assert.match(result.data.error, new RegExp(message)); };
const generate = (f, body, as = 'Sana') => f.call(`${sales}/invoices/generate`, body, as);
const invoiceRequest = (buyerId, productId, extra = {}) => ({ id: uuid(), buyerId, productId, quantity: 2.5, unit: 'kg', rateMinor: 125000,
  currency: 'PKR', paymentTerms: 'Net 30 days', creditDays: 30, ...extra });
const pay = (f, invoiceId, amountMinor, as = 'Sana') => f.call(`${sales}/payments`, { id: uuid(), invoiceId, amountMinor, receivedAt: Date.now(), note: '' }, as);
const reverse = (f, paymentId, body = {}, as = 'Sana') => f.call(`${sales}/payments/reverse`, { id: uuid(), paymentId, reason: 'Keyed against the wrong invoice', ...body }, as);
const voidInvoice = (f, invoiceId, body = {}, as = 'Sana') => f.call(`${sales}/invoices/void`, { id: uuid(), invoiceId, reason: 'Issued for the wrong quantity', ...body }, as);
const overview = async (f) => (await f.call(sales, undefined, 'Sana')).data;
const summaryOf = async (f, buyerId) => (await f.call(`${sales}/buyers/summary`, undefined, 'Sana')).data.buyers.find(buyer => buyer.id === buyerId);
async function setup() {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  await f.person('Maya', 'sales_manager');
  await f.person('Qasim', 'quality_inspector');
  return f;
}
async function issued(f, extra = {}) {
  const buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  const request = invoiceRequest(buyerId, productId, extra);
  const created = await generate(f, request);
  assert.equal(created.status, 201, created.text);
  return { buyerId, productId, invoice: created.data.invoice, order: created.data.order, request };
}

test('reversing a payment restores the outstanding balance everywhere and keeps the payment row', async () => {
  const f = await setup(), { buyerId, invoice } = await issued(f);
  const payment = await pay(f, invoice.id, 100000);
  assert.equal(payment.status, 201, payment.text);
  assert.equal(payment.data.invoice.outstanding_minor, 268750);
  assert.equal((await summaryOf(f, buyerId)).outstanding[0].outstanding_minor, 268750);

  const reversed = await reverse(f, payment.data.payment.id);
  assert.equal(reversed.status, 201, reversed.text);
  assert.equal(reversed.data.reversal.amount_minor, 100000);
  assert.equal(reversed.data.invoice.outstanding_minor, 368750);
  assert.equal(reversed.data.invoice.status, 'unpaid');
  assert.equal((await summaryOf(f, buyerId)).outstanding[0].outstanding_minor, 368750);
  const row = (await overview(f)).invoices.find(item => item.id === invoice.id);
  assert.equal(row.paid_minor, 0);
  assert.equal(count(f, 'SELECT 1 FROM invoice_payments'), 1, 'the original payment stays on record');
  assert.equal(audits(f, 'payment.reversed').length, 1);

  const repaid = await pay(f, invoice.id, 368750);
  assert.equal(repaid.status, 201, 'the restored balance can be paid again');
});

test('a payment reverses once: the same request ID replays, a second reversal is refused', async () => {
  const f = await setup(), { invoice } = await issued(f);
  const payment = (await pay(f, invoice.id, 50000)).data.payment;
  const body = { id: uuid(), paymentId: payment.id, reason: 'Keyed against the wrong invoice' };
  const first = await f.call(`${sales}/payments/reverse`, body, 'Sana');
  assert.equal(first.status, 201, first.text);
  const replay = await f.call(`${sales}/payments/reverse`, body, 'Sana');
  assert.equal(replay.status, 200);
  assert.equal(replay.data.reversal.id, first.data.reversal.id);
  rejects(await reverse(f, payment.id), 409, 'already reversed');
  rejects(await f.call(`${sales}/payments/reverse`, { ...body, reason: 'A different explanation' }, 'Sana'), 409, 'different reversal');
  assert.equal(count(f, 'SELECT 1 FROM payment_reversals'), 1);
  assert.equal(audits(f, 'payment.reversed').length, 1);
});

test('a reversal needs a reason of 3 to 500 characters, and a payment that exists', async () => {
  const f = await setup(), { invoice } = await issued(f);
  const payment = (await pay(f, invoice.id, 50000)).data.payment;
  rejects(await reverse(f, payment.id, { reason: 'ab' }), 422, 'Reason');
  rejects(await reverse(f, payment.id, { reason: 'x'.repeat(501) }), 422, 'Reason');
  rejects(await reverse(f, payment.id, { reason: undefined }), 422);
  rejects(await reverse(f, uuid()), 404);
  assert.equal(count(f, 'SELECT 1 FROM payment_reversals'), 0);
});

test('an unpaid invoice that was issued by mistake is voided, and a corrected invoice replaces it', async () => {
  const f = await setup(), { buyerId, invoice, order, request } = await issued(f);
  const voided = await voidInvoice(f, invoice.id);
  assert.equal(voided.status, 201, voided.text);
  assert.equal(voided.data.void.invoice_id, invoice.id);

  const row = (await overview(f)).invoices.find(item => item.id === invoice.id);
  assert.equal(row.status, 'void');
  assert.equal(row.outstanding_minor, 0);
  assert.equal((await overview(f)).orders.find(item => item.id === order.id).status, 'cancelled');
  const buyer = await summaryOf(f, buyerId);
  assert.deepEqual([buyer.outstanding, buyer.invoiced, buyer.sold], [[], [], []], 'a voided invoice leaves the buyer totals');
  assert.equal(count(f, 'SELECT 1 FROM invoice_balances'), 0);

  const replay = await voidInvoice(f, invoice.id, { id: voided.data.void.id });
  assert.equal(replay.status, 200, 'the same request ID returns the same void');
  rejects(await voidInvoice(f, invoice.id), 409, 'already voided');
  rejects(await pay(f, invoice.id, 1000), 404, 'Invoice not found');

  const corrected = await generate(f, { ...request, id: uuid(), quantity: 3 });
  assert.equal(corrected.status, 201, corrected.text);
  assert.notEqual(corrected.data.invoice.number, invoice.number, 'the voided number is not reused');
  assert.equal(corrected.data.invoice.total_minor, 442500, '3 kg at 1250.00 plus 18% GST');
  assert.equal(count(f, 'SELECT 1 FROM invoice_balances WHERE buyer_id=?', buyerId), 1);
  assert.equal(audits(f, 'invoice.voided').length, 1);
});

test('a buyer cannot retrieve an invoice after it has been voided', async () => {
  const f = await setup(), { buyerId, invoice } = await issued(f);
  const userId = uuid(), token = 'a'.repeat(64), now = Date.now();
  f.sql.prepare(`INSERT INTO buyer_users(id,buyer_id,email,name,password_hash,password_salt,created_at)
    VALUES(?,?,?,'Buyer Contact','unused','unused',?)`).run(userId, buyerId, `${userId}@buyer.test`, now);
  f.sql.prepare('INSERT INTO buyer_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .run(createHash('sha256').update(token).digest('hex'), userId, now, now + 3600000);
  assert.equal((await voidInvoice(f, invoice.id)).status, 201);

  const workspace = await inventoryApi(new Request('https://yarnflow.test/api/buyer/workspace', {
    headers: { Cookie: `yf_buyer_session=${token}` },
  }), f.env);
  assert.equal(workspace.status, 200);
  assert.equal((await workspace.json()).invoices.some(row => row.id === invoice.id), false, 'voided invoices are omitted from the buyer list');

  const response = await inventoryApi(new Request(`https://yarnflow.test/api/buyer/invoices/${invoice.id}`, {
    headers: { Cookie: `yf_buyer_session=${token}` },
  }), f.env);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Invoice not found/);
});

test('an invoice with a payment stands until the payment is reversed, then it can be voided', async () => {
  const f = await setup(), { invoice } = await issued(f);
  const payment = (await pay(f, invoice.id, 100000)).data.payment;
  rejects(await voidInvoice(f, invoice.id), 409, 'payment stands');
  assert.equal((await reverse(f, payment.id)).status, 201);
  assert.equal((await voidInvoice(f, invoice.id)).status, 201);
});

test('an invoice cannot be voided once goods were dispatched or a credit note stands', async () => {
  const f = await setup(), dispatched = await issued(f), credited = await issued(f);
  f.sql.prepare("UPDATE sales_orders SET status='partially_dispatched' WHERE id=?").run(dispatched.order.id);
  rejects(await voidInvoice(f, dispatched.invoice.id), 409, 'Goods were dispatched');
  const note = await f.call(`${sales}/credit-notes`, { id: uuid(), invoiceId: credited.invoice.id, amountMinor: 10000, reason: 'Short delivery agreed' }, 'Sana');
  assert.equal(note.status, 201, note.text);
  rejects(await voidInvoice(f, credited.invoice.id), 409, 'credit note');
  assert.equal(count(f, 'SELECT 1 FROM invoice_voids'), 0);
  assert.equal((await overview(f)).invoices.find(item => item.id === dispatched.invoice.id).status, 'unpaid');
});

test('a sent quotation the buyer has not accepted can be withdrawn and then sent again', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), rfqId = await f.insertBuyerRfq({ buyerId });
  const revisionId = uuid();
  const drafted = await f.call(`${sales}/quotes`, { id: revisionId, poId: rfqId, priceMinor: 125000, specifications: 'Combed cotton single jersey, 180 GSM',
    requestedDeliveryAt: Date.now() + 30 * day, paymentTerms: 'Net 30 days', creditDays: 30 }, 'Sana');
  assert.equal(drafted.status, 201, drafted.text);
  assert.equal((await f.call(`${sales}/quotes/send`, { id: revisionId }, 'Sana')).status, 200);
  const withdraw = { id: uuid(), revisionId, reason: 'Wrong rate sent to the buyer' };
  const withdrawn = await f.call(`${sales}/quotes/withdraw`, withdraw, 'Sana');
  assert.equal(withdrawn.status, 201, withdrawn.text);
  assert.equal((await f.call(`${sales}/quotes/withdraw`, withdraw, 'Sana')).status, 200, 'the same request ID replays');
  assert.equal(f.sql.prepare('SELECT status FROM sales_quote_revisions WHERE id=?').get(revisionId).status, 'draft');
  assert.equal(f.sql.prepare('SELECT status,sent_revision_id FROM buyer_purchase_orders WHERE id=?').get(rfqId).status, 'entered');
  assert.equal(audits(f, 'sales.quote_withdrawn').length, 1);
  assert.equal((await f.call(`${sales}/quotes/send`, { id: revisionId }, 'Sana')).status, 200, 'the corrected quotation is sent again');
});

test('an accepted quotation cannot be withdrawn', async () => {
  const f = await setup(), { revisionId } = await f.acceptedQuote();
  rejects(await f.call(`${sales}/quotes/withdraw`, { id: uuid(), revisionId, reason: 'Changed my mind' }, 'Sana'), 409, 'accepted');
  assert.equal(f.sql.prepare('SELECT status FROM sales_quote_revisions WHERE id=?').get(revisionId).status, 'approved');
});

test('an admin reopens a rejected buyer, and nobody else can', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'pending' });
  const rejected = await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'rejected', version: 1, reason: 'Duplicate registration' }, 'Sana');
  assert.equal(rejected.status, 200, rejected.text);
  const body = (version) => ({ id: uuid(), buyerId, version, reason: 'Registered again by mistake' });
  rejects(await f.call(`${sales}/buyers/reopen`, body(2), 'Sana'), 403);
  rejects(await f.call(`${sales}/buyers/reopen`, body(2), 'Qasim'), 403);
  const request = body(2);
  const reopened = await f.call(`${sales}/buyers/reopen`, request, 'Anas');
  assert.equal(reopened.status, 200, reopened.text);
  assert.equal(f.sql.prepare('SELECT status FROM buyers WHERE id=?').get(buyerId).status, 'pending');
  assert.equal((await f.call(`${sales}/buyers/reopen`, request, 'Anas')).status, 200, 'the same request ID replays');
  rejects(await f.call(`${sales}/buyers/reopen`, body(3), 'Anas'), 409, 'Only a rejected buyer');
  assert.equal(audits(f, 'buyer.reopened').length, 1);
  assert.equal((await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'active', version: 3 }, 'Sana')).status, 200, 'the reopened buyer goes through review again');
});

test('a buyer rating typo is voided by its rater or an admin, and drops out of the averages', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  const base = '/erp/buyer-ratings';
  const first = { id: uuid(), buyerId, payment: 1, communication: 1, reliability: 1, feedback: 'Typed the wrong buyer' };
  assert.equal((await f.call(base, first, 'Sana')).status, 201);
  const second = { id: uuid(), buyerId, payment: 5, communication: 5, reliability: 5 };
  assert.equal((await f.call(base, second, 'Maya')).status, 201);
  assert.equal((await f.call(`${base}?buyerId=${buyerId}`, undefined, 'Sana')).data.summary.overall, 3);

  const voidBody = { id: uuid(), ratingId: first.id, reason: 'Meant to rate another buyer' };
  rejects(await f.call(`${base}/void`, voidBody, 'Maya'), 403, 'rated this buyer');
  rejects(await f.call(`${base}/void`, voidBody, 'Qasim'), 403);
  rejects(await f.call(`${base}/void`, { ...voidBody, reason: '' }, 'Sana'), 422);
  rejects(await f.call(`${base}/void`, { ...voidBody, ratingId: uuid() }, 'Sana'), 404);

  const voided = await f.call(`${base}/void`, voidBody, 'Sana');
  assert.equal(voided.status, 201, voided.text);
  assert.equal((await f.call(`${base}/void`, voidBody, 'Sana')).status, 200, 'the same request ID replays');
  rejects(await f.call(`${base}/void`, { ...voidBody, id: uuid() }, 'Sana'), 409, 'already voided');

  const detail = (await f.call(`${base}?buyerId=${buyerId}`, undefined, 'Sana')).data;
  assert.deepEqual(detail.summary, { payment: 5, communication: 5, reliability: 5, overall: 5, count: 1 });
  const struck = detail.ratings.find(rating => rating.id === first.id);
  assert.ok(struck.voided_at, 'the voided rating stays visible for the history');
  assert.equal(struck.void_reason, 'Meant to rate another buyer');
  assert.equal((await f.call(`${base}/summary`, undefined, 'Sana')).data.summaries[buyerId].count, 1);
  assert.equal(count(f, 'SELECT 1 FROM buyer_ratings WHERE id=?', first.id), 1, 'the rating row is not deleted');
});

test('an admin can void any rating with an intervention reason', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), base = '/erp/buyer-ratings';
  const rating = { id: uuid(), buyerId, payment: 2, communication: 2, reliability: 2 };
  assert.equal((await f.call(base, rating, 'Maya')).status, 201);
  const body = { id: uuid(), ratingId: rating.id, reason: 'Rating entered for the wrong buyer' };
  rejects(await f.call(`${base}/void`, body, 'Anas'), 422, 'Intervention reason');
  const voided = await f.call(`${base}/void`, { ...body, interventionReason: 'Confirmed with Maya' }, 'Anas');
  assert.equal(voided.status, 201, voided.text);
});

test('sales managers cannot move the workflow they do not own', async () => {
  const f = await setup(), { invoice } = await issued(f), payment = (await pay(f, invoice.id, 1000)).data.payment;
  rejects(await f.call(`${sales}/payments/reverse`, { id: uuid(), paymentId: payment.id, reason: 'Keyed against the wrong invoice' }, 'Qasim'), 403);
  rejects(await voidInvoice(f, invoice.id, {}, 'Qasim'), 403);
  rejects(await f.call(`${sales}/quotes/withdraw`, { id: uuid(), revisionId: uuid(), reason: 'Wrong rate sent' }, 'Qasim'), 403);
  rejects(await f.call(`${sales}/buyers/reopen`, { id: uuid(), buyerId: uuid(), version: 1, reason: 'Registered again' }, 'Qasim'), 403);
  assert.equal(count(f, 'SELECT 1 FROM payment_reversals'), 0);
  assert.equal(count(f, 'SELECT 1 FROM invoice_voids'), 0);
});

test('the invoice list and buyer totals follow the reversal and void state', async () => {
  const f = await setup(), { invoice } = await issued(f);
  const payment = (await pay(f, invoice.id, 100000)).data.payment;
  const listed = (await overview(f)).invoicePayments;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, payment.id);
  assert.equal(listed[0].reversal_id, null);
  await reverse(f, payment.id, { reason: 'Keyed against the wrong invoice' });
  assert.notEqual((await overview(f)).invoicePayments[0].reversal_id, null);
});
