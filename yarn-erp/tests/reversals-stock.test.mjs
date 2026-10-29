import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';

const uuid = () => crypto.randomUUID();
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const count = (f, table) => one(f, `SELECT COUNT(*) AS n FROM ${table}`).n;
const grams = (f, lotId, stage) => one(f, 'SELECT grams FROM balances WHERE lot_id=? AND stage=?', lotId, stage)?.grams ?? 0;
const reason = 'Loaded the wrong bale';

// Staff the tests act as: a supervisor, sales manager, dispatch and quality inspector (Anas is the seeded admin).
async function fixture() {
  const f = await portalFixture();
  for (const [name, role] of [['Saima', 'supervisor'], ['Sana', 'sales_manager'], ['Danish', 'dispatch'], ['Qasim', 'quality_inspector']]) {
    if (!one(f, 'SELECT 1 AS n FROM users WHERE name=?', name)) await f.person(name, role);
  }
  return f;
}
// A 100 kg inspection accepted by the supervisor: raw stock, QC approved, ready for production.
async function accepted() {
  const f = await fixture();
  const { lotId, inspectionId } = await f.submitted({ acceptedMilli: 100000 });
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId, decision: 'accept' }, 'Saima')).status, 200);
  return { f, lotId };
}
const produce = (f, lotId, amount) => f.call('/erp/stock/production', { id: uuid(), lotId, grams: amount }, 'Saima');
const finish = (f, lotId, amount) => f.call('/erp/stock/finish', { id: uuid(), lotId, grams: amount }, 'Saima');
const reverse = (f, body, as = 'Saima') => f.call('/erp/stock/transfers/reverse', body, as);
const writeOff = (f, lotId, amount, stage = 'finished') => f.call('/erp/stock/adjustments', { id: uuid(), lotId, stage, kind: 'write_off', deltaGrams: -amount, reason: 'Water damage in store' }, 'Saima');

test('reversing a production transfer puts its raw grams back once; a second reversal is refused', async () => {
  const { f, lotId } = await accepted();
  const moved = await produce(f, lotId, 40000);
  assert.equal(moved.status, 201, moved.text);
  const transfer = moved.data.movementId;
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [60000, 40000]);
  const done = await reverse(f, { id: uuid(), movementId: transfer, reason });
  assert.equal(done.status, 201, done.text);
  assert.equal(done.data.reverses, transfer);
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [100000, 0]);
  const row = one(f, 'SELECT * FROM movements WHERE reverses=?', transfer);
  assert.deepEqual([row.action, row.from_stage, row.to_stage, row.grams, row.note, row.lot_id], ['reverse', 'wip', 'raw', 40000, reason, lotId]);
  assert.equal((await reverse(f, { id: uuid(), movementId: transfer, reason: 'Again' })).status, 409, 'one reversal per movement');
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [100000, 0]);
  assert.equal((await reverse(f, { id: uuid(), movementId: row.id, reason })).status, 404, 'a reversal is not reversed again');
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM erp_audit_events WHERE action='stock.transfer_reversed' AND record_id=?", done.data.movementId).n, 1);
});

test('a finishing transfer reverses only while its finished grams are still there', async () => {
  const { f, lotId } = await accepted();
  const production = (await produce(f, lotId, 40000)).data.movementId;
  const finishing = (await finish(f, lotId, 30000)).data.movementId;
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip'), grams(f, lotId, 'finished')], [60000, 10000, 30000]);
  // the production step has moved on: 40 kg left work in progress only 10 kg
  const moved = await reverse(f, { id: uuid(), movementId: production, reason });
  assert.equal(moved.status, 409); assert.match(moved.data.error, /already moved on/);
  // finished stock written off: the finish cannot come back without going negative
  assert.equal((await writeOff(f, lotId, 30000)).status, 201);
  assert.equal((await reverse(f, { id: uuid(), movementId: finishing, reason })).status, 409);
  assert.deepEqual([grams(f, lotId, 'wip'), grams(f, lotId, 'finished')], [10000, 0]);
  // a fresh finish with its stock intact reverses back into work in progress, then production reverses too
  const again = (await finish(f, lotId, 5000)).data.movementId;
  assert.equal((await reverse(f, { id: uuid(), movementId: again, reason })).status, 201);
  assert.equal(grams(f, lotId, 'wip'), 10000);
});

test('a reversal needs a 3-500 character reason, and only the supervisor, reverse-permission holders or admin can make one', async () => {
  const { f, lotId } = await accepted();
  const transfer = (await produce(f, lotId, 20000)).data.movementId;
  for (const bad of [undefined, '', 'ab', 'x'.repeat(501)]) {
    assert.equal((await reverse(f, { id: uuid(), movementId: transfer, reason: bad })).status, 422, String(bad).slice(0, 10));
  }
  for (const as of ['Danish', 'Sana', 'Qasim']) assert.equal((await reverse(f, { id: uuid(), movementId: transfer, reason }, as)).status, 403, as);
  assert.equal((await reverse(f, { id: uuid(), movementId: transfer, reason }, 'Anas')).status, 422, 'admin gives an intervention reason');
  assert.equal(grams(f, lotId, 'wip'), 20000, 'nothing moved on refusal');
  const done = await reverse(f, { id: uuid(), movementId: transfer, reason, interventionReason: 'Supervisor is away today' }, 'Anas');
  assert.equal(done.status, 201, done.text);
  assert.equal(one(f, "SELECT intervention_reason FROM erp_audit_events WHERE action='stock.transfer_reversed' AND record_id=?", done.data.movementId).intervention_reason, 'Supervisor is away today');
});

test('a repeated reversal request replays the same result; reusing its id for another reason is refused', async () => {
  const { f, lotId } = await accepted();
  const transfer = (await produce(f, lotId, 20000)).data.movementId;
  const body = { id: uuid(), movementId: transfer, reason };
  assert.equal((await reverse(f, body)).status, 201);
  const movements = count(f, 'movements');
  const again = await reverse(f, body);
  assert.equal(again.status, 200); assert.equal(again.data.movementId, body.id);
  assert.equal(count(f, 'movements'), movements, 'the replay writes nothing');
  assert.equal((await reverse(f, { ...body, reason: 'A different reason' })).status, 409);
  assert.equal(grams(f, lotId, 'raw'), 100000);
});

test('a finished batch entry comes off the stock only while nothing else has touched its lot', async () => {
  const f = await fixture();
  const untouched = await f.addFinished({ grams: 10000 }), touched = await f.addFinished({ grams: 10000 });
  const entryOf = lotId => one(f, "SELECT id FROM movements WHERE lot_id=? AND action='receive'", lotId).id;
  const body = lotId => ({ id: uuid(), movementId: entryOf(lotId), reason });
  assert.equal((await writeOff(f, touched, 1000)).status, 201);
  const blocked = await f.call('/erp/stock/batches/reverse', body(touched), 'Saima');
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /moved since/);
  assert.equal(grams(f, touched, 'finished'), 9000);
  assert.equal((await f.call('/erp/stock/batches/reverse', body(untouched), 'Danish')).status, 403);
  const done = await f.call('/erp/stock/batches/reverse', body(untouched), 'Saima');
  assert.equal(done.status, 201, done.text);
  assert.equal(grams(f, untouched, 'finished'), 0);
  assert.equal((await f.call('/erp/stock/batches/reverse', body(untouched), 'Saima')).status, 409, 'a batch entry reverses once');
});

test('an applied adjustment reverses once in full; partial corrections stay open; a pending one waits', async () => {
  const f = await fixture();
  const lotId = await f.addFinished({ grams: 20000 });
  const adjusted = await writeOff(f, lotId, 1000);
  assert.equal(adjusted.status, 201, adjusted.text);
  const original = adjusted.data.adjustment.id;
  const reversal = extra => ({ id: uuid(), lotId, stage: 'finished', kind: 'adjustment', deltaGrams: 1000, reason: 'Recount found the bag', compensatesId: original, ...extra });
  assert.equal((await f.call('/erp/stock/adjustments', reversal({ compensatesId: uuid() }), 'Saima')).status, 404);
  assert.equal((await f.call('/erp/stock/adjustments', reversal({ stage: 'raw' }), 'Saima')).status, 422, 'a reversal targets the same stage');
  assert.equal((await f.call('/erp/stock/adjustments', reversal(), 'Saima')).status, 201);
  assert.equal(grams(f, lotId, 'finished'), 20000);
  assert.equal((await f.call('/erp/stock/adjustments', reversal({ id: uuid() }), 'Saima')).status, 409, 'a full reversal happens once');
  assert.equal((await f.call('/erp/stock/adjustments', reversal({ id: uuid(), deltaGrams: 500, reason: 'Recount found half' }), 'Saima')).status, 201, 'partial corrections are allowed');
  f.setThreshold('inventory_adjustment', 500);
  const big = await f.call('/erp/stock/adjustments', { id: uuid(), lotId, stage: 'finished', kind: 'write_off', deltaGrams: -800, reason: 'Big spill in store' }, 'Saima');
  assert.equal(big.status, 202);
  assert.equal((await f.call('/erp/stock/adjustments', { id: uuid(), lotId, stage: 'finished', kind: 'adjustment', deltaGrams: 800, reason: 'Undo the spill', compensatesId: big.data.adjustment.id }, 'Saima')).status, 409, 'only an applied adjustment reverses');
});

// A sale order for the factory, and a finished batch that can ship against it.
async function sold() {
  const f = await fixture();
  const q = await f.acceptedQuote();
  const sale = await f.call('/erp/sales/sales', { id: uuid(), revisionId: q.revisionId }, 'Sana');
  assert.equal(sale.status, 201, sale.text);
  return { f, orderId: sale.data.order.id, lotId: await f.addFinished({ grams: 10000 }) };
}
// Requests, approves and dispatches `grams`; returns the dispatch id.
async function dispatched({ f, orderId, lotId }, amount = 5000) {
  const created = await f.call('/erp/dispatch', { id: uuid(), orderId, lotId, quantityMilli: amount, grams: amount, cartons: 0, cones: 0 }, 'Danish');
  assert.equal(created.status, 201, created.text);
  assert.equal((await f.call('/erp/dispatch/requests/decide', { requestId: created.data.requestId, decision: 'approve' }, 'Sana')).status, 200);
  const sent = await f.call('/erp/dispatch/dispatched', { dispatchId: created.data.dispatch.id }, 'Danish');
  assert.equal(sent.status, 201, sent.text);
  return created.data.dispatch.id;
}

test('an undone dispatch restores its grams to the same batch, reopens the order and can leave again', async () => {
  const ctx = await sold(), { f, orderId, lotId } = ctx;
  const id = await dispatched(ctx);
  assert.equal(grams(f, lotId, 'finished'), 5000);
  const undo = { id: uuid(), dispatchId: id, reason: 'Wrong vehicle loaded' };
  assert.equal((await f.call('/erp/dispatch/dispatched/reverse', undo, 'Sana')).status, 403, 'sales cannot undo a dispatch');
  const done = await f.call('/erp/dispatch/dispatched/reverse', undo, 'Danish');
  assert.equal(done.status, 201, done.text);
  assert.equal(done.data.dispatch.status, 'approved');
  assert.equal(grams(f, lotId, 'finished'), 10000);
  assert.equal(one(f, 'SELECT status FROM sales_orders WHERE id=?', orderId).status, 'confirmed');
  assert.equal(count(f, 'sales_dispatches'), 1, 'the sale dispatch stays on record');
  assert.equal(count(f, 'dispatch_reversals'), 1);
  assert.equal((await f.call('/erp/dispatch/dispatched/reverse', { ...undo, id: uuid() }, 'Danish')).status, 409, 'an undone dispatch cannot be undone again');
  assert.equal((await f.call('/erp/dispatch/dispatched/reverse', undo, 'Danish')).status, 200, 'the same request replays');
  assert.equal((await f.call('/erp/dispatch/dispatched', { dispatchId: id }, 'Danish')).status, 201);
  assert.equal(grams(f, lotId, 'finished'), 5000);
  assert.equal(one(f, 'SELECT status FROM sales_orders WHERE id=?', orderId).status, 'partially_dispatched');
});

test('a delivered dispatch cannot be undone', async () => {
  const ctx = await sold(), { f } = ctx;
  const id = await dispatched(ctx);
  assert.equal((await f.call('/erp/dispatch/delivered', { dispatchId: id }, 'Danish')).status, 200);
  const refused = await f.call('/erp/dispatch/dispatched/reverse', { id: uuid(), dispatchId: id, reason: 'Too late to undo' }, 'Danish');
  assert.equal(refused.status, 409); assert.match(refused.data.error, /delivered/);
  assert.equal(grams(f, ctx.lotId, 'finished'), 5000);
});

test('a batch produced from raw stock ships from its finished grams only, and stock issues follow the finished stage', async () => {
  const { f, lotId } = await accepted();
  const q = await f.acceptedQuote();
  const orderId = (await f.call('/erp/sales/sales', { id: uuid(), revisionId: q.revisionId }, 'Sana')).data.order.id;
  const request = (amount, id = uuid()) => f.call('/erp/dispatch', { id, orderId, lotId, quantityMilli: amount, grams: amount, cartons: 0, cones: 0 }, 'Danish');
  const raw = await request(5000);
  assert.equal(raw.status, 422); assert.equal(raw.data.error, 'Raw stock cannot be sale-dispatched; only finished goods are supported.');
  assert.equal((await produce(f, lotId, 60000)).status, 201);
  const inProduction = await request(5000);
  assert.equal(inProduction.status, 422); assert.match(inProduction.data.error, /still in production/);
  assert.equal((await finish(f, lotId, 6000)).status, 201);
  assert.equal((await f.call('/erp/dispatch/stock-issues', { id: uuid(), lotId, stage: 'finished', kind: 'shortage', differenceGrams: 100, description: 'Short by one cone' }, 'Danish')).status, 201, 'a finished-stage issue on a produced batch');
  assert.equal((await writeOff(f, lotId, 100)).status, 201, 'a finished-stage adjustment on a produced batch');
  assert.equal(grams(f, lotId, 'finished'), 5900);
  const first = await request(5000);
  assert.equal(first.status, 201, first.text);
  assert.equal((await f.call('/erp/dispatch/requests/decide', { requestId: first.data.requestId, decision: 'approve' }, 'Sana')).status, 200);
  assert.equal((await f.call('/erp/dispatch/dispatched', { dispatchId: first.data.dispatch.id }, 'Danish')).status, 201);
  assert.equal(grams(f, lotId, 'finished'), 900);
  const second = await request(1000);
  assert.equal((await f.call('/erp/dispatch/requests/decide', { requestId: second.data.requestId, decision: 'approve' }, 'Sana')).status, 200);
  const short = await f.call('/erp/dispatch/dispatched', { dispatchId: second.data.dispatch.id }, 'Danish');
  assert.equal(short.status, 409, 'only the finished grams can leave');
  assert.equal(grams(f, lotId, 'finished'), 900);
});

test('a voided stock report stays visible with its reason, and one corrected report can replace it', async () => {
  const f = await fixture();
  const now = Date.now();
  const first = await f.call('/erp/stock/reports', { id: uuid(), from: now - 86400000, to: now, flagged: [], note: 'Week 1' }, 'Saima');
  assert.equal(first.status, 201, first.text);
  const reportId = first.data.report.id;
  assert.equal((await f.call('/erp/stock/reports/void', { id: uuid(), reportId, reason: 'Wrong period' }, 'Sana')).status, 403);
  const voidBody = { id: uuid(), reportId, reason: 'Wrong period' };
  assert.equal((await f.call('/erp/stock/reports/void', voidBody, 'Saima')).status, 201);
  assert.equal((await f.call('/erp/stock/reports/void', voidBody, 'Saima')).status, 200, 'the same void replays');
  assert.equal((await f.call('/erp/stock/reports/void', { id: uuid(), reportId, reason: 'Again' }, 'Saima')).status, 409);
  const second = await f.call('/erp/stock/reports', { id: uuid(), from: now - 86400000, to: now, flagged: [], note: 'Other' }, 'Saima');
  const correction = { id: uuid(), from: now - 86400000, to: now, flagged: [], note: 'Corrected', supersedes: reportId };
  assert.equal((await f.call('/erp/stock/reports', { ...correction, supersedes: second.data.report.id }, 'Saima')).status, 422, 'only a voided report can be corrected');
  const fixed = await f.call('/erp/stock/reports', correction, 'Saima');
  assert.equal(fixed.status, 201, fixed.text);
  assert.equal((await f.call('/erp/stock/reports', { ...correction, id: uuid() }, 'Saima')).status, 409, 'a voided report takes one correction');
  const list = (await f.call('/erp/stock/reports', undefined, 'Saima')).data.reports;
  assert.deepEqual(list.find(r => r.id === reportId).voided.reason, 'Wrong period');
  assert.equal(list.find(r => r.id === fixed.data.report.id).supersedes, reportId);
  assert.equal(list.find(r => r.id === second.data.report.id).voided, null);
});

test('an answered stock query can be voided once; an open one cannot', async () => {
  const f = await fixture();
  const productId = await f.insertProduct();
  const asked = { id: uuid(), productId, question: 'How much 30/1 is ready to ship?' };
  assert.equal((await f.call('/erp/stock/queries', asked, 'Sana')).status, 201);
  assert.equal((await f.call('/erp/stock/queries/void', { id: uuid(), queryId: asked.id, reason: 'Not ready yet' }, 'Saima')).status, 409, 'open queries cannot be voided');
  assert.equal((await f.call('/erp/stock/queries/answer', { id: asked.id, availableGrams: 5000, answer: 'Bay 2' }, 'Saima')).status, 200);
  assert.equal((await f.call('/erp/stock/queries/void', { id: uuid(), queryId: asked.id, reason: 'Wrong material' }, 'Sana')).status, 403);
  const voidBody = { id: uuid(), queryId: asked.id, reason: 'Wrong material' };
  assert.equal((await f.call('/erp/stock/queries/void', voidBody, 'Saima')).status, 201);
  assert.equal((await f.call('/erp/stock/queries/void', voidBody, 'Saima')).status, 200);
  assert.equal((await f.call('/erp/stock/queries/void', { id: uuid(), queryId: asked.id, reason: 'Again' }, 'Saima')).status, 409);
  const row = (await f.call('/erp/stock/queries', undefined, 'Saima')).data.queries.find(q => q.id === asked.id);
  assert.deepEqual([row.status, row.answer, row.void_reason], ['answered', 'Bay 2', 'Wrong material']);
});
