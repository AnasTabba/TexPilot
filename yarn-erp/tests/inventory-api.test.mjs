import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync(new URL('../drizzle/0000_inventory.sql', import.meta.url), 'utf8'));
  const env = { DB: sqliteBinding(sql) };
  async function call(path, body, user = 'owner', method = body === undefined ? 'GET' : 'POST') {
    const request = new Request(`https://yarnflow.test/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://yarnflow.test',
        ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@test.invalid` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await inventoryApi(request, env);
    return { status: response.status, data: await response.json() };
  }
  async function setup() {
    assert.equal((await call('/workspaces', { name: 'Factory testing' })).status, 201);
    const product = await call('/products', { sku: 'COT-30', name: 'Cotton 30/1', barcode: '8901234567890' });
    const lot = await call('/lots', { productId: product.data.id, batch: 'DYE-001', supplier: 'Test mill' });
    assert.equal(lot.status, 201);
    return { product: product.data, lot: lot.data };
  }
  return { call, setup, sql, env };
}
const movement = (lotId, action = 'receive', grams = 10000, extra = {}) => ({
  id: crypto.randomUUID(), lotId, action, grams, cartons: 2, cones: 48,
  stage: 'raw', note: 'Goods received', ...extra,
});

test('requires identity, membership and a same-origin mutation', async () => {
  const { call } = fixture();
  assert.equal((await call('/workspace', undefined, null)).status, 401);
  assert.equal((await call('/products', { sku: 'X', name: 'X' }, 'outsider')).status, 403);
});

test('two different devices read one durable stock ledger and barcode lookup', async () => {
  const { call, setup } = fixture();
  const { lot } = await setup();
  const invite = await call('/invites', {});
  assert.equal((await call('/join', { code: invite.data.code }, 'friend')).status, 200);
  assert.equal((await call('/movements', movement(lot.id))).status, 201);
  const other = await call('/workspace', undefined, 'friend');
  assert.equal(other.data.balances[0].grams, 10000);
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'friend')).data.lotId, lot.id);
});

test('duplicate delivery is idempotent; reusing its key for different stock is rejected', async () => {
  const { call, setup } = fixture();
  const { lot } = await setup();
  const payload = movement(lot.id);
  assert.equal((await call('/movements', payload)).status, 201);
  assert.equal((await call('/movements', payload)).status, 200);
  assert.equal((await call('/movements', { ...payload, grams: 20000 })).status, 409);
  assert.equal((await call('/workspace')).data.balances[0].grams, 10000);
});

test('a stage transfer conserves exact grams, cartons and cones across the batch', async () => {
  const { call, setup } = fixture();
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
  const { call, setup } = fixture();
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

test('QC blocks dispatch until owner approval; operators cannot approve their own receipt', async () => {
  const { call, setup } = fixture();
  const { lot } = await setup();
  await call('/movements', movement(lot.id));
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { cartons: 0, cones: 0 }))).status, 409);
  const { code } = (await call('/invites', {})).data;
  await call('/join', { code }, 'friend');
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: 'Looks fine' }, 'friend')).status, 403);
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: 'Manager inspected' })).status, 200);
  assert.equal((await call('/movements', movement(lot.id, 'dispatch', 1000, { cartons: 0, cones: 0 }), 'friend')).status, 201);
});

test('reversal is immutable, only once and cannot remove already-consumed receipts', async () => {
  const { call, setup, sql } = fixture();
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
  const { call, setup } = fixture();
  const { product, lot } = await setup();
  await call('/workspaces', { name: 'Other factory' }, 'outsider');
  assert.equal((await call('/movements', movement(lot.id), 'outsider')).status, 404);
  assert.equal((await call('/lookup?code=' + encodeURIComponent(`YF:${lot.id}`), undefined, 'outsider')).status, 404);
  await call('/lots', { productId: product.id, batch: 'DYE-002', supplier: '' });
  const lookup = await call('/lookup?code=8901234567890');
  assert.equal(lookup.data.lots.length, 2);
  assert.equal(lookup.data.lotId, undefined);
});

test('invalid quantities, unknown fields, forged provenance and missing QC reasons fail', async () => {
  const { call, setup } = fixture();
  const { lot } = await setup();
  for (const grams of [-1, 0, 0.3, 1e17, '100']) {
    assert.equal((await call('/movements', movement(lot.id, 'receive', grams))).status, 422);
  }
  assert.equal((await call('/movements', { ...movement(lot.id), by: 'Administrator' })).status, 422);
  assert.equal((await call('/quality', { lotId: lot.id, status: 'approved', note: '' })).status, 422);
});

test('invalid or expired invites cannot grant access and operators cannot invite', async () => {
  const { call, setup, sql } = fixture();
  await setup();
  assert.equal((await call('/join', { code: 'not-an-invite' }, 'friend')).status, 404);
  const invite = (await call('/invites', {})).data;
  await call('/join', { code: invite.code }, 'friend');
  assert.equal((await call('/invites', {}, 'friend')).status, 403);
  sql.exec('UPDATE invites SET expires_at = 0');
  assert.equal((await call('/join', { code: invite.code }, 'someone')).status, 404);
});

test('manual inspections never invent a model prediction or silently release a QC hold', async () => {
  const { call, setup } = fixture();
  const { lot } = await setup();
  assert.equal((await call('/inspections', { id: crypto.randomUUID(), lotId: lot.id, labelText: '60% cotton 40% polyester', note: 'Care label recorded', result: null })).status, 201);
  const state = (await call('/workspace')).data;
  assert.equal(state.lots[0].quality, 'uninspected');
  assert.equal(state.inspections[0].source, 'manual');
  assert.equal((await call('/model')).data.ready, false);
});

test('cross-origin writes and unsupported request methods are rejected', async () => {
  const { env } = fixture();
  for (const origin of ['https://evil.test', 'null', '']) {
    const result = await inventoryApi(new Request('https://yarnflow.test/api/workspaces', { method: 'POST', headers: { 'oai-authenticated-user-id': 'owner', Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Not allowed' }) }), env);
    assert.equal(result.status, 403);
  }
  const result = await inventoryApi(new Request('https://yarnflow.test/api/workspace', { method: 'DELETE', headers: { 'oai-authenticated-user-id': 'owner' } }), env);
  assert.equal(result.status, 405);
});

test('inspection photos persist independently of the device and remain private to the workspace', async () => {
  const { env, call, setup } = fixture();
  const storage = new Map();
  env.BUCKET = { async put(key, bytes) { storage.set(key, bytes); }, async get(key) { return storage.has(key) ? { body: storage.get(key) } : null; }, async delete(key) { storage.delete(key); } };
  const { lot } = await setup();
  const inspectionId = crypto.randomUUID();
  await call('/inspections', { id: inspectionId, lotId: lot.id, note: 'Photo evidence', labelText: '', result: null });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrj8AAAAASUVORK5CYII=', 'base64');
  function request(file = new File([png], 'fabric.png', { type: 'image/png' })) {
    const form = new FormData(); form.set('inspectionId', inspectionId); form.set('photo', file);
    return new Request('https://yarnflow.test/api/photos', { method: 'POST', headers: { 'oai-authenticated-user-id': 'owner', Origin: 'https://yarnflow.test' }, body: form });
  }
  assert.equal((await inventoryApi(request(), env)).status, 201);
  assert.equal((await inventoryApi(request(), env)).status, 200);
  const download = await inventoryApi(new Request('https://yarnflow.test/api/photos/' + inspectionId, { headers: { 'oai-authenticated-user-id': 'owner' } }), env);
  assert.equal(download.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  await call('/workspaces', { name: 'Other' }, 'outsider');
  assert.equal((await inventoryApi(new Request('https://yarnflow.test/api/photos/' + inspectionId, { headers: { 'oai-authenticated-user-id': 'outsider' } }), env)).status, 404);
  assert.equal((await inventoryApi(request(new File(['<script>alert(1)</script>'], 'fake.png', { type: 'image/png' })), env)).status, 422);
  assert.equal((await call('/workspace')).data.photos.length, 1);
});

test('batch evidence and data export retain older inspections beyond the workspace overview limit', async () => {
  const { call, setup, sql } = fixture();
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
