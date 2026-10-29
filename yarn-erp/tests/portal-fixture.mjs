import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';
import { settingsOf } from '../server/governance.mjs';
import { recordAcceptance } from '../server/sales.mjs';

// Smallest JPEG-shaped bytes the magic-byte check accepts.
export const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
export const dir = new URL('../drizzle/', import.meta.url);
export const legacyMigrations = ['0000_inventory.sql','0001_users.sql','0002_procurement.sql','0003_purchase_receipts.sql'];
export function migrate(sql, names = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  for (const name of names) sql.exec(readFileSync(new URL(name, dir), 'utf8'));
}
export async function portalFixture(database) {
  const sql = database ?? new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  if (!database) { migrate(sql); for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args); }
  const storage = new Map();
  const env = { DB: sqliteBinding(sql), BUCKET: {
    async put(key, bytes) { storage.set(key, bytes); },
    async get(key) { return storage.has(key) ? { body: storage.get(key) } : null; },
    async delete(key) { storage.delete(key); },
  } };
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id;
  const adminId = sql.prepare("SELECT id FROM users WHERE name='Anas'").get().id;
  const cookies = new Map();
  async function request(path, body, cookie, headers = {}) {
    const response = await inventoryApi(new Request('https://yarnflow.test/api' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://yarnflow.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    const text = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null, text, headers: response.headers };
  }
  async function login(name, pin = '2468') {
    const result = await request('/auth/login', { name, pin });
    const cookie = result.headers.get('set-cookie')?.split(';')[0];
    if (result.status === 200) cookies.set(name, cookie);
    return { ...result, cookie };
  }
  async function call(path, body, as = 'Anas', headers = {}) {
    if (as && !cookies.has(as)) assert.equal((await login(as)).status, 200, `${as} signs in`);
    return request(path, body, as ? cookies.get(as) : null, headers);
  }
  async function person(name, role) {
    const row = await userRow({ workspaceId, name, role, pin: '2468', createdBy: adminId });
    sql.prepare(row.sql).run(...row.args); return row.args[0];
  }
  async function insertSupplier({ name = 'Mill ' + crypto.randomUUID().slice(0, 6), status = 'pending', categories = ['cotton'], createdAt = Date.now() } = {}) {
    const id = crypto.randomUUID(), now = Date.now();
    sql.prepare('INSERT INTO suppliers(id,workspace_id,name,contact_name,email,phone,city,website,source_url,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, workspaceId, name, 'Contact', id.slice(0, 8) + '@mill.test', '+923001234567', 'Karachi', '', '', status, 'supplier:' + id, createdAt, now);
    for (const category of categories) sql.prepare('INSERT INTO supplier_category_links(supplier_id,category_id) VALUES(?,?)').run(id, category);
    return id;
  }
  async function insertBuyer({ status = 'pending' } = {}) {
    const id = crypto.randomUUID(), now = Date.now();
    sql.prepare('INSERT INTO buyers(id,workspace_id,name,contact_name,email,phone,city,notes,status,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)')
      .run(id, workspaceId, `Buyer ${id.slice(0, 8)}`, 'Buyer Contact', `${id.slice(0, 8)}@buyer.test`, '+923001234567', 'Lahore', '', status, 'buyer:self-registered', now, now);
    return id;
  }
  async function insertBuyerRfq({ buyerId, quantityMilli = 100000, unit = 'kg' }) {
    const id = crypto.randomUUID(), now = Date.now();
    sql.prepare(`INSERT INTO buyer_purchase_orders(id,workspace_id,buyer_id,reference,specifications,quantity_milli,unit,requested_delivery_at,payment_terms,status,source,request_hash,created_by,actor_type,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'entered','buyer_portal',?,?,'buyer',?,?)`)
      .run(id, workspaceId, buyerId, `RFQ-${id.slice(0, 8)}`, 'Combed cotton single jersey, 180 GSM', quantityMilli, unit, now + 21 * 86400000, 'Net 30 days after delivery', id, `buyer:${buyerId}`, now, now);
    return id;
  }
  // An approved buyer, a sent quotation and its recorded acceptance, ready for noteSale.
  async function acceptedQuote({ priceMinor = 125000, creditDays = 30 } = {}) {
    const buyerId = await insertBuyer({ status: 'active' }), rfqId = await insertBuyerRfq({ buyerId });
    const revisionId = crypto.randomUUID(), now = Date.now(), { currency } = await settingsOf(env.DB, workspaceId);
    sql.prepare(`INSERT INTO sales_quote_revisions(id,workspace_id,buyer_po_id,buyer_id,version,quantity_milli,unit,price_minor,currency,specifications,requested_delivery_at,payment_terms,credit_days,status,created_by,created_at,updated_at)
      SELECT ?,workspace_id,id,buyer_id,1,quantity_milli,unit,?,?,specifications,requested_delivery_at,payment_terms,?,'draft',?,?,? FROM buyer_purchase_orders WHERE id=?`)
      .run(revisionId, priceMinor, currency, creditDays, adminId, now, now, rfqId);
    sql.prepare("UPDATE sales_quote_revisions SET status='sent' WHERE id=?").run(revisionId);
    sql.prepare("UPDATE buyer_purchase_orders SET status='quoted',sent_revision_id=?,sent_version=1 WHERE id=?").run(revisionId, rfqId);
    await recordAcceptance(env.DB, { workspaceId, revisionId, version: 1, buyerId, acceptedBy: 'Buyer Contact', now });
    return { buyerId, rfqId, revisionId };
  }
  // A submitted bid for a published RFQ; the quantity defaults to the full RFQ quantity.
  function insertBid({ rfqId, supplierId, priceMinor = 125000, quantityMilli }) {
    const id = crypto.randomUUID(), now = Date.now();
    quantityMilli ??= sql.prepare('SELECT quantity_milli FROM procurement_rfqs WHERE id=?').get(rfqId).quantity_milli;
    const currency = sql.prepare("SELECT json_extract(value_json,'$') AS c FROM settings WHERE workspace_id=? AND key='currency'").get(workspaceId)?.c ?? 'PKR';
    sql.prepare("INSERT INTO supplier_bids(id,rfq_id,supplier_id,quantity_milli,price_minor,currency,payment_terms,delivery_at,valid_until,note,version,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,'submitted',?,?,?)")
      .run(id, rfqId, supplierId, quantityMilli, priceMinor, currency, '30 days after delivery', now + 7 * 86400000, now + 3 * 86400000, 'Freight included', 'supplier:' + supplierId, now, now);
    return id;
  }
  // An approved PO with one shipment, written straight to the tables (the award route has its own tests).
  async function insertPO({ supplierId, priceMinor = 125000, quantityMilli = 100000, unit = 'kg', deliveryAt }) {
    const rfqId = crypto.randomUUID(), orderId = crypto.randomUUID(), shipmentId = crypto.randomUUID(), now = Date.now(), day = 86400000;
    sql.prepare(`INSERT INTO procurement_rfqs(id,workspace_id,reference,title,category_id,specifications,quantity_milli,unit,delivery_location,deadline_at,requested_delivery_at,status,request_hash,created_by,created_at,published_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`).run(rfqId, workspaceId, `RFQ-${rfqId.slice(0, 8)}`, 'Cotton combed 30/1', 'cotton', 'Ring-spun 30/1', quantityMilli, unit, 'Karachi factory', now + day, now + 7 * day, rfqId, adminId, now, now, now);
    sql.prepare('INSERT INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) VALUES(?,?,?,?)').run(rfqId, supplierId, '{}', now);
    const bidId = insertBid({ rfqId, supplierId, priceMinor, quantityMilli });
    const terms = { rfq_id: rfqId, supplier_id: supplierId, price_minor: priceMinor, currency: 'PKR', delivery_at: deliveryAt ?? now + 7 * day, quantity_milli: quantityMilli, unit, title: 'Cotton combed 30/1', specifications: 'Ring-spun 30/1' };
    sql.prepare(`INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at,quantity_milli,total_minor,approval_status,version,updated_at,created_by)
      VALUES(?,?,?,?,?,?,?,'accepted',?,?,?,?,'approved',1,?,?)`).run(orderId, workspaceId, rfqId, bidId, supplierId, `PO-${orderId.slice(0, 8)}`, JSON.stringify(terms), adminId, now, quantityMilli, Math.round(priceMinor * quantityMilli / 1000), now, adminId);
    sql.prepare("UPDATE procurement_rfqs SET status='awarded' WHERE id=?").run(rfqId);
    sql.prepare('INSERT INTO shipments(id,workspace_id,purchase_order_id,bill_of_lading,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(shipmentId, workspaceId, orderId, `BL-${shipmentId.slice(0, 8)}`, adminId, now, now);
    return { orderId, shipmentId };
  }
  async function insertProduct() {
    const id = crypto.randomUUID();
    sql.prepare('INSERT INTO products(id,workspace_id,sku,name,created_at) VALUES(?,?,?,?,?)').run(id, workspaceId, `SKU-${id.slice(0, 8)}`, `Cotton ${id.slice(0, 4)}`, Date.now());
    return id;
  }
  // A multipart photo upload to /api/erp/qc/photos; fields become form fields.
  async function upload(fields, as = 'Qasim', bytes = jpeg, name = 'p.jpg', type = 'image/jpeg') {
    if (!cookies.has(as)) assert.equal((await login(as)).status, 200, `${as} signs in`);
    const form = new FormData(); for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('photo', new File([bytes], name, { type }));
    const response = await inventoryApi(new Request('https://yarnflow.test/api/erp/qc/photos', { method: 'POST', headers: { Origin: 'https://yarnflow.test', Cookie: cookies.get(as) }, body: form }), env);
    const body = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(body) : null, text: body };
  }
  function setThreshold(type, value) {
    const now = Date.now(), currency = ['purchase', 'claim'].includes(type) ? JSON.parse(sql.prepare("SELECT value_json FROM settings WHERE workspace_id=? AND key='currency'").get(workspaceId)?.value_json ?? '"PKR"') : null;
    sql.prepare('INSERT INTO thresholds(workspace_id,type,value,currency,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,type) DO UPDATE SET value=excluded.value,currency=excluded.currency,updated_at=excluded.updated_at')
      .run(workspaceId, type, value, currency, adminId, now, adminId, now);
  }
  // A lot of its own (or the given one), then an inspection with the photo and issue its quantities need, submitted for the supervisor. Creates the people and one approved supplier/PO on first use.
  let submittedContext;
  let reference = 0;
  async function submitted({ acceptedMilli = 0, rejectedMilli = 0, lotId, lotQuantityMilli = 100000 } = {}) {
    for (const [name, role] of [['Pervaiz', 'purchase_manager'], ['Qasim', 'quality_inspector'], ['Saima', 'supervisor']]) if (!sql.prepare('SELECT 1 FROM users WHERE name=?').get(name)) await person(name, role);
    if (!submittedContext) {
      const supplierId = await insertSupplier({ status: 'approved' });
      submittedContext = { supplierId, ...await insertPO({ supplierId, quantityMilli: 100_000_000 }), productId: await insertProduct() };
    }
    const step = async (path, body, as) => { const result = await call(path, body, as); assert.ok(result.status < 300, `${path}: ${result.text}`); return result; };
    if (!lotId) {
      lotId = crypto.randomUUID();
      await step('/erp/qc/lots', { id: lotId, orderId: submittedContext.orderId, shipmentId: submittedContext.shipmentId, productId: submittedContext.productId, reference: `LOT-${++reference}`, quantityMilli: lotQuantityMilli, arrivedAt: Date.now() - 1000 }, 'Pervaiz');
    }
    const inspectionId = crypto.randomUUID();
    await step('/erp/qc/inspections', { id: inspectionId, lotId, acceptedMilli, rejectedMilli }, 'Qasim');
    if (acceptedMilli) assert.equal((await upload({ id: crypto.randomUUID(), inspectionId }, 'Qasim')).status, 201);
    if (rejectedMilli) await step('/erp/qc/issues', { id: crypto.randomUUID(), inspectionId, type: 'Shade variation', severity: 'major', description: 'Dye lot differs from the approved sample' }, 'Qasim');
    await step('/erp/qc/inspections/submit', { id: inspectionId }, 'Qasim');
    return { lotId, inspectionId, ...submittedContext };
  }
  return { sql, env, storage, submitted, workspaceId, adminId, person, insertSupplier, insertBid, insertPO, insertProduct, upload, setThreshold, login, call, member: async name => (await call('/workspace', undefined, name)).data.member, insertBuyer, insertBuyerRfq, acceptedQuote };
}

// Deliberately uses the pre-portal schema, including real commercial and immutable data.
export function liveShapedRows(sql) {
  const now = Date.now(), future = now + 86400000;
  function insert(table, data) { const cols = Object.keys(data); sql.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(data)); }
  insert('workspaces', { id: 'factory', name: 'Live factory', created_at: now });
  const all = ['receive','produce','dispatch','catalog','inspect','qc','waste','reverse','suppliers','procure','sales','production','payments'];
  const people = { Anas: [], Fahad: [], Zuhair: [], Stores: ['receive','catalog'], Quality: ['inspect','qc'], Dispatch: ['dispatch'], Purchase: ['suppliers','procure'], Everything: all, ViewOnly: [], Pending: [] };
  for (const [name, permissions] of Object.entries(people)) {
    insert('users', { id: name, workspace_id: 'factory', name, name_key: name.toLowerCase(), pin_hash: createHash('sha256').update('legacy-salt:2468').digest('hex'), pin_salt: 'legacy-salt', role: ['Anas','Fahad','Zuhair'].includes(name) ? 'admin' : 'member', status: name === 'Pending' ? 'pending' : 'active', permissions: JSON.stringify(permissions), created_at: now, created_by: null });
    insert('sessions', { token_hash: createHash('sha256').update(name).digest('hex'), user_id: name, expires_at: future, created_at: now });
  }
  for (const id of ['cotton','blend']) insert('products', { id, workspace_id: 'factory', sku: id, name: id + ' yarn', barcode: id + '-barcode', created_at: now });
  for (const [id, product] of [['lot1','cotton'],['lot2','cotton'],['lot3','blend']]) insert('lots', { id, workspace_id: 'factory', product_id: product, batch: id, supplier: 'Legacy mill', quality: 'approved', created_at: now });
  for (const [id, lot, action, from, to, grams] of [['receive1','lot1','receive',null,'raw',10000],['transfer1','lot1','transfer','raw','finished',4000],['dispatch1','lot1','dispatch','finished',null,1000],['receive2','lot2','receive',null,'raw',2000],['receive3','lot3','receive',null,'cops',3000]]) {
    insert('movements', { id, workspace_id: 'factory', lot_id: lot, action, from_stage: from, to_stage: to, grams, cartons: 0, cones: 0, note: 'Existing movement', actor: 'Anas', actor_name: 'Anas', request_hash: id + '-hash', created_at: now });
    for (const [stage, sign] of [[from,-1],[to,1]]) if (stage) insert('stock_deltas', { id: id + stage, movement_id: id, lot_id: lot, stage, grams: sign * grams, cartons: 0, cones: 0 });
  }
  insert('quality_events', { id: 'quality1', workspace_id: 'factory', lot_id: 'lot1', status: 'approved', note: 'Original inspection', actor: 'Anas', actor_name: 'Anas', created_at: now });
  insert('suppliers', { id: 'mill', workspace_id: 'factory', name: 'Legacy mill', contact_name: 'Contact', email: 'mill@example.test', phone: '+923001234567', city: 'Karachi', website: 'https://example.test/', source_url: 'https://example.test/contact', source_checked_at: now, status: 'approved', request_hash: 'supplier-hash', created_at: now, updated_at: now });
  insert('supplier_registration_reviews', { id: 'review', supplier_id: 'mill', version: 2, status: 'approved', reason: 'Company checked', actor_id: 'Anas', created_at: now });
  insert('supplier_users', { id: 'supplier-person', supplier_id: 'mill', email: 'mill@example.test', name: 'Contact', password_hash: 'legacy-password-hash', password_salt: 'legacy-password-salt', created_at: now });
  insert('procurement_rfqs', { id: 'rfq', workspace_id: 'factory', reference: 'RFQ-001', title: 'Cotton', category_id: 'cotton', specifications: '30/1 combed', quantity_milli: 10000, unit: 'kg', delivery_location: 'Karachi factory', deadline_at: future, requested_delivery_at: future, status: 'open', request_hash: 'rfq-hash', created_by: 'Anas', created_at: now, published_at: now });
  insert('rfq_recipients', { rfq_id: 'rfq', supplier_id: 'mill', supplier_snapshot: '{"name":"Legacy mill"}', delivered_at: now });
  insert('supplier_bids', { id: 'bid', rfq_id: 'rfq', supplier_id: 'mill', quantity_milli: 10000, price_minor: 125000, currency: 'PKR', payment_terms: 'Net 30', delivery_at: future, valid_until: future, note: 'Freight included', status: 'submitted', created_at: now, updated_at: now });
  insert('supplier_purchase_orders', { id: 'po', workspace_id: 'factory', rfq_id: 'rfq', bid_id: 'bid', supplier_id: 'mill', reference: 'PO-001', terms_snapshot: '{"price_minor":125000,"currency":"PKR","payment_terms":"Net 30","quantity_milli":10000}', status: 'accepted', accepted_by: 'Anas', created_at: now });
  sql.exec("UPDATE procurement_rfqs SET status='awarded' WHERE id='rfq'");
  insert('procurement_shipments', { id: 'shipment', workspace_id: 'factory', purchase_order_id: 'po', supplier_id: 'mill', bill_of_lading: 'BOL-001', carrier: 'Carrier', containers_json: '["C-001"]', quantity_milli: 10000, dispatched_at: now, note: 'Original dispatch notice', request_hash: 'shipment-hash', created_at: now });
  insert('goods_receipts', { id: 'receipt', workspace_id: 'factory', purchase_order_id: 'po', product_id: 'cotton', lot_id: 'lot2', movement_id: 'receive2', quantity_milli: 2000, grams: 2000, supplier_lot: 'MILL-002', request_hash: 'receipt-hash', actor_id: 'Anas', created_at: now });
  insert('erp_audit_events', { id: 'audit', workspace_id: 'factory', actor_id: 'Anas', actor_type: 'staff', action: 'purchase.accepted', record_id: 'po', detail_json: '{"price_minor":125000,"reason":"Original accepted terms"}', created_at: now });
}
