/** Arrived lots, inspections with accepted/rejected quantities, mandatory photos and issues. The database triggers of 0013 hold the invariants; routes map their aborts to 409/422. */
import { all, audit, date, fail, integer, json, keys, multiline, one, query, recordId, role, text, viewer } from './erp-utils.mjs';
import { notifyRole } from './notify.mjs';
import { readPhoto } from './photos.mjs';

const SEVERITIES = ['minor', 'major', 'critical'], LOT_STATUSES = ['awaiting_inspection', 'under_review', 'settled'], INSPECTION_STATUSES = ['draft', 'submitted'];
const QUANTITY = 'More than the uninspected quantity.';
const state = lot => `CASE WHEN EXISTS(SELECT 1 FROM qc_inspections i WHERE i.lot_id=${lot} AND (i.status='draft' OR i.report_status='pending' OR i.rejection_status IN ('pending','escalated'))) THEN 'under_review'
  WHEN (SELECT open_milli FROM qc_lot_open WHERE lot_id=${lot})>0 THEN 'awaiting_inspection' ELSE 'settled' END`;
/** Recomputes a lot's status in the caller's batch. pending_since moves only when the lot (re-)enters awaiting_inspection. */
export const lotStatusQuery = (db, lotId, now) => query(db, `UPDATE qc_lots SET
  pending_since=CASE WHEN ${state('qc_lots.id')}='awaiting_inspection' THEN CASE WHEN status='awaiting_inspection' THEN pending_since ELSE ? END END,
  status=${state('qc_lots.id')},updated_at=? WHERE id=?`, now, now, lotId);

const LOT_FIELDS = 'l.id,l.purchase_order_id,l.shipment_id,l.supplier_id,l.product_id,l.reference,l.quantity_milli,l.unit,l.supplier_lot,l.arrived_at,l.pending_since,l.status,l.created_at,l.updated_at';
const PHOTO_FIELDS = 'id,lot_id,inspection_id,issue_id,content_type,size,taken_at,created_at';
const lotRow = (db, id, w) => one(db, `SELECT ${LOT_FIELDS} FROM qc_lots l WHERE l.id=? AND l.workspace_id=?`, id, w);
const inspectionRow = (db, id, w) => one(db, 'SELECT * FROM qc_inspections WHERE id=? AND workspace_id=?', id, w);
const same = (row, expected) => Object.entries(expected).every(([k, v]) => row[k] === v);

export async function qualityApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now(), base = '/api/erp/qc';
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    if (path === base + '/lots') {
      viewer(member, 'quality_inspector', 'supervisor', 'purchase_manager');
      const status = q.get('status');
      if (status && !LOT_STATUSES.includes(status)) fail(422, 'Choose awaiting_inspection, under_review or settled.');
      const lots = await all(db, `SELECT ${LOT_FIELDS},m.name AS product_name,s.name AS supplier_name,p.reference AS order_reference,o.open_milli
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
      for (const i of inspections) {
        i.photos = await all(db, `SELECT ${PHOTO_FIELDS} FROM qc_photos WHERE inspection_id=? OR issue_id IN (SELECT id FROM qc_issues WHERE inspection_id=?) ORDER BY taken_at,id`, i.id, i.id);
        i.issues = await all(db, 'SELECT id,type,severity,description,status,created_at FROM qc_issues WHERE inspection_id=? ORDER BY created_at,id', i.id);
      }
      return json({ inspections });
    }
    if (path.startsWith(base + '/photos/')) {
      viewer(member, 'quality_inspector', 'supervisor', 'purchase_manager');
      const photo = await one(db, 'SELECT * FROM qc_photos WHERE id=? AND workspace_id=?', recordId(path.slice((base + '/photos/').length)), w);
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
        query(db, "INSERT INTO qc_lots(id,workspace_id,purchase_order_id,shipment_id,supplier_id,product_id,reference,quantity_milli,unit,supplier_lot,arrived_at,pending_since,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'awaiting_inspection',?,?,?)",
          id, w, orderId, shipmentId, order.supplier_id, productId, reference, quantity, order.unit, supplierLot, arrivedAt, now, member.user_id, now, now),
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
    try {
      // The UPDATE is targeted by id alone: the trigger checks the draft state, quantities and evidence and aborts the whole batch if it loses.
      await db.batch([
        query(db, "UPDATE qc_inspections SET status='submitted',submitted_at=?,updated_at=?,report_status=CASE WHEN accepted_milli>0 THEN 'pending' END,rejection_status=CASE WHEN rejected_milli>0 THEN 'pending' END WHERE id=?", now, now, id),
        lotStatusQuery(db, inspection.lot_id, now),
        notifyRole(db, w, 'supervisor', 'inspection.submitted', 'qc_inspection', id, (await lotRow(db, inspection.lot_id, w)).reference),
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
  fail(404, 'Quality route not found.');
}
