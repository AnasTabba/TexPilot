import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { noteSale } from '../server/sales.mjs';

const UUID = () => crypto.randomUUID(), DAY = 86400000;
const bill = (f, path, as) => f.call(path, undefined, as);
const settle = async (f, inspectionId) => {
  const inspection = f.sql.prepare('SELECT accepted_milli FROM qc_inspections WHERE id=?').get(inspectionId);
  if (inspection.accepted_milli > 0) assert.ok((await f.call('/erp/qc/reports/decide', { inspectionId, decision: 'accept' }, 'Saima')).status < 300);
  const confirmed = await f.call('/erp/qc/rejections/decide', { inspectionId, decision: 'confirm' }, 'Saima');
  assert.ok(confirmed.status < 300, confirmed.text);
  return f.sql.prepare('SELECT id FROM claims WHERE inspection_id=?').get(inspectionId).id;
};
// A direct-issued invoice for an active buyer with its own revision and a named product line; total stored exactly.
async function issued(f, { currency = 'PKR', totalMinor = 14750000, issuedAt, dueAt }) {
  const productId = await f.insertProduct(), buyerId = await f.insertBuyer({ status: 'active' });
  const rfqId = await f.insertBuyerRfq({ buyerId }), revisionId = UUID(), order = UUID(), invoiceId = UUID();
  f.sql.prepare(`INSERT INTO sales_quote_revisions(id,workspace_id,buyer_po_id,buyer_id,version,quantity_milli,unit,price_minor,currency,specifications,requested_delivery_at,payment_terms,credit_days,status,created_by,created_at,updated_at)
    VALUES(?,?,?,?,1,100000,'kg',125000,?,'Specified yarn lot',?,'Net 30 days after delivery',30,'approved','test',?,?)`)
    .run(revisionId, f.workspaceId, rfqId, buyerId, currency, issuedAt + 7 * DAY, issuedAt, issuedAt);
  f.sql.prepare("UPDATE buyer_purchase_orders SET status='confirmed' WHERE id=?").run(rfqId);
  f.sql.prepare("INSERT INTO sales_orders(id,workspace_id,reference,buyer_id,buyer_po_id,revision_id,status,terms_snapshot,created_by,created_at) VALUES(?,?,?,?,?,?,'confirmed','{}','test',?)")
    .run(order, f.workspaceId, `SO-${order.slice(0, 8)}`, buyerId, rfqId, revisionId, issuedAt);
  f.sql.prepare("INSERT INTO sales_order_lines(id,workspace_id,sales_order_id,product_id,specifications,quantity_milli,unit,created_at) VALUES(?,?,?,?,?,100000,'kg',?)")
    .run(UUID(), f.workspaceId, order, productId, 'Specified yarn lot', issuedAt);
  f.sql.prepare('INSERT INTO invoices(id,workspace_id,number,sales_order_id,revision_id,buyer_id,lines_json,total_minor,currency,issued_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(invoiceId, f.workspaceId, `X-${invoiceId.slice(0, 8)}`, order, revisionId, buyerId, '[]', totalMinor, currency, issuedAt, dueAt);
  return { invoiceId, buyerId, productId };
}
const monthOf = ms => new Date(ms + 18000000).toISOString().slice(0, 7); // Asia/Karachi calendar month, per the plan's strftime formula
const past = Date.UTC(2026, 7, 15); // historical issued date: month 2026-08 forever, due long since passed on every run after Oct 2026
// Include the plan's fixed Karachi month-boundary fixture on runs before 1 Nov 2026.
const range = (from = 0, to = Math.max(Date.now() + DAY, Date.UTC(2026, 10, 2))) => `from=${from}&to=${to}`;

test('sales analytics group by Karachi month, buyer and product, with payment status and overdue amount', async () => {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  const lateNight = Date.UTC(2026, 9, 31, 20, 0); // 1 Nov 01:00 PKT
  const first = await f.acceptedQuote(), second = await f.acceptedQuote();
  const a = await noteSale(f.env.DB, await f.member('Sana'), { id: UUID(), revisionId: first.revisionId }, lateNight);
  assert.equal(a.invoice.issued_at, lateNight);
  assert.equal(a.invoice.total_minor, 14750000);
  const b = await noteSale(f.env.DB, await f.member('Sana'), { id: UUID(), revisionId: second.revisionId }, past);
  assert.ok(b.invoice.due_at < Date.now(), 'the historical invoice is past its Karachi due date');
  const c = await issued(f, { issuedAt: lateNight, dueAt: null });
  const sales = await bill(f, `/erp/analytics/sales?${range()}`, 'Sana');
  assert.equal(sales.status, 200, sales.text);
  for (const value of [...sales.data.byPeriod, ...sales.data.byBuyer, ...sales.data.byProduct]) assert.ok(Number.isSafeInteger(value.totalMinor), 'exact integer money');
  assert.deepEqual(sales.data.byPeriod.find(row => row.period === '2026-11'), { period: '2026-11', currency: 'PKR', totalMinor: 29500000 }, 'both 1 Nov PKT invoices share the 2026-11 Karachi month');
  assert.equal(sales.data.byPeriod.find(row => row.period === monthOf(b.invoice.issued_at)).totalMinor, 14750000);
  assert.equal(sales.data.byPeriod.length, 2);
  assert.equal(sales.data.byBuyer.reduce((sum, row) => sum + row.totalMinor, 0), 44250000, 'buyers publish exact per-buyer totals');
  assert.equal(sales.data.byBuyer.length, 3, 'one row per buyer even inside one currency group');
  assert.deepEqual(sales.data.byProduct.filter(row => row.product === null), [{ product: null, currency: 'PKR', totalMinor: 29500000 }]);
  assert.equal(sales.data.byProduct.find(row => row.product !== null).totalMinor, 14750000, 'the named product line groups exactly');
  assert.deepEqual(sales.data.paymentStatus, { unpaid: 2, partially_paid: 0, paid: 0, overdue: 1 });
  assert.deepEqual(sales.data.overdueByCurrency, [{ currency: 'PKR', overdueMinor: 14750000 }]);
  assert.equal(sales.data.overdueByCurrency.reduce((sum, row) => sum + row.overdueMinor, 0), b.invoice.total_minor);
});

test('purchase analytics give supplier performance and a bidding summary', async () => {
  const f = await portalFixture();
  await f.person('Pervaiz', 'purchase_manager');
  // Settle an 80/20 lot so supplierPerformance reports qcPassRate 0.8 through Task 10 final dispositions.
  const settled = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  await settle(f, settled.inspectionId);
  // Every purchase row the range counts sits strictly after the fixture PO's creation moment.
  const fixtureAt = f.sql.prepare('SELECT created_at FROM procurement_rfqs ORDER BY created_at LIMIT 1').get().created_at;
  await new Promise(resolve => setTimeout(resolve, 3));
  const supplierId = await f.insertSupplier({ status: 'approved' });
  await f.insertPO({ supplierId }); // awarded RFQ, one bid, one PO inside the range
  const rfqBody = { id: UUID(), title: 'Cotton combed 30/1', categoryId: 'cotton', specifications: 'Ring-spun 30/1', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'Karachi factory', deadlineAt: Date.now() + DAY, requestedDeliveryAt: Date.now() + 10 * DAY };
  const rfq = await f.call('/erp/rfqs', rfqBody, 'Pervaiz');
  assert.equal(rfq.status, 201, rfq.text);
  assert.equal((await f.call('/erp/rfqs/publish', { id: rfq.data.rfq.id }, 'Pervaiz')).status, 200);
  await f.insertBid({ rfqId: rfq.data.rfq.id, supplierId });
  await f.insertBid({ rfqId: rfq.data.rfq.id, supplierId: settled.supplierId });
  assert.equal((await f.call('/erp/rfqs/close', { id: rfq.data.rfq.id }, 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/rfqs/cancel', { id: rfq.data.rfq.id, reason: 'Demand shifted to another line' }, 'Pervaiz')).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_bids WHERE rfq_id=?').get(rfq.data.rfq.id).n, 2);
  const purchase = await bill(f, `/erp/analytics/purchase?from=${fixtureAt + 1}&to=${Date.now() + DAY}`, 'Pervaiz');
  assert.equal(purchase.status, 200, purchase.text);
  // The fixture PO is outside the range: one awarded RFQ with one bid counts; the cancelled RFQ is reported but not averaged.
  assert.deepEqual(purchase.data.bidding, { rfqs: 1, bids: 1, averageBidsPerRfq: 1, awarded: 1, cancelled: 1 }, 'cancelled and draft RFQs stay out of the bid average');
  const mill = purchase.data.suppliers.find(row => row.id === settled.supplierId);
  assert.equal(mill.qcPassRate, 0.8, 'final lot disposition: 80000 of 100000 dispositioned as accepted');
  assert.deepEqual(mill.claims, { return: 0, replacement: 0, claim: 0 }, 'an undecided claim is not yet part of performance');
  assert.deepEqual(Object.keys(mill).sort(), ['claims', 'id', 'manualAverage', 'name', 'onTimeRate', 'qcPassRate', 'ratingCount']);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM procurement_rfqs WHERE created_at>? AND status='awarded'").get(fixtureAt + 1).n, 1);
});

test('admin analytics cover every module and user activity', async () => {
  const f = await portalFixture();
  const from = Date.now() - 1000, to = Date.now() + DAY;
  await f.person('Sana', 'sales_manager');
  const supplierId = await f.insertSupplier({ status: 'approved' });
  await f.insertPO({ supplierId }); // purchasing: one award in PKR, 12,500,000 minor
  const reviewed = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 }); // settled lot + one raw receipt of 80,000 g
  const claimId = await settle(f, reviewed.inspectionId); // rejected 20,000 milli at the 125,000 rate → 2,500,000
  assert.equal((await f.call('/erp/qc/claims/decide', { id: claimId, outcome: 'claim' }, 'Anas')).status, 200);
  const finishedLotId = await f.addFinished({ grams: 10000 });
  const productId = f.sql.prepare('SELECT product_id FROM lots WHERE id=?').get(finishedLotId).product_id;
  for (const [stage, grams] of [['cops', 3000], ['wip', 1500]]) {
    const lotId = UUID(), movementId = UUID(), now = Date.now();
    f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,'Legacy supplier','approved',?)")
      .run(lotId, f.workspaceId, productId, `LEGACY-${stage}`, now);
    f.sql.prepare("INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,request_hash,created_at) VALUES(?,?,?,'receive',NULL,?,?,0,0,'Legacy balance','test','test',?,?)")
      .run(movementId, f.workspaceId, lotId, stage, grams, movementId, now);
    f.sql.prepare('INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,0,0)')
      .run(UUID(), movementId, lotId, stage, grams);
  }
  const adjust = await f.call('/erp/stock/adjustments', { id: UUID(), lotId: reviewed.lotId, stage: 'raw', kind: 'write_off', deltaGrams: -2000, reason: 'Damaged cones found during recount' }, 'Saima');
  assert.equal(adjust.status, 201, adjust.text);
  const first = await f.acceptedQuote();
  const sale = await noteSale(f.env.DB, await f.member('Sana'), { id: UUID(), revisionId: first.revisionId }, Date.now());
  f.sql.prepare(`INSERT INTO dispatches(id,workspace_id,sales_order_id,lot_id,quantity_milli,grams,status,created_by,created_at,updated_at)
    VALUES(?,?,?,?,1000,1000,'pending_approval',?,?,?)`).run(UUID(), f.workspaceId, sale.order.id, finishedLotId, 'test', Date.now(), Date.now());
  const admin = await bill(f, `/erp/analytics/admin?from=${from}&to=${to}`, 'Anas');
  assert.equal(admin.status, 200, admin.text);
  assert.deepEqual(Object.keys(admin.data).sort(), ['dispatch', 'inventory', 'payments', 'purchasing', 'quality', 'sales', 'users']);
  assert.deepEqual(admin.data.dispatch, { pending_approval: 1, approved: 0, on_hold: 0, dispatched: 0, delivered: 0 });
  assert.deepEqual(admin.data.purchasing.rfqs, { draft: 0, open: 0, closed: 0, awarded: 2, cancelled: 0 });
  assert.equal(admin.data.purchasing.awards, 2);
  assert.deepEqual(admin.data.purchasing.totalsByCurrency, [{ currency: 'PKR', poTotalMinor: 12500000000 + 12500000 }], 'fixture PO plus the submitted() PO, in the same currency group');
  assert.deepEqual(admin.data.quality.claims, { return: 0, replacement: 0, claim: 1 });
  assert.deepEqual(admin.data.quality.totalsByCurrency, [{ currency: 'PKR', claimMinor: 2500000 }]);
  assert.deepEqual({ inspectedMilli: admin.data.quality.inspectedMilli, acceptedMilli: admin.data.quality.acceptedMilli, rejectedMilli: admin.data.quality.rejectedMilli, passRate: admin.data.quality.passRate }, { inspectedMilli: 100000, acceptedMilli: 80000, rejectedMilli: 20000, passRate: 0.8 });
  assert.deepEqual(admin.data.inventory, { rawGrams: 78000, copsGrams: 3000, wipGrams: 1500, finishedGrams: 10000, adjustments: 1, adjustedGrams: -2000 }, 'legacy stages stay visible alongside raw and finished');
  const balances = f.sql.prepare('SELECT stage, SUM(grams) AS grams FROM balances b JOIN lots l ON l.id=b.lot_id WHERE l.workspace_id=? GROUP BY stage').all(f.workspaceId);
  for (const stage of ['raw', 'cops', 'wip', 'finished']) assert.equal(admin.data.inventory[`${stage}Grams`], balances.find(row => row.stage === stage)?.grams ?? 0);
  assert.deepEqual(admin.data.payments.byCurrency, [{ currency: 'PKR', outstandingMinor: 14750000, overdueMinor: 0 }]);
  const salesOnly = await bill(f, `/erp/analytics/sales?from=${from}&to=${to}`, 'Sana');
  assert.deepEqual(admin.data.sales, salesOnly.data, "the admin sales block is the sales endpoint's own function");
  const expected = f.sql.prepare(`SELECT u.name, u.portal_role AS role, (SELECT COUNT(*) FROM erp_audit_events e WHERE e.actor_id=u.id AND e.actor_type='staff' AND e.created_at BETWEEN ? AND ?) AS actions
    FROM users u WHERE u.workspace_id=? AND u.portal_role IS NOT NULL ORDER BY actions DESC, u.name`).all(from, to, f.workspaceId);
  assert.deepEqual(admin.data.users, expected.map(row => ({ ...row })), 'user activity counts audit rows per actor in range, roles included');
  for (const row of admin.data.users) assert.ok(Number.isInteger(row.actions));
});

test('each role sees only its analytics', async () => {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  await f.person('Pervaiz', 'purchase_manager');
  await f.person('Qasim', 'quality_inspector');
  await f.person('Danish', 'dispatch');
  for (const name of ['Sana', 'Pervaiz', 'Qasim', 'Danish']) assert.equal((await f.login(name)).status, 200);
  assert.equal((await bill(f, '/erp/analytics/admin', 'Sana')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/admin', 'Pervaiz')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/admin', 'Qasim')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/admin', 'Danish')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/sales', 'Sana')).status, 200);
  assert.equal((await bill(f, '/erp/analytics/sales', 'Qasim')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/purchase', 'Qasim')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/purchase', 'Sana')).status, 403);
  assert.equal((await bill(f, '/erp/analytics/purchase', 'Pervaiz')).status, 200);
  for (const block of ['admin', 'sales', 'purchase']) {
    const response = await bill(f, `/erp/analytics/${block}`, 'Anas');
    assert.equal(response.status, 200, response.text);
    assert.equal(typeof response.data, 'object');
  }
});

test('QC analytics count returned then re-inspected quantities once', async () => {
  const f = await portalFixture();
  const original = await f.submitted({ acceptedMilli: 100000 });
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: original.inspectionId, decision: 'reject', reason: 'Accepted side needs a clearer photo review' }, 'Saima')).status, 200);
  const replacement = await f.submitted({ acceptedMilli: 100000, lotId: original.lotId });
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: replacement.inspectionId, decision: 'accept' }, 'Saima')).status, 200);
  const now = Date.now();
  const admin = await bill(f, `/erp/analytics/admin?from=${now - DAY}&to=${now + DAY}`, 'Anas');
  assert.equal(admin.status, 200, admin.text);
  assert.deepEqual({ inspectedMilli: admin.data.quality.inspectedMilli, acceptedMilli: admin.data.quality.acceptedMilli, rejectedMilli: admin.data.quality.rejectedMilli, passRate: admin.data.quality.passRate },
    { inspectedMilli: 100000, acceptedMilli: 100000, rejectedMilli: 0, passRate: 1 });
});

test('analytics never sum unlike currencies', async () => {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  const lateNight = Date.UTC(2026, 9, 31, 20, 0);
  // Unpaid invoices of two currencies cannot exist at once (currency_change_blockers), so the test walks the move itself:
  // leave PKR on an empty ledger, issue the USD invoice and settle it in full, then return to PKR for the unpaid pair.
  assert.equal((await f.call('/erp/admin/settings', { key: 'currency', value: 'USD' }, 'Anas')).status, 200);
  const usd = await issued(f, { currency: 'USD', totalMinor: 20000, issuedAt: past, dueAt: past + 30 * DAY }); // historical USD invoice
  f.sql.prepare('INSERT INTO invoice_payments(id,workspace_id,invoice_id,amount_minor,received_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(UUID(), f.workspaceId, usd.invoiceId, 20000, Date.now(), 'test', Date.now(), Date.now()); // settled in full before the move back
  assert.equal((await f.call('/erp/admin/settings', { key: 'currency', value: 'PKR' }, 'Anas')).status, 200, 'the paid USD invoice unblocks the move back');
  const first = await f.acceptedQuote(); // PKR 14,750,000 including GST, still unpaid and not due
  await noteSale(f.env.DB, await f.member('Sana'), { id: UUID(), revisionId: first.revisionId }, lateNight);
  const overdue = await issued(f, { totalMinor: 25000, issuedAt: past, dueAt: past + 45 * DAY }); // historical PKR invoice, long overdue
  assert.equal((await f.call('/erp/sales/credit-notes', { id: UUID(), invoiceId: overdue.invoiceId, amountMinor: 10000, reason: 'Short delivery agreed' }, 'Sana')).status, 201);
  const sales = await bill(f, `/erp/analytics/sales?${range()}`, 'Sana');
  assert.deepEqual([...sales.data.byPeriod].sort((x, y) => x.period.localeCompare(y.period) || x.currency.localeCompare(y.currency)), [
    { period: '2026-08', currency: 'PKR', totalMinor: 15000 },
    { period: '2026-08', currency: 'USD', totalMinor: 20000 },
    { period: '2026-11', currency: 'PKR', totalMinor: 14750000 },
  ]);
  assert.deepEqual(sales.data.byBuyer.map(row => [row.currency, row.totalMinor]).sort(), [['PKR', 14750000], ['PKR', 15000], ['USD', 20000]]);
  for (const row of [...sales.data.byPeriod, ...sales.data.byBuyer, ...sales.data.byProduct, ...sales.data.overdueByCurrency]) assert.notEqual(row.totalMinor ?? row.overdueMinor, 14770000, 'a combined unlike-currency scalar never appears');
  assert.deepEqual(sales.data.paymentStatus, { unpaid: 1, partially_paid: 0, paid: 1, overdue: 1 });
  assert.deepEqual(sales.data.overdueByCurrency, [{ currency: 'PKR', overdueMinor: 15000 }]);
  const admin = await bill(f, `/erp/analytics/admin?${range()}`, 'Anas');
  assert.deepEqual(admin.data.payments.byCurrency, [{ currency: 'PKR', outstandingMinor: 14765000, overdueMinor: 15000 }], 'the paid USD invoice leaves no outstanding group');
  assert.equal(admin.data.sales.byPeriod.length, 3, 'the admin sales block stays per-currency too');
  for (const row of admin.data.payments.byCurrency) assert.notEqual(row.outstandingMinor, 14770000);
});

test('PO and claim totals stay in their source currency after a settings change', async () => {
  const f = await portalFixture();
  const from = Date.now() - 1000, to = Date.now() + 2 * DAY;
  const supplierId = await f.insertSupplier({ status: 'approved' });
  await f.insertPO({ supplierId, priceMinor: 125000, quantityMilli: 100000 }); // PKR terms, 12,500,000 total
  const pkr = await f.submitted({ rejectedMilli: 20000 }); // the mill's own PKR PO: 12,500,000,000 in total
  const pkrClaimId = await settle(f, pkr.inspectionId); // PKR claim: 20,000 milli at the 125,000 rate → 2,500,000 PKR
  await f.call('/erp/qc/claims/decide', { id: pkrClaimId, outcome: 'claim' }, 'Anas'); // decided while the factory and the PO both read PKR
  assert.equal((await f.call('/erp/admin/settings', { key: 'currency', value: 'USD' }, 'Anas')).status, 200);
  // A USD-termed PO on the books, with a shipment so the USD rejection can ride the QC flow.
  const usdOrder = UUID(), usdRfq = UUID(), usdBid = UUID(), usdShipment = UUID(), now = Date.now();
  f.sql.prepare(`INSERT INTO procurement_rfqs(id,workspace_id,reference,title,category_id,specifications,quantity_milli,unit,delivery_location,deadline_at,requested_delivery_at,status,request_hash,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'open','usd-rfq','test',?,?)`)
    .run(usdRfq, f.workspaceId, 'RFQ-USD-1', 'Combed USD lot', 'cotton', '30/1', 100000, 'kg', 'Karachi factory', now + DAY, now + 7 * DAY, now, now);
  f.sql.prepare('INSERT INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) VALUES(?,?,?,?)')
    .run(usdRfq, supplierId, JSON.stringify({ name: 'Mill' }), now);
  f.sql.prepare(`INSERT INTO supplier_bids(id,rfq_id,supplier_id,quantity_milli,price_minor,currency,payment_terms,delivery_at,valid_until,note,version,status,created_by,created_at,updated_at)
    VALUES(?,?,?, ?,90000,'USD','Net 30',?,?,?,1,'submitted',?,?,?)`)
    .run(usdBid, usdRfq, supplierId, 100000, now + 7 * DAY, now + 14 * DAY, 'supplier:' + supplierId, 'test', now, now);
  f.sql.prepare(`INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at,quantity_milli,total_minor,approval_status,version,updated_at,created_by)
    VALUES(?,?,?,?,?,?,?,'accepted','test',?,?,9000000,'approved',1,?,?)`)
    .run(usdOrder, f.workspaceId, usdRfq, usdBid, supplierId, 'PO-USD-1', JSON.stringify({ rfq_id: usdRfq, supplier_id: supplierId, price_minor: 90000, currency: 'USD', delivery_at: now + 7 * DAY, quantity_milli: 100000, unit: 'kg' }), now, 100000, now, 'test');
  f.sql.prepare("UPDATE procurement_rfqs SET status='awarded' WHERE id=?").run(usdRfq);
  f.sql.prepare('INSERT INTO shipments(id,workspace_id,purchase_order_id,bill_of_lading,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(usdShipment, f.workspaceId, usdOrder, 'BL-USD-1', 'test', now, now);
  const lotId = UUID(), inspectionId = UUID();
  assert.equal((await f.call('/erp/qc/lots', { id: lotId, orderId: usdOrder, shipmentId: usdShipment, productId: pkr.productId, reference: 'LOT-USD-1', quantityMilli: 100000, arrivedAt: now - 1000 }, 'Pervaiz')).status, 201);
  assert.equal((await f.call('/erp/qc/inspections', { id: inspectionId, lotId, acceptedMilli: 0, rejectedMilli: 20000 }, 'Qasim')).status, 201);
  assert.equal((await f.call('/erp/qc/issues', { id: UUID(), inspectionId, type: 'Shade variation', severity: 'major', description: 'Dye lot differs from the approved sample' }, 'Qasim')).status, 201);
  assert.equal((await f.call('/erp/qc/inspections/submit', { id: inspectionId }, 'Qasim')).status, 200);
  const usdClaimId = await settle(f, inspectionId); // USD claim: 20,000 milli at the 90,000 rate → 1,800,000 USD
  await f.call('/erp/qc/claims/decide', { id: usdClaimId, outcome: 'claim' }, 'Anas'); // decided while the factory and the PO both read USD
  assert.equal((await f.call('/erp/admin/settings', { key: 'currency', value: 'EUR' }, 'Anas')).status, 200, 'no open bid, unaccepted quotation or unpaid invoice blocks the move');
  const admin = await bill(f, `/erp/analytics/admin?from=${from}&to=${to}`, 'Anas');
  assert.deepEqual([...admin.data.purchasing.totalsByCurrency].sort((x, y) => x.currency.localeCompare(y.currency)), [
    { currency: 'PKR', poTotalMinor: 12500000000 + 12500000 },
    { currency: 'USD', poTotalMinor: 9000000 },
  ], 'PO totals group by the PO term currency, not the current factory currency');
  assert.deepEqual([...admin.data.quality.totalsByCurrency].sort((x, y) => x.currency.localeCompare(y.currency)), [
    { currency: 'PKR', claimMinor: 2500000 },
    { currency: 'USD', claimMinor: 1800000 },
  ], 'claim money follows its PO terms even after the settings change');
  assert.deepEqual(admin.data.quality.claims, { return: 0, replacement: 0, claim: 2 });
  for (const row of [...admin.data.purchasing.totalsByCurrency, ...admin.data.quality.totalsByCurrency]) assert.ok(row.currency, 'every monetary row carries its own currency label');
});

test('analytics respect their from/to range and refuse invalid ranges', async () => {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  const t0 = Date.now() - 1000;
  const first = await f.acceptedQuote(), second = await f.acceptedQuote();
  await noteSale(f.env.DB, await f.member('Sana'), { id: UUID(), revisionId: first.revisionId }, Date.now() - 60 * DAY); // outside the narrow window
  await noteSale(f.env.DB, await f.member('Sana'), { id: UUID(), revisionId: second.revisionId }, Date.now());
  const window = `from=${t0}&to=${Date.now() + DAY}`;
  const sales = await bill(f, `/erp/analytics/sales?${window}`, 'Sana');
  assert.equal(sales.data.byPeriod.length, 1, 'the far-past invoice stays outside the window');
  assert.equal(sales.data.byBuyer.length, 1, 'byBuyer follows the same issued-at window');
  const wide = await bill(f, `/erp/analytics/sales?from=0&to=${Date.now() + DAY}`, 'Sana');
  assert.equal(wide.data.byPeriod.length, 2, 'from the epoch both invoices read');
  const users = await bill(f, `/erp/analytics/admin?${window}`, 'Anas');
  for (const row of users.data.users) assert.ok(Number.isInteger(row.actions));
  assert.equal((await bill(f, `/erp/analytics/sales?from=${Date.now() + DAY}&to=${Date.now()}`, 'Sana')).status, 422, 'the period must end after it starts');
  assert.equal((await bill(f, '/erp/analytics/sales?from=notanumber&to=99', 'Sana')).status, 422);
  assert.equal((await bill(f, '/erp/analytics/sales?from=0&to=-1', 'Sana')).status, 422);
});

test('byProduct counts an invoice once per product however many lines name it', async () => {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  const { invoiceId, productId } = await issued(f, { issuedAt: past, dueAt: null });
  const order = f.sql.prepare('SELECT sales_order_id AS id FROM invoices WHERE id=?').get(invoiceId).id;
  f.sql.prepare("INSERT INTO sales_order_lines(id,workspace_id,sales_order_id,product_id,specifications,quantity_milli,unit,created_at) VALUES(?,?,?,?,?,100000,'kg',?)")
    .run(UUID(), f.workspaceId, order, productId, 'Second line, same product', past);
  const sales = await bill(f, `/erp/analytics/sales?${range()}`, 'Sana');
  assert.equal(sales.data.byProduct.find(row => row.product !== null).totalMinor, 14750000);
});

test('purchasing totals skip cancelled purchase orders', async () => {
  const f = await portalFixture();
  const supplierId = await f.insertSupplier({ status: 'approved' });
  await f.insertPO({ supplierId });
  f.sql.exec("UPDATE supplier_purchase_orders SET status='cancelled'");
  const admin = await bill(f, `/erp/analytics/admin?from=0&to=${Date.now() + DAY}`, 'Anas');
  assert.deepEqual(admin.data.purchasing.totalsByCurrency, []);
});
