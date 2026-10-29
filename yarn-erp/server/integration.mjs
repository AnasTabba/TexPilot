import { all, one, query, json, fail, keys, recordId, readJson, text, multiline, audit } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';
import { supplierData, supplierView, categoryIds, categoryQueries, submitBid } from './procurement.mjs';
import { buyerData, buyerRfqData, recordAcceptance, invoiceFileResponse, paymentStatus } from './sales.mjs';
import { notifyRole } from './notify.mjs';

// Hash both inputs to a fixed length before comparing every byte (including for missing headers).
async function authenticate(request, env, kind) {
  const secret = env[`${kind.toUpperCase()}_PORTAL_TOKEN`];
  if (typeof secret !== 'string' || secret.length < 32) fail(503, `The ${kind} portal connection is not configured.`);
  const supplied = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const [a, b] = await Promise.all([sha256(secret), sha256(supplied)]);
  let different = 0; for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (different) fail(401, 'A valid portal token is required.');
}
const actorOf = (identity, role) => ({ user_id: identity.id, workspace_id: identity.workspace_id, role });
const publicSupplier = async (db, id, w) => supplierView(db, await one(db, 'SELECT id,name,contact_name,email,phone,city,website,status,version FROM suppliers WHERE id=? AND workspace_id=?', id, w));
const publicBuyer = (db, id, w) => one(db, 'SELECT id,name,contact_name,email,phone,city,status,version FROM buyers WHERE id=? AND workspace_id=?', id, w);

export async function integrationApi(request, env, path) {
  const route = path.slice('/api/integration/v1'.length), segment = route.split('/')[1];
  const kind = ['suppliers', 'bids'].includes(segment) ? 'supplier' : ['buyers', 'buyer-rfqs', 'acceptances'].includes(segment) ? 'buyer' : null;
  if (!kind) fail(404, 'Integration route not found.');
  await authenticate(request, env, kind);
  const db = env.DB, now = Date.now(), factories = await all(db, 'SELECT id,name FROM workspaces ORDER BY created_at LIMIT 2');
  if (factories.length !== 1) fail(503, 'The portal connection needs a single factory workspace.');
  const w = factories[0].id, data = request.method === 'POST' ? await readJson(request) : null;
  const identity = async (table, id) => {
    const row = await one(db, `SELECT * FROM ${table} WHERE id=? AND workspace_id=?`, recordId(id), w);
    if (!row) fail(404, `${table === 'suppliers' ? 'Supplier' : 'Buyer'} not found.`); return row;
  };
  if (data && (route === '/suppliers' || route === '/buyers')) {
    const supplier = kind === 'supplier', table = supplier ? 'suppliers' : 'buyers';
    keys(data, ['id', 'company', 'contactName', 'email', 'phone', 'city', ...(supplier ? ['website', 'categories'] : [])]);
    const id = recordId(data.id), value = (supplier ? supplierData : buyerData)({ ...data, name: data.company });
    const categories = supplier ? (await categoryIds(db, data.categories)).sort() : null;
    const hash = await sha256(JSON.stringify({ ...value, ...(supplier ? { categories } : {}) }));
    const view = () => supplier ? publicSupplier(db, id, w) : publicBuyer(db, id, w);
    const replay = async () => {
      const previous = await one(db, `SELECT workspace_id,request_hash FROM ${table} WHERE id=?`, id);
      if (!previous) return null;
      if (previous.workspace_id !== w || previous.request_hash !== hash) fail(409, 'This registration ID was used for different values.');
      return json({ [kind]: await view() });
    };
    const previous = await replay(); if (previous) return previous;
    const actor = { user_id: id, workspace_id: w, role: kind };
    const insert = supplier
      ? query(db, "INSERT INTO suppliers(id,workspace_id,name,contact_name,email,phone,city,website,source_url,status,request_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'','pending',?,?,?,?)", id, w, value.name, value.contact, value.email, value.phone, value.city, value.website, hash, id, now, now)
      : query(db, "INSERT INTO buyers(id,workspace_id,name,contact_name,email,phone,city,notes,status,request_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'','pending',?,?,?,?)", id, w, value.name, value.contact, value.email, value.phone, value.city, hash, id, now, now);
    try { await db.batch([insert, ...(supplier ? categoryQueries(db, id, categories) : []), audit(db, actor, `${kind}.registered`, id, {}, kind), notifyRole(db, w, supplier ? 'purchase_manager' : 'sales_manager', `${kind}.pending`, kind, id, value.name)]); }
    catch { const raced = await replay(); if (raced) return raced; fail(409, 'The registration could not be saved.'); }
    return json({ [kind]: await view() }, 201);
  }
  if (route === '/bids' && data) {
    const { supplierId, ...terms } = data, supplier = await identity('suppliers', supplierId);
    const result = await submitBid(db, supplier, actorOf(supplier, 'supplier'), terms, now);
    return json({ bid: result.bid }, result.created ? 201 : 200);
  }
  if (route === '/buyer-rfqs' && data) {
    keys(data, ['id','buyerId','reference','specifications','quantityMilli','unit','requestedDeliveryAt','paymentTerms']);
    const buyer = await identity('buyers', data.buyerId), id = recordId(data.id);
    if (!['pending','active'].includes(buyer.status)) fail(403, 'Only pending or approved buyers can submit RFQs.');
    const po = buyerRfqData(data, now), hash = await sha256(JSON.stringify(po));
    const result = async status => {
      const row = await one(db, 'SELECT p.id,p.status,b.status AS buyer_status FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id WHERE p.id=?', id);
      return json({ rfq: { id: row.id, state: row.status === 'confirmed' ? 'sold' : row.status === 'cancelled' ? 'closed' : row.status === 'quoted' ? 'quoted' : row.buyer_status === 'pending' ? 'awaiting_buyer_approval' : 'open' } }, status);
    };
    const replay = async () => {
      const previous = await one(db, 'SELECT * FROM buyer_purchase_orders WHERE id=?', id);
      if (!previous) return null;
      if (previous.workspace_id !== w || previous.buyer_id !== buyer.id || previous.request_hash !== hash) fail(409, 'This request ID was used for different RFQ values.');
      return result(200);
    };
    const previous = await replay(); if (previous) return previous;
    try { await db.batch([
      query(db, "SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM buyers WHERE id=? AND workspace_id=? AND status=?)", buyer.id, w, buyer.status),
      query(db, "INSERT INTO buyer_purchase_orders(id,workspace_id,buyer_id,reference,specifications,quantity_milli,unit,requested_delivery_at,payment_terms,status,source,request_hash,created_by,actor_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'entered','buyer_portal',?,?,'buyer',?,?)", id, w, buyer.id, po.reference, po.specifications, po.quantity, po.unit, po.delivery, po.terms, hash, buyer.id, now, now),
      audit(db, actorOf(buyer, 'buyer'), 'sales.po_submitted', id, { reference: po.reference }, 'buyer'),
      ...(buyer.status === 'active' ? [notifyRole(db, w, 'sales_manager', 'buyer_rfq.received', 'buyer_rfq', id, po.reference)] : []),
    ]); } catch { const raced = await replay(); if (raced) return raced; fail(409, 'The buyer or RFQ changed. Reload and retry.'); }
    return result(201);
  }
  if (route === '/acceptances' && data) {
    keys(data, ['buyerId','quotationId','version','acceptedBy','note']);
    const buyer = await identity('buyers', data.buyerId);
    const result = await recordAcceptance(db, { workspaceId: w, revisionId: recordId(data.quotationId), version: data.version, buyerId: buyer.id, acceptedBy: text(data.acceptedBy, 'Accepted by', 2, 80), note: multiline(data.note ?? '', 'Approval note', 0, 1000), now, actor: actorOf(buyer, 'buyer') });
    return json(result, result.already ? 200 : 201);
  }
  const parts = route.split('/').slice(1);
  if (!data && parts[0] === 'suppliers' && parts.length >= 2) {
    const supplier = await identity('suppliers', parts[1]);
    if (parts.length === 2) return json({ supplier: await publicSupplier(db, supplier.id, w) });
    if (parts.length === 3 && parts[2] === 'rfqs') {
      if (supplier.status !== 'approved') fail(403, 'Only approved suppliers can read RFQs.');
      return json({ rfqs: await all(db, "SELECT r.* FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id JOIN supplier_category_links c ON c.supplier_id=x.supplier_id AND c.category_id=r.category_id WHERE x.supplier_id=? AND r.workspace_id=? AND r.status!='draft' ORDER BY r.created_at DESC LIMIT 100", supplier.id, w) });
    }
    if (parts.length === 3 && parts[2] === 'bid-results') {
      const bids = await all(db, 'SELECT b.*,r.status AS rfq_status,r.cancelled_at FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE b.supplier_id=? AND r.workspace_id=? ORDER BY b.updated_at DESC LIMIT 100', supplier.id, w);
      return json({ results: await Promise.all(bids.map(async b => {
        const po = await one(db, 'SELECT reference,quantity_milli AS quantityMilli,total_minor AS totalMinor FROM supplier_purchase_orders WHERE bid_id=? AND supplier_id=? AND workspace_id=?', b.id, supplier.id, w);
        const pending = await one(db, "SELECT id FROM approval_requests WHERE workspace_id=? AND type='purchase_award' AND status='pending' AND json_extract(payload_json,'$.bidId')=?", w, b.id);
        return { bidId: b.id, rfqId: b.rfq_id, status: b.status === 'rejected' ? 'rejected' : po ? 'awarded' : pending ? 'pending_award' : b.rfq_status === 'awarded' || b.cancelled_at ? 'not_awarded' : 'submitted', rejectionReason: b.rejection_reason, purchaseOrder: po ?? null };
      })) });
    }
  }
  if (!data && parts[0] === 'buyers' && parts.length >= 2) {
    const buyer = await identity('buyers', parts[1]);
    if (parts.length === 2) return json({ buyer: await publicBuyer(db, buyer.id, w) });
    if (parts.length === 3 && parts[2] === 'quotations') return json({ quotations: await all(db, "SELECT r.* FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id WHERE r.buyer_id=? AND r.workspace_id=? AND r.status IN ('sent','approved') AND p.sent_revision_id=r.id ORDER BY r.created_at DESC LIMIT 200", buyer.id, w) });
    if (parts.length === 3 && parts[2] === 'invoices') {
      const invoices = await all(db, 'SELECT * FROM invoice_balances WHERE buyer_id=? AND workspace_id=? ORDER BY issued_at DESC LIMIT 200', buyer.id, w);
      return json({ invoices: invoices.map(i => ({ ...i, status: paymentStatus(i, now) })) });
    }
    if (parts.length === 4 && parts[2] === 'invoices') {
      const invoice = await one(db, 'SELECT i.*,o.reference AS order_reference,o.terms_snapshot FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.id=? AND i.buyer_id=? AND i.workspace_id=?', recordId(parts[3]), buyer.id, w);
      if (!invoice) fail(404, 'Invoice not found.');
      return invoiceFileResponse(invoice, { reference: invoice.order_reference, terms: JSON.parse(invoice.terms_snapshot) }, buyer, factories[0].name);
    }
  }
  fail(404, 'Integration route not found.');
}
