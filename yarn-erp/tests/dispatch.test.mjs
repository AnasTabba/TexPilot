import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';

const uuid = () => crypto.randomUUID();
async function setup() {
  const f = await portalFixture();
  for (const [name, role] of [['Sana', 'sales_manager'], ['Danish', 'dispatch'], ['Saima', 'supervisor']]) await f.person(name, role);
  const q = await f.acceptedQuote();
  const sale = await f.call('/erp/sales/sales', { id: uuid(), revisionId: q.revisionId }, 'Sana');
  assert.equal(sale.status, 201, sale.text);
  const lotId = await f.addFinished({ grams: 10000 });
  const orderId = sale.data.order.id;
  const request = async (extra = {}, qty = 5000) => f.call('/erp/dispatch', {
    id: uuid(), orderId, lotId, quantityMilli: qty, grams: qty, cartons: 0, cones: 0, ...extra,
  }, 'Danish');
  return { f, sale: sale.data, lotId, request };
}
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const count = (f, table) => one(f, `SELECT COUNT(*) AS n FROM ${table}`).n;
const balance = (f, lotId) => one(f, "SELECT grams FROM balances WHERE lot_id=? AND stage='finished'", lotId)?.grams ?? 0;

 test('dispatch requests need sales approval and deduct only at dispatch', async () => {
  const { f, sale, lotId, request } = await setup();
  const requestId = uuid(), created = await request({ id: requestId });
  assert.equal(created.status, 201, created.text);
  assert.equal((await request({ id: requestId })).status, 200, 'retry returns the same request');
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM dispatch_requests WHERE dispatch_id=? AND kind='approval'", created.data.dispatch.id).n, 1);
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM notifications WHERE event='dispatch.approval_requested' AND object_id=?", created.data.dispatch.id).n, 1);
  const dispatch = created.data.dispatch;
  assert.equal(dispatch.status, 'pending_approval');
  assert.equal(balance(f, lotId), 10000);
  const denied = await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'approve' }, 'Danish');
  assert.equal(denied.status, 403);
  const approved = await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'approve' }, 'Sana');
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.data.dispatch.status, 'approved');
  assert.equal(balance(f, lotId), 10000);
  const sent = await f.call('/erp/dispatch/dispatched', { dispatchId: dispatch.id }, 'Danish');
  assert.equal(sent.status, 201, sent.text);
  assert.equal(sent.data.dispatch.status, 'dispatched');
  assert.equal(balance(f, lotId), 5000);
  assert.equal(one(f, 'SELECT status FROM sales_orders WHERE id=?', sale.order.id).status, 'partially_dispatched');
  assert.equal(count(f, 'sales_dispatches'), 1);
  assert.equal((await f.call('/movements', { id: uuid(), action: 'dispatch' }, 'Danish')).status, 404);
});

test('holds require reasons, terms and sales-manager notices; held requests can be resubmitted', async () => {
  const { f, lotId, request } = await setup();
  const created = await request();
  let decided = await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'hold', term: 'other', reason: 'no' }, 'Sana');
  assert.equal(decided.status, 422);
  decided = await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'hold', term: 'weather', reason: 'Weather exception for buyer' }, 'Sana');
  assert.equal(decided.status, 422);
  decided = await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'hold', term: 'payment_overdue', reason: 'Invoice is overdue' }, 'Sana');
  assert.equal(decided.status, 200, decided.text);
  assert.equal(decided.data.dispatch.status, 'on_hold');
  assert.equal(balance(f, lotId), 10000);
  const again = await f.call('/erp/dispatch/request', { dispatchId: created.data.dispatch.id }, 'Danish');
  assert.equal(again.status, 200, again.text);
  assert.equal(again.data.dispatch.status, 'pending_approval');
});

test('approved dispatch holds need a sales-manager notice before dispatch can acknowledge it', async () => {
  const { f, request } = await setup();
  const created = await request();
  await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'approve' }, 'Sana');
  const noNotice = await f.call('/erp/dispatch/hold', { dispatchId: created.data.dispatch.id, reason: 'Terms are not met' }, 'Danish');
  assert.equal(noNotice.status, 409);
  const notice = await f.call('/erp/dispatch/hold-notices', { dispatchId: created.data.dispatch.id, term: 'terms_not_met', message: 'Buyer has not signed the revised terms' }, 'Sana');
  assert.equal(notice.status, 201, notice.text);
  const held = await f.call('/erp/dispatch/hold', { dispatchId: created.data.dispatch.id, noticeId: notice.data.noticeId, reason: 'Acknowledging the sales manager message' }, 'Danish');
  assert.equal(held.status, 200, held.text);
  assert.equal(held.data.dispatch.status, 'on_hold');
  assert.equal(one(f, "SELECT status FROM dispatch_requests WHERE id=?", notice.data.noticeId).status, 'acknowledged');
});

test('short stock and unapproved requests never deduct stock; delivery metadata is optional', async () => {
  const { f, lotId, request } = await setup();
  const created = await request({}, 11000);
  assert.equal(created.status, 201, created.text);
  await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'approve' }, 'Sana');
  const sent = await f.call('/erp/dispatch/dispatched', { dispatchId: created.data.dispatch.id }, 'Danish');
  assert.equal(sent.status, 409);
  assert.equal(sent.data.error, 'Stock is short or does not match. Raise a stock issue to the supervisor.');
  assert.equal(one(f, 'SELECT status FROM dispatches WHERE id=?', created.data.dispatch.id).status, 'approved');
  assert.equal(balance(f, lotId), 10000);
  const delivery = await request({}, 1000);
  await f.call('/erp/dispatch/requests/decide', { requestId: delivery.data.requestId, decision: 'approve' }, 'Sana');
  const dispatched = await f.call('/erp/dispatch/dispatched', { dispatchId: delivery.data.dispatch.id }, 'Danish');
  assert.equal(dispatched.status, 201, dispatched.text);
  const proof = await f.call('/erp/dispatch/delivered', { dispatchId: delivery.data.dispatch.id, deliveryProof: 'Signed DC 4411' }, 'Danish');
  assert.equal(proof.data.dispatch.status, 'delivered');
  assert.equal(proof.data.dispatch.delivery_proof, 'Signed DC 4411');
});

test('stock issues snapshot both gates and apply one adjustment only after one admin approval', async () => {
  const { f, lotId } = await setup();
  f.setThreshold('dispatch_stock_issue', 1000);
  f.setThreshold('inventory_adjustment', 1000);
  const issue = await f.call('/erp/dispatch/stock-issues', { id: uuid(), lotId, stage: 'finished', kind: 'shortage', differenceGrams: 2000, description: 'Recount found less yarn than ledger' }, 'Danish');
  assert.equal(issue.status, 201, issue.text);
  const decision = await f.call('/erp/dispatch/stock-issues/decide', { id: issue.data.issue.id, decision: 'accept', correctionGrams: -2000, reason: 'Verified shortage after recount' }, 'Saima');
  assert.equal(decision.status, 202, decision.text);
  assert.equal(balance(f, lotId), 10000);
  const approval = one(f, "SELECT * FROM approval_requests WHERE type='dispatch_stock_issue'");
  const payload = JSON.parse(approval.payload_json);
  assert.deepEqual(payload.gates, { dispatch: { amount: 2000, threshold: 1000, required: true }, inventory: { amount: 2000, threshold: 1000, required: true } });
  const a = await Promise.all([
    f.call('/erp/approvals/decide', { id: approval.id, decision: 'approve' }, 'Anas'),
    f.call('/erp/approvals/decide', { id: approval.id, decision: 'approve' }, 'Fahad'),
  ]);
  assert.deepEqual(a.map(x => x.status).sort(), [200, 409]);
  assert.equal(balance(f, lotId), 8000);
  assert.equal(count(f, 'inventory_adjustments'), 1);
  assert.equal(one(f, 'SELECT status FROM stock_issues WHERE id=?', issue.data.issue.id).status, 'accepted');
  assert.equal(one(f, "SELECT source,status FROM inventory_adjustments WHERE source='stock_issue'").status, 'applied');
});

test('threshold boundaries gate exactly, reason is required, and only supervisor/admin can see the scoped issue queue', async () => {
  const { f, lotId } = await setup();
  f.setThreshold('dispatch_stock_issue', 1000);
  const issue = await f.call('/erp/dispatch/stock-issues', { id: uuid(), lotId, stage: 'finished', kind: 'mismatch', differenceGrams: 1000, description: 'Scale and log do not match' }, 'Danish');
  assert.equal(issue.status, 201);
  assert.equal((await f.call('/erp/dispatch/stock-issues/decide', { id: issue.data.issue.id, decision: 'accept' }, 'Saima')).status, 422);
  const pending = await f.call('/erp/dispatch/stock-issues/decide', { id: issue.data.issue.id, decision: 'accept', correctionGrams: -2000, reason: 'Verified mismatch after recount' }, 'Saima');
  assert.equal(pending.status, 202);
  assert.equal((await f.call('/erp/dispatch/stock-issues', undefined, 'Saima')).status, 200);
  assert.equal((await f.call('/erp/dispatch/stock-issues', undefined, 'Danish')).status, 403);
  assert.equal((await f.call('/erp/dispatch/stock-issues', undefined, 'Anas')).status, 200);
  assert.equal((await f.call('/erp/dispatch', undefined, 'Sana')).status, 200);
});

test('raw and legacy stock cannot be sale-dispatched and failed requests leave no dispatch record', async () => {
  const { f, sale } = await setup();
  const context = await f.submitted({ acceptedMilli: 1000, lotQuantityMilli: 1000 });
  const accepted = await f.call('/erp/qc/reports/decide', { inspectionId: context.inspectionId, decision: 'accept' }, 'Saima');
  assert.equal(accepted.status, 200, accepted.text);
  const body = lotId => ({ id: uuid(), orderId: sale.order.id, lotId, quantityMilli: 1000, grams: 1000 });
  const raw = await f.call('/erp/dispatch', body(context.lotId), 'Danish');
  assert.equal(raw.status, 422);
  assert.equal(raw.data.error, 'Raw stock cannot be sale-dispatched; only finished goods are supported.');
  const legacyLot = uuid(), movementId = uuid(), deltaId = uuid(), now = Date.now(), productId = await f.insertProduct();
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,'','approved',?)")
    .run(legacyLot, f.workspaceId, productId, 'LEGACY-WIP', now);
  f.sql.prepare("INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,request_hash,created_at) VALUES(?,?,?,'receive',NULL,'wip',1000,0,0,'Legacy balance','Anas','Anas',?,?)")
    .run(movementId, f.workspaceId, legacyLot, movementId, now);
  f.sql.prepare("INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,'wip',1000,0,0)")
    .run(deltaId, movementId, legacyLot);
  const legacy = await f.call('/erp/dispatch', body(legacyLot), 'Danish');
  assert.equal(legacy.status, 422);
  assert.equal(legacy.data.error, 'Legacy cops/WIP stock is read-only; an authorized migration is required.');
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM dispatches').n, 0);
});

test('rejected stock issues need a reason; an issue-only gate works without a correction', async () => {
  const { f, lotId } = await setup();
  f.setThreshold('dispatch_stock_issue', 1000);
  const issue = async differenceGrams => f.call('/erp/dispatch/stock-issues', { id: uuid(), lotId, stage: 'finished', kind: 'shortage', differenceGrams, description: 'Count differs from the stock register' }, 'Danish');
  const gated = await issue(1000);
  const approvalWait = await f.call('/erp/dispatch/stock-issues/decide', { id: gated.data.issue.id, decision: 'accept', reason: 'Verified shortage without changing the ledger' }, 'Saima');
  assert.equal(approvalWait.status, 202);
  assert.equal(balance(f, lotId), 10000);
  const rejected = await issue(100);
  assert.equal((await f.call('/erp/dispatch/stock-issues/decide', { id: rejected.data.issue.id, decision: 'reject' }, 'Saima')).status, 422);
  const final = await f.call('/erp/dispatch/stock-issues/decide', { id: rejected.data.issue.id, decision: 'reject', reason: 'Recount found no discrepancy' }, 'Saima');
  assert.equal(final.status, 200, final.text);
  assert.equal(final.data.issue.status, 'rejected');
});
