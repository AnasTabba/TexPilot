import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture, jpeg } from './portal-fixture.mjs';
import { remindersScheduled } from '../server/notify.mjs';

async function fixture({ quantityMilli = 1000000 } = {}) {
  const f = await portalFixture();
  for (const [name, role] of [['Pervaiz', 'purchase_manager'], ['Qasim', 'quality_inspector'], ['Qadir', 'quality_inspector'], ['Saima', 'supervisor'], ['Sadia', 'supervisor'], ['Sara', 'sales_manager']]) await f.person(name, role);
  f.supplierId = await f.insertSupplier({ status: 'approved' });
  Object.assign(f, await f.insertPO({ supplierId: f.supplierId, quantityMilli }), { productId: await f.insertProduct() });
  return f;
}
let serial = 0;
const lotBody = (f, extra = {}) => ({ id: crypto.randomUUID(), orderId: f.orderId, shipmentId: f.shipmentId, productId: f.productId, reference: `LOT-${++serial}`, quantityMilli: 100000, arrivedAt: Date.now() - 1000, ...extra });
const arrive = (f, extra, as = 'Pervaiz') => { const body = lotBody(f, extra); return f.call('/erp/qc/lots', body, as).then(r => ({ ...r, body })); };
const lotOf = async (f, extra) => { const r = await arrive(f, extra); assert.equal(r.status, 201, r.text); return r.body.id; };
const draft = async (f, lotId, acceptedMilli, rejectedMilli, as = 'Qasim') => {
  const id = crypto.randomUUID(), r = await f.call('/erp/qc/inspections', { id, lotId, acceptedMilli, rejectedMilli }, as);
  assert.equal(r.status, 201, r.text); return id;
};
const photo = async (f, target, as = 'Qasim', bytes = jpeg) => { const id = crypto.randomUUID(), r = await f.upload({ id, ...target }, as, bytes); assert.equal(r.status, 201, r.text); return id; };
const issue = async (f, inspectionId, as = 'Qasim') => {
  const id = crypto.randomUUID(), r = await f.call('/erp/qc/issues', { id, inspectionId, type: 'Shade variation', severity: 'major', description: 'Dye lot differs from the approved sample' }, as);
  assert.equal(r.status, 201, r.text); return id;
};
const submit = (f, id, as = 'Qasim') => f.call('/erp/qc/inspections/submit', { id }, as);
// A submitted inspection with the evidence its quantities require.
async function submitted(f, accepted = 80000, rejected = 20000, lotId) {
  lotId ??= await lotOf(f);
  const id = await draft(f, lotId, accepted, rejected);
  if (accepted) await photo(f, { inspectionId: id });
  if (rejected) await issue(f, id);
  assert.equal((await submit(f, id)).status, 200);
  return { id, lotId };
}
const row = (f, table, id) => f.sql.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const count = (f, table, where = '1=1', ...args) => f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
const notified = (f, event, objectId) => f.sql.prepare('SELECT u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event=? AND (? IS NULL OR n.object_id=?) ORDER BY u.name').all(event, objectId ?? null, objectId ?? null).map(r => r.name);
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=?').all(action);
const po = f => f.sql.prepare('SELECT * FROM supplier_purchase_orders WHERE id=?').get(f.orderId);
const change = (f, quantityMilli, version = 1) => f.call('/erp/orders/quantity', { id: f.orderId, version, quantityMilli }, 'Pervaiz');
// A goods receipt written the way the retired receiving route did, to exercise the 0003 guard that 0013 replaced.
function legacyReceipt(f, quantity) {
  const id = crypto.randomUUID(), now = Date.now();
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,'Mill','uninspected',?)").run(id, f.workspaceId, f.productId, 'B' + id.slice(0, 6), now);
  f.sql.prepare("INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'receive',NULL,'raw',?,0,0,'Receipt','u','u',NULL,?,?)").run(id, f.workspaceId, id, quantity, id, now);
  return () => f.sql.prepare('INSERT INTO goods_receipts(id,workspace_id,purchase_order_id,product_id,lot_id,movement_id,quantity_milli,grams,supplier_lot,request_hash,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, f.workspaceId, f.orderId, f.productId, id, id, quantity, quantity, '', id, 'u', now);
}

test('the purchase manager registers an arrived lot linked to PO, shipment and supplier; inspectors are told', async () => {
  const f = await fixture({ quantityMilli: 100000 }), r = await arrive(f);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'awaiting_inspection'); assert.equal(r.data.supplier_id, f.supplierId); assert.equal(r.data.purchase_order_id, f.orderId); assert.equal(r.data.shipment_id, f.shipmentId); assert.equal(r.data.unit, 'kg');
  assert.ok(r.data.pending_since > 0);
  assert.deepEqual(notified(f, 'lot.ready'), ['Qadir', 'Qasim']);
  assert.equal(audits(f, 'lot.arrived').length, 1); assert.equal(po(f).status, 'received');
  assert.equal((await arrive(f, { quantityMilli: 1000 })).status, 409, 'the order is fully covered');
  assert.equal((await f.call('/erp/qc/lots', r.body, 'Pervaiz')).status, 200, 'an exact retry returns the same lot');
  assert.equal((await f.call('/erp/qc/lots', { ...r.body, quantityMilli: 90000 }, 'Pervaiz')).status, 409);
  assert.equal(count(f, 'qc_lots'), 1); assert.equal(audits(f, 'lot.arrived').length, 1);
  // only the purchase manager registers arrivals; an admin must give a reason
  assert.equal((await arrive(f, {}, 'Qasim')).status, 403);
  const own = await fixture({ quantityMilli: 100000 });
  assert.equal((await arrive(own, { quantityMilli: 1000 }, 'Anas')).status, 422);
  const stepped = await arrive(own, { quantityMilli: 1000, interventionReason: 'Purchase manager is away today' }, 'Anas');
  assert.equal(stepped.status, 201, stepped.text); assert.equal(audits(own, 'lot.arrived')[0].intervention_reason, 'Purchase manager is away today');
});

test('a lot must match its order: shipment, product, workspace, approval and unit', async () => {
  const f = await fixture(), other = await f.insertPO({ supplierId: f.supplierId });
  assert.equal((await arrive(f, { shipmentId: other.shipmentId })).status, 404, 'a shipment of another PO');
  assert.equal((await arrive(f, { orderId: crypto.randomUUID() })).status, 404);
  assert.equal((await arrive(f, { productId: crypto.randomUUID() })).status, 404);
  assert.equal((await arrive(f, { arrivedAt: Date.now() + 86400000 })).status, 422);
  f.sql.prepare("UPDATE supplier_purchase_orders SET approval_status='pending_admin' WHERE id=?").run(f.orderId);
  assert.equal((await arrive(f)).status, 409, 'a PO with a quantity change awaiting admin approval takes no arrivals');
  assert.throws(() => f.sql.prepare("INSERT INTO qc_lots(id,workspace_id,purchase_order_id,shipment_id,supplier_id,product_id,reference,quantity_milli,unit,arrived_at,pending_since,status,created_by,created_at,updated_at) VALUES('x',?,?,?,?,?,'U',1000,'tonne',1,1,'awaiting_inspection','u',1,1)")
    .run(f.workspaceId, f.orderId, f.shipmentId, f.supplierId, f.productId), /invalid lot/, 'unit must match the order');
  assert.equal(count(f, 'qc_lots'), 0);
});

test('the inspector records accepted and rejected quantity; partial acceptance is allowed', async () => {
  const f = await fixture(), lotId = await lotOf(f), id = crypto.randomUUID();
  const r = await f.call('/erp/qc/inspections', { id, lotId, acceptedMilli: 80000, rejectedMilli: 20000, note: 'Visible slubs' }, 'Qasim');
  assert.equal(r.status, 201, r.text); assert.equal(r.data.status, 'draft'); assert.equal(r.data.accepted_milli, 80000); assert.equal(r.data.rejected_milli, 20000); assert.equal(r.data.note, 'Visible slubs');
  assert.equal(row(f, 'qc_lots', lotId).status, 'under_review');
  assert.equal((await f.call('/erp/qc/inspections', { id, lotId, acceptedMilli: 80000, rejectedMilli: 20000, note: 'Visible slubs' }, 'Qasim')).status, 200);
  assert.equal((await f.call('/erp/qc/inspections', { id, lotId, acceptedMilli: 70000, rejectedMilli: 20000, note: 'Visible slubs' }, 'Qasim')).status, 409);
  const fresh = await lotOf(f, { quantityMilli: 1 });
  const big = await lotOf(f, { quantityMilli: 100000 });
  const over = await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId: big, acceptedMilli: 90000, rejectedMilli: 20000 }, 'Qasim');
  assert.equal(over.status, 409); assert.equal(over.data.error, 'More than the uninspected quantity.');
  assert.equal((await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId: big, acceptedMilli: 0, rejectedMilli: 0 }, 'Qasim')).status, 422);
  assert.equal((await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId: big, acceptedMilli: -1, rejectedMilli: 5 }, 'Qasim')).status, 422);
  // a second draft can take only what the first left open
  assert.equal((await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId, acceptedMilli: 1, rejectedMilli: 0 }, 'Qasim')).status, 409);
  assert.equal((await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId: fresh, acceptedMilli: 1, rejectedMilli: 0 }, 'Qasim')).status, 201);
  assert.equal((await f.call('/erp/qc/inspections', { id: crypto.randomUUID(), lotId, acceptedMilli: 1, rejectedMilli: 0 }, 'Pervaiz')).status, 403);
});

test('accepted quantity cannot be reported without a photo, and a rejection needs an issue', async () => {
  const f = await fixture(), lotId = await lotOf(f), id = await draft(f, lotId, 80000, 20000);
  let r = await submit(f, id);
  assert.equal(r.status, 422); assert.equal(r.data.error, 'Upload at least one photo of the accepted quantity.');
  const up = await f.upload({ id: crypto.randomUUID(), inspectionId: id });
  assert.equal(up.status, 201, up.text); assert.equal(typeof up.data.taken_at, 'number'); assert.equal(up.data.lot_id, lotId); assert.equal(up.data.inspection_id, id); assert.equal(up.data.object_key, undefined);
  r = await submit(f, id);
  assert.equal(r.status, 422); assert.equal(r.data.error, 'Describe at least one issue for the rejected quantity.');
  assert.equal(row(f, 'qc_inspections', id).status, 'draft');
  await issue(f, id);
  r = await submit(f, id);
  assert.equal(r.status, 200, r.text);
  const saved = row(f, 'qc_inspections', id);
  assert.equal(saved.status, 'submitted'); assert.equal(saved.report_status, 'pending'); assert.equal(saved.rejection_status, 'pending'); assert.ok(saved.submitted_at > 0);
  assert.deepEqual(notified(f, 'inspection.submitted', id), ['Sadia', 'Saima']);
  assert.equal(audits(f, 'inspection.submitted').length, 1); assert.equal(row(f, 'qc_lots', lotId).status, 'under_review');
  // a one-sided inspection has no pending decision on the empty side
  const onlyRejected = await draft(f, await lotOf(f, { quantityMilli: 10 }), 0, 10);
  await issue(f, onlyRejected); assert.equal((await submit(f, onlyRejected)).status, 200);
  assert.deepEqual([row(f, 'qc_inspections', onlyRejected).report_status, row(f, 'qc_inspections', onlyRejected).rejection_status], [null, 'pending']);
  assert.equal((await submit(f, id, 'Pervaiz')).status, 403);
});

test('photos are JPEG, PNG or WebP and attach only to draft inspections', async () => {
  const f = await fixture(), id = await draft(f, await lotOf(f), 80000, 20000), target = { inspectionId: id };
  const fake = await f.upload({ id: crypto.randomUUID(), ...target }, 'Qasim', new TextEncoder().encode('hello'), 'hello.jpg');
  assert.equal(fake.status, 422); assert.match(fake.data.error, /Unsupported photo/);
  const png = await f.upload({ id: crypto.randomUUID(), ...target }, 'Qasim', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]), 'a.png', 'image/png');
  const webp = await f.upload({ id: crypto.randomUUID(), ...target }, 'Qasim', new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '), 'a.webp', 'image/webp');
  assert.deepEqual([png.status, png.data.content_type, webp.status, webp.data.content_type], [201, 'image/png', 201, 'image/webp']);
  assert.equal((await f.upload({ id: crypto.randomUUID() })).status, 422, 'no target');
  assert.equal((await f.upload({ id: crypto.randomUUID(), inspectionId: id, issueId: crypto.randomUUID() })).status, 422, 'two targets');
  assert.equal((await f.upload({ id: crypto.randomUUID(), inspectionId: crypto.randomUUID() })).status, 404);
  assert.equal((await f.upload({ id: crypto.randomUUID(), ...target }, 'Pervaiz')).status, 403);
  // the bytes come back to people who may see them, and to nobody else
  const read = await f.call('/erp/qc/photos/' + png.data.id, undefined, 'Saima');
  assert.equal(read.status, 200); assert.equal(read.headers.get('content-type'), 'image/png');
  assert.equal((await f.call('/erp/qc/photos/' + png.data.id, undefined, 'Sara')).status, 403);
  assert.equal((await f.call('/erp/qc/photos/' + crypto.randomUUID(), undefined, 'Saima')).status, 404);
  await issue(f, id); assert.equal((await submit(f, id)).status, 200);
  const late = await f.upload({ id: crypto.randomUUID(), ...target });
  assert.equal(late.status, 409);
  assert.equal(count(f, 'qc_photos'), 2); assert.equal(f.storage.size, 2, 'the refused upload left no blob');
});

test('issue severity is minor, major or critical', async () => {
  const f = await fixture(), id = await draft(f, await lotOf(f), 50000, 50000);
  const send = (severity, extra = {}) => f.call('/erp/qc/issues', { id: crypto.randomUUID(), inspectionId: id, type: 'Neps', severity, description: 'Neps across the cone', ...extra }, 'Qasim');
  for (const severity of ['minor', 'major', 'critical']) assert.equal((await send(severity)).status, 201, severity);
  assert.equal((await send('severe')).status, 422);
  assert.equal((await send('minor', { type: 'x' })).status, 422);
  assert.equal((await send('minor', { description: 'bad' })).status, 422);
  assert.equal((await send('minor', { inspectionId: crypto.randomUUID() })).status, 404);
  const same = { id: crypto.randomUUID(), inspectionId: id, type: 'Neps', severity: 'minor', description: 'Neps across the cone' };
  assert.equal((await f.call('/erp/qc/issues', same, 'Qasim')).status, 201);
  assert.equal((await f.call('/erp/qc/issues', same, 'Qasim')).status, 200);
  assert.equal((await f.call('/erp/qc/issues', { ...same, severity: 'major' }, 'Qasim')).status, 409);
  await photo(f, { inspectionId: id }); assert.equal((await submit(f, id)).status, 200);
  assert.equal((await send('minor')).status, 409, 'issues attach only to a draft');
  assert.equal(count(f, 'qc_issues'), 4);
});

test('inspectors cannot add inventory or change catalogue items; the old receive and QC writes are closed', async () => {
  const f = await fixture();
  assert.equal((await f.call('/products', { sku: 'NEW', name: 'New material' }, 'Qasim')).status, 403);
  assert.equal((await f.call('/lots', { productId: f.productId, batch: 'B1', supplier: 'Mill' }, 'Qasim')).status, 404, 'batches are no longer created by hand');
  assert.equal((await f.call('/movements', { id: crypto.randomUUID(), lotId: crypto.randomUUID(), action: 'receive', stage: 'raw', grams: 1000 }, 'Qasim')).status, 404);
  const legacy = { id: crypto.randomUUID() };
  f.sql.prepare('INSERT INTO lots(id,workspace_id,product_id,batch,supplier,created_at) VALUES(?,?,?,?,?,?)').run(legacy.id, f.workspaceId, f.productId, 'OLD-1', 'Mill', Date.now());
  assert.equal((await f.call('/movements', { id: crypto.randomUUID(), lotId: legacy.id, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: '' }, 'Pervaiz')).status, 404, 'raw stock enters only through a report decision');
  assert.equal((await f.call('/quality', { lotId: legacy.id, status: 'approved', note: 'Inspector approves' }, 'Qasim')).status, 404);
  assert.equal((await f.call('/inspections', { id: crypto.randomUUID(), lotId: legacy.id, labelText: '', note: 'Looks fine', result: null }, 'Qasim')).status, 404);
  assert.equal((await f.call('/photos', { inspectionId: crypto.randomUUID() }, 'Qasim')).status, 404);
  assert.equal(count(f, 'movements'), 0); assert.equal(count(f, 'quality_events'), 0); assert.equal(count(f, 'inspections'), 0);
  assert.equal((await f.call('/movements', { id: crypto.randomUUID(), lotId: legacy.id, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: '' }, 'Anas')).status, 404, 'not even admins receive raw stock outside a report decision');
  assert.equal((await f.call('/erp/receipts', { id: crypto.randomUUID(), orderId: f.orderId, productId: f.productId, batch: 'R', quantityMilli: 1000 }, 'Anas')).status, 410);
});

test('a lot awaiting inspection over 24 hours reminds inspectors, and only while it awaits', async () => {
  const f = await fixture(), lotId = await lotOf(f), later = Date.now() + 25 * 3600000, day = 86400000;
  assert.equal((await remindersScheduled(f.env, Date.now() + 3600000)).created, 0);
  assert.equal((await remindersScheduled(f.env, later)).created, 2);
  assert.deepEqual(notified(f, 'reminder', lotId), ['Qadir', 'Qasim']);
  assert.equal((await remindersScheduled(f.env, later)).created, 0, 'one reminder per pending episode');
  const other = await lotOf(f, { quantityMilli: 100 });
  await draft(f, other, 100, 0);
  assert.equal((await remindersScheduled(f.env, later + day)).created, 0, 'a lot under review is not awaiting inspection');
});

test('submitted inspection terms and transitions are immutable', async () => {
  const f = await fixture(), { id, lotId } = await submitted(f);
  const before = row(f, 'qc_inspections', id), run = (sql, ...a) => f.sql.prepare(sql).run(...a);
  for (const [sql, message] of [
    ['UPDATE qc_inspections SET accepted_milli=70000 WHERE id=?', /frozen|keeps/], ['UPDATE qc_inspections SET rejected_milli=10000 WHERE id=?', /frozen|keeps/],
    ["UPDATE qc_inspections SET note='changed' WHERE id=?", /frozen|keeps/], ["UPDATE qc_inspections SET status='draft' WHERE id=?", /keeps/],
    ['UPDATE qc_inspections SET report_status=NULL WHERE id=?', /Invalid report/], ['UPDATE qc_inspections SET rejection_status=NULL WHERE id=?', /Invalid rejection/],
    ["UPDATE qc_inspections SET report_status='pending',report_reason='again' WHERE id=?", /already submitted or decided/], ['UPDATE qc_inspections SET submitted_at=1 WHERE id=?', /keeps/],
    ['UPDATE qc_inspections SET created_by=\'x\' WHERE id=?', /lot and author/], ["UPDATE qc_inspections SET workspace_id='x' WHERE id=?", /lot and author/],
    ["UPDATE qc_inspections SET updated_at=1 WHERE id=?", /already submitted or decided/], ['DELETE FROM qc_inspections WHERE id=?', /preserve/],
  ]) assert.throws(() => run(sql, id), message, sql);
  assert.throws(() => run('UPDATE qc_inspections SET lot_id=? WHERE id=?', lotId + 'x', id));
  assert.deepEqual(row(f, 'qc_inspections', id), before, 'every refused write left the snapshot unchanged');
  // the legal graph: each side decides once
  run("UPDATE qc_inspections SET report_status='accepted',report_reason='Checked',decided_by='s',decided_at=5,updated_at=5 WHERE id=?", id);
  assert.throws(() => run("UPDATE qc_inspections SET report_status='accepted',updated_at=6 WHERE id=?", id), /already submitted or decided|Invalid report/, 'a repeated decision aborts');
  assert.throws(() => run("UPDATE qc_inspections SET report_status='returned' WHERE id=?", id), /Invalid report/, 'no reverse transition');
  assert.throws(() => run("UPDATE qc_inspections SET rejection_status='dismissed' WHERE id=?", id), /dismissal records its outcome/);
  run("UPDATE qc_inspections SET rejection_status='escalated',rejection_reason='Large value',updated_at=7 WHERE id=?", id);
  assert.equal(row(f, 'qc_lots', lotId).status, 'under_review');
  assert.throws(() => run("UPDATE qc_inspections SET rejection_status='pending' WHERE id=?", id), /Invalid rejection/);
  assert.throws(() => run("UPDATE qc_inspections SET rejection_status='escalated',updated_at=8 WHERE id=?", id), /Invalid rejection|already submitted/);
  run("UPDATE qc_inspections SET rejection_status='dismissed',dismiss_outcome='re_inspect',rejection_reason='Re-inspect it',updated_at=9 WHERE id=?", id);
  assert.throws(() => run("UPDATE qc_inspections SET rejection_status='confirmed' WHERE id=?", id), /Invalid rejection/);
  assert.throws(() => run("UPDATE qc_inspections SET dismiss_outcome='accept_with_deviation' WHERE id=?", id), /dismissal records its outcome/);
  assert.equal(f.sql.prepare('SELECT open_milli FROM qc_lot_open WHERE lot_id=?').get(lotId).open_milli, 20000, 'a re-inspect dismissal frees its quantity');
  // evidence is frozen
  const evidence = f.sql.prepare('SELECT id FROM qc_photos WHERE inspection_id=?').get(id).id, issueId = f.sql.prepare('SELECT id FROM qc_issues WHERE inspection_id=?').get(id).id;
  assert.throws(() => run("UPDATE qc_photos SET size=1 WHERE id=?", evidence), /immutable/);
  assert.throws(() => run('DELETE FROM qc_photos WHERE id=?', evidence), /immutable/);
  assert.throws(() => run("UPDATE qc_issues SET description='Edited after the fact' WHERE id=?", issueId), /frozen/);
  assert.throws(() => run('DELETE FROM qc_issues WHERE id=?', issueId), /preserve/);
  assert.throws(() => run("UPDATE qc_issues SET status='open' WHERE id=?", issueId), /Invalid issue status/);
  run("UPDATE qc_issues SET status='escalated' WHERE id=?", issueId); run("UPDATE qc_issues SET status='confirmed' WHERE id=?", issueId);
  assert.throws(() => run("UPDATE qc_issues SET status='dismissed' WHERE id=?", issueId), /Invalid issue status/);
  assert.throws(() => run('UPDATE qc_lots SET quantity_milli=5 WHERE id=?', lotId), /keeps its arrival record/);
  assert.throws(() => run('DELETE FROM qc_lots WHERE id=?', lotId), /preserve/);
});

test('draft inspections recheck the reserved quantity when edited', async () => {
  const f = await fixture(), lotId = await lotOf(f), id = await draft(f, lotId, 60000, 0);
  f.sql.prepare('UPDATE qc_inspections SET accepted_milli=100000 WHERE id=?').run(id);
  assert.throws(() => f.sql.prepare('UPDATE qc_inspections SET accepted_milli=100001 WHERE id=?').run(id), /More than the uninspected quantity/);
  assert.throws(() => f.sql.prepare("UPDATE qc_inspections SET report_status='pending' WHERE id=?").run(id), /cannot hold a decision/);
  assert.throws(() => f.sql.prepare("UPDATE qc_inspections SET status='submitted',submitted_at=1,report_status='pending' WHERE id=?").run(id), /photo/);
  assert.throws(() => f.sql.prepare("UPDATE qc_inspections SET status='submitted',submitted_at=1 WHERE id=?").run(id), /photo|starts each side pending/);
});

test('two submissions emit one audit and notification set', async () => {
  const f = await fixture(), lotId = await lotOf(f), id = await draft(f, lotId, 80000, 20000);
  await photo(f, { inspectionId: id }); await issue(f, id);
  const results = await Promise.all([submit(f, id), submit(f, id)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(audits(f, 'inspection.submitted').length, 1);
  assert.deepEqual(notified(f, 'inspection.submitted', id), ['Sadia', 'Saima']);
  const saved = row(f, 'qc_inspections', id); assert.deepEqual([saved.report_status, saved.rejection_status], ['pending', 'pending']);
  // a stale submit batch aborts as a whole: no audit and no notification behind a losing guard
  await assert.rejects(f.env.DB.batch([f.env.DB.prepare("UPDATE qc_inspections SET status='submitted',submitted_at=9,updated_at=9,report_status='pending',rejection_status='pending' WHERE id=?").bind(id),
    f.env.DB.prepare("INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at) VALUES('late',?,?,'staff','inspection.submitted',?,'{}',1)").bind(f.workspaceId, f.adminId, id)]));
  assert.equal(audits(f, 'inspection.submitted').length, 1);
});

test('a photo racing a submission either lands before it or is refused and leaves no blob', async () => {
  const f = await fixture(), id = await draft(f, await lotOf(f), 0, 100000);
  await issue(f, id);
  const target = crypto.randomUUID();
  const [up, sent] = await Promise.all([f.upload({ id: target, inspectionId: id }), submit(f, id)]);
  assert.equal(sent.status, 200);
  assert.ok([201, 409].includes(up.status), up.text);
  assert.equal(count(f, 'qc_photos'), up.status === 201 ? 1 : 0); assert.equal(f.storage.size, count(f, 'qc_photos'));
});

test('identical photo bytes attach independently and retries are idempotent', async () => {
  const f = await fixture(), lotId = await lotOf(f, { quantityMilli: 100000 });
  const a = await draft(f, lotId, 30000, 0), b = await draft(f, lotId, 30000, 20000), x = await issue(f, b);
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const targets = [{ inspectionId: a }, { inspectionId: b }, { issueId: x }];
  for (const [i, id] of ids.entries()) assert.equal((await f.upload({ id, ...targets[i] })).status, 201, `attachment ${i}`);
  assert.equal(count(f, 'qc_photos'), 3); assert.equal(f.storage.size, 3);
  assert.equal(new Set(f.sql.prepare('SELECT content_hash FROM qc_photos').all().map(r => r.content_hash)).size, 1, 'same bytes, one digest');
  assert.equal(new Set(f.sql.prepare('SELECT object_key FROM qc_photos').all().map(r => r.object_key)).size, 3, 'three distinct blobs');
  assert.match(row(f, 'qc_photos', ids[2]).object_key, new RegExp(`^${f.workspaceId}/qc/${lotId}/issue/${ids[2]}/[0-9a-f]{64}$`));
  const retry = await f.upload({ id: ids[0], ...targets[0] });
  assert.equal(retry.status, 200); assert.equal(count(f, 'qc_photos'), 3); assert.equal(f.storage.size, 3);
  const altered = await f.upload({ id: ids[0], ...targets[0] }, 'Qasim', Uint8Array.from([...jpeg, 0]));
  assert.equal(altered.status, 409);
  assert.equal((await f.upload({ id: ids[0], ...targets[1] })).status, 409, 'the same id cannot move to another target');
  assert.equal(count(f, 'qc_photos'), 3); assert.equal(f.storage.size, 3);
  assert.equal((await f.upload({ id: crypto.randomUUID(), issueId: x }, 'Qasim', jpeg)).status, 201, 'an issue takes several photos');
  assert.equal((await f.call('/erp/qc/inspections?mine=1&status=draft', undefined, 'Qasim')).data.inspections.find(i => i.id === b).photos.length, 3, 'the inspection lists its own photo and its issue photos');
});

test('QC arrival and PO reduction cannot overbook the order', async () => {
  const f = await fixture({ quantityMilli: 100000 });
  const [arrival, reduction] = await Promise.all([arrive(f, { quantityMilli: 60000 }), change(f, 50000)]);
  assert.equal([arrival.status === 201, reduction.status === 200].filter(Boolean).length, 1, 'exactly one commits');
  assert.equal([arrival.status, reduction.status].filter(s => s === 409).length, 1);
  assert.equal(count(f, 'qc_lots'), arrival.status === 201 ? 1 : 0);
  assert.ok(po(f).quantity_milli >= f.sql.prepare('SELECT COALESCE(SUM(quantity_milli),0) AS n FROM qc_lots').get().n);
  assert.equal(po(f).quantity_milli, arrival.status === 201 ? 100000 : 50000);

  // delayed approval: the reduction waits for the admin, and the arrival meets either the pending hold or the reduced quantity
  const g = await fixture({ quantityMilli: 100000 });
  g.setThreshold('purchase', 1);
  const raised = await change(g, 50000); assert.equal(raised.status, 202);
  const request = g.sql.prepare("SELECT id FROM approval_requests WHERE type='po_change'").get().id;
  assert.equal((await arrive(g, { quantityMilli: 60000 })).status, 409, 'arrival is held while the change awaits approval');
  const [late, approved] = await Promise.all([arrive(g, { quantityMilli: 60000 }), g.call('/erp/approvals/decide', { id: request, decision: 'approve' }, 'Anas')]);
  assert.equal(approved.status, 200, approved.text); assert.equal(late.status, 409);
  assert.equal(po(g).quantity_milli, 50000); assert.equal(count(g, 'qc_lots'), 0);
  assert.equal((await arrive(g, { quantityMilli: 60000 })).status, 409, 'and still more than the reduced order');
  assert.equal((await arrive(g, { quantityMilli: 50000 })).status, 201);
});

test('the receipt guard and lots follow the PO quantity after an increase or a decrease', async () => {
  const f = await fixture({ quantityMilli: 100000 });
  await lotOf(f); assert.equal(po(f).status, 'received');
  assert.equal((await arrive(f, { quantityMilli: 1000 })).status, 409);
  assert.equal((await change(f, 150000)).status, 200);
  assert.equal(po(f).status, 'dispatched', 'an increase reopens a received order');
  assert.equal((await arrive(f, { quantityMilli: 30000 })).status, 201); assert.equal(po(f).status, 'dispatched', 'received only at the new quantity');
  assert.equal((await arrive(f, { quantityMilli: 20001 })).status, 409);
  assert.equal((await arrive(f, { quantityMilli: 20000 })).status, 201); assert.equal(po(f).status, 'received');

  const g = await fixture({ quantityMilli: 100000 });
  const insertLegacy = legacyReceipt(g, 80000);
  assert.equal((await change(g, 70000)).status, 200);
  assert.throws(insertLegacy, /invalid receipt quantity/, 'a receipt above the reduced quantity is refused');
  assert.equal((await change(g, 150000, 2)).status, 200);
  insertLegacy(); assert.equal(count(g, 'goods_receipts'), 1, 'a raised quantity admits the extra receipt');
  assert.equal((await arrive(g, { quantityMilli: 70001 })).status, 409, 'QC lots count the legacy receipt as arrived');
  assert.equal((await arrive(g, { quantityMilli: 70000 })).status, 201);
  assert.throws(() => g.sql.prepare('UPDATE supplier_purchase_orders SET quantity_milli=100000 WHERE id=?').run(g.orderId), /already arrived/, 'legacy and QC quantities both hold the floor');
});

test('lists filter by status and an inspector sees only their own drafts', async () => {
  const f = await fixture(), lotId = await lotOf(f);
  const lots = await f.call('/erp/qc/lots?status=under_review', undefined, 'Saima');
  assert.equal(lots.data.lots.length, 0);
  const mine = await draft(f, lotId, 10000, 0);
  assert.deepEqual((await f.call('/erp/qc/lots?status=under_review', undefined, 'Qasim')).data.lots.map(l => [l.id, l.open_milli, l.product_name.startsWith('Cotton')]), [[lotId, 90000, true]]);
  assert.equal((await f.call('/erp/qc/lots?status=bogus', undefined, 'Qasim')).status, 422);
  assert.equal((await f.call('/erp/qc/lots', undefined, 'Sara')).status, 403);
  assert.deepEqual((await f.call('/erp/qc/inspections?mine=1&status=draft', undefined, 'Qasim')).data.inspections.map(i => i.id), [mine]);
  assert.deepEqual((await f.call('/erp/qc/inspections?mine=1', undefined, 'Qadir')).data.inspections, []);
  assert.deepEqual((await f.call('/erp/qc/inspections?status=draft', undefined, 'Saima')).data.inspections.map(i => i.id), [mine]);
  assert.equal((await f.call('/erp/qc/inspections?status=nope', undefined, 'Qasim')).status, 422);
  assert.equal((await f.call('/erp/qc/inspections', undefined, 'Pervaiz')).status, 403);
});


test('draft issues cannot change disposition or timestamps', async () => {
  const f = await fixture(), inspectionId = await draft(f, await lotOf(f), 0, 100000), id = await issue(f, inspectionId);
  const before = row(f, 'qc_issues', id);
  for (const status of ['open', 'confirmed', 'dismissed', 'escalated']) {
    assert.throws(() => f.sql.prepare('UPDATE qc_issues SET status=?,updated_at=1 WHERE id=?').run(status, id), /Invalid issue status change/);
    assert.deepEqual(row(f, 'qc_issues', id), before);
  }
});

for (const [from, to] of [['open', 'confirmed'], ['open', 'dismissed'], ['open', 'escalated'], ['escalated', 'confirmed'], ['escalated', 'dismissed']]) {
  test(`submitted issue ${from} to ${to} commits once and a lost race rolls back the whole batch`, async () => {
    const f = await fixture(), inspectionId = await draft(f, await lotOf(f), 0, 100000), id = await issue(f, inspectionId);
    assert.equal((await submit(f, inspectionId)).status, 200);
    if (from === 'escalated') f.sql.prepare("UPDATE qc_issues SET status='escalated' WHERE id=?").run(id);
    const transition = () => f.env.DB.prepare('UPDATE qc_issues SET status=?,updated_at=2 WHERE id=?').bind(to, id);
    // Both callers saw the same starting state; the second unconditional update must abort.
    await f.env.DB.batch([transition()]);
    const before = row(f, 'qc_issues', id);
    assert.equal(before.status, to);
    const auditId = crypto.randomUUID();
    await assert.rejects(f.env.DB.batch([
      f.env.DB.prepare("INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at) VALUES(?,?,?,'staff','issue.decided',?,'{}',1)").bind(auditId, f.workspaceId, f.adminId, id),
      transition(),
    ]), /Invalid issue status change/);
    assert.equal(count(f, 'erp_audit_events', 'id=?', auditId), 0);
    assert.throws(() => f.sql.prepare("UPDATE qc_issues SET status='open' WHERE id=?").run(id), /Invalid issue status change/);
    assert.deepEqual(row(f, 'qc_issues', id), before);
  });
}
