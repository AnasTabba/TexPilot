import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture, jpeg } from './portal-fixture.mjs';
import { inventoryApi } from '../server/inventory.mjs';
const chat = '/erp/chat';
const inbox = async (f, as) => (await f.call(chat, undefined, as)).data;
const teamId = async (f) => (await inbox(f)).threads.find(t => t.kind === 'team').id;
async function fixture() {
  const f = await portalFixture();
  await f.person('Saima', 'supervisor'); await f.person('Qasim', 'quality_inspector');
  return f;
}
// A multipart chat photo upload, the way the browser sends it.
async function upload(f, as, fields, bytes = jpeg) {
  const cookie = (await f.login(as)).cookie;
  const form = new FormData(); for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('photo', new File([bytes], 'p.jpg', { type: 'image/jpeg' }));
  const response = await inventoryApi(new Request('https://yarnflow.test/api/erp/chat/photos', { method: 'POST', headers: { Origin: 'https://yarnflow.test', Cookie: cookie }, body: form }), f.env);
  return { status: response.status, data: await response.json() };
}

test('the team thread is listed for everyone; a message reaches others as unread until they read it', async () => {
  const f = await fixture(), team = await teamId(f);
  for (const name of ['Anas', 'Saima', 'Qasim']) {
    const first = (await inbox(f, name)).threads[0];
    assert.equal(first.id, team); assert.equal(first.kind, 'team'); assert.equal(first.title, 'Factory');
  }
  // Another workspace's team thread never shows up here.
  f.sql.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('other','Other',1)").run();
  f.sql.prepare("INSERT INTO chat_threads(id,workspace_id,kind,key,created_at) VALUES('other-team','other','team','team',1)").run();
  assert.ok(!(await inbox(f, 'Saima')).threads.some(t => t.id === 'other-team'));
  const sent = await f.call('/erp/chat/send', { threadId: team, body: '  Dye lot ready  ' }, 'Anas');
  assert.equal(sent.status, 201);
  assert.equal(sent.data.body, 'Dye lot ready'); assert.equal(sent.data.sender_name, 'Anas'); assert.equal(sent.data.photo, false); assert.equal(sent.data.ref, null);
  const seen = await inbox(f, 'Saima');
  assert.equal(seen.threads.find(t => t.id === team).unread, 1); assert.equal(seen.unread, 1);
  assert.equal(seen.threads.find(t => t.id === team).last.body, 'Dye lot ready');
  assert.equal((await inbox(f, 'Anas')).unread, 0, 'my own message is never unread for me');
  const read = await f.call(`${chat}/messages?thread=${team}`, undefined, 'Saima');
  assert.equal(read.status, 200); assert.equal(read.data.messages[0].body, 'Dye lot ready');
  assert.equal((await inbox(f, 'Saima')).unread, 0);
  assert.deepEqual((await f.call(`${chat}/messages?thread=${team}&after=${sent.data.created_at}`, undefined, 'Qasim')).data.messages.map(m => m.id), [sent.data.id], "after is inclusive; the client drops ids it already has");
  assert.equal((await f.call(chat + '/read', { threadId: team }, 'Qasim')).data.read, true);
  assert.equal((await f.call(chat + '/send', { threadId: team, body: '   ' }, 'Qasim')).status, 422);
});

test('a direct chat is get-or-create, and a third person gets 404 on its messages', async () => {
  const f = await fixture(), saima = (await f.member('Saima')).user_id;
  const threadId = (await f.call('/erp/chat/direct', { userId: saima }, 'Anas')).data.id;
  assert.ok(threadId);
  assert.equal((await f.call('/erp/chat/direct', { userId: saima }, 'Anas')).data.id, threadId, 'same thread on a second call');
  assert.equal((await f.call('/erp/chat/direct', { userId: (await f.member('Anas')).user_id }, 'Anas')).status, 422, 'no chat with yourself');
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE kind='direct'").get().n, 1);
  assert.equal((await f.call('/erp/chat/direct', { userId: '00000000-0000-4000-8000-000000000000' }, 'Anas')).status, 404);
  const row = (await inbox(f, 'Saima')).threads.find(t => t.id === threadId);
  assert.equal(row.kind, 'direct'); assert.equal(row.title, 'Anas'); assert.equal(row.other.name, 'Anas');
  assert.equal((await f.call(chat + '/send', { threadId, body: 'Private note' }, 'Anas')).status, 201);
  assert.equal((await f.call(`${chat}/messages?thread=${threadId}`, undefined, 'Saima')).data.messages.length, 1);
  assert.equal((await f.call(`${chat}/messages?thread=${threadId}`, undefined, 'Qasim')).status, 404);
  assert.equal((await f.call(chat + '/send', { threadId, body: 'Intrude' }, 'Qasim')).status, 404);
  assert.equal((await f.call(chat + '/read', { threadId }, 'Qasim')).status, 404);
  assert.ok(!(await inbox(f, 'Qasim')).threads.some(t => t.id === threadId));
});

test('a batch card resolves the product and batch label and 404s for an unknown lot', async () => {
  const f = await fixture(), team = await teamId(f);
  const productId = await f.insertProduct();
  const name = f.sql.prepare('SELECT name FROM products WHERE id=?').get(productId).name;
  const lotId = crypto.randomUUID();
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,'B-77','Mill','approved',?)").run(lotId, f.workspaceId, productId, Date.now());
  const card = await f.call(chat + '/send', { threadId: team, ref: { type: 'lot', id: lotId } }, 'Saima');
  assert.equal(card.status, 201);
  assert.deepEqual(card.data.ref, { type: 'lot', id: lotId, label: `${name} · B-77` });
  assert.equal(card.data.body, '');
  assert.equal((await f.call(chat + '/send', { threadId: team, ref: { type: 'lot', id: crypto.randomUUID() } }, 'Saima')).status, 404);
  assert.equal((await f.call(chat + '/send', { threadId: team, ref: { type: 'order', id: lotId } }, 'Saima')).status, 422);
});

test('a photo uploads into the chat and its bytes come back to people who can see the thread', async () => {
  const f = await fixture(), team = await teamId(f);
  const sent = await upload(f, 'Saima', { threadId: team, caption: 'Torn carton' });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.photo, true); assert.equal(sent.data.body, 'Torn carton');
  const cookie = (await f.login('Qasim')).cookie;
  const response = await inventoryApi(new Request(`https://yarnflow.test/api/erp/chat/photo/${sent.data.id}`, { headers: { Cookie: cookie } }), f.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Cache-Control'), 'private,no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
  // A photo in a direct chat stays out of reach for a third person.
  const direct = (await f.call('/erp/chat/direct', { userId: (await f.member('Saima')).user_id }, 'Anas')).data.id;
  const private_ = await upload(f, 'Anas', { threadId: direct });
  assert.equal(private_.status, 201);
  const third = await inventoryApi(new Request(`https://yarnflow.test/api/erp/chat/photo/${private_.data.id}`, { headers: { Cookie: (await f.login('Qasim')).cookie } }), f.env);
  assert.equal(third.status, 404);
  assert.equal((await upload(f, 'Anas', { threadId: team }, new Uint8Array([1, 2, 3]))).status, 422);
});

test('an empty message is refused and a message needs a thread the person can see', async () => {
  const f = await fixture(), team = await teamId(f);
  assert.equal((await f.call(chat + '/send', { threadId: team }, 'Anas')).status, 422);
  assert.equal((await f.call(chat + '/send', { threadId: team, body: '' }, 'Anas')).status, 422);
  assert.equal((await f.call(chat + '/send', { threadId: crypto.randomUUID(), body: 'hi' }, 'Anas')).status, 404);
});
