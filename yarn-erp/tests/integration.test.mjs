import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { inventoryApi } from '../server/inventory.mjs';

const uuid = () => crypto.randomUUID(), DAY = 86400000;
const registration = () => ({ id: uuid(), company: 'Cotton Mill', contactName: 'Mill Contact', email: 'mill@example.test', phone: '+923001234567', categories: ['cotton'] });
async function setup() {
  const f = await portalFixture();
  f.env.SUPPLIER_PORTAL_TOKEN = 's'.repeat(40); f.env.BUYER_PORTAL_TOKEN = 'b'.repeat(40);
  await f.person('Pervaiz', 'purchase_manager'); await f.person('Sana', 'sales_manager');
  f.api = async (path, body, token = path.startsWith('/suppliers') || path === '/bids' ? f.env.SUPPLIER_PORTAL_TOKEN : f.env.BUYER_PORTAL_TOKEN) => {
    const response = await inventoryApi(new Request('https://yarnflow.test/api/integration/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), f.env);
    const text = await response.text(); return { status: response.status, headers: response.headers, text, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
  };
  f.rows = (sql, ...args) => f.sql.prepare(sql).all(...args);
  return f;
}
async function rfq(f) {
  const data = { id: uuid(), title: 'Cotton combed 30/1', categoryId: 'cotton', specifications: 'Ring spun weaving grade', quantityMilli: 100000, unit: 'kg', deadlineAt: Date.now() + DAY, requestedDeliveryAt: Date.now() + 7 * DAY };
  assert.equal((await f.call('/erp/rfqs', data, 'Pervaiz')).status, 201);
  assert.equal((await f.call('/erp/rfqs/publish', { id: data.id }, 'Pervaiz')).status, 200); return data.id;
}
const bid = (supplierId, rfqId) => ({ id: uuid(), supplierId, rfqId, version: 0, quantityMilli: 100000, priceMinor: 125000, currency: 'PKR', paymentTerms: 'Net 30 days', deliveryAt: Date.now() + 7 * DAY, validUntil: Date.now() + 3 * DAY });
const buyerRfq = buyerId => ({ id: uuid(), buyerId, reference: 'RFQ-' + uuid(), specifications: 'Combed cotton single jersey', quantityMilli: 100000, unit: 'kg', requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30 days' });
async function quote(f, buyerId) {
  const id = await f.insertBuyerRfq({ buyerId });
  const made = await f.call('/erp/sales/quotes', { id: uuid(), poId: id, priceMinor: 125000, specifications: 'Combed cotton single jersey', requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30 days', creditDays: 30 }, 'Sana');
  assert.equal(made.status, 201, made.text);
  assert.equal((await f.call('/erp/sales/quotes/send', { id: made.data.revision.id }, 'Sana')).status, 200); return made.data.revision;
}
test('intake needs its own portal token', async () => {
  const f = await setup(), data = registration();
  assert.equal((await f.api('/suppliers', data, null)).status, 401);
  assert.equal((await f.api('/suppliers', data, f.env.BUYER_PORTAL_TOKEN)).status, 401);
  delete f.env.SUPPLIER_PORTAL_TOKEN;
  const missing = await f.api('/suppliers', data, 's'.repeat(40)); assert.equal(missing.status, 503); assert.equal(missing.data.error, 'The supplier portal connection is not configured.');
});
test('a supplier registration arrives pending and tells purchase managers', async () => {
  const f = await setup(), body = registration(), made = await f.api('/suppliers', body);
  assert.equal(made.status, 201, made.text); assert.equal(made.data.supplier.status, 'pending');
  assert.equal((await f.api('/suppliers', body)).status, 200);
  assert.equal((await f.api('/suppliers', { ...body, email: 'other@example.test' })).status, 409);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='supplier.pending'").length, 1);
  assert.equal(f.rows("SELECT * FROM erp_audit_events WHERE action='supplier.registered'")[0].actor_id, body.id);
});
test('only approved suppliers bid, in the factory currency, before the deadline', async () => {
  const f = await setup(), sid = await f.insertSupplier({ status: 'approved' }), rid = await rfq(f), body = bid(sid, rid);
  f.sql.prepare("UPDATE suppliers SET status='pending' WHERE id=?").run(sid);
  assert.equal((await f.api('/bids', body)).status, 403);
  f.sql.prepare("UPDATE suppliers SET status='approved' WHERE id=?").run(sid);
  const wrong = await f.api('/bids', { ...body, currency: 'USD' }); assert.equal(wrong.status, 422); assert.equal(wrong.data.error, 'Bid in PKR.');
  f.sql.prepare('UPDATE procurement_rfqs SET deadline_at=? WHERE id=?').run(Date.now() - 1, rid);
  assert.equal((await f.api('/bids', body)).status, 409);
  f.sql.prepare('UPDATE procurement_rfqs SET deadline_at=? WHERE id=?').run(Date.now() + DAY, rid);
  assert.equal((await f.api('/bids', body)).status, 201);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 1);
});
test('bids are sealed: each supplier reads only its own bid results', async () => {
  const f = await setup(), a = await f.insertSupplier({ status: 'approved' }), b = await f.insertSupplier({ status: 'approved' }), r = await rfq(f), ba = bid(a, r), bb = { ...bid(b, r), priceMinor: 119000 };
  assert.equal((await f.api('/bids', ba)).status, 201); assert.equal((await f.api('/bids', bb)).status, 201);
  const result = await f.api(`/suppliers/${a}/bid-results`); assert.equal(result.status, 200); assert.ok(result.text.includes(ba.id)); assert.ok(!result.text.includes(bb.id)); assert.ok(!result.text.includes('119000'));
  assert.equal(result.data.results[0].status, 'submitted');
});
test('purchase RFQs reach only approved suppliers in the category', async () => {
  const f = await setup(), a = await f.insertSupplier({ status: 'approved' }), c = await f.insertSupplier({ status: 'approved', categories: ['synthetic'] }), r = await rfq(f);
  assert.equal((await f.api(`/suppliers/${a}/rfqs`)).data.rfqs[0].id, r); assert.deepEqual((await f.api(`/suppliers/${c}/rfqs`)).data.rfqs, []);
  f.sql.prepare("UPDATE suppliers SET status='suspended' WHERE id=?").run(a); assert.equal((await f.api(`/suppliers/${a}/rfqs`)).status, 403);
});
test('RFQs from pending buyers are held; the sales manager hears once the buyer is approved', async () => {
  const f = await setup(), { categories, ...body } = registration();
  assert.equal((await f.api('/buyers', body)).status, 201); assert.equal((await f.api('/buyers', body)).status, 200);
  const data = buyerRfq(body.id), made = await f.api('/buyer-rfqs', data); assert.equal(made.status, 201, made.text); assert.equal(made.data.rfq.state, 'awaiting_buyer_approval');
  assert.equal((await f.api('/buyer-rfqs', data)).status, 200); assert.equal((await f.api('/buyer-rfqs', { ...data, unit: 'piece' })).status, 409);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='buyer_rfq.received'").length, 0);
  assert.equal((await f.call('/erp/sales/buyers/review', { id: body.id, status: 'active', version: 1 }, 'Sana')).status, 200);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='buyer_rfq.received'").length, 1);
  const rejected = await f.insertBuyer({ status: 'rejected' }); assert.equal((await f.api('/buyer-rfqs', buyerRfq(rejected))).status, 403);
});
test('a buyer accepts only the latest sent quotation, once', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), q = await quote(f, buyerId), body = { buyerId, quotationId: q.id, version: q.version, acceptedBy: 'Display Contact' };
  assert.equal((await f.api('/acceptances', body)).status, 201); assert.equal((await f.api('/acceptances', body)).data.already, true);
  assert.equal((await f.api('/acceptances', { ...body, version: 0 })).status, 409);
  assert.equal((await f.api('/acceptances', { ...body, acceptedBy: 'Other Contact' })).status, 409);
  const stored = f.rows('SELECT * FROM quotation_acceptances')[0]; assert.equal(stored.created_by, buyerId); assert.equal(stored.accepted_by, body.acceptedBy);
  const event = f.rows("SELECT * FROM erp_audit_events WHERE action='quotation.accepted'")[0]; assert.equal(event.actor_id, buyerId); assert.equal(event.actor_role, 'buyer');
});
test('quotations and invoices go out only to their own buyer', async () => {
  const f = await setup(), a = await f.insertBuyer({ status: 'active' }), b = await f.insertBuyer({ status: 'active' }), q = await quote(f, a);
  assert.equal((await f.api(`/buyers/${a}/quotations`)).data.quotations.length, 1); assert.deepEqual((await f.api(`/buyers/${b}/quotations`)).data.quotations, []);
  assert.equal((await f.api('/acceptances', { buyerId: b, quotationId: q.id, version: 1, acceptedBy: 'Other Buyer' })).status, 404);
  await f.api('/acceptances', { buyerId: a, quotationId: q.id, version: 1, acceptedBy: 'Buyer Contact' });
  const sale = await f.call('/erp/sales/sales', { id: uuid(), revisionId: q.id }, 'Sana'); assert.equal(sale.status, 201, sale.text);
  assert.deepEqual((await f.api(`/buyers/${b}/invoices`)).data.invoices, []);
  const doc = await f.api(`/buyers/${a}/invoices/${sale.data.invoice.id}`); assert.equal(doc.status, 200); assert.match(doc.headers.get('content-type'), /text\/html/); assert.match(doc.text, /INV-/);
  assert.equal((await f.api(`/buyers/${b}/invoices/${sale.data.invoice.id}`)).status, 404);
});
test('server-to-server calls need no Origin header', async () => {
  const f = await setup(); assert.equal((await f.api('/suppliers', registration())).status, 201);
  assert.equal((await inventoryApi(new Request('https://yarnflow.test/api/erp/rfqs', { method: 'POST', body: '{}' }), f.env)).status, 403);
});
test('bid replay and actor attribution are explicit across both transports', async () => {
  const f = await setup(), a = await f.insertSupplier({ status: 'approved' }), b = await f.insertSupplier({ status: 'approved' }), r = await rfq(f), body = bid(a, r);
  const results = await Promise.all([f.api('/bids', body), f.api('/bids', body)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal((await f.api('/bids', body)).status, 200); assert.equal((await f.api('/bids', { ...body, priceMinor: 1 })).status, 409);
  assert.equal((await f.api('/bids', { ...body, supplierId: b })).status, 409);
  assert.equal(f.rows('SELECT * FROM supplier_bid_history').length, 1); assert.equal(f.rows('SELECT * FROM supplier_bid_history')[0].actor_id, a);
  const event = f.rows("SELECT * FROM erp_audit_events WHERE action='bid.submitted'")[0]; assert.deepEqual([event.actor_id, event.actor_type, event.actor_role], [a, 'supplier', 'supplier']);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 1);
  const legacy = bid(b, r), userId = b;
  const response = await f.api('/bids', legacy);
  assert.equal(response.status, 201); assert.equal(f.rows('SELECT * FROM supplier_bid_history WHERE bid_id=?', legacy.id)[0].actor_id, userId);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 2);
  assert.equal((await f.api('/bids', { ...body, version: 1, priceMinor: 126000 })).status, 201);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 3);
});
test('lost bid, RFQ intake and acceptance races roll back every side effect', async () => {
  const f = await setup(), sid = await f.insertSupplier({ status: 'approved' }), rid = await rfq(f), body = bid(sid, rid);
  const race = action => { const batch = f.env.DB.batch; f.env.DB.batch = async statements => { f.env.DB.batch = batch; await action(); return batch(statements); }; };
  race(() => f.sql.prepare("UPDATE suppliers SET status='suspended' WHERE id=?").run(sid));
  assert.equal((await f.api('/bids', body)).status, 409); assert.equal(f.rows('SELECT * FROM supplier_bids').length, 0); assert.equal(f.rows('SELECT * FROM supplier_bid_history').length, 0); assert.equal(f.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 0);
  const buyerId = await f.insertBuyer({ status: 'active' });
  race(() => f.sql.prepare("UPDATE buyers SET status='suspended' WHERE id=?").run(buyerId));
  assert.equal((await f.api('/buyer-rfqs', buyerRfq(buyerId))).status, 409); assert.equal(f.rows('SELECT * FROM buyer_purchase_orders').length, 0); assert.equal(f.rows("SELECT * FROM notifications WHERE event='buyer_rfq.received'").length, 0);
  f.sql.prepare("UPDATE buyers SET status='active' WHERE id=?").run(buyerId); const q = await quote(f, buyerId);
  race(() => f.sql.prepare("UPDATE buyers SET status='suspended' WHERE id=?").run(buyerId));
  assert.equal((await f.api('/acceptances', { buyerId, quotationId: q.id, version: 1, acceptedBy: 'Buyer Contact' })).status, 409);
  assert.equal(f.rows('SELECT * FROM quotation_acceptances').length, 0); assert.equal(f.rows("SELECT * FROM erp_audit_events WHERE action IN ('bid.submitted','sales.po_submitted','quotation.accepted')").length, 0);
});
test('a stale bid update aborts history, audit and notifications; currency and RFQ races abort creation', async () => {
  const f = await setup(), sid = await f.insertSupplier({ status: 'approved' }), rid = await rfq(f), body = bid(sid, rid);
  assert.equal((await f.api('/bids', body)).status, 201);
  const batch = f.env.DB.batch;
  f.env.DB.batch = async statements => {
    f.env.DB.batch = batch;
    assert.equal((await f.api('/bids', { ...body, version: 1, priceMinor: 130000 })).status, 201);
    return batch(statements);
  };
  assert.equal((await f.api('/bids', { ...body, version: 1, priceMinor: 140000 })).status, 409);
  assert.equal(f.rows('SELECT * FROM supplier_bid_history').length, 2);
  assert.equal(f.rows("SELECT * FROM erp_audit_events WHERE action='bid.submitted'").length, 2);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 2);
  assert.equal(f.rows('SELECT price_minor FROM supplier_bids')[0].price_minor, 130000);
  assert.equal((await f.api('/bids', body)).status, 200, 'old snapshot still replays after a revision');
  assert.equal((await f.api('/bids', { ...body, supplierId: uuid() })).status, 404);
  for (const change of ['currency', 'closed', 'recipient']) {
    const g = await setup(), supplier = await g.insertSupplier({ status: 'approved' }), r = await rfq(g), original = g.env.DB.batch;
    g.env.DB.batch = async statements => {
      g.env.DB.batch = original;
      if (change === 'currency') assert.equal((await g.call('/erp/admin/settings', { key: 'currency', value: 'USD' })).status, 200);
      else if (change === 'closed') g.sql.prepare("UPDATE procurement_rfqs SET status='closed' WHERE id=?").run(r);
      else g.sql.prepare('DELETE FROM rfq_recipients WHERE rfq_id=?').run(r);
      return original(statements);
    };
    assert.equal((await g.api('/bids', bid(supplier, r))).status, 409, change);
    assert.equal(g.rows('SELECT * FROM supplier_bids').length, 0); assert.equal(g.rows('SELECT * FROM supplier_bid_history').length, 0);
    assert.equal(g.rows("SELECT * FROM erp_audit_events WHERE action='bid.submitted'").length, 0); assert.equal(g.rows("SELECT * FROM notifications WHERE event='bid.received'").length, 0);
  }
});
test('buyer approval racing RFQ intake requires retry and sends one received notification', async () => {
  const f = await setup(), buyerId = await f.insertBuyer(), body = buyerRfq(buyerId), batch = f.env.DB.batch;
  f.env.DB.batch = async statements => {
    f.env.DB.batch = batch;
    assert.equal((await f.call('/erp/sales/buyers/review', { id: buyerId, status: 'active', version: 1 }, 'Sana')).status, 200);
    return batch(statements);
  };
  assert.equal((await f.api('/buyer-rfqs', body)).status, 409);
  assert.equal(f.rows('SELECT * FROM buyer_purchase_orders').length, 0); assert.equal(f.rows("SELECT * FROM erp_audit_events WHERE action='sales.po_submitted'").length, 0);
  assert.equal((await f.api('/buyer-rfqs', body)).status, 201); assert.equal((await f.api('/buyer-rfqs', body)).status, 200);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='buyer_rfq.received'").length, 1);
});
test('a replacement quotation winning the acceptance race leaves no acceptance or audit', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), first = await quote(f, buyerId);
  const draft = await f.call('/erp/sales/quotes', { id: uuid(), poId: first.buyer_po_id, priceMinor: 140000, specifications: 'Combed cotton single jersey', requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30 days', creditDays: 30 }, 'Sana'); assert.equal(draft.status, 201);
  const batch = f.env.DB.batch;
  f.env.DB.batch = async statements => { f.env.DB.batch = batch; assert.equal((await f.call('/erp/sales/quotes/send', { id: draft.data.revision.id }, 'Sana')).status, 200); return batch(statements); };
  const body = { buyerId, quotationId: first.id, version: 1, acceptedBy: 'Buyer Contact' };
  assert.equal((await f.api('/acceptances', body)).status, 409); assert.equal((await f.api('/acceptances', body)).status, 409);
  assert.equal(f.rows('SELECT * FROM quotation_acceptances').length, 0); assert.equal(f.rows("SELECT * FROM erp_audit_events WHERE action='quotation.accepted'").length, 0);
  assert.equal((await f.api(`/buyers/${buyerId}/quotations`)).data.quotations[0].id, draft.data.revision.id);
});
test('bid results reflect rejection, pending award, award and cancellation without competing prices', async () => {
  const f = await setup(), a = await f.insertSupplier({ status: 'approved' }), b = await f.insertSupplier({ status: 'approved' }), r = await rfq(f), ba = bid(a, r), bb = bid(b, r);
  await f.api('/bids', ba); await f.api('/bids', bb); f.setThreshold('purchase', 1);
  const pending = await f.call('/erp/bids/award', { id: ba.id, version: 1 }, 'Pervaiz');
  assert.equal(pending.status, 202, pending.text);
  assert.equal((await f.api(`/suppliers/${a}/bid-results`)).data.results[0].status, 'pending_award');
  const approval = f.rows("SELECT * FROM approval_requests WHERE type='purchase_award'")[0];
  assert.equal((await f.call('/erp/approvals/decide', { id: approval.id, decision: 'approve' })).status, 200);
  const won = (await f.api(`/suppliers/${a}/bid-results`)).data.results[0]; assert.equal(won.status, 'awarded'); assert.equal(won.purchaseOrder.quantityMilli, 100000); assert.equal(won.purchaseOrder.totalMinor, 12500000);
  assert.equal((await f.api(`/suppliers/${b}/bid-results`)).data.results[0].status, 'not_awarded');
  const r2 = await rfq(f), rejected = bid(a, r2), cancelled = bid(b, r2); await f.api('/bids', rejected); await f.api('/bids', cancelled);
  assert.equal((await f.call('/erp/bids/reject', { id: rejected.id, version: 1, reason: 'Delivery too late' }, 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/rfqs/cancel', { id: r2, reason: 'Requirement withdrawn' }, 'Pervaiz')).status, 200);
  const result = (await f.api(`/suppliers/${a}/bid-results`)).data.results.find(r => r.bidId === rejected.id); assert.equal(result.status, 'rejected'); assert.equal(result.rejectionReason, 'Delivery too late');
  assert.equal((await f.api(`/suppliers/${b}/bid-results`)).data.results.find(r => r.bidId === cancelled.id).status, 'not_awarded');
});

test('supplier review and profile edits preserve the registration replay key', async () => {
  const f = await setup(), body = registration(); assert.equal((await f.api('/suppliers', body)).status, 201);
  assert.equal((await f.call('/erp/suppliers/review', { id: body.id, status: 'approved', version: 1 }, 'Pervaiz')).status, 200);
  assert.equal((await f.api('/suppliers', body)).status, 200);
  assert.equal((await f.call('/erp/suppliers/profile', { id: body.id, version: 2, city: 'Lahore' }, 'Pervaiz')).status, 200);
  const retry = await f.api('/suppliers', body); assert.equal(retry.status, 200); assert.equal(retry.data.supplier.city, 'Lahore');
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='supplier.pending'").length, 1);
});
test('RFQ intake winning the buyer approval race makes approval retry without losing the notification', async () => {
  const f = await setup(), buyerId = await f.insertBuyer(), batch = f.env.DB.batch;
  await f.login('Sana');
  f.env.DB.batch = async statements => { f.env.DB.batch = batch; assert.equal((await f.api('/buyer-rfqs', buyerRfq(buyerId))).status, 201); return batch(statements); };
  const review = { id: buyerId, status: 'active', version: 1 };
  assert.equal((await f.call('/erp/sales/buyers/review', review, 'Sana')).status, 409);
  assert.equal(f.rows('SELECT status FROM buyers WHERE id=?', buyerId)[0].status, 'pending');
  assert.equal(f.rows("SELECT * FROM erp_audit_events WHERE action='buyer.approved'").length, 0);
  assert.equal((await f.call('/erp/sales/buyers/review', review, 'Sana')).status, 200);
  assert.equal(f.rows("SELECT * FROM notifications WHERE event='buyer_rfq.received'").length, 1);
});
test('the factory no longer serves portal session APIs', async () => {
  const f = await setup();
  assert.equal((await f.call('/portal/login', {})).status, 404); assert.equal((await f.call('/buyer/login', {})).status, 404); assert.equal((await f.call('/portal/config')).status, 404);
});
