/** Sales API for the factory staff side: buyer review, quotations, noted sales, invoices and credit
 * notes. Exported as `salesApi(request,env,member,path,data)` for `/api/erp/sales/*`.
 * The buyer-facing counterpart lives in server/buyer-portal.mjs under `/api/buyer/*`; buyers
 * register and submit RFQs there, and staff never create buyers or enter RFQs for them. */
import { all, one, query, json, fail, text, multiline, keys, integer, date, email, phone, recordId, audit, role, viewer, reason as decisionReason } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';
import { settingsOf } from './governance.mjs';
import { notifyRole } from './notify.mjs';

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
const reference = prefix => `${prefix}-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const lineAmount = (priceMinor, quantityMilli) => {
  // Money stays in integer minor units: reject a price/quantity pair that would need rounding.
  if (!Number.isSafeInteger(priceMinor * quantityMilli) || (priceMinor * quantityMilli) % 1000 !== 0)
    fail(422, 'This price and quantity do not produce a whole amount in the smallest currency unit. Adjust the quantity to whole units or the price to a finer step.');
  return (priceMinor * quantityMilli) / 1000;
};
/** GST on the subtotal, rounded half up to the paisa; BigInt keeps rate times subtotal exact. */
const taxOf = (subtotalMinor, rateBp) => Number((BigInt(subtotalMinor) * BigInt(rateBp) + 5000n) / 10000n);
/** Aborts the whole batch when the condition no longer holds: the NOT NULL violation rolls it back. */
const guard = (db, condition, ...args) => query(db, `INSERT INTO buyers(id) SELECT 'guard' WHERE NOT (${condition})`, ...args);
const REPLACED = 'This quotation was replaced. Accept the latest revision.';
const NOT_APPROVED = 'Respond only to RFQs from approved buyers.';
const rfqState = (status, buyerStatus) => status === 'cancelled' ? 'closed' : status === 'confirmed' ? 'sold' : status === 'quoted' ? 'quoted' : buyerStatus === 'pending' ? 'awaiting_buyer_approval' : 'open';

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
${invoice.subtotal_minor === null ? '' : `<tr><td colspan="3">Subtotal</td><td class="amount">${esc(money(invoice.subtotal_minor))}</td></tr>
<tr><td colspan="3">GST (${esc(String(invoice.tax_rate_bp / 100))}%)</td><td class="amount">${esc(money(invoice.tax_minor))}</td></tr>`}
<tr class="total"><td colspan="3">Total due</td><td class="amount">${esc(money(invoice.total_minor))}</td></tr>
<tr><td colspan="3">Due date</td><td class="amount">${invoice.due_at ? esc(karachiDate(invoice.due_at)) : '–'}</td></tr>
</tbody></table>
<p class="note">Payable per the quoted payment terms: ${esc(order.terms.payment_terms)}. Questions: contact the sales team at ${esc(factoryName)}.</p>
</body></html>`;
}

export function invoiceFileResponse(invoice, order, buyer, factoryName) {
  return new Response(invoiceDocument(invoice, order, buyer, factoryName), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="${invoice.number}.html"`,
  } });
}

/** Records the buyer's acceptance of exactly one sent revision. It must be the RFQ's current sent
 * revision and the buyer must still be approved; both are enforced again inside the committing
 * transaction, so a resend or suspension that wins the race refuses the acceptance. The sale and
 * its invoice are noted separately by the sales manager (`noteSale`). */
export async function recordAcceptance(db, { workspaceId, revisionId, version, buyerId, acceptedBy, note = '', now }) {
  const replay = acceptance => {
    if (acceptance.version !== version || acceptance.note !== note) fail(409, 'This quotation was already accepted with different details.');
    return { acceptance, already: true };
  };
  const revision = await one(db, 'SELECT * FROM sales_quote_revisions WHERE id=? AND workspace_id=? AND buyer_id=?', revisionId, workspaceId, buyerId);
  if (!revision) fail(404, 'Quote not found.');
  const existing = await one(db, 'SELECT * FROM quotation_acceptances WHERE revision_id=?', revisionId);
  if (existing) return replay(existing);
  if (!await one(db, "SELECT id FROM buyers WHERE id=? AND workspace_id=? AND status='active'", buyerId, workspaceId)) fail(409, 'Only approved buyers can accept quotations.');
  if (revision.status !== 'sent' || revision.version !== version) fail(409, REPLACED);
  const id = crypto.randomUUID();
  try {
    await db.batch([
      query(db, 'INSERT INTO quotation_acceptances(id,workspace_id,revision_id,buyer_id,version,accepted_by,created_by,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        id, workspaceId, revisionId, buyerId, version, acceptedBy, `buyer:${buyerId}`, note, now, now),
      query(db, "UPDATE sales_quote_revisions SET status='approved',updated_at=? WHERE id=? AND status='sent'", now, revisionId),
      audit(db, { workspace_id: workspaceId, user_id: buyerId }, 'quotation.accepted', revisionId, { version, acceptedBy, buyer: buyerId }, 'buyer', { objectType: 'quotation' }),
    ]);
  } catch {
    const raced = await one(db, 'SELECT * FROM quotation_acceptances WHERE revision_id=?', revisionId);
    if (raced) return replay(raced);
    fail(409, REPLACED);
  }
  return { acceptance: await one(db, 'SELECT * FROM quotation_acceptances WHERE id=?', id), already: false };
}

/** Notes the sale for an accepted quotation: one order, one locked invoice with GST, the yearly
 * invoice number and the RFQ marked sold, all in one transaction. Repeating it returns the same sale. */
export async function noteSale(db, member, { id, revisionId, intervention = null }, now = Date.now()) {
  const w = member.workspace_id;
  const existing = async () => {
    const order = await one(db, 'SELECT * FROM sales_orders WHERE revision_id=? AND workspace_id=?', revisionId, w);
    return order && { order, invoice: await one(db, 'SELECT * FROM invoices WHERE sales_order_id=?', order.id) };
  };
  const noted = await existing();
  if (noted) return noted;
  if (await one(db, 'SELECT id FROM sales_orders WHERE id=?', id)) fail(409, 'This request ID was used for a different sale.');
  const revision = await one(db, 'SELECT r.*,p.reference AS po_reference FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id WHERE r.id=? AND r.workspace_id=?', revisionId, w);
  if (!revision) fail(404, 'Quote not found.');
  if (revision.status !== 'approved' || !await one(db, 'SELECT id FROM quotation_acceptances WHERE revision_id=?', revisionId)) fail(409, 'The buyer has not accepted this quotation yet.');
  if (!await one(db, "SELECT id FROM buyers WHERE id=? AND workspace_id=? AND status='active'", revision.buyer_id, w)) fail(409, 'This buyer is not approved. Reactivate the buyer before noting the sale.');
  const settings = await settingsOf(db, w), period = karachiDate(now).slice(0, 4);
  const subtotal = lineAmount(revision.price_minor, revision.quantity_milli), tax = taxOf(subtotal, settings.tax_rate_bp);
  const terms = JSON.stringify({ po_reference: revision.po_reference, revision: revision.version, quantity_milli: revision.quantity_milli, unit: revision.unit,
    specifications: revision.specifications, price_minor: revision.price_minor, currency: revision.currency, requested_delivery_at: revision.requested_delivery_at,
    payment_terms: revision.payment_terms, credit_days: revision.credit_days, noted_at: now });
  const lines = JSON.stringify([{ specifications: revision.specifications, quantity_milli: revision.quantity_milli, unit: revision.unit, price_minor: revision.price_minor, amount_minor: subtotal }]);
  const invoiceId = crypto.randomUUID();
  const statements = () => [
    // Accepted, still the current sent revision, and the buyer is still approved.
    guard(db, `EXISTS(SELECT 1 FROM quotation_acceptances a JOIN sales_quote_revisions r ON r.id=a.revision_id JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id JOIN buyers b ON b.id=p.buyer_id
      WHERE a.revision_id=? AND a.version=r.version AND r.status='approved' AND p.sent_revision_id=r.id AND p.status='quoted' AND b.status='active' AND b.workspace_id=r.workspace_id AND r.workspace_id=?)`, revisionId, w),
    query(db, "INSERT INTO sales_orders(id,workspace_id,reference,buyer_id,buyer_po_id,revision_id,status,terms_snapshot,created_by,created_at) VALUES(?,?,?,?,?,?,'confirmed',?,?,?)",
      id, w, reference('SO'), revision.buyer_id, revision.buyer_po_id, revisionId, terms, member.user_id, now),
    query(db, 'INSERT INTO sales_order_lines(id,workspace_id,sales_order_id,product_id,specifications,quantity_milli,unit,created_at) VALUES(?,?,?,?,?,?,?,?)',
      crypto.randomUUID(), w, id, revision.product_id, revision.specifications, revision.quantity_milli, revision.unit, now),
    query(db, "INSERT INTO document_counters(workspace_id,kind,period,next_number) VALUES(?,'invoice',?,1) ON CONFLICT(workspace_id,kind,period) DO UPDATE SET next_number=next_number+1", w, period),
    query(db, `INSERT INTO invoices(id,workspace_id,number,sales_order_id,revision_id,buyer_id,lines_json,total_minor,currency,issued_at,subtotal_minor,tax_rate_bp,tax_minor,due_at,payment_terms,credit_days,created_by,updated_at)
      SELECT ?,?,replace(replace(?,'{YYYY}',?),'{NNNN}',printf('%04d',next_number)),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      FROM document_counters WHERE workspace_id=? AND kind='invoice' AND period=?`,
      invoiceId, w, settings.invoice_format, period, id, revisionId, revision.buyer_id, lines, subtotal + tax, revision.currency, now, subtotal, settings.tax_rate_bp, tax,
      dueAt(now, revision.credit_days), revision.payment_terms, revision.credit_days, member.user_id, now, w, period),
    query(db, "UPDATE buyer_purchase_orders SET status='confirmed',updated_at=? WHERE id=? AND status='quoted'", now, revision.buyer_po_id),
    audit(db, member, 'sale.noted', id, { revision: revision.version, buyer: revision.buyer_id, po: revision.po_reference }, 'staff', { objectType: 'sale', intervention }),
    audit(db, member, 'invoice.issued', invoiceId, { sale: id, subtotal_minor: subtotal, tax_minor: tax, total_minor: subtotal + tax, currency: revision.currency }, 'staff', { objectType: 'invoice', intervention }),
  ];
  for (let attempt = 0; ; attempt++) {
    try { await db.batch(statements()); break; }
    catch (error) {
      const raced = await existing();
      if (raced) return raced;
      // A number clash (for example after the admin reused a format) skips the clashing number once.
      if (attempt === 0 && String(error).includes('invoices.number')) { await query(db, "UPDATE document_counters SET next_number=next_number+1 WHERE workspace_id=? AND kind='invoice' AND period=?", w, period).run(); continue; }
      fail(409, 'The quotation or the buyer changed while noting the sale. Reload and check again.');
    }
  }
  const invoice = await one(db, 'SELECT * FROM invoices WHERE id=?', invoiceId);
  if (!invoice) fail(409, 'The invoice could not be issued. Reload and try again.');
  return { order: await one(db, 'SELECT * FROM sales_orders WHERE id=?', id), invoice };
}

async function salesOverview(db, w) {
  const [buyers, rfqs, revisions, acceptances, orders, invoices, creditNotes, products, settings] = await Promise.all([
    all(db, "SELECT id,name,contact_name,email,phone,city,notes,assigned_manager_id,status,version,created_at,updated_at FROM buyers WHERE workspace_id=? AND status!='archived' ORDER BY name COLLATE NOCASE LIMIT 500", w),
    all(db, 'SELECT p.id,p.buyer_id,p.reference,p.specifications,p.quantity_milli,p.unit,p.requested_delivery_at,p.payment_terms,p.status,p.sent_revision_id,p.sent_version,p.created_at,p.updated_at,b.name AS buyer_name,b.status AS buyer_status FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 200', w),
    all(db, 'SELECT r.* FROM sales_quote_revisions r WHERE r.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', w),
    all(db, 'SELECT a.* FROM quotation_acceptances a WHERE a.workspace_id=? ORDER BY a.created_at DESC LIMIT 500', w),
    all(db, 'SELECT o.*,b.name AS buyer_name FROM sales_orders o JOIN buyers b ON b.id=o.buyer_id WHERE o.workspace_id=? ORDER BY o.created_at DESC LIMIT 200', w),
    all(db, 'SELECT i.*,o.reference AS order_reference FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.workspace_id=? ORDER BY i.issued_at DESC LIMIT 500', w),
    all(db, 'SELECT c.* FROM credit_notes c WHERE c.workspace_id=? ORDER BY c.created_at DESC LIMIT 500', w),
    all(db, 'SELECT id,sku,name FROM products WHERE workspace_id=? ORDER BY name', w),
    settingsOf(db, w),
  ]);
  return json({ buyers, rfqs: rfqs.map(({ buyer_status, ...rfq }) => ({ ...rfq, state: rfqState(rfq.status, buyer_status) })), revisions, acceptances, orders, invoices, creditNotes, products, settings });
}

export async function salesApi(request, env, member, path, data) {
  const db = env.DB; const w = member.workspace_id; const now = Date.now();
  if (!db) fail(503, 'The shared database is not connected.');

  if (!data) {
    viewer(member, 'sales_manager');
    if (path === '/api/erp/sales') return salesOverview(db, w);
    if (path.startsWith('/api/erp/sales/invoices/')) {
      const invoice = await one(db, 'SELECT i.*,o.reference AS order_reference,o.terms_snapshot FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.id=? AND i.workspace_id=?', recordId(path.split('/')[5]), w);
      if (!invoice) fail(404, 'Invoice not found.');
      const buyer = await one(db, 'SELECT * FROM buyers WHERE id=?', invoice.buyer_id);
      const factory = await one(db, 'SELECT name FROM workspaces WHERE id=?', w);
      return invoiceFileResponse(invoice, { reference: invoice.order_reference, terms: JSON.parse(invoice.terms_snapshot) }, buyer, factory.name);
    }
    fail(405, 'Method not allowed.');
  }

  if (path === '/api/erp/sales/buyers/review') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'status', 'reason', 'version', 'interventionReason']);
    const buyer = await one(db, 'SELECT * FROM buyers WHERE id=? AND workspace_id=?', recordId(data.id), w);
    if (!buyer) fail(404, 'Buyer not found.');
    if (!['active', 'rejected', 'suspended'].includes(data.status)) fail(422, 'Choose active, rejected or suspended.');
    const version = integer(data.version, 'Version');
    if (buyer.version !== version) fail(409, 'The buyer record changed. Reload before reviewing.');
    const why = data.status === 'active' && data.reason === undefined ? null : decisionReason(data.reason, 'Review reason');
    const held = buyer.status === 'pending' && data.status === 'active'
      ? await all(db, "SELECT id,reference FROM buyer_purchase_orders WHERE buyer_id=? AND status='entered'", buyer.id) : [];
    // A lost review must abort before session revocation or audit insertion.
    const guardQuery = query(db, 'INSERT INTO buyers(id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM buyers WHERE id=? AND workspace_id=? AND version=?)', buyer.id, buyer.id, w, version);
    try { await db.batch([guardQuery, query(db, 'UPDATE buyers SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?', data.status, now, buyer.id, w, version),
      ...(data.status !== 'active' ? [query(db, 'DELETE FROM buyer_sessions WHERE user_id IN (SELECT id FROM buyer_users WHERE buyer_id=?)', buyer.id)] : []),
      ...(data.status === 'rejected' ? [query(db, "UPDATE buyer_purchase_orders SET status='cancelled',updated_at=? WHERE buyer_id=? AND status IN ('entered','quoted')", now, buyer.id)] : []),
      ...held.map(rfq => notifyRole(db, w, 'sales_manager', 'buyer_rfq.received', 'buyer_rfq', rfq.id, rfq.reference)),
      audit(db, member, `buyer.${data.status === 'active' ? 'approved' : data.status}`, buyer.id, { reason: why }, 'staff', { reason: why, intervention, before: { status: buyer.status }, after: { status: data.status } })]); }
    catch { fail(409, 'The buyer record changed. Reload before reviewing.'); }
    return json({ saved: true });
  }

  if (path === '/api/erp/sales/quotes') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'poId', 'priceMinor', 'specifications', 'requestedDeliveryAt', 'paymentTerms', 'creditDays', 'note', 'productId', 'interventionReason']);
    const id = recordId(data.id); const po = await one(db, 'SELECT p.*,b.status AS buyer_status FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id WHERE p.id=? AND p.workspace_id=?', recordId(data.poId), w);
    if (!po) fail(404, 'Buyer RFQ not found.');
    const quote = { po: po.id, price: integer(data.priceMinor, 'Rate'), currency: (await settingsOf(db, w)).currency,
      specifications: multiline(data.specifications, 'Specifications', 5, 4000), delivery: date(data.requestedDeliveryAt, 'Requested delivery'),
      terms: multiline(data.paymentTerms, 'Payment terms', 3, 1000), creditDays: integer(data.creditDays, 'Credit days', 0, 365), note: multiline(data.note ?? '', 'Note', 0, 2000), productId: null };
    if (data.productId) { quote.productId = recordId(data.productId); if (!(await one(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', quote.productId, w))) fail(404, 'Material not found.'); }
    const fingerprint = q => sha256(JSON.stringify([q.po, q.price, q.currency, q.specifications, q.delivery, q.terms, q.creditDays, q.note, q.productId]));
    const previous = await one(db, 'SELECT * FROM sales_quote_revisions WHERE id=?', id);
    if (previous) {
      // Replay the exact payload from the stored revision; anything else is a conflict.
      const same = previous.workspace_id === w && await fingerprint({ po: previous.buyer_po_id, price: previous.price_minor, currency: previous.currency, specifications: previous.specifications,
        delivery: previous.requested_delivery_at, terms: previous.payment_terms, creditDays: previous.credit_days, note: previous.note, productId: previous.product_id }) === await fingerprint(quote);
      if (!same) fail(409, 'This request ID was used for different quote values.');
      return json({ revision: previous });
    }
    if (po.status === 'confirmed') fail(409, 'This RFQ is sold. Terms changes need an amendment flow that is not available yet.');
    if (po.status === 'cancelled') fail(409, 'This RFQ is closed.');
    if (po.buyer_status !== 'active') fail(409, NOT_APPROVED);
    if (quote.delivery <= now) fail(422, 'Requested delivery must be in the future.');
    lineAmount(quote.price, po.quantity_milli);
    // The next revision number is chosen inside the insert itself, so two simultaneous drafts cannot clash.
    try { await db.batch([guard(db, "NOT EXISTS(SELECT 1 FROM sales_quote_revisions WHERE buyer_po_id=? AND status='approved')", po.id),
      query(db, `INSERT INTO sales_quote_revisions(id,workspace_id,buyer_po_id,buyer_id,version,quantity_milli,unit,price_minor,currency,specifications,requested_delivery_at,payment_terms,credit_days,note,product_id,status,created_by,created_at,updated_at)
      SELECT ?,?,?,?,COALESCE((SELECT MAX(version)+1 FROM sales_quote_revisions WHERE buyer_po_id=?),1),?,?,?,?,?,?,?,?,?,?,'draft',?,?,?`, id, w, po.id, po.buyer_id, po.id,
      po.quantity_milli, po.unit, quote.price, quote.currency, quote.specifications, quote.delivery, quote.terms, quote.creditDays, quote.note, quote.productId, member.user_id, now, now),
      audit(db, member, 'sales.quote_drafted', id, { po: po.id }, 'staff', { intervention })]); }
    catch (error) {
      if (String(error).includes('Use the factory currency.')) fail(409, 'Use the factory currency. Reload to get the current currency.');
      fail(409, 'A quote was already accepted for this RFQ or it changed. Reload first.');
    }
    return json({ revision: await one(db, 'SELECT * FROM sales_quote_revisions WHERE id=?', id) }, 201);
  }

  if (path === '/api/erp/sales/quotes/send') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'interventionReason']);
    const revision = await one(db, 'SELECT r.*,p.status AS po_status,b.status AS buyer_status FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id JOIN buyers b ON b.id=p.buyer_id WHERE r.id=? AND r.workspace_id=?', recordId(data.id), w);
    if (!revision) fail(404, 'Quote revision not found.');
    if (revision.status === 'sent') return json({ sent: true });
    if (revision.status !== 'draft') fail(409, 'This revision was already accepted.');
    if (revision.buyer_status !== 'active' || !['entered', 'quoted'].includes(revision.po_status)) fail(409, NOT_APPROVED);
    if (revision.currency !== (await settingsOf(db, w)).currency) fail(409, 'Use the factory currency. Reload to get the current currency.');
    const latest = await one(db, 'SELECT MAX(version) AS v FROM sales_quote_revisions WHERE buyer_po_id=?', revision.buyer_po_id);
    if (latest.v !== revision.version) fail(409, 'Only the newest revision can be sent.');
    try { await db.batch([guard(db, "EXISTS(SELECT 1 FROM sales_quote_revisions WHERE id=? AND status='draft')", revision.id),
      query(db, "UPDATE sales_quote_revisions SET status='sent',updated_at=? WHERE id=? AND status='draft'", now, revision.id),
      query(db, "UPDATE buyer_purchase_orders SET status='quoted',sent_revision_id=?,sent_version=?,updated_at=? WHERE id=? AND status IN ('entered','quoted')", revision.id, revision.version, now, revision.buyer_po_id),
      audit(db, member, 'sales.quote_sent', revision.id, { version: revision.version, channel: 'buyer_portal_inbox' }, 'staff', { intervention })]); }
    catch (error) {
      if ((await one(db, 'SELECT status FROM sales_quote_revisions WHERE id=?', revision.id)).status === 'sent') return json({ sent: true });
      if (String(error).includes('already has an accepted quotation')) fail(409, 'This RFQ already has an accepted quotation.');
      fail(409, 'The quotation changed. Reload before sending.');
    }
    return json({ sent: true });
  }

  if (path === '/api/erp/sales/sales') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'revisionId', 'interventionReason']);
    const id = recordId(data.id), revisionId = recordId(data.revisionId);
    const noted = await one(db, 'SELECT id FROM sales_orders WHERE revision_id=? AND workspace_id=?', revisionId, w);
    const sale = await noteSale(db, member, { id, revisionId, intervention }, now);
    return json(sale, noted ? 200 : 201);
  }

  if (path === '/api/erp/sales/credit-notes') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'invoiceId', 'amountMinor', 'reason', 'interventionReason']);
    const id = recordId(data.id), invoice = await one(db, 'SELECT * FROM invoices WHERE id=? AND workspace_id=?', recordId(data.invoiceId), w);
    if (!invoice) fail(404, 'Invoice not found.');
    const amount = integer(data.amountMinor, 'Credit amount'), why = decisionReason(data.reason, 'Reason');
    const previous = await one(db, 'SELECT * FROM credit_notes WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.invoice_id !== invoice.id || previous.amount_minor !== amount || previous.reason !== why) fail(409, 'This request ID was used for different credit note values.');
      return json({ creditNote: previous });
    }
    const { credited } = await one(db, 'SELECT COALESCE(SUM(amount_minor),0) AS credited FROM credit_notes WHERE invoice_id=?', invoice.id);
    if (amount > invoice.total_minor - credited) fail(409, 'The credit is more than what is left on this invoice.');
    try { await db.batch([
      query(db, `INSERT INTO credit_notes(id,workspace_id,invoice_id,number,amount_minor,reason,created_by,created_at,updated_at)
        SELECT ?,workspace_id,id,'CN-'||number||'-'||((SELECT COUNT(*) FROM credit_notes WHERE invoice_id=invoices.id)+1),?,?,?,?,? FROM invoices WHERE id=?`, id, amount, why, member.user_id, now, now, invoice.id),
      audit(db, member, 'invoice.credited', id, { invoice: invoice.id, number: invoice.number, amount_minor: amount }, 'staff', { objectType: 'invoice', reason: why, intervention })]); }
    catch { fail(409, 'The credit is more than what is left on this invoice, or the invoice changed. Reload first.'); }
    return json({ creditNote: await one(db, 'SELECT * FROM credit_notes WHERE id=?', id) }, 201);
  }

  fail(404, 'Sales route not found.');
}
