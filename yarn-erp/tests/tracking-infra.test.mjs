import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { trackingApi, trackingScheduled } from '../server/tracking.mjs';
import { stageOf } from '../server/tracking-stage.mjs';
import { trackingView } from '../src/tracking.ts';

const KEY = 'dll_test_key_1234567890';
const CONTRACT = { request: { number: 'number', type: 'type', types: { bol: 'bill_of_lading' } },
  response: { containers: 'containers', containerNumber: 'number', reference: 'referenceNumber', events: 'events',
    event: { time: 'eventTime', title: 'statusDescription', code: 'statusCode', location: 'location' } } };
const VALID = { enabled: true, baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track', contract: CONTRACT, refreshHours: 12, dailyBudget: 5, verified: true };
const GOOD = { containers: [{ number: 'MSCU1234567' }], events: [{ eventTime: '2026-10-28T10:00:00Z', statusCode: 'LOADED', statusDescription: 'Loaded on vessel', location: 'Karachi' }], referenceNumber: 'BL123' };
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Any accidental real network call fails the test instead of leaving the machine.
const blocked = async () => { throw new Error('real network call attempted in test'); };
globalThis.fetch = blocked;
let calls = 0, sent = [];
afterEach(() => { globalThis.fetch = blocked; });
const stub = fn => { calls = 0; sent = []; globalThis.fetch = async (url, init) => { calls++; sent.push({ url, auth: init.headers.Authorization }); return fn(url, init); }; };

async function setup({ key = KEY } = {}) {
  const f = await portalFixture();
  await f.person('Pervaiz', 'purchase_manager'); await f.person('Saima', 'supervisor');
  if (key) f.env.DATALOOPLABS_API_KEY = key;
  f.workspaceId = f.sql.prepare('SELECT id FROM workspaces').get().id;
  f.supplierId = await f.insertSupplier({ status: 'approved' });
  return f;
}
const as = (f, name) => {
  const row = f.sql.prepare('SELECT id,portal_role FROM users WHERE name=?').get(name);
  return { workspace_id: f.workspaceId, user_id: row.id, name, role: row.portal_role, admin: row.portal_role === 'admin', permissions: [] };
};
// Settings are called directly: the erp dispatcher in server/inventory.mjs routes /api/erp/tracking/* once it is wired.
const settings = (f, who, body) => trackingApi(new Request('https://yarnflow.test/api/erp/tracking/settings', { method: body === undefined ? 'GET' : 'POST' }),
  f.env, as(f, who), '/api/erp/tracking/settings', body);
const ship = async (f, { checkedAt = null, stage = null } = {}) => {
  const { shipmentId } = await f.insertPO({ supplierId: f.supplierId });
  f.sql.prepare('UPDATE shipments SET last_checked_at=?,stage=? WHERE id=?').run(checkedAt, stage, shipmentId);
  return shipmentId;
};
const count = (f, sql, ...args) => f.sql.prepare(sql).get(...args).n;
const quietly = async fn => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

test('stageOf follows the client rules, including the newest-event and destination cases', () => {
  const ev = (title, at, location = 'Karachi', code = '') => ({ at, title, code, location });
  const data = (events, extra = {}) => ({ containers: [], reference: 'BL1', dataAt: null, eta: null, origin: null, destination: null, vessel: null, carrier: null, events, ...extra });
  const cases = [
    [data([ev('Booking confirmed', 1)]), 'tracked', 'booked'],
    [data([ev('Loaded on vessel', 2)]), 'tracked', 'departed'],
    [data([ev('Vessel sailing', 2)]), 'tracked', 'in_transit'],
    [data([ev('Discharged at port', 3)]), 'tracked', 'arrived'],
    [data([ev('Delivered to consignee', 4)]), 'tracked', 'delivered'],
    [data([ev('Unknown', 1)], { empty: true }), 'tracked', 'delivered'],
    [data([ev('Gate out', 2, 'Rotterdam')], { destination: 'Rotterdam' }), 'tracked', 'arrived'],
    [data([ev('Gate out', 2, 'Karachi')], { destination: 'Rotterdam' }), 'tracked', 'booked'],
    [data([ev('Discharged', 5), ev('Loaded', 1)]), 'tracked', 'arrived'],
    [data([]), 'tracked', 'booked'],
    [data([]), 'error', 'error'],
    [data([]), 'not_checked', 'not_checked'],
  ];
  for (const [normalized, status, expected] of cases) {
    const shaped = JSON.parse(JSON.stringify(normalized));
    assert.equal(stageOf(status, normalized), expected, JSON.stringify(normalized.events));
    assert.equal(trackingView({ status, last_status_json: JSON.stringify(shaped), last_error: null }).stage, expected, 'client parity');
  }
});

test('settings GET never returns the key and lists what is missing', async () => {
  const f = await setup();
  const r = await settings(f, 'Pervaiz'), text = await r.text(), data = JSON.parse(text);
  assert.equal(r.status, 200); assert.ok(!text.includes(KEY), 'key leaked');
  assert.equal(data.settings.contract, null); assert.equal(data.settings.enabled, false);
  assert.equal(data.status.configured, false); assert.equal(data.status.keyConfigured, true); assert.equal(data.status.keyHint, '…7890');
  assert.match(data.status.contractGaps.join(' '), /provider base URL/);
  assert.match(data.status.contractGaps.join(' '), /admin attestation/);
  assert.equal(data.status.callsToday, 0); assert.equal(data.status.dailyBudget, 0); assert.equal(data.status.refreshHours, 12);
  await assert.rejects(settings(f, 'Saima'), { status: 403 });
});

test('settings POST is admin only and refuses http, bad paths, bad contracts, unverified contracts and out-of-range numbers', async () => {
  const f = await setup();
  await assert.rejects(settings(f, 'Pervaiz', VALID), { status: 403 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, verified: false }), { status: 422 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, baseUrl: 'http://provider.test/v1' }), { status: 422 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, trackPath: 'tracking/track' }), { status: 422 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, contract: { request: {}, response: {} } }), { status: 422 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, refreshHours: 0 }), { status: 422 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, dailyBudget: 1001 }), { status: 422 });
  await assert.rejects(settings(f, 'Anas', { ...VALID, unexpected: 1 }), { status: 422 });
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM tracking_settings'), 0);
});

test('a verified admin save makes tracking configured once the key is set, and is audited without the key', async () => {
  const f = await setup({ key: null });
  const saved = await (await settings(f, 'Anas', VALID)).json();
  assert.equal(saved.status.configured, false); assert.match(saved.status.contractGaps.join(' '), /API key/);
  assert.equal(saved.settings.verifiedBy, 'Anas'); assert.ok(saved.settings.verifiedAt > 0); assert.deepEqual(saved.settings.contract, CONTRACT);
  f.env.DATALOOPLABS_API_KEY = KEY;
  const after = await (await settings(f, 'Pervaiz')).json();
  assert.equal(after.status.configured, true); assert.equal(after.status.enabled, true); assert.deepEqual(after.status.contractGaps, []);
  const [audit] = f.sql.prepare("SELECT * FROM erp_audit_events WHERE action='tracking.settings_changed'").all();
  assert.equal(audit.actor_id, as(f, 'Anas').user_id); assert.ok(!audit.new_json.includes(KEY));
});

test('a Track on a verified account stores events once, sets the stage and logs each call', async () => {
  const f = await setup();
  await settings(f, 'Anas', VALID);
  const shipmentId = await ship(f), orderId = f.sql.prepare('SELECT purchase_order_id AS p FROM shipments WHERE id=?').get(shipmentId).p;
  stub(() => ok(GOOD));
  const first = await f.call('/erp/shipments/track', { id: shipmentId }, 'Pervaiz');
  assert.equal(first.status, 200, first.text); assert.equal(first.data.error, undefined);
  assert.equal(sent[0].url, 'https://provider.test/v1/tracking/track'); assert.equal(sent[0].auth, `Bearer ${KEY}`);
  assert.deepEqual(first.data.stageChanged, { from: null, to: 'departed' });
  assert.equal(first.data.shipment.stage, 'departed');
  const stamped = f.sql.prepare('SELECT stage,stage_changed_at FROM shipments WHERE id=?').get(shipmentId);
  assert.equal(stamped.stage, 'departed'); assert.ok(stamped.stage_changed_at > 0);
  const second = await f.call('/erp/shipments/track', { id: shipmentId }, 'Pervaiz');
  assert.equal(second.status, 200); assert.equal(second.data.stageChanged, undefined);
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM shipment_events WHERE shipment_id=?', shipmentId), 1, 'the repeated event was not deduped');
  assert.equal(f.sql.prepare('SELECT stage_changed_at FROM shipments WHERE id=?').get(shipmentId).stage_changed_at, stamped.stage_changed_at);
  assert.deepEqual(f.sql.prepare('SELECT trigger,outcome FROM tracking_calls WHERE shipment_id=? ORDER BY created_at').all(shipmentId).map(c => [c.trigger, c.outcome]), [['manual', 'ok'], ['manual', 'ok']]);
  const listed = await f.call('/erp/shipments?orderId=' + orderId, undefined, 'Pervaiz');
  const row = listed.data.shipments.find(s => s.id === shipmentId);
  assert.equal(row.stage, 'departed'); assert.equal(row.events.length, 1); assert.equal(row.events[0].title, 'Loaded on vessel'); assert.equal(row.events[0].location, 'Karachi');
  assert.equal(listed.data.tracking.configured, true); assert.equal(listed.data.tracking.callsToday, 2);
  assert.ok(!listed.text.includes(KEY));
});

test('scheduled refresh does nothing while disabled, without a key, or with a zero budget', async () => {
  const f = await setup();
  await settings(f, 'Anas', { ...VALID, enabled: false }); await ship(f); stub(() => ok(GOOD));
  assert.deepEqual(await trackingScheduled(f.env), { checked: 0, stageChanges: [] }); assert.equal(calls, 0);
  await settings(f, 'Anas', { ...VALID, dailyBudget: 0 });
  assert.equal((await trackingScheduled(f.env)).checked, 0); assert.equal(calls, 0);
  const g = await setup({ key: null });
  await settings(g, 'Anas', VALID); await ship(g); stub(() => ok(GOOD));
  assert.equal((await trackingScheduled(g.env)).checked, 0); assert.equal(calls, 0);
});

test('scheduled refresh spends at most the daily budget and reports stage changes', async () => {
  const f = await setup();
  await settings(f, 'Anas', { ...VALID, dailyBudget: 2 });
  for (let i = 0; i < 3; i++) await ship(f);
  stub(() => ok(GOOD));
  const result = await trackingScheduled(f.env);
  assert.equal(result.checked, 2); assert.equal(calls, 2);
  assert.equal(result.stageChanges.length, 2); assert.equal(result.stageChanges[0].to, 'departed'); assert.equal(result.stageChanges[0].from, null);
  assert.deepEqual(f.sql.prepare("SELECT trigger FROM tracking_calls").all().map(r => r.trigger), ['auto', 'auto']);
  assert.equal((await trackingScheduled(f.env)).checked, 0, 'the budget is spent for the day');
  assert.equal(calls, 2);
});

test('manual Tracks count against the same daily budget', async () => {
  const f = await setup();
  await settings(f, 'Anas', { ...VALID, dailyBudget: 2 });
  const manual = await ship(f); await ship(f);
  stub(() => ok(GOOD));
  assert.equal((await f.call('/erp/shipments/track', { id: manual }, 'Pervaiz')).status, 200);
  assert.equal((await trackingScheduled(f.env)).checked, 1);
  assert.equal(calls, 2);
});

test('scheduled refresh respects the refresh interval, checks never-checked shipments first and skips delivered ones', async () => {
  const f = await setup(), hour = 3600000;
  await settings(f, 'Anas', VALID);
  const recent = await ship(f, { checkedAt: Date.now() - hour });
  const stale = await ship(f, { checkedAt: Date.now() - 13 * hour });
  const never = await ship(f);
  const delivered = await ship(f, { checkedAt: Date.now() - 99 * hour, stage: 'delivered' });
  stub(() => ok(GOOD));
  assert.equal((await trackingScheduled(f.env)).checked, 2);
  const tracked = f.sql.prepare("SELECT DISTINCT shipment_id AS id FROM tracking_calls").all().map(r => r.id).sort();
  assert.deepEqual(tracked, [stale, never].sort());
  assert.equal(f.sql.prepare('SELECT last_checked_at FROM shipments WHERE id=?').get(recent).last_checked_at >= Date.now() - 2 * hour, true);
  assert.equal(f.sql.prepare('SELECT last_checked_at FROM shipments WHERE id=?').get(delivered).last_checked_at < Date.now() - 98 * hour, true);
  // With a budget of one, the never-checked shipment goes first.
  await settings(f, 'Anas', { ...VALID, dailyBudget: 1 });
  f.sql.prepare('UPDATE shipments SET last_checked_at=NULL WHERE id=?').run(never);
  f.sql.prepare("DELETE FROM tracking_calls").run();
  stub(() => ok(GOOD));
  assert.equal((await trackingScheduled(f.env)).checked, 1);
  assert.deepEqual(f.sql.prepare("SELECT DISTINCT shipment_id AS id FROM tracking_calls").all().map(r => r.id), [never]);
});

test('scheduled refresh keeps going after one shipment fails, and never throws', async () => {
  const f = await setup();
  await settings(f, 'Anas', { ...VALID, dailyBudget: 5 });
  const [a, b, c] = [await ship(f), await ship(f), await ship(f)];
  f.sql.exec(`CREATE TRIGGER fail_one BEFORE INSERT ON tracking_calls WHEN NEW.shipment_id='${a}' BEGIN SELECT RAISE(ABORT,'boom'); END`);
  stub(() => ok(GOOD));
  const result = await quietly(() => trackingScheduled(f.env));
  assert.equal(result.checked, 2); assert.equal(calls, 3);
  assert.equal(f.sql.prepare('SELECT last_checked_at FROM shipments WHERE id=?').get(a).last_checked_at, null, 'the failed batch rolled back');
  assert.ok(f.sql.prepare('SELECT last_checked_at FROM shipments WHERE id=?').get(b).last_checked_at > 0);
  assert.ok(f.sql.prepare('SELECT last_checked_at FROM shipments WHERE id=?').get(c).last_checked_at > 0);
  f.sql.exec('DROP TABLE tracking_settings');
  assert.deepEqual(await quietly(() => trackingScheduled(f.env)), { checked: 0, stageChanges: [] });
});
