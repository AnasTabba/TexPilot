/** Sales API for the factory staff side: buyer review, quotations, noted sales, invoices and credit
 * notes. Exported as `salesApi(request,env,member,path,data)` for `/api/erp/sales/*`.
 * The buyer-facing counterpart lives in server/buyer-portal.mjs under `/api/buyer/*`; buyers
 * register and submit RFQs there, and staff never create buyers or enter RFQs for them. */
import { all, one, query, json, fail, text, multiline, keys, integer, date, email, phone, recordId, audit, role, viewer, reason as decisionReason } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';
import { DEFAULT_SETTINGS, settingsOf, settingValue } from './governance.mjs';
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
export const rfqState = (status, buyerStatus) => status === 'cancelled' ? 'closed' : status === 'confirmed' ? 'sold' : status === 'quoted' ? 'quoted' : buyerStatus === 'pending' ? 'awaiting_buyer_approval' : 'open';

export function buyerData(data) {
  return { name: text(data.name, 'Buyer name', 2, 120), contact: text(data.contactName, 'Contact name', 2, 80),
    email: email(data.email), phone: phone(data.phone), city: text(data.city ?? '', 'City', 0, 100), notes: multiline(data.notes ?? '', 'Notes', 0, 2000) };
}

export function buyerRfqData(data, now) {
  const po = { reference: text(data.reference, 'PO reference', 2, 100), specifications: multiline(data.specifications, 'Specifications', 5, 4000),
    quantity: integer(data.quantityMilli, 'Quantity'), unit: ['kg', 'metre', 'piece'].includes(data.unit) ? data.unit : fail(422, 'Choose kg, metre or piece.'),
    delivery: date(data.requestedDeliveryAt, 'Requested delivery'), terms: multiline(data.paymentTerms, 'Payment terms', 3, 1000) };
  if (po.delivery <= now) fail(422, 'Requested delivery must be in the future.');
  return po;
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
export async function recordAcceptance(db, { workspaceId, revisionId, version, buyerId, acceptedBy, note = '', now, actor = { user_id: `buyer:${buyerId}`, workspace_id: workspaceId, role: 'buyer' } }) {
  if (actor.workspace_id !== workspaceId || actor.role !== 'buyer' || !actor.user_id) fail(403, 'Buyer identity does not match.');
  const replay = acceptance => {
    if (acceptance.version !== version || acceptance.note !== note || acceptance.accepted_by !== acceptedBy) fail(409, 'This quotation was already accepted with different details.');
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
        id, workspaceId, revisionId, buyerId, version, acceptedBy, actor.user_id, note, now, now),
      query(db, "UPDATE sales_quote_revisions SET status='approved',updated_at=? WHERE id=? AND status='sent'", now, revisionId),
      audit(db, { ...actor, user_id: actor.user_id === `buyer:${buyerId}` ? buyerId : actor.user_id }, 'quotation.accepted', revisionId, { version, acceptedBy, buyer: buyerId }, 'buyer', { objectType: 'quotation' }),
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

export function paymentStatus({ total_minor, credited_minor, paid_minor, due_at }, now) {
  if (total_minor - credited_minor - paid_minor <= 0) return 'paid';
  if (due_at !== null && now > due_at) return 'overdue';
  return paid_minor > 0 ? 'partially_paid' : 'unpaid';
}
const daysToDue = (due, now) => due === null ? null : (Date.parse(karachiDate(due)) - Date.parse(karachiDate(now))) / 86400000;
const balanceData = (invoice, now) => ({ ...invoice, outstanding_minor: Math.max(0, invoice.total_minor - invoice.credited_minor - invoice.paid_minor), status: paymentStatus(invoice, now), days_to_due: daysToDue(invoice.due_at, now) });
/** A buyer's payment position from its invoice balances (invoice_balances rows). `days_left` is the
 * Karachi calendar days to the earliest open due date; negative means that many days overdue.
 * Warn-only: nothing here blocks a quotation or an invoice. */
export function buyerPosition(buyer, invoices, now) {
  const outstanding = new Map(), overdue = new Map();
  let nextDue = null;
  for (const invoice of invoices) {
    const open = invoice.total_minor - invoice.credited_minor - invoice.paid_minor;
    if (open <= 0) continue;
    outstanding.set(invoice.currency, (outstanding.get(invoice.currency) ?? 0) + open);
    if (invoice.due_at === null) continue;
    if (now > invoice.due_at) overdue.set(invoice.currency, (overdue.get(invoice.currency) ?? 0) + open);
    if (nextDue === null || invoice.due_at < nextDue) nextDue = invoice.due_at;
  }
  const used = buyer.credit_limit_currency ? outstanding.get(buyer.credit_limit_currency) ?? 0 : null;
  return {
    outstanding: [...outstanding].map(([currency, outstanding_minor]) => ({ currency, outstanding_minor })),
    overdue: [...overdue].map(([currency, overdue_minor]) => ({ currency, overdue_minor })),
    next_due_at: nextDue, days_left: daysToDue(nextDue, now),
    credit_used_minor: used, over_limit: buyer.credit_limit_minor != null && used !== null && used > buyer.credit_limit_minor,
  };
}

export async function creditAlertsScheduled(env, now = Date.now()) {
  const db = env.DB;
  let checked = 0, created = 0;
  for (const workspace of await all(db, 'SELECT id FROM workspaces')) {
    const { credit_alert_days } = await settingsOf(db, workspace.id);
    const invoices = await all(db, 'SELECT * FROM invoice_balances WHERE workspace_id=? AND due_at IS NOT NULL AND total_minor>credited_minor+paid_minor', workspace.id);
    checked += invoices.length;
    for (const invoice of invoices) {
      const d = daysToDue(invoice.due_at, now), n = [...credit_alert_days].sort((a,b) => a-b).find(n => d <= n);
      const kind = now > invoice.due_at ? 'overdue' : d === 0 ? 'due_today' : n === undefined ? null : `before_${n}`;
      if (!kind || await one(db, 'SELECT id FROM credit_alerts WHERE invoice_id=? AND kind=?', invoice.id, kind)) continue;
      try {
        await db.batch([
          guard(db, 'EXISTS(SELECT 1 FROM invoice_balances WHERE id=? AND workspace_id=? AND total_minor>credited_minor+paid_minor)', invoice.id, workspace.id),
          query(db, 'INSERT INTO credit_alerts(id,workspace_id,invoice_id,kind,created_at,updated_at) VALUES(?,?,?,?,?,?)', crypto.randomUUID(), workspace.id, invoice.id, kind, now, now),
          notifyRole(db, workspace.id, 'sales_manager', kind.startsWith('before_') ? 'payment.due_soon' : `payment.${kind}`, 'invoice', invoice.id, invoice.number),
        ]);
        created++;
      } catch (error) {
        // Only a settled balance or an alert committed by another run is an expected race.
        const current = await one(db, 'SELECT * FROM invoice_balances WHERE id=?', invoice.id);
        if (current && current.total_minor > current.credited_minor + current.paid_minor && !await one(db, 'SELECT id FROM credit_alerts WHERE invoice_id=? AND kind=?', invoice.id, kind)) throw error;
      }
    }
  }
  return { checked, created };
}

async function salesOverview(db, w, now) {
  const [buyers, rfqs, revisions, acceptances, orders, invoices, creditNotes, products, settings] = await Promise.all([
    all(db, "SELECT id,name,contact_name,email,phone,city,notes,assigned_manager_id,status,version,created_at,updated_at FROM buyers WHERE workspace_id=? AND status!='archived' ORDER BY name COLLATE NOCASE LIMIT 500", w),
    all(db, 'SELECT p.id,p.buyer_id,p.reference,p.specifications,p.quantity_milli,p.unit,p.requested_delivery_at,p.payment_terms,p.status,p.sent_revision_id,p.sent_version,p.created_at,p.updated_at,b.name AS buyer_name,b.status AS buyer_status FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 200', w),
    all(db, 'SELECT r.* FROM sales_quote_revisions r WHERE r.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', w),
    all(db, 'SELECT a.* FROM quotation_acceptances a WHERE a.workspace_id=? ORDER BY a.created_at DESC LIMIT 500', w),
    all(db, 'SELECT o.*,b.name AS buyer_name FROM sales_orders o JOIN buyers b ON b.id=o.buyer_id WHERE o.workspace_id=? ORDER BY o.created_at DESC LIMIT 200', w),
    all(db, 'SELECT i.*,o.reference AS order_reference FROM invoice_balances i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.workspace_id=? ORDER BY i.issued_at DESC LIMIT 500', w),
    all(db, 'SELECT c.* FROM credit_notes c WHERE c.workspace_id=? ORDER BY c.created_at DESC LIMIT 500', w),
    all(db, 'SELECT id,sku,name FROM products WHERE workspace_id=? ORDER BY name', w),
    settingsOf(db, w),
  ]);
  const alertsByInvoice = new Map();
  for (const alert of await all(db, 'SELECT * FROM credit_alerts WHERE workspace_id=? AND invoice_id IN (SELECT value FROM json_each(?)) ORDER BY created_at', w, JSON.stringify(invoices.map(invoice => invoice.id)))) {
    if (!alertsByInvoice.has(alert.invoice_id)) alertsByInvoice.set(alert.invoice_id, []);
    alertsByInvoice.get(alert.invoice_id).push(alert);
  }
  return json({ buyers, rfqs: rfqs.map(({ buyer_status, ...rfq }) => ({ ...rfq, state: rfqState(rfq.status, buyer_status) })), revisions, acceptances, orders, invoices: invoices.map(invoice => ({ ...balanceData(invoice, now), alerts: alertsByInvoice.get(invoice.id) ?? [] })), creditNotes, products, settings });
}

/** One row per buyer: quantities sold (sales order lines), invoiced totals, and the payment position. */
async function buyersSummary(db, w, now) {
  const [buyers, sold, invoiced, open] = await Promise.all([
    all(db, "SELECT id,name,contact_name,email,phone,city,notes,status,version,credit_limit_minor,credit_limit_currency FROM buyers WHERE workspace_id=? AND status!='archived' ORDER BY name COLLATE NOCASE LIMIT 500", w),
    all(db, 'SELECT o.buyer_id,l.unit,SUM(l.quantity_milli) AS quantity_milli FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id WHERE l.workspace_id=? GROUP BY o.buyer_id,l.unit', w),
    all(db, 'SELECT buyer_id,currency,SUM(total_minor) AS total_minor,COUNT(*) AS invoices FROM invoices WHERE workspace_id=? GROUP BY buyer_id,currency', w),
    all(db, 'SELECT buyer_id,currency,total_minor,credited_minor,paid_minor,due_at FROM invoice_balances WHERE workspace_id=? AND total_minor>credited_minor+paid_minor', w),
  ]);
  const rowsFor = (rows, buyerId) => rows.filter(row => row.buyer_id === buyerId).map(({ buyer_id, ...row }) => row);
  return json({ buyers: buyers.map(buyer => ({ ...buyer, sold: rowsFor(sold, buyer.id), invoiced: rowsFor(invoiced, buyer.id),
    ...buyerPosition(buyer, open.filter(row => row.buyer_id === buyer.id), now) })) });
}

export async function salesApi(request, env, member, path, data) {
  const db = env.DB; const w = member.workspace_id; const now = Date.now();
  if (!db) fail(503, 'The shared database is not connected.');

  if (!data) {
    viewer(member, 'sales_manager');
    if (path === '/api/erp/sales') return salesOverview(db, w, now);
    if (path === '/api/erp/sales/buyers/summary') return buyersSummary(db, w, now);
    if (path === '/api/erp/sales/settings') return json({ settings: await settingsOf(db, w) });
    if (path.startsWith('/api/erp/sales/invoices/')) {
      const invoice = await one(db, 'SELECT i.*,o.reference AS order_reference,o.terms_snapshot FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.id=? AND i.workspace_id=?', recordId(path.split('/')[5]), w);
      if (!invoice) fail(404, 'Invoice not found.');
      const buyer = await one(db, 'SELECT * FROM buyers WHERE id=?', invoice.buyer_id);
      const factory = await one(db, 'SELECT name FROM workspaces WHERE id=?', w);
      return invoiceFileResponse(invoice, { reference: invoice.order_reference, terms: JSON.parse(invoice.terms_snapshot) }, buyer, factory.name);
    }
    fail(405, 'Method not allowed.');
  }

  if (path === '/api/erp/sales/payments' && request.method === 'POST') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'invoiceId', 'amountMinor', 'receivedAt', 'note', 'interventionReason']);
    const id = recordId(data.id), invoiceId = recordId(data.invoiceId), amount = integer(data.amountMinor, 'Payment amount'), received = date(data.receivedAt, 'Received date'), note = multiline(data.note ?? '', 'Note', 0, 2000);
    const invoice = await one(db, 'SELECT * FROM invoice_balances WHERE id=? AND workspace_id=?', invoiceId, w);
    if (!invoice) fail(404, 'Invoice not found.');
    if (invoice.due_at === null) fail(409, 'This invoice has no due date and cannot take payments.');
    const result = async (payment, status) => json({ payment, invoice: balanceData(await one(db, 'SELECT * FROM invoice_balances WHERE id=? AND workspace_id=?', invoiceId, w), now) }, status);
    const replay = payment => {
      if (payment.workspace_id !== w || payment.invoice_id !== invoiceId || payment.amount_minor !== amount || payment.received_at !== received || payment.note !== note) fail(409, 'This request ID was used for different payment values.');
      return result(payment, 200);
    };
    const previous = await one(db, 'SELECT * FROM invoice_payments WHERE id=?', id);
    if (previous) return replay(previous);
    try {
      await db.batch([
        query(db, 'INSERT INTO invoice_payments(id,workspace_id,invoice_id,amount_minor,received_at,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, w, invoiceId, amount, received, note, member.user_id, now, now),
        audit(db, member, 'payment.recorded', id, { invoice: invoiceId, amount_minor: amount }, 'staff', { objectType: 'payment', intervention }),
      ]);
    } catch (error) {
      const raced = await one(db, 'SELECT * FROM invoice_payments WHERE id=?', id);
      if (raced) return replay(raced);
      if (String(error).includes('payment exceeds balance')) fail(409, 'This payment is more than the amount still owed.');
      throw error;
    }
    return result(await one(db, 'SELECT * FROM invoice_payments WHERE id=?', id), 201);
  }

  // Warn-only credit limit: stored per buyer, shown on the buyers page, never checked when quoting or invoicing.
  // Admin-only: the admin assigns limits, so no intervention reason is asked for.
  if (path === '/api/erp/sales/buyers/credit-limit') {
    viewer(member);
    keys(data, ['id', 'amountMinor', 'currency']);
    const buyerId = recordId(data.id);
    const buyer = await one(db, "SELECT id,credit_limit_minor,credit_limit_currency FROM buyers WHERE id=? AND workspace_id=? AND status!='archived'", buyerId, w);
    if (!buyer) fail(404, 'Buyer not found.');
    // null clears the limit; otherwise a whole amount in minor units and a supported currency are both required.
    const clear = data.amountMinor === null;
    if (clear && data.currency != null) fail(422, 'Clear the limit without a currency.');
    const after = clear ? { credit_limit_minor: null, credit_limit_currency: null }
      : { credit_limit_minor: integer(data.amountMinor, 'Credit limit', 0, Number.MAX_SAFE_INTEGER),
        credit_limit_currency: ['PKR', 'USD', 'EUR', 'GBP'].includes(data.currency) ? data.currency : fail(422, 'Choose PKR, USD, EUR or GBP.') };
    const before = { credit_limit_minor: buyer.credit_limit_minor, credit_limit_currency: buyer.credit_limit_currency };
    await db.batch([
      query(db, 'UPDATE buyers SET credit_limit_minor=?,credit_limit_currency=?,updated_at=? WHERE id=? AND workspace_id=?', after.credit_limit_minor, after.credit_limit_currency, now, buyerId, w),
      audit(db, member, 'buyer.credit_limit_changed', buyerId, {}, 'staff', { objectType: 'buyer', before, after }),
    ]);
    return json({ saved: true, ...after });
  }

  // Invoice and factory settings, admin-only (the sales manager reads them via GET). Same keys and validation as /api/erp/admin/settings.
  if (path === '/api/erp/sales/settings') {
    viewer(member);
    keys(data, ['key', 'value']);
    const value = settingValue(data.key, data.value);
    const previous = await one(db, 'SELECT value_json FROM settings WHERE workspace_id=? AND key=?', w, data.key);
    const before = previous ? JSON.parse(previous.value_json) : DEFAULT_SETTINGS[data.key];
    try { await db.batch([
      query(db, `INSERT INTO settings(workspace_id,key,value_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(workspace_id,key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        w, data.key, JSON.stringify(value), member.user_id, now, member.user_id, now),
      audit(db, member, 'setting.changed', data.key, {}, 'staff', { before: { value: before }, after: { value } }),
    ]); }
    catch (error) {
      if (/Close open bids/.test(String(error))) fail(409, 'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.');
      throw error;
    }
    return json({ saved: true });
  }

  // Contact details the sales team keeps current. Status and credit limit have their own routes.
  if (path === '/api/erp/sales/buyers/profile') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'version', 'contactName', 'phone', 'city', 'notes', 'interventionReason']);
    const buyerId = recordId(data.id), version = integer(data.version, 'Version');
    const edits = {};
    if (data.contactName !== undefined) edits.contact_name = text(data.contactName, 'Contact name', 2, 80);
    if (data.phone !== undefined) edits.phone = phone(data.phone);
    if (data.city !== undefined) edits.city = text(data.city, 'City', 0, 100);
    if (data.notes !== undefined) edits.notes = multiline(data.notes, 'Notes', 0, 2000);
    if (!Object.keys(edits).length) fail(422, 'Change at least one profile field.');
    const buyer = await one(db, "SELECT * FROM buyers WHERE id=? AND workspace_id=? AND status!='archived'", buyerId, w);
    if (!buyer) fail(404, 'Buyer not found.');
    if (buyer.version !== version) fail(409, 'The buyer record changed. Reload before editing.');
    const before = Object.fromEntries(Object.keys(edits).map(k => [k, buyer[k]])), after = { ...edits };
    // The guard aborts the batch when a concurrent edit already moved the version, so no audit row is written for a lost update.
    try { await db.batch([guard(db, 'EXISTS(SELECT 1 FROM buyers WHERE id=? AND workspace_id=? AND version=?)', buyerId, w, version),
      query(db, `UPDATE buyers SET ${[...Object.keys(edits).map(k => k + '=?'), 'version=version+1', 'updated_at=?'].join(',')} WHERE id=? AND workspace_id=? AND version=?`, ...Object.values(edits), now, buyerId, w, version),
      audit(db, member, 'buyer.profile_updated', buyerId, {}, 'staff', { objectType: 'buyer', before, after, intervention })]); }
    catch { fail(409, 'The buyer record changed. Reload before editing.'); }
    return json({ saved: true, version: version + 1 });
  }

  if (path === '/api/erp/sales/buyers/review') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'status', 'reason', 'version', 'interventionReason']);
    const buyer = await one(db, 'SELECT * FROM buyers WHERE id=? AND workspace_id=?', recordId(data.id), w);
    if (!buyer) fail(404, 'Buyer not found.');
    if (!['active', 'rejected', 'suspended'].includes(data.status)) fail(422, 'Choose active, rejected or suspended.');
    const version = integer(data.version, 'Version');
    if (buyer.version !== version) fail(409, 'The buyer record changed. Reload before reviewing.');
    // Rejected is final; pending is only approved or rejected.
    const moves = { pending: ['active', 'rejected'], active: ['suspended', 'rejected'], suspended: ['active', 'rejected'] };
    if (!(moves[buyer.status] || []).includes(data.status)) fail(409, `A ${buyer.status} buyer cannot be moved to ${data.status}.`);
    const why = data.status === 'active' && data.reason === undefined ? null : decisionReason(data.reason, 'Review reason');
    const held = buyer.status === 'pending' && data.status === 'active'
      ? await all(db, "SELECT id,reference FROM buyer_purchase_orders WHERE buyer_id=? AND status='entered'", buyer.id) : [];
    // A lost review must abort before session revocation or audit insertion.
    const guardQuery = query(db, 'INSERT INTO buyers(id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM buyers WHERE id=? AND workspace_id=? AND version=?)', buyer.id, buyer.id, w, version);
    // Pending intake can arrive after the held list was read. Refuse this review so its retry
    // includes every RFQ and no received notification is silently lost.
    const heldGuard = buyer.status === 'pending' && data.status === 'active'
      ? [guard(db, "(SELECT COUNT(*) FROM buyer_purchase_orders WHERE buyer_id=? AND status='entered')=?", buyer.id, held.length)] : [];
    try { await db.batch([guardQuery, ...heldGuard, query(db, 'UPDATE buyers SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?', data.status, now, buyer.id, w, version),
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
