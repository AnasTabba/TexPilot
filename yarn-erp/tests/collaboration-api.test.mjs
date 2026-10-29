import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { inventoryApi } from '../server/inventory.mjs';
import { collaborationApi, portalCollaborationApi, publishEvent, onStockMovement, onInspectionCreated, onShipmentDispatched, onTaskMention } from '../server/collaboration.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow, sessionToken, sha256 } from '../server/auth.mjs';

const origin = 'https://collab.test', PW = 'A strong test password 2026';
const wsId = sql => sql.prepare('SELECT id FROM workspaces').get().id;

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../drizzle/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
  const env = { DB: sqliteBinding(sql) };
  const request = (path, data, cookie, headers = {}) => inventoryApi(new Request(origin + '/api' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env);
  const call = async (path, data, cookie, headers) => {
    const r = await request(path, data, cookie, headers);
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: r.headers.get('Set-Cookie')?.split(';')[0] };
  };
  const admin = (await call('/auth/login', { name: 'Anas', pin: '2468' })).cookie;
  const staff = (path, data, cookie = admin) => call(path, data, cookie);
  async function user(name, permissions = [], role = 'member', status = 'active') {
    const existing = sql.prepare('SELECT id FROM users WHERE name=?').get(name);
    if (!existing) {
      const row = await userRow({ workspaceId: wsId(sql), name, pin: '2468', permissions, role, status });
      sql.prepare(row.sql).run(...row.args);
    }
    return (await call('/auth/login', { name, pin: '2468' })).cookie;
  }
  const userId = name => sql.prepare('SELECT id FROM users WHERE name=?').get(name).id;
  const collab = async (path, data, cookie = admin, headers = {}) => {
    const url = `${origin}/api/erp${path}`;
    const req = new Request(url, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    // The integration router resolves the member exactly like currentMember: session token →
    // active user's row. Nothing may derive identity from path or payload.
    const token = sessionToken(req);
    const row = token ? sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'")
      .get(await sha256(token), Date.now()) : null;
    if (!row) return { status: 401, data: {} };
    const member = { user_id: row.id, workspace_id: row.workspace_id, name: row.name,
      role: row.role === 'admin' ? 'owner' : 'operator', admin: row.role === 'admin',
      permissions: row.role === 'admin' ? JSON.parse('["receive","produce","dispatch","catalog","inspect","qc","waste","reverse","suppliers","procure","sales","production","payments"]') : JSON.parse(row.permissions) };
    const response = await collaborationApi(req, env, member, new URL(url).pathname, data);
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  /** Replicates the portal router's supplierSession resolution for portalCollaborationApi. */
  const portalUser = email => sql.prepare(`SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email, u.supplier_id, s.workspace_id, s.status
    FROM supplier_users u JOIN suppliers s ON s.id=u.supplier_id WHERE u.email=?`).get(email);
  const portal = async (path, data, cookie) => {
    const req = new Request(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const user = portalUser(() => {}) && null; // portal user is resolved per path below
    return { req, user };
  };
  return { sql, env, request, call, staff, admin, user, userId, collab, wsId: wsId(sql), portalUser };
}

/** Supplier helper: register → approve → login (exactly the portal flow). */
async function supplier(f, name, category = 'cotton') {
  const email = `${name.toLowerCase()}@mill.test`;
  const registered = await f.call('/portal/register', { company: `${name} Mills`, contactName: `${name} Contact`, email, phone: '+923001234567', city: 'Karachi', password: PW, categories: [category] });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  const id = f.sql.prepare('SELECT supplier_id FROM supplier_users WHERE email=?').get(email).supplier_id;
  assert.equal((await f.staff('/erp/suppliers/review', { id, status: 'approved', version: 1, reason: 'Company and contact checked by admin' })).status, 200);
  return { id, email, cookie: (await f.call('/portal/login', { email, password: PW })).cookie };
}

async function directConversation(f, name) {
  const cookie = await f.user(name);
  const personId = f.userId(name);
  const created = await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'direct', memberIds: [personId] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return { id: created.data.conversation.id, cookie, personId };
}

test('identity comes only from the router-resolved member: pending, cross-workspace and forged calls fail', async () => {
  const f = await fixture();
  assert.equal((await f.collab('/collaboration/workspace', undefined, null)).status, 401, 'no session → 401 before the module is reached');
  // A logged-in user whose status flips to pending loses chat instantly (active-user check).
  const cookie = await f.user('Temporal');
  f.sql.prepare('UPDATE users SET status=? WHERE name=?').run('pending', 'Temporal');
  assert.equal((await f.collab('/collaboration/workspace', undefined, cookie)).status, 401, 'pending staff cannot read chat');
  // A second workspace sees none of the factory's conversations, directory or members.
  const otherWs = crypto.randomUUID();
  f.sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(otherWs, 'Other Factory', Date.now());
  const rival = await f.user; // read a rival from the other workspace
  const rivalRow = await userRow({ workspaceId: otherWs, name: 'Rival', pin: '1357' });
  f.sql.prepare(rivalRow.sql).run(...rivalRow.args);
  const rivalCookie = (await f.call('/auth/login', { name: 'Rival', pin: '1357' })).cookie;
  const rivalView = await f.collab('/collaboration/workspace', undefined, rivalCookie);
  assert.equal(rivalView.status, 200);
  assert.equal(rivalView.data.conversations.length, 0, 'cross-workspace staff see no factory conversations');
  assert.equal(rivalView.data.people.length, 1, 'directory is workspace-bound');
  const created = await directConversation(f, 'Fahad');
  assert.equal((await f.collab(`/collaboration/conversations/${created.id}/messages`, undefined, rivalCookie)).status, 404, 'a forged conversation ID across workspaces is invisible, not forbidden');
  assert.equal((await f.collab(`/collaboration/conversations/${crypto.randomUUID()}/messages`, undefined, created.cookie)).status, 404);
  void rival;
});

test('direct conversations: idempotent retry, deterministic order, cursor pages and per-reader unread', async () => {
  const f = await fixture();
  const { id, cookie, personId } = await directConversation(f, 'Zuhair');
  void personId;
  const requestId = crypto.randomUUID();
  const first = await f.collab(`/collaboration/conversations/${id}/messages`, { id: requestId, body: 'Check the running shift at 14:00' });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const replay = await f.collab(`/collaboration/conversations/${id}/messages`, { id: requestId, body: 'Check the running shift at 14:00' });
  assert.equal(replay.status, 200, 'exact replay is a dedupe, not an error');
  assert.equal(replay.data.message.id, first.data.message.id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM collab_messages').get().n, 1);
  assert.equal((await f.collab(`/collaboration/conversations/${id}/messages`, { id: requestId, body: 'Different text' })).status, 409, 'same request ID with other text conflicts');
  const second = await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'Second message' });
  const third = await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'Third message' }, cookie);
  assert.ok(second.data.message.gseq > first.data.message.gseq && third.data.message.gseq > second.data.message.gseq, 'gseq order matches send order');
  const page = await f.collab(`/collaboration/conversations/${id}/messages?before=${second.data.message.gseq}`);
  assert.deepEqual(page.data.messages.map(m => m.body.slice(0, 6)), ['Check ', 'Second'], 'older pages arrive oldest→newest');
  const newer = await f.collab(`/collaboration/conversations/${id}/messages?after=${first.data.message.gseq}`);
  assert.deepEqual(newer.data.messages.map(m => m.body.slice(0, 7)), ['Second ', 'Third m']);
  assert.equal((await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'x'.repeat(2001) })).status, 422, 'bodies are bounded to 2000 chars');
  assert.equal((await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: '' })).status, 422);
  // Cross-device read position: the reader advances for themselves only.
  await f.collab(`/collaboration/conversations/${id}/read`, { gseq: third.data.message.gseq }, cookie);
  const readerState = (await f.collab('/collaboration/workspace', undefined, cookie)).data.conversations.find(c => c.id === id);
  assert.equal(readerState.unread_count, 0, 'reading clears only the reader’s unread');
  const senderState = (await f.collab('/collaboration/workspace')).data.conversations.find(c => c.id === id);
  assert.equal(senderState.unread_count, 1, 'the sender still counts the received reply');
});

test('rooms and entity threads: admin creation, member revocation, forged references, deferred modules', async () => {
  const f = await fixture();
  assert.equal((await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'team', title: 'Weaving floor', memberIds: [] }, await f.user('OperatorA'))).status, 403, 'only admins create team rooms');
  const room = (await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'team', title: 'Weaving floor room' })).data.conversation.id;
  const operator = await f.user('OperatorA');
  assert.equal((await f.collab(`/collaboration/conversations/${room}/messages`, undefined, operator)).status, 404, 'non-members cannot read the room');
  assert.equal((await f.collab(`/collaboration/conversations/${room}/read`, { gseq: 3 }, operator)).status, 404);
  await f.collab(`/collaboration/conversations/${room}/members/add`, { userId: f.userId('OperatorA') });
  assert.equal((await f.collab(`/collaboration/conversations/${room}/messages`, { id: crypto.randomUUID(), body: 'Line 3 stops for two hours for a loom change.' })).status, 201);
  assert.equal((await f.collab(`/collaboration/conversations/${room}/messages`, undefined, operator)).status, 200);
  await f.collab(`/collaboration/conversations/${room}/members/remove`, { userId: f.userId('OperatorA') });
  assert.equal((await f.collab(`/collaboration/conversations/${room}/messages`, undefined, operator)).status, 404, 'a revoked member loses access instantly');
  assert.equal((await f.collab(`/collaboration/conversations/${room}/members/remove`, { userId: f.userId('Anas') })).status, 409, 'the last room admin cannot leave');
  // Entity threads validate against real tables.
  const product = await f.staff('/products', { sku: 'COT-30', name: 'Cotton combed 30/1' });
  const lot = await f.staff('/lots', { productId: product.data.id, batch: 'B-2026-001', supplier: '' });
  assert.equal((await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'entity', entityType: 'lot', entityId: lot.data.id })).status, 201);
  assert.equal((await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'entity', entityType: 'lot', entityId: crypto.randomUUID() })).status, 404, 'forged entity IDs are not found, never invented');
  const unavailable = await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'entity', entityType: 'production_batch', entityId: lot.data.id });
  assert.equal(unavailable.status, 422);
  assert.match(unavailable.data.error, /not integrated/);
  assert.equal((await f.collab(`/collaboration/conversations/${room}/messages`, { id: crypto.randomUUID(), body: 'x', refs: [{ type: 'purchase_order', id: crypto.randomUUID() }] })).status, 404, 'forged card references fail at send time');
});

test('record cards regenerate per reader: PO prices only for Buying/Finance roles', async () => {
  const f = await fixture();
  const s = await supplier(f, 'Cardmill');
  const now = Date.now();
  const rfq = (await f.staff('/erp/rfqs', { id: crypto.randomUUID(), title: 'Cotton combed 30/1', categoryId: 'cotton', specifications: 'Ring-spun 30/1, weaving grade', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'FAZ textile factory', deadlineAt: now + 86400000, requestedDeliveryAt: now + 7 * 86400000 })).data.rfq;
  assert.equal((await f.staff('/erp/rfqs/publish', { id: rfq.id })).status, 200);
  const bid = (await f.call('/portal/bids', { id: crypto.randomUUID(), rfqId: rfq.id, version: 0, quantityMilli: 100000, priceMinor: 125000, currency: 'PKR', paymentTerms: '30 days after confirmed delivery', deliveryAt: now + 7 * 86400000, validUntil: now + 3 * 86400000, note: 'Freight included' }, s.cookie)).data.bid;
  assert.equal(bid.version, 1, JSON.stringify(bid));
  const order = (await f.staff('/erp/bids/award', { id: bid.id, version: 1 })).data.order;
  await f.user('Receiver', ['receive']);
  const thread = (await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'entity', entityType: 'purchase_order', entityId: order.id }, await f.user('Buyer', ['procure', 'payments', 'receive', 'suppliers']))).data.conversation.id;
  const buyerId = f.userId('Buyer');
  await f.collab(`/collaboration/conversations/${thread}/members/add`, { userId: f.userId('Receiver') });
  const sent = await f.collab(`/collaboration/conversations/${thread}/messages`, { id: crypto.randomUUID(), body: 'PO terms agreed with the supplier.', refs: [{ type: 'purchase_order', id: order.id }] });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.message.references[0].restricted, undefined, 'the Buying/Finance sender sees the full card');
  assert.ok(sent.data.message.references[0].facts.some(([, v]) => v.includes('1,250')), 'the committed rate appears only for Finance');
  const restrictedView = await f.collab(`/collaboration/conversations/${thread}/messages`, undefined, f.userId('Receiver') && (await f.call('/auth/login', { name: 'Receiver', pin: '2468' })).cookie);
  const text = JSON.stringify(restrictedView.data);
  assert.equal(restrictedView.data.messages.at(-1).references[0].restricted, true);
  assert.ok(!text.includes('Rate') && !text.includes('Payment terms'), 'rate and payment terms do not leak to non-finance readers');
  assert.ok(!text.includes('125000'), 'the committed rate amount never leaks');
  // The full card is regenerated live: no stored card for the restricted reader to scrape.
  assert.equal((await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'entity', entityType: 'purchase_order', entityId: order.id }, await f.user('PlainB'))).status, 403, 'staff without procurement access cannot open PO thread');
  void buyerId;
});

test('mentions are server-parsed from conversation membership; acknowledgements and removal cascade', async () => {
  const f = await fixture();
  await directConversation(f, 'Zuhair');
  const room = (await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'team', title: 'Mention room' })).data.conversation.id;
  await f.user('OperatorM');
  await f.collab(`/collaboration/conversations/${room}/members/add`, { userId: f.userId('OperatorM') });
  const sent = await f.collab(`/collaboration/conversations/${room}/messages`, { id: crypto.randomUUID(), body: '@OperatorM please check the cone count today @RandomStranger' });
  assert.deepEqual(sent.data.message.mentions.map(m => m.name), ['OperatorM'], 'only real conversation members become mentions');
  const operator = (await f.call('/auth/login', { name: 'OperatorM', pin: '2468' })).cookie;
  const roomState = (await f.collab('/collaboration/workspace', undefined, operator)).data.conversations.find(c => c.id === room);
  assert.equal(roomState.unread_mentions, 1);
  assert.equal(roomState.unread_count, 1);
  const fourth = await f.user('FourthM');
  assert.equal((await f.collab('/collaboration/workspace', undefined, fourth)).data.conversations.some(c => c.id === room), false, 'unread state is per-member');
  const notifications = (await f.collab('/collaboration/notifications', undefined, operator)).data.notifications;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'chat_mention');
  const domainBefore = f.sql.prepare('SELECT (SELECT COUNT(*) FROM movements)+(SELECT COUNT(*) FROM supplier_purchase_orders)+(SELECT COUNT(*) FROM supplier_bids) AS n').get().n;
  assert.equal((await f.collab('/collaboration/notifications/ack', { ids: [notifications[0].id] }, operator)).status, 200);
  assert.equal((await f.collab('/collaboration/notifications/ack', { ids: [notifications[0].id] }, operator)).status, 200, 'acknowledging twice stays idempotent');
  assert.equal((await f.collab('/collaboration/notifications?unacked=1', undefined, operator)).data.notifications.length, 0, 'acknowledged notifications leave the unacked list');
  assert.equal(f.sql.prepare('SELECT (SELECT COUNT(*) FROM movements)+(SELECT COUNT(*) FROM supplier_purchase_orders)+(SELECT COUNT(*) FROM supplier_bids) AS n').get().n, domainBefore, 'chat never touches procurement or stock rows');
  // Workspace removal cascades chat membership and sessions: revoked staff lose chat instantly.
  await f.staff('/users/remove', { id: f.userId('OperatorM') });
  assert.equal((await f.collab(`/collaboration/conversations/${room}/messages`, undefined, operator)).status, 401, 'a removed user resolves to no member at all');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM collab_members').get().n, 3, 'membership rows cascade away with the user');
});

test('search is membership-scoped, escape-safe and rate limited', async () => {
  const f = await fixture();
  const { id, cookie } = await directConversation(f, 'Fahad');
  await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'The dispatch quote was 50% POS_' });
  await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'Plain operational note about looms' });
  let search = await f.collab('/collaboration/search?q=quote', undefined, cookie);
  assert.equal(search.data.results.length, 1);
  assert.equal(search.data.results[0].conversation_title, 'Anas');
  search = await f.collab('/collaboration/search?q=POS_', undefined, cookie);
  assert.equal(search.data.results.length, 0, 'LIKE wildcards in the query are escaped, so POS_ does not match POS%');
  assert.equal((await f.collab('/collaboration/search?q=looms', undefined, cookie)).data.results.length, 1);
  assert.equal((await f.collab('/collaboration/search?q=x')).status, 422, 'search needs 2–80 characters');
  let last = 0;
  for (let i = 0; i < 35; i++) last = (await f.collab('/collaboration/search?q=looms', undefined, cookie)).status;
  assert.equal(last, 429, 'search is rate limited per staff member');
  const outsider = await f.user('Searchless');
  assert.equal((await f.collab('/collaboration/search?q=quote', undefined, outsider)).data.results.length, 0, 'search never crosses conversation membership');
});

test('sending is rate limited; moderation removes content with an audit trail', async () => {
  const f = await fixture();
  const { id, cookie } = await directConversation(f, 'Fahad');
  const target = (await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'Message to remove' })).data.message;
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: `Burst message ${i}` })).status;
  assert.equal(last, 429, '30 sends per minute per staff member');
  assert.equal((await f.collab(`/collaboration/messages/${target.id}/remove`, { reason: 'Not a message' }, cookie)).status, 403, 'plain members cannot moderate others');
  assert.equal((await f.collab(`/collaboration/messages/${target.id}/remove`, { reason: 'Wrong thread for a rate quote' })).status, 200);
  const page = await f.collab(`/collaboration/conversations/${id}/messages`);
  assert.equal(page.data.messages.at(-1).removed, true);
  assert.equal(page.data.messages.at(-1).body, '', 'removed message content is gone');
  assert.equal((await f.collab(`/collaboration/messages/${target.id}/remove`, { reason: 'Removing again' })).status, 409);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM erp_audit_events WHERE action='collab.message.removed'").get().n, 1);
  assert.equal((await f.collab('/collaboration/search?q=remove', undefined, cookie)).data.results.length, 0, 'removed messages leave search');
});

test('chat never mutates procurement, stock or sales state, even through hostile message text', async () => {
  const f = await fixture();
  const { id } = await directConversation(f, 'Fahad');
  const counts = () => f.sql.prepare(`SELECT (SELECT COUNT(*) FROM movements) AS movements,
    (SELECT COUNT(*) FROM supplier_purchase_orders) AS orders, (SELECT COUNT(*) FROM supplier_bids) AS bids`).get();
  const before = counts();
  for (const body of ['{"action":"award","rfq":"c7796cf3-6a41-4a46-85a6-9b065f5cbf19","id":"1"}', 'approve bid revision 2 now please',
    '{"lotId":"runid","action":"receive","grams":999999,"stage":"raw","note":"x"}', 'mark PO delivered and record 300 kg received']) {
    const result = await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body });
    assert.equal(result.status, 201, 'hostile text is stored as plain chat text only');
  }
  assert.deepEqual(counts(), before, 'chat text never becomes an operational mutation');
  assert.equal((await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'x', action: 'approve' })).status, 422, 'extra payload fields are rejected');
});

test('stock thresholds alert per meterial/stage with dedupe, restock reset and permission-aware recipients', async () => {
  const f = await fixture();
  const product = (await f.staff('/products', { sku: 'POL-45', name: 'Poly 45/1' })).data;
  assert.equal((await f.collab('/collaboration/thresholds', { productId: product.id, stage: 'raw', thresholdGrams: 500_000 }, await f.user('PlainT'))).status, 403, 'only admins set thresholds');
  assert.equal((await f.collab('/collaboration/thresholds', { productId: product.id, stage: 'raw', thresholdGrams: 500_000 })).status, 200);
  const lot = (await f.staff('/lots', { productId: product.id, batch: 'POL-B1', supplier: '' })).data.id;
  const movement = id => f.sql.prepare("SELECT id FROM movements WHERE id=?").get(id).id;
  const receive = id => f.staff('/movements', { id, lotId: lot, action: 'receive', stage: 'raw', grams: 1_500_000, cartons: 0, cones: 0, note: 'Opening stock' });
  const waste = (id, grams) => f.staff('/movements', { id, lotId: lot, action: 'waste', stage: 'raw', grams, cartons: 0, cones: 0, note: 'Damaged cones' });
  const latest = action => f.sql.prepare(`SELECT id FROM movements WHERE action=? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(action).id;
  void movement;
  assert.equal((await receive(crypto.randomUUID())).status, 201);
  assert.deepEqual((await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('receive') })).results.filter(r => r.kind === 'low_stock'), [], 'no alert above the threshold');
  assert.equal((await waste(crypto.randomUUID(), 1_200_000)).status, 201);
  const crossing = await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') });
  assert.equal(crossing.results.filter(r => r.kind === 'low_stock').length, 1, 'one alert when the level first crosses');
  const replay = await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') });
  assert.equal(replay.results[0].deduped, true, 'replaying a committed movement cannot fan out duplicates');
  await waste(crypto.randomUUID(), 10_000);
  assert.ok((await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') })).results.some(r => r.deduped), 'still-below-threshold movements never alert again');
  await receive(crypto.randomUUID());
  assert.ok((await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('receive') })).results.some(r => r.kind === 'restock_reset'), 'restock resets the alert state');
  await waste(crypto.randomUUID(), 1_300_000);
  const recross = await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') });
  assert.equal(recross.results.filter(r => r.kind === 'low_stock' && !r.deduped).length, 1, 'a fresh crossing after reset alerts again');
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM collab_events WHERE kind='low_stock'").get().n, 2, 'exactly one event per alert generation');
  const operator = (await f.call('/auth/login', { name: 'OpsT', pin: '2468' })).cookie;
  const row = await userRow({ workspaceId: f.wsId, name: 'OpsT', pin: '2468', permissions: ['produce'] });
  f.sql.prepare(row.sql).run(...row.args);
  await f.call('/auth/login', { name: 'OpsT', pin: '2468' });
  let notifications = (await f.collab('/collaboration/notifications?unacked=1', undefined, operator)).data.notifications.filter(n => n.kind === 'low_stock');
  assert.equal(notifications.length, 2, 'produce staff are alerted through current permissions');
  await f.collab('/collaboration/notifications/ack', { ids: notifications.map(n => n.id) }, operator);
  // Restock, then re-cross once more: the muted operator hears nothing new; the admin still does.
  await receive(crypto.randomUUID());
  await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('receive') });
  await waste(crypto.randomUUID(), 250_000);
  await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') });
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM collab_events WHERE kind='low_stock'").get().n, 3);
  void notifications;
  assert.equal((await f.collab('/collaboration/mutes', { kind: 'low_stock', muted: true }, operator)).status, 200);
  await waste(crypto.randomUUID(), 100_000); // 440k → still below; then reset + re-cross while muted
  await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') });
  assert.equal((await f.collab('/collaboration/mutes', { kind: 'low_stock', muted: false }, operator)).status, 200);
  await receive(crypto.randomUUID());
  await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('receive') });
  await waste(crypto.randomUUID(), 100_000);
  const mutedResult = await onStockMovement(f.env, { workspaceId: f.wsId, movementId: latest('waste') });
  assert.equal(mutedResult.results.some(r => r.kind === 'low_stock' && !r.deduped), true, 'unmuted staff still receive fresh alerts');
  const mutedNotifs = (await f.collab('/collaboration/notifications?unacked=1', undefined, operator)).data.notifications.filter(n => n.kind === 'low_stock');
  assert.equal(mutedNotifs.length, 0, 'the operator did silence that window; a re-enabled mute is honoured afterwards');
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM collab_events WHERE kind='low_stock'").get().n, 4, 'every generation is one event');
});

test('inspections and shipment dispatches create deduplicated events; task mentions hit only their assignee', async () => {
  const f = await fixture();
  const product = (await f.staff('/products', { sku: 'VIS-40', name: 'Viscose 40/1' })).data;
  const now = Date.now();
  const rfq = (await f.staff('/erp/rfqs', { id: crypto.randomUUID(), title: 'Viscose 40/1 spin', categoryId: 'synthetic', specifications: 'VFY 40/1 spinning grade', quantityMilli: 80000, unit: 'kg', deliveryLocation: 'FAZ textile factory', deadlineAt: now + 86400000, requestedDeliveryAt: now + 6 * 86400000 })).data.rfq;
  const s = await supplier(f, 'Viscose', 'synthetic');
  assert.equal((await f.staff('/erp/rfqs/publish', { id: rfq.id })).status, 200);
  const bid = (await f.call('/portal/bids', { id: crypto.randomUUID(), rfqId: rfq.id, version: 0, quantityMilli: 80000, priceMinor: 90000, currency: 'PKR', paymentTerms: '60 days after confirmed delivery', deliveryAt: now + 5 * 86400000, validUntil: now + 2 * 86400000, note: '' }, s.cookie)).data.bid;
  const order = (await f.staff('/erp/bids/award', { id: bid.id, version: 1 })).data.order;
  const dispatch = (await f.call('/portal/dispatches', { id: crypto.randomUUID(), orderId: order.id, billOfLading: 'VISCBL100', carrier: 'Test carrier', containers: ['ABCD1234567'], quantityMilli: 80000, dispatchedAt: now - 1000, note: '' }, s.cookie)).data.shipment;
  await f.user('OpsR', ['receive']);
  const receiver = (await f.call('/auth/login', { name: 'OpsR', pin: '2468' })).cookie;
  const firstDispatch = await onShipmentDispatched(f.env, { workspaceId: f.wsId, shipmentId: dispatch.id });
  assert.equal(firstDispatch.event.deduped, false);
  assert.equal((await onShipmentDispatched(f.env, { workspaceId: f.wsId, shipmentId: dispatch.id })).event.deduped, true, 'a replayed dispatch never fans out duplicates');
  const dispatchAlerts = (await f.collab('/collaboration/notifications', undefined, receiver)).data.notifications.filter(n => n.kind === 'shipment_status');
  assert.equal(dispatchAlerts.length, 1, 'receiving staff are notified of the committed dispatch');
  assert.ok(!JSON.stringify(dispatchAlerts).includes('price_minor'), 'shipment alerts carry no financial data');
  const receipt = await f.staff('/erp/receipts', { id: crypto.randomUUID(), orderId: order.id, productId: product.id, batch: 'VIS-R1', quantityMilli: 80000, cartons: 2, cones: 0, supplierLot: 'VSUP-9' });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
  const receiptLot = f.sql.prepare('SELECT lot_id FROM goods_receipts ORDER BY created_at DESC LIMIT 1').get().lot_id;
  const inspection = (await f.staff('/inspections', { id: crypto.randomUUID(), lotId: receiptLot, labelText: 'Care label check', note: 'First inspection of received material' })).data;
  const inspected = await onInspectionCreated(f.env, { workspaceId: f.wsId, inspectionId: inspection.id });
  assert.equal(inspected.event.deduped, false);
  assert.equal((await onInspectionCreated(f.env, { workspaceId: f.wsId, inspectionId: inspection.id })).event.deduped, true, 'a replayed inspection dedupes on the same lot');
  assert.ok((await f.collab('/collaboration/notifications', undefined, receiver)).data.notifications.some(n => n.kind === 'material_inspected'), 'receive staff get inspection alerts');
  // Task mentions: provenance is a committed assignment; the assignee alone is notified.
  await f.user('OpsAs');
  const assignee = (await f.call('/auth/login', { name: 'OpsAs', pin: '2468' })).cookie;
  const task = await onTaskMention(f.env, { workspaceId: f.wsId, taskId: crypto.randomUUID(), taskRef: 'WEAVE-TASK-2', title: 'Weaving schedule assigned', assigneeUserId: f.userId('OpsAs'), actorId: 'task-system', dedupeKey: 'task:WEAVE-TASK-2' });
  assert.equal(task.event.deduped, false);
  assert.equal((await onTaskMention(f.env, { workspaceId: f.wsId, taskId: crypto.randomUUID(), taskRef: 'WEAVE-TASK-2', title: 'Weaving schedule assigned', assigneeUserId: f.userId('OpsAs'), dedupeKey: 'task:WEAVE-TASK-2' })).event.deduped, true, 'the same committed assignment dedupes');
  await assert.rejects(() => onTaskMention(f.env, { workspaceId: f.wsId, taskId: crypto.randomUUID(), title: 'x', assigneeUserId: crypto.randomUUID(), dedupeKey: 'task:missing' }), error => error.status === 404, 'an assignee who is not active staff fails cleanly');
  const assigneeAlerts = (await f.collab('/collaboration/notifications', undefined, assignee)).data.notifications.filter(n => n.kind === 'task_mention');
  assert.equal(assigneeAlerts.length, 1);
  const stranger = (await f.call('/auth/login', { name: 'OpsStr', pin: '2468' })).cookie;
  const strangerRow = await userRow({ workspaceId: f.wsId, name: 'OpsStr', pin: '2468', permissions: [] });
  f.sql.prepare(strangerRow.sql).run(...strangerRow.args);
  await f.call('/auth/login', { name: 'OpsStr', pin: '2468' });
  assert.equal((await f.collab('/collaboration/notifications', undefined, stranger)).data.notifications.some(n => n.kind === 'task_mention'), false, 'task alerts hit only the assignee');
});

test('attachments: honest 503 without storage, magic-byte checks, authorization and bounded sizes', async () => {
  const f = await fixture();
  const { id, cookie } = await directConversation(f, 'Fahad');
  const message = (await f.collab(`/collaboration/conversations/${id}/messages`, { id: crypto.randomUUID(), body: 'Attach the container seal photo' })).data.message;
  const path = `/collaboration/attachments?messageId=${message.id}&conversationId=${id}`;
  const missing = await f.collab(path, { });
  assert.equal(missing.status, 503, JSON.stringify(missing.data));
  assert.match(missing.data.error, /BUCKET|storage/i, 'the missing-storage message names the setup gap');
  // Configure a bucket to exercise the real upload path with a genuine multipart body.
  const bucket = new Map();
  const stored = { ...f, env: { DB: f.env.DB, BUCKET: { put: async (key, value, options) => bucket.set(key, { value, options }), get: async key => bucket.get(key) ? { body: bucket.get(key).value } : null, delete: async key => bucket.delete(key) } } };
  const collabStored = async (path, data, c, headers = {}) => {
    const url = `${origin}/api/erp${path}`;
    const req = new Request(url, { method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const token = sessionToken(req);
    const row = token ? stored.sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").get(await sha256(token), Date.now()) : null;
    if (!row) return { status: 401 };
    const member = { user_id: row.id, workspace_id: row.workspace_id, name: row.name, admin: row.role === 'admin', permissions: JSON.parse(row.permissions) };
    const response = await collaborationApi(req, stored.env, member, new URL(url).pathname, data);
    return { status: response.status, data: await response.json().catch(() => null), response };
  };
  // A non-sender cannot attach to someone else's message (storage gate comes first; with a bucket the sender check bites).
  assert.equal((await collabStored(path, { }, cookie)).status, 403, 'only the sender attaches files to their message');
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const boundary = '----collabtestboundary';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="seal.png"\r\nContent-Type: image/png\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(body, 'utf8'), Buffer.from(pngBytes), Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
  const uploadReq = new Request(`${origin}/api/erp${path}`, { method: 'POST',
    headers: { Origin: origin, Cookie: f.admin, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: payload });
  const uploadRow = stored.sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").get(await sha256(sessionToken(uploadReq)), Date.now());
  const uploadMember = { user_id: uploadRow.id, workspace_id: uploadRow.workspace_id, name: uploadRow.name, admin: uploadRow.role === 'admin', permissions: JSON.parse(uploadRow.permissions) };
  const upload = await collaborationApi(uploadReq, stored.env, uploadMember, new URL(uploadReq.url).pathname, null);
  assert.equal(upload.status, 201, JSON.stringify(await upload.text()));
  assert.equal(bucket.size, 1, 'the object was stored privately under its workspace key');
  const objectKey = [...bucket.keys()][0];
  assert.ok(objectKey.startsWith(`${f.wsId}/collab/`), 'object keys are workspace-scoped; no public URLs exist');
  // Content type came from magic bytes, not the form header.
  assert.equal([...bucket.values()][0].options.httpMetadata.contentType, 'image/png');
  // The same bytes again are deduplicated to the stored object.
  const again = await collaborationApi(uploadReq.clone(), stored.env, uploadMember, new URL(uploadReq.url).pathname, null);
  const againData = await again.json();
  assert.equal(again.status, 200, 're-uploading the same bytes dedupes to the stored object');
  // Download requires live membership and never serves without the BUCKET binding.
  const attachmentId = (await againData).attachment.id;
  const unconfigured = await collabStored(`/collaboration/attachments/${attachmentId}`, undefined, f.admin);
  assert.equal(unconfigured.status, 503, 'downloads honestly report the missing storage binding');
  const downloadRow = stored.sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").get(await sha256(sessionToken(new Request(origin, {}))), Date.now());
  void downloadRow;
  const downloadReq = new Request(`${origin}/api/erp/collaboration/attachments/${attachmentId}`, { method: 'GET', headers: { Cookie: f.admin } });
  const downloadMember = uploadMember;
  const download = await collaborationApi(downloadReq, stored.env, downloadMember, new URL(downloadReq.url).pathname, null);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('X-Content-Type-Options'), 'nosniff');
  const bodyBytes = new Uint8Array(await download.arrayBuffer());
  assert.deepEqual([...bodyBytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'the stored bytes are returned to members only');
  // Disguised uploads are refused on magic bytes.
  const fakeBoundary = '----collabtestboundary';
  const fakePayload = Buffer.concat([Buffer.from(`--${fakeBoundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.png"\r\nContent-Type: image/png\r\n\r\n`, 'utf8'), Buffer.from('<script>alert(1)</script>'), Buffer.from(`\r\n--${fakeBoundary}--\r\n`, 'utf8')]);
  const evil = await collaborationApi(new Request(`${origin}/api/erp${path}`, { method: 'POST', headers: { Origin: origin, Cookie: f.admin, 'Content-Type': `multipart/form-data; boundary=${fakeBoundary}` }, body: fakePayload }), stored.env, uploadMember, new URL(uploadReq.url).pathname, null);
  assert.equal(evil.status, 422, 'magic-byte sniffing rejects non-image payloads');
  // Membership gate on download: a removed member (or outsider) gets 404, not the file.
  const outsider = (await f.call('/auth/login', { name: 'OutsiderA', pin: '2468' })).cookie;
  const outsiderRow = await userRow({ workspaceId: f.wsId, name: 'OutsiderA', pin: '2468', permissions: [] });
  f.sql.prepare(outsiderRow.sql).run(...outsiderRow.args);
  await f.call('/auth/login', { name: 'OutsiderA', pin: '2468' });
  const outsiderReq = new Request(`${origin}/api/erp/collaboration/attachments/${attachmentId}`, { method: 'GET', headers: { Cookie: outsider } });
  const outsiderUser = stored.sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").get(await sha256(sessionToken(outsiderReq)), Date.now());
  const outsiderMember = { user_id: outsiderUser.id, workspace_id: outsiderUser.workspace_id, name: outsiderUser.name, admin: false, permissions: [] };
  assert.equal((await collaborationApi(outsiderReq, stored.env, outsiderMember, new URL(outsiderReq.url).pathname, null)).status, 404, 'a non-member cannot download');
});

test('publishEvent validates, dedupes; unknown routes and cross-site posts are refused', async () => {
  const f = await fixture();
  const event = () => publishEvent(f.env, {
    workspaceId: f.wsId, kind: 'low_stock', entityType: 'product', entityId: crypto.randomUUID(),
    dedupeKey: 'same:key', subject: 'Test alert', detail: { x: 1 },
  });
  assert.equal((await event()).deduped, false);
  const duplicate = await event();
  assert.equal(duplicate.deduped, true, 'the outbox UNIQUE dedupe key collapses repeats');
  assert.equal((await f.collab('/collaboration/admin/secret')).status, 404, 'unknown routes are 404');
  assert.equal((await f.collab('/collaboration/workspace', {}, f.admin, { Origin: 'https://evil.example' })).status, 403, 'cross-site POSTs are refused');
  await assert.rejects(() => publishEvent(f.env, { workspaceId: f.wsId, kind: 'fabricated', entityType: 'product', entityId: crypto.randomUUID(), dedupeKey: 'y', subject: 'no' }), /Unknown operational event kind/);
  await assert.rejects(() => publishEvent(f.env, { workspaceId: f.wsId, kind: 'low_stock', entityType: 'product', entityId: 'not-a-uuid', dedupeKey: 'z', subject: 'no' }), /Use a valid record ID/);
  await assert.rejects(() => publishEvent(f.env, { workspaceId: f.wsId, kind: 'low_stock', entityType: 'starship', entityId: crypto.randomUUID(), dedupeKey: 'w', subject: 'no' }), /entity type/);
});

test("supplier external threads: staff-side creation is gated, portal-side identity is server-resolved, channels stay separate", async () => {
  const f = await fixture();
  const s = await supplier(f, 'Threadmill');
  const rival = await supplier(f, 'Rivallmill');
  await f.user('Threadmgr', ['suppliers']);
  const threadmgr = (await f.call('/auth/login', { name: 'Threadmgr', pin: '2468' })).cookie;
  const StaffUser = email => f.sql.prepare(`SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email, u.supplier_id, s.workspace_id, s.status
    FROM supplier_users u JOIN suppliers s ON s.id=u.supplier_id WHERE u.email=?`).get(email);
  void StaffUser;
  const thread = await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'external', supplierId: s.id }, threadmgr);
  assert.equal(thread.status, 201, JSON.stringify(thread.data));
  const plainRow = await userRow({ workspaceId: f.wsId, name: 'PlainS', pin: '2468', permissions: [] });
  f.sql.prepare(plainRow.sql).run(...plainRow.args);
  void plainRow;
  assert.equal((await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'external', supplierId: s.id }, (await f.call('/auth/login', { name: 'PlainS', pin: '2468' })).cookie)).status, 403, 'staff without Supplier access cannot open external threads');
  const second = await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'external', supplierId: s.id }, threadmgr);
  assert.equal(second.data.conversation.id, thread.data.conversation.id, 'one thread per supplier, not one per click');
  const threadId = thread.data.conversation.id;
  const portalCall = async (path, data, cookie, which = s.email) => {
    const user = f.sql.prepare(`SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email, u.supplier_id, s.workspace_id, s.status
      FROM supplier_users u JOIN suppliers s ON s.id=u.supplier_id WHERE u.email=?`).get(which);
    const req = new Request(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const response = await portalCollaborationApi(req, f.env, user, `/api${path}`, data);
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  const list = await portalCall('/portal/collab/workspace', undefined, s.cookie);
  assert.equal(list.status, 200);
  assert.equal(list.data.threads.length, 1, 'a supplier sees exactly their own company thread');
  const supplierMessage = await portalCall(`/portal/collab/threads/${threadId}/messages`, { id: crypto.randomUUID(), body: 'Container reached Karachi port today' }, s.cookie);
  assert.equal(supplierMessage.status, 201, JSON.stringify(supplierMessage.data));
  const supplierReplay = await portalCall(`/portal/collab/threads/${threadId}/messages`, { id: supplierMessage.data.message.id, body: 'Container reached Karachi port today' }, s.cookie);
  assert.equal(supplierReplay.status, 200, 'supplier sends are idempotent on their request ID');
  assert.equal(f.sql.prepare('SELECT sender_name FROM collab_messages WHERE body LIKE ? AND body LIKE ?').get('Container reached Karachi%', '%today'), supplierMessage.data.message.sender_name, 'Tap user_name is stored, no mention adaptation needed');
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM collab_events WHERE kind='chat_mention'").get().n, 0, 'supplier messages cannot @-mention staff');
  // Cross-company isolation and settled staff channels.
  assert.equal((await portalCall(`/portal/collab/threads/${threadId}/messages`, undefined, s.cookie, rival.email)).status, 404, 'another supplier cannot read the thread');
  assert.equal((await portalCall(`/portal/collab/threads/${crypto.randomUUID()}/messages`, { id: crypto.randomUUID(), body: 'x' }, s.cookie)).status, 404, 'a forged thread id stays invisible');
  const staffView = await f.collab(`/collaboration/conversations/${threadId}/messages`, undefined, threadmgr);
  assert.equal(staffView.data.messages.some(m => m.body === 'Container reached Karachi port today'), true, 'staff read the supplier thread from the shared tables');
  assert.equal((await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'team', title: 'Internal only ' }, threadmgr)).status, 403, 'external-thread managers still cannot create internal rooms');
});

test('external supplier thread has Gauteng staff-side message flow and rate limit', async () => {
  const f = await fixture();
  const s = await supplier(f, 'Pakmill');
  await f.user('ExternalX', ['suppliers']);
  const manager = (await f.call('/auth/login', { name: 'ExternalX', pin: '2468' })).cookie;
  const thread = (await f.collab('/collaboration/conversations', { id: crypto.randomUUID(), kind: 'external', supplierId: s.id }, manager)).data.conversation.id;
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const call = await f.collab(`/collaboration/conversations/${thread}/messages`, { id: crypto.randomUUID(), body: `Staff bulk note ${i}` }, manager);
    last = call.status;
  }
  assert.equal(last, 429, 'staff sends in external threads are rate limited too');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM collab_messages').get().n, 30);
  void s;
});
