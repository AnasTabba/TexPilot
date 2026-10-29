import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { claimAmount } from '../server/quality.mjs';
import { remindersScheduled } from '../server/notify.mjs';
import { movementQueries } from '../server/stock-ledger.mjs';

const PEOPLE = [['Pervaiz', 'purchase_manager'], ['Qasim', 'quality_inspector'], ['Qadir', 'quality_inspector'], ['Saima', 'supervisor'], ['Sadia', 'supervisor'], ['Sara', 'sales_manager']];
async function fixture() {
  const f = await portalFixture();
  for (const [name, role] of PEOPLE) await f.person(name, role);
  for (const name of ['Anas', 'Fahad', ...PEOPLE.map(([name]) => name)]) await f.login(name); // sessions exist before any held write batch
  return f;
}
const report = (f, inspectionId, decision, extra = {}, as = 'Saima') => f.call('/erp/qc/reports/decide', { inspectionId, decision, ...extra }, as);
const rejection = (f, inspectionId, decision, extra = {}, as = 'Saima') => f.call('/erp/qc/rejections/decide', { inspectionId, decision, ...extra }, as);
const row = (f, table, id) => f.sql.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const count = (f, table, where = '1=1', ...args) => one(f, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...args).n;
const notified = (f, event, objectId) => f.sql.prepare('SELECT u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event=? AND (? IS NULL OR n.object_id=?) ORDER BY u.name').all(event, objectId ?? null, objectId ?? null).map(r => r.name);
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=?').all(action);
const raw = (f, lotId) => one(f, "SELECT grams FROM balances WHERE lot_id=? AND stage='raw'", lotId)?.grams ?? 0;
const open = (f, lotId) => one(f, 'SELECT open_milli FROM qc_lot_open WHERE lot_id=?', lotId).open_milli;
const claimOf = (f, inspectionId) => one(f, 'SELECT * FROM claims WHERE inspection_id=?', inspectionId);
const approvalOf = (f, objectId) => one(f, 'SELECT * FROM approval_requests WHERE object_id=?', objectId);
const decideApproval = (f, id, decision = 'approve', reason) => f.call('/erp/approvals/decide', { id, decision, ...(reason ? { reason } : {}) }, 'Anas');
const performance = async (f, supplierId) => (await f.call('/erp/suppliers/' + supplierId, undefined, 'Pervaiz')).data.performance;

test('claimAmount is the rejected quantity times the PO rate per whole unit', () => {
  assert.equal(claimAmount(20000, 125000), 2500000);
  assert.equal(claimAmount(333, 125), 42);
});

test('the supervisor accepts a report and the accepted quantity becomes QC-approved raw inventory', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  const reference = row(f, 'qc_lots', lotId).reference;
  const r = await report(f, inspectionId, 'accept');
  assert.equal(r.status, 200, r.text);
  assert.equal(raw(f, lotId), 80000);
  const lot = row(f, 'lots', lotId);
  assert.deepEqual([lot.quality, lot.inventory_type, lot.source, lot.batch], ['approved', 'raw', 'qc_lot', reference]);
  assert.equal(row(f, 'qc_inspections', inspectionId).report_status, 'accepted');
  assert.equal(count(f, 'movements', "lot_id=? AND action='receive'", lotId), 1);
  assert.deepEqual(notified(f, 'inspection.decided', inspectionId), ['Qasim']);
  assert.equal(audits(f, 'inspection_report.accepted').length, 1);
  assert.equal(row(f, 'qc_lots', lotId).status, 'under_review', 'the rejected side is still pending');
});

test('a tonne lot is received in grams', async () => {
  const f = await fixture(), supplierId = await f.insertSupplier({ status: 'approved' }), { orderId, shipmentId } = await f.insertPO({ supplierId, unit: 'tonne', quantityMilli: 5000 }), productId = await f.insertProduct();
  const lotId = crypto.randomUUID(), inspectionId = crypto.randomUUID();
  assert.equal((await f.call('/erp/qc/lots', { id: lotId, orderId, shipmentId, productId, reference: 'T-1', quantityMilli: 2000, arrivedAt: Date.now() - 1000 }, 'Pervaiz')).status, 201);
  await f.call('/erp/qc/inspections', { id: inspectionId, lotId, acceptedMilli: 1500, rejectedMilli: 0 }, 'Qasim');
  await f.upload({ id: crypto.randomUUID(), inspectionId }, 'Qasim');
  assert.equal((await f.call('/erp/qc/inspections/submit', { id: inspectionId }, 'Qasim')).status, 200);
  assert.equal((await report(f, inspectionId, 'accept')).status, 200);
  assert.equal(raw(f, lotId), 1500000, '1.5 tonne is 1,500,000 g');
});

test('a report rejection needs a reason and returns it for re-inspection', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  assert.equal((await report(f, inspectionId, 'reject')).status, 422);
  assert.equal((await report(f, inspectionId, 'reject', { reason: 'abc' })).status, 422);
  assert.equal(row(f, 'qc_inspections', inspectionId).report_status, 'pending');
  const r = await report(f, inspectionId, 'reject', { reason: 'Photos are too dark to judge shade' });
  assert.equal(r.status, 200, r.text);
  const inspection = row(f, 'qc_inspections', inspectionId);
  assert.deepEqual([inspection.report_status, inspection.report_reason], ['returned', 'Photos are too dark to judge shade']);
  assert.equal(open(f, lotId), 80000);
  assert.equal(count(f, 'movements'), 0); assert.equal(count(f, 'lots'), 0);
  assert.deepEqual(notified(f, 'inspection.decided', inspectionId), ['Qasim']);
  assert.equal(audits(f, 'inspection_report.rejected').length, 1);
  const again = await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId, acceptedMilli: 80000, rejectedMilli: 0 }, 'Qasim');
  assert.equal(again.status, 201, again.text);
});

test('a confirmed rejection below the claim threshold creates the claim at rejected quantity x PO rate', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  f.setThreshold('claim', 3000000);
  const r = await rejection(f, inspectionId, 'confirm');
  assert.equal(r.status, 200, r.text);
  const claim = claimOf(f, inspectionId);
  assert.deepEqual([claim.rejected_milli, claim.po_rate_minor, claim.calculated_minor, claim.status, claim.lot_id], [20000, 125000, 2500000, 'open', lotId]);
  assert.equal(row(f, 'qc_inspections', inspectionId).rejection_status, 'confirmed');
  assert.equal(one(f, 'SELECT status FROM qc_issues WHERE inspection_id=?', inspectionId).status, 'confirmed');
  assert.deepEqual(notified(f, 'claim.created', claim.id), ['Anas', 'Fahad', 'Pervaiz', 'Zuhair']);
  assert.equal(audits(f, 'rejection.confirmed').length, 1);
  assert.equal(count(f, 'approval_requests'), 0);
  assert.equal(raw(f, lotId), 0, 'nothing is received for the rejected quantity');
});

test('with no claim threshold configured the supervisor decision is final', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  assert.equal((await rejection(f, inspectionId, 'confirm')).status, 200);
  assert.equal(claimOf(f, inspectionId).status, 'open'); assert.equal(count(f, 'approval_requests'), 0);
});

test('at or above the claim threshold the claim waits for admin approval', async () => {
  const f = await fixture(); f.setThreshold('claim', 2500000);
  const a = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  assert.equal((await rejection(f, a.inspectionId, 'confirm')).status, 200);
  let claim = claimOf(f, a.inspectionId), approval = approvalOf(f, claim.id);
  assert.equal(claim.status, 'pending_approval');
  assert.deepEqual([approval.type, approval.amount, approval.threshold, approval.unit, approval.currency, approval.status], ['claim', 2500000, 2500000, 'minor', 'PKR', 'pending']);
  assert.ok(notified(f, 'claim.created', claim.id).includes('Pervaiz'));
  assert.equal((await f.call('/erp/approvals/' + approval.id, undefined, 'Anas')).data.object.evidence.claim.calculated_minor, 2500000);
  assert.equal((await decideApproval(f, approval.id)).status, 200);
  assert.equal(row(f, 'claims', claim.id).status, 'open');
  assert.equal(row(f, 'qc_inspections', a.inspectionId).rejection_status, 'confirmed');

  const b = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  await rejection(f, b.inspectionId, 'confirm');
  claim = claimOf(f, b.inspectionId); approval = approvalOf(f, claim.id);
  assert.equal((await decideApproval(f, approval.id, 'reject')).status, 422, 'a rejection needs a reason');
  assert.equal((await decideApproval(f, approval.id, 'reject', 'The supplier already credited this')).status, 200);
  assert.equal(row(f, 'claims', claim.id).status, 'rejected');
  assert.equal(row(f, 'qc_inspections', b.inspectionId).rejection_status, 'confirmed');
});

test('a dismissal needs a reason and an outcome', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  assert.equal((await rejection(f, inspectionId, 'dismiss', { dismissOutcome: 're_inspect' })).status, 422);
  assert.equal((await rejection(f, inspectionId, 'dismiss', { reason: 'Shade is within tolerance' })).status, 422);
  assert.equal((await rejection(f, inspectionId, 'dismiss', { reason: 'Shade is within tolerance', dismissOutcome: 'maybe' })).status, 422);
  assert.equal(row(f, 'qc_inspections', inspectionId).rejection_status, 'pending');
  const r = await rejection(f, inspectionId, 'dismiss', { reason: 'Shade is within tolerance', dismissOutcome: 'accept_with_deviation' });
  assert.equal(r.status, 200, r.text);
  assert.equal(raw(f, lotId), 20000);
  assert.match(one(f, "SELECT note FROM movements WHERE lot_id=? AND action='receive'", lotId).note, /Accepted with deviation: Shade is within tolerance/);
  assert.deepEqual(notified(f, 'inspection.decided', inspectionId), ['Qasim']);
  assert.equal(audits(f, 'rejection.dismissed').length, 1);
  assert.equal(count(f, 'claims'), 0);

  const g = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000, lotQuantityMilli: 20000 });
  assert.equal(open(f, g.lotId), 0);
  assert.equal((await rejection(f, g.inspectionId, 'dismiss', { reason: 'Re-check under daylight', dismissOutcome: 're_inspect' })).status, 200);
  assert.equal(open(f, g.lotId), 20000);
  assert.equal(raw(f, g.lotId), 0);
  assert.deepEqual(notified(f, 'inspection.decided', g.inspectionId), ['Qasim']);
});

test('escalation goes to admin: approval confirms with a claim, rejection dismisses for re-inspection', async () => {
  const f = await fixture(), a = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  assert.equal((await rejection(f, a.inspectionId, 'escalate')).status, 200);
  const approval = approvalOf(f, a.inspectionId);
  assert.deepEqual([approval.type, approval.amount, approval.unit, approval.object_type], ['escalation', 2500000, 'minor', 'qc_inspection']);
  assert.equal(row(f, 'qc_inspections', a.inspectionId).rejection_status, 'escalated');
  assert.equal(one(f, 'SELECT status FROM qc_issues WHERE inspection_id=?', a.inspectionId).status, 'escalated');
  assert.equal(audits(f, 'rejection.escalated').length, 1);
  assert.equal((await rejection(f, a.inspectionId, 'confirm')).status, 409, 'the supervisor cannot take an escalated rejection back');
  assert.equal(count(f, 'claims'), 0);
  assert.equal((await f.call('/erp/approvals/' + approval.id, undefined, 'Anas')).status, 200);
  assert.equal((await decideApproval(f, approval.id)).status, 200);
  assert.deepEqual([claimOf(f, a.inspectionId).status, row(f, 'qc_inspections', a.inspectionId).rejection_status], ['open', 'confirmed']);
  assert.equal(one(f, 'SELECT status FROM qc_issues WHERE inspection_id=?', a.inspectionId).status, 'confirmed');
  assert.ok(notified(f, 'claim.created').includes('Pervaiz'));

  const b = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000, lotQuantityMilli: 20000 });
  await rejection(f, b.inspectionId, 'escalate', { reason: 'Large quantity' });
  const second = approvalOf(f, b.inspectionId);
  assert.equal((await decideApproval(f, second.id, 'reject')).status, 422);
  assert.equal((await decideApproval(f, second.id, 'reject', 'Supplier sent the right shade')).status, 200);
  const inspection = row(f, 'qc_inspections', b.inspectionId);
  assert.deepEqual([inspection.rejection_status, inspection.dismiss_outcome, inspection.rejection_reason], ['dismissed', 're_inspect', 'Supplier sent the right shade']);
  assert.equal(open(f, b.lotId), 20000); assert.equal(one(f, 'SELECT status FROM qc_lots WHERE id=?', b.lotId).status, 'awaiting_inspection');
  assert.equal(one(f, 'SELECT status FROM qc_issues WHERE inspection_id=?', b.inspectionId).status, 'dismissed');
  assert.equal(count(f, 'claims'), 1);
});

test('the admin decides the outcome; an adjusted amount needs a reason and the log keeps both amounts', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  await rejection(f, inspectionId, 'confirm');
  const claim = claimOf(f, inspectionId);
  const decide = (body, as = 'Anas') => f.call('/erp/qc/claims/decide', { id: claim.id, ...body }, as);
  assert.equal((await decide({})).status, 422, 'an outcome is required');
  assert.equal((await decide({ outcome: 'refund' })).status, 422);
  assert.equal((await decide({ outcome: 'claim', adjustedMinor: 2000000 })).status, 422);
  assert.equal(row(f, 'claims', claim.id).status, 'open');
  const r = await decide({ outcome: 'claim', adjustedMinor: 2000000, reason: 'Supplier credited part in advance' });
  assert.equal(r.status, 200, r.text);
  const decided = row(f, 'claims', claim.id);
  assert.deepEqual([decided.status, decided.outcome, decided.adjusted_minor, decided.calculated_minor, decided.adjust_reason], ['decided', 'claim', 2000000, 2500000, 'Supplier credited part in advance']);
  const adjusted = audits(f, 'claim.adjusted')[0];
  assert.equal(adjusted.old_json, '{"amount":2500000}'); assert.equal(adjusted.new_json, '{"amount":2000000}');
  assert.equal(adjusted.reason, 'Supplier credited part in advance'); assert.equal(adjusted.actor_id, f.adminId);
  const made = audits(f, 'claim.decided')[0];
  assert.equal(made.old_json, '{"amount":2500000}'); assert.equal(made.new_json, '{"amount":2000000,"outcome":"claim"}');
  assert.ok(notified(f, 'claim.decided', claim.id).includes('Pervaiz'));
  assert.equal((await decide({ outcome: 'return' })).status, 409);
  assert.equal(audits(f, 'claim.decided').length, 1);
});

test('a claim waiting for approval cannot be decided', async () => {
  const f = await fixture(); f.setThreshold('claim', 1);
  const { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  await rejection(f, inspectionId, 'confirm');
  const claim = claimOf(f, inspectionId);
  assert.equal((await f.call('/erp/qc/claims/decide', { id: claim.id, outcome: 'return' }, 'Anas')).status, 409);
  assert.equal(row(f, 'claims', claim.id).status, 'pending_approval');
});

test('the purchase manager sees claim notices but cannot decide; claim lists are scoped by role', async () => {
  const f = await fixture(), a = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 }), b = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000, lotQuantityMilli: 20000 });
  await rejection(f, a.inspectionId, 'confirm'); await rejection(f, b.inspectionId, 'confirm');
  f.setThreshold('claim', 1);
  const c = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000, lotQuantityMilli: 20000 });
  await rejection(f, c.inspectionId, 'confirm');
  const [one_, two, three] = [a, b, c].map(x => claimOf(f, x.inspectionId));
  assert.equal((await f.call('/erp/qc/claims/decide', { id: one_.id, outcome: 'return' }, 'Anas')).status, 200);
  assert.deepEqual((await f.call('/erp/qc/claims', undefined, 'Pervaiz')).data.claims.map(x => x.id), [one_.id]);
  assert.deepEqual((await f.call('/erp/qc/claims', undefined, 'Anas')).data.claims.map(x => x.status).sort(), ['decided', 'open', 'pending_approval']);
  assert.equal((await f.call('/erp/qc/claims/' + one_.id, undefined, 'Pervaiz')).status, 200);
  assert.equal((await f.call('/erp/qc/claims/' + two.id, undefined, 'Pervaiz')).status, 404);
  assert.equal((await f.call('/erp/qc/claims/' + three.id, undefined, 'Anas')).data.claim.status, 'pending_approval');
  assert.equal((await f.call('/erp/qc/claims/decide', { id: two.id, outcome: 'return' }, 'Pervaiz')).status, 403);
  assert.equal((await f.call('/erp/qc/claims', undefined, 'Saima')).status, 403);
});

test('supervisor decisions are final for lower roles', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  assert.equal((await report(f, inspectionId, 'accept', {}, 'Qasim')).status, 403);
  assert.equal((await rejection(f, inspectionId, 'confirm', {}, 'Pervaiz')).status, 403);
  assert.equal((await f.call('/erp/qc/reports', undefined, 'Qasim')).status, 403);
  assert.equal((await report(f, inspectionId, 'accept')).status, 200);
  assert.equal((await report(f, inspectionId, 'accept')).status, 409);
  assert.equal((await report(f, inspectionId, 'reject', { reason: 'Changed my mind' })).status, 409);
  assert.equal((await report(f, inspectionId, 'accept', { extra: 1 })).status, 422, 'unexpected fields are refused');
  assert.equal(count(f, 'movements', "action='receive'"), 1);
  assert.equal((await report(f, crypto.randomUUID(), 'accept')).status, 404);
  assert.equal((await report(f, inspectionId, 'maybe')).status, 422);
});

test('an admin must give an intervention reason to decide as the supervisor', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId, decision: 'accept' }, 'Anas')).status, 422);
  const r = await f.call('/erp/qc/reports/decide', { inspectionId, decision: 'accept', interventionReason: 'Supervisor is away today' }, 'Anas');
  assert.equal(r.status, 200, r.text);
  assert.equal(audits(f, 'inspection_report.accepted')[0].intervention_reason, 'Supervisor is away today');
});

test('the lists show pending reports and rejections with their evidence to the supervisor', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  const reports = (await f.call('/erp/qc/reports', undefined, 'Saima')).data.reports;
  assert.deepEqual(reports.map(x => x.id), [inspectionId]); assert.equal(reports[0].photos.length, 1); assert.equal(reports[0].lot_reference.startsWith('LOT-'), true);
  const rejections = (await f.call('/erp/qc/rejections', undefined, 'Saima')).data.rejections;
  assert.deepEqual(rejections.map(x => x.id), [inspectionId]); assert.equal(rejections[0].issues.length, 1); assert.equal(rejections[0].claim_minor, 2500000);
  await report(f, inspectionId, 'accept');
  assert.deepEqual((await f.call('/erp/qc/reports', undefined, 'Saima')).data.reports, []);
  assert.equal((await f.call('/erp/qc/reports?status=accepted', undefined, 'Saima')).data.reports.length, 1);
  assert.equal((await f.call('/erp/qc/reports?status=other', undefined, 'Saima')).status, 422);
});

test('concurrent supervisor decisions have one complete effect', async () => {
  const f = await fixture(), a = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  const results = await Promise.all([report(f, a.inspectionId, 'accept'), report(f, a.inspectionId, 'reject', { reason: 'Photos are too dark to judge' }, 'Sadia')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const accepted = row(f, 'qc_inspections', a.inspectionId).report_status === 'accepted';
  assert.equal(count(f, 'movements'), accepted ? 1 : 0); assert.equal(raw(f, a.lotId), accepted ? 80000 : 0);
  assert.equal(audits(f, 'inspection_report.accepted').length + audits(f, 'inspection_report.rejected').length, 1);
  assert.equal(notified(f, 'inspection.decided', a.inspectionId).length, 1);

  const b = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  const rulings = await Promise.all([rejection(f, b.inspectionId, 'confirm'), rejection(f, b.inspectionId, 'dismiss', { reason: 'Within tolerance', dismissOutcome: 'accept_with_deviation' }, 'Sadia')]);
  assert.deepEqual(rulings.map(r => r.status).sort(), [200, 409]);
  const confirmed = row(f, 'qc_inspections', b.inspectionId).rejection_status === 'confirmed';
  assert.equal(count(f, 'claims', 'inspection_id=?', b.inspectionId), confirmed ? 1 : 0);
  assert.equal(raw(f, b.lotId), confirmed ? 0 : 20000);
  assert.equal(audits(f, 'rejection.confirmed').length + audits(f, 'rejection.dismissed').length, 1);
  assert.equal(notified(f, 'inspection.decided', b.inspectionId).length, 1);
});

// Starts `slow`, holds its write batch after it has read its view, lets `rival` commit completely, then releases the stale batch.
async function staleVersus(f, slow, rival) {
  const real = f.env.DB.batch; let release, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.env.DB.batch = async function (statements) { if (!held) { held = true; await gate; } return real.call(this, statements); };
  const stale = slow();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(held, 'the slow request reached its write');
  f.env.DB.batch = real;
  const winner = await rival();
  release();
  return [await stale, winner];
}
test('a stale confirm cannot override an escalation committed meanwhile', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  const [stale, winner] = await staleVersus(f, () => rejection(f, inspectionId, 'confirm', {}, 'Sadia'), () => rejection(f, inspectionId, 'escalate'));
  assert.deepEqual([winner.status, stale.status], [200, 409]);
  assert.equal(row(f, 'qc_inspections', inspectionId).rejection_status, 'escalated');
  assert.equal(count(f, 'claims'), 0); assert.equal(count(f, 'approval_requests', "type='escalation'"), 1);
  assert.equal(audits(f, 'rejection.confirmed').length, 0); assert.equal(notified(f, 'claim.created').length, 0);
});

test('a stale report acceptance leaves no receipt when the report was returned meanwhile', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  const [stale, winner] = await staleVersus(f, () => report(f, inspectionId, 'accept'), () => report(f, inspectionId, 'reject', { reason: 'Photos are too dark to judge' }, 'Sadia'));
  assert.deepEqual([winner.status, stale.status], [200, 409]);
  assert.deepEqual([count(f, 'movements'), count(f, 'lots'), count(f, 'stock_deltas'), raw(f, lotId)], [0, 0, 0, 0]);
  assert.equal(audits(f, 'inspection_report.accepted').length, 0);
});

test('a stale second claim decision changes nothing', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  await rejection(f, inspectionId, 'confirm');
  const id = claimOf(f, inspectionId).id;
  const [stale, winner] = await staleVersus(f, () => f.call('/erp/qc/claims/decide', { id, outcome: 'replacement' }, 'Fahad'), () => f.call('/erp/qc/claims/decide', { id, outcome: 'return' }, 'Anas'));
  assert.deepEqual([winner.status, stale.status], [200, 409]);
  assert.equal(row(f, 'claims', id).outcome, 'return'); assert.equal(audits(f, 'claim.decided').length, 1); assert.equal(notified(f, 'claim.decided', id).length, 1);
});

test('two admins deciding one claim leave a single decision', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  await rejection(f, inspectionId, 'confirm');
  const id = claimOf(f, inspectionId).id;
  const results = await Promise.all([f.call('/erp/qc/claims/decide', { id, outcome: 'return' }, 'Anas'), f.call('/erp/qc/claims/decide', { id, outcome: 'replacement' }, 'Fahad')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(audits(f, 'claim.decided').length, 1); assert.equal(notified(f, 'claim.decided', id).length, 1);
});

test('every direct and escalated disposition updates issues and lot availability', async () => {
  const f = await fixture();
  const issueStatus = id => one(f, 'SELECT status FROM qc_issues WHERE inspection_id=?', id).status;
  const lotStatus = id => one(f, 'SELECT status FROM qc_lots WHERE id=?', id).status;
  const told = id => notified(f, 'inspection.decided', id).length;
  const branch = async (decide, expected) => {
    const { lotId, inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000, lotQuantityMilli: 20000 });
    await decide(inspectionId);
    const actual = { issue: issueStatus(inspectionId), lot: lotStatus(lotId), open: open(f, lotId), told: told(inspectionId) };
    assert.deepEqual(actual, expected, JSON.stringify(expected));
    return { lotId, inspectionId };
  };
  await branch(id => rejection(f, id, 'confirm'), { issue: 'confirmed', lot: 'settled', open: 0, told: 1 });
  await branch(id => rejection(f, id, 'dismiss', { reason: 'Within tolerance', dismissOutcome: 'accept_with_deviation' }), { issue: 'dismissed', lot: 'settled', open: 0, told: 1 });
  await branch(id => rejection(f, id, 'dismiss', { reason: 'Look again please', dismissOutcome: 're_inspect' }), { issue: 'dismissed', lot: 'awaiting_inspection', open: 20000, told: 1 });
  await branch(id => rejection(f, id, 'escalate'), { issue: 'escalated', lot: 'under_review', open: 0, told: 1 });
  const approved = await branch(async id => { await rejection(f, id, 'escalate'); await decideApproval(f, approvalOf(f, id).id); }, { issue: 'confirmed', lot: 'settled', open: 0, told: 2 });
  assert.equal(claimOf(f, approved.inspectionId).status, 'open');
  await branch(async id => { await rejection(f, id, 'escalate'); await decideApproval(f, approvalOf(f, id).id, 'reject', 'Supplier sent the right shade'); }, { issue: 'dismissed', lot: 'awaiting_inspection', open: 20000, told: 2 });
  const { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  await report(f, inspectionId, 'reject', { reason: 'Photos are too dark to judge' });
  assert.deepEqual([lotStatus(lotId), open(f, lotId), told(inspectionId)], ['awaiting_inspection', 100000, 1]);
  const next = await f.submitted({ acceptedMilli: 100000, rejectedMilli: 0, lotId });
  await report(f, next.inspectionId, 'accept');
  assert.deepEqual([lotStatus(lotId), open(f, lotId), raw(f, lotId)], ['settled', 0, 100000]);
});

test('QC pass rate uses final lot disposition once', async () => {
  const first = async (f, accepted, rejected, lotQuantityMilli) => f.submitted({ acceptedMilli: accepted, rejectedMilli: rejected, lotQuantityMilli });
  let f = await fixture(); let s = await first(f, 100000, 0);
  assert.equal((await performance(f, s.supplierId)).qcPassRate, null, 'a pending lot is not counted');
  await report(f, s.inspectionId, 'accept');
  assert.equal((await performance(f, s.supplierId)).qcPassRate, 1, 'wholly accepted');
  f = await fixture(); s = await first(f, 0, 100000); await rejection(f, s.inspectionId, 'confirm');
  assert.equal((await performance(f, s.supplierId)).qcPassRate, 0, 'wholly rejected');
  f = await fixture(); s = await first(f, 80000, 20000); await report(f, s.inspectionId, 'accept');
  assert.equal((await performance(f, s.supplierId)).qcPassRate, null, 'half decided lots are not settled');
  await rejection(f, s.inspectionId, 'confirm');
  assert.equal((await performance(f, s.supplierId)).qcPassRate, 0.8, 'settled 80/20');
  f = await fixture(); s = await first(f, 100000, 0); await report(f, s.inspectionId, 'reject', { reason: 'Photos are too dark to judge' });
  assert.equal((await performance(f, s.supplierId)).qcPassRate, null, 'a returned quantity counts as neither');
  const again = await f.submitted({ acceptedMilli: 100000, rejectedMilli: 0, lotId: s.lotId }); await report(f, again.inspectionId, 'accept');
  assert.equal((await performance(f, s.supplierId)).qcPassRate, 1, 'returned then re-inspected counts once');
  f = await fixture(); s = await first(f, 0, 20000, 20000); await rejection(f, s.inspectionId, 'dismiss', { reason: 'Within tolerance', dismissOutcome: 'accept_with_deviation' });
  assert.equal((await performance(f, s.supplierId)).qcPassRate, 1, 'deviation acceptance counts as accepted');
});

test('claim outcomes and the QC pass rate feed the supplier profile', async () => {
  const f = await fixture(), { inspectionId, supplierId, lotId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  await report(f, inspectionId, 'accept'); await rejection(f, inspectionId, 'confirm');
  assert.deepEqual((await performance(f, supplierId)).claims, { return: 0, replacement: 0, claim: 0 }, 'an open claim is not an outcome');
  await f.call('/erp/qc/claims/decide', { id: claimOf(f, inspectionId).id, outcome: 'claim' }, 'Anas');
  const p = await performance(f, supplierId);
  assert.equal(p.qcPassRate, 0.8); assert.deepEqual(p.claims, { return: 0, replacement: 0, claim: 1 });
  assert.equal(p.onTimeRate, 1);
  assert.equal(p.ratingCount, 0); assert.equal(p.manualAverage, null);
});

test('the on-time rate is the share of lots that arrived by the promised delivery date', async () => {
  const f = await fixture(), supplierId = await f.insertSupplier({ status: 'approved' }), productId = await f.insertProduct();
  const arrive = async deliveryAt => {
    const { orderId, shipmentId } = await f.insertPO({ supplierId, deliveryAt });
    assert.equal((await f.call('/erp/qc/lots', { id: crypto.randomUUID(), orderId, shipmentId, productId, reference: 'R-' + crypto.randomUUID().slice(0, 6), quantityMilli: 1000, arrivedAt: Date.now() - 1000 }, 'Pervaiz')).status, 201);
  };
  assert.equal((await performance(f, supplierId)).onTimeRate, null, 'no lots yet');
  await arrive(Date.now() + 86400000); await arrive(Date.now() - 86400000); await arrive(Date.now() + 86400000);
  assert.equal((await performance(f, supplierId)).onTimeRate, 2 / 3);
});

test('a conflicting legacy batch cannot create a QC receipt', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  const lot = row(f, 'qc_lots', lotId);
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,'Mill','uninspected',?)").run(crypto.randomUUID(), f.workspaceId, lot.product_id, lot.reference, Date.now());
  const before = [count(f, 'lots'), count(f, 'movements'), count(f, 'balances'), count(f, 'erp_audit_events'), count(f, 'notifications', "event='inspection.decided'")];
  const r = await report(f, inspectionId, 'accept');
  assert.equal(r.status, 409, r.text);
  assert.deepEqual([count(f, 'lots'), count(f, 'movements'), count(f, 'balances'), count(f, 'erp_audit_events'), count(f, 'notifications', "event='inspection.decided'")], before);
  assert.equal(row(f, 'qc_inspections', inspectionId).report_status, 'pending');
  assert.equal(row(f, 'qc_lots', lotId).status, 'under_review');
});

test('an existing lot row that is not this QC lot blocks the receipt', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  const lot = row(f, 'qc_lots', lotId);
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,'Mill','uninspected',?)").run(lotId, f.workspaceId, lot.product_id, 'OTHER-BATCH', Date.now());
  assert.equal((await report(f, inspectionId, 'accept')).status, 409);
  assert.equal(count(f, 'movements'), 0); assert.equal(row(f, 'qc_inspections', inspectionId).report_status, 'pending');
});

test('a claim in another currency than the factory currency is refused without any effect', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 });
  f.sql.prepare("INSERT INTO settings(workspace_id,key,value_json,created_by,created_at,updated_by,updated_at) VALUES(?,'currency','\"USD\"',?,1,?,1)").run(f.workspaceId, f.adminId, f.adminId);
  const before = [count(f, 'erp_audit_events'), count(f, 'notifications')];
  for (const body of [() => rejection(f, inspectionId, 'confirm'), () => rejection(f, inspectionId, 'escalate')]) {
    const r = await body();
    assert.equal(r.status, 409); assert.equal(r.data.error, 'PO currency differs from the configured factory currency.');
  }
  assert.deepEqual([count(f, 'erp_audit_events'), count(f, 'notifications')], before);
  assert.equal(row(f, 'qc_inspections', inspectionId).rejection_status, 'pending'); assert.equal(count(f, 'claims'), 0);
});

test('raw stock enters only through report decisions; the old receive and QC writes are closed to everyone', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  await report(f, inspectionId, 'accept');
  const before = [count(f, 'movements'), count(f, 'quality_events'), one(f, 'SELECT quality FROM lots WHERE id=?', lotId).quality];
  for (const as of ['Anas', 'Saima', 'Pervaiz']) {
    const received = await f.call('/movements', { id: crypto.randomUUID(), lotId, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: 'Old receipt' }, as);
    assert.equal(received.status, 410, as); assert.match(received.data.error, /\/api\/erp\/qc\/reports\/decide/);
    const quality = await f.call('/quality', { lotId, status: 'hold', note: 'Old QC toggle' }, as);
    assert.equal(quality.status, 410, as); assert.match(quality.data.error, /qc\/reports\/decide/);
  }
  assert.deepEqual([count(f, 'movements'), count(f, 'quality_events'), one(f, 'SELECT quality FROM lots WHERE id=?', lotId).quality], before);
  const movementId = one(f, "SELECT id FROM movements WHERE lot_id=? AND action='receive'", lotId).id;
  const undo = await f.call('/reversals', { id: crypto.randomUUID(), movementId, note: 'Wrong receipt' }, 'Anas');
  assert.equal(undo.status, 410, 'reversals are closed, so a decided inspection is never rewritten by reversing its receipt'); assert.equal(raw(f, lotId), 80000);
});

test('the claim table refuses rewrites at the database', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 0, rejectedMilli: 20000 });
  await rejection(f, inspectionId, 'confirm');
  const { id } = claimOf(f, inspectionId);
  for (const change of ['calculated_minor=1', 'rejected_milli=1', 'po_rate_minor=1']) assert.throws(() => f.sql.exec(`UPDATE claims SET ${change} WHERE id='${id}'`), /keeps its amount terms/, change);
  assert.throws(() => f.sql.exec(`UPDATE claims SET status='decided',outcome='claim',adjusted_minor=1,decided_by='x',decided_at=1 WHERE id='${id}'`), /reason required/);
  assert.throws(() => f.sql.exec(`UPDATE claims SET status='rejected' WHERE id='${id}'`), /Invalid claim status/);
  f.sql.exec(`UPDATE claims SET status='decided',outcome='claim',decided_by='x',decided_at=1 WHERE id='${id}'`);
  assert.throws(() => f.sql.exec(`UPDATE claims SET outcome='return' WHERE id='${id}'`), /final/);
  assert.throws(() => f.sql.exec(`DELETE FROM claims WHERE id='${id}'`), /audit trail/);
  assert.throws(() => f.sql.exec("INSERT INTO claims(id,workspace_id,lot_id,inspection_id,supplier_id,purchase_order_id,rejected_milli,po_rate_minor,calculated_minor,status,created_by,created_at,updated_at) SELECT 'c2',workspace_id,lot_id,id,'s','p',rejected_milli,1,1,'open','x',1,1 FROM qc_inspections LIMIT 1"));
});

test('pending reports, pending rejections and open claims remind their owners separately', async () => {
  const f = await fixture(), { inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 20000 }), later = Date.now() + 25 * 3600000;
  const reminders = () => f.sql.prepare("SELECT n.object_type,u.portal_role AS role FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event='reminder' ORDER BY n.object_type,u.name").all().map(r => `${r.object_type}:${r.role}`);
  assert.equal((await remindersScheduled(f.env, Date.now() + 3600000)).created, 0);
  await remindersScheduled(f.env, later);
  assert.deepEqual(reminders(), ['qc_inspection:supervisor', 'qc_inspection:supervisor', 'qc_rejection:supervisor', 'qc_rejection:supervisor']);
  await report(f, inspectionId, 'accept'); await rejection(f, inspectionId, 'confirm');
  f.sql.exec('DELETE FROM notifications'); // the reminder uniqueness is per episode; start counting afresh
  await remindersScheduled(f.env, Date.now() + 49 * 3600000);
  assert.deepEqual(reminders(), ['claim:admin', 'claim:admin', 'claim:admin']);
});

test('the ledger builder refuses a movement whose delta disagrees and cannot overdraw a stage', async () => {
  const f = await fixture(), { lotId, inspectionId } = await f.submitted({ acceptedMilli: 80000, rejectedMilli: 0 });
  await report(f, inspectionId, 'accept');
  const member = await f.member('Anas'), now = Date.now();
  for (const bad of [{ action: 'receive', deltaGrams: -1 }, { action: 'dispatch', deltaGrams: 1 }, { action: 'receive', deltaGrams: 0 }, { action: 'receive', deltaGrams: 1.5 }, { action: 'transfer', deltaGrams: 1 }, { action: 'receive', deltaGrams: 1, stage: 'shelf' }])
    assert.throws(() => movementQueries(f.env.DB, member, { lotId, stage: 'raw', ...bad }, now), /disagree/, JSON.stringify(bad));
  const withdraw = movementQueries(f.env.DB, member, { lotId, action: 'waste', stage: 'raw', deltaGrams: -80001, note: 'Too much' }, now);
  assert.equal(withdraw.length, 2);
  await assert.rejects(() => f.env.DB.batch(withdraw));
  assert.deepEqual([count(f, 'movements'), raw(f, lotId)], [1, 80000], 'the failed batch left nothing behind');
  await f.env.DB.batch(movementQueries(f.env.DB, member, { lotId, action: 'waste', stage: 'raw', deltaGrams: -80000, note: 'Spoiled' }, now));
  assert.equal(raw(f, lotId), 0);
});
