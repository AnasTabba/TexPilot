import { all, one, query, json, fail, text, multiline, keys, integer, date, email, phone, website, recordId, allow, reason as decisionReason, role, viewer, audit } from './erp-utils.mjs';
import { trackingConfigured, trackingStatus } from './tracking.mjs';
import { sha256 } from './auth.mjs';
import { settingsOf, needsApproval, approvalQueries } from './governance.mjs';
import { notifyRole } from './notify.mjs';

export const categories = db => all(db, 'SELECT * FROM supplier_categories ORDER BY sort_order');
export async function categoryIds(db, value) {
  if (Array.isArray(value) && value.length > 9) fail(422, 'Choose at most 9 categories.');
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string')) fail(422, 'Choose at least one yarn category.');
  const ids = [...new Set(value)]; const valid = await categories(db);
  if (ids.some(id => !valid.some(c => c.id === id))) fail(422, 'Choose valid yarn categories.');
  return ids;
}
export const categoryQueries = (db, supplierId, ids) => [query(db, 'DELETE FROM supplier_category_links WHERE supplier_id=?', supplierId),
  ...ids.map(id => query(db, 'INSERT INTO supplier_category_links(supplier_id,category_id) VALUES(?,?)', supplierId, id))];
export async function supplierView(db, value) {
  if (!value) return null;
  return { ...value, categories: (await all(db, 'SELECT category_id FROM supplier_category_links WHERE supplier_id=? ORDER BY category_id', value.id)).map(c => c.category_id) };
}
// Each rating counts its three criteria; legacy single-score rows (NULL criteria) count their score for all three.
const RATED = 'SELECT workspace_id,supplier_id,COALESCE(delivery,rating) AS d,COALESCE(quality,rating) AS q,COALESCE(terms,rating) AS t FROM supplier_ratings';
const round1 = value => Math.round(value * 10) / 10;
const supplierFields = 'id,workspace_id,name,contact_name,email,phone,city,website,source_url,source_checked_at,status,version,created_at,updated_at';
const LISTED = ['pending','approved','rejected','suspended'];
// pending→approved|rejected, approved↔suspended; everything else is final or must go through the supplier again.
const MOVES = { pending: ['approved','rejected'], approved: ['suspended'], suspended: ['approved'], rejected: [] };
export async function suppliers(db, workspaceId, status, category) {
  if (status && !LISTED.includes(status)) fail(422, 'Choose pending, approved, rejected or suspended.');
  if (category) await categoryIds(db, [category]);
  const aggregates = new Map((await all(db, `SELECT supplier_id,COUNT(*) AS count,AVG((d+q+t)/3.0) AS average,AVG(d) AS delivery,AVG(q) AS quality,AVG(t) AS terms FROM (${RATED} WHERE workspace_id=?) GROUP BY supplier_id`, workspaceId))
    .map(r => [r.supplier_id, { average: round1(r.average), delivery: round1(r.delivery), quality: round1(r.quality), terms: round1(r.terms), count: r.count }]));
  return Promise.all((await all(db, `SELECT ${supplierFields} FROM suppliers WHERE workspace_id=? AND status IN (${LISTED.map(() => '?').join(',')}) AND (? IS NULL OR status=?) AND (? IS NULL OR id IN (SELECT supplier_id FROM supplier_category_links WHERE category_id=?)) ORDER BY name COLLATE NOCASE LIMIT 500`,
    workspaceId, ...LISTED, status || null, status || null, category || null, category || null)).map(async s => ({ ...await supplierView(db, s), rating: aggregates.get(s.id) ?? null })));
}
export async function supplierPerformance(db, supplierId) {
  const { average, n } = await one(db, `SELECT AVG((d+q+t)/3.0) AS average, COUNT(*) AS n FROM (${RATED} WHERE supplier_id=?)`, supplierId);
  // Final dispositions of settled lots only: accepted reports and deviation acceptances count as accepted, confirmed rejections as rejected.
  // Returned or re-inspect quantities count as neither, and the lot stays out until its replacement inspection settles it, so nothing is counted twice.
  const qc = await one(db, `SELECT COALESCE(SUM(CASE WHEN i.report_status='accepted' THEN i.accepted_milli END),0) + COALESCE(SUM(CASE WHEN i.rejection_status='dismissed' AND i.dismiss_outcome='accept_with_deviation' THEN i.rejected_milli END),0) AS accepted,
    COALESCE(SUM(CASE WHEN i.rejection_status='confirmed' THEN i.rejected_milli END),0) AS rejected
    FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id WHERE l.supplier_id=? AND l.status='settled' AND i.status='submitted'`, supplierId);
  const arrivals = await one(db, `SELECT COUNT(*) AS total, COALESCE(SUM(arrived_at<=due),0) AS on_time FROM (SELECT l.arrived_at, json_extract(p.terms_snapshot,'$.delivery_at') AS due FROM qc_lots l JOIN supplier_purchase_orders p ON p.id=l.purchase_order_id WHERE l.supplier_id=?) WHERE due IS NOT NULL`, supplierId);
  const claims = { return: 0, replacement: 0, claim: 0 };
  for (const row of await all(db, "SELECT outcome, COUNT(*) AS n FROM claims WHERE supplier_id=? AND status='decided' GROUP BY outcome", supplierId)) claims[row.outcome] = row.n;
  return { manualAverage: n ? Math.round(average * 100) / 100 : null, ratingCount: n, qcPassRate: qc.accepted + qc.rejected ? qc.accepted / (qc.accepted + qc.rejected) : null,
    onTimeRate: arrivals.total ? arrivals.on_time / arrivals.total : null, claims };
}
export function supplierData(data) {
  return { name: text(data.name, 'Company', 2, 120), contact: text(data.contactName, 'Contact name', 2, 80),
    email: email(data.email), phone: phone(data.phone), city: text(data.city ?? '', 'City', 0, 100), website: website(data.website), source: website(data.sourceUrl) };
}
const reference = prefix => `${prefix}-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const orderTotal = (priceMinor, quantityMilli) => Math.round(priceMinor * quantityMilli / 1000);
// Registered QC lots plus legacy receipts not reversed (view po_arrived); a PO can never drop below it. Migration 0013 repeats the floor as a trigger.
const ARRIVED = "(SELECT arrived_milli FROM po_arrived WHERE order_id=supplier_purchase_orders.id)";
// An open RFQ past its deadline reads as closed; cancelled is a closed row with cancelled_at set.
const rfqView = (r, now) => ({ ...r, status: r.cancelled_at ? 'cancelled' : r.status === 'open' && r.deadline_at <= now ? 'closed' : r.status });
// A zero-row conditional write cannot guard later statements, so this aborts the whole batch when the write before it lost.
const lostRace = db => query(db, "SELECT json('!') WHERE changes()=0");
const closeQueries = (db, r, now) => [query(db, "UPDATE procurement_rfqs SET status='closed',closed_at=?,updated_at=? WHERE id=? AND status='open' AND cancelled_at IS NULL", now, now, r.id), lostRace(db),
  notifyRole(db, r.workspace_id, 'purchase_manager', 'bidding.closed', 'rfq', r.id, r.reference)];
// A change to the arrived quantity also moves the status: covered means received, and an increase reopens a received order.
const REOPENED = "CASE WHEN EXISTS(SELECT 1 FROM shipments s WHERE s.purchase_order_id=supplier_purchase_orders.id) OR EXISTS(SELECT 1 FROM procurement_shipments s WHERE s.purchase_order_id=supplier_purchase_orders.id) THEN 'dispatched' ELSE 'accepted' END";
const quantityUpdate = (db, orderId, pin, quantity, total, now) => query(db, `UPDATE supplier_purchase_orders SET quantity_milli=?,total_minor=?,approval_status='approved',version=version+1,updated_at=?,
  status=CASE WHEN ?<=${ARRIVED} THEN 'received' WHEN status='received' THEN ${REOPENED} ELSE status END
  WHERE id=? AND version=? AND quantity_milli=? AND approval_status=? AND status!='cancelled' AND ?>=${ARRIVED}`, quantity, total, now, quantity, orderId, pin.version, pin.from, pin.status, quantity);
const quantityAudit = (db, member, order, quantity, total, intervention = null) => audit(db, member, 'po.quantity_changed', order.id, {}, 'staff',
  { before: { quantity_milli: order.quantity_milli, total_minor: order.total_minor }, after: { quantity_milli: quantity, total_minor: total }, intervention });
// The one writer of a PO. Guards re-read the bid in the committing transaction, so a stale, expired or edited bid aborts everything.
export function poInsertQueries(db, member, { bidId, bidVersion, termsSnapshot: t, currency, acceptedBy = member.user_id, intervention = null }, now) {
  const id = crypto.randomUUID(), w = member.workspace_id, total = orderTotal(t.price_minor, t.quantity_milli);
  return [query(db, `SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM supplier_bids b WHERE b.id=? AND b.version=? AND b.status='submitted' AND b.valid_until>=? AND b.price_minor=? AND b.currency=? AND b.payment_terms=? AND b.delivery_at=? AND b.valid_until=? AND b.note=? AND b.quantity_milli>=?
      AND ?=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=? AND key='currency'),'PKR'))`,
      bidId, bidVersion, now, t.price_minor, t.currency, t.payment_terms, t.delivery_at, t.valid_until, t.note, t.quantity_milli, currency, w),
    query(db, "INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at,quantity_milli,total_minor,approval_status,version,updated_at,created_by) VALUES(?,?,?,?,?,?,?,'accepted',?,?,?,?,'approved',1,?,?)",
      id, w, t.rfq_id, bidId, t.supplier_id, reference('PO'), JSON.stringify(t), acceptedBy, now, t.quantity_milli, total, now, acceptedBy),
    query(db, "UPDATE procurement_rfqs SET status='awarded',updated_at=? WHERE id=? AND status IN ('open','closed') AND cancelled_at IS NULL", now, t.rfq_id), lostRace(db),
    notifyRole(db, w, 'purchase_manager', 'po.created', 'purchase_order', id, t.title, member.user_id),
    notifyRole(db, w, 'admin', 'po.created', 'purchase_order', id, t.title, member.user_id),
    audit(db, member, 'po.created', id, { bidId, bidVersion }, 'staff', { objectType: 'po', after: { total_minor: total, quantity_milli: t.quantity_milli }, intervention })];
}
const sameCurrency = async (db, workspaceId, currency) => { if ((await settingsOf(db, workspaceId)).currency !== currency) throw new Error('currency changed'); };
export const approvalHandlers = {
  purchase_award: {
    async approve(db, member, request, { now }) { await sameCurrency(db, member.workspace_id, request.payload.currency); return poInsertQueries(db, member, { ...request.payload, acceptedBy: request.requested_by }, now); },
    reject: async () => [],
    async describe(db, request) {
      const p = request.payload, rfq = await one(db, 'SELECT * FROM procurement_rfqs WHERE id=? AND workspace_id=?', request.object_id, request.workspace_id);
      const bid = await one(db, 'SELECT * FROM supplier_bids WHERE id=?', p.bidId), supplier = await one(db, 'SELECT id,name FROM suppliers WHERE id=?', bid.supplier_id);
      return { objectType: 'rfq', objectId: rfq.id, label: rfq.reference, currency: request.currency, evidence: { rfq: { reference: rfq.reference, title: rfq.title, quantity_milli: rfq.quantity_milli, unit: rfq.unit }, bid, supplier, termsSnapshot: p.termsSnapshot },
        proposed: { bidId: p.bidId, bidVersion: p.bidVersion, totalMinor: request.amount } };
    },
  },
  po_change: {
    async approve(db, member, request, { now }) {
      const p = request.payload; await sameCurrency(db, member.workspace_id, p.currency);
      const order = await one(db, 'SELECT * FROM supplier_purchase_orders WHERE id=? AND workspace_id=?', request.object_id, member.workspace_id);
      if (!order || order.version !== p.poVersion || order.quantity_milli !== p.fromQuantityMilli) throw new Error('order changed');
      const total = orderTotal(JSON.parse(order.terms_snapshot).price_minor, p.quantityMilli);
      return [quantityUpdate(db, order.id, { version: p.poVersion, from: p.fromQuantityMilli, status: 'pending_admin' }, p.quantityMilli, total, now), lostRace(db), quantityAudit(db, member, order, p.quantityMilli, total)];
    },
    async reject(db, member, request, { now }) {
      return [query(db, "UPDATE supplier_purchase_orders SET approval_status='approved',updated_at=? WHERE id=? AND version=? AND approval_status='pending_admin'", now, request.object_id, request.payload.poVersion), lostRace(db)];
    },
    async describe(db, request) {
      const p = request.payload, order = await one(db, `SELECT p.*,s.name AS supplier_name,${ARRIVED.replace('supplier_purchase_orders.id', 'p.id')} AS arrived FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=? AND p.workspace_id=?`, request.object_id, request.workspace_id);
      return { objectType: 'purchase_order', objectId: order.id, label: order.reference, currency: request.currency, evidence: { order: { reference: order.reference, supplier: order.supplier_name, quantity_milli: order.quantity_milli, total_minor: order.total_minor, version: order.version }, arrivedQuantityMilli: order.arrived },
        proposed: { quantityMilli: p.quantityMilli, fromQuantityMilli: p.fromQuantityMilli, totalMinor: request.amount } };
    },
  },
};
export async function purchasingScheduled(env, now = Date.now()) {
  const db = env.DB; let closed = 0;
  for (const r of await all(db, "SELECT * FROM procurement_rfqs WHERE status='open' AND cancelled_at IS NULL AND deadline_at<=?", now)) {
    try { await db.batch([...closeQueries(db, r, now), audit(db, { workspace_id: r.workspace_id, user_id: 'system:purchasing', role: 'system' }, 'rfq.closed', r.id, { reason: 'deadline' }, 'staff', { before: { status: 'open' }, after: { status: 'closed' } })]); closed++; }
    catch (error) {
      // Only the zero-row guard followed by an ineligible RFQ is a lost close race.
      if (!/malformed JSON/i.test(error.message)) throw error;
      const current = await one(db, 'SELECT status,cancelled_at FROM procurement_rfqs WHERE id=?', r.id);
      if (!current || (current.status === 'open' && current.cancelled_at === null)) throw error;
    }
  }
  return { closed };
}
export async function staffProcurement(request, env, member, path, data) {
  const db = env.DB; const w = member.workspace_id; const now = Date.now();
  if (path === '/api/erp/categories' && !data) { viewer(member, 'purchase_manager'); return json({ categories: await categories(db) }); }
  if (path.startsWith('/api/erp/suppliers')) {
    const listed = async id => { const s = await one(db, `SELECT ${supplierFields} FROM suppliers WHERE id=? AND workspace_id=? AND status IN (${LISTED.map(() => '?').join(',')})`, id, w, ...LISTED); if (!s) fail(404, 'Supplier not found.'); return s; };
    if (!data) {
      viewer(member, 'purchase_manager');
      if (path === '/api/erp/suppliers') { const q = new URL(request.url).searchParams; return json({ suppliers: await suppliers(db, w, q.get('status'), q.get('category')) }); }
      const id = path.slice('/api/erp/suppliers/'.length);
      if (!id.includes('/')) {
        const s = await listed(recordId(id));
        const ratings = await all(db, 'SELECT r.rating,r.delivery,r.quality,r.terms,r.feedback,u.name AS created_by_name,r.created_at FROM supplier_ratings r LEFT JOIN users u ON u.id=r.created_by WHERE r.supplier_id=? ORDER BY r.created_at DESC,r.id', s.id);
        return json({ supplier: await supplierView(db, s), ratings, performance: await supplierPerformance(db, s.id) });
      }
    }
    if (path === '/api/erp/suppliers/review' && data) {
      const intervention = role(member, data, 'purchase_manager');
      keys(data, ['id','status','reason','categories','version','interventionReason']);
      const s = await one(db, 'SELECT * FROM suppliers WHERE id=? AND workspace_id=?', recordId(data.id), w);
      if (!s) fail(404, 'Supplier not found.');
      if (!['approved','rejected','suspended'].includes(data.status)) fail(422, 'Choose approved, rejected or suspended.');
      if (!LISTED.includes(s.status)) fail(409, 'This directory contact has no supplier registration to review.');
      if (!MOVES[s.status].includes(data.status)) fail(409, `This supplier cannot move from ${s.status} to ${data.status}.`);
      const reason = ['rejected','suspended'].includes(data.status) || data.reason !== undefined ? decisionReason(data.reason, 'Review reason') : ''; const version = integer(data.version, 'Version');
      const ids = await categoryIds(db, data.categories ?? (await supplierView(db,s)).categories);
      if(s.version!==version) fail(409,'Supplier changed. Reload before reviewing.');
      try { await db.batch([query(db, 'UPDATE suppliers SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?', data.status,now,s.id,w,version),
        lostRace(db),
        query(db,'INSERT INTO supplier_registration_reviews(id,supplier_id,version,status,reason,actor_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),s.id,version+1,data.status,reason,member.user_id,member.user_id,now,now),
        ...categoryQueries(db,s.id,ids), query(db, 'DELETE FROM supplier_sessions WHERE user_id IN (SELECT id FROM supplier_users WHERE supplier_id=?)', s.id),
        audit(db,member,`supplier.${data.status}`,s.id,{reason,categories:ids,previousStatus:s.status},'staff',{reason,before:{status:s.status},after:{status:data.status},intervention})]); }
      catch { fail(409,'Supplier changed. Reload before reviewing.'); }
      return json({ saved: true });
    }
    if (path === '/api/erp/suppliers/profile' && data) {
      const intervention = role(member, data, 'purchase_manager');
      keys(data, ['id','version','contactName','phone','city','website','categories','interventionReason']);
      const s = await listed(recordId(data.id)); const version = integer(data.version, 'Version');
      const edits = {};
      if (data.contactName !== undefined) edits.contact_name = text(data.contactName, 'Contact name', 2, 80);
      if (data.phone !== undefined) edits.phone = phone(data.phone);
      if (data.city !== undefined) edits.city = text(data.city, 'City', 0, 100);
      if (data.website !== undefined) edits.website = website(data.website);
      const ids = data.categories === undefined ? null : await categoryIds(db, data.categories);
      if (!Object.keys(edits).length && !ids) fail(422, 'Change at least one profile field.');
      if (s.version !== version) fail(409, 'Supplier changed. Reload before editing.');
      const before = Object.fromEntries(Object.keys(edits).map(k => [k, s[k]])), after = { ...edits };
      if (ids) { before.categories = (await supplierView(db, s)).categories; after.categories = [...ids].sort(); }
      // Preserve the registration replay hash; a lost conditional update aborts the batch.
      try { await db.batch([query(db, `UPDATE suppliers SET ${[...Object.keys(edits).map(k => k + '=?'), 'version=version+1', 'updated_at=?'].join(',')} WHERE id=? AND workspace_id=? AND version=?`, ...Object.values(edits), now, s.id, w, version),
        // The UPDATE lost a race: this malformed-JSON error rolls the whole batch back.
        lostRace(db),
        ...(ids ? categoryQueries(db, s.id, ids) : []),
        audit(db, member, 'supplier.profile_updated', s.id, {}, 'staff', { before, after, intervention })]); }
      catch { fail(409, 'Supplier changed. Reload before editing.'); }
      return json({ supplier: await supplierView(db, await one(db, `SELECT ${supplierFields} FROM suppliers WHERE id=?`, s.id)) });
    }
    if (path === '/api/erp/suppliers/ratings' && data) {
      const intervention = role(member, data, 'purchase_manager');
      keys(data, ['id','supplierId','delivery','quality','terms','comment','orderId','interventionReason']);
      const id = recordId(data.id), s = await one(db, 'SELECT * FROM suppliers WHERE id=? AND workspace_id=?', recordId(data.supplierId), w);
      if (!s) fail(404, 'Supplier not found.');
      if (s.status !== 'approved') fail(409, 'Only an approved supplier can be rated.');
      const delivery = integer(data.delivery, 'Delivery rating', 1, 5), quality = integer(data.quality, 'Quality rating', 1, 5), terms = integer(data.terms, 'Terms rating', 1, 5);
      const comment = data.comment === undefined ? '' : multiline(data.comment, 'Comment', 0, 500);
      const orderId = data.orderId == null ? null : recordId(data.orderId);
      if (orderId && !await one(db, 'SELECT id FROM supplier_purchase_orders WHERE id=? AND supplier_id=? AND workspace_id=?', orderId, s.id, w)) fail(404, 'Purchase order not found.');
      const rating = Math.round((delivery + quality + terms) / 3);
      const previous = await one(db, 'SELECT * FROM supplier_ratings WHERE id=?', id);
      if (previous) { if (previous.supplier_id !== s.id || previous.delivery !== delivery || previous.quality !== quality || previous.terms !== terms || previous.feedback !== comment || previous.order_id !== orderId) fail(409, 'This record ID was already used for a different rating.'); return json({ saved: true }); }
      await db.batch([query(db, 'INSERT INTO supplier_ratings(id,workspace_id,supplier_id,rating,feedback,status,created_by,created_at,updated_at,delivery,quality,terms,order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, w, s.id, rating, comment, 'active', member.user_id, now, now, delivery, quality, terms, orderId),
        notifyRole(db, w, 'purchase_manager', 'supplier.rated', 'supplier', s.id, s.name, member.user_id),
        notifyRole(db, w, 'admin', 'supplier.rated', 'supplier', s.id, s.name, member.user_id),
        audit(db, member, 'supplier.rated', s.id, { delivery, quality, terms, comment, orderId }, 'staff', { intervention })]);
      return json({ saved: true });
    }
    if (path === '/api/erp/suppliers/rate' && data) {
      const intervention = role(member, data, 'purchase_manager');
      keys(data, ['id','supplierId','rating','feedback','interventionReason']);
      const id = recordId(data.id), s = await listed(recordId(data.supplierId)), rating = integer(data.rating, 'Rating', 1, 5), feedback = data.feedback === undefined ? '' : multiline(data.feedback, 'Feedback', 0, 1000);
      const previous = await one(db, 'SELECT * FROM supplier_ratings WHERE id=?', id);
      if (previous) { if (previous.supplier_id !== s.id || previous.rating !== rating || previous.feedback !== feedback) fail(409, 'This record ID was already used for a different rating.'); return json({ saved: true }); }
      await db.batch([query(db, 'INSERT INTO supplier_ratings(id,workspace_id,supplier_id,rating,feedback,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, w, s.id, rating, feedback, 'active', member.user_id, now, now),
        notifyRole(db, w, 'purchase_manager', 'supplier.rated', 'supplier', s.id, s.name, member.user_id),
        notifyRole(db, w, 'admin', 'supplier.rated', 'supplier', s.id, s.name, member.user_id),
        audit(db, member, 'supplier.rated', s.id, { rating, feedback }, 'staff', { intervention })]);
      return json({ saved: true });
    }
    fail(404, 'Supplier route not found.');
  }
  if (path === '/api/erp/procurement' && !data) {
    viewer(member, 'purchase_manager');
    const rfqs = await all(db, `SELECT r.*,(SELECT COUNT(*) FROM rfq_recipients WHERE rfq_id=r.id) AS recipient_count,(SELECT COUNT(*) FROM supplier_bids WHERE rfq_id=r.id) AS bid_count FROM procurement_rfqs r WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100`,w);
    const bids = await all(db, 'SELECT b.*,s.name AS supplier_name FROM supplier_bids b JOIN suppliers s ON s.id=b.supplier_id JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE r.workspace_id=? ORDER BY b.updated_at DESC LIMIT 500',w);
    const orders = await all(db, 'SELECT p.*,s.name AS supplier_name FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 100',w);
    const shipments = await all(db, 'SELECT * FROM procurement_shipments WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100',w);
    return json({ rfqs:rfqs.map(r=>rfqView(r,now)),bids,orders:orders.map(o=>({...o,terms:JSON.parse(o.terms_snapshot)})),shipments,currency:(await settingsOf(db,w)).currency,tracking:{...trackingStatus(env),reason:trackingConfigured(env)?'':'Tracking API key and provider contract must be configured before a lookup.'} });
  }
  if (path === '/api/erp/orders/pending-approvals' && !data) {
    viewer(member, 'purchase_manager');
    const pending = type => all(db, "SELECT * FROM approval_requests WHERE workspace_id=? AND type=? AND status='pending' ORDER BY created_at,id", w, type);
    const common = a => ({ approvalId: a.id, amount: a.amount, currency: a.currency, threshold: a.threshold, status: 'pending', created_at: a.created_at });
    return json({ awards: (await pending('purchase_award')).map(a => { const p = JSON.parse(a.payload_json); return { approvalId: a.id, rfqId: a.object_id, bidId: p.bidId, bidVersion: p.bidVersion, ...common(a) }; }),
      changes: (await pending('po_change')).map(a => { const p = JSON.parse(a.payload_json); return { approvalId: a.id, orderId: a.object_id, quantityMilli: p.quantityMilli, fromQuantityMilli: p.fromQuantityMilli, ...common(a) }; }) });
  }
  if (path === '/api/erp/rfqs' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','title','categoryId','specifications','quantityMilli','unit','deliveryLocation','deadlineAt','requestedDeliveryAt','interventionReason']);
    const id = recordId(data.id); const c = (await categoryIds(db,[data.categoryId]))[0];
    const existing = await one(db,'SELECT * FROM procurement_rfqs WHERE id=?',id);
    const normalized = {title:text(data.title,'RFQ title',3,120),category:c,specifications:multiline(data.specifications,'Specifications',5,4000),quantity:integer(data.quantityMilli,'Quantity'),unit:data.unit,location:data.deliveryLocation===undefined?'':text(data.deliveryLocation,'Delivery location',3,200),deadline:date(data.deadlineAt,'Bid deadline'),delivery:date(data.requestedDeliveryAt,'Requested delivery')};
    if (!['kg','tonne'].includes(normalized.unit)) fail(422,'Choose kg or tonne.');
    if (normalized.delivery < normalized.deadline) fail(422,'Delivery must be after the bid deadline.');
    const digest=await sha256(JSON.stringify(normalized));
    if (existing) { if (existing.workspace_id!==w||existing.request_hash!==digest) fail(409,'Record ID was used for different RFQ values.'); return json({rfq:existing}); }
    date(normalized.deadline,'Bid deadline',true);date(normalized.delivery,'Requested delivery',true);
    await db.batch([query(db,'INSERT INTO procurement_rfqs(id,workspace_id,reference,title,category_id,specifications,quantity_milli,unit,delivery_location,deadline_at,requested_delivery_at,status,request_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,w,reference('RFQ'),normalized.title,c,normalized.specifications,normalized.quantity,normalized.unit,normalized.location,normalized.deadline,normalized.delivery,'draft',digest,member.user_id,now,now),audit(db,member,'rfq.created',id,normalized,'staff',{intervention})]);
    return json({rfq:await one(db,'SELECT * FROM procurement_rfqs WHERE id=?',id)},201);
  }
  if (path === '/api/erp/rfqs/publish' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','interventionReason']); const r = await one(db,'SELECT * FROM procurement_rfqs WHERE id=? AND workspace_id=?',recordId(data.id),w);
    if (!r) fail(404,'RFQ not found.');
    if (r.status==='open') return json({published:true,recipients:(await one(db,'SELECT COUNT(*) AS n FROM rfq_recipients WHERE rfq_id=?',r.id)).n});
    if (r.status!=='draft'||r.deadline_at<=now) fail(409,'Only a draft with a future deadline can be published.');
    const eligible = await all(db, "SELECT s.* FROM suppliers s JOIN supplier_category_links c ON c.supplier_id=s.id WHERE s.workspace_id=? AND s.status='approved' AND c.category_id=?",w,r.category_id);
    if (!eligible.length) fail(409,'No approved suppliers match this category. Approve suppliers first.');
    await db.batch([...eligible.map(s=>query(db, "INSERT OR IGNORE INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM procurement_rfqs WHERE id=? AND status='draft') AND EXISTS(SELECT 1 FROM suppliers WHERE id=? AND status='approved')",r.id,s.id,JSON.stringify({name:s.name,email:s.email,phone:s.phone}),now,r.id,s.id)),
      query(db,"UPDATE procurement_rfqs SET status='open',published_at=?,updated_at=? WHERE id=? AND status='draft' AND EXISTS(SELECT 1 FROM rfq_recipients WHERE rfq_id=?)",now,now,r.id,r.id),audit(db,member,'rfq.opened',r.id,{channel:'supplier_portal',recipients:eligible.map(s=>s.id)},'staff',{before:{status:'draft'},after:{status:'open'},intervention})]);
    if((await one(db,'SELECT status FROM procurement_rfqs WHERE id=?',r.id)).status!=='open')fail(409,'No eligible supplier remained when publishing. Reload and review supplier access.');
    return json({published:true,recipients:(await one(db,'SELECT COUNT(*) AS n FROM rfq_recipients WHERE rfq_id=?',r.id)).n});
  }
  if (path === '/api/erp/rfqs/close' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','interventionReason']); const r = await one(db,'SELECT * FROM procurement_rfqs WHERE id=? AND workspace_id=?',recordId(data.id),w);
    if (!r) fail(404,'RFQ not found.');
    if (r.status!=='open'||r.cancelled_at) fail(409,'Only an open RFQ can be closed.');
    try { await db.batch([...closeQueries(db,r,now),audit(db,member,'rfq.closed',r.id,{},'staff',{before:{status:'open'},after:{status:'closed'},intervention})]); }
    catch { fail(409,'The RFQ changed. Reload first.'); }
    return json({closed:true});
  }
  if (path === '/api/erp/rfqs/cancel' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','reason','interventionReason']); const r = await one(db,'SELECT * FROM procurement_rfqs WHERE id=? AND workspace_id=?',recordId(data.id),w);
    if (!r) fail(404,'RFQ not found.');
    const reason=decisionReason(data.reason,'Cancellation reason');
    if (r.status==='awarded'||r.cancelled_at) fail(409,'An awarded or cancelled RFQ cannot be cancelled.');
    try { await db.batch([query(db,"UPDATE procurement_rfqs SET status='closed',cancelled_at=?,cancel_reason=?,closed_at=COALESCE(closed_at,?),updated_at=? WHERE id=? AND status!='awarded' AND cancelled_at IS NULL",now,reason,now,now,r.id),lostRace(db),
      audit(db,member,'rfq.cancelled',r.id,{},'staff',{reason,before:{status:r.status},after:{status:'cancelled'},intervention})]); }
    catch { fail(409,'The RFQ changed. Reload first.'); }
    return json({cancelled:true});
  }
  if (path === '/api/erp/bids/reject' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','version','reason','interventionReason']);
    const b = await one(db,'SELECT b.* FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE b.id=? AND r.workspace_id=?',recordId(data.id),w);
    if(!b) fail(404,'Bid not found.');
    const reason=decisionReason(data.reason,'Rejection reason'), version=integer(data.version,'Version');
    if(b.status==='rejected') fail(409,'This bid was already rejected.');
    try { await db.batch([query(db,"UPDATE supplier_bids SET status='rejected',rejection_reason=?,updated_at=? WHERE id=? AND version=? AND status='submitted' AND EXISTS(SELECT 1 FROM procurement_rfqs WHERE id=supplier_bids.rfq_id AND status IN ('open','closed') AND cancelled_at IS NULL)",reason,now,b.id,version),lostRace(db),
      audit(db,member,'bid.rejected',b.id,{},'staff',{reason,intervention})]); }
    catch { fail(409,'The bid or RFQ changed. Reload first.'); }
    return json({saved:true});
  }
  if (path === '/api/erp/bids/award' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','version','interventionReason']); const bid = await one(db,'SELECT b.*,r.workspace_id,r.reference AS rfq_reference,r.title,r.specifications,r.unit,r.quantity_milli AS required_quantity FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE b.id=? AND r.workspace_id=?',recordId(data.id),w);
    if(!bid) fail(404,'Bid not found.');
    const previous=await one(db,'SELECT * FROM supplier_purchase_orders WHERE rfq_id=?',bid.rfq_id);
    if(previous) {if(previous.bid_id!==bid.id||JSON.parse(previous.terms_snapshot).accepted_bid_version!==data.version) fail(409,'Another bid or revision has already been accepted.'); return json({order:previous});}
    const rfq=await one(db,'SELECT status,cancelled_at FROM procurement_rfqs WHERE id=?',bid.rfq_id), settings=await settingsOf(db,w);
    if(rfq.cancelled_at||!['open','closed'].includes(rfq.status)) fail(409,'This RFQ is not open for awarding.');
    if(bid.currency!==settings.currency) fail(409,`This bid is in ${bid.currency}, but the factory currency is ${settings.currency}.`);
    if(bid.status!=='submitted'||bid.valid_until<now||bid.version!==data.version||bid.quantity_milli<bid.required_quantity) fail(409,'Use a current, valid bid covering the full requested quantity.');
    if(await one(db,"SELECT id FROM approval_requests WHERE object_type='rfq' AND object_id=? AND status='pending'",bid.rfq_id)) fail(409,'An award for this RFQ is waiting for admin approval.');
    const award={bidId:bid.id,bidVersion:bid.version,termsSnapshot:{...bid,quantity_milli:bid.required_quantity,accepted_bid_version:bid.version},currency:settings.currency};
    const total=orderTotal(bid.price_minor,bid.required_quantity), gate=await needsApproval(db,w,'purchase',total);
    // Each side re-checks the other inside its transaction: a pending request blocks an immediate PO and a PO blocks a new request.
    const pending=query(db,"SELECT json('!') WHERE EXISTS(SELECT 1 FROM approval_requests WHERE object_type='rfq' AND object_id=? AND status='pending')",bid.rfq_id);
    const awarded=query(db,"SELECT json('!') WHERE EXISTS(SELECT 1 FROM supplier_purchase_orders WHERE rfq_id=?)",bid.rfq_id);
    const approvalId=crypto.randomUUID();
    try {
      await db.batch(gate.required ? [awarded,...approvalQueries(db,member,{id:approvalId,type:'purchase_award',objectType:'rfq',objectId:bid.rfq_id,amount:total,threshold:gate.threshold,unit:'minor',payload:award},now)] : [pending,...poInsertQueries(db,member,{...award,intervention},now)]);
    } catch {
      const raced=await one(db,'SELECT * FROM supplier_purchase_orders WHERE rfq_id=?',bid.rfq_id);
      if(raced?.bid_id===bid.id) return json({order:raced});
      fail(409,'Another award won, or the bid changed. Reload the RFQ.');
    }
    if(gate.required) return json({pendingApproval:true,approvalId},202);
    const order=await one(db,'SELECT * FROM supplier_purchase_orders WHERE rfq_id=?',bid.rfq_id);
    if(!order) fail(409,'The bid or supplier status changed. Reload before accepting.');
    return json({order},201);
  }
  if (path === '/api/erp/orders/quantity' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data,['id','version','quantityMilli','interventionReason']);
    const order = await one(db,'SELECT * FROM supplier_purchase_orders WHERE id=? AND workspace_id=?',recordId(data.id),w);
    if (!order) fail(404,'Purchase order not found.');
    const version=integer(data.version,'Version'), quantity=integer(data.quantityMilli,'Quantity');
    if (order.version!==version) fail(409,'The order changed. Reload before changing it.');
    if (order.approval_status==='pending_admin') fail(409,'A quantity change for this order is already waiting for admin approval.');
    if (order.status==='cancelled') fail(409,'A cancelled order cannot change.');
    if (quantity===order.quantity_milli) fail(422,'Choose a different quantity.');
    const terms=JSON.parse(order.terms_snapshot), settings=await settingsOf(db,w);
    if (terms.currency!==settings.currency) fail(409,`This order is in ${terms.currency}, but the factory currency is ${settings.currency}.`);
    const { arrived } = await one(db,`SELECT ${ARRIVED} AS arrived FROM supplier_purchase_orders WHERE id=?`,order.id);
    if (quantity<arrived) fail(409,'This order has already received more than that quantity.');
    const total=orderTotal(terms.price_minor,quantity), gate=await needsApproval(db,w,'purchase',total), approvalId=crypto.randomUUID();
    const pin={version,from:order.quantity_milli,status:'approved'};
    try {
      await db.batch(gate.required ? [query(db,"UPDATE supplier_purchase_orders SET approval_status='pending_admin',updated_at=? WHERE id=? AND version=? AND quantity_milli=? AND approval_status='approved' AND status!='cancelled'",now,order.id,version,order.quantity_milli),lostRace(db),
        ...approvalQueries(db,member,{id:approvalId,type:'po_change',objectType:'purchase_order',objectId:order.id,amount:total,threshold:gate.threshold,unit:'minor',payload:{quantityMilli:quantity,fromQuantityMilli:order.quantity_milli,poVersion:version,currency:settings.currency}},now)]
        : [quantityUpdate(db,order.id,pin,quantity,total,now),lostRace(db),quantityAudit(db,member,order,quantity,total,intervention)]);
    } catch { fail(409,'The order changed, or goods have arrived since. Reload before changing it.'); }
    if (gate.required) return json({pendingApproval:true,approvalId},202);
    return json({order:await one(db,'SELECT * FROM supplier_purchase_orders WHERE id=?',order.id)});
  }
  fail(404,'Procurement route not found.');
}

export async function submitBid(db, supplier, actor, data, now) {
  const sid = supplier.id;
  if (supplier.workspace_id !== actor.workspace_id || actor.role !== 'supplier') fail(403, 'Supplier identity does not match.');
  if (supplier.status !== 'approved') fail(403, 'The purchase manager must approve your supplier account before bidding.');
  keys(data,['id','rfqId','version','quantityMilli','priceMinor','currency','paymentTerms','deliveryAt','validUntil','note']);
  const r=await one(db,"SELECT r.* FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id WHERE r.id=? AND x.supplier_id=? AND r.workspace_id=?",recordId(data.rfqId),sid,actor.workspace_id);
  if(!r) fail(404,'RFQ not found.');
  const id=recordId(data.id); const previous=await one(db,'SELECT * FROM supplier_bids WHERE rfq_id=? AND supplier_id=?',r.id,sid);
  const quantity=integer(data.quantityMilli,'Offered quantity'); const price=integer(data.priceMinor,'Rate');
  if(quantity<r.quantity_milli) fail(422,'Offer the full requested quantity; partial awards are not supported yet.');
  if(!['PKR','USD','EUR','GBP'].includes(data.currency)) fail(422,'Choose a supported currency.');
  const version=integer(data.version,'Version',0); if(previous&&previous.id!==id) fail(409,'A bid already exists. Reload it before editing.');
  const payment=multiline(data.paymentTerms,'Payment terms',3,1000), delivery=date(data.deliveryAt,'Delivery date'), valid=date(data.validUntil,'Valid until'), note=multiline(data.note??'','Note',0,2000);
  const snapshot=JSON.stringify({quantity_milli:quantity,price_minor:price,currency:data.currency,payment_terms:payment,delivery_at:delivery,valid_until:valid,note});
  const replay = async () => {
    const saved = await one(db, 'SELECT h.snapshot,b.* FROM supplier_bid_history h JOIN supplier_bids b ON b.id=h.bid_id JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE h.bid_id=? AND h.version=? AND b.supplier_id=? AND b.rfq_id=? AND r.workspace_id=?', id, version+1, sid, r.id, actor.workspace_id);
    if (!saved) return null;
    if (saved.snapshot !== snapshot) fail(409,'This bid changed. Reload before editing.');
    const { snapshot: ignored, ...bid } = saved; return { bid, created: false };
  };
  const repeated = await replay(); if (repeated) return repeated;
  if(r.status!=='open'||r.cancelled_at||r.deadline_at<=now) fail(409,'This RFQ is no longer open for bids.');
  if(previous?.status==='rejected') fail(409,'This bid was rejected. Contact the purchase manager.');
  const { currency } = await settingsOf(db,actor.workspace_id);
  if(data.currency!==currency) fail(422,`Bid in ${currency}.`);
  if((previous?.version??0)!==version) fail(409,'This bid changed. Reload before editing.');
  date(delivery,'Delivery date',true);date(valid,'Valid until',true);
  const write=previous ? query(db,'UPDATE supplier_bids SET quantity_milli=?,price_minor=?,currency=?,payment_terms=?,delivery_at=?,valid_until=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=?',quantity,price,data.currency,payment,delivery,valid,note,now,id,version)
    : query(db,"INSERT INTO supplier_bids(id,rfq_id,supplier_id,quantity_milli,price_minor,currency,payment_terms,delivery_at,valid_until,note,version,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,'submitted',?,?,?)",id,r.id,sid,quantity,price,data.currency,payment,delivery,valid,note,'supplier:'+actor.user_id,now,now);
  try {await db.batch([
    query(db, `SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id JOIN suppliers s ON s.id=x.supplier_id WHERE r.id=? AND r.workspace_id=? AND s.id=? AND s.workspace_id=r.workspace_id AND s.status='approved' AND r.status='open' AND r.cancelled_at IS NULL AND r.deadline_at>? AND ?=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=r.workspace_id AND key='currency'),'PKR'))`, r.id, actor.workspace_id, sid, now, data.currency),
    write, lostRace(db),
    query(db,"INSERT INTO supplier_bid_history(id,bid_id,version,snapshot,actor_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'recorded',?,?,?)",crypto.randomUUID(),id,version+1,snapshot,actor.user_id,actor.user_id,now,now),
    audit(db,actor,'bid.submitted',id,{version:version+1},'supplier'),notifyRole(db,actor.workspace_id,'purchase_manager','bid.received','bid',id,r.reference)]);}
  catch { const raced = await replay(); if (raced) return raced; fail(409,'The RFQ or bid changed. Reload and retry.'); }
  return { bid:await one(db,'SELECT * FROM supplier_bids WHERE id=? AND supplier_id=?',id,sid), created:true };
}

export async function supplierOperations(request, env, user, path, data) {
  const db=env.DB; const sid=user.supplier_id; const now=Date.now();
  if (user.status!=='approved') fail(403,'An admin must approve your supplier account before you can use RFQs or orders.');
  if(path==='/api/portal/workspace'&&!data) {
    const rfqs=await all(db, "SELECT r.* FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id WHERE x.supplier_id=? ORDER BY r.created_at DESC LIMIT 100",sid);
    const bids=await all(db,'SELECT * FROM supplier_bids WHERE supplier_id=? ORDER BY updated_at DESC LIMIT 100',sid);
    const orders=await all(db,'SELECT * FROM supplier_purchase_orders WHERE supplier_id=? ORDER BY created_at DESC LIMIT 100',sid);
    const shipments=await all(db,'SELECT * FROM procurement_shipments WHERE supplier_id=? ORDER BY created_at DESC LIMIT 100',sid);
    return json({rfqs,bids,orders:orders.map(o=>({...o,terms:JSON.parse(o.terms_snapshot)})),shipments});
  }
  if(path==='/api/portal/bids'&&data) {
    const result = await submitBid(db, { id: sid, workspace_id: user.workspace_id, status: user.status }, { user_id: user.user_id, workspace_id: user.workspace_id, role: 'supplier' }, data, now);
    return json({ bid: result.bid }, result.created && data.version === 0 ? 201 : 200);
  }
  if(path==='/api/portal/dispatches'&&data) {
    keys(data,['id','orderId','billOfLading','carrier','containers','quantityMilli','dispatchedAt','note']);
    const order=await one(db,'SELECT * FROM supplier_purchase_orders WHERE id=? AND supplier_id=? AND workspace_id=?',recordId(data.orderId),sid,user.workspace_id);
    if(!order) fail(404,'Purchase order not found.');
    const id=recordId(data.id), bl=text(data.billOfLading,'Bill of lading',3,100), carrier=text(data.carrier,'Carrier',2,100), qty=integer(data.quantityMilli,'Dispatched quantity'), dispatched=date(data.dispatchedAt,'Dispatch date'), note=multiline(data.note??'','Note',0,2000);
    if(dispatched>now+60000) fail(422,'Dispatch date cannot be in the future.');
    if(!Array.isArray(data.containers)||data.containers.length>100||data.containers.some(c=>typeof c!=='string'||! /^[A-Z]{4}[0-9]{7}$/.test(c))) fail(422,'Use container numbers with four capital letters and seven digits, or leave the list empty.');
    const containers=[...new Set(data.containers)]; const digest=await sha256(JSON.stringify({order:order.id,bl,carrier,qty,dispatched,note,containers}));
    const trackedBl=bl.toUpperCase().replace(/\s+/g,'');
    const previous=await one(db,'SELECT * FROM procurement_shipments WHERE id=?',id);
    if(previous) {if(previous.supplier_id!==sid||previous.request_hash!==digest) fail(409,'This request ID was used for different values.');return json({shipment:previous});}
    try {await db.batch([query(db,'INSERT INTO procurement_shipments(id,workspace_id,purchase_order_id,supplier_id,bill_of_lading,carrier,containers_json,quantity_milli,dispatched_at,note,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,user.workspace_id,order.id,sid,bl,carrier,JSON.stringify(containers),qty,dispatched,note,digest,now),
      query(db,"UPDATE supplier_purchase_orders SET status='dispatched' WHERE id=?",order.id),
      // The supplier's bill of lading also becomes the order's shipment, so Incoming stock can register the arrival without re-entering it.
      query(db,'INSERT INTO shipments(id,workspace_id,purchase_order_id,bill_of_lading,created_by,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM shipments WHERE purchase_order_id=? AND bill_of_lading=?)',id,user.workspace_id,order.id,trackedBl,user.user_id,now,now,order.id,trackedBl),
      query(db,"UPDATE supplier_purchase_orders SET bill_of_lading=?,updated_at=? WHERE id=? AND bill_of_lading=''",trackedBl,now,order.id),
      notifyRole(db,user.workspace_id,'purchase_manager','shipment.dispatched','purchase_order',order.id,order.reference),
      notifyRole(db,user.workspace_id,'admin','shipment.dispatched','purchase_order',order.id,order.reference),
      audit(db,user,'shipment.dispatched',id,{order:order.id,billOfLading:bl},'supplier')]);}
    catch {fail(409,'This dispatch exceeds the order quantity or the order is no longer dispatchable. Reload first.');}
    return json({shipment:await one(db,'SELECT * FROM procurement_shipments WHERE id=?',id)},201);
  }
  fail(404,'Supplier portal route not found.');
}
