import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';

const KEY = 'dll_test_key_1234567890';
const CONTRACT = JSON.stringify({ baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track',
  request: { number: 'number', type: 'type', types: { bol: 'bill_of_lading' } },
  response: { containers: 'containers', containerNumber: 'number', reference: 'referenceNumber', events: 'events', event: { time: 'eventTime', title: 'statusDescription', code: 'statusCode', location: 'location' } } });
const realFetch = globalThis.fetch, realLog = { log: console.log, error: console.error, warn: console.warn };
let calls = 0;
afterEach(() => { globalThis.fetch = realFetch; Object.assign(console, realLog); });
const stub = fn => { calls = 0; globalThis.fetch = async (...a) => { calls++; return fn(...a); }; };
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const GOOD = { containers: [{ number: 'MSCU1234567' }], events: [{ eventTime: '2026-10-28T10:00:00Z', statusCode: 'LOADED', statusDescription: 'Loaded on vessel', location: 'Karachi' }], referenceNumber: 'BL123' };

async function fixture({ key = KEY, contract = CONTRACT } = {}) {
  const f = await portalFixture();
  await f.person('Pervaiz', 'purchase_manager'); await f.person('Saima', 'supervisor');
  if (key) f.env.DATALOOPLABS_API_KEY = key;
  if (contract) f.env.DATALOOPLABS_CONTRACT = contract;
  const supplierId = await f.insertSupplier({ status: 'approved' }), day = 86400000, rfqId = crypto.randomUUID();
  const made = await f.call('/erp/rfqs', { id: rfqId, title: 'Cotton combed 30/1', categoryId: 'cotton', specifications: 'Ring-spun 30/1', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'FAZ', deadlineAt: Date.now() + day, requestedDeliveryAt: Date.now() + 7 * day }, 'Pervaiz');
  assert.equal(made.status, 201, made.text); assert.equal((await f.call('/erp/rfqs/publish', { id: rfqId }, 'Pervaiz')).status, 200);
  const bidId = f.insertBid({ rfqId, supplierId, priceMinor: 125000 }), won = await f.call('/erp/bids/award', { id: bidId, version: 1 }, 'Pervaiz');
  assert.equal(won.status, 201, won.text); const poId = won.data.order.id;
  f.poId = poId;
  return f;
}
const attach = async (f, bl = 'MSCUBL1234', as = 'Pervaiz') => { const id = crypto.randomUUID(), r = await f.call('/erp/shipments', { id, orderId: f.poId, billOfLading: bl }, as); return { ...r, id }; };
const track = (f, id, as = 'Pervaiz') => f.call('/erp/shipments/track', { id }, as);
const row = (f, id) => f.sql.prepare('SELECT * FROM shipments WHERE id=?').get(id);
const tracked = async f => { const { id } = await attach(f); stub(() => ok(GOOD)); return id; };

test('without a key tracking is not configured and makes no provider call', async () => {
  const f = await fixture({ key: null }), { id } = await attach(f); stub(() => ok(GOOD));
  const r = await track(f, id);
  assert.equal(r.status, 200); assert.equal(r.data.error, 'Tracking is not configured: API key missing.');
  assert.equal(calls, 0); assert.equal(row(f, id).status, 'not_checked');
});
test('without a usable contract tracking is not configured and makes no provider call', async () => {
  for (const contract of [null, '{not json', JSON.stringify({ baseUrl: 'http://x.test', trackPath: '/t', request: {}, response: {} })]) {
    const f = await fixture({ contract }), { id } = await attach(f); stub(() => ok(GOOD));
    const r = await track(f, id);
    assert.equal(r.status, 200); assert.equal(r.data.error, 'Tracking is not configured: provider contract unavailable.');
    assert.equal(calls, 0); assert.equal(row(f, id).status, 'not_checked');
  }
});
test('a successful lookup caches the status and the time it was checked', async () => {
  const f = await fixture(), { id } = await attach(f); const before = Date.now();
  let sent; stub((url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return ok(GOOD); });
  const r = await track(f, id);
  assert.equal(r.status, 200); assert.equal(r.data.error, undefined);
  assert.equal(sent.url, 'https://provider.test/v1/tracking/track'); assert.deepEqual(sent.body, { number: 'MSCUBL1234', type: 'bill_of_lading' }); assert.equal(sent.auth, `Bearer ${KEY}`);
  const s = row(f, id), cache = JSON.parse(s.last_status_json);
  assert.equal(s.status, 'tracked'); assert.ok(s.last_checked_at >= before); assert.equal(s.last_error, null);
  assert.equal(cache.events[0].title, 'Loaded on vessel'); assert.equal(cache.events[0].location, 'Karachi'); assert.deepEqual(cache.containers, ['MSCU1234567']); assert.equal(cache.reference, 'BL123');
  assert.equal(r.data.shipment.status, 'tracked');
});
test('when the provider fails the last cached status stays and an error is shown, never a 500', async () => {
  const f = await fixture(), id = await tracked(f); assert.equal((await track(f, id)).status, 200);
  const cached = row(f, id).last_status_json;
  for (const [fn, expected] of [[() => new Response('down', { status: 503 }), /Provider error/], [() => { throw new Error('socket hang up'); }, /socket hang up/], [() => new Response('not json', { status: 200 }), /could not be read/]]) {
    stub(fn);
    const r = await track(f, id);
    assert.equal(r.status, 200, r.text); assert.match(r.data.error, expected);
    assert.equal(row(f, id).last_status_json, cached); assert.equal(row(f, id).status, 'tracked');
    assert.equal(r.data.shipment.last_status_json, cached);
  }
});
test('a failure with no cached status marks the shipment as error', async () => {
  const f = await fixture(), { id } = await attach(f); stub(() => new Response('down', { status: 503 }));
  const r = await track(f, id);
  assert.equal(r.status, 200); assert.match(r.data.error, /Provider error/);
  assert.equal(row(f, id).status, 'error'); assert.equal(row(f, id).last_status_json, null); assert.match(row(f, id).last_error, /Provider error/);
});
test('the API key never reaches a response or a stored row', async () => {
  const f = await fixture(), { id } = await attach(f), logs = [];
  for (const k of Object.keys(realLog)) console[k] = (...a) => logs.push(a.join(' '));
  stub(() => { throw new Error(`bad Bearer ${KEY}`); });
  const r = await track(f, id);
  assert.equal(r.status, 200); assert.ok(r.data.error);
  const dump = () => JSON.stringify(f.sql.prepare('SELECT * FROM shipments').all()) + JSON.stringify(f.sql.prepare('SELECT * FROM erp_audit_events').all());
  for (const text of [r.text, (await f.call('/erp/shipments', undefined, 'Pervaiz')).text, (await f.call('/erp/procurement', undefined, 'Pervaiz')).text, dump(), logs.join('\n')]) assert.ok(!text.includes(KEY), 'key leaked');
});
test('successful provider echoes cannot leak the key', async () => {
  const f = await fixture(), { id } = await attach(f), logs = [], echo = `${KEY} Bearer ${KEY} ${KEY.toUpperCase()}`;
  for (const k of Object.keys(realLog)) console[k] = (...a) => logs.push(a.join(' '));
  stub(() => ok({ containers: [{ number: 'MSCU1234567' }, { number: echo }], referenceNumber: `ref ${echo}`, events: [{ eventTime: '2026-10-28T10:00:00Z', statusCode: `c ${echo}`, statusDescription: `Loaded ${echo}`, location: `Karachi ${echo}` }] }));
  const r = await track(f, id);
  assert.equal(r.status, 200); assert.equal(r.data.error, undefined);
  const cache = JSON.parse(row(f, id).last_status_json);
  assert.match(cache.events[0].title, /^Loaded /); assert.match(cache.events[0].location, /^Karachi /); assert.ok(cache.containers.includes('MSCU1234567'));
  const dump = JSON.stringify(f.sql.prepare('SELECT * FROM shipments').all());
  for (const text of [r.text, dump, (await f.call('/erp/procurement', undefined, 'Pervaiz')).text, (await f.call('/erp/shipments', undefined, 'Pervaiz')).text, logs.join('\n')]) {
    assert.ok(!text.toLowerCase().includes(KEY), 'key leaked'); assert.ok(!/Bearer dll/i.test(text), 'bearer leaked');
  }
});
test('the B/L number attaches to the PO; only purchase managers attach and track', async () => {
  const f = await fixture(), r = await attach(f, ' mscu bl 1234 ');
  assert.equal(r.status, 201, r.text); assert.equal(r.data.shipment.bill_of_lading, 'MSCUBL1234'); assert.equal(r.data.shipment.status, 'not_checked');
  assert.equal(row(f, r.id).bill_of_lading, 'MSCUBL1234');
  assert.equal(f.sql.prepare('SELECT bill_of_lading FROM supplier_purchase_orders WHERE id=?').get(f.poId).bill_of_lading, 'MSCUBL1234');
  const [a] = f.sql.prepare("SELECT * FROM erp_audit_events WHERE action='po.bl_attached'").all(); assert.equal(a.record_id, f.poId); assert.equal(a.actor_role, 'purchase_manager');
  const denied = await attach(f, 'OTHERBL99', 'Saima'); assert.equal(denied.status, 403);
  assert.equal((await track(f, r.id, 'Saima')).status, 403);
  assert.equal((await f.call('/erp/shipments', undefined, 'Saima')).status, 403);
  const listed = await f.call('/erp/shipments?orderId=' + f.poId, undefined, 'Pervaiz');
  assert.equal(listed.data.shipments.length, 1); assert.equal(listed.data.tracking.configured, true); assert.equal(listed.data.tracking.provider, 'DataLoopLabs');
  assert.deepEqual((await f.call('/erp/procurement', undefined, 'Pervaiz')).data.tracking.configured, true);
});
test('attaching is idempotent and refuses a duplicate B/L or a closed PO', async () => {
  const f = await fixture(), r = await attach(f);
  const again = await f.call('/erp/shipments', { id: r.id, orderId: f.poId, billOfLading: 'mscubl1234' }, 'Pervaiz'); assert.equal(again.status, 200);
  assert.equal((await f.call('/erp/shipments', { id: r.id, orderId: f.poId, billOfLading: 'OTHERBL1' }, 'Pervaiz')).status, 409);
  assert.equal((await attach(f)).status, 409);
  f.sql.prepare("UPDATE supplier_purchase_orders SET status='cancelled' WHERE id=?").run(f.poId);
  assert.equal((await attach(f, 'LATE12345')).status, 409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM shipments').get().n, 1);
  assert.equal((await f.call('/erp/shipments', { id: crypto.randomUUID(), orderId: crypto.randomUUID(), billOfLading: 'MSCU9999' }, 'Pervaiz')).status, 404);
});
test('a PO that changes between the check and the write aborts the whole attach', async () => {
  const f = await fixture();
  f.sql.exec("CREATE TRIGGER race AFTER INSERT ON shipments BEGIN UPDATE supplier_purchase_orders SET status='cancelled' WHERE id=NEW.purchase_order_id; END");
  const r = await attach(f); assert.equal(r.status, 409, r.text);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM shipments').get().n, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM erp_audit_events WHERE action='po.bl_attached'").get().n, 0);
  assert.deepEqual({ ...f.sql.prepare('SELECT status,bill_of_lading FROM supplier_purchase_orders WHERE id=?').get(f.poId) }, { status: 'accepted', bill_of_lading: '' });
});
test('tracking preserves request errors', async () => {
  const f = await fixture(), { id } = await attach(f); stub(() => ok(GOOD));
  assert.equal((await track(f, id, 'Saima')).status, 403);
  assert.equal((await track(f, crypto.randomUUID())).status, 404);
  assert.equal((await track(f, 'nope')).status, 422);
  const other = await portalFixture(); await other.person('Pervaiz', 'purchase_manager'); other.env.DATALOOPLABS_API_KEY = KEY;
  assert.equal((await track(other, id)).status, 404);
  assert.equal(calls, 0); assert.equal(row(f, id).status, 'not_checked'); assert.equal(row(f, id).last_checked_at, null);
});
const trackAudits = f => f.sql.prepare("SELECT * FROM erp_audit_events WHERE action='shipment.tracked'").all();
test('an admin Track audits the intervention reason; a purchase manager Track does not', async () => {
  const f = await fixture(), { id } = await attach(f); stub(() => ok(GOOD));
  assert.equal((await track(f, id)).status, 200); assert.equal(trackAudits(f).length, 0);
  assert.equal((await f.call('/erp/shipments/track', { id }, 'Anas')).status, 422); // admin needs a reason
  const r = await f.call('/erp/shipments/track', { id, interventionReason: 'Pervaiz is away today' }, 'Anas');
  assert.equal(r.status, 200, r.text);
  const [a, ...rest] = trackAudits(f); assert.equal(rest.length, 0); assert.equal(a.intervention_reason, 'Pervaiz is away today'); assert.equal(a.object_type, 'shipment'); assert.equal(a.record_id, id);
  stub(() => new Response('down', { status: 503 }));
  await f.call('/erp/shipments/track', { id, interventionReason: 'Retry for the supplier' }, 'Anas');
  assert.equal(trackAudits(f).length, 2);
});
test('a failed audit write leaves the cache untouched', async () => {
  const f = await fixture(), { id } = await attach(f); stub(() => ok(GOOD));
  f.sql.exec("CREATE TRIGGER no_audit BEFORE INSERT ON erp_audit_events WHEN NEW.action='shipment.tracked' BEGIN SELECT RAISE(ABORT,'audit down'); END");
  await f.call('/erp/shipments/track', { id, interventionReason: 'Pervaiz is away today' }, 'Anas').catch(() => {});
  assert.equal(row(f, id).status, 'not_checked'); assert.equal(row(f, id).last_status_json, null); assert.equal(trackAudits(f).length, 0);
});
test('a bill of lading shorter than 3 characters after stripping spaces is refused', async () => {
  const f = await fixture(); assert.equal((await attach(f, ' a b ')).status, 422);
});
test('a slow provider is reported as an ambiguous timeout', async () => {
  const { trackUnit } = await import('../server/datalooplabs.mjs'), account = { base_url: 'https://provider.test/v1', track_path: '/t', contract_verified_at: 1, contract_json: JSON.stringify({ request: JSON.parse(CONTRACT).request, response: JSON.parse(CONTRACT).response }) };
  await assert.rejects(trackUnit({ DATALOOPLABS_API_KEY: KEY }, account, { identifier: 'MSCUBL1234', identifier_type: 'bol' }, { timeoutMs: 20, fetch: (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new Error('aborted'))) ) }), e => e.kind === 'ambiguous_timeout');
});
