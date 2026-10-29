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
  return { call, send, login, cookieFor, addPerson, addOutsider, addLot, setup, sql, env, cookies };
}
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
  assert.match(ok.setCookie, /^yf_session=[a-f\d]{64}; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM sessions').all()).includes(ok.setCookie.slice(11, 75)), 'only the token hash is stored');
  assert.equal((await call('/workspace', undefined, '  fahad ')).status, 200);
  assert.match((await send('/auth/logout', { body: {}, cookie: cookies.get('  fahad ') })).setCookie, /Max-Age=0/);
  assert.equal((await send('/workspace', { cookie: cookies.get('  fahad ') })).status, 401);
});



test('two different devices read one durable stock ledger and barcode lookup', async () => {
  const { call, setup, addPerson } = await fixture();
  const { product } = await setup(); await addPerson('Saima', 'supervisor');
  const made = await call('/erp/stock/finished', { id: crypto.randomUUID(), productId: product.id, batch: 'FIN-1', grams: 10000, cartons: 2, cones: 48 }, 'Saima');
  assert.equal(made.status, 201);
  const lot = { id: made.data.lotId };
  const other = await call('/workspace', undefined, 'Zuhair');
  assert.equal(other.data.balances.find(b => b.lot_id === lot.id && b.stage === 'finished').grams, 10000);
  assert.equal(other.data.movements[0].actor_name, 'Saima');
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'Zuhair')).data.lotId, lot.id);
});
test('workspace data never leaks to other members or ambiguous barcode matches', async () => {
  const { call, setup, addOutsider, addLot } = await fixture();
  const { product, lot } = await setup();
  await addOutsider();
  assert.equal((await call('/erp/stock/finished', { id: crypto.randomUUID(), productId: product.id, batch: 'X', grams: 1000, cartons: 0, cones: 0, interventionReason: 'Checking isolation' }, 'Outsider')).status, 404);
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'Outsider')).status, 404);
  assert.equal((await call('/erp/admin/users', undefined, 'Outsider')).data.users.length, 1);
  addLot(product.id, 'DYE-002');
  const lookup = await call('/lookup?code=8901234567890');
  assert.equal(lookup.data.lots.length, 2);
  assert.equal(lookup.data.lotId, undefined);
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

