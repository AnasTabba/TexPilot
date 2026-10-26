import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';

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
  async function addPerson(name, permissions = [], role = 'member') {
    const result = await call('/users', { name, pin: PIN, role, permissions });
    assert.equal(result.status, 201);
    return result.data.id;
  }
  async function addOutsider() {
    sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run('other-factory', 'Other factory', Date.now());
    const row = await userRow({ workspaceId: 'other-factory', name: 'Outsider', pin: PIN, role: 'admin' });
    sql.prepare(row.sql).run(...row.args);
  }
  async function setup() {
    const product = await call('/products', { sku: 'COT-30', name: 'Cotton 30/1', barcode: '8901234567890' });
    const lot = await call('/lots', { productId: product.data.id, batch: 'DYE-001', supplier: 'Test mill' });
    assert.equal(lot.status, 201);
    return { product: product.data, lot: lot.data };
  }
  return { call, send, login, cookieFor, addPerson, addOutsider, setup, sql, env, cookies };
}
const movement = (lotId, action = 'receive', grams = 10000, extra = {}) => ({
  id: crypto.randomUUID(), lotId, action, grams, cartons: 2, cones: 48,
  stage: 'raw', note: 'Goods received', ...extra,
});

test('requires a signed-in person and the right permission for each kind of entry', async () => {
  const { call, addPerson, setup } = await fixture();
  assert.equal((await call('/workspace', undefined, null)).status, 401);
  const { lot } = await setup();
  await addPerson('Bilal', ['receive']);
  assert.equal((await call('/products', { sku: 'X', name: 'X' }, 'Bilal')).status, 403);
  assert.equal((await call('/movements', movement(lot.id), 'Bilal')).status, 201);
  assert.equal((await call('/movements', movement(lot.id, 'transfer', 1000, { toStage: 'wip', cartons: 0, cones: 0 }), 'Bilal')).status, 403);
  assert.equal((await call('/movements', movement(lot.id, 'waste', 1000, { cartons: 0, cones: 0 }), 'Bilal')).status, 403);
  assert.equal((await call('/inspections', { id: crypto.randomUUID(), lotId: lot.id, labelText: '', note: 'x', result: null }, 'Bilal')).status, 403);
  assert.equal((await call('/export', undefined, 'Bilal')).status, 403);
  const me = (await call('/workspace', undefined, 'Bilal')).data.member;
  assert.deepEqual([me.admin, me.permissions], [false, ['receive']]);
  assert.equal((await call('/model', undefined, 'Bilal')).status, 200, 'scanning needs no permission');
});

test('PIN sign-in: wrong PINs lock the name for 5 minutes; signing out ends the session', async () => {
  const { send, login, call, cookies, sql } = await fixture();
  assert.deepEqual((await send('/auth/people')).data.people, ['Anas', 'Fahad', 'Zuhair']);
  assert.equal((await login('Nobody')).status, 401);
  assert.equal((await login('anas', '12a4')).status, 422);
  for (let i = 0; i < 4; i++) assert.equal((await login('Fahad', '1111')).status, 401);
  assert.equal((await login('Fahad', '1111')).status, 429);
  assert.equal((await login('Fahad')).status, 429, 'locked even with the right PIN');
  sql.exec("UPDATE users SET locked_until=0 WHERE name='Fahad'");
  const ok = await login('  fahad ');
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /^yf_session=[a-f\d]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM sessions').all()).includes(ok.setCookie.slice(11, 75)), 'only the token hash is stored');
  assert.equal((await call('/workspace', undefined, '  fahad ')).status, 200);
  assert.match((await send('/auth/logout', { body: {}, cookie: cookies.get('  fahad ') })).setCookie, /Max-Age=0/);
  assert.equal((await send('/workspace', { cookie: cookies.get('  fahad ') })).status, 401);
});

test('a requested account waits for an admin, who approves it with permissions', async () => {
  const { send, login, call, setup } = await fixture();
  const { lot } = await setup();
  assert.equal((await send('/auth/signup', { body: { name: 'Sara Khan', pin: '9753' } })).status, 201);
  assert.equal((await send('/auth/signup', { body: { name: 'sara  khan', pin: '1111' } })).status, 409);
  assert.equal((await send('/auth/signup', { body: { name: 'Sara', pin: '97531' } })).status, 422);
  assert.equal((await call('/workspace')).data.pending, 1);
  assert.equal((await login('Sara Khan', '9753')).status, 403);
  assert.deepEqual((await send('/auth/people')).data.people, ['Anas', 'Fahad', 'Zuhair'], 'pending people are not listed');
  const sara = (await call('/users')).data.users.find(user => user.name === 'Sara Khan');
  assert.deepEqual([sara.status, sara.role, sara.permissions], ['pending', 'member', []]);
  assert.equal((await call('/users/update', { id: sara.id, status: 'active', permissions: ['dispatch', 'qc'] })).status, 200);
  assert.equal((await login('Sara Khan', '9753')).status, 200);
  assert.equal((await call('/users', undefined, 'Sara Khan')).status, 403, 'members cannot manage people');
  await call('/movements', movement(lot.id));
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: 'Checked' }, 'Sara Khan')).status, 200);
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { cartons: 0, cones: 0 }), 'Sara Khan')).status, 201);
  assert.equal((await call('/users/update', { id: sara.id, permissions: ['everything'] })).status, 422);
});

test('admins add, promote, reset and remove people, but never the last admin or themselves', async () => {
  const { call, send, addPerson, cookieFor } = await fixture();
  const people = async () => Object.fromEntries((await call('/users')).data.users.map(user => [user.name, user]));
  const bilal = await addPerson('Bilal', ['produce']);
  assert.equal((await call('/users', { name: 'bilal', pin: '1234', role: 'member', permissions: [] })).status, 409);
  const bilalCookie = await cookieFor('Bilal');
  assert.equal((await call('/users/update', { id: bilal, pin: '8642' })).status, 200);
  assert.equal((await send('/workspace', { cookie: bilalCookie })).status, 401, 'a PIN reset signs the person out');
  assert.equal((await call('/users/update', { id: bilal, role: 'admin' })).status, 200);
  const all = await people();
  assert.equal((await call('/users/remove', { id: all.Anas.id })).status, 409, "can't remove yourself");
  assert.equal((await call('/users/remove', { id: all.Fahad.id })).status, 200);
  await call('/users/update', { id: all.Zuhair.id, role: 'member' });
  await call('/users/update', { id: bilal, role: 'member' });
  assert.equal((await call('/users/update', { id: all.Anas.id, role: 'member' })).status, 409, 'keep at least one admin');
  assert.deepEqual(Object.keys(await people()).sort(), ['Anas', 'Bilal', 'Zuhair']);
});

test('two different devices read one durable stock ledger and barcode lookup', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  assert.equal((await call('/movements', movement(lot.id))).status, 201);
  const other = await call('/workspace', undefined, 'Zuhair');
  assert.equal(other.data.balances[0].grams, 10000);
  assert.equal(other.data.movements[0].actor_name, 'Anas');
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'Zuhair')).data.lotId, lot.id);
});

test('duplicate delivery is idempotent; reusing its key for different stock is rejected', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  const payload = movement(lot.id);
  assert.equal((await call('/movements', payload)).status, 201);
  assert.equal((await call('/movements', payload)).status, 200);
  assert.equal((await call('/movements', { ...payload, grams: 20000 })).status, 409);
  assert.equal((await call('/workspace')).data.balances[0].grams, 10000);
});

test('a stage transfer conserves exact grams, cartons and cones across the batch', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  await call('/movements', movement(lot.id));
  assert.equal((await call('/movements', movement(lot.id, 'transfer', 3333, { toStage: 'wip', cartons: 1, cones: 24 }))).status, 201);
  const balances = (await call('/workspace')).data.balances;
  assert.deepEqual(balances.map(({ stage, grams, cartons, cones }) => ({ stage, grams, cartons, cones })).sort((a,b) => a.stage.localeCompare(b.stage)), [
    { stage: 'raw', grams: 6667, cartons: 1, cones: 24 },
    { stage: 'wip', grams: 3333, cartons: 1, cones: 24 },
  ]);
});

test('stock cannot go negative, including concurrent dispatches; failed transfer rolls back', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  await call('/movements', movement(lot.id));
  await call('/quality', { lotId: lot.id, status: 'approved', note: 'Physically inspected' });
  const responses = await Promise.all([
    call('/movements', movement(lot.id, 'dispatch', 7000, { cartons: 0, cones: 0 })),
    call('/movements', movement(lot.id, 'dispatch', 7000, { cartons: 0, cones: 0 })),
  ]);
  assert.deepEqual(responses.map(x => x.status).sort(), [201, 409]);
  const failed = await call('/movements', movement(lot.id, 'transfer', 4000, { toStage: 'finished', cartons: 0, cones: 0 }));
  assert.equal(failed.status, 409);
  const state = (await call('/workspace')).data;
  assert.equal(state.balances.find(b => b.stage === 'raw').grams, 3000);
  assert.equal(state.balances.some(b => b.stage === 'finished' && b.grams > 0), false);
  assert.equal(state.movements.length, 2);
});

test('QC blocks dispatch until approval; only people with QC permission can approve', async () => {
  const { call, setup, addPerson } = await fixture();
  const { lot } = await setup();
  await addPerson('Store', ['receive', 'dispatch']);
  await call('/movements', movement(lot.id), 'Store');
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { cartons: 0, cones: 0 }))).status, 409);
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: 'Looks fine' }, 'Store')).status, 403);
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: 'Manager inspected' })).status, 200);
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { cartons: 0, cones: 0 }), 'Store')).status, 201);
  assert.equal((await call('/reversals', { id: crypto.randomUUID(), movementId: (await call('/workspace')).data.movements[0].id, note: 'Oops' }, 'Store')).status, 403);
});

test('reversal is immutable, only once and cannot remove already-consumed receipts', async () => {
  const { call, setup, sql } = await fixture();
  const { lot } = await setup();
  const receipt = movement(lot.id);
  await call('/movements', receipt);
  const reversal = { id: crypto.randomUUID(), movementId: receipt.id, note: 'Wrong goods receipt' };
  assert.equal((await call('/reversals', reversal)).status, 201);
  assert.equal((await call('/reversals', { ...reversal, id: crypto.randomUUID() })).status, 409);
  assert.equal((await call('/workspace')).data.balances[0].grams, 0);
  assert.throws(() => sql.exec('DELETE FROM movements'), /immutable/);
  assert.throws(() => sql.exec('UPDATE stock_deltas SET grams = 1'), /immutable/);
});

test('workspace data never leaks to other members or ambiguous barcode matches', async () => {
  const { call, setup, addOutsider } = await fixture();
  const { product, lot } = await setup();
  await addOutsider();
  assert.equal((await call('/movements', movement(lot.id), 'Outsider')).status, 404);
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'Outsider')).status, 404);
  assert.equal((await call('/users', undefined, 'Outsider')).data.users.length, 1);
  await call('/lots', { productId: product.id, batch: 'DYE-002', supplier: '' });
  const lookup = await call('/lookup?code=8901234567890');
  assert.equal(lookup.data.lots.length, 2);
  assert.equal(lookup.data.lotId, undefined);
});

test('invalid quantities, unknown fields, forged provenance and missing QC reasons fail', async () => {
  const { call, setup } = await fixture();
  const { lot } = await setup();
  for (const grams of [-1, 0, 0.3, 1e17, '100']) {
    assert.equal((await call('/movements', movement(lot.id, 'receive', grams))).status, 422);
  }
  assert.equal((await call('/movements', { ...movement(lot.id), by: 'Administrator' })).status, 422);
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: '' })).status, 422);
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
  const { call, setup, sql } = await fixture();
  const { product, lot } = await setup();
  const other = (await call('/lots', { productId: product.id, batch: 'NEWER', supplier: '' })).data;
  const oldestId = crypto.randomUUID();
  await call('/inspections', { id: oldestId, lotId: lot.id, labelText: 'Original label', note: 'Oldest batch evidence', result: null });
  await call('/quality', { lotId: lot.id, status: 'approved', note: 'Original QC decision' });
  const member = (await call('/workspace')).data.member;
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
