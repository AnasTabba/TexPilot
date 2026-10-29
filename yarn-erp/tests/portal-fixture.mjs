import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';

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
  return { sql, env, workspaceId, adminId, person, insertSupplier, login, call, member: async name => (await call('/workspace', undefined, name)).data.member };
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
