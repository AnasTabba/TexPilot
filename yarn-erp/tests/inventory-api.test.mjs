import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';
import { portalFixture } from './portal-fixture.mjs';

const PIN = '2468';
const ORIGIN = 'https://yarnflow.test';
const migrations = new URL('../drizzle/', import.meta.url);

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, migrations), 'utf8'));
  for (const { sql: query, args } of await seedRows(PIN)) sql.prepare(query).run(...args);
  const env = { DB: sqliteBinding(sql) };
  const cookies = new Map();
  const send = async (path, { body, cookie, method = body === undefined ? 'GET' : 'POST', origin = ORIGIN } = {}) => {
    const response = await inventoryApi(new Request(`${ORIGIN}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, data: await response.json(), setCookie: response.headers.get('Set-Cookie') };
  };
  async function login(name, pin = PIN) {
    const result = await send('/auth/login', { body: { name, pin } });
    if (result.status === 200) cookies.set(name, result.setCookie.split(';')[0]);
    return result;
  }
  async function cookieFor(name) {
    if (!cookies.has(name)) assert.equal((await login(name)).status, 200, `${name} signs in`);
    return cookies.get(name);
  }
  // user is a person's name (signed in on first use) or null for no session.
  async function call(path, body, user = 'Anas', method) {
    return send(path, { body, method, cookie: user ? await cookieFor(user) : undefined });
  }
  async function addPerson(name, role) {
    const result = await call('/erp/admin/users', { name, pin: PIN, role });
    assert.equal(result.status, 201);
    return result.data.id;
  }
  async function addOutsider() {
    sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run('other-factory', 'Other factory', Date.now());
    const row = await userRow({ workspaceId: 'other-factory', name: 'Outsider', pin: PIN, role: 'admin' });
    sql.prepare(row.sql).run(...row.args);
  }
  // Batches are created by the supervisor's finished-goods entry or a report decision; these tests only need a legacy-shaped lot to act on.
  function addLot(productId, batch, supplier = '') {
    const id = crypto.randomUUID();
    sql.prepare('INSERT INTO lots(id,workspace_id,product_id,batch,supplier,created_at) VALUES((?),(SELECT workspace_id FROM users WHERE name=\'Anas\'),?,?,?,?)').run(id, productId, batch, supplier, Date.now());
    return { id };
  }
  async function setup() {
    const product = await call('/products', { sku: 'COT-30', name: 'Cotton 30/1', barcode: '8901234567890', interventionReason: 'Catalogue setup for tests' });
    assert.equal(product.status, 201);
    return { product: product.data, lot: addLot(product.data.id, 'DYE-001', 'Test mill') };
  }
  // Raw stock now enters only when a supervisor accepts an inspection report, so this runs that flow for a lot of exactly `grams`.
  let portal;
  async function received(grams = 10000) {
    portal ??= await portalFixture(sql);
    const { lotId, inspectionId } = await portal.submitted({ acceptedMilli: grams, lotQuantityMilli: grams });
    assert.equal((await portal.call('/erp/qc/reports/decide', { inspectionId, decision: 'accept' }, 'Saima')).status, 200);
    return { lot: { id: lotId } };
  }
  // Only produced (finished) stock can be dispatched; this enters a finished-goods batch of exactly `grams`.
  async function finished(grams = 10000) {
    const product = await call('/products', { sku: 'FIN-' + crypto.randomUUID().slice(0, 8), name: 'Finished cotton', interventionReason: 'Catalogue setup for tests' });
    const entry = await call('/erp/stock/finished', { id: crypto.randomUUID(), productId: product.data.id, batch: 'FIN-1', grams, cartons: 0, cones: 0, note: '', interventionReason: 'Supervisor is away today' });
    assert.equal(entry.status, 201, JSON.stringify(entry.data));
    return { lot: { id: entry.data.lotId } };
  }
  return { call, send, login, cookieFor, addPerson, addOutsider, addLot, setup, received, finished, sql, env, cookies };
}
const movement = (lotId, action = 'receive', grams = 10000, extra = {}) => ({
  id: crypto.randomUUID(), lotId, action, grams, cartons: 2, cones: 48,
  stage: action === 'dispatch' ? 'finished' : 'raw', note: 'Goods received', ...extra,
});


test('PIN sign-in: wrong PINs lock the name for 5 minutes; signing out ends the session', async () => {
  const { send, login, call, cookies, sql } = await fixture();
  assert.deepEqual((await send('/auth/people')).data.people.map(p => p.name), ['Anas', 'Fahad', 'Zuhair']);
  assert.equal((await login('Nobody')).status, 401);
  assert.equal((await login('anas', '12a4')).status, 422);
  for (let i = 0; i < 4; i++) assert.equal((await login('Fahad', '1111')).status, 401);
  assert.equal((await login('Fahad', '1111')).status, 429);
  assert.equal((await login('Fahad')).status, 429, 'locked even with the right PIN');
  sql.exec("UPDATE users SET locked_until=0 WHERE name='Fahad'");
  const ok = await login('  fahad ');
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /^yf_session=[a-f\d]{64}; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM sessions').all()).includes(ok.setCookie.slice(11, 75)), 'only the token hash is stored');
  assert.equal((await call('/workspace', undefined, '  fahad ')).status, 200);
  assert.match((await send('/auth/logout', { body: {}, cookie: cookies.get('  fahad ') })).setCookie, /Max-Age=0/);
  assert.equal((await send('/workspace', { cookie: cookies.get('  fahad ') })).status, 401);
});



test('two different devices read one durable stock ledger and barcode lookup', async () => {
  const { call, received } = await fixture();
  const { lot } = await received();
  const other = await call('/workspace', undefined, 'Zuhair');
  assert.equal(other.data.balances[0].grams, 10000);
  assert.equal(other.data.movements[0].actor_name, 'Saima');
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'Zuhair')).data.lotId, lot.id);
});

test('the old transfer, waste, reversal and batch writes are closed; balances stay as they were', async () => {
  const { call, setup, received, sql } = await fixture();
  const { product, lot: empty } = await setup();
  const { lot } = await received();
  const before = sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY lot_id,stage').all(), movements = sql.prepare('SELECT COUNT(*) AS n FROM movements').get().n;
  for (const body of [movement(lot.id, 'transfer', 3333, { toStage: 'wip', cartons: 0, cones: 0 }), movement(lot.id, 'waste', 100), movement(empty.id, 'transfer', 1, { toStage: 'wip' })]) assert.equal((await call('/movements', body)).status, 410);
  assert.equal((await call('/reversals', { id: crypto.randomUUID(), movementId: sql.prepare('SELECT id FROM movements').get().id, note: 'Wrong receipt' })).status, 410);
  assert.equal((await call('/lots', { productId: product.id, batch: 'NEW', supplier: '' })).status, 410);
  assert.deepEqual(sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY lot_id,stage').all(), before);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM movements').get().n, movements);
});

test('a dispatcher cannot move stock through the old movement route; the old QC toggle is closed', async () => {
  const { call, finished, addPerson } = await fixture();
  await finished();
  await addPerson('Store', 'dispatch');
  assert.equal((await call('/quality', { lotId: crypto.randomUUID(), status: 'hold', note: 'Manager inspected' })).status, 410);
  assert.equal((await call('/quality', { lotId: crypto.randomUUID(), status: 'approved', note: 'Looks fine' }, 'Store')).status, 410);
  assert.equal((await call('/movements', movement(crypto.randomUUID(), 'dispatch', 1000, { cartons: 0, cones: 0 }), 'Store')).status, 404, 'dispatch uses /api/erp/dispatch');
  assert.equal((await call('/reversals', { id: crypto.randomUUID(), movementId: (await call('/workspace')).data.movements[0].id, note: 'Oops' }, 'Store')).status, 410);
});

test('the ledger is immutable and a decided stock entry is never reversed', async () => {
  const { call, finished, sql } = await fixture();
  await finished();
  const movementId = sql.prepare('SELECT id FROM movements LIMIT 1').get().id;
  assert.equal((await call('/reversals', { id: crypto.randomUUID(), movementId, note: 'Wrong entry' })).status, 410);
  assert.throws(() => sql.exec('DELETE FROM movements'), /immutable/);
  assert.throws(() => sql.exec('UPDATE stock_deltas SET grams = 1'), /immutable/);
});

test('workspace data never leaks to other members or ambiguous barcode matches', async () => {
  const { call, setup, addOutsider, addLot } = await fixture();
  const { product, lot } = await setup();
  await addOutsider();
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { cartons: 0, cones: 0 }), 'Outsider')).status, 404);
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'Outsider')).status, 404);
  assert.equal((await call('/erp/admin/users', undefined, 'Outsider')).data.users.length, 1);
  addLot(product.id, 'DYE-002');
  const lookup = await call('/lookup?code=8901234567890');
  assert.equal(lookup.data.lots.length, 2);
  assert.equal(lookup.data.lotId, undefined);
});

test('old movement writes are closed; raw stock enters only through a report decision', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  assert.equal((await call('/movements', movement(lot.id, 'receive'))).status, 410, 'raw stock enters only through a report decision');
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { stage: 'raw' }))).status, 404, 'dispatch uses /api/erp/dispatch');
});

test('manual inspections never invent a model prediction or silently release a QC hold', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  assert.equal((await call('/inspections', { id: crypto.randomUUID(), lotId: lot.id, labelText: '60% cotton 40% polyester', note: 'Care label recorded', result: null })).status, 201);
  const state = (await call('/workspace')).data;
  assert.equal(state.lots[0].quality, 'uninspected');
  assert.equal(state.inspections[0].source, 'manual');
  assert.equal((await call('/model')).data.ready, false);
});

test('cross-origin writes and unsupported request methods are rejected', async () => {
  const { send, cookieFor } = await fixture();
  const cookie = await cookieFor('Anas');
  for (const origin of ['https://evil.test', 'null', '']) {
    assert.equal((await send('/products', { body: { sku: 'X', name: 'Not allowed' }, cookie, origin })).status, 403);
    assert.equal((await send('/auth/login', { body: { name: 'Anas', pin: PIN }, origin })).status, 403);
  }
  assert.equal((await send('/workspace', { method: 'DELETE', cookie })).status, 405);
});

test('inspection photos persist independently of the device and remain private to the workspace', async () => {
  const { env, call, setup, cookieFor, addOutsider } = await fixture();
  const storage = new Map();
  env.BUCKET = { async put(key, bytes) { storage.set(key, bytes); }, async get(key) { return storage.has(key) ? { body: storage.get(key) } : null; }, async delete(key) { storage.delete(key); } };
  const { lot } = await setup();
  const inspectionId = crypto.randomUUID();
  await call('/inspections', { id: inspectionId, lotId: lot.id, note: 'Photo evidence', labelText: '', result: null });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrj8AAAAASUVORK5CYII=', 'base64');
  const Cookie = await cookieFor('Anas');
  function request(file = new File([png], 'fabric.png', { type: 'image/png' })) {
    const form = new FormData(); form.set('inspectionId', inspectionId); form.set('photo', file);
    return new Request('https://yarnflow.test/api/photos', { method: 'POST', headers: { Cookie, Origin: 'https://yarnflow.test' }, body: form });
  }
  assert.equal((await inventoryApi(request(), env)).status, 201);
  assert.equal((await inventoryApi(request(), env)).status, 200);
  const download = await inventoryApi(new Request('https://yarnflow.test/api/photos/' + inspectionId, { headers: { Cookie } }), env);
  assert.equal(download.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  await addOutsider();
  assert.equal((await call('/photos/' + inspectionId, undefined, 'Outsider')).status, 404);
  assert.equal((await inventoryApi(request(new File(['<script>alert(1)</script>'], 'fake.png', { type: 'image/png' })), env)).status, 422);
  assert.equal((await call('/workspace')).data.photos.length, 1);
});

test('batch evidence and data export retain older inspections beyond the workspace overview limit', async () => {
  const { call, setup, sql, addLot } = await fixture();
  const { product, lot } = await setup();
  const other = addLot(product.id, 'NEWER');
  const oldestId = crypto.randomUUID();
  await call('/inspections', { id: oldestId, lotId: lot.id, labelText: 'Original label', note: 'Oldest batch evidence', result: null });
  const member = (await call('/workspace')).data.member;
  sql.prepare('INSERT INTO quality_events(id,workspace_id,lot_id,status,note,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), member.workspace_id, lot.id, 'approved', 'Original QC decision', 'owner', 'Owner', Date.now() - 1000);
  const addInspection = sql.prepare('INSERT INTO inspections(id,workspace_id,lot_id,label_text,note,source,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const addQuality = sql.prepare('INSERT INTO quality_events(id,workspace_id,lot_id,status,note,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const addPhoto = sql.prepare('INSERT INTO inspection_photos(id,workspace_id,lot_id,object_key,content_type,content_hash,size,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 1050; i++) {
    const recordId = crypto.randomUUID(); const created = Date.now() + i;
    addInspection.run(recordId, member.workspace_id, other.id, '', 'Newer evidence', 'manual', 'owner', 'Owner', created);
    addQuality.run(crypto.randomUUID(), member.workspace_id, other.id, 'approved', 'Newer QC decision', 'owner', 'Owner', created);
    addPhoto.run(recordId, member.workspace_id, other.id, 'test/' + recordId, 'image/png', 'test-hash', 100, 'Owner', created);
  }
  const evidence = await call('/lots/' + lot.id + '/evidence');
  assert.equal(evidence.status, 200);
  assert.equal(evidence.data.inspections[0].id, oldestId);
  assert.equal(evidence.data.qualityEvents[0].note, 'Original QC decision');
  const page1 = (await call('/export')).data;
  const page2 = (await call('/export?offset=' + page1.nextOffset)).data;
  assert.equal(page1.inspections.length + page2.inspections.length, 1051);
  assert.equal(page1.qualityEvents.length + page2.qualityEvents.length, 1051);
  assert.equal(page1.photos.length + page2.photos.length, 1050);
  assert.equal(page2.nextOffset, null);
});


test('quality inspectors cannot use the retired quality, inspection or photo writes', async () => {
  const f = await fixture();
  await f.addPerson('QC regression', 'quality_inspector');
  // /quality is retired for every role (410); the inspection and photo writes are closed to inspectors (403).
  for (const [path, status] of [['/quality', 410], ['/inspections', 403], ['/photos', 403]]) {
    assert.equal((await f.call(path, { id: crypto.randomUUID() }, 'QC regression')).status, status);
  }
  for (const table of ['quality_events', 'inspections', 'inspection_photos']) assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});
