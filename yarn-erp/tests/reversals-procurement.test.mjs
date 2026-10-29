import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';

// Every correction is a new record with a reason: wrong award, bid, RFQ, bill of lading, supplier, rating, person, approval.
const fixture = async () => {
  const f = await portalFixture();
  await f.person('Pervaiz', 'purchase_manager'); await f.person('Saima', 'supervisor');
  f.supplier = await f.insertSupplier({ status: 'approved' });
  for (const name of ['Pervaiz', 'Saima', 'Anas', 'Fahad']) await f.login(name);
  return f;
};
const day = 86400000, uuid = () => crypto.randomUUID();
const rfqBody = (extra = {}) => ({ id: uuid(), title: 'Cotton combed 30/1', categoryId: 'cotton', specifications: 'Ring-spun 30/1, weaving grade', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'FAZ textile factory', deadlineAt: Date.now() + day, requestedDeliveryAt: Date.now() + 7 * day, ...extra });
async function published(f, extra) {
  const body = rfqBody(extra);
  assert.equal((await f.call('/erp/rfqs', body, 'Pervaiz')).status, 201);
  assert.equal((await f.call('/erp/rfqs/publish', { id: body.id }, 'Pervaiz')).status, 200);
  return body.id;
}
// A second approved supplier that received the RFQ and bid on it.
async function rival(f, rfqId, priceMinor = 130000) {
  const supplierId = await f.insertSupplier({ status: 'approved' });
  f.sql.prepare("INSERT INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) VALUES(?,?,'{}',1)").run(rfqId, supplierId);
  return f.insertBid({ rfqId, supplierId, priceMinor });
}
const award = (f, bidId, as = 'Pervaiz') => f.call('/erp/bids/award', { id: bidId, version: 1 }, as);
const rfqStatus = async (f, rfqId) => (await f.call('/erp/procurement', undefined, 'Pervaiz')).data.rfqs.find(r => r.id === rfqId).status;
const liveOrder = (f, rfqId) => f.sql.prepare("SELECT * FROM supplier_purchase_orders WHERE rfq_id=? AND status!='cancelled'").get(rfqId);
const count = (f, sql, ...args) => f.sql.prepare(sql).get(...args).n;

test('a wrong award is cancelled, the RFQ reopens for awarding, and the right bid can then win', async () => {
  const f = await fixture(), rfqId = await published(f);
  const wrong = f.insertBid({ rfqId, supplierId: f.supplier }), right = await rival(f, rfqId);
  assert.equal((await award(f, wrong)).status, 201);
  const first = liveOrder(f, rfqId);
  const cancelled = await f.call('/erp/orders/cancel', { id: uuid(), orderId: first.id, reason: 'Awarded the wrong bid' }, 'Pervaiz');
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(f.sql.prepare('SELECT status FROM supplier_purchase_orders WHERE id=?').get(first.id).status, 'cancelled');
  assert.equal(await rfqStatus(f, rfqId), 'closed');
  // The cancelled PO keeps its terms: the immutability trigger survived the table rebuild.
  assert.throws(() => f.sql.prepare("UPDATE supplier_purchase_orders SET terms_snapshot='{}' WHERE id=?").run(first.id), /immutable/);
  assert.equal((await award(f, right)).status, 201);
  assert.equal(liveOrder(f, rfqId).bid_id, right);
  assert.equal(await rfqStatus(f, rfqId), 'awarded');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM supplier_purchase_orders WHERE rfq_id=?', rfqId), 2);
});

test('an order cannot be cancelled once a bill of lading is attached, or once goods have arrived', async () => {
  const f = await fixture(), rfqId = await published(f);
  await award(f, f.insertBid({ rfqId, supplierId: f.supplier }));
  const order = liveOrder(f, rfqId);
  assert.equal((await f.call('/erp/shipments', { id: uuid(), orderId: order.id, billOfLading: 'MSCU1234567' }, 'Pervaiz')).status, 201);
  const blocked = await f.call('/erp/orders/cancel', { id: uuid(), orderId: order.id, reason: 'Wrong bid chosen' }, 'Pervaiz');
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /bill of lading/);
  // Goods booked in through QC: the arrival check comes first.
  await f.submitted({ acceptedMilli: 1000 });
  const arrived = f.sql.prepare('SELECT purchase_order_id FROM qc_lots LIMIT 1').get();
  const refused = await f.call('/erp/orders/cancel', { id: uuid(), orderId: arrived.purchase_order_id, reason: 'Wrong bid chosen' }, 'Pervaiz');
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /arrived/);
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM erp_reversals WHERE action='order.cancelled'"), 0);
});

test('a repeated request does nothing twice, and a wrong role, a missing reason or a second cancel is refused', async () => {
  const f = await fixture(), rfqId = await published(f);
  await award(f, f.insertBid({ rfqId, supplierId: f.supplier }));
  const order = liveOrder(f, rfqId), id = uuid(), body = { id, orderId: order.id, reason: 'Wrong bid chosen' };
  assert.equal((await f.call('/erp/orders/cancel', body, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/orders/cancel', { ...body, id: uuid(), reason: 'no' }, 'Pervaiz')).status, 422);
  assert.equal((await f.call('/erp/orders/cancel', { id: uuid(), orderId: order.id }, 'Pervaiz')).status, 422);
  assert.equal((await f.call('/erp/orders/cancel', body, 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/orders/cancel', body, 'Pervaiz')).status, 200, 'the same request ID is a replay');
  assert.equal((await f.call('/erp/orders/cancel', { ...body, id: uuid() }, 'Pervaiz')).status, 409, 'a new request cannot cancel it again');
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM erp_reversals WHERE action='order.cancelled'"), 1);
});

test('a pending award is withdrawn with its reason, and the RFQ can be awarded again', async () => {
  const f = await fixture(); f.setThreshold('purchase', 1);
  const rfqId = await published(f), bidId = f.insertBid({ rfqId, supplierId: f.supplier }), other = await rival(f, rfqId);
  assert.equal((await award(f, bidId)).status, 202);
  const approval = f.sql.prepare("SELECT * FROM approval_requests WHERE type='purchase_award' AND status='pending'").get();
  const body = { id: uuid(), approvalId: approval.id, reason: 'Wrong bid chosen' };
  assert.equal((await f.call('/erp/orders/cancel', body, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/orders/cancel', body, 'Pervaiz')).status, 200);
  const withdrawn = f.sql.prepare('SELECT status,reason FROM approval_requests WHERE id=?').get(approval.id);
  assert.equal(withdrawn.status, 'rejected');
  assert.match(withdrawn.reason, /^Withdrawn: Wrong bid chosen/);
  assert.equal((await f.call('/erp/orders/cancel', body, 'Pervaiz')).status, 200, 'the same request is a replay');
  assert.equal((await award(f, other)).status, 202);
});

test('an approved award is undone by cancelling its PO, and only admins can undo', async () => {
  const f = await fixture(); f.setThreshold('purchase', 1);
  const rfqId = await published(f), bidId = f.insertBid({ rfqId, supplierId: f.supplier });
  assert.equal((await award(f, bidId)).status, 202);
  const approval = f.sql.prepare("SELECT * FROM approval_requests WHERE type='purchase_award' AND status='pending'").get();
  assert.equal((await f.call('/erp/approvals/decide', { id: approval.id, decision: 'approve' }, 'Anas')).status, 200);
  const order = liveOrder(f, rfqId);
  const listed = (await f.call('/erp/approvals?status=approved', undefined, 'Anas')).data.approvals.find(a => a.id === approval.id);
  assert.equal(listed.undo.available, true);
  const undo = { id: approval.id, requestId: uuid(), reason: 'Approved the wrong bid' };
  assert.equal((await f.call('/erp/approvals/undo', undo, 'Pervaiz')).status, 403);
  assert.equal((await f.call('/erp/approvals/undo', undo, 'Anas')).status, 200);
  assert.equal(f.sql.prepare('SELECT status FROM supplier_purchase_orders WHERE id=?').get(order.id).status, 'cancelled');
  assert.equal(await rfqStatus(f, rfqId), 'closed');
  assert.equal((await f.call('/erp/approvals/undo', { ...undo, requestId: uuid() }, 'Anas')).status, 409, 'already undone');
  const after = (await f.call('/erp/approvals?status=approved', undefined, 'Anas')).data.approvals.find(a => a.id === approval.id);
  assert.equal(after.undo.available, false);
  assert.match(after.undo.message, /already undone/);
});

test('a final decision that cannot be compensated says so, and no undo is offered', async () => {
  const f = await fixture();
  const rfqId = await published(f), bidId = f.insertBid({ rfqId, supplierId: f.supplier });
  await award(f, bidId);
  // A rejected approval has nothing to undo; approved quantity changes have no compensating reversal.
  f.sql.prepare("INSERT INTO approval_requests(id,workspace_id,type,object_type,object_id,amount,threshold,unit,currency,payload_json,status,requested_by,requested_role,created_by,created_at,updated_at,decided_by,decided_at,reason) VALUES(?,?,'po_change','purchase_order',?,1,1,'minor','PKR','{}','approved',?,'purchase_manager',?,1,1,?,1,'Approved change')")
    .run(uuid(), f.workspaceId, liveOrder(f, rfqId).id, f.adminId, f.adminId, f.adminId);
  const row = f.sql.prepare("SELECT id FROM approval_requests WHERE type='po_change'").get();
  const listed = (await f.call('/erp/approvals?status=approved&type=po_change', undefined, 'Anas')).data.approvals.find(a => a.id === row.id);
  assert.equal(listed.undo.available, false);
  assert.match(listed.undo.message, /final/);
  assert.equal((await f.call('/erp/approvals/undo', { id: row.id, requestId: uuid(), reason: 'Wrong change' }, 'Anas')).status, 409);
});

test('a bid rejected by mistake comes back while the RFQ is open, and can then be awarded', async () => {
  const f = await fixture(), rfqId = await published(f), bidId = f.insertBid({ rfqId, supplierId: f.supplier });
  assert.equal((await f.call('/erp/bids/reject', { id: bidId, version: 1, reason: 'Wrong supplier listed' }, 'Pervaiz')).status, 200);
  const undo = { id: uuid(), bidId, version: 1, reason: 'Rejected by mistake' };
  assert.equal((await f.call('/erp/bids/reject/undo', undo, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/bids/reject/undo', undo, 'Pervaiz')).status, 200);
  assert.equal(f.sql.prepare('SELECT status,rejection_reason FROM supplier_bids WHERE id=?').get(bidId).status, 'submitted');
  assert.equal((await f.call('/erp/bids/reject/undo', undo, 'Pervaiz')).status, 200, 'the same request is a replay');
  assert.equal((await award(f, bidId)).status, 201);
});

test('a bid rejection cannot be undone once another bid has been awarded', async () => {
  const f = await fixture(), rfqId = await published(f);
  const rejected = f.insertBid({ rfqId, supplierId: f.supplier }), winner = await rival(f, rfqId);
  assert.equal((await f.call('/erp/bids/reject', { id: rejected, version: 1, reason: 'Wrong supplier listed' }, 'Pervaiz')).status, 200);
  assert.equal((await award(f, winner)).status, 201);
  const refused = await f.call('/erp/bids/reject/undo', { id: uuid(), bidId: rejected, version: 1, reason: 'Rejected by mistake' }, 'Pervaiz');
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /already awarded/);
});

test('a closed RFQ reopens while nothing is awarded, and an awarded one does not', async () => {
  const f = await fixture(), rfqId = await published(f);
  assert.equal((await f.call('/erp/rfqs/close', { id: rfqId }, 'Pervaiz')).status, 200);
  assert.equal(await rfqStatus(f, rfqId), 'closed');
  const reopen = { id: uuid(), rfqId, reason: 'Closed by mistake' };
  assert.equal((await f.call('/erp/rfqs/reopen', reopen, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/rfqs/reopen', reopen, 'Pervaiz')).status, 200);
  assert.equal(await rfqStatus(f, rfqId), 'open');
  await award(f, f.insertBid({ rfqId, supplierId: f.supplier }));
  const refused = await f.call('/erp/rfqs/reopen', { id: uuid(), rfqId, reason: 'Trying again' }, 'Pervaiz');
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /awarded/);
});

test('a mistyped bill of lading is corrected while tracking has no events, with the old number audited', async () => {
  const f = await fixture(), rfqId = await published(f);
  await award(f, f.insertBid({ rfqId, supplierId: f.supplier }));
  const order = liveOrder(f, rfqId), shipmentId = uuid();
  assert.equal((await f.call('/erp/shipments', { id: shipmentId, orderId: order.id, billOfLading: 'MSCU1234567' }, 'Pervaiz')).status, 201);
  const fix = { id: uuid(), shipmentId, billOfLading: 'MSCU7654321', reason: 'Typed the BL wrong' };
  assert.equal((await f.call('/erp/shipments/correct', fix, 'Saima')).status, 403);
  const corrected = await f.call('/erp/shipments/correct', fix, 'Pervaiz');
  assert.equal(corrected.status, 200, corrected.text);
  assert.equal(corrected.data.shipment.bill_of_lading, 'MSCU7654321');
  assert.equal(f.sql.prepare('SELECT bill_of_lading FROM supplier_purchase_orders WHERE id=?').get(order.id).bill_of_lading, 'MSCU7654321');
  const audit = f.sql.prepare("SELECT old_json,new_json,reason FROM erp_audit_events WHERE action='shipment.bl_corrected'").get();
  assert.deepEqual([JSON.parse(audit.old_json), JSON.parse(audit.new_json), audit.reason], [{ billOfLading: 'MSCU1234567' }, { billOfLading: 'MSCU7654321' }, 'Typed the BL wrong']);
  assert.equal((await f.call('/erp/shipments/correct', fix, 'Pervaiz')).status, 200, 'the same request is a replay');
  f.sql.prepare('INSERT INTO shipment_events(id,workspace_id,shipment_id,at,title,code,location,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uuid(), f.workspaceId, shipmentId, Date.now(), 'Departed', 'DEP', 'Karachi', Date.now());
  const late = await f.call('/erp/shipments/correct', { id: uuid(), shipmentId, billOfLading: 'MSCU1111111', reason: 'Another typo' }, 'Pervaiz');
  assert.equal(late.status, 409);
  assert.match(late.data.error, /events/);
});

test('a removed person is restored with no PIN, so they sign in only after an admin sets a new one', async () => {
  const f = await fixture(), gul = await f.person('Gul', 'purchase_manager');
  assert.equal((await f.call('/erp/admin/users/remove', { userId: gul }, 'Anas')).status, 200);
  assert.equal((await f.call('/erp/admin/users?removed=1', undefined, 'Anas')).data.users.map(u => u.id).includes(gul), true);
  const restore = { id: uuid(), userId: gul, reason: 'Removed by mistake' };
  assert.equal((await f.call('/erp/admin/users/restore', restore, 'Pervaiz')).status, 403);
  assert.equal((await f.call('/erp/admin/users/restore', restore, 'Anas')).status, 200);
  assert.equal((await f.call('/erp/admin/users/restore', restore, 'Anas')).status, 200, 'the same request is a replay');
  const listed = (await f.call('/erp/admin/users', undefined, 'Anas')).data.users.find(u => u.id === gul);
  assert.equal(listed.needsPin, true);
  assert.notEqual((await f.login('Gul')).status, 200, 'the old PIN no longer works');
  assert.equal((await f.call('/erp/admin/users/update', { id: gul, pin: '1357' }, 'Anas')).status, 200);
  assert.equal((await f.login('Gul', '1357')).status, 200);
  assert.equal((await f.call('/erp/admin/users/restore', { id: uuid(), userId: gul, reason: 'Not removed now' }, 'Anas')).status, 409);
});

test('a name typo is fixed, and a name already in use is refused', async () => {
  const f = await fixture(), id = await f.person('Gulzaarr', 'quality_inspector');
  assert.equal((await f.call('/erp/admin/users/update', { id, name: 'Gulzaar' }, 'Anas')).status, 200);
  assert.equal(f.sql.prepare('SELECT name,name_key FROM users WHERE id=?').get(id).name_key, 'gulzaar');
  assert.equal((await f.call('/erp/admin/users/update', { id, name: 'pervaiz' }, 'Anas')).status, 409);
  assert.equal((await f.call('/erp/admin/users/update', { id, name: 'G' }, 'Anas')).status, 422);
});

test('a voided rating leaves the supplier average and shows struck through', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'approved' }), good = uuid(), bad = uuid();
  assert.equal((await f.call('/erp/suppliers/ratings', { id: good, supplierId: s, delivery: 5, quality: 5, terms: 5 }, 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/suppliers/ratings', { id: bad, supplierId: s, delivery: 1, quality: 1, terms: 1 }, 'Pervaiz')).status, 200);
  const average = async () => (await f.call('/erp/suppliers', undefined, 'Pervaiz')).data.suppliers.find(x => x.id === s).rating;
  assert.equal((await average()).average, 3);
  const voidBody = { id: uuid(), ratingId: bad, reason: 'Typed the wrong supplier' };
  assert.equal((await f.call('/erp/suppliers/ratings/void', voidBody, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/suppliers/ratings/void', voidBody, 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/suppliers/ratings/void', { ...voidBody, id: uuid() }, 'Pervaiz')).status, 409);
  assert.deepEqual({ average: (await average()).average, count: (await average()).count }, { average: 5, count: 1 });
  const detail = (await f.call(`/erp/suppliers/${s}`, undefined, 'Pervaiz')).data;
  assert.equal(detail.performance.manualAverage, 5);
  assert.equal(detail.ratings.find(r => r.id === bad).void_reason, 'Typed the wrong supplier');
  assert.equal(detail.ratings.find(r => r.id === good).void_reason, null);
});

test('a rejected supplier goes back to pending only through an admin, with a reason', async () => {
  const f = await fixture(), s = await f.insertSupplier({ status: 'pending' });
  assert.equal((await f.call('/erp/suppliers/review', { id: s, status: 'rejected', reason: 'Failed the sample check', version: 1 }, 'Pervaiz')).status, 200);
  const back = { id: s, status: 'pending', reason: 'Sample re-tested and passed', version: 2 };
  assert.equal((await f.call('/erp/suppliers/review', back, 'Pervaiz')).status, 403);
  assert.equal((await f.call('/erp/suppliers/review', { ...back, reason: 'no' }, 'Anas')).status, 422);
  assert.equal((await f.call('/erp/suppliers/review', back, 'Anas')).status, 200);
  assert.equal(f.sql.prepare('SELECT status FROM suppliers WHERE id=?').get(s).status, 'pending');
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM erp_reversals WHERE action='supplier.reopened' AND object_id=?", s), 1);
});
