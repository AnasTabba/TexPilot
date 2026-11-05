import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture, jpeg } from './portal-fixture.mjs';

// Reversible QC corrections: arrivals, drafts, reopened inspections, undone decisions and voided photos.
async function fixture() {
  const f = await portalFixture();
  for (const [name, role] of [['Pervaiz', 'purchase_manager'], ['Qasim', 'quality_inspector'], ['Saima', 'supervisor']]) await f.person(name, role);
  f.supplierId = await f.insertSupplier({ status: 'approved' });
  Object.assign(f, await f.insertPO({ supplierId: f.supplierId, quantityMilli: 1000000 }), { productId: await f.insertProduct() });
  return f;
}
let serial = 0;
const uuid = () => crypto.randomUUID();
const arrive = (f, extra = {}, as = 'Pervaiz') => f.call('/erp/qc/lots', { id: uuid(), orderId: f.orderId, shipmentId: f.shipmentId, productId: f.productId, reference: `REV-${++serial}`, quantityMilli: 100000, arrivedAt: Date.now() - 1000, ...extra }, as);
async function lotOf(f, extra) { const r = await arrive(f, extra); assert.equal(r.status, 201, r.text); return r.data.id; }
async function draft(f, lotId, acceptedMilli, rejectedMilli, as = 'Qasim') {
  const id = uuid(), r = await f.call('/erp/qc/inspections', { id, lotId, acceptedMilli, rejectedMilli }, as);
  assert.equal(r.status, 201, r.text); return id;
}
async function photo(f, inspectionId, as = 'Qasim') {
  const id = uuid(), r = await f.upload({ id, inspectionId }, as, jpeg); assert.equal(r.status, 201, r.text); return id;
}
async function issue(f, inspectionId, as = 'Qasim') {
  const id = uuid(), r = await f.call('/erp/qc/issues', { id, inspectionId, type: 'Shade variation', severity: 'major', description: 'Dye lot differs from the approved sample' }, as);
  assert.equal(r.status, 201, r.text); return id;
}
const submit = (f, id, as = 'Qasim') => f.call('/erp/qc/inspections/submit', { id }, as);
// A submitted inspection with the evidence its quantities need.
async function submitted(f, accepted = 80000, rejected = 20000, lotId) {
  lotId ??= await lotOf(f);
  const id = await draft(f, lotId, accepted, rejected);
  if (accepted) await photo(f, id);
  if (rejected) await issue(f, id);
  assert.equal((await submit(f, id)).status, 200);
  return { id, lotId };
}
const row = (f, table, id) => f.sql.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const po = f => f.sql.prepare('SELECT status FROM supplier_purchase_orders WHERE id=?').get(f.orderId).status;
const rawGrams = (f, lotId) => f.sql.prepare("SELECT COALESCE(SUM(grams),0) AS g FROM balances WHERE lot_id=? AND stage='raw'").get(lotId).g;
const corrections = (f, kind) => f.sql.prepare('SELECT COUNT(*) AS n FROM qc_corrections WHERE kind=?').get(kind).n;
const reportCorrection = (id, reason = 'Accepted by mistake') => ({ id: uuid(), inspectionId: id, reason });

test('an arrival entered wrongly is cancelled before any inspection, the PO goes back, and the arrival is recorded again', async () => {
  const f = await fixture(), lotId = await lotOf(f, { reference: 'TYPO-LOT', quantityMilli: 1000000 });
  assert.equal(po(f), 'received', 'the arrival covers the whole order');
  const cancel = { id: uuid(), lotId, reason: 'Quantity typed as 900000' };
  const cancelled = await f.call('/erp/qc/lots/cancel', cancel, 'Pervaiz');
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(po(f), 'accepted', 'the PO returns to the status it had before the arrival');
  assert.equal((await f.call('/erp/qc/lots/cancel', cancel, 'Pervaiz')).status, 200, 'the same cancellation is replayed');
  assert.equal((await f.call('/erp/qc/lots/cancel', { id: uuid(), lotId, reason: 'Another try' }, 'Pervaiz')).status, 409);
  assert.equal((await f.call('/workspace', undefined, 'Anas')).data.qcArrivals.some(a => a.id === lotId), false, 'a cancelled arrival is not waiting for inspection');
  const again = await arrive(f, { reference: 'TYPO-LOT', quantityMilli: 1000000 });
  assert.equal(again.status, 201, again.text);
  assert.equal(po(f), 'received');
  assert.equal(f.sql.prepare("SELECT reference FROM qc_lots WHERE id=?").get(lotId).reference.startsWith('cancelled:'), true, 'the history row keeps its place');
});

test('an arrival with a submitted inspection cannot be cancelled, and a draft must be deleted first', async () => {
  const f = await fixture(), { lotId } = await submitted(f);
  const refused = await f.call('/erp/qc/lots/cancel', { id: uuid(), lotId, reason: 'Wrong lot' }, 'Pervaiz');
  assert.equal(refused.status, 409); assert.match(refused.data.error, /submitted/);
  const openLot = await lotOf(f);
  await draft(f, openLot, 1000, 0);
  const withDraft = await f.call('/erp/qc/lots/cancel', { id: uuid(), lotId: openLot, reason: 'Wrong lot' }, 'Pervaiz');
  assert.equal(withDraft.status, 409); assert.match(withDraft.data.error, /draft/);
});

test('a submitted inspection is reopened while undecided, corrected and resubmitted', async () => {
  const f = await fixture(), { id } = await submitted(f, 80000, 20000);
  const reopened = await f.call('/erp/qc/inspections/reopen', { id: uuid(), inspectionId: id, reason: 'Accepted count was typed wrongly' }, 'Qasim');
  assert.equal(reopened.status, 200, reopened.text);
  assert.equal(reopened.data.status, 'draft'); assert.equal(reopened.data.submitted_at, null);
  assert.equal((await f.call('/erp/qc/inspections/update', { id, acceptedMilli: 70000, rejectedMilli: 30000, note: 'Recounted' }, 'Qasim')).status, 200, 'a draft can be edited');
  const resubmitted = await submit(f, id);
  assert.equal(resubmitted.status, 200, resubmitted.text);
  assert.equal(resubmitted.data.accepted_milli, 70000); assert.equal(resubmitted.data.report_status, 'pending');
  assert.equal(corrections(f, 'inspection_reopened'), 1);
});

test('a QC correction request ID replays only the same action and reason', async () => {
  const f = await fixture(), { id: inspectionId } = await submitted(f, 10000, 0);
  const requestId = uuid(), original = { id: requestId, inspectionId, reason: 'Correct the inspection quantities' };
  assert.equal((await f.call('/erp/qc/inspections/reopen', original, 'Qasim')).status, 200);

  const differentAction = await f.call('/erp/qc/reports/undo', { ...original, reason: 'Undo an accepted report' }, 'Saima');
  assert.equal(differentAction.status, 409, differentAction.text);
  const differentReason = await f.call('/erp/qc/inspections/reopen', { ...original, reason: 'A different correction reason' }, 'Qasim');
  assert.equal(differentReason.status, 409, differentReason.text);
  assert.equal((await f.call('/erp/qc/inspections/reopen', original, 'Qasim')).status, 200, 'the exact request still replays');
  assert.equal(corrections(f, 'decision_undone'), 0, 'mismatched requests must not claim the report was undone');
});

test('a decided inspection cannot be reopened until the supervisor undoes the decision', async () => {
  const f = await fixture(), { id } = await submitted(f, 80000, 0);
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: id, decision: 'accept' }, 'Saima')).status, 200);
  const refused = await f.call('/erp/qc/inspections/reopen', { id: uuid(), inspectionId: id, reason: 'Late correction' }, 'Qasim');
  assert.equal(refused.status, 409); assert.match(refused.data.error, /undo the decision/);
});

test('an accepted report is undone: the receipt is reversed and the report waits for a decision again', async () => {
  const f = await fixture(), { id, lotId } = await submitted(f, 80000, 0);
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: id, decision: 'accept' }, 'Saima')).status, 200);
  assert.equal(rawGrams(f, lotId), 80000);
  const request = reportCorrection(id);
  const undone = await f.call('/erp/qc/reports/undo', request, 'Saima');
  assert.equal(undone.status, 200, undone.text);
  assert.equal(undone.data.report_status, 'pending');
  assert.equal(rawGrams(f, lotId), 0, 'the receipt is reversed');
  assert.equal(f.sql.prepare("SELECT status FROM qc_lots WHERE id=?").get(lotId).status, 'under_review');
  assert.equal((await f.call('/erp/qc/reports/undo', request, 'Saima')).status, 200, 'the same undo is replayed');
  assert.equal(rawGrams(f, lotId), 0, 'a replay reverses nothing twice');
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: id, decision: 'accept' }, 'Saima')).status, 200, 'the report can be accepted again');
  assert.equal(rawGrams(f, lotId), 80000);
});

test('an accepted report cannot be undone after its stock has moved on', async () => {
  const f = await fixture(), first = await submitted(f, 80000, 0);
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: first.id, decision: 'accept' }, 'Saima')).status, 200);
  const second = await submitted(f, 10000, 0, first.lotId);
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: second.id, decision: 'accept' }, 'Saima')).status, 200);
  const refused = await f.call('/erp/qc/reports/undo', reportCorrection(first.id), 'Saima');
  assert.equal(refused.status, 409); assert.match(refused.data.error, /already moved/);
  assert.equal(rawGrams(f, first.lotId), 90000, 'nothing was reversed');
});

test('a returned report and a dismissed rejection go back to pending; an undo needs a reason and the right role', async () => {
  const f = await fixture(), returned = await submitted(f, 80000, 0);
  assert.equal((await f.call('/erp/qc/reports/decide', { inspectionId: returned.id, decision: 'reject', reason: 'Shade is off' }, 'Saima')).status, 200);
  assert.equal((await f.call('/erp/qc/reports/undo', reportCorrection(returned.id), 'Saima')).data.report_status, 'pending');

  const rejected = await submitted(f, 50000, 50000);
  assert.equal((await f.call('/erp/qc/rejections/decide', { inspectionId: rejected.id, decision: 'dismiss', dismissOutcome: 're_inspect', reason: 'Inspect again' }, 'Saima')).status, 200);
  const request = { id: uuid(), inspectionId: rejected.id, reason: 'Dismissed by mistake' };
  const undone = await f.call('/erp/qc/rejections/undo', request, 'Saima');
  assert.equal(undone.status, 200, undone.text);
  assert.equal(undone.data.rejection_status, 'pending'); assert.equal(undone.data.dismiss_outcome, null);
  assert.equal(f.sql.prepare("SELECT status FROM qc_issues WHERE inspection_id=?").get(rejected.id).status, 'open');

  assert.equal((await f.call('/erp/qc/rejections/undo', { id: uuid(), inspectionId: rejected.id, reason: 'Wrong role' }, 'Qasim')).status, 403, 'an inspector cannot undo a supervisor decision');
  assert.equal((await f.call('/erp/qc/rejections/undo', { id: uuid(), inspectionId: rejected.id }, 'Saima')).status, 422, 'a reason is required');
});

test('a wrong role is refused with 403 and a missing reason with 422 on every correction', async () => {
  const f = await fixture(), { id, lotId } = await submitted(f, 80000, 0);
  assert.equal((await f.call('/erp/qc/inspections/reopen', { id: uuid(), inspectionId: id, reason: 'Wrong count' }, 'Pervaiz')).status, 403);
  assert.equal((await f.call('/erp/qc/lots/cancel', { id: uuid(), lotId, reason: 'Wrong lot' }, 'Qasim')).status, 403);
  assert.equal((await f.call('/erp/qc/reports/undo', { id: uuid(), inspectionId: id, reason: 'Wrong decision' }, 'Qasim')).status, 403);
  assert.equal((await f.call('/erp/qc/inspections/reopen', { id: uuid(), inspectionId: id }, 'Qasim')).status, 422);
  assert.equal((await f.call('/erp/qc/inspections/reopen', { id: uuid(), inspectionId: id, reason: 'ab' }, 'Qasim')).status, 422, 'a reason is at least 3 characters');
  assert.equal(corrections(f, 'inspection_reopened'), 0, 'refused corrections change nothing');
});

test('a voided photo is hidden from the inspection and not served; the submission then needs a new photo', async () => {
  const f = await fixture(), lotId = await lotOf(f), inspectionId = await draft(f, lotId, 80000, 0), wrong = await photo(f, inspectionId);
  const voidRequest = { id: uuid(), photoId: wrong, reason: 'Photo of the wrong bag' };
  const voided = await f.call('/erp/qc/photos/void', voidRequest, 'Qasim');
  assert.equal(voided.status, 200, voided.text);
  assert.equal((await f.call('/erp/qc/photos/void', voidRequest, 'Qasim')).status, 200, 'the void is replayed');
  assert.equal((await f.call('/erp/qc/photos/void', { id: uuid(), photoId: wrong, reason: 'Voided twice' }, 'Qasim')).status, 409);
  const listed = (await f.call('/erp/qc/inspections?mine=1', undefined, 'Qasim')).data.inspections.find(i => i.id === inspectionId);
  assert.equal(listed.photos.some(p => p.id === wrong), false, 'the report hides the voided photo');
  assert.equal((await f.call(`/erp/qc/photos/${wrong}`, undefined, 'Qasim')).status, 404, 'the voided photo is not served');
  const refused = await submit(f, inspectionId);
  assert.equal(refused.status, 422); assert.match(refused.data.error, /photo/);
  await photo(f, inspectionId);
  assert.equal((await submit(f, inspectionId)).status, 200);
  assert.equal(row(f, 'qc_photos', wrong).inspection_id, inspectionId, 'the photo row is kept');
});

test('a draft can be edited and deleted with its photos and issues; a submitted inspection cannot be deleted', async () => {
  const f = await fixture(), lotId = await lotOf(f), inspectionId = await draft(f, lotId, 40000, 0);
  assert.equal((await f.call('/erp/qc/inspections/update', { id: inspectionId, acceptedMilli: 60000, rejectedMilli: 0, note: 'Recounted' }, 'Qasim')).status, 200);
  assert.equal((await f.call('/erp/qc/inspections/update', { id: inspectionId, acceptedMilli: 200000, rejectedMilli: 0, note: '' }, 'Qasim')).status, 409, 'more than the uninspected quantity is refused');
  assert.equal((await f.call('/erp/qc/inspections/update', { id: inspectionId, acceptedMilli: 0, rejectedMilli: 0, note: '' }, 'Qasim')).status, 422, 'a draft needs a quantity');
  await photo(f, inspectionId);
  const deleted = await f.call('/erp/qc/inspections/delete', { id: inspectionId }, 'Qasim');
  assert.equal(deleted.status, 200, deleted.text);
  assert.equal(row(f, 'qc_inspections', inspectionId), undefined);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM qc_photos WHERE lot_id=?').get(lotId).n, 0);
  assert.equal(f.storage.size, 0, 'the stored photo is removed with the draft');
  const { id } = await submitted(f, 80000, 0);
  assert.equal((await f.call('/erp/qc/inspections/delete', { id }, 'Qasim')).status, 409);
});

test('a draft issue can be edited and removed, and an issue on a submitted inspection cannot', async () => {
  const f = await fixture(), lotId = await lotOf(f), inspectionId = await draft(f, lotId, 0, 100000), issueId = await issue(f, inspectionId);
  const edited = await f.call('/erp/qc/issues/update', { id: issueId, type: 'Dye spread', severity: 'critical', description: 'Patchy dye on every cone' }, 'Qasim');
  assert.equal(edited.status, 200, edited.text); assert.equal(edited.data.severity, 'critical');
  assert.equal((await f.call('/erp/qc/issues/delete', { id: issueId }, 'Qasim')).status, 200);
  assert.equal(row(f, 'qc_issues', issueId), undefined);
  const { id } = await submitted(f, 0, 100000);
  const sealed = f.sql.prepare("SELECT id FROM qc_issues WHERE inspection_id=?").get(id).id;
  assert.equal((await f.call('/erp/qc/issues/delete', { id: sealed }, 'Qasim')).status, 409);
});

test('undoing a confirmed rejection is refused because a claim was raised', async () => {
  const f = await fixture(), { id } = await submitted(f, 0, 100000);
  assert.equal((await f.call('/erp/qc/rejections/decide', { inspectionId: id, decision: 'confirm' }, 'Saima')).status, 200);
  const refused = await f.call('/erp/qc/rejections/undo', { id: uuid(), inspectionId: id, reason: 'Confirmed by mistake' }, 'Saima');
  assert.equal(refused.status, 409); assert.match(refused.data.error, /claim/);
});

test('a cancelled arrival cannot take a new inspection', async () => {
  const f = await fixture(), lotId = await lotOf(f);
  assert.equal((await f.call('/erp/qc/lots/cancel', { id: uuid(), lotId, reason: 'Duplicate entry' }, 'Pervaiz')).status, 200);
  const refused = await f.call('/erp/qc/inspections', { id: uuid(), lotId, acceptedMilli: 1000, rejectedMilli: 0 }, 'Qasim');
  assert.equal(refused.status, 409); assert.match(refused.data.error, /cancelled/);
});
