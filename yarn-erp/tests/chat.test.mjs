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
  const payload = { id: crypto.randomUUID(), threadId: team, body: '  Dye lot ready  ' };
  const sent = await f.call('/erp/chat/send', payload, 'Anas');
  assert.equal(sent.status, 201);
  assert.equal(sent.data.body, 'Dye lot ready'); assert.equal(sent.data.sender_name, 'Anas'); assert.equal(sent.data.photo, false); assert.equal(sent.data.ref, null);
  const replay = await f.call('/erp/chat/send', payload, 'Anas');
  assert.equal(replay.status, 200); assert.equal(replay.data.id, sent.data.id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE id=?').get(payload.id).n, 1);
  assert.equal((await f.call('/erp/chat/send', { ...payload, body: 'Different content' }, 'Anas')).status, 409);
  const seen = await inbox(f, 'Saima');
  assert.equal(seen.threads.find(t => t.id === team).unread, 1); assert.equal(seen.unread, 1);
  assert.equal(seen.threads.find(t => t.id === team).last.body, 'Dye lot ready');
  assert.equal((await inbox(f, 'Anas')).unread, 0, 'my own message is never unread for me');
  const read = await f.call(`${chat}/messages?thread=${team}`, undefined, 'Saima');
  assert.equal(read.status, 200); assert.equal(read.data.messages[0].body, 'Dye lot ready');
  assert.equal((await inbox(f, 'Saima')).unread, 0);
  assert.deepEqual((await f.call(`${chat}/messages?thread=${team}&after=${sent.data.created_at}`, undefined, 'Qasim')).data.messages.map(m => m.id), [sent.data.id], "after is inclusive; the client drops ids it already has");
  assert.equal((await f.call(chat + '/read', { threadId: team }, 'Qasim')).data.read, true);
  assert.equal((await f.call(`${chat}/unread`, undefined, 'Qasim')).data.unread, 0);
  assert.equal((await f.call(chat + '/send', { threadId: team, body: '   ' }, 'Qasim')).status, 422);
});

test('message history pages by stable row cursor across tied timestamps and a fresh session', async () => {
  const f = await fixture(), thread = await teamId(f), userId = (await f.member('Anas')).user_id;
  const createdAt = 1_800_000_000_000;
  const insert = f.sql.prepare('INSERT INTO chat_messages(id,workspace_id,thread_id,user_id,sender_name,body,created_at) VALUES(?,?,?,?,?,?,?)');
  const ids = Array.from({ length: 450 }, () => crypto.randomUUID());
  for (let index = 0; index < ids.length; index++) insert.run(ids[index], f.workspaceId, thread, userId, 'Anas', `Saved ${index}`, createdAt);

  const fresh = await f.login('Saima');
  assert.equal(fresh.status, 200);
  const get = async path => {
    const response = await inventoryApi(new Request(`https://yarnflow.test/api${path}`, { headers: { Cookie: fresh.cookie } }), f.env);
    return { status: response.status, data: await response.json() };
  };
  const newest = await get(`${chat}/messages?thread=${thread}`);
  assert.equal(newest.data.messages.length, 200); assert.equal(newest.data.hasMore, true);
  assert.deepEqual(newest.data.messages.map(m => m.id), ids.slice(250));
  assert.ok(newest.data.messages.every(m => Number.isSafeInteger(m.seq)));
  const middle = await get(`${chat}/messages?thread=${thread}&beforeCursor=${newest.data.messages[0].seq}`);
  assert.equal(middle.data.messages.length, 200); assert.equal(middle.data.hasMore, true);
  const oldest = await get(`${chat}/messages?thread=${thread}&beforeCursor=${middle.data.messages[0].seq}`);
  assert.equal(oldest.data.messages.length, 50); assert.equal(oldest.data.hasMore, false);
  const allIds = [...oldest.data.messages, ...middle.data.messages, ...newest.data.messages].map(m => m.id);
  assert.deepEqual(allIds, ids, 'cursor pages include every persisted message exactly once despite tied timestamps');
  const forward = await get(`${chat}/messages?thread=${thread}&afterCursor=${newest.data.messages.at(-1).seq}`);
  assert.deepEqual(forward.data.messages, []); assert.equal(forward.data.hasMore, false);
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
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId, body: 'Private note' }, 'Anas')).status, 201);
  assert.equal((await f.call(`${chat}/messages?thread=${threadId}`, undefined, 'Saima')).data.messages.length, 1);
  assert.equal((await f.call(`${chat}/messages?thread=${threadId}`, undefined, 'Qasim')).status, 404);
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId, body: 'Intrude' }, 'Qasim')).status, 404);
  assert.equal((await f.call(chat + '/read', { threadId }, 'Qasim')).status, 404);
  assert.ok(!(await inbox(f, 'Qasim')).threads.some(t => t.id === threadId));
});

test('a batch card resolves the product and batch label and 404s for an unknown lot', async () => {
  const f = await fixture(), team = await teamId(f);
  const productId = await f.insertProduct();
  const name = f.sql.prepare('SELECT name FROM products WHERE id=?').get(productId).name;
  const lotId = crypto.randomUUID();
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,'B-77','Mill','approved',?)").run(lotId, f.workspaceId, productId, Date.now());
  const cardBody = { id: crypto.randomUUID(), threadId: team, ref: { type: 'lot', id: lotId } };
  const card = await f.call(chat + '/send', cardBody, 'Saima');
  assert.equal(card.status, 201);
  assert.equal(card.data.ref.type, 'lot'); assert.equal(card.data.ref.id, lotId); assert.equal(card.data.ref.label, `${name} · B-77`);
  assert.deepEqual(card.data.ref.detail, { quality: 'approved', inventoryType: null }); assert.ok(card.data.ref.capturedAt);
  assert.equal(card.data.body, '');
  assert.equal((await f.call(`${chat}/messages?thread=${team}`, undefined, 'Saima')).data.messages.find(m => m.id === card.data.id).ref.id, lotId);
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId: team, ref: { type: 'lot', id: crypto.randomUUID() } }, 'Saima')).status, 404);
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId: team, ref: { type: 'order', id: lotId } }, 'Saima')).status, 422);
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
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId: team }, 'Anas')).status, 422);
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId: team, body: '' }, 'Anas')).status, 422);
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId: crypto.randomUUID(), body: 'hi' }, 'Anas')).status, 404);
});

test('invoice references are authorized, workspace scoped and persist a safe snapshot', async () => {
  const f = await fixture(), team = await teamId(f);
  await f.person('Pervaiz', 'purchase_manager');
  await f.person('Sana', 'sales_manager');
  const qc = await f.submitted({ acceptedMilli: 10000, rejectedMilli: 0 });
  const accepted = await f.acceptedQuote();
  const invoice = (await f.call('/erp/sales/sales', { id: crypto.randomUUID(), revisionId: accepted.revisionId }, 'Sana')).data.invoice;
  const options = await f.call(`${chat}/share-options?type=invoice`, undefined, 'Sana');
  assert.equal(options.status, 200);
  const item = options.data.items.find(x => x.id === invoice.id);
  assert.ok(item); assert.equal(item.type, 'invoice'); assert.match(item.label, /^INV-/); assert.equal(item.detail.currency, invoice.currency);
  assert.equal((await f.call(`${chat}/share-options?type=invoice`, undefined, 'Saima')).status, 403);
  const shipmentOptions = await f.call(`${chat}/share-options?type=shipment`, undefined, 'Pervaiz');
  assert.ok(shipmentOptions.data.items.some(x => x.id === qc.shipmentId));
  assert.equal((await f.call(`${chat}/share-options?type=shipment`, undefined, 'Qasim')).status, 403);
  const saleId = f.sql.prepare('SELECT id FROM sales_orders WHERE revision_id=?').get(accepted.revisionId).id;
  assert.ok((await f.call(`${chat}/share-options?type=sale`, undefined, 'Sana')).data.items.some(x => x.id === saleId));
  assert.ok((await f.call(`${chat}/share-options?type=buyer`, undefined, 'Sana')).data.items.some(x => x.id === accepted.buyerId));
  assert.ok((await f.call(`${chat}/share-options?type=inspection`, undefined, 'Qasim')).data.items.some(x => x.id === qc.inspectionId));
  assert.equal((await f.call(`${chat}/share-options?type=inspection`, undefined, 'Pervaiz')).status, 403);
  assert.equal((await f.call(`${chat}/share-options?type=lot`, undefined, 'Saima')).status, 200);

  const request = { id: crypto.randomUUID(), threadId: team, ref: { type: 'invoice', id: invoice.id } };
  const sent = await f.call(chat + '/send', request, 'Sana');
  assert.equal(sent.status, 201); assert.equal(sent.data.ref.type, 'invoice');
  assert.ok(sent.data.ref.capturedAt); assert.equal(sent.data.ref.detail.currency, invoice.currency);
  assert.equal(sent.data.body, 'Shared invoice');
  const document = sent.data.ref.detail.document;
  assert.equal(document.invoice.number, invoice.number);
  assert.equal(document.invoice.sales_order_id, invoice.sales_order_id);
  assert.equal(document.invoice.lines_json, invoice.lines_json);
  assert.equal(document.invoice.total_minor, invoice.total_minor);
  assert.equal(document.invoice.paid_minor, 0); assert.equal(document.invoice.credited_minor, 0);
  assert.equal(document.invoice.outstanding_minor, invoice.total_minor);
  assert.equal(document.invoice.voided_at, null); assert.equal(document.invoice.void_reason, null);
  assert.ok(document.lines.some(line => line.sales_order_id === invoice.sales_order_id));
  assert.equal(document.buyer.name, f.sql.prepare('SELECT name FROM buyers WHERE id=?').get(accepted.buyerId).name);
  assert.ok(document.buyer.email); assert.ok(document.factoryName);
  const stored = f.sql.prepare('SELECT ref_type,ref_id,ref_json FROM chat_messages WHERE id=?').get(request.id);
  assert.deepEqual([stored.ref_type, stored.ref_id], [null, null], 'new reference kinds do not use legacy lot-only fields');
  const snapshot = JSON.parse(stored.ref_json);
  assert.equal(snapshot.id, invoice.id); assert.equal(snapshot.detail.document.invoice.lines_json, invoice.lines_json);
  f.sql.prepare('UPDATE buyers SET name=? WHERE id=?').run('Buyer Renamed Later', accepted.buyerId);
  const history = await f.call(`${chat}/messages?thread=${team}`, undefined, 'Qasim');
  const savedMessage = history.data.messages.find(m => m.id === request.id);
  assert.equal(savedMessage.ref.detail.document.buyer.name, document.buyer.name, 'history keeps the buyer identity captured at send time');
  assert.equal(savedMessage.ref.detail.document.invoice.number, invoice.number);
  const replay = await f.call(chat + '/send', request, 'Sana');
  assert.equal(replay.status, 200); assert.equal(replay.data.ref.id, invoice.id);

  f.sql.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('other-ws','Other workspace',?)").run(Date.now());
  const otherProduct = crypto.randomUUID(), otherLot = crypto.randomUUID();
  f.sql.prepare('INSERT INTO products(id,workspace_id,sku,name,barcode,created_at) VALUES(?,?,?,?,?,?)').run(otherProduct, 'other-ws', otherProduct, 'Foreign', '', Date.now());
  f.sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,'other-ws',?,'FOREIGN-LOT','Other','approved',?)").run(otherLot, otherProduct, Date.now());
  assert.ok(!(await f.call(`${chat}/share-options?type=lot`, undefined, 'Saima')).data.items.some(x => x.id === otherLot));
  assert.equal((await f.call(chat + '/send', { id: crypto.randomUUID(), threadId: team, ref: { type: 'lot', id: otherLot } }, 'Saima')).status, 404);
});
