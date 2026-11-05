/** Buyer portal: external buyer identities under `/api/buyer/*` with their own session cookie,
 * entirely separate from staff PIN accounts. Buyers see only their own organization's records.
 * The integration worker routes `/api/buyer/*` here next to the supplier portal. */
import { all, one, query, json, fail, text, multiline, keys, email, recordId, readJson, audit, date } from './erp-utils.mjs';
import { randomHex, sha256 } from './auth.mjs';
import { passwordHash } from './supplier-portal.mjs';
import { recordAcceptance, invoiceFileResponse, buyerData, buyerRfqData } from './sales.mjs';
import { notifyRole } from './notify.mjs';
import { confirmDelivery } from './delivery.mjs';

const COOKIE = 'yf_buyer_session';
const SESSION_MS = 12 * 3600_000;
const cookie = (request, value) => `${COOKIE}=${value ?? ''}; Path=/api/buyer; HttpOnly; SameSite=Strict${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}${value ? '' : '; Max-Age=0'}`;
const tokenOf = request => request.headers.get('Cookie')?.match(/(?:^|;\s*)yf_buyer_session=([a-f\d]{64})(?:;|$)/)?.[1];
const password = value => {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || value.trim().length < 12) fail(422, 'Use a password with 12–128 characters.');
  return value;
};
function equal(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
async function throttle(db, request, kind, limit, windowMs) {
  const now = Date.now(); const key = await sha256(`${kind}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`);
  await query(db, 'INSERT INTO portal_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END', key, now + windowMs, now, now, now + windowMs).run();
  if ((await one(db, 'SELECT attempts FROM portal_rate_limits WHERE key=?', key)).attempts > limit) fail(429, 'Too many attempts. Please wait before trying again.');
}
async function buyerSession(db, request) {
  const token = tokenOf(request); if (!token) return null;
  return one(db, `SELECT u.id AS user_id,u.name AS user_name,u.email AS user_email,u.buyer_id,b.workspace_id,b.status,b.name AS buyer_name
    FROM buyer_sessions x JOIN buyer_users u ON u.id=x.user_id JOIN buyers b ON b.id=u.buyer_id WHERE x.token_hash=? AND x.expires_at>?`, await sha256(token), Date.now());
}

async function buyerWorkspace(db, buyerId, workspaceId) {
  const [pos, revisions, orders, invoices, dispatches, deliveries, corrections, receivables, payments] = await Promise.all([
    all(db, 'SELECT id,reference,specifications,quantity_milli,unit,requested_delivery_at,payment_terms,status,source,created_at FROM buyer_purchase_orders WHERE buyer_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 200', buyerId, workspaceId),
    all(db, 'SELECT r.id,r.buyer_po_id,r.version,r.quantity_milli,r.unit,r.price_minor,r.currency,r.specifications,r.requested_delivery_at,r.payment_terms,r.credit_days,r.note,r.status,r.created_at FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id WHERE r.buyer_id=? AND p.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', buyerId, workspaceId),
    all(db, 'SELECT o.id,o.reference,o.buyer_po_id,o.status,o.terms_snapshot,o.created_at FROM sales_orders o WHERE o.buyer_id=? AND o.workspace_id=? ORDER BY o.created_at DESC LIMIT 200', buyerId, workspaceId),
    all(db, 'SELECT i.id,i.number,i.sales_order_id,i.total_minor,i.subtotal_minor,i.tax_rate_bp,i.tax_minor,i.due_at,i.currency,i.issued_at,i.lines_json,i.paid_minor,i.credited_minor,MAX(0,i.total_minor-i.paid_minor-i.credited_minor) AS outstanding_minor FROM invoice_balances i WHERE i.buyer_id=? AND i.workspace_id=? AND NOT EXISTS(SELECT 1 FROM invoice_voids v WHERE v.invoice_id=i.id AND v.workspace_id=i.workspace_id) ORDER BY i.issued_at DESC LIMIT 200', buyerId, workspaceId),
    all(db, `SELECT d.id,d.sales_order_id,d.quantity_milli,d.unit,d.carrier,d.documents_note,d.dispatched_at,COALESCE((SELECT status FROM dispatches x WHERE x.sales_dispatch_id=d.id),'dispatched') AS delivery_status FROM sales_dispatches d JOIN sales_orders o ON o.id=d.sales_order_id WHERE o.buyer_id=? AND d.workspace_id=? AND NOT EXISTS(SELECT 1 FROM movements m WHERE m.reverses=d.movement_id) ORDER BY d.created_at DESC LIMIT 500`, buyerId, workspaceId),
    all(db, `SELECT y.id,y.dispatch_id,y.delivery_date,y.evidence_note,y.created_at FROM sales_deliveries y JOIN sales_dispatches d ON d.id=y.dispatch_id JOIN sales_orders o ON o.id=d.sales_order_id WHERE o.buyer_id=? AND y.workspace_id=? ORDER BY y.created_at DESC LIMIT 500`, buyerId, workspaceId),
    all(db, `SELECT c.id,c.delivery_id,c.previous_date,c.corrected_date,c.due_revision,c.created_at FROM delivery_corrections c JOIN sales_deliveries y ON y.id=c.delivery_id JOIN sales_dispatches d ON d.id=y.dispatch_id JOIN sales_orders o ON o.id=d.sales_order_id WHERE o.buyer_id=? AND c.workspace_id=? ORDER BY c.created_at DESC LIMIT 500`, buyerId, workspaceId),
    all(db, 'SELECT r.id,r.invoice_id,r.amount_minor,r.paid_minor,r.currency,r.due_at,r.due_revision,r.status FROM receivables r WHERE r.buyer_id=? AND r.workspace_id=? ORDER BY r.created_at DESC LIMIT 500', buyerId, workspaceId),
    all(db, 'SELECT p.id,p.invoice_id,p.amount_minor,p.currency,p.created_at FROM sales_payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.buyer_id=? AND p.workspace_id=? ORDER BY p.created_at DESC LIMIT 500', buyerId, workspaceId),
  ]);
  return { pos, revisions, orders: orders.map(o => ({ ...o, terms: JSON.parse(o.terms_snapshot) })), invoices, dispatches, deliveries, corrections, receivables, payments, serverTime: Date.now() };
}

export async function buyerPortalApi(request, env, path) {
  const db = env.DB; const now = Date.now();
  if (!db) fail(503, 'The shared database is not connected.');
  const data = request.method === 'POST' ? await readJson(request) : null;
  if (path === '/api/buyer/config' && !data) {
    const factories = await all(db, 'SELECT name FROM workspaces ORDER BY created_at LIMIT 2');
    return json({ factory: factories.length === 1 ? factories[0].name : null, registrationAvailable: factories.length === 1 });
  }
  if (path === '/api/buyer/register' && data) {
    keys(data, ['company', 'contactName', 'email', 'phone', 'city', 'password']);
    await throttle(db, request, 'buyer-register', 10, 3600_000);
    const factories = await all(db, 'SELECT id FROM workspaces ORDER BY created_at LIMIT 2');
    if (factories.length !== 1) fail(503, 'Buyer registration needs a factory-specific setup. Contact the factory admin.');
    // `buyerData` validates the shared buyer shape; registration collects the company as `name`.
    const b = buyerData({ ...data, name: data.company }); const pw = password(data.password);
    if (await one(db, 'SELECT id FROM buyer_users WHERE email=?', b.email)) fail(409, 'This email is already registered. Sign in or contact the factory sales team.');
    const id = crypto.randomUUID(); const userId = crypto.randomUUID(); const salt = randomHex(16); const hash = await passwordHash(pw, salt);
    try { await db.batch([query(db, "INSERT INTO buyers(id,workspace_id,name,contact_name,email,phone,city,notes,status,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?, '','pending',1,?,?,?)", id, factories[0].id, b.name, b.contact, b.email, b.phone, b.city, `buyer:${userId}`, now, now),
      query(db, 'INSERT INTO buyer_users(id,buyer_id,email,name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)', userId, id, b.email, b.contact, hash, salt, now),
      notifyRole(db, factories[0].id, 'sales_manager', 'buyer.pending', 'buyer', id, b.name)]); }
    catch { fail(409, 'The registration could not be saved. This email may already be registered.'); }
    return json({ pending: true, message: 'Registration saved. Sign in to check its status. The sales team must approve your company first.' }, 201);
  }
  if (path === '/api/buyer/login' && data) {
    keys(data, ['email', 'password']); await throttle(db, request, 'buyer-login', 30, 15 * 60_000);
    const address = email(data.email); const pw = password(data.password);
    const u = await one(db, 'SELECT * FROM buyer_users WHERE email=?', address);
    if (u?.locked_until > now) fail(429, 'Too many incorrect passwords. Try again in 15 minutes.');
    // Derive even for unknown emails to avoid a cheap timing-based user lookup.
    const derived = await passwordHash(pw, u?.password_salt ?? 'unregistered-buyer');
    if (!u || !equal(derived, u.password_hash)) {
      if (u) await query(db, 'UPDATE buyer_users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN ? ELSE locked_until END WHERE id=?', now + 15 * 60_000, u.id).run();
      fail(401, 'Email and password do not match.');
    }
    const token = randomHex(32); const old = tokenOf(request);
    await db.batch([query(db, 'UPDATE buyer_users SET failed_attempts=0,locked_until=0 WHERE id=?', u.id),
      query(db, 'DELETE FROM buyer_sessions WHERE expires_at<=? OR token_hash=?', now, old ? await sha256(old) : ''),
      query(db, 'INSERT INTO buyer_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', await sha256(token), u.id, now, now + SESSION_MS)]);
    return json({ signedIn: true }, 200, { 'Set-Cookie': cookie(request, token) });
  }
  if (path === '/api/buyer/logout' && data) {
    keys(data, []); const token = tokenOf(request);
    if (token) await query(db, 'DELETE FROM buyer_sessions WHERE token_hash=?', await sha256(token)).run();
    return json({ signedOut: true }, 200, { 'Set-Cookie': cookie(request, null) });
  }
  const user = await buyerSession(db, request);
  if (!user) fail(401, 'Sign in to the buyer portal.');
  const buyerId = user.buyer_id; const w = user.workspace_id;
  if (path === '/api/buyer/me' && !data) {
    const buyer = await one(db, 'SELECT id,name,contact_name,email,phone,city,status,assigned_manager_id FROM buyers WHERE id=?', buyerId);
    const manager = buyer?.assigned_manager_id ? await one(db, 'SELECT name FROM users WHERE id=? AND status=\'active\'', buyer.assigned_manager_id) : null;
    return json({ user: { id: user.user_id, name: user.user_name, email: user.user_email }, buyer: { ...buyer, manager_name: manager?.name ?? null } });
  }
  if (user.status !== 'active') fail(403, 'The sales team must approve your company before you can use the portal.');
  if (path === '/api/buyer/workspace' && !data) return json(await buyerWorkspace(db, buyerId, w));
  if (path === '/api/buyer/pos' && data) {
    keys(data, ['id', 'reference', 'specifications', 'quantityMilli', 'unit', 'requestedDeliveryAt', 'paymentTerms']);
    const id = recordId(data.id);
    const po = buyerRfqData(data, now);
    const digest = await sha256(JSON.stringify(po));
    const previous = await one(db, 'SELECT * FROM buyer_purchase_orders WHERE id=?', id);
    if (previous) { if (previous.buyer_id !== buyerId || previous.request_hash !== digest) fail(409, 'This request ID was used for different PO values.'); return json({ po: previous }); }
    try { await db.batch([query(db, `INSERT INTO buyer_purchase_orders(id,workspace_id,buyer_id,reference,specifications,quantity_milli,unit,requested_delivery_at,payment_terms,status,source,request_hash,created_by,actor_type,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'entered','buyer_portal',?,?,'buyer',?,?)`, id, w, buyerId, po.reference, po.specifications, po.quantity, po.unit, po.delivery, po.terms, digest, user.user_id, now, now),
      audit(db, user, 'sales.po_submitted', id, { reference: po.reference }, 'buyer'),
      notifyRole(db, w, 'sales_manager', 'buyer_rfq.received', 'buyer_rfq', id, po.reference)]); }
    catch { fail(409, 'This PO reference is already used. Choose another reference.'); }
    return json({ po: await one(db, 'SELECT * FROM buyer_purchase_orders WHERE id=?', id) }, 201);
  }
  if (path === '/api/buyer/deliveries/confirm' && data) {
    keys(data, ['id', 'dispatchId', 'deliveryDate', 'note']);
    const result = await confirmDelivery(db, user, { id: recordId(data.id), salesDispatchId: recordId(data.dispatchId),
      deliveryDate: date(data.deliveryDate, 'Receipt time'), note: multiline(data.note ?? '', 'Receipt note', 0, 500), actorType: 'buyer', buyerId, now });
    return json(result, result.already ? 200 : 201);
  }
  if (path === '/api/buyer/approve' && data) {
    keys(data, ['revisionId', 'version', 'note']);
    const revision = await one(db, 'SELECT * FROM sales_quote_revisions WHERE id=? AND buyer_id=? AND workspace_id=?', recordId(data.revisionId), buyerId, w);
    if (!revision) fail(404, 'Quote not found.');
    const version = Number(data.version);
    if (!Number.isSafeInteger(version) || version !== revision.version) fail(409, 'This quote changed. Reload and approve the current revision.');
    const { already } = await recordAcceptance(db, { workspaceId: w, revisionId: revision.id, version, buyerId, acceptedBy: user.user_name, note: multiline(data.note ?? '', 'Approval note', 0, 1000), now });
    return json({ approved: true, already });
  }
  if (path.startsWith('/api/buyer/invoices/')) {
    if (request.method !== 'GET') fail(405, 'Method not allowed.');
    const invoice = await one(db, `SELECT i.*,o.reference AS order_reference,o.terms_snapshot FROM invoices i JOIN sales_orders o ON o.id=i.sales_order_id WHERE i.id=? AND i.buyer_id=? AND i.workspace_id=? AND NOT EXISTS(SELECT 1 FROM invoice_voids v WHERE v.invoice_id=i.id AND v.workspace_id=i.workspace_id)`, recordId(path.split('/')[4]), buyerId, w);
    if (!invoice) fail(404, 'Invoice not found.');
    const buyer = await one(db, 'SELECT * FROM buyers WHERE id=?', buyerId);
    const factory = await one(db, 'SELECT name FROM workspaces WHERE id=?', w);
    // ?format=json feeds the buyer's PDF download. Only this buyer's own invoice, its balance and its product names.
    if (new URL(request.url).searchParams.get('format') === 'json') {
      const balance = await one(db, 'SELECT credited_minor,paid_minor FROM invoice_balances WHERE id=? AND buyer_id=? AND workspace_id=?', invoice.id, buyerId, w);
      const lines = await all(db, 'SELECT l.sales_order_id,p.name AS product_name FROM sales_order_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.sales_order_id=? AND l.workspace_id=?', invoice.sales_order_id, w);
      return json({ invoice: { id: invoice.id, number: invoice.number, sales_order_id: invoice.sales_order_id, order_reference: invoice.order_reference, issued_at: invoice.issued_at,
        due_at: invoice.due_at, currency: invoice.currency, lines_json: invoice.lines_json, subtotal_minor: invoice.subtotal_minor, tax_rate_bp: invoice.tax_rate_bp,
        tax_minor: invoice.tax_minor, total_minor: invoice.total_minor, payment_terms: invoice.payment_terms, credit_days: invoice.credit_days,
        paid_minor: balance.paid_minor, credited_minor: balance.credited_minor, outstanding_minor: Math.max(0, invoice.total_minor - balance.credited_minor - balance.paid_minor) },
        lines, buyer: { name: buyer.name, contact_name: buyer.contact_name, city: buyer.city, email: buyer.email, phone: buyer.phone }, factoryName: factory.name });
    }
    return invoiceFileResponse(invoice, { reference: invoice.order_reference, terms: JSON.parse(invoice.terms_snapshot) }, buyer, factory.name);
  }
  fail(404, 'Buyer portal route not found.');
}
