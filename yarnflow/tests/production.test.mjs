import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';

const uuid = () => crypto.randomUUID();
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const all = (f, sql, ...args) => f.sql.prepare(sql).all(...args);
const grams = (f, lotId, stage) => one(f, 'SELECT grams FROM balances WHERE lot_id=? AND stage=?', lotId, stage)?.grams ?? 0;
// Who got a notice for an event, by name, sorted, so each assertion says exactly who was told.
const recipients = (f, event) => all(f, 'SELECT u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event=? ORDER BY u.name', event).map(r => r.name);
const toProduction = (f, lotId, grams, as = 'Saima', extra = {}) => f.call('/erp/stock/production', { id: uuid(), lotId, grams, ...extra }, as);
const attention = (f, as = 'Saima') => f.call('/erp/stock/attention', undefined, as);

// An inspection of 100 kg accepted by the supervisor: raw stock, ready for production.
async function accepted() {
  const f = await portalFixture();
  const { lotId, inspectionId } = await f.submitted({ acceptedMilli: 100000 });
  const decided = await f.call('/erp/qc/reports/decide', { inspectionId, decision: 'accept' }, 'Saima');
  assert.equal(decided.status, 200, decided.text);
  return { f, lotId, inspectionId };
}

test('submitting an accepted quantity tells the supervisor and admin, and it waits in the attention list', async () => {
  const f = await portalFixture();
  const { inspectionId } = await f.submitted({ acceptedMilli: 100000 });
  assert.deepEqual(recipients(f, 'qc.report_waiting'), ['Anas', 'Fahad', 'Saima', 'Zuhair']);
  const list = (await attention(f)).data;
  assert.deepEqual(list.reports.map(r => [r.inspectionId, r.lotReference, r.acceptedMilli, r.unit]), [[inspectionId, list.reports[0].lotReference, 100000, 'kg']]);
  assert.equal(typeof list.reports[0].supplierName, 'string');
  assert.deepEqual(list.readyForProduction, []);
});

test('accepting a report puts raw stock in the lot and tells supervisors and admin, not the actor', async () => {
  const { f, lotId, inspectionId } = await accepted();
  assert.equal(grams(f, lotId, 'raw'), 100000);
  assert.deepEqual(recipients(f, 'stock.ready_for_production'), ['Anas', 'Fahad', 'Zuhair']);
  const label = one(f, "SELECT label FROM notifications WHERE event='stock.ready_for_production' LIMIT 1").label;
  assert.equal(label, `${one(f, 'SELECT batch FROM lots WHERE id=?', lotId).batch} · 100 kg`);
  const list = (await attention(f)).data;
  assert.deepEqual(list.reports, []);
  assert.equal(list.readyForProduction.length, 1);
  assert.deepEqual({ lotId: list.readyForProduction[0].lotId, rawGrams: list.readyForProduction[0].rawGrams }, { lotId, rawGrams: 100000 });
  assert.equal(typeof list.readyForProduction[0].productName, 'string');
  assert.equal(one(f, 'SELECT report_status FROM qc_inspections WHERE id=?', inspectionId).report_status, 'accepted');
});

test('moving 60 kg of 100 to production is one transfer from raw to wip, with its audit and notice', async () => {
  const { f, lotId } = await accepted();
  const body = { id: uuid(), lotId, grams: 60000, note: 'First batch of the day' };
  const moved = await f.call('/erp/stock/production', body, 'Saima');
  assert.equal(moved.status, 201, moved.text);
  assert.deepEqual(moved.data, { lotId, movementId: body.id });
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [40000, 60000]);
  const movement = one(f, 'SELECT * FROM movements WHERE id=?', body.id);
  assert.deepEqual([movement.action, movement.from_stage, movement.to_stage, movement.grams, movement.actor_name, movement.note], ['transfer', 'raw', 'wip', 60000, 'Saima', 'First batch of the day']);
  assert.deepEqual(all(f, 'SELECT stage,grams FROM stock_deltas WHERE movement_id=? ORDER BY stage', body.id).map(d => [d.stage, d.grams]), [['raw', -60000], ['wip', 60000]]);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM erp_audit_events WHERE action=? AND record_id=?', 'stock.to_production', body.id).n, 1);
  assert.deepEqual(recipients(f, 'stock.to_production'), ['Anas', 'Fahad', 'Zuhair']);
  assert.equal(one(f, "SELECT label FROM notifications WHERE event='stock.to_production' LIMIT 1").label.endsWith('· 60 kg'), true);
  // Once a batch is in production it is no longer offered for production, even with raw left over.
  assert.equal((await attention(f)).data.readyForProduction.some(row => row.lotId === lotId), false);
});

test('moving more raw stock than the lot holds is refused and changes nothing', async () => {
  const { f, lotId } = await accepted();
  assert.equal((await toProduction(f, lotId, 100001)).status, 409);
  assert.equal((await toProduction(f, lotId, 100000)).status, 201, 'the whole lot can move');
  assert.equal((await toProduction(f, lotId, 1)).status, 409, 'nothing is left in raw');
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [0, 100000]);
});

test('a lot that is not QC-approved, or not in the workspace, cannot move to production', async () => {
  const { f, lotId } = await accepted();
  f.sql.prepare("UPDATE lots SET quality='hold' WHERE id=?").run(lotId);
  assert.equal((await toProduction(f, lotId, 1000)).status, 409, 'a held lot');
  f.sql.prepare("UPDATE lots SET quality='uninspected' WHERE id=?").run(lotId);
  assert.equal((await toProduction(f, lotId, 1000)).status, 409, 'an uninspected lot');
  assert.equal((await toProduction(f, uuid(), 1000)).status, 404, 'a lot outside the workspace');
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [100000, 0]);
});

test('only the supervisor moves stock; an admin needs an intervention reason', async () => {
  const { f, lotId } = await accepted();
  for (const as of ['Pervaiz', 'Qasim']) assert.equal((await toProduction(f, lotId, 1000, as)).status, 403, as);
  assert.equal((await toProduction(f, lotId, 1000, 'Anas')).status, 422, 'an admin without a reason');
  assert.equal(all(f, 'SELECT id FROM movements WHERE lot_id=? AND action=?', lotId, 'transfer').length, 0);
  const reason = 'Supervisor is away today';
  const saved = await toProduction(f, lotId, 1000, 'Anas', { interventionReason: reason });
  assert.equal(saved.status, 201, saved.text);
  assert.equal(one(f, "SELECT intervention_reason FROM erp_audit_events WHERE action='stock.to_production'").intervention_reason, reason);
});

test('replaying the same request returns the first result and moves nothing twice', async () => {
  const { f, lotId } = await accepted();
  const body = { id: uuid(), lotId, grams: 60000 };
  assert.equal((await f.call('/erp/stock/production', body, 'Saima')).status, 201);
  const replay = await f.call('/erp/stock/production', body, 'Saima');
  assert.equal(replay.status, 200, replay.text);
  assert.deepEqual(replay.data, { lotId, movementId: body.id });
  assert.deepEqual([grams(f, lotId, 'raw'), grams(f, lotId, 'wip')], [40000, 60000]);
  assert.equal(all(f, 'SELECT id FROM movements WHERE id=?', body.id).length, 1);
  assert.equal((await f.call('/erp/stock/production', { ...body, grams: 50000 }, 'Saima')).status, 409, 'the same id for other values');
  assert.equal((await f.call('/erp/stock/production', { ...body, id: uuid(), grams: 0 }, 'Saima')).status, 422, 'zero grams');
});
