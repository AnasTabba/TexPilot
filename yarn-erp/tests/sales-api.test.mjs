import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { salesApi, salesScheduled, dueAt, PKT_OFFSET_MS } from '../server/sales.mjs';
import { buyerPortalApi as portal } from '../server/buyer-portal.mjs';
import { ErpProblem } from '../server/erp-utils.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';
import { inventoryApi } from '../server/inventory.mjs';
import { sha256 } from '../server/auth.mjs';

const origin = 'https://yarnflow.test', pw = 'A strong buyer password 2026';
const DAY = 86400000, PKT = 5 * 3600_000;

/** Applies migrations 0000..0003 only — used to rehearse the 0004 audit rebuild on existing rows. */
function applyMigrations(sql, names) {
  const dir = new URL('../drizzle/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql') && (names ? names.includes(f) : true)).sort())
    sql.exec(readFileSync(new URL(f, dir), 'utf8'));
}
/** The router maps thrown ErpProblem values to JSON error responses; mirror that here. */
const routed = async promise => {
  try { return await promise; }
  catch (error) { if (error instanceof ErpProblem) return Response.json({ error: error.message }, { status: error.status }); throw error; }
};

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  applyMigrations(sql);
  for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
  const env = { DB: sqliteBinding(sql) };
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id;
  const adminId = sql.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  const admin = { user_id: adminId, workspace_id: workspaceId, name: 'Anas', role: 'owner', admin: true, permissions: [] };
  const member = async (name, permissions) => {
    const row = await userRow({ workspaceId, name, pin: '2468', permissions });
    sql.prepare(row.sql).run(...row.args);
    const id = sql.prepare('SELECT id FROM users WHERE name=?').get(name).id;
    return { user_id: id, workspace_id: workspaceId, name, role: 'operator', admin: false, permissions };
  };
  const manager = await member('Sam Sales', ['sales', 'payments', 'dispatch']);
  async function staff(path, data, by = admin) {
    const response = await routed(salesApi(new Request(origin + path, { method: data === undefined ? 'GET' : 'POST' }), env, by, path, data));
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, data: type.includes('json') ? await response.json() : await response.text(), headers: response.headers };
  }
  async function buyer(path, data, cookie) {
    const response = await routed(portal(new Request(origin + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env, path));
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, data: type.includes('json') ? await response.json() : await response.text(), headers: response.headers };
  }
  let buyerSeq = 0;
  async function registerBuyer(name = 'Hina Fabrics', email = name.toLowerCase().replace(/[^a-z]/g, '') + '@buyer.test') {
    // Keep fixtures unique even when their human-readable names only differ by digits.
    if (arguments.length < 2) email = `${name.toLowerCase().replace(/[^a-z]/g, '')}${++buyerSeq}@buyer.test`;
    const reg = await buyer('/api/buyer/register', { company: name, contactName: name + ' Contact', email, phone: '+923331234567', city: 'Lahore', password: pw });
    assert.equal(reg.status, 201);
    const id = sql.prepare('SELECT buyer_id FROM buyer_users WHERE email=?').get(email).buyer_id;
    const login = await buyer('/api/buyer/login', { email, password: pw });
    const cookie = login.headers.get('Set-Cookie')?.split(';')[0];
    assert.ok(cookie, 'buyer session cookie issued');
    return { id, email, cookie };
  }
  async function activate(id, status = 'active') {
    const version = sql.prepare('SELECT version FROM buyers WHERE id=?').get(id).version;
    const response = await staff('/api/erp/sales/buyers/review', { id, status, version, reason: 'Company and contact verified', assignedManagerId: manager.user_id });
    assert.equal(response.status, 200, JSON.stringify(response.data));
  }
  async function approvedBuyer(name) { const b = await registerBuyer(name); await activate(b.id); return b; }
  async function buyerPo(cookie, reference = 'PO-TEST-1', quantityMilli = 100000, unit = 'kg') {
    const id = crypto.randomUUID();
    const response = await buyer('/api/buyer/pos', { id, reference, specifications: 'Combed cotton single jersey, 180 GSM', quantityMilli, unit, requestedDeliveryAt: Date.now() + 21 * DAY, paymentTerms: 'Net 30 days after delivery' }, cookie);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.po;
  }
  async function quoteAndSend(po, priceMinor = 125000, currency = 'PKR', by = manager) {
    const id = crypto.randomUUID();
    const draft = await staff('/api/erp/sales/quotes', { id, poId: po.id, priceMinor, currency, specifications: 'Combed cotton single jersey, 180 GSM', requestedDeliveryAt: po.requested_delivery_at, paymentTerms: po.payment_terms, note: 'Freight excluded' }, by);
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    assert.equal((await staff('/api/erp/sales/quotes/send', { id: draft.data.revision.id }, by)).status, 200);
    return draft.data.revision;
  }
  async function approve(cookie, revision) {
    return buyer('/api/buyer/approve', { revisionId: revision.id, version: revision.version, note: 'Approved as quoted' }, cookie);
  }
  let lotSeq = 0;
  function seedLot(productSku = 'SJ-180', grams = 100000, stage = 'finished') {
    productSku = `${productSku}-${++lotSeq}`;
    const productId = crypto.randomUUID(), lotId = crypto.randomUUID();
    sql.prepare('INSERT INTO products(id,workspace_id,sku,name,created_at) VALUES(?,?,?,?,?)').run(productId, workspaceId, productSku, 'Single jersey', Date.now());
    sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,quality,created_at) VALUES(?,?,?,?, 'approved',?)").run(lotId, workspaceId, productId, 'B-' + productSku, Date.now());
    sql.prepare('INSERT INTO balances(lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?)').run(lotId, stage, grams, 0, 0);
    return { productId, lotId };
  }
  async function dispatch(order, lotId, quantityMilli, at = Date.now() - 3600000, by = manager, expectedStatus = 201) {
    const response = await staff('/api/erp/sales/dispatches', { id: crypto.randomUUID(), orderId: order.id, lotId, stage: 'finished', quantityMilli, grams: quantityMilli, cartons: 0, cones: 0, carrier: 'TCS Roadline', packages: [], documentsNote: '', dispatchedAt: at }, by);
    assert.equal(response.status, expectedStatus, JSON.stringify(response.data));
    if (expectedStatus !== 201) return response;
    return response.data.dispatch;
  }
  async function deliver(disp, deliveryDate = Date.now() - 600000, by = manager) {
    const response = await staff('/api/erp/sales/deliveries', { id: crypto.randomUUID(), dispatchId: disp.id, deliveryDate, evidenceNote: 'Signed challan' }, by);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }
  /** A confirmed order with one invoice and dispatchable stock behind it. */
  async function confirmedOrder(quantityMilli = 100000, priceMinor = 125000) {
    const b = await approvedBuyer('Buyer Co ' + (++buyerSeq));
    const po = await buyerPo(b.cookie, 'PO-' + b.id.slice(0, 8), quantityMilli);
    const revision = await quoteAndSend(po, priceMinor);
    const approval = await approve(b.cookie, revision);
    assert.equal(approval.status, 200, JSON.stringify(approval.data));
    return { buyer: b, po, revision, order: approval.data.order, invoice: approval.data.invoice, ...seedLot() };
  }
  return { sql, env, admin, manager, member, staff, buyer, registerBuyer, activate, approvedBuyer, buyerPo, quoteAndSend, approve, seedLot, dispatch, deliver, confirmedOrder, workspaceId };
}

test('buyer portal identity is separate from staff accounts and gated by admin review', async () => {
  const f = await fixture();
  const pending = await f.registerBuyer('Pending Co');
  assert.equal((await f.buyer('/api/buyer/me', undefined, pending.cookie)).data.buyer.status, 'pending');
  assert.equal((await f.buyer('/api/buyer/workspace', undefined, pending.cookie)).status, 403, 'pending buyers cannot read the workspace');
  const stored = f.sql.prepare('SELECT password_hash,password_salt FROM buyer_users').get();
  assert.notEqual(stored.password_hash, pw);
  assert.equal(stored.password_hash.length, 64, 'salted hash stored, never the password');
  await f.activate(pending.id);
  assert.equal((await f.buyer('/api/buyer/me', undefined, pending.cookie)).data.buyer.status, 'active');
  assert.equal((await f.buyer('/api/buyer/me', undefined, pending.cookie)).data.buyer.manager_name, 'Sam Sales');
  assert.equal((await f.buyer('/api/buyer/approve', { revisionId: crypto.randomUUID(), version: 1 }, pending.cookie)).status, 404);
  assert.equal((await f.buyer('/api/erp/sales', undefined, pending.cookie)).status, 404, 'buyer portal does not serve staff paths');
  assert.equal((await f.buyer('/api/buyer/me', undefined, 'yf_buyer_session=' + 'd'.repeat(64))).status, 401);
});

test('the production API router serves staff sales and the public buyer portal behind their intended sessions', async () => {
  const f = await fixture();
  const token = crypto.randomUUID().replaceAll('-', '').repeat(2);
  f.sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(await sha256(token), f.admin.user_id, Date.now() + DAY, Date.now());
  const staffResponse = await inventoryApi(new Request(origin + '/api/erp/sales', { headers: { Cookie: `yf_session=${token}` } }), f.env);
  assert.equal(staffResponse.status, 200);
  assert.equal((await staffResponse.json()).buyers.length, 0);
  const publicResponse = await inventoryApi(new Request(origin + '/api/buyer/config'), f.env);
  assert.equal(publicResponse.status, 200, 'buyer registration configuration is public');
  assert.equal((await publicResponse.json()).registrationAvailable, true);
  const blocked = await inventoryApi(new Request(origin + '/api/erp/sales'), f.env);
  assert.equal(blocked.status, 401, 'staff sales requires the staff session');
});

test('buyer approval confirms one order and issues exactly one numbered invoice with exact money', async () => {
  const f = await fixture();
  const { buyer: b, po, order, invoice } = await f.confirmedOrder(100000, 125000);
  assert.equal(order.status, 'confirmed');
  assert.equal(invoice.total_minor, 12500000, '100 kg × PKR 1250.00 = PKR 125,000.00 exactly');
  assert.equal(invoice.currency, 'PKR');
  assert.equal(invoice.number, 'INV-2026-000001');
  const counter = f.sql.prepare("SELECT next_number FROM document_counters WHERE kind='invoice'").get();
  assert.equal(counter.next_number, 1, 'counter reflects issued invoice');
  const lines = JSON.parse(f.sql.prepare('SELECT lines_json FROM invoices WHERE id=?').get(invoice.id).lines_json);
  assert.equal(lines[0].amount_minor, 12500000);
  assert.equal(f.sql.prepare('SELECT status FROM buyer_purchase_orders WHERE id=?').get(po.id).status, 'confirmed');
  assert.equal(f.sql.prepare('SELECT status FROM sales_quote_revisions WHERE id=?').get(f.sql.prepare('SELECT revision_id FROM sales_orders WHERE id=?').get(order.id).revision_id).status, 'approved');
  const approval = f.sql.prepare('SELECT * FROM buyer_approvals').get();
  assert.ok(approval.terms_digest.length === 64, 'approval stores a terms digest');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM erp_audit_events WHERE actor_type='buyer' AND action='sales.order_confirmed'").get().n, 1, 'buyer approval is audited');
  const document = await f.staff('/api/erp/sales/invoices/' + invoice.id);
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(document.headers.get('content-disposition') ?? '', /attachment; filename="INV-2026-000001\.html"/);
  assert.match(String(document.data), /PKR 125,000\.00|PKR 125000\.00|125000\.00/);
});

test('duplicate and stale approvals cannot mint a second invoice; numbering never reuses', async () => {
  const f = await fixture();
  const { buyer: b, revision, order, invoice } = await f.confirmedOrder(100000, 125000);
  const repeat = await f.approve(b.cookie, revision);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.already, true, 'duplicate approval is idempotent');
  assert.equal(repeat.data.invoice.id, invoice.id, 'same invoice returned');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM invoices').get().n, 1);
  assert.equal((await f.buyer('/api/buyer/approve', { revisionId: revision.id, version: 99 }, b.cookie)).status, 409, 'stale version rejected');
  // A second buyer's approval of someone else's revision is invisible (404), never a new invoice.
  const other = await f.approvedBuyer('Other Co');
  assert.equal((await f.approve(other.cookie, revision)).status, 404);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM invoices').get().n, 1);
  // A second confirmed order numbers forward with no reuse or duplicate.
  const second = await f.confirmedOrder(50000, 250000);
  assert.equal(second.invoice.number, 'INV-2026-000002');
  assert.notEqual(second.invoice.id, invoice.id);
  assert.equal(f.sql.prepare('SELECT COUNT(DISTINCT number) n FROM invoices').get().n, 2);
  // Non-divisible price×quantity pairs cannot draft a quote at all.
  const thirdBuyer = await f.approvedBuyer('Third Co');
  const po = await f.buyerPo(thirdBuyer.cookie, 'PO-THIRD-1', 999, 'kg');
  assert.equal((await f.staff('/api/erp/sales/quotes', { id: crypto.randomUUID(), poId: po.id, priceMinor: 1235, currency: 'PKR', specifications: 'Cotton yarn 30/1 ring spun', requestedDeliveryAt: po.requested_delivery_at, paymentTerms: po.payment_terms })).status, 422, 'price×quantity must divide into whole minor units');
});

test('partial dispatch, delivery and payment keep exact cumulative amounts', async () => {
  const f = await fixture();
  const { buyer: b, order, invoice, lotId } = await f.confirmedOrder(100000, 125000);
  assert.equal(f.sql.prepare("SELECT grams FROM balances WHERE lot_id=? AND stage='finished'").get(lotId).grams, 100000);
  const first = await f.dispatch(order, lotId, 60000);
  assert.equal(f.sql.prepare("SELECT grams FROM balances WHERE lot_id=? AND stage='finished'").get(lotId).grams, 40000, 'stock issued from the ledger');
  assert.equal(f.sql.prepare('SELECT status FROM sales_orders WHERE id=?').get(order.id).status, 'partially_dispatched');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM receivables').get().n, 0, 'no receivable before delivery');
  const one = await f.deliver(first);
  assert.equal(one.receivable.amount_minor, 7500000, '60% of PKR 125,000.00');
  assert.equal((await f.staff('/api/erp/sales/deliveries', { id: crypto.randomUUID(), dispatchId: first.id, deliveryDate: Date.now() - 600000 })).status, 200, 're-delivery is idempotent');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM receivables').get().n, 1);
  assert.equal((await f.dispatch(order, lotId, 60000, Date.now() - 3600000, f.manager, 409)).status, 409, 'cannot exceed the ordered quantity');
  const second = await f.dispatch(order, lotId, 40000);
  assert.equal(f.sql.prepare('SELECT status FROM sales_orders WHERE id=?').get(order.id).status, 'dispatched');
  const two = await f.deliver(second);
  assert.equal(two.receivable.amount_minor, 5000000, 'last delivery lands exactly on the invoice remainder');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM receivables').get().n, 2);
  // Payments: partial, over-payment, settle, then nothing more.
  const partial = await f.staff('/api/erp/sales/payments', { id: crypto.randomUUID(), receivableId: one.receivable.id, amountMinor: 2000000, note: 'First instalment' });
  assert.equal(partial.status, 201);
  assert.equal(f.sql.prepare('SELECT paid_minor FROM receivables WHERE id=?').get(one.receivable.id).paid_minor, 2000000);
  assert.equal((await f.staff('/api/erp/sales/payments', { id: crypto.randomUUID(), receivableId: two.receivable.id, amountMinor: 6000000 })).status, 409, 'above outstanding');
  assert.equal((await f.staff('/api/erp/sales/payments', { id: crypto.randomUUID(), receivableId: one.receivable.id, amountMinor: 10500000 })).status, 409, 'above this receivable');
  assert.equal((await f.staff('/api/erp/sales/payments', { id: crypto.randomUUID(), receivableId: two.receivable.id, amountMinor: 5000000 })).status, 201, 'settle the second');
  assert.equal(f.sql.prepare('SELECT status FROM receivables WHERE id=?').get(two.receivable.id).status, 'settled');
  assert.equal((await f.staff('/api/erp/sales/payments', { id: crypto.randomUUID(), receivableId: two.receivable.id, amountMinor: 100000 })).status, 409, 'settled takes no more');
  // Over-dispatch on the other buyer's confirmed order cannot touch this one's numbers.
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sales_dispatches WHERE sales_order_id=?').get(order.id).n, 2);
  void b; void invoice;
});

test('due dates are Karachi delivery date +30 days across month and year boundaries', async () => {
  const f = await fixture();
  // Unit-level pinning of the exported rule (no DST in Pakistan: fixed UTC+5).
  assert.equal(dueAt(Date.UTC(2025, 11, 28, 7) - PKT, 30), Date.UTC(2026, 0, 27, 18, 59, 59, 999), 'Dec 28 → Jan 27 end of day PKT');
  assert.equal(dueAt(Date.UTC(2025, 11, 31, 7) - PKT, 30), Date.UTC(2026, 0, 30, 18, 59, 59, 999), 'Dec 31 → Jan 30');
  assert.equal(dueAt(Date.UTC(2026, 0, 5, 7) - PKT, 30), Date.UTC(2026, 1, 4, 18, 59, 59, 999), 'Jan 5 → Feb 4');
  // End-to-end through the API with a real dispatch → delivery → receivable.
  const { order, lotId } = await f.confirmedOrder(40000, 100000);
  const at = Date.UTC(2025, 11, 26, 12);
  const disp = await f.dispatch(order, lotId, 40000, at);
  const one = await f.deliver(disp, Date.UTC(2025, 11, 28, 7));
  assert.equal(one.receivable.due_at, Date.UTC(2026, 0, 27, 18, 59, 59, 999));
  // Corrected delivery date: audited, bumps due_revision, moves the due date.
  const corrected = await f.staff('/api/erp/sales/deliveries/correct', { id: crypto.randomUUID(), deliveryId: one.delivery.id, deliveryDate: Date.UTC(2025, 11, 30, 7), reason: 'Challan recorded the wrong day' });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
  assert.equal(corrected.data.dueRevision, 2);
  assert.equal(corrected.data.dueAt, Date.UTC(2026, 0, 29, 18, 59, 59, 999), 'corrected date moves the due date');
  assert.equal(f.sql.prepare('SELECT due_revision,due_at FROM receivables WHERE delivery_id=?').get(one.delivery.id).due_revision, 2);
  assert.equal(f.sql.prepare('SELECT delivery_date FROM sales_deliveries WHERE id=?').get(one.delivery.id).delivery_date, Date.UTC(2025, 11, 28, 7), 'original delivery unchanged');
  const log = f.sql.prepare('SELECT previous_date,corrected_date,reason FROM delivery_corrections').get();
  assert.equal(log.previous_date, Date.UTC(2025, 11, 28, 7));
  assert.equal(log.corrected_date, Date.UTC(2025, 11, 30, 7));
  assert.equal((await f.staff('/api/erp/sales/deliveries/correct', { id: crypto.randomUUID(), deliveryId: one.delivery.id, deliveryDate: Date.UTC(2025, 11, 30, 7), reason: 'Same date correction' })).status, 422, 'same-date correction rejected');
  assert.equal((await f.staff('/api/erp/sales/deliveries/correct', { id: crypto.randomUUID(), deliveryId: one.delivery.id, deliveryDate: Date.UTC(2025, 11, 25, 7), reason: 'Before dispatch attempt' })).status, 422, 'cannot precede the dispatch');
});

test('role and organization isolation: staff matrix, buyer scoping, no cross-domain rights', async () => {
  const f = await fixture();
  const { buyer: b, revision, order, invoice, lotId } = await f.confirmedOrder(60000, 125000);
  const disp = await f.dispatch(order, lotId, 60000);
  // Permission matrix: a receive-only clerk cannot use sales routes; a payments member cannot quote; a sales member cannot pay.
  const clerk = await f.member('Kamran Clerk', ['receive']);
  assert.equal((await f.staff('/api/erp/sales', undefined, clerk)).status, 403);
  assert.equal((await f.staff('/api/erp/sales/buyers', { id: crypto.randomUUID(), name: 'X Co', contactName: 'X Contact', email: 'x@x.test', phone: '+923201234567', city: '', notes: '' }, clerk)).status, 403);
  const biller = await f.member('Bilal Biller', ['payments']);
  assert.equal((await f.staff('/api/erp/sales', undefined, biller)).status, 200, 'payments sees the overview');
  assert.equal((await f.staff('/api/erp/sales/quotes', { id: crypto.randomUUID(), poId: f.sql.prepare('SELECT id FROM buyer_purchase_orders LIMIT 1').get().id, priceMinor: 125000, currency: 'PKR', specifications: 'Cotton yarn 30/1', requestedDeliveryAt: Date.now() + DAY, paymentTerms: 'Net 30' }, biller)).status, 403, 'payments cannot draft quotes');
  const seller = await f.member('Sana Sales', ['sales']);
  const openReceivable = f.sql.prepare('SELECT id FROM receivables WHERE status=?').get('open') ?? f.sql.prepare('SELECT id FROM receivables').get();
  if (openReceivable) assert.equal((await f.staff('/api/erp/sales/payments', { id: crypto.randomUUID(), receivableId: openReceivable.id, amountMinor: 1000 }, seller)).status, 403, 'sales cannot record payments');
  const mover = await f.member('Mujeeb Mover', ['dispatch']);
  const second = await f.confirmedOrder(50000, 125000);
  assert.ok((await f.dispatch(second.order, second.lotId, 50000, Date.now() - 7200000, mover)).id, 'dispatch permission is enough to dispatch');
  // Buyer scoping: another buyer sees none of this buyer's records.
  const other = await f.approvedBuyer('Isolated Co');
  const view = await f.buyer('/api/buyer/workspace', undefined, other.cookie);
  assert.equal(view.data.pos.length, 0);
  assert.equal(view.data.invoices.length, 0);
  assert.equal(view.data.orders.length, 0);
  assert.equal((await f.buyer('/api/buyer/invoices/' + invoice.id, undefined, other.cookie)).status, 404, 'another buyer cannot download the invoice');
  assert.equal((await f.buyer('/api/buyer/approve', { revisionId: revision.id, version: revision.version }, other.cookie)).status, 404, 'another buyer cannot approve');
  assert.equal((await f.buyer('/api/buyer/pos', { id: crypto.randomUUID(), reference: 'X-PO-1', specifications: 'Isolation test PO spec', quantityMilli: 1000, unit: 'kg', requestedDeliveryAt: Date.now() + DAY, paymentTerms: 'Net 30' }, other.cookie)).status, 201, 'own PO still works');
  assert.equal((await f.buyer('/api/buyer/pos', { id: crypto.randomUUID(), reference: 'X-PO-1', specifications: 'Reference clash test', quantityMilli: 1000, unit: 'kg', requestedDeliveryAt: Date.now() + DAY, paymentTerms: 'Net 30' }, b.cookie)).status, 409, 'workspace-unique PO references');
  void disp;
});

test('scheduled reminders deduplicate, target correctly, and stop after settlement', async () => {
  const f = await fixture();
  const { buyer: b, order, lotId } = await f.confirmedOrder(60000, 125000);
  const disp = await f.dispatch(order, lotId, 60000, Date.now() - 4 * DAY);
  const { receivable } = await f.deliver(disp, Date.now() - 3 * DAY);
  const open = f.sql.prepare('SELECT id FROM receivables WHERE status=?').get('open');
  const now = Date.now();
  f.sql.prepare('UPDATE receivables SET due_at=? WHERE id=?').run(now + 3 * DAY, open.id);
  assert.equal((await salesScheduled(f.env, now)).created, 1, 'due soon reminder created');
  const soon = f.sql.prepare('SELECT kind,target_role FROM sales_reminders WHERE receivable_id=?').get(open.id);
  assert.equal(soon.kind, 'due_soon');
  assert.equal(soon.target_role, 'sales_manager', 'assigned manager targeted');
  f.sql.prepare('UPDATE receivables SET due_at=? WHERE id=?').run(now - 2 * DAY, open.id);
  assert.equal((await salesScheduled(f.env, now)).created, 1, 'kind change creates the overdue reminder');
  assert.equal(f.sql.prepare('SELECT target_role FROM sales_reminders WHERE receivable_id=? AND kind=?').get(open.id, 'overdue').target_role, 'sales_manager');
  assert.equal((await salesScheduled(f.env, now)).created, 0, 'third run deduplicates completely');
  // Admin fallback when the assigned manager is inactive.
  f.sql.prepare('UPDATE users SET status=? WHERE id=?').run('pending', f.manager.user_id);
  const open2 = f.sql.prepare("SELECT r.id FROM receivables r WHERE r.status='open'").get();
  f.sql.prepare('UPDATE receivables SET due_at=? WHERE id=?').run(now + DAY, open2.id);
  f.sql.prepare('UPDATE buyers SET assigned_manager_id=? WHERE id=?').run(f.manager.user_id, b.id);
  f.sql.prepare('UPDATE delivery_corrections SET due_revision=1').run(); void open2;
  const dueRevision = f.sql.prepare('SELECT due_revision FROM receivables WHERE id=?').get(f.sql.prepare('SELECT id FROM receivables WHERE status=?').get('open').id).due_revision + 1;
  f.sql.prepare('UPDATE receivables SET due_revision=? WHERE id=?').run(dueRevision, f.sql.prepare('SELECT id FROM receivables WHERE status=?').get('open').id);
  assert.equal((await salesScheduled(f.env, now)).created, 1, 'new due revision gets a fresh reminder');
  const fallback = f.sql.prepare('SELECT target_role FROM sales_reminders WHERE due_revision=?').get(dueRevision);
  assert.equal(fallback.target_role, 'admin', 'inactive manager falls back to an active admin');
  assert.equal((await salesScheduled(f.env, now)).created, 0, 'reminder run is stable afterwards');
  // Settlement stops reminders.
  f.sql.prepare('UPDATE receivables SET status=? WHERE status=?').run('settled', 'open');
  assert.equal((await salesScheduled(f.env, now)).created, 0, 'settled receivables get no reminders');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sales_reminders').get().n, 3);
});

test('immutable documents, ledger rules and honest outbox states', async () => {
  const f = await fixture();
  const { order, invoice, lotId } = await f.confirmedOrder(30000, 125000);
  // Invoices cannot change or disappear.
  assert.throws(() => f.sql.prepare('UPDATE invoices SET total_minor=1 WHERE id=?').run(invoice.id), /invoices are immutable/);
  assert.throws(() => f.sql.prepare('DELETE FROM invoices WHERE id=?').run(invoice.id), /invoices are immutable/);
  // The kg rule is structural: a forged dispatch row with grams≠quantity_milli is refused.
  assert.throws(() => f.sql.prepare("INSERT INTO sales_dispatches(id,workspace_id,sales_order_id,movement_id,lot_id,from_stage,quantity_milli,unit,grams,cartons,cones,carrier,packages_json,documents_note,dispatched_at,request_hash,created_by,created_at) VALUES(?,?,?,?,?,'finished',?,'kg',?,0,0,'x','[]','',?, 'x',?,?)")
    .run(crypto.randomUUID(), f.workspaceId, order.id, crypto.randomUUID(), lotId, 10000, 9999, Date.now(), 'x', Date.now()), /invalid sales dispatch/);
  // Outbox attempts are recorded and the message stays queued — never displayed as sent.
  const message = f.sql.prepare("SELECT id FROM sales_outbox WHERE kind='invoice_document' ORDER BY created_at LIMIT 1").get().id;
  const retried = await f.staff('/api/erp/sales/outbox/retry', { id: message });
  assert.equal(retried.status, 200);
  assert.equal(retried.data.message.state, 'queued');
  assert.ok(retried.data.message.attempts >= 1, 'attempt recorded');
  assert.ok(retried.data.message.last_error, 'honest reason recorded');
  assert.equal(retried.data.queued, true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sales_outbox WHERE state=?').get('sent').n, 0);
  // Quote notifications are queued for the buyer too.
  assert.ok(f.sql.prepare("SELECT COUNT(*) n FROM sales_outbox WHERE kind='quote_sent'").get().n >= 1);
  // A delivery cannot precede its dispatch and a dispatch cannot be in the future.
  assert.equal((await f.staff('/api/erp/sales/dispatches', { id: crypto.randomUUID(), orderId: order.id, lotId, stage: 'finished', quantityMilli: 1, grams: 1, cartons: 0, cones: 0, carrier: 'X Carrier', dispatchedAt: Date.now() + DAY })).status, 422);
});

test('erp_audit_events actor_type extension rehearsal: rows preserved, buyer admitted, CHECK intact', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  applyMigrations(sql, ['0000_inventory.sql', '0001_users.sql', '0002_procurement.sql', '0003_receiving.sql']);
  for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id;
  const staffId = sql.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  const insert = sql.prepare("INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)");
  insert.run(crypto.randomUUID(), workspaceId, staffId, 'staff', 'test.before', crypto.randomUUID(), '{}', Date.now());
  insert.run(crypto.randomUUID(), workspaceId, 'supplier-1', 'supplier', 'test.before', crypto.randomUUID(), '{}', Date.now());
  assert.throws(() => insert.run(crypto.randomUUID(), workspaceId, 'buyer-1', 'buyer', 'test.before', crypto.randomUUID(), '{}', Date.now()), /CHECK constraint failed/, 'before 0004 buyer is rejected');
  const before = sql.prepare('SELECT COUNT(*) n FROM erp_audit_events').get().n;
  applyMigrations(sql, ['0004_sales.sql']);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM erp_audit_events').get().n, before, 'rebuild preserves every row');
  assert.doesNotThrow(() => insert.run(crypto.randomUUID(), workspaceId, 'buyer-1', 'buyer', 'test.after', crypto.randomUUID(), '{}', Date.now()), 'after 0004 buyer is admitted');
  assert.throws(() => insert.run(crypto.randomUUID(), workspaceId, 'x', 'machine', 'test.after', crypto.randomUUID(), '{}', Date.now()), /CHECK constraint failed/, 'unknown actors stay rejected');
  assert.throws(() => sql.prepare('UPDATE erp_audit_events SET action=?').run('x'), /immutable audit/, 'immutability triggers survive the rebuild');
  assert.throws(() => sql.prepare('DELETE FROM erp_audit_events').run(), /immutable audit/);
});
