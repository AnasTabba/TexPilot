/** Sales API for the factory staff side: buyers, quotes, orders, invoices, dispatches,
 * deliveries, receivables and payments. Exported as `salesApi(request,env,member,path,data)`
 * for `/api/erp/sales/*` (the integration worker wires it next to the other ERP domains).
 * The buyer-facing counterpart lives in server/buyer-portal.mjs under `/api/buyer/*`.
 * Daily reminder scheduling is exported as `salesScheduled(env, now)` for the Worker cron. */
import { all, one, query, json, fail, text, multiline, keys, integer, date, email, phone, recordId, allow, audit, role, reason as decisionReason } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';
import { settingsOf } from './governance.mjs';

/** Asia/Karachi due-date arithmetic assumes Pakistan's fixed UTC+5 offset with no daylight
 * saving; a future timezone-library switch must keep due dates stable for existing receivables. */
export const PKT_OFFSET_MS = 5 * 3600_000;
/** The Karachi calendar date (YYYY-MM-DD) that a timestamp falls on. */
export const karachiDate = ms => new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
/** Delivery plus N whole calendar days, measured on the Karachi civil date, due at end of that day. */
export function dueAt(deliveryMs, days = 30) {
  const [y, m, d] = karachiDate(deliveryMs).split('-').map(Number);
  return Date.UTC(y, m - 1, d + days, 23, 59, 59, 999) - PKT_OFFSET_MS;
}
const REMINDER_WINDOW_MS = 7 * 86400_000;
const UNITS = ['kg', 'metre', 'piece'];
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP'];
const reference = prefix => `${prefix}-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const lineAmount = (priceMinor, quantityMilli) => {
  // Money stays in integer minor units: reject a price/quantity pair that would need rounding.
  if (!Number.isSafeInteger(priceMinor * quantityMilli) || (priceMinor * quantityMilli) % 1000 !== 0)
    fail(422, 'This price and quantity do not produce a whole amount in the smallest currency unit. Adjust the quantity to whole units or the price to a finer step.');
  return (priceMinor * quantityMilli) / 1000;
};
/** Cumulative allocation keeps partial-delivery amounts exact: no per-delivery rounding drift. */
export const cumulativeAllocation = (totalMinor, deliveredMilli, orderedMilli) => Math.floor((totalMinor * deliveredMilli) / orderedMilli);

export function buyerData(data) {
  return { name: text(data.name, 'Buyer name', 2, 120), contact: text(data.contactName, 'Contact name', 2, 80),
    email: email(data.email), phone: phone(data.phone), city: text(data.city ?? '', 'City', 0, 100), notes: multiline(data.notes ?? '', 'Notes', 0, 2000) };
}

/** The invoice document. A print-ready standalone HTML file: no PDF dependency is added in this
 * branch; the integration owner can swap in a PDF library later (reported in the handoff). */
export function invoiceDocument(invoice, order, buyer, factoryName) {
  const lines = JSON.parse(invoice.lines_json);
  const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = minor => `${invoice.currency} ${(minor / 100).toFixed(2)}`;
  const qty = line => `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(line.quantity_milli / 1000)} ${line.unit}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(invoice.number)}</title>
<style>body{font-family:Georgia,serif;margin:48px auto;max-width:720px;color:#111;line-height:1.5}h1{font-size:26px;margin:0}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:16px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #ccc}th{font-size:13px;text-transform:uppercase;letter-spacing:.04em}.amount,.price{text-align:right}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 24px;margin:16px 0}dt{color:#555}dd{margin:0;font-weight:600}.total td{font-weight:700;border-top:2px solid #111;font-size:18px}.note{color:#555;font-size:13px;margin-top:32px}@media print{body{margin:12mm}}</style></head><body>
<header><div><h1>${esc(factoryName)}</h1><p>Invoice ${esc(invoice.number)}</p></div><div style="text-align:right"><strong>${esc(invoice.number)}</strong><br>Issued ${esc(karachiDate(invoice.issued_at))}</div></header>
<dl><dt>Sold to</dt><dd>${esc(buyer.name)}${buyer.contact_name ? ` · ${esc(buyer.contact_name)}` : ''}</dd>
<dt>Buyer order</dt><dd>${esc(order.reference)}</dd>
<dt>Quote revision</dt><dd>v${esc(String(order.terms.revision))}</dd>
<dt>Payment terms</dt><dd>${esc(order.terms.payment_terms)}</dd>
<dt>Requested delivery</dt><dd>${esc(karachiDate(order.terms.requested_delivery_at))}</dd></dl>
<table><thead><tr><th>Specification</th><th>Quantity</th><th class="price">Unit price</th><th class="amount">Amount</th></tr></thead><tbody>
${lines.map(line => `<tr><td>${esc(line.specifications)}</td><td>${esc(qty(line))}</td><td class="price">${esc(money(line.price_minor))}</td><td class="amount">${esc(money(line.amount_minor))}</td></tr>`).join('\n')}
<tr class="total"><td colspan="3">Total due</td><td class="amount">${esc(money(invoice.total_minor))}</td></tr>
</tbody></table>
<p class="note">Taxes are not shown on this document; its commercial and tax classification follows the factory's accounting policy. Payable per the quoted payment terms: ${esc(order.terms.payment_terms)}. Questions: contact the sales team at ${esc(factoryName)}.</p>
</body></html>`;
}

export function invoiceFileResponse(invoice, order, buyer, factoryName) {
  return new Response(invoiceDocument(invoice, order, buyer, factoryName), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="${invoice.number}.html"`,
  } });
}

/** A queued outbox message is attempted without pretending it was sent: without a configured
 * email adapter the attempt is recorded and the message stays queued for a later retry. */
async function attemptDelivery(db, env, message, now) {
  const configured = !!env.MAIL_API_KEY && !!env.MAIL_SENDER;
  const error = !configured
    ? 'Email sending is not configured for this factory. The message stays queued.'
    : 'The email adapter is not connected in this release. The message stays queued.';
  await query(db, 'UPDATE sales_outbox SET attempts=attempts+1,last_error=?,last_attempted_at=? WHERE id=?', error, now, message.id).run();
  return { queued: true, error };
}

/** Records the buyer's approval of exactly one sent revision and, atomically, confirms the sales
 * order, freezes the terms, issues the one immutable invoice for that revision and queues the
 * invoice document for delivery. Called from the buyer portal only. */
export async function confirmApprovedRevision(db, { workspaceId, revision, buyer, userId, note, now }) {
  const existing = await one(db, 'SELECT a.*,o.id AS order_id,i.id AS invoice_id,i.number AS invoice_number FROM buyer_approvals a LEFT JOIN sales_orders o ON o.revision_id=a.revision_id LEFT JOIN invoices i ON i.revision_id=a.revision_id WHERE a.revision_id=?', revision.id);
  if (existing) {
    if (existing.terms_digest !== await sha256(JSON.stringify({ revision: revision.id, version: revision.version })))
      fail(409, 'This revision was already approved with different terms.');
    return { approvalId: existing.id, order: existing.order_id ? await one(db, 'SELECT * FROM sales_orders WHERE id=?', existing.order_id) : null, invoice: existing.invoice_id ? await one(db, 'SELECT * FROM invoices WHERE id=?', existing.invoice_id) : null, already: true };
  }
  const latest = await one(db, 'SELECT MAX(version) AS v FROM sales_quote_revisions WHERE buyer_po_id=?', revision.buyer_po_id);
  if (revision.status !== 'sent') fail(409, 'Only a sent quote can be approved.');
  if (latest.v !== revision.version) fail(409, `This quote was replaced by revision ${latest.v}. Review and approve the latest revision.`);
  const total = lineAmount(revision.price_minor, revision.quantity_milli);
  const terms = JSON.stringify({ po_reference: (await one(db, 'SELECT reference FROM buyer_purchase_orders WHERE id=?', revision.buyer_po_id)).reference,
    revision: revision.version, quantity_milli: revision.quantity_milli, unit: revision.unit, specifications: revision.specifications,
    price_minor: revision.price_minor, currency: revision.currency, requested_delivery_at: revision.requested_delivery_at,
    payment_terms: revision.payment_terms, approved_at: now });
  const orderId = crypto.randomUUID(); const invoiceId = crypto.randomUUID(); const approvalId = crypto.randomUUID();
  const lineId = crypto.randomUUID(); const outboxId = crypto.randomUUID();
  const period = karachiDate(now).slice(0, 4);
  try {
    await db.batch([
      query(db, "INSERT INTO buyer_approvals(id,revision_id,buyer_id,user_id,version,terms_digest,note,created_at) VALUES(?,?,?,?,?,?,?,?)",
        approvalId, revision.id, buyer.id, userId, revision.version, await sha256(JSON.stringify({ revision: revision.id, version: revision.version })), note ?? '', now),
      query(db, `INSERT INTO sales_orders(id,workspace_id,reference,buyer_id,buyer_po_id,revision_id,status,terms_snapshot,created_by,created_at)
        SELECT ?,?,?,?,?,?,'confirmed',?,?,? WHERE EXISTS(SELECT 1 FROM sales_quote_revisions WHERE id=? AND status='sent' AND version=?)`,
        orderId, workspaceId, reference('SO'), buyer.id, revision.buyer_po_id, revision.id, terms, userId, now, revision.id, revision.version),
      query(db, `INSERT INTO sales_order_lines(id,workspace_id,sales_order_id,product_id,specifications,quantity_milli,unit,created_at)
        SELECT ?,?,?,(SELECT product_id FROM sales_quote_revisions WHERE id=?),?,?,?,?`,
        lineId, workspaceId, orderId, revision.id, revision.specifications, revision.quantity_milli, revision.unit, now),
      query(db, "INSERT INTO document_counters(workspace_id,kind,period,next_number) VALUES(?,'invoice',?,1) ON CONFLICT(workspace_id,kind,period) DO UPDATE SET next_number=next_number+1", workspaceId, period),
      query(db, `INSERT INTO invoices(id,workspace_id,number,sales_order_id,revision_id,buyer_id,lines_json,total_minor,currency,issued_at)
        SELECT ?,?, printf('INV-%s-%06d',?,(SELECT next_number FROM document_counters WHERE workspace_id=? AND kind='invoice' AND period=?)),?,?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM sales_orders WHERE id=?)`,
        invoiceId, workspaceId, period, workspaceId, period, orderId, revision.id, buyer.id,
        JSON.stringify([{ specifications: revision.specifications, quantity_milli: revision.quantity_milli, unit: revision.unit, price_minor: revision.price_minor, amount_minor: total }]),
        total, revision.currency, now, orderId),
      query(db, "UPDATE sales_quote_revisions SET status='approved',updated_at=? WHERE id=? AND status='sent'", now, revision.id),
      query(db, "UPDATE buyer_purchase_orders SET status='confirmed',updated_at=? WHERE id=? AND status IN ('entered','quoted')", now, revision.buyer_po_id),
      query(db, "INSERT INTO sales_outbox(id,workspace_id,kind,buyer_id,invoice_id,revision_id,state,created_at) VALUES(?,?,'invoice_document',?,?,?,'queued',?)", outboxId, workspaceId, buyer.id, invoiceId, revision.id, now),
      audit(db, { workspace_id: workspaceId, user_id: userId }, 'sales.order_confirmed', orderId, { revision: revision.version, invoice: invoiceId, buyer: buyer.id }, 'buyer'),
    ]);
  } catch {
    const raced = await one(db, 'SELECT * FROM buyer_approvals WHERE revision_id=?', revision.id);
    if (raced) return { approvalId: raced.id, order: await one(db, 'SELECT * FROM sales_orders WHERE revision_id=?', revision.id), invoice: await one(db, 'SELECT * FROM invoices WHERE revision_id=?', revision.id), already: true };
    fail(409, 'The quote changed while approving. Reload and approve the latest revision.');
  }
  const invoice = await one(db, 'SELECT * FROM invoices WHERE id=?', invoiceId);
  if (!invoice) fail(409, 'The order could not be confirmed. Reload and approve again.');
  return { approvalId, order: await one(db, 'SELECT * FROM sales_orders WHERE id=?', orderId), invoice, already: false };
}

async function salesOverview(db, env, w) {
  const [buyers, pos, revisions, orders, lines, invoices, dispatches, deliveries, corrections, receivables, payments, reminders, outbox, products, finishedStock, managers] = await Promise.all([
    all(db, 'SELECT id,name,contact_name,email,phone,city,notes,assigned_manager_id,status,version,created_at,updated_at FROM buyers WHERE workspace_id=? AND status!=\'archived\' ORDER BY name COLLATE NOCASE LIMIT 500', w),
    all(db, 'SELECT p.*,b.name AS buyer_name FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 200', w),
    all(db, 'SELECT r.* FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id WHERE p.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', w),
    all(db, 'SELECT o.*,b.name AS buyer_name FROM sales_orders o JOIN buyers b ON b.id=o.buyer_id WHERE o.workspace_id=? ORDER BY o.created_at DESC LIMIT 200', w),
    all(db, 'SELECT l.* FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id WHERE o.workspace_id=? ORDER BY l.created_at DESC LIMIT 500', w),
    all(db, 'SELECT i.*,o.reference AS order_reference FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.workspace_id=? ORDER BY i.issued_at DESC LIMIT 500', w),
    all(db, 'SELECT d.*,o.reference AS order_reference,m.reverses AS movement_reversed FROM sales_dispatches d JOIN sales_orders o ON o.id=d.sales_order_id JOIN movements m ON m.id=d.movement_id WHERE d.workspace_id=? ORDER BY d.created_at DESC LIMIT 500', w),
    all(db, 'SELECT y.* FROM sales_deliveries y JOIN sales_dispatches d ON d.id=y.dispatch_id JOIN sales_orders o ON o.id=d.sales_order_id WHERE y.workspace_id=? ORDER BY y.created_at DESC LIMIT 500', w),
    all(db, 'SELECT c.* FROM delivery_corrections c JOIN sales_deliveries y ON y.id=c.delivery_id JOIN sales_dispatches d ON d.id=y.dispatch_id JOIN sales_orders o ON o.id=d.sales_order_id WHERE c.workspace_id=? ORDER BY c.created_at DESC LIMIT 500', w),
    all(db, 'SELECT r.*,i.number AS invoice_number FROM receivables r JOIN invoices i ON i.id=r.invoice_id WHERE r.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', w),
    all(db, 'SELECT p.* FROM sales_payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 500', w),
    all(db, 'SELECT r.* FROM sales_reminders r JOIN receivables v ON v.id=r.receivable_id WHERE r.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', w),
    all(db, 'SELECT * FROM sales_outbox WHERE workspace_id=? ORDER BY created_at DESC LIMIT 200', w),
    all(db, 'SELECT id,sku,name FROM products WHERE workspace_id=? ORDER BY name', w),
    all(db, `SELECT l.id AS lot_id,l.batch,l.quality,p.id AS product_id,p.name AS product_name,p.sku,b.stage,b.grams,b.cartons,b.cones
      FROM balances b JOIN lots l ON l.id=b.lot_id JOIN products p ON p.id=l.product_id
      WHERE l.workspace_id=? AND b.stage IN ('finished','cops') AND (b.grams>0 OR b.cartons>0 OR b.cones>0) ORDER BY l.created_at DESC LIMIT 500`, w),
    all(db, "SELECT id,name,role FROM users WHERE workspace_id=? AND status='active' ORDER BY name COLLATE NOCASE LIMIT 200", w),
  ]);
  return json({ buyers, pos, revisions, orders, lines, invoices, dispatches, deliveries, corrections, receivables, payments, reminders, outbox, products, finishedStock, managers,
    currency: (await settingsOf(db, w)).currency, serverTime: Date.now(), emailConfigured: !!env.MAIL_API_KEY && !!env.MAIL_SENDER });
}

export async function salesApi(request, env, member, path, data) {
  const db = env.DB; const w = member.workspace_id; const now = Date.now();
  if (!db) fail(503, 'The shared database is not connected.');
  if (path === '/api/erp/sales' && !data) {
    if (!member.admin && !member.permissions.some(p => ['sales', 'payments'].includes(p))) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    return salesOverview(db, env, w);
  }
  const money = member.admin || member.permissions.includes('payments');
  const selling = member.admin || member.permissions.includes('sales');

  if (path.startsWith('/api/erp/sales/invoices/')) {
    if (request.method !== 'GET') fail(405, 'Method not allowed.');
    if (!money && !selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    const invoice = await one(db, `SELECT i.*,o.reference AS order_reference,o.terms_snapshot FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.id=? AND i.workspace_id=?`, recordId(path.split('/')[5]), w);
    if (!invoice) fail(404, 'Invoice not found.');
    const buyer = await one(db, 'SELECT * FROM buyers WHERE id=?', invoice.buyer_id);
    const factory = await one(db, 'SELECT name FROM workspaces WHERE id=?', w);
    return invoiceFileResponse(invoice, { reference: invoice.order_reference, terms: JSON.parse(invoice.terms_snapshot) }, buyer, factory.name);
  }

  if (!data) fail(405, 'Method not allowed.');

  if (path === '/api/erp/sales/buyers') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id', 'name', 'contactName', 'email', 'phone', 'city', 'notes']);
    const id = recordId(data.id); const b = buyerData(data);
    const digest = await sha256(JSON.stringify(b));
    const previous = await one(db, 'SELECT * FROM buyers WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w) fail(409, 'This record ID is already in use.');
      if (previous.request_hash !== digest) fail(409, 'This record ID was already used for different buyer details.');
      return json({ buyer: previous });
    }
    await db.batch([query(db, `INSERT INTO buyers(id,workspace_id,name,contact_name,email,phone,city,notes,request_hash,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',1,?,?)`, id, w, b.name, b.contact, b.email, b.phone, b.city, b.notes, digest, now, now),
      audit(db, member, 'buyer.created', id, { name: b.name })]);
    return json({ buyer: await one(db, 'SELECT * FROM buyers WHERE id=?', id) }, 201);
  }

  if (path === '/api/erp/sales/buyers/review') {
    role(member, data, 'admin');
    keys(data, ['id', 'status', 'reason', 'assignedManagerId', 'version', 'interventionReason']);
    const buyer = await one(db, 'SELECT * FROM buyers WHERE id=? AND workspace_id=?', recordId(data.id), w);
    if (!buyer) fail(404, 'Buyer not found.');
    if (!['active', 'rejected', 'suspended'].includes(data.status)) fail(422, 'Choose active, rejected or suspended.');
    const version = integer(data.version, 'Version');
    if (buyer.version !== version) fail(409, 'The buyer record changed. Reload before reviewing.');
    const reason = decisionReason(data.reason, 'Review reason');
    let managerId = buyer.assigned_manager_id;
    if (data.assignedManagerId !== undefined) {
      managerId = data.assignedManagerId === null ? null : recordId(data.assignedManagerId);
      if (managerId && !(await one(db, "SELECT id FROM users WHERE id=? AND workspace_id=? AND status='active'", managerId, w))) fail(422, 'Choose an active team member as the assigned sales manager.');
    }
    // A lost review must abort before session revocation or audit insertion.
    const guard = query(db, 'INSERT INTO buyers(id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM buyers WHERE id=? AND workspace_id=? AND version=?)', buyer.id, buyer.id, w, version);
    try { await db.batch([guard, query(db, 'UPDATE buyers SET status=?,assigned_manager_id=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?', data.status, managerId, now, buyer.id, w, version),
      ...(data.status !== 'active' ? [query(db, 'DELETE FROM buyer_sessions WHERE user_id IN (SELECT id FROM buyer_users WHERE buyer_id=?)', buyer.id)] : []),
      audit(db, member, `buyer.${data.status}`, buyer.id, { reason, managerId }, 'staff', { reason, before: { status: buyer.status }, after: { status: data.status } })]); }
    catch { fail(409, 'The buyer record changed. Reload before reviewing.'); }
    return json({ saved: true });
  }

  if (path === '/api/erp/sales/pos') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id', 'buyerId', 'reference', 'specifications', 'quantityMilli', 'unit', 'requestedDeliveryAt', 'paymentTerms']);
    const id = recordId(data.id); const buyerId = recordId(data.buyerId);
    const buyer = await one(db, "SELECT * FROM buyers WHERE id=? AND workspace_id=? AND status='active'", buyerId, w);
    if (!buyer) fail(404, 'Active buyer not found.');
    const po = { reference: text(data.reference, 'Buyer PO reference', 2, 100), specifications: multiline(data.specifications, 'Specifications', 5, 4000),
      quantity: integer(data.quantityMilli, 'Quantity'), unit: UNITS.includes(data.unit) ? data.unit : null,
      delivery: date(data.requestedDeliveryAt, 'Requested delivery'), terms: multiline(data.paymentTerms, 'Payment terms', 3, 1000) };
    if (!po.unit) fail(422, 'Choose kg, metre or piece.');
    if (po.delivery <= now) fail(422, 'Requested delivery must be in the future.');
    const digest = await sha256(JSON.stringify({ buyer: buyerId, ...po }));
    const previous = await one(db, 'SELECT * FROM buyer_purchase_orders WHERE id=?', id);
    if (previous) { if (previous.workspace_id !== w || previous.request_hash !== digest) fail(409, 'This request ID was used for different PO values.'); return json({ po: previous }); }
    try { await db.batch([query(db, `INSERT INTO buyer_purchase_orders(id,workspace_id,buyer_id,reference,specifications,quantity_milli,unit,requested_delivery_at,payment_terms,status,source,request_hash,created_by,actor_type,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'entered','staff',?,?,'staff',?,?)`, id, w, buyerId, po.reference, po.specifications, po.quantity, po.unit, po.delivery, po.terms, digest, member.user_id, now, now),
      audit(db, member, 'sales.po_entered', id, { buyer: buyerId, reference: po.reference })]); }
    catch { fail(409, 'This buyer PO reference is already used in your workspace.'); }
    return json({ po: await one(db, 'SELECT * FROM buyer_purchase_orders WHERE id=?', id) }, 201);
  }

  if (path === '/api/erp/sales/quotes') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id', 'poId', 'priceMinor', 'currency', 'specifications', 'requestedDeliveryAt', 'paymentTerms', 'note', 'productId']);
    const id = recordId(data.id); const po = await one(db, 'SELECT p.*,b.id AS buyer_id FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id WHERE p.id=? AND p.workspace_id=?', recordId(data.poId), w);
    if (!po) fail(404, 'Buyer PO not found.');
    if (po.status === 'confirmed') fail(409, 'This order is confirmed. Terms changes need an amendment flow that is not available yet.');
    const quote = { price: integer(data.priceMinor, 'Unit price'), currency: CURRENCIES.includes(data.currency) ? data.currency : null,
      specifications: multiline(data.specifications, 'Specifications', 5, 4000), delivery: date(data.requestedDeliveryAt, 'Requested delivery'),
      terms: multiline(data.paymentTerms, 'Payment terms', 3, 1000), note: multiline(data.note ?? '', 'Note', 0, 2000) };
    if (!quote.currency) fail(422, 'Choose a supported currency.');
    if (quote.delivery <= now) fail(422, 'Requested delivery must be in the future.');
    lineAmount(quote.price, po.quantity_milli);
    let productId = null;
    if (data.productId) { productId = recordId(data.productId); if (!(await one(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', productId, w))) fail(404, 'Material not found.'); }
    const digest = await sha256(JSON.stringify({ po: po.id, ...quote, productId }));
    const previous = await one(db, 'SELECT * FROM sales_quote_revisions WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.buyer_po_id !== po.id) fail(409, 'This request ID was used for different quote values.');
      // Replay the exact hashed payload from the stored revision; anything else is a conflict.
      const replay = await sha256(JSON.stringify({ po: previous.buyer_po_id, price: previous.price_minor, currency: previous.currency,
        specifications: previous.specifications, delivery: previous.requested_delivery_at, terms: previous.payment_terms, note: previous.note, productId: previous.product_id }));
      if (replay !== digest) fail(409, 'This request ID was used for different quote values.');
      return json({ revision: previous });
    }
    // The next revision number is chosen inside the insert itself, so two simultaneous drafts cannot clash.
    try { await db.batch([query(db, `INSERT INTO sales_quote_revisions(id,workspace_id,buyer_po_id,buyer_id,version,quantity_milli,unit,price_minor,currency,specifications,requested_delivery_at,payment_terms,note,product_id,status,created_by,created_at,updated_at)
      SELECT ?,?,?,?,COALESCE((SELECT MAX(version)+1 FROM sales_quote_revisions WHERE buyer_po_id=?),1),?,?,?,?,?,?,?,?,?,'draft',?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM sales_quote_revisions WHERE buyer_po_id=? AND status='approved')`, id, w, po.id, po.buyer_id, po.id,
      po.quantity_milli, po.unit, quote.price, quote.currency, quote.specifications, quote.delivery, quote.terms, quote.note, productId, member.user_id, now, now, po.id),
      audit(db, member, 'sales.quote_drafted', id, { po: po.id })]); }
    catch (error) {
      if (String(error).includes('Use the factory currency.')) fail(409, 'Use the factory currency. Reload to get the current currency.');
      fail(409, 'A quote already exists for this order or it changed. Reload first.');
    }
    return json({ revision: await one(db, 'SELECT * FROM sales_quote_revisions WHERE id=?', id) }, 201);
  }

  if (path === '/api/erp/sales/quotes/send') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id']);
    const revision = await one(db, 'SELECT r.* FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id WHERE r.id=? AND r.workspace_id=?', recordId(data.id), w);
    if (!revision) fail(404, 'Quote revision not found.');
    if (revision.status === 'sent') return json({ sent: true });
    if (revision.status !== 'draft') fail(409, 'This revision was already approved.');
    const latest = await one(db, 'SELECT MAX(version) AS v FROM sales_quote_revisions WHERE buyer_po_id=?', revision.buyer_po_id);
    if (latest.v !== revision.version) fail(409, 'Only the newest revision can be sent.');
    const outboxId = crypto.randomUUID();
    await db.batch([query(db, "UPDATE sales_quote_revisions SET status='sent',updated_at=? WHERE id=? AND status='draft'", now, revision.id),
      query(db, "UPDATE buyer_purchase_orders SET status='quoted',updated_at=? WHERE id=? AND status='entered'", now, revision.buyer_po_id),
      query(db, "INSERT INTO sales_outbox(id,workspace_id,kind,buyer_id,revision_id,state,created_at) VALUES(?,?,'quote_sent',?,?,'queued',?)", outboxId, w, revision.buyer_id, revision.id, now),
      audit(db, member, 'sales.quote_sent', revision.id, { version: revision.version, channel: 'buyer_portal_inbox' })]);
    return json({ sent: true });
  }

  if (path === '/api/erp/sales/dispatches') {
    allow(member, 'dispatch', 'dispatch stock');
    keys(data, ['id', 'orderId', 'lotId', 'stage', 'quantityMilli', 'grams', 'cartons', 'cones', 'carrier', 'packages', 'documentsNote', 'dispatchedAt']);
    const id = recordId(data.id); const orderId = recordId(data.orderId); const lotId = recordId(data.lotId);
    const stage = data.stage === 'cops' ? 'cops' : 'finished';
    const order = await one(db, `SELECT o.*,l.product_id,l.unit,l.quantity_milli AS ordered_milli FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id WHERE o.id=? AND o.workspace_id=?`, orderId, w);
    if (!order) fail(404, 'Sales order not found.');
    const qty = integer(data.quantityMilli, 'Dispatched quantity');
    const grams = order.unit === 'kg' ? qty : integer(data.grams, 'Weight in grams');
    const cartons = integer(data.cartons ?? 0, 'Cartons', 0); const cones = integer(data.cones ?? 0, 'Cones', 0);
    if (grams <= 0) fail(422, 'Weigh the dispatched goods in grams; the ledger keeps exact mass.');
    const carrier = text(data.carrier, 'Carrier', 2, 100);
    const documentsNote = multiline(data.documentsNote ?? '', 'Documents note', 0, 2000);
    const dispatchedAt = date(data.dispatchedAt, 'Dispatch time');
    if (dispatchedAt > now + 60_000) fail(422, 'The dispatch time cannot be in the future.');
    const packages = data.packages === undefined ? [] : data.packages;
    if (!Array.isArray(packages) || packages.length > 1000 || packages.some(p => typeof p !== 'string' || p.length > 120)) fail(422, 'Package QR codes must be a list of short strings.');
    const normalized = { order: orderId, lot: lotId, stage, qty, grams, cartons, cones, carrier, documentsNote, dispatchedAt, packages: [...new Set(packages)] };
    const digest = await sha256(JSON.stringify(normalized));
    const previous = await one(db, 'SELECT * FROM sales_dispatches WHERE id=?', id);
    if (previous) { if (previous.workspace_id !== w || previous.request_hash !== digest) fail(409, 'This request ID was used for different dispatch values.'); return json({ dispatch: previous }); }
    const movementHash = await sha256(JSON.stringify({ dispatch: id, grams, cartons, cones }));
    try { await db.batch([
      query(db, `INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
        VALUES(?,?,?,'dispatch',?,NULL,?,?,?,?,?,?,NULL,?,?)`, id, w, lotId, stage, grams, cartons, cones,
        `Dispatch ${order.reference} · ${carrier}`, member.user_id, member.name, movementHash, now),
      query(db, `INSERT INTO sales_dispatches(id,workspace_id,sales_order_id,movement_id,lot_id,from_stage,quantity_milli,unit,grams,cartons,cones,carrier,packages_json,documents_note,dispatched_at,request_hash,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, w, orderId, id, lotId, stage, qty, order.unit, grams, cartons, cones, carrier,
        JSON.stringify(normalized.packages), documentsNote, dispatchedAt, digest, member.user_id, now),
      // Issue the stock exactly like an inventory dispatch: the negative delta lands after the
      // dispatch row so its trigger validates against the pre-dispatch balance, then the ledger
      // decrements the finished/cops balance atomically.
      query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)',
        crypto.randomUUID(), id, lotId, stage, -grams, -cartons, -cones),
      query(db, `UPDATE sales_orders SET status=CASE WHEN COALESCE((SELECT SUM(d.quantity_milli) FROM sales_dispatches d
        WHERE d.sales_order_id=sales_orders.id AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=d.movement_id)),0)
        >=(SELECT l.quantity_milli FROM sales_order_lines l WHERE l.sales_order_id=sales_orders.id)
        THEN 'dispatched' ELSE 'partially_dispatched' END WHERE id=?`, orderId),
      audit(db, member, 'sales.dispatched', id, { order: orderId, qty, unit: order.unit, carrier })]); }
    catch { fail(409, 'The dispatch exceeds the ordered quantity, the stock changed, or the lot is not approved finished stock. Reload and check the values.'); }
    return json({ dispatch: await one(db, 'SELECT * FROM sales_dispatches WHERE id=?', id) }, 201);
  }

  if (path === '/api/erp/sales/deliveries') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id', 'dispatchId', 'deliveryDate', 'evidenceNote']);
    const id = recordId(data.id); const dispatchId = recordId(data.dispatchId);
    const dispatch = await one(db, `SELECT d.*,l.quantity_milli AS ordered_milli FROM sales_dispatches d JOIN sales_orders o ON o.id=d.sales_order_id JOIN sales_order_lines l ON l.sales_order_id=o.id WHERE d.id=? AND d.workspace_id=?`, dispatchId, w);
    if (!dispatch) fail(404, 'Dispatch not found.');
    const already = await one(db, 'SELECT * FROM sales_deliveries WHERE dispatch_id=?', dispatchId);
    if (already && already.workspace_id === w) return json({ delivery: already });
    const deliveryDate = date(data.deliveryDate, 'Delivery date');
    if (deliveryDate > now + 60_000) fail(422, 'The delivery date cannot be in the future.');
    if (deliveryDate < dispatch.dispatched_at - 60_000) fail(422, 'The delivery cannot precede its dispatch.');
    const evidenceNote = multiline(data.evidenceNote ?? '', 'Delivery evidence', 0, 2000);
    const digest = await sha256(JSON.stringify({ dispatch: dispatchId, deliveryDate, evidenceNote }));
    const previous = await one(db, 'SELECT * FROM sales_deliveries WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.dispatch_id !== dispatchId) fail(409, 'This request ID was used for different delivery values.');
      // Replay the exact hashed payload from the stored delivery; anything else is a conflict.
      const replay = await sha256(JSON.stringify({ dispatch: previous.dispatch_id, deliveryDate: previous.delivery_date, evidenceNote: previous.evidence_note }));
      if (replay !== digest) fail(409, 'This request ID was used for different delivery values.');
      return json({ delivery: previous });
    }
    // Exact partial-payment maths, computed inside the transaction: each delivery receives the
    // cumulative allocation of the invoice minus what earlier deliveries already took, so the
    // last delivery lands on the exact invoice total with no rounding drift.
    const invoice = await one(db, 'SELECT * FROM invoices WHERE sales_order_id=?', dispatch.sales_order_id);
    if (!invoice) fail(409, 'The confirmed order has no invoice yet. Approve the quote revision first.');
    const receivableId = crypto.randomUUID(); const due = dueAt(deliveryDate, 30);
    try { await db.batch([
      query(db, "INSERT INTO sales_deliveries(id,workspace_id,dispatch_id,delivery_date,evidence_note,confirmed_by,created_at) VALUES(?,?,?,?,?,?,?)", id, w, dispatchId, deliveryDate, evidenceNote, member.name, now),
      query(db, `INSERT INTO receivables(id,workspace_id,invoice_id,delivery_id,buyer_id,amount_minor,paid_minor,currency,due_at,due_revision,status,created_at)
        SELECT ?,?,?,?,buyer_id,
          (total_minor*(before+?))/qty-(total_minor*before)/qty,
          0,currency,?,1,'open',?
        FROM (
          SELECT i.id, i.buyer_id, i.currency, i.total_minor AS total_minor,
            (SELECT COALESCE(SUM(d.quantity_milli),0) FROM sales_dispatches d JOIN sales_deliveries y ON y.dispatch_id=d.id
              WHERE d.sales_order_id=i.sales_order_id AND d.id<>? AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=d.movement_id)) AS before,
            (SELECT quantity_milli FROM sales_order_lines WHERE sales_order_id=i.sales_order_id) AS qty
          FROM invoices i WHERE i.id=? AND i.sales_order_id=?
        ) WHERE EXISTS(SELECT 1 FROM sales_deliveries WHERE id=? AND workspace_id=?)`,
        receivableId, w, invoice.id, id, dispatch.quantity_milli, due, now,
        dispatch.id, invoice.id, dispatch.sales_order_id, id, w),
      audit(db, member, 'sales.delivered', id, { dispatch: dispatchId, due: karachiDate(due) })]); }
    catch { fail(409, 'This dispatch was already delivered, allocates no remaining invoice amount, or the order changed. Reload first.'); }
    const receivable = await one(db, 'SELECT * FROM receivables WHERE id=?', receivableId);
    if (!receivable) fail(409, 'The delivery could not create its receivable. Reload and confirm again.');
    return json({ delivery: await one(db, 'SELECT * FROM sales_deliveries WHERE id=?', id), receivable }, 201);
  }

  if (path === '/api/erp/sales/deliveries/correct') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id', 'deliveryId', 'deliveryDate', 'reason']);
    const delivery = await one(db, `SELECT y.*,x.dispatched_at,x.sales_order_id,r.id AS receivable_id,r.due_revision FROM sales_deliveries y
      JOIN sales_dispatches x ON x.id=y.dispatch_id LEFT JOIN receivables r ON r.delivery_id=y.id WHERE y.id=? AND y.workspace_id=?`, recordId(data.deliveryId), w);
    if (!delivery) fail(404, 'Delivery not found.');
    const corrected = date(data.deliveryDate, 'Corrected delivery date');
    if (corrected > now + 60_000) fail(422, 'The corrected delivery date cannot be in the future.');
    if (corrected < delivery.dispatched_at - 60_000) fail(422, 'The delivery cannot precede its dispatch.');
    if (corrected === delivery.delivery_date) fail(422, 'Choose a date that differs from the recorded delivery date.');
    const repeat = await one(db, 'SELECT id FROM delivery_corrections WHERE delivery_id=? AND corrected_date=?', delivery.id, corrected);
    if (repeat) fail(422, 'This delivery date was already corrected to that value.');
    const reason = multiline(data.reason, 'Correction reason', 5, 1000);
    const dueRevision = (delivery.due_revision ?? 0) + 1; const due = dueAt(corrected, 30);
    try { await db.batch([
      query(db, 'INSERT INTO delivery_corrections(id,workspace_id,delivery_id,previous_date,corrected_date,due_revision,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        recordId(data.id), w, delivery.id, delivery.delivery_date, corrected, dueRevision, reason, member.user_id, now),
      query(db, 'UPDATE receivables SET due_at=?,due_revision=? WHERE delivery_id=?', due, dueRevision, delivery.id),
      audit(db, member, 'sales.delivery_corrected', delivery.id, { from: karachiDate(delivery.delivery_date), to: karachiDate(corrected), reason })]); }
    catch { fail(409, 'The delivery changed. Reload and correct again.'); }
    return json({ corrected: true, dueAt: due, dueRevision });
  }

  if (path === '/api/erp/sales/payments') {
    if (!money) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id', 'receivableId', 'amountMinor', 'note']);
    const receivable = await one(db, 'SELECT r.*,i.number AS invoice_number FROM receivables r JOIN invoices i ON i.id=r.invoice_id WHERE r.id=? AND r.workspace_id=?', recordId(data.receivableId), w);
    if (!receivable) fail(404, 'Receivable not found.');
    const amount = integer(data.amountMinor, 'Payment amount'); const note = multiline(data.note ?? '', 'Payment note', 0, 1000);
    const id = recordId(data.id);
    const previous = await one(db, 'SELECT * FROM sales_payments WHERE id=?', id);
    if (previous) { if (previous.workspace_id !== w || previous.amount_minor !== amount || previous.receivable_id !== receivable.id) fail(409, 'This request ID was used for different payment values.'); return json({ payment: previous }); }
    try { await db.batch([query(db, "INSERT INTO sales_payments(id,workspace_id,invoice_id,receivable_id,amount_minor,currency,note,actor_id,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id, w, receivable.invoice_id, receivable.id, amount, receivable.currency, note, member.user_id, member.name, now),
      audit(db, member, 'sales.payment_recorded', id, { receivable: receivable.id, amount, currency: receivable.currency })]); }
    catch { fail(409, 'The payment exceeds the outstanding amount or the receivable changed. Reload first.'); }
    return json({ payment: await one(db, 'SELECT * FROM sales_payments WHERE id=?', id), receivable: await one(db, 'SELECT * FROM receivables WHERE id=?', receivable.id) }, 201);
  }

  if (path === '/api/erp/sales/outbox/retry') {
    if (!selling) fail(403, 'Your account does not have permission for this action. Ask an admin.');
    keys(data, ['id']);
    const message = await one(db, 'SELECT * FROM sales_outbox WHERE id=? AND workspace_id=?', recordId(data.id), w);
    if (!message) fail(404, 'Queued message not found.');
    if (message.state === 'sent') return json({ message });
    const result = await attemptDelivery(db, env, message, now);
    return json({ message: await one(db, 'SELECT * FROM sales_outbox WHERE id=?', message.id), ...result });
  }

  fail(404, 'Sales route not found.');
}

/** Daily receivable reminders. Deduplicated by (receivable, kind, due revision); they stop after
 * settlement and target the assigned active sales manager, falling back to an active admin.
 * The integration worker wires this into the Worker `scheduled` handler. */
export async function salesScheduled(env, now = Date.now()) {
  const db = env.DB;
  if (!db) return { checked: 0, created: 0, error: 'The shared database is not connected.' };
  const open = await all(db, "SELECT r.id,r.due_at,r.due_revision,r.workspace_id,b.assigned_manager_id FROM receivables r JOIN buyers b ON b.id=r.buyer_id WHERE r.status='open' AND r.due_at<=?+? ORDER BY r.due_at LIMIT 500", now, REMINDER_WINDOW_MS);
  let created = 0;
  for (const r of open) {
    const kind = r.due_at <= now ? 'overdue' : 'due_soon';
    let target = null; let role = 'sales_manager';
    if (r.assigned_manager_id) target = await one(db, "SELECT id FROM users WHERE id=? AND workspace_id=? AND status='active'", r.assigned_manager_id, r.workspace_id);
    if (!target) { target = await one(db, "SELECT id FROM users WHERE workspace_id=? AND role='admin' AND status='active' ORDER BY created_at LIMIT 1", r.workspace_id); role = 'admin'; }
    if (!target) continue;
    try { await query(db, 'INSERT INTO sales_reminders(id,workspace_id,receivable_id,kind,due_revision,target_user_id,target_role,created_at) VALUES(?,?,?,?,?,?,?,?)',
      crypto.randomUUID(), r.workspace_id, r.id, kind, r.due_revision, target.id, role, now).run();
      created++;
    } catch { /* A reminder for this receivable, kind and due revision already exists: deduplicated. */ }
  }
  return { checked: open.length, created, at: now };
}
