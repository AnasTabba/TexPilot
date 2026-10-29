import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { purchasingScheduled, staffProcurement, supplierOperations } from '../server/procurement.mjs';

const fixture = async () => {
  const f = await portalFixture();
  await f.person('Pervaiz', 'purchase_manager'); await f.person('Inspector', 'quality_inspector'); await f.person('Saima', 'supervisor');
  f.supplier = await f.insertSupplier({ status: 'approved' });
  for (const name of ['Pervaiz', 'Inspector', 'Saima', 'Anas', 'Fahad', 'Zuhair']) await f.login(name);
  return f;
};
const day = 86400000;
const rfqBody = (extra = {}) => ({ id: crypto.randomUUID(), title: 'Cotton combed 30/1', categoryId: 'cotton', specifications: 'Ring-spun 30/1, weaving grade', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'FAZ textile factory', deadlineAt: Date.now() + day, requestedDeliveryAt: Date.now() + 7 * day, ...extra });
async function published(f, extra) {
  const body = rfqBody(extra), made = await f.call('/erp/rfqs', body, 'Pervaiz');
  assert.equal(made.status, 201, made.text);
  assert.equal((await f.call('/erp/rfqs/publish', { id: body.id }, 'Pervaiz')).status, 200);
  return body.id;
}
// An approved cotton supplier, a published 100 kg RFQ and one bid at PKR 1,250/kg: the PO total is PKR 125,000.
async function setup(f, priceMinor = 125000) {
  const rfqId = await published(f), bidId = f.insertBid({ rfqId, supplierId: f.supplier, priceMinor });
  return { rfqId, bidId };
}
// A second supplier that received the RFQ and bid on it.
async function rival(f, rfqId, priceMinor) {
  const supplierId = await f.insertSupplier({ status: 'approved' });
  f.sql.prepare("INSERT INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) VALUES(?,?,'{}',1)").run(rfqId, supplierId);
  return f.insertBid({ rfqId, supplierId, priceMinor });
}
const award = (f, bidId, version = 1, as = 'Pervaiz', extra = {}) => f.call('/erp/bids/award', { id: bidId, version, ...extra }, as);
const count = (f, table, where = '1=1', ...args) => f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=? ORDER BY created_at').all(action);
const notified = (f, event) => f.sql.prepare('SELECT u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event=? ORDER BY u.name').all(event).map(r => r.name);
const approval = (f, type) => f.sql.prepare('SELECT * FROM approval_requests WHERE type=? ORDER BY created_at DESC').get(type);
const decide = (f, id, decision = 'approve', as = 'Anas', reason) => f.call('/erp/approvals/decide', { id, decision, ...(reason ? { reason } : {}) }, as);
const rfqStatus = async (f, id) => (await f.call('/erp/procurement', undefined, 'Pervaiz')).data.rfqs.find(r => r.id === id).status;
const po = (f, rfqId) => f.sql.prepare('SELECT * FROM supplier_purchase_orders WHERE rfq_id=?').get(rfqId);

test('a bid below the purchase threshold creates the PO immediately', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f);
  f.setThreshold('purchase', 20000000);
  const r = await award(f, bidId);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.order.total_minor, 12500000); assert.equal(r.data.order.quantity_milli, 100000); assert.equal(r.data.order.approval_status, 'approved');
  assert.equal(r.data.order.version, 1); assert.equal(r.data.order.bill_of_lading, '');
  assert.equal(await rfqStatus(f, rfqId), 'awarded');
  const [row] = audits(f, 'po.created'); assert.equal(row.actor_role, 'purchase_manager'); assert.equal(row.record_id, r.data.order.id);
  assert.equal(count(f, 'approval_requests'), 0);
});
test('at or above the threshold the award waits for admin and no PO exists until approval', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f);
  f.setThreshold('purchase', 12500000);
  const r = await award(f, bidId);
  assert.equal(r.status, 202, r.text); assert.equal(r.data.pendingApproval, true);
  assert.equal(count(f, 'supplier_purchase_orders'), 0); assert.equal(await rfqStatus(f, rfqId), 'open');
  assert.deepEqual(notified(f, 'award.pending_approval'), ['Anas', 'Fahad', 'Zuhair']);
  const pending = approval(f, 'purchase_award');
  assert.equal(pending.id, r.data.approvalId); assert.equal(pending.object_type, 'rfq'); assert.equal(pending.object_id, rfqId);
  assert.equal(pending.amount, 12500000); assert.equal(pending.threshold, 12500000); assert.equal(pending.currency, 'PKR');
  assert.equal((await award(f, bidId)).status, 409, 'a second award waits behind the pending one');
  assert.equal((await decide(f, pending.id)).status, 200);
  const order = po(f, rfqId); assert.equal(order.total_minor, 12500000); assert.equal(order.approval_status, 'approved'); assert.equal(order.accepted_by, pending.requested_by);
  assert.equal(await rfqStatus(f, rfqId), 'awarded'); assert.equal(audits(f, 'po.created').length, 1);
  assert.deepEqual(notified(f, 'approval.decided'), ['Pervaiz']);
  assert.equal((await decide(f, pending.id)).status, 409); assert.equal(count(f, 'supplier_purchase_orders'), 1);
});
test('an admin rejection of an award needs a reason and leaves no PO', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), other = await rival(f, rfqId, 100000);
  f.setThreshold('purchase', 12500000);
  const { data } = await award(f, bidId);
  assert.equal((await decide(f, data.approvalId, 'reject')).status, 422);
  assert.equal((await decide(f, data.approvalId, 'reject', 'Anas', 'Choose the local supplier this month')).status, 200);
  assert.equal(count(f, 'supplier_purchase_orders'), 0); assert.equal(await rfqStatus(f, rfqId), 'open');
  assert.equal(approval(f, 'purchase_award').status, 'rejected');
  const again = await award(f, other); assert.equal(again.status, 201, again.text);
  assert.equal(po(f, rfqId).bid_id, other);
});
test('a PO quantity change at or above the threshold needs admin approval again', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f);
  f.setThreshold('purchase', 15000000);
  const order = (await award(f, bidId)).data.order, change = (quantityMilli, version) => f.call('/erp/orders/quantity', { id: order.id, version, quantityMilli }, 'Pervaiz');
  const asked = await change(150000, 1);
  assert.equal(asked.status, 202, asked.text); assert.equal(asked.data.pendingApproval, true);
  let row = po(f, rfqId); assert.equal(row.quantity_milli, 100000); assert.equal(row.total_minor, 12500000); assert.equal(row.approval_status, 'pending_admin');
  assert.equal((await change(120000, 1)).status, 409, 'no second change while one waits');
  const pending = approval(f, 'po_change'); assert.equal(pending.object_type, 'purchase_order'); assert.equal(pending.amount, 18750000);
  assert.deepEqual(JSON.parse(pending.payload_json), { quantityMilli: 150000, fromQuantityMilli: 100000, poVersion: 1, currency: 'PKR' });
  assert.equal((await decide(f, pending.id)).status, 200);
  row = po(f, rfqId); assert.deepEqual([row.quantity_milli, row.total_minor, row.approval_status, row.version], [150000, 18750000, 'approved', 2]);
  const small = await change(80000, 2); assert.equal(small.status, 200, small.text);
  row = po(f, rfqId); assert.deepEqual([row.quantity_milli, row.total_minor, row.version], [80000, 10000000, 3]); assert.equal(small.data.order.total_minor, 10000000);
  const [first, second] = audits(f, 'po.quantity_changed');
  assert.equal(audits(f, 'po.quantity_changed').length, 2); assert.deepEqual(JSON.parse(second.old_json), { quantity_milli: 150000, total_minor: 18750000 }); assert.deepEqual(JSON.parse(second.new_json), { quantity_milli: 80000, total_minor: 10000000 });
  assert.deepEqual(JSON.parse(first.new_json), { quantity_milli: 150000, total_minor: 18750000 });
  // a rejected change puts the PO back to approved with its quantity untouched
  const again = await change(150000, 3); assert.equal(again.status, 202);
  assert.equal((await decide(f, approval(f, 'po_change').id, 'reject', 'Anas', 'Hold the quantity at 80 kg')).status, 200);
  row = po(f, rfqId); assert.deepEqual([row.quantity_milli, row.approval_status, row.version], [80000, 'approved', 3]);
});
test('bidding moves draft → open → closed → awarded, and cancelling needs a reason', async () => {
  const f = await fixture(), body = rfqBody(), id = body.id;
  assert.equal((await f.call('/erp/rfqs', { ...body, deliveryLocation: undefined }, 'Pervaiz')).data.rfq.delivery_location, '');
  assert.equal(await rfqStatus(f, id), 'draft');
  assert.equal((await f.call('/erp/rfqs/close', { id }, 'Pervaiz')).status, 409, 'a draft cannot be closed');
  assert.equal((await f.call('/erp/rfqs/publish', { id }, 'Pervaiz')).status, 200); assert.equal(await rfqStatus(f, id), 'open');
  const bidId = f.insertBid({ rfqId: id, supplierId: f.supplier });
  assert.equal((await f.call('/erp/rfqs/close', { id }, 'Pervaiz')).status, 200); assert.equal(await rfqStatus(f, id), 'closed');
  assert.equal((await f.call('/erp/rfqs/close', { id }, 'Pervaiz')).status, 409);
  assert.equal(audits(f, 'rfq.opened').length, 1); assert.equal(audits(f, 'rfq.closed').length, 1); assert.deepEqual(notified(f, 'bidding.closed'), ['Pervaiz']);
  const won = await award(f, bidId); assert.equal(won.status, 201, 'a closed RFQ can still be awarded'); assert.equal(await rfqStatus(f, id), 'awarded');
  assert.equal((await f.call('/erp/rfqs/cancel', { id, reason: 'Requirement withdrawn' }, 'Pervaiz')).status, 409, 'an awarded RFQ cannot be cancelled');

  const second = await published(f), secondBid = f.insertBid({ rfqId: second, supplierId: f.supplier });
  assert.equal((await f.call('/erp/rfqs/cancel', { id: second }, 'Pervaiz')).status, 422);
  assert.equal(await rfqStatus(f, second), 'open');
  assert.equal((await f.call('/erp/rfqs/cancel', { id: second, reason: 'Requirement withdrawn' }, 'Pervaiz')).status, 200);
  assert.equal(await rfqStatus(f, second), 'cancelled');
  assert.equal(f.sql.prepare('SELECT status,cancel_reason FROM procurement_rfqs WHERE id=?').get(second).status, 'closed');
  assert.equal((await award(f, secondBid)).status, 409); assert.equal(po(f, second), undefined);
  assert.equal((await f.call('/erp/rfqs/cancel', { id: second, reason: 'Requirement withdrawn' }, 'Pervaiz')).status, 409);
  assert.equal(audits(f, 'rfq.cancelled')[0].reason, 'Requirement withdrawn');
  const overdue = await published(f); f.sql.prepare('UPDATE procurement_rfqs SET deadline_at=? WHERE id=?').run(Date.now() - 1000, overdue);
  assert.equal(await rfqStatus(f, overdue), 'closed', 'an open row past its deadline is reported closed');
});
test('a bid rejection needs a reason and is audited', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f);
  assert.equal((await f.call('/erp/bids/reject', { id: bidId, version: 1 }, 'Pervaiz')).status, 422);
  assert.equal((await f.call('/erp/bids/reject', { id: bidId, version: 1, reason: 'Delivery too late' }, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/bids/reject', { id: bidId, version: 2, reason: 'Delivery too late' }, 'Pervaiz')).status, 409);
  assert.equal(audits(f, 'bid.rejected').length, 0);
  assert.equal((await f.call('/erp/bids/reject', { id: bidId, version: 1, reason: 'Delivery too late' }, 'Pervaiz')).status, 200);
  const [row] = audits(f, 'bid.rejected'); assert.equal(row.reason, 'Delivery too late'); assert.equal(row.actor_role, 'purchase_manager'); assert.equal(row.intervention_reason, null);
  // bidding closed still allows rejection; a bid on an awarded RFQ cannot be rejected
  const closed = await published(f), closedBid = f.insertBid({ rfqId: closed, supplierId: f.supplier });
  await f.call('/erp/rfqs/close', { id: closed }, 'Pervaiz');
  assert.equal((await f.call('/erp/bids/reject', { id: closedBid, version: 1, reason: 'Rate too high' }, 'Pervaiz')).status, 200);
  const adminRejected = await published(f), adminBid = f.insertBid({ rfqId: adminRejected, supplierId: f.supplier });
  assert.equal((await f.call('/erp/bids/reject', { id: adminBid, version: 1, reason: 'Rate too high' }, 'Anas')).status, 422);
  assert.equal((await f.call('/erp/bids/reject', { id: adminBid, version: 1, reason: 'Rate too high', interventionReason: 'Purchase manager is away' }, 'Anas')).status, 200);
  assert.equal(audits(f, 'bid.rejected')[2].intervention_reason, 'Purchase manager is away');
  assert.equal((await award(f, bidId)).status, 409, 'a rejected bid cannot be awarded');
  const live = await rival(f, rfqId); assert.equal((await award(f, live)).status, 201);
  const late = f.insertBid({ rfqId: await published(f), supplierId: f.supplier });
  f.sql.prepare("UPDATE procurement_rfqs SET status='awarded' WHERE id=(SELECT rfq_id FROM supplier_bids WHERE id=?)").run(late);
  assert.equal((await f.call('/erp/bids/reject', { id: late, version: 1, reason: 'Too late for this one' }, 'Pervaiz')).status, 409);
  assert.equal(audits(f, 'bid.rejected').length, 3);
});
test('two concurrent bid rejections leave one decision and one audit row', async () => {
  const f = await fixture(), { bidId } = await setup(f);
  const results = await Promise.all([1, 2].map(n => f.call('/erp/bids/reject', { id: bidId, version: 1, reason: 'Delivery too late ' + n }, 'Pervaiz')));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(audits(f, 'bid.rejected').length, 1);
});
test('the deadline ends bidding and notifies the purchase manager once', async () => {
  const f = await fixture(), id = await published(f), deadline = f.sql.prepare('SELECT deadline_at FROM procurement_rfqs WHERE id=?').get(id).deadline_at;
  assert.deepEqual(await purchasingScheduled(f.env, deadline - 1), { closed: 0 });
  assert.deepEqual(await purchasingScheduled(f.env, deadline + 1), { closed: 1 });
  assert.equal(f.sql.prepare('SELECT status FROM procurement_rfqs WHERE id=?').get(id).status, 'closed');
  assert.deepEqual(notified(f, 'bidding.closed'), ['Pervaiz']);
  assert.deepEqual(await purchasingScheduled(f.env, deadline + 2), { closed: 0 });
  assert.deepEqual(notified(f, 'bidding.closed'), ['Pervaiz']); assert.equal(audits(f, 'rfq.closed').length, 1);
  assert.equal(audits(f, 'rfq.closed')[0].created_by, 'system:purchasing');
  const second = await published(f), secondDeadline = f.sql.prepare('SELECT deadline_at FROM procurement_rfqs WHERE id=?').get(second).deadline_at;
  const runs = await Promise.all([purchasingScheduled(f.env, secondDeadline + 1), purchasingScheduled(f.env, secondDeadline + 1)]);
  assert.equal(runs[0].closed + runs[1].closed, 1); assert.equal(notified(f, 'bidding.closed').length, 2);
  const third = await published(f), thirdDeadline = f.sql.prepare('SELECT deadline_at FROM procurement_rfqs WHERE id=?').get(third).deadline_at;
  const [manual, scheduled] = await Promise.all([f.call('/erp/rfqs/close', { id: third }, 'Pervaiz'), purchasingScheduled(f.env, thirdDeadline + 1)]);
  assert.equal((manual.status === 200 ? 1 : 0) + scheduled.closed, 1); assert.equal(notified(f, 'bidding.closed').length, 3);
  const cancelled = await published(f); await f.call('/erp/rfqs/cancel', { id: cancelled, reason: 'Requirement withdrawn' }, 'Pervaiz');
  assert.deepEqual(await purchasingScheduled(f.env, Date.now() + 10 * day), { closed: 0 });
});
test('the RFQ goes only to approved suppliers in its category', async () => {
  const f = await fixture(); await f.insertSupplier({ status: 'pending' }); await f.insertSupplier({ status: 'approved', categories: ['synthetic'] });
  const body = rfqBody(); await f.call('/erp/rfqs', body, 'Pervaiz');
  const r = await f.call('/erp/rfqs/publish', { id: body.id }, 'Pervaiz');
  assert.equal(r.status, 200); assert.equal(r.data.recipients, 1);
  assert.deepEqual(f.sql.prepare('SELECT supplier_id FROM rfq_recipients WHERE rfq_id=?').all(body.id).map(x => x.supplier_id), [f.supplier]);
  const lonely = rfqBody({ categoryId: 'processed' }); await f.call('/erp/rfqs', lonely, 'Pervaiz');
  assert.equal((await f.call('/erp/rfqs/publish', { id: lonely.id }, 'Pervaiz')).status, 409);
});
test('only purchase managers run purchasing; an admin needs an intervention reason', async () => {
  const f = await fixture(), body = rfqBody();
  assert.equal((await f.call('/erp/rfqs', body, 'Inspector')).status, 403);
  assert.equal((await f.call('/erp/procurement', undefined, 'Inspector')).status, 403);
  assert.equal((await f.call('/erp/rfqs', body, 'Anas')).status, 422); assert.equal(count(f, 'procurement_rfqs'), 0);
  const made = await f.call('/erp/rfqs', { ...body, interventionReason: 'Purchase manager is away' }, 'Anas');
  assert.equal(made.status, 201, made.text); assert.equal(audits(f, 'rfq.created')[0].intervention_reason, 'Purchase manager is away');
  for (const [path, payload] of [['/erp/rfqs/publish', { id: body.id }], ['/erp/rfqs/close', { id: body.id }], ['/erp/rfqs/cancel', { id: body.id, reason: 'Requirement withdrawn' }],
    ['/erp/bids/reject', { id: body.id, version: 1, reason: 'Rate too high' }], ['/erp/bids/award', { id: body.id, version: 1 }], ['/erp/orders/quantity', { id: body.id, version: 1, quantityMilli: 1000 }]]) {
    assert.equal((await f.call(path, payload, 'Saima')).status, 403, path + ' for a supervisor');
    assert.equal((await f.call(path, payload, 'Anas')).status, 422, path + ' for an admin without a reason');
  }
  const view = await f.call('/erp/procurement', undefined, 'Anas'); assert.equal(view.status, 200); assert.equal(view.data.currency, 'PKR');
});
test('pending awards reject expired or changed bid terms atomically', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f); f.setThreshold('purchase', 12500000);
  const { data } = await award(f, bidId), future = f.sql.prepare('SELECT valid_until FROM supplier_bids WHERE id=?').get(bidId).valid_until;
  f.sql.prepare('UPDATE supplier_bids SET valid_until=? WHERE id=?').run(Date.now() - 1000, bidId);
  const before = count(f, 'erp_audit_events'), notes = count(f, 'notifications');
  const expired = await decide(f, data.approvalId); assert.equal(expired.status, 409);
  assert.equal(approval(f, 'purchase_award').status, 'pending'); assert.equal(count(f, 'supplier_purchase_orders'), 0);
  assert.equal(count(f, 'erp_audit_events'), before); assert.equal(count(f, 'notifications'), notes);
  f.sql.prepare('UPDATE supplier_bids SET valid_until=? WHERE id=?').run(future, bidId);
  f.sql.prepare('UPDATE supplier_bids SET price_minor=130000 WHERE id=?').run(bidId);
  assert.equal((await decide(f, data.approvalId)).status, 409, 'changed terms');
  f.sql.prepare('UPDATE supplier_bids SET price_minor=125000 WHERE id=?').run(bidId);
  assert.equal((await decide(f, data.approvalId)).status, 200); assert.equal(count(f, 'supplier_purchase_orders'), 1);
  assert.equal(await rfqStatus(f, rfqId), 'awarded'); assert.equal((await decide(f, data.approvalId)).status, 409); assert.equal(count(f, 'supplier_purchase_orders'), 1);

  const second = await published(f), bump = f.insertBid({ rfqId: second, supplierId: f.supplier }), asked = (await award(f, bump)).data;
  f.sql.prepare('UPDATE supplier_bids SET version=2 WHERE id=?').run(bump);
  assert.equal((await decide(f, asked.approvalId)).status, 409); assert.equal(count(f, 'supplier_purchase_orders'), 1);
  assert.equal(approval(f, 'purchase_award').status, 'pending');
  // a cancelled RFQ or a suspended supplier is stale too
  const third = await published(f), cancelled = f.insertBid({ rfqId: third, supplierId: f.supplier }), pending = (await award(f, cancelled)).data;
  await f.call('/erp/rfqs/cancel', { id: third, reason: 'Requirement withdrawn' }, 'Pervaiz');
  assert.equal((await decide(f, pending.approvalId)).status, 409); assert.equal(count(f, 'supplier_purchase_orders'), 1);
});
test('two admins deciding one award create exactly one PO and one audit row', async () => {
  const f = await fixture(), { bidId } = await setup(f); f.setThreshold('purchase', 12500000);
  const { data } = await award(f, bidId);
  const results = await Promise.all([decide(f, data.approvalId, 'approve', 'Anas'), decide(f, data.approvalId, 'approve', 'Fahad')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(count(f, 'supplier_purchase_orders'), 1); assert.equal(audits(f, 'po.created').length, 1); assert.equal(audits(f, 'approval.approved').length, 1);
});
test('competing immediate awards yield one PO and one audit row', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), other = await rival(f, rfqId);
  const results = await Promise.all([award(f, bidId), award(f, other)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(count(f, 'supplier_purchase_orders'), 1); assert.equal(audits(f, 'po.created').length, 1);
});
test('two concurrent PO quantity changes land once', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), order = (await award(f, bidId)).data.order;
  const change = quantityMilli => f.call('/erp/orders/quantity', { id: order.id, version: 1, quantityMilli }, 'Pervaiz');
  const results = await Promise.all([change(90000), change(95000)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(po(f, rfqId).version, 2); assert.equal(audits(f, 'po.quantity_changed').length, 1);
  assert.equal((await change(70000)).status, 409, 'a stale version is refused');
  assert.equal((await f.call('/erp/orders/quantity', { id: order.id, version: 2, quantityMilli: 90000 }, 'Pervaiz')).status, 422, 'the same quantity is not a change');
  f.setThreshold('purchase', 1000000);
  const gate = await Promise.all([1, 2].map(() => f.call('/erp/orders/quantity', { id: order.id, version: 2, quantityMilli: 99000 }, 'Pervaiz')));
  assert.deepEqual(gate.map(r => r.status).sort(), [202, 409]); assert.equal(count(f, 'approval_requests', "type='po_change'"), 1);
});
test('PO quantity never falls below arrived quantity', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), order = (await award(f, bidId)).data.order;
  const change = (quantityMilli, version) => f.call('/erp/orders/quantity', { id: order.id, version, quantityMilli }, 'Pervaiz');
  const arrive = async quantityMilli => {
    const product = (await f.call('/products', { sku: 'COT-' + quantityMilli, name: 'Cotton ' + quantityMilli }, 'Anas')).data;
    const receipt = await f.call('/erp/receipts', { id: crypto.randomUUID(), orderId: order.id, productId: product.id, batch: 'RCV-' + quantityMilli, quantityMilli, cartons: 0, cones: 0, supplierLot: '' }, 'Anas');
    assert.equal(receipt.status, 201, receipt.text);
  };
  // a reduction raised before the goods arrive is refused when the admin approves it after they did
  f.setThreshold('purchase', 1);
  assert.equal((await change(50000, 1)).status, 202);
  await arrive(60000);
  const raised = approval(f, 'po_change');
  assert.equal((await decide(f, raised.id)).status, 409);
  assert.equal(approval(f, 'po_change').status, 'pending'); assert.deepEqual([po(f, rfqId).quantity_milli, po(f, rfqId).approval_status], [100000, 'pending_admin']);
  assert.equal(audits(f, 'po.quantity_changed').length, 0);
  assert.equal((await decide(f, raised.id, 'reject', 'Anas', 'Goods already arrived against this order')).status, 200);
  f.setThreshold('purchase', 10 ** 12);
  assert.equal((await change(50000, 1)).status, 409); assert.equal(po(f, rfqId).quantity_milli, 100000);
  assert.equal((await change(60000, 1)).status, 200); assert.equal(po(f, rfqId).quantity_milli, 60000);
});
test('purchase managers read only their workspace pending awards', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f); f.setThreshold('purchase', 12500000);
  const asked = (await award(f, bidId)).data;
  const pending = '/erp/orders/pending-approvals';
  for (const as of ['Pervaiz', 'Anas']) {
    const r = await f.call(pending, undefined, as); assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.data.awards.map(a => ({ ...a })), [{ approvalId: asked.approvalId, rfqId, bidId, bidVersion: 1, amount: 12500000, currency: 'PKR', threshold: 12500000, status: 'pending', created_at: r.data.awards[0].created_at }]);
    assert.deepEqual(r.data.changes, []);
  }
  assert.equal((await f.call(pending, undefined, 'Saima')).status, 403); assert.equal((await f.call(pending, undefined, 'Inspector')).status, 403);
  const foreign = await staffProcurement(new Request('https://yarnflow.test/api' + pending), f.env, { ...await f.member('Pervaiz'), workspace_id: 'other-factory' }, '/api' + pending, null);
  assert.deepEqual(await foreign.json(), { awards: [], changes: [] });
  await decide(f, asked.approvalId);
  const placed = (await f.call('/erp/procurement', undefined, 'Pervaiz')).data.orders[0];
  const change = await f.call('/erp/orders/quantity', { id: placed.id, version: 1, quantityMilli: 150000 }, 'Pervaiz'); assert.equal(change.status, 202);
  const r = await f.call(pending, undefined, 'Pervaiz');
  assert.deepEqual(r.data.awards, []); assert.deepEqual(r.data.changes.map(c => ({ ...c })), [{ approvalId: change.data.approvalId, orderId: placed.id, quantityMilli: 150000, fromQuantityMilli: 100000, amount: 18750000, currency: 'PKR', threshold: 12500000, status: 'pending', created_at: r.data.changes[0].created_at }]);
});
test('approval details describe the pinned bid and the PO change', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f); f.setThreshold('purchase', 12500000);
  const asked = (await award(f, bidId)).data, detail = await f.call('/erp/approvals/' + asked.approvalId, undefined, 'Anas');
  assert.equal(detail.status, 200, detail.text); assert.equal(detail.data.object.objectType, 'rfq'); assert.equal(detail.data.object.objectId, rfqId); assert.equal(detail.data.object.currency, 'PKR');
  assert.equal(detail.data.object.evidence.bid.price_minor, 125000); assert.equal(detail.data.object.evidence.supplier.id, f.supplier); assert.equal(detail.data.object.proposed.bidVersion, 1);
  await decide(f, asked.approvalId);
  const order = po(f, rfqId), change = (await f.call('/erp/orders/quantity', { id: order.id, version: 1, quantityMilli: 150000 }, 'Pervaiz')).data;
  const changeDetail = await f.call('/erp/approvals/' + change.approvalId, undefined, 'Anas');
  assert.equal(changeDetail.status, 200, changeDetail.text); assert.equal(changeDetail.data.object.objectType, 'purchase_order');
  assert.deepEqual([changeDetail.data.object.proposed.quantityMilli, changeDetail.data.object.proposed.fromQuantityMilli, changeDetail.data.object.proposed.totalMinor], [150000, 100000, 18750000]);
  assert.equal(changeDetail.data.object.evidence.arrivedQuantityMilli, 0);
});
test('a cancelled RFQ or a pending PO change no longer counts as an open bid for currency changes', async () => {
  const f = await fixture(), { rfqId } = await setup(f), usd = () => f.sql.prepare("INSERT INTO settings(workspace_id,key,value_json,created_by,created_at,updated_by,updated_at) VALUES(?,'currency','\"USD\"',?,1,?,1) ON CONFLICT(workspace_id,key) DO UPDATE SET value_json=excluded.value_json").run(f.workspaceId, f.adminId, f.adminId);
  const pkr = () => f.sql.prepare("UPDATE settings SET value_json='\"PKR\"' WHERE key='currency'").run();
  assert.throws(usd, /Close open bids/);
  await f.call('/erp/rfqs/cancel', { id: rfqId, reason: 'Requirement withdrawn' }, 'Pervaiz');
  usd(); pkr();
  const next = await published(f), bidId = f.insertBid({ rfqId: next, supplierId: f.supplier }); f.setThreshold('purchase', 15000000);
  const order = (await award(f, bidId)).data.order; usd(); pkr();
  assert.equal((await f.call('/erp/orders/quantity', { id: order.id, version: 1, quantityMilli: 150000 }, 'Pervaiz')).status, 202);
  assert.throws(usd, /Close open bids/);
});
test('the new purchasing entities carry the required metadata', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), order = (await award(f, bidId)).data.order;
  const rfq = f.sql.prepare('SELECT status,created_by,created_at,updated_at FROM procurement_rfqs WHERE id=?').get(rfqId);
  assert.ok(rfq.created_by && rfq.created_at && rfq.updated_at);
  assert.ok(order.created_by && order.updated_at && order.status);
  const bid = f.sql.prepare('SELECT created_by FROM supplier_bids WHERE id=?').get(bidId); assert.ok(bid.created_by);
  for (const column of ['status', 'created_by', 'updated_at']) assert.ok(f.sql.prepare('PRAGMA table_info(supplier_bid_history)').all().some(c => c.name === column), column);
});
test('a purchase order cannot be created from a stale bid, an unapproved supplier or a cancelled RFQ', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), insert = () => f.sql.prepare("INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at) VALUES(?,?,?,?,?,'PO-X','{}','accepted',?,1)")
    .run(crypto.randomUUID(), f.workspaceId, rfqId, bidId, f.supplier, f.adminId);
  f.sql.prepare("UPDATE suppliers SET status='suspended' WHERE id=?").run(f.supplier); assert.throws(insert, /bid or supplier no longer valid/);
  f.sql.prepare("UPDATE suppliers SET status='approved' WHERE id=?").run(f.supplier);
  f.sql.prepare('UPDATE procurement_rfqs SET cancelled_at=1 WHERE id=?').run(rfqId); assert.throws(insert, /bid or supplier no longer valid/);
  f.sql.prepare('UPDATE procurement_rfqs SET cancelled_at=NULL WHERE id=?').run(rfqId);
  f.sql.prepare("UPDATE supplier_bids SET status='rejected',rejection_reason='x' WHERE id=?").run(bidId); assert.throws(insert, /bid or supplier no longer valid/);
});

const dispatch = (f, orderId, quantityMilli) => supplierOperations(null, f.env,
  { supplier_id: f.supplier, workspace_id: f.workspaceId, user_id: 'supplier:test', status: 'approved' }, '/api/portal/dispatches',
  { id: crypto.randomUUID(), orderId, quantityMilli, billOfLading: 'BOL-TEST', carrier: 'Test carrier', containers: [], dispatchedAt: Date.now(), note: '' });
test('supplier dispatch uses the approved increased PO quantity', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f);
  f.setThreshold('purchase', 15000000);
  const order = (await award(f, bidId)).data.order;
  const change = await f.call('/erp/orders/quantity', { id: order.id, version: 1, quantityMilli: 150000 }, 'Pervaiz');
  assert.equal(change.status, 202);
  assert.equal((await decide(f, change.data.approvalId)).status, 200);
  assert.equal((await dispatch(f, order.id, 100000)).status, 201);
  assert.equal((await dispatch(f, order.id, 50000)).status, 201);
  await assert.rejects(dispatch(f, order.id, 1));
  assert.equal(count(f, 'procurement_shipments'), 2); assert.equal(audits(f, 'shipment.dispatched').length, 2);
  assert.equal(po(f, rfqId).quantity_milli, 150000);
});
test('a dispatch that loses a race to a PO decrease aborts all its effects', async () => {
  const f = await fixture(), { rfqId, bidId } = await setup(f), order = (await award(f, bidId)).data.order;
  const batch = f.env.DB.batch;
  f.env.DB.batch = async statements => {
    f.env.DB.batch = batch;
    const changed = await f.call('/erp/orders/quantity', { id: order.id, version: 1, quantityMilli: 80000 }, 'Pervaiz');
    assert.equal(changed.status, 200);
    return batch(statements);
  };
  await assert.rejects(dispatch(f, order.id, 90000));
  assert.equal(count(f, 'procurement_shipments'), 0); assert.equal(audits(f, 'shipment.dispatched').length, 0);
  assert.equal(po(f, rfqId).status, 'accepted'); assert.equal(po(f, rfqId).quantity_milli, 80000);
  assert.equal((await dispatch(f, order.id, 80000)).status, 201);
});
test('scheduled close surfaces transaction errors and rolls back all effects', async () => {
  const f = await fixture(), id = await published(f);
  f.sql.exec("CREATE TRIGGER fail_close_audit BEFORE INSERT ON erp_audit_events WHEN NEW.action='rfq.closed' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  await assert.rejects(purchasingScheduled(f.env, Date.now() + 2 * day), /audit unavailable/);
  assert.equal(f.sql.prepare('SELECT status FROM procurement_rfqs WHERE id=?').get(id).status, 'open');
  assert.equal(audits(f, 'rfq.closed').length, 0); assert.deepEqual(notified(f, 'bidding.closed'), []);
});
test('threshold fixture uses configured currency on insert and replacement', async () => {
  const f = await fixture();
  f.setThreshold('purchase', 100);
  assert.equal((await f.call('/erp/admin/settings', { key: 'currency', value: 'USD' })).status, 200);
  for (const type of ['purchase', 'claim']) {
    f.setThreshold(type, 200);
    const row = f.sql.prepare('SELECT value,currency FROM thresholds WHERE workspace_id=? AND type=?').get(f.workspaceId, type);
    assert.equal(row.value, 200); assert.equal(row.currency, 'USD');
  }
});

test('purchasing category reads require a purchase manager or admin', async () => {
  const f = await fixture();
  for (const name of ['Pervaiz', 'Anas']) {
    const response = await f.call('/erp/categories', undefined, name);
    assert.equal(response.status, 200); assert.ok(response.data.categories.some(c => c.id === 'cotton'));
  }
  assert.equal((await f.call('/erp/categories', undefined, 'Inspector')).status, 403);
});
