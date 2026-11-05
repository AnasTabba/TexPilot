/** Arrived lots, inspections with accepted/rejected quantities, mandatory photos and issues. The database triggers of 0013 hold the invariants; routes map their aborts to 409/422. */
import { all, audit, date, fail, integer, json, keys, multiline, one, query, reason as reasonOf, recordId, role, text, viewer } from './erp-utils.mjs';
import { approvalQueries, needsApproval, settingsOf } from './governance.mjs';
import { notifyRole, notifyUser } from './notify.mjs';
import { readPhoto } from './photos.mjs';
import { movementQueries } from './stock-ledger.mjs';
import { reversalQueries } from './receiving.mjs';
import { sha256 } from './auth.mjs';

const SEVERITIES = ['minor', 'major', 'critical'], LOT_STATUSES = ['awaiting_inspection', 'under_review', 'settled'], INSPECTION_STATUSES = ['draft', 'submitted'];
const QUANTITY = 'More than the uninspected quantity.';
const state = lot => `CASE WHEN EXISTS(SELECT 1 FROM qc_inspections i WHERE i.lot_id=${lot} AND (i.status='draft' OR i.report_status='pending' OR i.rejection_status IN ('pending','escalated'))) THEN 'under_review'
  WHEN (SELECT open_milli FROM qc_lot_open WHERE lot_id=${lot})>0 THEN 'awaiting_inspection' ELSE 'settled' END`;
/** Recomputes a lot's status in the caller's batch. pending_since moves only when the lot (re-)enters awaiting_inspection. */
export const lotStatusQuery = (db, lotId, now) => query(db, `UPDATE qc_lots SET
  pending_since=CASE WHEN ${state('qc_lots.id')}='awaiting_inspection' THEN CASE WHEN status='awaiting_inspection' THEN pending_since ELSE ? END END,
  status=${state('qc_lots.id')},updated_at=? WHERE id=?`, now, now, lotId);

/** Money owed for a rejected quantity: milli-units times the PO rate per whole unit. */
export const claimAmount = (rejectedMilli, priceMinor) => Math.round(rejectedMilli * priceMinor / 1000);
const GRAMS_PER_MILLI = { kg: 1, tonne: 1000 };
const kilograms = (milli, unit) => Number((milli * GRAMS_PER_MILLI[unit] / 1000).toFixed(3));
const REPORT_STATUSES = ['pending', 'accepted', 'returned'], REJECTION_STATUSES = ['pending', 'confirmed', 'dismissed', 'escalated'], OUTCOMES = ['return', 'replacement', 'claim'];
const SIDES = { report: ['report_status', 'report_reason'], rejected: ['rejection_status', 'rejection_reason'] };
const DECIDED = { accepted: 'inspection_report.accepted', returned: 'inspection_report.rejected', confirmed: 'rejection.confirmed', dismissed: 'rejection.dismissed', escalated: 'rejection.escalated' };
const ISSUE_STATUS = { confirmed: 'confirmed', dismissed: 'dismissed', escalated: 'escalated' };
/** A zero-row write cannot guard the statements behind it, so a state that is no longer the expected one aborts the whole batch here. */
const expectState = (db, column, inspectionId, expected) => query(db, `SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM qc_inspections WHERE id=? AND ${column} IS ?)`, inspectionId, expected);

/**
 * Every supervisor or admin decision on an inspection: the guarded transition (Task 9's trigger graph rejects a repeated or backwards move),
 * related issues, lot status, the inspector's notice and the reasoned audit. Receipts and claims are added by the caller in the same batch.
 */
export async function decisionQueries(db, member, { inspectionId, side, expectedStatus, nextStatus, dismissOutcome = null, reason = null, intervention = null, claim = null }, now) {
  const [column, reasonColumn] = SIDES[side], inspection = await one(db, 'SELECT i.*,l.reference FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id WHERE i.id=? AND i.workspace_id=?', inspectionId, member.workspace_id);
  if (!inspection) throw new Error('inspection not found');
  const dismissal = nextStatus === 'dismissed';
  return [expectState(db, column, inspectionId, expectedStatus),
    query(db, `UPDATE qc_inspections SET ${column}=?,${reasonColumn}=COALESCE(?,${reasonColumn}),${dismissal ? 'dismiss_outcome=?,' : ''}decided_by=?,decided_at=?,updated_at=? WHERE id=?`,
      nextStatus, reason, ...(dismissal ? [dismissOutcome] : []), member.user_id, now, now, inspectionId),
    ...(side === 'rejected' ? [query(db, "UPDATE qc_issues SET status=?,updated_at=? WHERE inspection_id=? AND status IN ('open','escalated') AND status!=?", ISSUE_STATUS[nextStatus], now, inspectionId, ISSUE_STATUS[nextStatus])] : []),
    lotStatusQuery(db, inspection.lot_id, now),
    notifyUser(db, member.workspace_id, inspection.created_by, 'inspection.decided', 'qc_inspection', inspectionId, inspection.reference),
    audit(db, member, DECIDED[nextStatus], inspectionId, { lot: inspection.lot_id, ...(dismissOutcome ? { dismissOutcome } : {}), ...(claim ? { claim: claim.id, amount: claim.amount } : {}) }, 'staff',
      { objectType: 'inspection', before: { status: expectedStatus }, after: { status: nextStatus }, reason, intervention })];
}

/** The raw QC lot row (created by the first receipt) plus its receipt: identity-guarded so a different lot with the same batch can never absorb the stock. */
async function receiptQueries(db, member, inspection, milli, note, sourceId, now) {
  const lot = await one(db, 'SELECT l.*,s.name AS supplier_name FROM qc_lots l JOIN suppliers s ON s.id=l.supplier_id WHERE l.id=?', inspection.lot_id);
  const sameId = await one(db, 'SELECT * FROM lots WHERE id=?', lot.id), sameBatch = await one(db, 'SELECT id FROM lots WHERE workspace_id=? AND product_id=? AND batch=? AND id!=?', lot.workspace_id, lot.product_id, lot.reference, lot.id);
  if (sameBatch || (sameId && (sameId.workspace_id !== lot.workspace_id || sameId.product_id !== lot.product_id || sameId.batch !== lot.reference || sameId.source !== 'qc_lot'))) fail(409, 'Another stock lot already uses this lot reference. No stock was received.');
  return [query(db, "INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at,inventory_type,source) VALUES(?,?,?,?,?,'approved',?,'raw','qc_lot') ON CONFLICT(id) DO NOTHING", lot.id, lot.workspace_id, lot.product_id, lot.reference, lot.supplier_name, now),
    query(db, "SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM lots WHERE id=? AND workspace_id=? AND product_id=? AND batch=? AND source='qc_lot')", lot.id, lot.workspace_id, lot.product_id, lot.reference),
    ...movementQueries(db, member, { lotId: lot.id, action: 'receive', stage: 'raw', deltaGrams: milli * GRAMS_PER_MILLI[lot.unit], note, sourceId }, now)];
}

/** Rate and currency come from the PO's frozen terms; a monetary decision never mixes them with another currency. */
async function claimTerms(db, inspection) {
  const order = await one(db, 'SELECT p.id,p.supplier_id,p.terms_snapshot FROM supplier_purchase_orders p JOIN qc_lots l ON l.purchase_order_id=p.id WHERE l.id=?', inspection.lot_id), terms = JSON.parse(order.terms_snapshot);
  if (terms.currency !== (await settingsOf(db, inspection.workspace_id)).currency) fail(409, 'PO currency differs from the configured factory currency.');
  return { order, rate: terms.price_minor, amount: claimAmount(inspection.rejected_milli, terms.price_minor) };
}
const claimInsert = (db, member, claimId, inspection, terms, status, now) => query(db, 'INSERT INTO claims(id,workspace_id,lot_id,inspection_id,supplier_id,purchase_order_id,rejected_milli,po_rate_minor,calculated_minor,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
  claimId, inspection.workspace_id, inspection.lot_id, inspection.id, terms.order.supplier_id, terms.order.id, inspection.rejected_milli, terms.rate, terms.amount, status, member.user_id, now, now);
const claimNotices = (db, workspaceId, claimId, label) => ['admin', 'purchase_manager'].map(r => notifyRole(db, workspaceId, r, 'claim.created', 'claim', claimId, label));
const reference = (db, lotId) => one(db, 'SELECT reference FROM qc_lots WHERE id=?', lotId).then(lot => lot.reference);

const CLAIM_FIELDS = 'c.id,c.lot_id,c.inspection_id,c.supplier_id,c.purchase_order_id,c.rejected_milli,c.po_rate_minor,c.calculated_minor,c.adjusted_minor,c.outcome,c.adjust_reason,c.status,c.decided_by,c.decided_at,c.created_at,c.updated_at,s.name AS supplier_name,l.reference AS lot_reference,l.unit,m.name AS product_name,p.reference AS order_reference';
const CLAIM_JOINS = 'FROM claims c JOIN qc_lots l ON l.id=c.lot_id JOIN suppliers s ON s.id=c.supplier_id JOIN products m ON m.id=l.product_id JOIN supplier_purchase_orders p ON p.id=c.purchase_order_id';
const claimView = (db, id, workspaceId) => one(db, `SELECT ${CLAIM_FIELDS} ${CLAIM_JOINS} WHERE c.id=? AND c.workspace_id=?`, id, workspaceId);
const issuesOf = (db, inspectionId) => all(db, 'SELECT id,type,severity,description,status,created_at FROM qc_issues WHERE inspection_id=? ORDER BY created_at,id', inspectionId);
const inspectionEvidence = async (db, list) => { for (const i of list) { i.photos = await all(db, `SELECT ${PHOTO_FIELDS} FROM qc_photos WHERE (inspection_id=? OR issue_id IN (SELECT id FROM qc_issues WHERE inspection_id=?)) AND NOT EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind='photo_voided' AND c.target_id=qc_photos.id) ORDER BY taken_at,id`, i.id, i.id); i.issues = await issuesOf(db, i.id); } return list; };

const describeInspection = async (db, request) => {
  const i = await one(db, 'SELECT i.*,l.reference,l.unit,m.name AS product_name,s.name AS supplier_name FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id JOIN products m ON m.id=l.product_id JOIN suppliers s ON s.id=l.supplier_id WHERE i.id=? AND i.workspace_id=?', request.payload.inspectionId, request.workspace_id);
  const { amount } = await claimTerms(db, i);
  return { objectType: 'qc_inspection', objectId: i.id, label: i.reference, currency: request.currency,
    evidence: { inspection: { accepted_milli: i.accepted_milli, rejected_milli: i.rejected_milli, unit: i.unit, note: i.note, rejection_reason: i.rejection_reason, product: i.product_name, supplier: i.supplier_name }, issues: await issuesOf(db, i.id), photos: (await inspectionEvidence(db, [i]))[0].photos },
    proposed: { confirm: { claimMinor: amount }, reject: { rejectionStatus: 'dismissed', dismissOutcome: 're_inspect' } } };
};
const claimMove = (status) => async (db, member, request, { now }) => [query(db, 'UPDATE claims SET status=?,updated_at=? WHERE id=? AND workspace_id=?', status, now, request.object_id, member.workspace_id)];
export const approvalHandlers = {
  claim: {
    approve: claimMove('open'), reject: claimMove('rejected'),
    async describe(db, request) {
      const claim = await claimView(db, request.object_id, request.workspace_id);
      return { objectType: 'claim', objectId: claim.id, label: claim.lot_reference, currency: request.currency, evidence: { claim, issues: await issuesOf(db, claim.inspection_id) }, proposed: { status: 'open', claimMinor: claim.calculated_minor } };
    },
  },
  escalation: {
    async approve(db, member, request, { now }) {
      const inspection = await one(db, 'SELECT * FROM qc_inspections WHERE id=? AND workspace_id=?', request.payload.inspectionId, member.workspace_id), terms = await claimTerms(db, inspection), claimId = crypto.randomUUID();
      return [...await decisionQueries(db, member, { inspectionId: inspection.id, side: 'rejected', expectedStatus: 'escalated', nextStatus: 'confirmed', claim: { id: claimId, amount: terms.amount } }, now),
        claimInsert(db, member, claimId, inspection, terms, 'open', now), ...claimNotices(db, member.workspace_id, claimId, await reference(db, inspection.lot_id))];
    },
    async reject(db, member, request, { reason, now }) {
      return decisionQueries(db, member, { inspectionId: request.payload.inspectionId, side: 'rejected', expectedStatus: 'escalated', nextStatus: 'dismissed', dismissOutcome: 're_inspect', reason }, now);
    },
    describe: describeInspection,
  },
};

/** A decision that lost its race (or a lot identity conflict inside the same batch) leaves nothing behind; say which. */
async function decisionFailed(error, db, inspectionId, column) {
  const message = String(error.message), current = await one(db, `SELECT ${column} AS status FROM qc_inspections WHERE id=?`, inspectionId);
  if (current?.status === 'pending') fail(409, /UNIQUE/.test(message) ? 'Another stock lot already uses this lot reference. No stock was received.' : 'The lot changed. Reload and try again.');
  fail(409, 'This was already decided by someone else. Reload.');
}

const LOT_FIELDS = 'l.id,l.purchase_order_id,l.shipment_id,l.supplier_id,l.product_id,l.reference,l.quantity_milli,l.unit,l.supplier_lot,l.arrived_at,l.pending_since,l.status,l.created_at,l.updated_at';
const PHOTO_FIELDS = 'id,lot_id,inspection_id,issue_id,content_type,size,taken_at,created_at';
const lotRow = (db, id, w) => one(db, `SELECT ${LOT_FIELDS} FROM qc_lots l WHERE l.id=? AND l.workspace_id=?`, id, w);
const inspectionRow = (db, id, w) => one(db, 'SELECT * FROM qc_inspections WHERE id=? AND workspace_id=?', id, w);
const same = (row, expected) => Object.entries(expected).every(([k, v]) => row[k] === v);

// Corrections keep their reason (3-500 characters). The role that made the step may correct it; anyone else is refused unless an admin, whose reason then serves as the intervention and must be at least 5 characters.
function correction(member, data, ...roles) {
  const own = roles.includes(member.role);
  if (!own && member.role !== 'admin') fail(403, 'Your role cannot do this. Ask an admin.');
  const why = multiline(data?.reason, 'Reason', 3, 500);
  if (!own && why.length < 5) fail(422, 'An admin correction needs a reason of at least 5 characters.');
  return { why, intervention: own ? null : why };
}
// A correction ID replays only when its action and client-supplied reason also match.
async function replayed(db, id, workspaceId, target, kind, reason, detail = {}) {
  const done = await one(db, 'SELECT workspace_id,target_id,kind,reason,detail_json FROM qc_corrections WHERE id=?', id);
  if (!done) return false;
  const savedDetail = JSON.parse(done.detail_json);
  if (done.workspace_id !== workspaceId || done.target_id !== target || done.kind !== kind || done.reason !== reason
      || Object.entries(detail).some(([key, value]) => savedDetail[key] !== value))
    fail(409, 'This correction ID was used for another change.');
  return true;
}
const recordCorrection = (db, member, id, kind, target, why, detail, now) => query(db, 'INSERT INTO qc_corrections(id,workspace_id,kind,target_id,reason,detail_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
  id, member.workspace_id, kind, target, why, JSON.stringify(detail), member.user_id, now);
// Stock side of undoing a decision: the reversing ledger entry, refused once the lot's ledger has moved past the receipt.
async function receiptReversal(db, member, inspectionId, source, why, now) {
  const receipt = await one(db, "SELECT id,lot_id,grams,cartons,cones,rowid AS seq FROM movements WHERE request_hash=? AND action='receive' AND workspace_id=?", `source:${inspectionId}:${source}`, member.workspace_id);
  if (!receipt) fail(409, 'The stock for this decision was not found, so the decision cannot be undone.');
  if (await one(db, 'SELECT 1 AS moved FROM movements WHERE lot_id=? AND rowid>? LIMIT 1', receipt.lot_id, receipt.seq)) fail(409, 'Stock from this decision has already moved, so the decision cannot be undone.');
  return reversalQueries(db, member, { id: crypto.randomUUID(), lotId: receipt.lot_id, movementId: receipt.id, grams: receipt.grams, cartons: receipt.cartons, cones: receipt.cones, reason: why, digest: await sha256(`reverse:${receipt.id}`) }, now);
}
// Quantity an undone decision would put back on the lot: refused when another inspection has taken it since.
async function uninspectedAtLeast(db, lotId, milli) {
  const open = await one(db, 'SELECT open_milli FROM qc_lot_open WHERE lot_id=?', lotId);
  return (open?.open_milli ?? 0) >= milli;
}
// Photos and issues of a draft, deleted with it; their stored objects are removed after the batch commits.
const removeObjects = (env, photos) => Promise.all(photos.map(p => env.BUCKET?.delete(p.object_key).catch(() => {})));

export async function qualityApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now(), base = '/api/erp/qc';
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    if (path === base + '/lots') {
      viewer(member, 'quality_inspector', 'supervisor', 'purchase_manager');
      const status = q.get('status');
      if (status && !LOT_STATUSES.includes(status)) fail(422, 'Choose awaiting_inspection, under_review or settled.');
      const lots = await all(db, `SELECT ${LOT_FIELDS},m.name AS product_name,s.name AS supplier_name,p.reference AS order_reference,o.open_milli,
        (SELECT COUNT(*) FROM qc_inspections x WHERE x.lot_id=l.id) AS inspection_count,
        (SELECT created_at FROM qc_corrections c WHERE c.kind='lot_cancelled' AND c.target_id=l.id) AS cancelled_at,
        (SELECT reason FROM qc_corrections c WHERE c.kind='lot_cancelled' AND c.target_id=l.id) AS cancel_reason
        FROM qc_lots l JOIN products m ON m.id=l.product_id JOIN suppliers s ON s.id=l.supplier_id JOIN supplier_purchase_orders p ON p.id=l.purchase_order_id JOIN qc_lot_open o ON o.lot_id=l.id
        WHERE l.workspace_id=? AND (? IS NULL OR l.status=?) ORDER BY l.arrived_at DESC,l.id LIMIT 200`, w, status, status);
      return json({ lots });
    }
    if (path === base + '/inspections') {
      viewer(member, 'quality_inspector', 'supervisor');
      const status = q.get('status'), mine = q.get('mine') === '1';
      if (status && !INSPECTION_STATUSES.includes(status)) fail(422, 'Choose draft or submitted.');
      const inspections = await all(db, `SELECT i.*,l.reference AS lot_reference,m.name AS product_name,l.unit FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id JOIN products m ON m.id=l.product_id
        WHERE i.workspace_id=? AND (? IS NULL OR i.status=?) AND (?=0 OR i.created_by=?) ORDER BY i.created_at DESC,i.id LIMIT 100`, w, status, status, mine ? 1 : 0, member.user_id);
      await inspectionEvidence(db, inspections);
      return json({ inspections });
    }
    if (path === base + '/reports' || path === base + '/rejections') {
      viewer(member, 'supervisor');
      const reports = path === base + '/reports', column = reports ? 'report_status' : 'rejection_status', statuses = reports ? REPORT_STATUSES : REJECTION_STATUSES, status = q.get('status') ?? 'pending';
      if (!statuses.includes(status)) fail(422, `Choose ${statuses.join(', ')}.`);
      const list = await all(db, `SELECT i.*,l.reference AS lot_reference,m.name AS product_name,s.name AS supplier_name,l.unit,CAST(json_extract(p.terms_snapshot,'$.price_minor') AS INTEGER) AS po_rate_minor
        FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id JOIN products m ON m.id=l.product_id JOIN suppliers s ON s.id=l.supplier_id JOIN supplier_purchase_orders p ON p.id=l.purchase_order_id
        WHERE i.workspace_id=? AND i.status='submitted' AND i.${column}=? ORDER BY i.submitted_at,i.id LIMIT 100`, w, status);
      if (!reports) for (const i of list) i.claim_minor = claimAmount(i.rejected_milli, i.po_rate_minor);
      return json({ [reports ? 'reports' : 'rejections']: await inspectionEvidence(db, list), ...(reports ? {} : { currency: (await settingsOf(db, w)).currency }) });
    }
    if (path === base + '/claims' || path.startsWith(base + '/claims/')) {
      viewer(member, 'purchase_manager');
      // The purchase manager is told about decided claims only; open and pending ones are the admin's work.
      const scope = member.role === 'admin' ? '' : " AND c.status='decided'";
      if (path === base + '/claims') return json({ claims: await all(db, `SELECT ${CLAIM_FIELDS} ${CLAIM_JOINS} WHERE c.workspace_id=?${scope} ORDER BY c.created_at DESC,c.id LIMIT 200`, w) });
      const claim = await one(db, `SELECT ${CLAIM_FIELDS} ${CLAIM_JOINS} WHERE c.id=? AND c.workspace_id=?${scope}`, recordId(path.slice((base + '/claims/').length)), w);
      if (!claim) fail(404, 'Claim not found.');
      return json({ claim, issues: await issuesOf(db, claim.inspection_id) });
    }
    if (path.startsWith(base + '/photos/')) {
      viewer(member, 'quality_inspector', 'supervisor', 'purchase_manager');
      const photo = await one(db, "SELECT * FROM qc_photos WHERE id=? AND workspace_id=? AND NOT EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind='photo_voided' AND c.target_id=qc_photos.id)", recordId(path.slice((base + '/photos/').length)), w);
      if (!photo) fail(404, 'This photo was not found in your workspace.');
      if (!env.BUCKET) fail(503, 'Photo storage is unavailable.');
      const object = await env.BUCKET.get(photo.object_key);
      if (!object) fail(404, 'The photo object could not be found.');
      return new Response(object.body, { headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    fail(404, 'Quality route not found.');
  }
  if (path === base + '/lots') {
    const intervention = role(member, data, 'purchase_manager');
    keys(data, ['id', 'orderId', 'shipmentId', 'productId', 'reference', 'quantityMilli', 'supplierLot', 'arrivedAt', 'interventionReason']);
    const id = recordId(data.id), orderId = recordId(data.orderId), shipmentId = recordId(data.shipmentId), productId = recordId(data.productId);
    const reference = text(data.reference, 'Lot reference', 1, 100), supplierLot = text(data.supplierLot ?? '', 'Supplier lot', 0, 100);
    const quantity = integer(data.quantityMilli, 'Arrived quantity'), arrivedAt = date(data.arrivedAt, 'Arrival time');
    if (arrivedAt > now + 300000) fail(422, 'Arrival time cannot be in the future.');
    const expected = { purchase_order_id: orderId, shipment_id: shipmentId, product_id: productId, reference, quantity_milli: quantity, supplier_lot: supplierLot, arrived_at: arrivedAt };
    const previous = await one(db, 'SELECT * FROM qc_lots WHERE id=?', id);
    if (previous) { if (previous.workspace_id !== w || !same(previous, expected)) fail(409, 'Lot ID was used for other values.'); return json(await lotRow(db, id, w)); }
    const order = await one(db, 'SELECT p.*,r.unit FROM supplier_purchase_orders p JOIN procurement_rfqs r ON r.id=p.rfq_id WHERE p.id=? AND p.workspace_id=?', orderId, w);
    if (!order) fail(404, 'Purchase order not found.');
    if (!await one(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', productId, w)) fail(404, 'Material not found.');
    if (!await one(db, 'SELECT id FROM shipments WHERE id=? AND workspace_id=? AND purchase_order_id=?', shipmentId, w, orderId)) fail(404, 'Shipment not found on this purchase order.');
    try {
      await db.batch([
        query(db, "INSERT INTO qc_lots(id,workspace_id,purchase_order_id,shipment_id,supplier_id,product_id,reference,quantity_milli,unit,supplier_lot,arrived_at,pending_since,status,created_by,created_at,updated_at,po_status_before) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'awaiting_inspection',?,?,?,?)",
          id, w, orderId, shipmentId, order.supplier_id, productId, reference, quantity, order.unit, supplierLot, arrivedAt, now, member.user_id, now, now, order.status),
        query(db, "UPDATE supplier_purchase_orders SET status='received',updated_at=? WHERE id=? AND status IN ('accepted','dispatched') AND (SELECT arrived_milli FROM po_arrived WHERE order_id=?)>=quantity_milli", now, orderId, orderId),
        notifyRole(db, w, 'quality_inspector', 'lot.ready', 'qc_lot', id, reference),
        audit(db, member, 'lot.arrived', id, { order: orderId, shipment: shipmentId, quantity_milli: quantity, unit: order.unit }, 'staff', { objectType: 'lot', intervention })]);
    } catch (error) {
      const raced = await one(db, 'SELECT * FROM qc_lots WHERE id=?', id);
      if (raced?.workspace_id === w && same(raced, expected)) return json(await lotRow(db, id, w));
      const message = String(error.message);
      fail(409, /purchase order quantity/.test(message) ? 'This arrival is more than the quantity still due on the purchase order.' : /UNIQUE/.test(message) ? 'That lot reference is already used.' : 'The order, shipment or approval changed. Reload and check the values.');
    }
    return json(await lotRow(db, id, w), 201);
  }
  if (path === base + '/inspections') {
    role(member, data, 'quality_inspector');
    keys(data, ['id', 'lotId', 'acceptedMilli', 'rejectedMilli', 'note', 'interventionReason']);
    const id = recordId(data.id), lotId = recordId(data.lotId), accepted = integer(data.acceptedMilli, 'Accepted quantity', 0), rejected = integer(data.rejectedMilli, 'Rejected quantity', 0);
    const note = multiline(data.note ?? '', 'Note', 0, 2000);
    if (accepted + rejected === 0) fail(422, 'Record an accepted or a rejected quantity.');
    const expected = { lot_id: lotId, accepted_milli: accepted, rejected_milli: rejected, note };
    const previous = await one(db, 'SELECT * FROM qc_inspections WHERE id=?', id);
    if (previous) { if (previous.workspace_id !== w || !same(previous, expected)) fail(409, 'Inspection ID was used for other values.'); return json(previous); }
    if (!await lotRow(db, lotId, w)) fail(404, 'Lot not found.');
    if (await one(db, "SELECT 1 AS x FROM qc_corrections WHERE kind='lot_cancelled' AND target_id=?", lotId)) fail(409, 'This arrival was cancelled. Register it again first.');
    try {
      await db.batch([
        query(db, "INSERT INTO qc_inspections(id,workspace_id,lot_id,accepted_milli,rejected_milli,note,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?,?)", id, w, lotId, accepted, rejected, note, member.user_id, now, now),
        lotStatusQuery(db, lotId, now)]);
    } catch (error) {
      const raced = await one(db, 'SELECT * FROM qc_inspections WHERE id=?', id);
      if (raced?.workspace_id === w && same(raced, expected)) return json(raced);
      fail(409, error.message.includes(QUANTITY) ? QUANTITY : 'The lot changed. Reload and check the values.');
    }
    return json(await inspectionRow(db, id, w), 201);
  }
  if (path === base + '/issues') {
    role(member, data, 'quality_inspector');
    keys(data, ['id', 'inspectionId', 'type', 'severity', 'description', 'interventionReason']);
    const id = recordId(data.id), inspectionId = recordId(data.inspectionId), type = text(data.type, 'Issue type', 2, 80), description = multiline(data.description, 'Description', 5, 2000);
    if (!SEVERITIES.includes(data.severity)) fail(422, 'Choose minor, major or critical.');
    const expected = { inspection_id: inspectionId, type, severity: data.severity, description };
    const previous = await one(db, 'SELECT * FROM qc_issues WHERE id=?', id);
    if (previous) { if (previous.workspace_id !== w || !same(previous, expected)) fail(409, 'Issue ID was used for other values.'); return json(previous); }
    if (!await inspectionRow(db, inspectionId, w)) fail(404, 'Inspection not found.');
    try {
      await db.batch([query(db, "INSERT INTO qc_issues(id,workspace_id,inspection_id,type,severity,description,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?,?)", id, w, inspectionId, type, data.severity, description, member.user_id, now, now)]);
    } catch {
      const raced = await one(db, 'SELECT * FROM qc_issues WHERE id=?', id);
      if (raced?.workspace_id === w && same(raced, expected)) return json(raced);
      fail(409, 'This inspection was already submitted. Issues attach only to a draft.');
    }
    return json(await one(db, 'SELECT * FROM qc_issues WHERE id=?', id), 201);
  }
  if (path === base + '/inspections/submit') {
    const intervention = role(member, data, 'quality_inspector');
    keys(data, ['id', 'interventionReason']);
    const id = recordId(data.id), inspection = await inspectionRow(db, id, w);
    if (!inspection) fail(404, 'Inspection not found.');
    if (inspection.status !== 'draft') fail(409, 'This inspection was already submitted.');
    const label = (await lotRow(db, inspection.lot_id, w)).reference;
    try {
      // The UPDATE is targeted by id alone: the trigger checks the draft state, quantities and evidence and aborts the whole batch if it loses.
      await db.batch([
        query(db, "UPDATE qc_inspections SET status='submitted',submitted_at=?,updated_at=?,report_status=CASE WHEN accepted_milli>0 THEN 'pending' END,rejection_status=CASE WHEN rejected_milli>0 THEN 'pending' END WHERE id=?", now, now, id),
        lotStatusQuery(db, inspection.lot_id, now),
        notifyRole(db, w, 'supervisor', 'inspection.submitted', 'qc_inspection', id, label),
        // An accepted quantity makes the report wait for the supervisor's decision; the admin is told too.
        ...(inspection.accepted_milli > 0 ? [notifyRole(db, w, 'supervisor', 'qc.report_waiting', 'qc_inspection', id, label), notifyRole(db, w, 'admin', 'qc.report_waiting', 'qc_inspection', id, label)] : []),
        audit(db, member, 'inspection.submitted', id, { lot: inspection.lot_id, accepted_milli: inspection.accepted_milli, rejected_milli: inspection.rejected_milli }, 'staff', { objectType: 'inspection', intervention })]);
    } catch (error) {
      const message = String(error.message).match(/Upload at least one photo of the accepted quantity\.|Describe at least one issue for the rejected quantity\./)?.[0];
      if (message) fail(422, message);
      fail(409, 'This inspection was already submitted.');
    }
    return json(await inspectionRow(db, id, w));
  }
  if (path === base + '/photos') {
    // The multipart body is read before the intervention reason is known, so a plain role is checked first.
    if (member.role !== 'admin') role(member, {}, 'quality_inspector');
    if (!env.BUCKET) fail(503, 'Photo storage is unavailable. Retry the photo after reconnecting.');
    const { form, bytes, type, digest } = await readPhoto(request);
    role(member, { interventionReason: form.get('interventionReason') }, 'quality_inspector');
    const id = recordId(form.get('id')), inspectionId = form.get('inspectionId'), issueId = form.get('issueId');
    if ((inspectionId === null) === (issueId === null)) fail(422, 'Attach the photo to an inspection or to an issue.');
    const target = inspectionId === null ? { issue_id: recordId(issueId), inspection_id: null } : { inspection_id: recordId(inspectionId), issue_id: null };
    const previous = await one(db, 'SELECT * FROM qc_photos WHERE id=?', id);
    const view = async () => json(await one(db, `SELECT ${PHOTO_FIELDS} FROM qc_photos WHERE id=?`, id));
    if (previous) { if (previous.workspace_id !== w || !same(previous, { ...target, content_hash: digest })) fail(409, 'Photo ID was used for a different photo.'); return view(); }
    const inspection = inspectionId === null
      ? await one(db, 'SELECT i.* FROM qc_issues x JOIN qc_inspections i ON i.id=x.inspection_id WHERE x.id=? AND x.workspace_id=?', target.issue_id, w)
      : await inspectionRow(db, target.inspection_id, w);
    if (!inspection) fail(404, inspectionId === null ? 'Issue not found.' : 'Inspection not found.');
    if (inspection.status !== 'draft') fail(409, 'Photos attach only to draft inspections.');
    const key = `${w}/qc/${inspection.lot_id}/${inspectionId === null ? 'issue' : 'inspection'}/${id}/${digest}`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
      await db.batch([query(db, "INSERT INTO qc_photos(id,workspace_id,lot_id,inspection_id,issue_id,object_key,content_type,content_hash,size,taken_at,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'attached',?,?,?)",
        id, w, inspection.lot_id, target.inspection_id, target.issue_id, key, type, digest, bytes.length, now, member.user_id, now, now)]);
    } catch {
      const raced = await one(db, 'SELECT * FROM qc_photos WHERE id=?', id);
      if (raced?.workspace_id === w && same(raced, { ...target, content_hash: digest })) return view();
      await env.BUCKET.delete(key);
      fail(409, 'This inspection was submitted first. Photos attach only to a draft.');
    }
    return json(await one(db, `SELECT ${PHOTO_FIELDS} FROM qc_photos WHERE id=?`, id), 201);
  }
  if (path === base + '/reports/decide') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['inspectionId', 'decision', 'reason', 'interventionReason']);
    const id = recordId(data.inspectionId), accept = data.decision === 'accept';
    if (!accept && data.decision !== 'reject') fail(422, 'Choose accept or reject.');
    const why = accept && data.reason === undefined ? null : reasonOf(data.reason);
    const inspection = await inspectionRow(db, id, w);
    if (!inspection) fail(404, 'Inspection not found.');
    if (inspection.report_status !== 'pending') fail(409, 'This report was already decided or has nothing to accept.');
    try {
      const lot = accept ? await one(db, 'SELECT reference,unit FROM qc_lots WHERE id=?', inspection.lot_id) : null;
      await db.batch([...await decisionQueries(db, member, { inspectionId: id, side: 'report', expectedStatus: 'pending', nextStatus: accept ? 'accepted' : 'returned', reason: why, intervention }, now),
        ...(accept ? [...await receiptQueries(db, member, inspection, inspection.accepted_milli, `QC accepted lot ${lot.reference}`, `${id}:accepted`, now),
          ...['supervisor', 'admin'].map(r => notifyRole(db, w, r, 'stock.ready_for_production', 'lot', inspection.lot_id, `${lot.reference} · ${kilograms(inspection.accepted_milli, lot.unit)} kg`, member.user_id))] : [])]);
    } catch (error) { return decisionFailed(error, db, id, 'report_status'); }
    return json(await inspectionRow(db, id, w));
  }
  if (path === base + '/rejections/decide') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['inspectionId', 'decision', 'dismissOutcome', 'reason', 'interventionReason']);
    const id = recordId(data.inspectionId), decision = data.decision;
    if (!['confirm', 'dismiss', 'escalate'].includes(decision)) fail(422, 'Choose confirm, dismiss or escalate.');
    if (data.dismissOutcome !== undefined && (decision !== 'dismiss' || !['re_inspect', 'accept_with_deviation'].includes(data.dismissOutcome))) fail(422, 'Choose re_inspect or accept_with_deviation for a dismissal.');
    if (decision === 'dismiss' && data.dismissOutcome === undefined) fail(422, 'Choose what happens to the rejected quantity: re_inspect or accept_with_deviation.');
    const why = decision === 'dismiss' || data.reason !== undefined ? reasonOf(data.reason) : null;
    const inspection = await inspectionRow(db, id, w);
    if (!inspection) fail(404, 'Inspection not found.');
    if (inspection.rejection_status !== 'pending') fail(409, 'This rejection was already decided or escalated.');
    const move = (nextStatus, extra = {}) => decisionQueries(db, member, { inspectionId: id, side: 'rejected', expectedStatus: 'pending', nextStatus, reason: why, intervention, ...extra }, now);
    let statements;
    if (decision === 'dismiss') {
      statements = [...await move('dismissed', { dismissOutcome: data.dismissOutcome }),
        ...(data.dismissOutcome === 'accept_with_deviation' ? await receiptQueries(db, member, inspection, inspection.rejected_milli, `Accepted with deviation: ${why}`, `${id}:deviation`, now) : [])];
    } else {
      const terms = await claimTerms(db, inspection), label = await reference(db, inspection.lot_id);
      if (decision === 'escalate') statements = [...await move('escalated'), ...approvalQueries(db, member, { type: 'escalation', objectType: 'qc_inspection', objectId: id, amount: terms.amount, threshold: null, unit: 'minor', payload: { inspectionId: id } }, now)];
      else {
        const claimId = crypto.randomUUID(), approval = await needsApproval(db, w, 'claim', terms.amount);
        statements = [...await move('confirmed', { claim: { id: claimId, amount: terms.amount } }), claimInsert(db, member, claimId, inspection, terms, approval.required ? 'pending_approval' : 'open', now),
          ...(approval.required ? approvalQueries(db, member, { type: 'claim', objectType: 'claim', objectId: claimId, amount: terms.amount, threshold: approval.threshold, unit: 'minor', payload: { inspectionId: id } }, now) : []),
          ...claimNotices(db, w, claimId, label)];
      }
    }
    try { await db.batch(statements); } catch (error) { return decisionFailed(error, db, id, 'rejection_status'); }
    return json(await inspectionRow(db, id, w));
  }
  if (path === base + '/lots/cancel') {
    keys(data, ['id', 'lotId', 'reason']);
    const { why, intervention } = correction(member, data, 'purchase_manager');
    const id = recordId(data.id), lotId = recordId(data.lotId);
    const lot = await one(db, 'SELECT * FROM qc_lots WHERE id=? AND workspace_id=?', lotId, w);
    if (!lot) fail(404, 'Lot not found.');
    if (await replayed(db, id, w, lotId, 'lot_cancelled', why)) return json(await lotRow(db, lotId, w));
    if (await one(db, "SELECT 1 AS x FROM qc_corrections WHERE kind='lot_cancelled' AND target_id=?", lotId)) fail(409, 'This arrival was already cancelled.');
    const inspections = await one(db, "SELECT COALESCE(SUM(status='submitted'),0) AS submitted, COUNT(*) AS total FROM qc_inspections WHERE lot_id=?", lotId);
    if (inspections.submitted) fail(409, 'An inspection of this arrival was already submitted, so the arrival cannot be cancelled.');
    if (inspections.total) fail(409, 'This arrival has a draft inspection. Delete the draft first, then cancel the arrival.');
    try {
      await db.batch([
        recordCorrection(db, member, id, 'lot_cancelled', lotId, why, { reference: lot.reference }, now),
        // The reference is the lot's unique key: renaming it releases the reference for the correct arrival.
        query(db, "UPDATE qc_lots SET reference=?,status='settled',updated_at=? WHERE id=?", `cancelled:${lotId}:${lot.reference}`, now, lotId),
        query(db, "UPDATE supplier_purchase_orders SET status=COALESCE(?,CASE WHEN EXISTS(SELECT 1 FROM shipments WHERE purchase_order_id=supplier_purchase_orders.id) THEN 'dispatched' ELSE 'accepted' END),updated_at=? WHERE id=? AND status='received'", lot.po_status_before, now, lot.purchase_order_id),
        audit(db, member, 'lot.undone', lotId, { order: lot.purchase_order_id, reference: lot.reference }, 'staff', { objectType: 'lot', before: { status: lot.status }, after: { status: 'cancelled' }, reason: why, intervention })]);
    } catch { fail(409, 'The arrival changed. Reload and check it.'); }
    return json(await lotRow(db, lotId, w));
  }
  if (path === base + '/inspections/update') {
    const intervention = role(member, data, 'quality_inspector');
    keys(data, ['id', 'acceptedMilli', 'rejectedMilli', 'note', 'interventionReason']);
    const id = recordId(data.id), accepted = integer(data.acceptedMilli, 'Accepted quantity', 0), rejected = integer(data.rejectedMilli, 'Rejected quantity', 0);
    const note = multiline(data.note ?? '', 'Note', 0, 2000);
    if (accepted + rejected === 0) fail(422, 'Record an accepted or a rejected quantity.');
    const inspection = await inspectionRow(db, id, w);
    if (!inspection) fail(404, 'Inspection not found.');
    if (inspection.status !== 'draft') fail(409, 'Only a draft can be edited. Reopen the inspection first if it is still undecided.');
    if (inspection.accepted_milli === accepted && inspection.rejected_milli === rejected && inspection.note === note) return json(inspection);
    const before = { accepted_milli: inspection.accepted_milli, rejected_milli: inspection.rejected_milli, note: inspection.note }, after = { accepted_milli: accepted, rejected_milli: rejected, note };
    try {
      await db.batch([expectState(db, 'status', id, 'draft'),
        query(db, 'UPDATE qc_inspections SET accepted_milli=?,rejected_milli=?,note=?,updated_at=? WHERE id=?', accepted, rejected, note, now, id),
        lotStatusQuery(db, inspection.lot_id, now),
        audit(db, member, 'inspection.edited', id, { lot: inspection.lot_id }, 'staff', { objectType: 'inspection', before, after, intervention })]);
    } catch (error) { fail(409, error.message.includes(QUANTITY) ? QUANTITY : 'This inspection changed. Reload and check it.'); }
    return json(await inspectionRow(db, id, w));
  }
  if (path === base + '/inspections/delete') {
    const intervention = role(member, data, 'quality_inspector');
    keys(data, ['id', 'interventionReason']);
    const id = recordId(data.id), inspection = await inspectionRow(db, id, w);
    if (!inspection) fail(404, 'Inspection not found.');
    if (inspection.status !== 'draft') fail(409, 'Only a draft can be deleted. A submitted inspection stays on record; reopen it while it is undecided.');
    const photos = await all(db, 'SELECT id,object_key FROM qc_photos WHERE inspection_id=? OR issue_id IN (SELECT id FROM qc_issues WHERE inspection_id=?)', id, id);
    try {
      await db.batch([
        query(db, 'DELETE FROM qc_photos WHERE inspection_id=? OR issue_id IN (SELECT id FROM qc_issues WHERE inspection_id=?)', id, id),
        query(db, 'DELETE FROM qc_issues WHERE inspection_id=?', id),
        query(db, "DELETE FROM qc_inspections WHERE id=? AND status='draft'", id),
        lotStatusQuery(db, inspection.lot_id, now),
        audit(db, member, 'inspection.deleted', id, { lot: inspection.lot_id, photos: photos.length }, 'staff', { objectType: 'inspection', before: { status: 'draft', accepted_milli: inspection.accepted_milli, rejected_milli: inspection.rejected_milli }, intervention })]);
    } catch { fail(409, 'This inspection was submitted first, so it cannot be deleted.'); }
    await removeObjects(env, photos);
    return json({ deleted: true, id });
  }
  if (path === base + '/issues/update') {
    const intervention = role(member, data, 'quality_inspector');
    keys(data, ['id', 'type', 'severity', 'description', 'interventionReason']);
    const id = recordId(data.id), issue = await one(db, 'SELECT * FROM qc_issues WHERE id=? AND workspace_id=?', id, w);
    if (!issue) fail(404, 'Issue not found.');
    const inspection = await inspectionRow(db, issue.inspection_id, w);
    if (inspection.status !== 'draft') fail(409, 'Issues can be changed only on a draft. Reopen the inspection first if it is still undecided.');
    const kind = text(data.type, 'Issue type', 2, 80), description = multiline(data.description, 'Description', 5, 2000);
    if (!SEVERITIES.includes(data.severity)) fail(422, 'Choose minor, major or critical.');
    if (issue.type === kind && issue.severity === data.severity && issue.description === description) return json(issue);
    try {
      await db.batch([expectState(db, 'status', inspection.id, 'draft'),
        query(db, 'UPDATE qc_issues SET type=?,severity=?,description=?,updated_at=? WHERE id=?', kind, data.severity, description, now, id),
        audit(db, member, 'issue.edited', id, { inspection: inspection.id }, 'staff', { objectType: 'issue', before: { type: issue.type, severity: issue.severity, description: issue.description }, after: { type: kind, severity: data.severity, description }, intervention })]);
    } catch { fail(409, 'This inspection changed. Reload and check it.'); }
    return json(await one(db, 'SELECT * FROM qc_issues WHERE id=?', id));
  }
  if (path === base + '/issues/delete') {
    const intervention = role(member, data, 'quality_inspector');
    keys(data, ['id', 'interventionReason']);
    const id = recordId(data.id), issue = await one(db, 'SELECT * FROM qc_issues WHERE id=? AND workspace_id=?', id, w);
    if (!issue) fail(404, 'Issue not found.');
    const inspection = await inspectionRow(db, issue.inspection_id, w);
    if (inspection.status !== 'draft') fail(409, 'Issues can be removed only from a draft. Reopen the inspection first if it is still undecided.');
    const photos = await all(db, 'SELECT id,object_key FROM qc_photos WHERE issue_id=?', id);
    try {
      await db.batch([query(db, 'DELETE FROM qc_photos WHERE issue_id=?', id), query(db, "DELETE FROM qc_issues WHERE id=? AND status='open'", id),
        audit(db, member, 'issue.deleted', id, { inspection: inspection.id, photos: photos.length }, 'staff', { objectType: 'issue', before: { type: issue.type, severity: issue.severity, description: issue.description }, intervention })]);
    } catch { fail(409, 'This issue was decided first, so it cannot be removed.'); }
    await removeObjects(env, photos);
    return json({ deleted: true, id });
  }
  if (path === base + '/inspections/reopen') {
    keys(data, ['id', 'inspectionId', 'reason']);
    const { why, intervention } = correction(member, data, 'quality_inspector');
    const id = recordId(data.id), inspectionId = recordId(data.inspectionId);
    if (await replayed(db, id, w, inspectionId, 'inspection_reopened', why)) return json(await inspectionRow(db, inspectionId, w));
    const inspection = await inspectionRow(db, inspectionId, w);
    if (!inspection) fail(404, 'Inspection not found.');
    if (inspection.status !== 'submitted') fail(409, 'Only a submitted inspection can be reopened.');
    if ((inspection.report_status ?? 'pending') !== 'pending' || (inspection.rejection_status ?? 'pending') !== 'pending') fail(409, 'The supervisor has already decided this inspection. Ask the supervisor to undo the decision first.');
    try {
      await db.batch([
        query(db, "UPDATE qc_inspections SET status='draft',submitted_at=NULL,report_status=NULL,rejection_status=NULL,updated_at=? WHERE id=? AND status='submitted'", now, inspectionId),
        recordCorrection(db, member, id, 'inspection_reopened', inspectionId, why, {}, now),
        lotStatusQuery(db, inspection.lot_id, now),
        audit(db, member, 'inspection.reopened', inspectionId, { lot: inspection.lot_id }, 'staff', { objectType: 'inspection', before: { status: 'submitted' }, after: { status: 'draft' }, reason: why, intervention })]);
    } catch { fail(409, 'The supervisor decided this inspection first. Reload and check it.'); }
    return json(await inspectionRow(db, inspectionId, w));
  }
  if (path === base + '/reports/undo') {
    keys(data, ['id', 'inspectionId', 'reason']);
    const { why, intervention } = correction(member, data, 'supervisor');
    const id = recordId(data.id), inspectionId = recordId(data.inspectionId);
    if (await replayed(db, id, w, inspectionId, 'decision_undone', why, { side: 'report' })) return json(await inspectionRow(db, inspectionId, w));
    const inspection = await inspectionRow(db, inspectionId, w);
    if (!inspection) fail(404, 'Inspection not found.');
    const from = inspection.report_status;
    if (inspection.status !== 'submitted' || !['accepted', 'returned'].includes(from)) fail(409, 'Only an accepted or returned report can be undone.');
    let stock = [];
    if (from === 'accepted') stock = await receiptReversal(db, member, inspectionId, 'accepted', why, now);
    else if (!await uninspectedAtLeast(db, inspection.lot_id, inspection.accepted_milli)) fail(409, 'The lot has been inspected again, so this report cannot go back to pending.');
    try {
      await db.batch([expectState(db, 'report_status', inspectionId, from),
        query(db, "UPDATE qc_inspections SET report_status='pending',report_reason=NULL,updated_at=? WHERE id=?", now, inspectionId),
        ...stock,
        recordCorrection(db, member, id, 'decision_undone', inspectionId, why, { side: 'report', from }, now),
        lotStatusQuery(db, inspection.lot_id, now),
        audit(db, member, 'inspection.undone', inspectionId, { lot: inspection.lot_id, side: 'report', from }, 'staff', { objectType: 'inspection', before: { report_status: from }, after: { report_status: 'pending' }, reason: why, intervention })]);
    } catch { fail(409, 'This decision changed. Reload and check it.'); }
    return json(await inspectionRow(db, inspectionId, w));
  }
  if (path === base + '/rejections/undo') {
    keys(data, ['id', 'inspectionId', 'reason']);
    const { why, intervention } = correction(member, data, 'supervisor');
    const id = recordId(data.id), inspectionId = recordId(data.inspectionId);
    if (await replayed(db, id, w, inspectionId, 'decision_undone', why, { side: 'rejected' })) return json(await inspectionRow(db, inspectionId, w));
    const inspection = await inspectionRow(db, inspectionId, w);
    if (!inspection) fail(404, 'Inspection not found.');
    const from = inspection.rejection_status;
    if (inspection.status !== 'submitted' || !['confirmed', 'dismissed'].includes(from)) fail(409, from === 'escalated'
      ? 'This rejection waits for the admin. The admin can reject the escalation, and the dismissal can then be undone.'
      : 'Only a confirmed or dismissed rejection can be undone.');
    let stock = [];
    if (from === 'confirmed') {
      if (await one(db, 'SELECT 1 AS x FROM claims WHERE inspection_id=?', inspectionId)) fail(409, 'A claim was raised for this rejection, so the decision cannot be undone.');
    } else if (inspection.dismiss_outcome === 'accept_with_deviation') stock = await receiptReversal(db, member, inspectionId, 'deviation', why, now);
    else if (!await uninspectedAtLeast(db, inspection.lot_id, inspection.rejected_milli)) fail(409, 'The lot has been inspected again, so this rejection cannot go back to pending.');
    try {
      await db.batch([expectState(db, 'rejection_status', inspectionId, from),
        query(db, "UPDATE qc_inspections SET rejection_status='pending',rejection_reason=NULL,dismiss_outcome=NULL,updated_at=? WHERE id=?", now, inspectionId),
        recordCorrection(db, member, id, 'decision_undone', inspectionId, why, { side: 'rejected', from, dismissOutcome: inspection.dismiss_outcome }, now),
        query(db, "UPDATE qc_issues SET status='open',updated_at=? WHERE inspection_id=? AND status!='open'", now, inspectionId),
        ...stock,
        lotStatusQuery(db, inspection.lot_id, now),
        audit(db, member, 'inspection.undone', inspectionId, { lot: inspection.lot_id, side: 'rejected', from }, 'staff', { objectType: 'inspection', before: { rejection_status: from }, after: { rejection_status: 'pending' }, reason: why, intervention })]);
    } catch { fail(409, 'This decision changed. Reload and check it.'); }
    return json(await inspectionRow(db, inspectionId, w));
  }
  if (path === base + '/photos/void') {
    keys(data, ['id', 'photoId', 'reason']);
    const { why, intervention } = correction(member, data, 'quality_inspector');
    const id = recordId(data.id), photoId = recordId(data.photoId);
    if (await replayed(db, id, w, photoId, 'photo_voided', why)) return json({ voided: true, id: photoId });
    const photo = await one(db, 'SELECT * FROM qc_photos WHERE id=? AND workspace_id=?', photoId, w);
    if (!photo) fail(404, 'Photo not found.');
    const inspection = photo.inspection_id
      ? await inspectionRow(db, photo.inspection_id, w)
      : await one(db, 'SELECT i.* FROM qc_issues x JOIN qc_inspections i ON i.id=x.inspection_id WHERE x.id=?', photo.issue_id);
    if (inspection.status !== 'draft') fail(409, 'Photos can be voided only on a draft. Reopen the inspection first if it is still undecided.');
    if (await one(db, "SELECT 1 AS x FROM qc_corrections WHERE kind='photo_voided' AND target_id=?", photoId)) fail(409, 'This photo was already voided.');
    try {
      await db.batch([expectState(db, 'status', inspection.id, 'draft'),
        recordCorrection(db, member, id, 'photo_voided', photoId, why, { inspection: inspection.id }, now),
        audit(db, member, 'photo.voided', photoId, { inspection: inspection.id, lot: photo.lot_id }, 'staff', { objectType: 'photo', reason: why, intervention })]);
    } catch { fail(409, 'This photo was already voided or the inspection was submitted. Reload and check it.'); }
    return json({ voided: true, id: photoId });
  }
  if (path === base + '/claims/decide') {
    role(member, data, 'admin');
    keys(data, ['id', 'outcome', 'adjustedMinor', 'reason']);
    const id = recordId(data.id);
    if (!OUTCOMES.includes(data.outcome)) fail(422, 'Choose return, replacement or claim.');
    const claim = await claimView(db, id, w);
    if (!claim) fail(404, 'Claim not found.');
    const adjusted = data.adjustedMinor === undefined ? null : integer(data.adjustedMinor, 'Adjusted amount', 0, 1_000_000_000_000), changedAmount = adjusted !== null && adjusted !== claim.calculated_minor;
    if (changedAmount !== (data.reason !== undefined)) fail(422, changedAmount ? 'An adjusted amount needs a reason of at least 5 characters.' : 'A reason is recorded only with an adjusted amount.');
    const why = changedAmount ? reasonOf(data.reason, 'Adjustment reason') : null, amount = changedAmount ? adjusted : claim.calculated_minor;
    if (claim.status !== 'open') fail(409, claim.status === 'pending_approval' ? 'This claim is waiting for admin approval.' : 'This claim was already decided.');
    // The purchase manager's notice carries the final outcome and amount, so it reads the currency before the batch.
    const { currency } = await settingsOf(db, w), label = `${claim.lot_reference} · ${data.outcome} · ${currency} ${(amount / 100).toFixed(2)}`;
    try {
      await db.batch([
        query(db, "UPDATE claims SET status='decided',outcome=?,adjusted_minor=?,adjust_reason=?,decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?", data.outcome, changedAmount ? adjusted : null, why, member.user_id, now, now, id, w),
        audit(db, member, 'claim.decided', id, { outcome: data.outcome, inspection: claim.inspection_id }, 'staff', { before: { amount: claim.calculated_minor }, after: { amount, outcome: data.outcome } }),
        ...(changedAmount ? [audit(db, member, 'claim.adjusted', id, { inspection: claim.inspection_id }, 'staff', { before: { amount: claim.calculated_minor }, after: { amount: adjusted }, reason: why })] : []),
        notifyRole(db, w, 'purchase_manager', 'claim.decided', 'claim', id, label)]);
    } catch { fail(409, 'This claim was already decided.'); }
    return json({ claim: await claimView(db, id, w) });
  }
  fail(404, 'Quality route not found.');
}
