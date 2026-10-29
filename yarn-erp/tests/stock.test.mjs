import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { remindersScheduled } from '../server/notify.mjs';
import { portalFixture, migrate, dir, legacyMigrations, liveShapedRows } from './portal-fixture.mjs';

const PEOPLE = [['Pervaiz', 'purchase_manager'], ['Qasim', 'quality_inspector'], ['Saima', 'supervisor'], ['Sadia', 'supervisor'], ['Sana', 'sales_manager'], ['Danish', 'dispatch']];
async function fixture() {
  const f = await portalFixture();
  for (const [name, role] of PEOPLE) await f.person(name, role);
  for (const name of ['Anas', 'Fahad', ...PEOPLE.map(([name]) => name)]) await f.login(name);
  return f;
}
const uuid = () => crypto.randomUUID();
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const all = (f, sql, ...args) => f.sql.prepare(sql).all(...args);
const count = (f, table, where = '1=1', ...args) => one(f, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...args).n;
const grams = (f, lotId, stage = 'finished') => one(f, 'SELECT grams FROM balances WHERE lot_id=? AND stage=?', lotId, stage)?.grams ?? 0;
const audits = (f, action) => all(f, 'SELECT * FROM erp_audit_events WHERE action=?', action);
const adjust = (f, lotId, deltaGrams, extra = {}, as = 'Saima') => f.call('/erp/stock/adjustments', { id: uuid(), lotId, stage: 'finished', kind: deltaGrams < 0 ? 'write_off' : 'adjustment', deltaGrams, reason: 'Water damage in bay 3', ...extra }, as);
const decide = (f, id, decision = 'approve', reason, as = 'Anas') => f.call('/erp/approvals/decide', { id, decision, ...(reason ? { reason } : {}) }, as);
const tables = f => Object.fromEntries(['movements', 'stock_deltas', 'balances', 'inventory_adjustments', 'erp_audit_events'].map(t => [t, all(f, `SELECT * FROM ${t} ORDER BY 1,2`)]));

test('only the supervisor adds inventory; finished goods record type and source', async () => {
  const f = await fixture(), productId = await f.insertProduct();
  const body = { id: uuid(), productId, batch: 'FIN-1', grams: 10000, cartons: 4, cones: 80, note: 'First run' };
  for (const as of ['Qasim', 'Pervaiz', 'Sana', 'Danish']) assert.equal((await f.call('/erp/stock/finished', body, as)).status, 403, as);
  assert.equal((await f.call('/erp/stock/finished', body, 'Anas')).status, 422, 'an admin needs an intervention reason');
  assert.equal(count(f, 'lots'), 0); assert.equal(count(f, 'movements'), 0);
  const saved = await f.call('/erp/stock/finished', body, 'Saima');
  assert.equal(saved.status, 201);
  const lot = one(f, 'SELECT * FROM lots WHERE batch=?', 'FIN-1');
  assert.deepEqual([lot.inventory_type, lot.source, lot.quality], ['finished', 'production', 'approved']);
  assert.deepEqual({ ...one(f, "SELECT grams,cartons,cones FROM balances WHERE lot_id=? AND stage='finished'", lot.id) }, { grams: 10000, cartons: 4, cones: 80 });
  const movement = one(f, 'SELECT * FROM movements WHERE lot_id=?', lot.id);
  assert.deepEqual([movement.action, movement.to_stage, movement.actor_name, movement.note], ['receive', 'finished', 'Saima', 'First run']);
  assert.equal((await f.call('/erp/stock/finished', body, 'Saima')).status, 200, 'the same request is idempotent');
  assert.equal((await f.call('/erp/stock/finished', { ...body, grams: 5 }, 'Saima')).status, 409, 'the id cannot be reused for different stock');
  assert.equal(grams(f, lot.id), 10000);
  // more goods of the same batch join the same production lot; a legacy lot's batch is refused
  assert.equal((await f.call('/erp/stock/finished', { id: uuid(), productId, batch: 'FIN-1', grams: 500 }, 'Saima')).status, 201);
  assert.equal(grams(f, lot.id), 10500); assert.equal(count(f, 'lots'), 1);
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,?,?,?)").run(uuid(), f.workspaceId, productId, 'OLD', '', 'approved', Date.now());
  assert.equal((await f.call('/erp/stock/finished', { id: uuid(), productId, batch: 'OLD', grams: 500 }, 'Saima')).status, 409);
  assert.equal((await f.call('/erp/stock/finished', { id: uuid(), productId: uuid(), batch: 'X', grams: 500 }, 'Saima')).status, 404);
  assert.equal((await f.call('/erp/stock/finished', { id: uuid(), productId, batch: 'X', grams: 0 }, 'Saima')).status, 422);
  assert.equal((await f.call('/erp/stock/finished', { ...body, id: uuid(), batch: 'ADMIN', interventionReason: 'Supervisor is away today' }, 'Anas')).status, 201);
  assert.equal(audits(f, 'inventory.received').at(-1).intervention_reason, 'Supervisor is away today');
});

test('adjustments need a reason; below the threshold they apply at once', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 10000 });
  f.setThreshold('inventory_adjustment', 10000);
  assert.equal((await adjust(f, lotId, -5000, { reason: undefined })).status, 422);
  assert.equal((await adjust(f, lotId, -5000, { reason: 'ok' })).status, 422);
  assert.equal((await adjust(f, lotId, 5000, { kind: 'write_off' })).status, 422, 'a write-off removes stock');
  assert.equal((await adjust(f, lotId, 0)).status, 422);
  assert.equal(count(f, 'inventory_adjustments'), 0); assert.equal(grams(f, lotId), 10000);
  const done = await adjust(f, lotId, -5000);
  assert.equal(done.status, 201); assert.equal(done.data.adjustment.status, 'applied');
  assert.equal(grams(f, lotId), 5000);
  const movement = one(f, "SELECT * FROM movements WHERE action='waste'");
  assert.deepEqual([movement.note, movement.from_stage, movement.grams, movement.actor_name], ['Water damage in bay 3', 'finished', 5000, 'Saima']);
  assert.equal(one(f, 'SELECT movement_id FROM inventory_adjustments WHERE id=?', done.data.adjustment.id).movement_id, movement.id);
  const [event] = audits(f, 'inventory.adjusted'); assert.equal(event.reason, 'Water damage in bay 3'); assert.equal(event.actor_role, 'supervisor');
  const gain = await adjust(f, lotId, 700, { reason: 'Recount found a missing carton' });
  assert.equal(gain.status, 201); assert.equal(grams(f, lotId), 5700);
  assert.equal(one(f, "SELECT action FROM movements WHERE note='Recount found a missing carton'").action, 'receive');
  assert.equal((await adjust(f, lotId, -100, {}, 'Sana')).status, 403);
  assert.equal((await adjust(f, lotId, -100, { stage: 'raw' })).status, 422, 'a finished lot holds no raw stock to adjust');
  // an unset threshold means not configured: the supervisor's decision is final
  f.sql.exec("DELETE FROM thresholds WHERE type='inventory_adjustment'");
  assert.equal((await adjust(f, lotId, -5000)).status, 201); assert.equal(grams(f, lotId), 700);
  // the same id repeats safely
  const again = { id: uuid(), lotId, stage: 'finished', kind: 'write_off', deltaGrams: -100, reason: 'Sample taken by quality' };
  assert.equal((await f.call('/erp/stock/adjustments', again, 'Saima')).status, 201);
  assert.equal((await f.call('/erp/stock/adjustments', again, 'Saima')).status, 200);
  assert.equal((await f.call('/erp/stock/adjustments', { ...again, deltaGrams: -200 }, 'Saima')).status, 409);
  assert.equal(grams(f, lotId), 600);
});

test('at or above the adjustment threshold nothing changes until admin approves', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 40000 });
  f.setThreshold('inventory_adjustment', 10000);
  const small = await adjust(f, lotId, -9999); assert.equal(small.status, 201);
  const held = await adjust(f, lotId, -10000);
  assert.equal(held.status, 202); assert.equal(held.data.pendingApproval, true);
  assert.equal(grams(f, lotId), 30001); assert.equal(count(f, 'movements'), 2);
  const adjustment = one(f, 'SELECT * FROM inventory_adjustments WHERE status=?', 'pending_approval');
  assert.equal(adjustment.movement_id, null);
  const request = one(f, 'SELECT * FROM approval_requests WHERE id=?', held.data.approvalId);
  assert.deepEqual([request.type, request.object_id, request.amount, request.threshold, request.unit], ['inventory_adjustment', adjustment.id, 10000, 10000, 'grams']);
  assert.equal(all(f, "SELECT 1 FROM notifications WHERE event='approval.pending' AND object_id=?", request.id).length, count(f, 'users', "portal_role='admin'"), 'every admin hears about it');
  const view = await f.call('/erp/approvals/' + request.id, undefined, 'Anas');
  assert.equal(view.status, 200); assert.equal(view.data.object.evidence.currentGrams, 30001); assert.equal(view.data.object.proposed.deltaGrams, -10000);
  assert.equal(view.data.object.evidence.reason, 'Water damage in bay 3'); assert.equal(view.data.object.evidence.thresholdGrams, 10000);
  assert.equal((await decide(f, request.id, 'approve', undefined, 'Saima')).status, 403);
  assert.equal((await decide(f, request.id)).status, 200);
  assert.equal(grams(f, lotId), 20001);
  const applied = one(f, 'SELECT * FROM inventory_adjustments WHERE id=?', adjustment.id);
  assert.equal(applied.status, 'applied'); assert.ok(applied.movement_id);
  assert.equal(one(f, 'SELECT actor_name,note FROM movements WHERE id=?', applied.movement_id).actor_name, 'Anas');
  assert.equal(audits(f, 'inventory.adjusted').length, 2);
  // a rejection with a reason leaves the stock alone
  const other = await adjust(f, lotId, -12000, { reason: 'Moisture damage found in the bay' });
  assert.equal(other.status, 202);
  assert.equal((await decide(f, other.data.approvalId, 'reject')).status, 422);
  assert.equal((await decide(f, other.data.approvalId, 'reject', 'Count it again first')).status, 200);
  assert.equal(grams(f, lotId), 20001);
  assert.equal(one(f, 'SELECT status FROM inventory_adjustments WHERE id=?', other.data.adjustment.id).status, 'rejected');
  assert.equal(count(f, 'movements'), 3);
  // threshold is the stored one: raising it afterwards does not change a pending request
  const third = await adjust(f, lotId, -10000, { reason: 'Customer sample not returned' });
  f.setThreshold('inventory_adjustment', 1000000);
  assert.equal((await decide(f, third.data.approvalId)).status, 200); assert.equal(grams(f, lotId), 10001);
});

test('two admins approving one adjustment: one lands, the other changes nothing', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 30000 });
  f.setThreshold('inventory_adjustment', 10000);
  const held = await adjust(f, lotId, -10000);
  const results = await Promise.all([decide(f, held.data.approvalId, 'approve', undefined, 'Anas'), decide(f, held.data.approvalId, 'approve', undefined, 'Fahad')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(grams(f, lotId), 20000); assert.equal(count(f, 'movements'), 2); assert.equal(audits(f, 'inventory.adjusted').length, 1);
  assert.equal(count(f, 'stock_deltas', "lot_id=? AND grams<0", lotId), 1);
  // a decided adjustment is final
  const row = one(f, "SELECT id FROM inventory_adjustments WHERE status='applied'");
  assert.throws(() => f.sql.prepare("UPDATE inventory_adjustments SET reason='Rewritten reason' WHERE id=?").run(row.id), /final/);
  assert.throws(() => f.sql.prepare('DELETE FROM inventory_adjustments WHERE id=?').run(row.id), /cannot be deleted/);
});

test('an approval that would drive stock negative aborts whole, leaving the request pending', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 12000 });
  f.setThreshold('inventory_adjustment', 10000);
  const held = await adjust(f, lotId, -10000);
  assert.equal(held.status, 202);
  assert.equal((await adjust(f, lotId, -2000, { reason: 'Moisture damage found in the bay' })).status, 201);
  assert.equal((await adjust(f, lotId, -1000, { reason: 'Moisture damage found again' })).status, 201);
  const before = tables(f);
  assert.equal((await decide(f, held.data.approvalId)).status, 409);
  assert.deepEqual(tables(f), before);
  assert.equal(one(f, 'SELECT status FROM approval_requests WHERE id=?', held.data.approvalId).status, 'pending');
});

test('adjustments cannot make stock negative', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 10000 });
  const refused = await adjust(f, lotId, -999999);
  assert.equal(refused.status, 409); assert.equal(refused.data.error, 'This would make stock negative.');
  assert.equal(count(f, 'inventory_adjustments'), 0); assert.equal(grams(f, lotId), 10000);
  f.setThreshold('inventory_adjustment', 100);
  assert.equal((await adjust(f, lotId, -999999)).status, 409, 'not even a request is raised for impossible stock');
  assert.equal(count(f, 'approval_requests'), 0);
  f.sql.exec("DELETE FROM thresholds WHERE type='inventory_adjustment'");
  const before = tables(f);
  const results = await Promise.all([adjust(f, lotId, -7000), adjust(f, lotId, -7000, { reason: 'Second shelf collapsed' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(grams(f, lotId), 3000); assert.equal(count(f, 'inventory_adjustments'), 1);
  assert.equal(count(f, 'movements'), before.movements.length + 1); assert.equal(audits(f, 'inventory.adjusted').length, 1);
});

test('sales asks a stock query and the supervisor answers with the available quantity', async () => {
  const f = await fixture(), productId = await f.insertProduct(), id = uuid();
  const ask = { id, productId, quantityMilli: 100000, question: 'Can we ship 100 kg of this next week?' };
  assert.equal((await f.call('/erp/stock/queries', ask, 'Danish')).status, 403);
  assert.equal((await f.call('/erp/stock/queries', { ...ask, question: 'no' }, 'Sana')).status, 422);
  assert.equal((await f.call('/erp/stock/queries', { ...ask, productId: uuid() }, 'Sana')).status, 404);
  assert.equal(count(f, 'stock_queries'), 0);
  assert.equal((await f.call('/erp/stock/queries', ask, 'Sana')).status, 201);
  assert.equal((await f.call('/erp/stock/queries', ask, 'Sana')).status, 200);
  assert.equal((await f.call('/erp/stock/queries', { ...ask, question: 'A different question altogether' }, 'Sana')).status, 409);
  assert.equal(count(f, 'stock_queries'), 1);
  const told = all(f, "SELECT u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event='stock_query.created' AND n.object_id=? ORDER BY u.name", id).map(r => r.name);
  assert.deepEqual(told, ['Sadia', 'Saima']);
  assert.equal(audits(f, 'stock_query.created').length, 1);
  assert.equal((await f.call('/erp/stock/queries', undefined, 'Danish')).status, 403);
  const open = (await f.call('/erp/stock/queries', undefined, 'Saima')).data.queries;
  assert.deepEqual(open.map(q => [q.id, q.status, q.product_name != null]), [[id, 'open', true]]);
  assert.equal((await f.call('/erp/stock/queries/answer', { id, availableGrams: 80000 }, 'Sana')).status, 403);
  assert.equal((await f.call('/erp/stock/queries/answer', { id, availableGrams: -1 }, 'Saima')).status, 422);
  const answers = await Promise.all([f.call('/erp/stock/queries/answer', { id, availableGrams: 80000, answer: 'Ready in bay 2' }, 'Saima'), f.call('/erp/stock/queries/answer', { id, availableGrams: 1 }, 'Sadia')]);
  assert.deepEqual(answers.map(r => r.status).sort(), [200, 409]);
  assert.equal(audits(f, 'stock_query.answered').length, 1);
  const mine = (await f.call('/erp/stock/queries', undefined, 'Sana')).data.queries;
  assert.equal(mine.length, 1); assert.equal(mine[0].status, 'answered'); assert.equal(mine[0].available_grams, answers.find(r => r.status === 200).data.query.available_grams);
  assert.ok([80000, 1].includes(mine[0].available_grams));
  assert.equal((await f.call('/erp/stock/queries/answer', { id, availableGrams: 5 }, 'Saima')).status, 409);
  assert.throws(() => f.sql.prepare("UPDATE stock_queries SET question='Edited' WHERE id=?").run(id), /answered/);
  // sales sees only its own queries
  f.sql.prepare("INSERT INTO stock_queries(id,workspace_id,product_id,question,status,created_by,created_at,updated_at) VALUES(?,?,?,?,'open',?,?,?)").run(uuid(), f.workspaceId, productId, 'Someone else asked', f.adminId, 1, 1);
  assert.equal((await f.call('/erp/stock/queries', undefined, 'Sana')).data.queries.length, 1);
  assert.equal((await f.call('/erp/stock/queries', undefined, 'Anas')).data.queries.length, 2);
});

test('an open stock query reminds supervisors after 24 hours, and stops once answered', async () => {
  const f = await fixture(), id = uuid();
  assert.equal((await f.call('/erp/stock/queries', { id, productId: await f.insertProduct(), question: 'How much is ready to ship?' }, 'Sana')).status, 201);
  assert.equal((await remindersScheduled(f.env, Date.now() + 3600000)).created, 0);
  assert.equal((await remindersScheduled(f.env, Date.now() + 25 * 3600000)).created, 2);
  assert.equal((await f.call('/erp/stock/queries/answer', { id, availableGrams: 0 }, 'Saima')).status, 200);
  assert.equal((await remindersScheduled(f.env, Date.now() + 50 * 3600000)).created, 0);
});

test('the supervisor report bundles confirmed rejections, escalations, adjustments and flagged items; admin reads it', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 20000 });
  const { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  assert.equal((await f.call('/erp/qc/rejections/decide', { inspectionId, decision: 'confirm' }, 'Saima')).status, 200);
  const adjustment = (await adjust(f, lotId, -1000)).data.adjustment;
  const from = Date.now() - 60000, to = Date.now() + 60000;
  const draft = (await f.call(`/erp/stock/reports/draft?from=${from}&to=${to}`, undefined, 'Saima')).data;
  assert.deepEqual([draft.confirmedRejections.length, draft.escalations.length, draft.adjustments.length], [1, 0, 1]);
  assert.equal(draft.confirmedRejections[0].id, inspectionId); assert.equal(draft.confirmedRejections[0].issues.length, 1);
  assert.deepEqual(draft.confirmedRejections[0].photos, []);
  assert.equal(draft.adjustments[0].id, adjustment.id);
  assert.deepEqual((await f.call(`/erp/stock/reports/draft?from=1&to=2`, undefined, 'Saima')).data.adjustments, []);
  assert.equal((await f.call(`/erp/stock/reports/draft?from=${to}&to=${from}`, undefined, 'Saima')).status, 422);
  assert.equal((await f.call(`/erp/stock/reports/draft?from=${from}&to=${to}`, undefined, 'Sana')).status, 403);
  const body = { id: uuid(), from, to, note: 'Weekly review', flagged: [{ objectType: 'inspection', objectId: inspectionId, note: 'Supplier shade drift again' }] };
  for (const bad of [{ flagged: [{ objectType: 'inspection', objectId: inspectionId, note: 'xx' }] }, { flagged: [{ objectType: 'inspection', objectId: uuid(), note: 'Not in this report' }] }, { flagged: Array(51).fill(body.flagged[0]) }])
    assert.equal((await f.call('/erp/stock/reports', { ...body, ...bad }, 'Saima')).status, 422);
  assert.equal((await f.call('/erp/stock/reports', body, 'Sana')).status, 403);
  assert.equal(count(f, 'supervisor_reports'), 0);
  assert.equal((await f.call('/erp/stock/reports', body, 'Saima')).status, 201);
  assert.equal((await f.call('/erp/stock/reports', body, 'Saima')).status, 200);
  assert.equal(count(f, 'supervisor_reports'), 1); assert.equal(audits(f, 'stock_report.submitted').length, 1);
  const listed = (await f.call('/erp/stock/reports', undefined, 'Anas')).data.reports;
  assert.equal(listed.length, 1); assert.equal(listed[0].content.confirmedRejections.length, 1); assert.equal(listed[0].flagged[0].objectId, inspectionId);
  assert.equal((await f.call('/erp/stock/reports', undefined, 'Saima')).data.reports.length, 1);
  assert.equal((await f.call('/erp/stock/reports', undefined, 'Sadia')).data.reports.length, 0);
  assert.equal((await f.call('/erp/stock/reports', undefined, 'Danish')).status, 403);
  const stored = one(f, 'SELECT * FROM supervisor_reports');
  assert.throws(() => f.sql.exec("UPDATE supervisor_reports SET note='Edited'"), /immutable report/);
  assert.throws(() => f.sql.exec('DELETE FROM supervisor_reports'), /immutable report/);
  assert.deepEqual(one(f, 'SELECT * FROM supervisor_reports'), stored);
});

test('the report covers the whole period with no per-category cap', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 2000 });
  assert.equal((await f.call('/erp/qc/rejections/decide', { inspectionId, decision: 'confirm' }, 'Saima')).status, 200);
  // 209 more confirmed rejections on the same lot enter the period faster than any cap.
  const saima = (await f.member('Saima')).user_id, issuedAt = Date.now(), rejections = [];
  for (let i = 0; i < 209; i++) {
    const id = crypto.randomUUID(), issue = crypto.randomUUID();
    f.sql.prepare("INSERT INTO qc_inspections(id,workspace_id,lot_id,accepted_milli,rejected_milli,note,status,created_by,created_at,updated_at) VALUES(?,?,(SELECT id FROM qc_lots LIMIT 1),0,400,'','draft','q',?,?)").run(id, f.workspaceId, issuedAt, issuedAt);
    f.sql.prepare("INSERT INTO qc_issues(id,workspace_id,inspection_id,type,severity,description,created_by,created_at,updated_at) VALUES(?,?,?,'Shade variation','major','Dye lot differs from the approved sample','q',?,?)").run(issue, f.workspaceId, id, issuedAt, issuedAt);
    f.sql.prepare("UPDATE qc_inspections SET status='submitted',rejection_status='pending',submitted_at=?,updated_at=? WHERE id=?").run(issuedAt, issuedAt, id);
    f.sql.prepare("UPDATE qc_inspections SET rejection_status='confirmed',rejection_reason='Slight shade variation confirmed',decided_by=?,decided_at=?,updated_at=? WHERE id=?").run(saima, issuedAt + 100 + i, issuedAt + 100 + i, id);
    rejections.push(id);
  }
  const finishedLot = await f.addFinished({ grams: 10000 }), adjustments = [];
  for (let i = 0; i < 205; i++) adjustments.push((await adjust(f, finishedLot, -1)).data.adjustment.id);
  const draft = (await f.call('/erp/stock/reports/draft?from=1&to=' + (issuedAt + 600000), undefined, 'Saima')).data;
  assert.equal(draft.confirmedRejections.length, 210, 'every rejected inspection is listed');
  assert.deepEqual(draft.confirmedRejections.slice(1).map(r => r.id), rejections, 'the seeded 209, in period order');
  assert.equal(draft.confirmedRejections[0].id, inspectionId);
  assert.equal(draft.adjustments.length, 205, 'every adjustment is listed');
  // Flagging the items beyond the old category cap works, so nothing is silently omitted.
  const body = { id: uuid(), from: 1, to: issuedAt + 600000, flagged: [{ objectType: 'inspection', objectId: rejections[200], note: 'Two hundredth entry onwards' }, { objectType: 'adjustment', objectId: adjustments[200], note: 'Adjustment past the old cap' }] };
  const saved = await f.call('/erp/stock/reports', body, 'Saima');
  assert.equal(saved.status, 201);
  assert.equal(saved.data.report.content.confirmedRejections.length, 210);
  assert.equal(saved.data.report.content.adjustments.length, 205);
  assert.deepEqual(saved.data.report.flagged.map(x => x.objectId), [rejections[200], adjustments[200]]);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM supervisor_reports').n, 1);
});

test('the report counts escalated rejections', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  assert.equal((await f.call('/erp/qc/rejections/decide', { inspectionId, decision: 'escalate' }, 'Saima')).status, 200);
  const draft = (await f.call(`/erp/stock/reports/draft?from=1&to=${Date.now() + 1000}`, undefined, 'Saima')).data;
  assert.deepEqual([draft.confirmedRejections.length, draft.escalations.length], [0, 1]);
});

test("decision history lists only the supervisor's own decisions", async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 20000 }), saima = (await f.member('Saima')).user_id, sadia = (await f.member('Sadia')).user_id;
  await adjust(f, lotId, -100, { reason: 'Saima counted a short carton' }, 'Saima');
  await adjust(f, lotId, -200, { reason: 'Sadia found a torn bag' }, 'Sadia');
  await adjust(f, lotId, -300, { reason: 'Sadia found another one' }, 'Sadia');
  const mine = async as => (await f.call('/erp/stock/history', undefined, as)).data.history;
  const a = await mine('Saima'), b = await mine('Sadia');
  assert.ok(a.length >= 2 && b.length >= 2);
  assert.ok(a.every(r => r.actor_id === saima) && b.every(r => r.actor_id === sadia));
  assert.deepEqual([a, b].map(rows => rows.filter(r => r.action === 'inventory.adjusted').length), [1, 2]);
  assert.equal((await f.call('/erp/stock/history', undefined, 'Sana')).status, 403);
});

test('the stock ledger stays immutable', async () => {
  const f = await fixture(); await f.addFinished({ grams: 10000 });
  const snapshot = tables(f);
  assert.ok(snapshot.movements.length && snapshot.stock_deltas.length);
  assert.throws(() => f.sql.exec('DELETE FROM movements'), /immutable/);
  assert.deepEqual(tables(f), snapshot);
  assert.throws(() => f.sql.exec('UPDATE stock_deltas SET grams = 1'), /immutable/);
  assert.deepEqual(tables(f), snapshot);
});

test('all legacy stage balances remain readable but new writes use raw or finished', async () => {
  const f = await fixture(), productId = await f.insertProduct(), lotId = uuid();
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,?,?,?)").run(lotId, f.workspaceId, productId, 'LEGACY', 'Old mill', 'approved', Date.now());
  for (const [stage, amount] of [['raw', 1000], ['cops', 2000], ['wip', 3000], ['finished', 4000]]) {
    const id = uuid();
    f.sql.prepare("INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,request_hash,created_at) VALUES(?,?,?,'receive',NULL,?,?,0,0,'Old','x','Old',?,?)").run(id, f.workspaceId, lotId, stage, amount, id, Date.now());
    f.sql.prepare('INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,0,0)').run(uuid(), id, lotId, stage, amount);
  }
  for (const as of ['Saima', 'Anas']) {
    const lot = (await f.call('/erp/stock', undefined, as)).data.lots.find(l => l.id === lotId);
    assert.deepEqual([lot.raw_grams, lot.cops_grams, lot.wip_grams, lot.finished_grams, lot.legacyReadOnly, lot.batch, lot.product_name != null, lot.inventory_type, lot.source], [1000, 2000, 3000, 4000, true, 'LEGACY', true, null, null], as);
  }
  const before = all(f, 'SELECT * FROM balances ORDER BY stage');
  for (const stage of ['cops', 'wip']) {
    const refused = await adjust(f, lotId, -100, { stage });
    assert.equal(refused.status, 422); assert.equal(refused.data.error, 'Legacy cops/WIP stock is read-only; an authorized migration is required.');
  }
  assert.equal((await adjust(f, lotId, -100, { stage: 'packed' })).status, 422);
  for (const action of ['transfer', 'waste']) assert.equal((await f.call('/movements', { id: uuid(), lotId, action, stage: 'cops', toStage: 'raw', grams: 100, cartons: 0, cones: 0, note: 'x' }, 'Anas')).status, 404);
  assert.deepEqual(all(f, 'SELECT * FROM balances ORDER BY stage'), before); assert.equal(count(f, 'inventory_adjustments'), 0);
  // raw legacy stock is adjustable through the new route
  assert.equal((await adjust(f, lotId, -100, { stage: 'raw' })).status, 201); assert.equal(grams(f, lotId, 'raw'), 900);
  const stock = (await f.call('/erp/stock', undefined, 'Saima')).data.lots.find(l => l.id === lotId);
  assert.equal(stock.raw_grams, 900); assert.equal(stock.cops_grams, 2000);
});

test('supervisors read threshold previews without admin settings access', async () => {
  const f = await fixture();
  assert.deepEqual((await f.call('/erp/stock', undefined, 'Saima')).data.adjustmentThreshold, { value: null, unit: 'grams' });
  f.setThreshold('inventory_adjustment', 10000);
  for (const as of ['Saima', 'Anas']) assert.deepEqual((await f.call('/erp/stock', undefined, as)).data.adjustmentThreshold, { value: 10000, unit: 'grams' });
  assert.equal((await f.call('/erp/admin/thresholds', undefined, 'Saima')).status, 403);
  for (const as of ['Danish', 'Sana', 'Qasim', 'Pervaiz']) assert.equal((await f.call('/erp/stock', undefined, as)).status, 403, as);
});

test('reasoned admin compensation preserves the original decision', async () => {
  const f = await fixture(), lotId = await f.addFinished({ grams: 20000 });
  f.setThreshold('inventory_adjustment', 5000);
  const first = (await adjust(f, lotId, -1000)).data.adjustment;
  const original = one(f, 'SELECT * FROM inventory_adjustments WHERE id=?', first.id), originalAudit = audits(f, 'inventory.adjusted');
  const fix = { id: uuid(), lotId, stage: 'finished', kind: 'adjustment', deltaGrams: 1000, compensatesId: first.id, reason: 'Recount showed nothing was lost', interventionReason: 'Supervisor is away today' };
  assert.equal((await f.call('/erp/stock/adjustments', { ...fix, reason: undefined }, 'Anas')).status, 422);
  assert.equal((await f.call('/erp/stock/adjustments', { ...fix, interventionReason: undefined }, 'Anas')).status, 422);
  assert.equal((await f.call('/erp/stock/adjustments', { ...fix, compensatesId: uuid() }, 'Anas')).status, 404);
  assert.equal(count(f, 'inventory_adjustments'), 1);
  const done = await f.call('/erp/stock/adjustments', fix, 'Anas');
  assert.equal(done.status, 201); assert.equal(done.data.adjustment.compensates_id, first.id);
  assert.equal(grams(f, lotId), 20000);
  assert.deepEqual(one(f, 'SELECT * FROM inventory_adjustments WHERE id=?', first.id), original);
  const events = audits(f, 'inventory.adjusted'); assert.equal(events.length, 2);
  assert.deepEqual(events[0], originalAudit[0]);
  const link = events[1]; assert.equal(link.intervention_reason, 'Supervisor is away today'); assert.equal(JSON.parse(link.detail_json).compensates, first.id); assert.notEqual(link.record_id, events[0].record_id);
  // normal thresholds still apply to a compensation
  const big = await f.call('/erp/stock/adjustments', { ...fix, id: uuid(), deltaGrams: 6000, compensatesId: first.id }, 'Anas');
  assert.equal(big.status, 202); assert.equal(grams(f, lotId), 20000);
  const request = one(f, 'SELECT * FROM approval_requests WHERE id=?', big.data.approvalId);
  assert.equal((await decide(f, request.id, 'approve', undefined, 'Fahad')).status, 200); assert.equal(grams(f, lotId), 26000);
  const last = audits(f, 'inventory.adjusted').at(-1); assert.equal(last.intervention_reason, 'Supervisor is away today'); assert.equal(JSON.parse(last.detail_json).compensates, first.id);
});

test('the superseded stock writes are closed and the catalogue belongs to supervisor and purchasing', async () => {
  const f = await fixture(), productId = await f.insertProduct(), lotId = await f.addFinished({ grams: 5000 }), before = tables(f);
  for (const as of ['Anas', 'Saima', 'Danish']) {
    assert.equal((await f.call('/lots', { productId, batch: 'NEW-' + as, supplier: '' }, as)).status, 404, as);
    for (const action of ['transfer', 'waste', 'receive']) assert.equal((await f.call('/movements', { id: uuid(), lotId, action, stage: 'finished', toStage: 'raw', grams: 100, cartons: 0, cones: 0, note: 'x' }, as)).status, 404, `${as} ${action}`);
    assert.equal((await f.call('/reversals', { id: uuid(), movementId: before.movements[0].id, note: 'Undo it' }, as)).status, 404, as);
    for (const route of ['/quality', '/inspections']) assert.equal((await f.call(route, { id: uuid(), lotId }, as)).status, 404, `${as} ${route}`);
    assert.equal((await f.call('/photos', {}, as)).status, 404, as);
    assert.equal((await f.call('/erp/stock/raw', { id: uuid(), productId, batch: 'R', grams: 1000 }, as)).status, 404, as);
  }
  assert.deepEqual(tables(f), before);
  assert.equal((await f.call('/products', { sku: 'A', name: 'Material A' }, 'Saima')).status, 201);
  assert.equal((await f.call('/products', { sku: 'B', name: 'Material B' }, 'Pervaiz')).status, 201);
  for (const as of ['Qasim', 'Sana', 'Danish']) assert.equal((await f.call('/products', { sku: 'C', name: 'Material C' }, as)).status, 403, as);
  assert.equal((await f.call('/products', { sku: 'D', name: 'Material D' }, 'Anas')).status, 422);
  assert.equal((await f.call('/products', { sku: 'D', name: 'Material D', interventionReason: 'Supervisor is away today' }, 'Anas')).status, 201);
  assert.equal((await f.call('/movements', { id: uuid(), lotId, action: 'dispatch', stage: 'finished', grams: 100, cartons: 0, cones: 0, note: 'Temporary path' }, 'Danish')).status, 404, 'immediate dispatch is closed');
});

test('0015 applies before or after the later migrations and keeps every row', () => {
  const names = readdirSync(dir).filter(f => f.endsWith('.sql') && f >= '0004').sort();
  for (const order of [names, [...names.filter(f => f !== '0015_stock.sql'), '0015_stock.sql']]) {
    const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON'); migrate(sql, legacyMigrations); liveShapedRows(sql);
    const balances = sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY 1,2').all(), movements = sql.prepare('SELECT COUNT(*) AS n FROM movements').get().n;
    migrate(sql, order);
    assert.deepEqual(sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY 1,2').all(), balances);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM movements').get().n, movements);
    for (const table of ['inventory_adjustments', 'stock_queries', 'supervisor_reports']) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  }
});
