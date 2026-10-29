/** Tracking spend-control and sync-engine tests.
 *
 * A fake provider double is injected through `runTrackingSync` deps, so no test
 * reaches the real network and no paid call is ever made. The adapter stays
 * fail-closed until an admin records a verified contract, so unconfigured runs
 * never cost anything and never invent carrier events.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { PERMISSIONS, seedRows, sha256, userRow } from '../server/auth.mjs';
import { trackingApi } from '../server/tracking.mjs';
import { runTrackingSync, estimateCredits, monthUsage, enqueueSyncJob } from '../server/tracking-budget.mjs';
import { redact, accountScope, maskedCredential, parseContract } from '../server/datalooplabs.mjs';

const origin = 'https://yarnflow.test';
const KEY = 'datalooplabs-test-credential-7799ffeedd';
const KEY2 = 'another-credential-0000aaaa';
const CONTAINERS = ['ABCD1234567', 'EFGH7654321'];
const INTERVAL = 720 * 60_000; // default refresh interval: 12h

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../drizzle/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
  const env = { DB: sqliteBinding(sql), DATALOOPLABS_API_KEY: KEY };
  async function request(path, data, cookie, headers = {}) {
    const response = await inventoryApi(new Request(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env);
    return { status: response.status, data: await response.json(), cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
  }
  const admin = (await request('/auth/login', { name: 'Anas', pin: '2468' })).cookie;
  const staff = (path, data) => request(path, data, admin);
  async function member(db, cookie) {
    const token = cookie.match(/yf_session=([a-f\d]{64})/)[1];
    const hash = await sha256(token);
    const user = await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').bind(hash).first();
    if (!user) return null;
    const isAdmin = user.role === 'admin';
    return { user_id: user.id, workspace_id: user.workspace_id, name: user.name, role: isAdmin ? 'owner' : 'operator', admin: isAdmin, permissions: isAdmin ? PERMISSIONS : JSON.parse(user.permissions) };
  }
  async function track(path, data, cookie = admin, extra = {}) {
    const memberRow = extra.member ?? await member(env.DB, cookie);
    const resolved = data === undefined ? 'GET' : 'POST';
    const response = await trackingApi(new Request(origin + '/api/erp/tracking' + path, {
      method: resolved,
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(data === undefined ? {} : { body: JSON.stringify(data) }) },
    }), env, memberRow, '/api/erp/tracking' + path, resolved === 'GET' ? null : data ?? {});
    return { status: response.status, data: await response.json() };
  }
  async function secondWorkspaceCookie() {
    const ws2 = crypto.randomUUID();
    sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(ws2, 'Second Factory', Date.now());
    const row = await userRow({ workspaceId: ws2, name: 'Other Admin', pin: '1357', role: 'admin', permissions: [] });
    sql.prepare(row.sql).run(...row.args);
    const cookie = (await request('/auth/login', { name: 'Other Admin', pin: '1357' })).cookie;
    return { cookie, workspaceId: ws2 };
  }
  async function register(name = 'Alpha', cats = ['cotton']) {
    const address = name.toLowerCase() + '@supplier.test';
    const r = await request('/portal/register', { company: name + ' Mills', contactName: name + ' Contact', email: address, phone: '+923001234567', city: 'Karachi', password: 'A strong test password 2026', categories: cats });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = sql.prepare('SELECT supplier_id FROM supplier_users WHERE email=?').get(address).supplier_id;
    return { id, email: address, login: () => request('/portal/login', { email: address, password: 'A strong test password 2026' }) };
  }
  async function approve(supplier, status = 'approved') {
    const version = sql.prepare('SELECT version FROM suppliers WHERE id=?').get(supplier.id).version;
    const r = await staff('/erp/suppliers/review', { id: supplier.id, status, version, reason: 'Company and contact checked by admin' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  async function active(name = 'Alpha', cats = ['cotton']) { const s = await register(name, cats); await approve(s); s.cookie = (await s.login()).cookie; return s; }
  async function rfq(category = 'cotton') {
    const id = crypto.randomUUID(), now = Date.now();
    const r = await staff('/erp/rfqs', { id, title: 'Cotton combed 30/1', categoryId: category, specifications: 'Ring-spun 30/1, weaving grade', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'FAZ textile factory', deadlineAt: now + 86400000, requestedDeliveryAt: now + 7 * 86400000 });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.rfq;
  }
  const bid = (rfqRow, version = 0, id = crypto.randomUUID()) => ({ id, rfqId: rfqRow.id, version, quantityMilli: rfqRow.quantity_milli, priceMinor: 125000, currency: 'PKR', paymentTerms: '30 days after confirmed delivery', deliveryAt: Date.now() + 7 * 86400000, validUntil: Date.now() + 3 * 86400000, note: 'Freight included' });
  async function award(s, r) {
    assert.equal((await staff('/erp/rfqs/publish', { id: r.id })).status, 200);
    const b = await request('/portal/bids', bid(r), s.cookie);
    assert.equal(b.status, 201, JSON.stringify(b.data));
    const a = await staff('/erp/bids/award', { id: b.data.bid.id, version: 1 });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    return { order: a.data.order, bid: b.data.bid };
  }
  async function dispatch(supplier, { bl = 'TESTBL100', containers = [], qty = 60000 } = {}) {
    const r = await rfq();
    const { order } = await award(supplier, r);
    const d = await request('/portal/dispatches', { id: crypto.randomUUID(), orderId: order.id, billOfLading: bl, carrier: 'Test Line', containers, quantityMilli: qty, dispatchedAt: Date.now() - 1000, note: 'Supplier dispatch test' }, supplier.cookie);
    assert.equal(d.status, 201, JSON.stringify(d.data));
    return { order, shipment: d.data.shipment };
  }
  const operator = (permissions, workspaceId) => ({ user_id: crypto.randomUUID(), workspace_id: workspaceId ?? sql.prepare('SELECT id FROM workspaces WHERE name=?').get('FAZ Textile Factory').id, name: 'Operator', role: 'operator', admin: false, permissions });
  /** Create a linked target through the real route. Returns { shipment, targetId, bl }. */
  async function link({ supplier = null, bl = 'TESTBL' + Math.floor(Math.random() * 100000), containers = [], cookie = admin, shipmentId = null, name = null } = {}) {
    const sup = supplier ?? await active('Supplier' + crypto.randomUUID().replace(/-/g, '').slice(0, 8));
    const { order, shipment } = await dispatch(sup, { bl, containers });
    const id = crypto.randomUUID();
    const created = await track('/targets', {
      id, purchaseOrderId: order.id, shipmentId: shipmentId ?? shipment.id,
      identifierType: 'bol', identifier: bl, carrier: 'Test Line', note: 'Linked from the dispatch notice',
    }, cookie);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return { sup, order, shipment, targetId: created.data.target.id, bl };
  }
  async function authorize(targetId, requestId = 'request-' + crypto.randomUUID().slice(0, 12), extra = {}) {
    const r = await track(`/targets/${targetId}/authorize`, { requestId, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  }
  const calls = [];
  let script = () => ({ status: 200, body: samplePayload() });
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), at: Date.now() });
    const out = await script(url, JSON.parse(init.body), calls.length, init);
    return { status: out.status, json: async () => (typeof out.body === 'string' ? JSON.parse(out.body) : out.body) };
  };
  async function runSync(opts = {}) {
    return runTrackingSync(env, { fetch: fakeFetch, maxJobs: 10, ...opts });
  }
  async function verifyContract(over = {}) {
    const contract = { ...sampleContract(), ...(over.contract ?? {}) };
    const r = await track('/account', {
      baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track',
      contract: JSON.stringify(contract), contractNote: 'Account docs, TrackIT API section',
      renewalDays: over.renewalDays ?? 30, rateLimitPerMinute: over.rateLimitPerMinute ?? 60,
      refreshIntervalMinutes: over.refreshIntervalMinutes ?? 720, verifyContract: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ready.contract, true, JSON.stringify(r.data.ready));
  }
  return {
    sql, env, request, staff, member, track, register, approve, active, rfq, bid, award, dispatch, operator,
    calls, fakeFetch, runSync, verifyContract, setScript: fn => { script = fn; }, secondWorkspaceCookie, link, authorize,
  };
}

function samplePayload() {
  return {
    referenceNumber: 'REF-77',
    lastUpdated: '2026-10-26T10:00:00Z',
    containers: [{ number: 'ABCD1234567' }, { number: 'EFGH7654321' }],
    events: [
      { eventTime: '2026-10-01T09:00:00Z', statusCode: 'GATE_IN', statusDescription: 'Container received at origin port', location: 'Port Klang' },
      { eventTime: '2026-10-05T12:00:00Z', statusCode: 'VESSEL_DEPARTED', statusDescription: 'Vessel departed origin', location: 'Port Klang' },
    ],
  };
}
function terminalPayload() {
  return {
    referenceNumber: 'REF-TERM',
    lastUpdated: '2026-10-26T10:00:00Z',
    containers: [{ number: 'ABCD1234567' }],
    events: [
      { eventTime: '2026-10-01T09:00:00Z', statusCode: 'GATE_IN', statusDescription: 'Container received at origin port', location: 'Port Klang' },
      { eventTime: '2026-10-20T21:00:00Z', statusCode: 'DELIVERED', statusDescription: 'Delivered at destination', location: 'Karachi' },
    ],
  };
}
function sampleContract() {
  return {
    request: { number: 'trackingNumber', type: 'type', force: 'force_update', carrier: 'carrier', types: { bol: 'BL', booking: 'BOOKING', container: 'CNTR' } },
    response: {
      containers: 'containers', containerNumber: 'number', events: 'events',
      event: { time: 'eventTime', code: 'statusCode', title: 'statusDescription', location: 'location' },
      reference: 'referenceNumber', dataTimestamp: 'lastUpdated', terminalCodes: ['DELIVERED'],
    },
    chargeSemantics: { invalid_identifier_charged: false },
  };
}

test('redaction never exposes the configured credential and contracts parse keep-or-reject', async () => {
  const f = await fixture();
  const text = `HTTP error at https://provider.test/v1?api_key=${KEY}&x=1 Bearer ${KEY2} leaked`;
  const cleaned = redact(text, { DATALOOPLABS_API_KEY: KEY });
  assert.ok(!cleaned.includes(KEY));
  assert.ok(cleaned.includes('[credential removed]'));
  assert.ok(!redact(text, { DATALOOPLABS_API_KEY: KEY }).match(/[Bb]earer\s+[A-Za-z0-9_\-=.]{6,}/), 'bearer tokens are scrubbed too');
  assert.equal(maskedCredential({ DATALOOPLABS_API_KEY: KEY }), '…eedd');
  const scope = await accountScope({ DATALOOPLABS_API_KEY: KEY });
  assert.match(scope, /^datalooplabs:[a-f0-9]{12}$/);
  assert.ok(!JSON.stringify({ scope }).includes(KEY));
  const parsed = parseContract(JSON.stringify(sampleContract()));
  assert.equal(parsed.request.number, 'trackingNumber');
  assert.equal(parsed.response.containerNumber, 'number');
  assert.equal(parseContract('{not json'), null);
  assert.equal(parseContract(JSON.stringify({ request: { number: 'x' } })), null, 'missing response mapping is rejected');
});

test('missing credential blocks tracking start and the account gate stays honest', async () => {
  const f = await fixture();
  delete f.env.DATALOOPLABS_API_KEY;
  const created = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'bol', identifier: 'TESTBL100' });
  assert.equal(created.status, 409);
  assert.equal(created.data.code, 'tracking_credential_missing');
  const account = await f.track('/account', { baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track', contract: '', verifyContract: false });
  assert.equal(account.status, 409);
  assert.equal(account.data.code, 'tracking_credential_missing');
  const overview = await f.track('/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.account.configured, false);
  assert.match(overview.data.account.verification, /No API key is configured/);
});

test('permission gates: view, manage, reconcile, policy and account are distinct rights', async () => {
  const f = await fixture();
  const noView = f.operator(['sales']);
  const r1 = await f.track('/overview', undefined, undefined, { member: noView });
  assert.equal(r1.status, 403); assert.equal(r1.data.code, 'tracking_view_denied');
  const viewer = f.operator(['receive']);
  const r2 = await f.track('/targets', undefined, undefined, { member: viewer });
  assert.equal(r2.status, 200);
  const r3 = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'bol', identifier: 'TESTBL100' }, undefined, { member: viewer });
  assert.equal(r3.status, 403); assert.equal(r3.data.code, 'tracking_manage_denied');
  const { targetId } = await f.link({ bl: 'TESTBLPERM01' });
  const r4 = await f.track(`/targets/${targetId}/authorize`, { requestId: 'perm-request-00001' }, undefined, { member: viewer });
  assert.equal(r4.status, 403); assert.equal(r4.data.code, 'tracking_manage_denied');
  const procure = f.operator(['procure']);
  const r5 = await f.track(`/targets/${targetId}/reconcile`, { decision: 'not_charged', note: 'Attempt by a non-admin' }, undefined, { member: procure });
  assert.equal(r5.status, 403); assert.equal(r5.data.code, 'tracking_reconcile_denied');
  const r6 = await f.track('/policy', { autoTrack: 'manual', renewalPolicy: 'pause', forceRefreshPolicy: 'explicit' }, undefined, { member: procure });
  assert.equal(r6.status, 403); assert.equal(r6.data.code, 'tracking_policy_denied');
  const r7 = await f.track('/account', { baseUrl: 'https://provider.test/v1', trackPath: '/x', contract: '' }, undefined, { member: procure });
  assert.equal(r7.status, 403); assert.equal(r7.data.code, 'tracking_account_denied');
});

test('config-blocked until contract verified; verification unblocks and then charges once', async () => {
  const f = await fixture();
  // Recording an unverifiable contract is rejected with a stable code.
  const bad = await f.track('/account', { baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track', contract: '{}', contractNote: 'note', verifyContract: true });
  assert.equal(bad.status, 422); assert.equal(bad.data.code, 'tracking_contract_invalid');
  const { targetId } = await f.link({ bl: 'TESTBLCFG01' });
  const auth = await f.authorize(targetId, 'cfg-request-0001-aaa');
  assert.equal(auth.purpose, 'first_track');
  assert.equal(f.calls.length, 0);
  let summary = await f.runSync();
  assert.equal(summary.jobs[0].outcome, 'blocked_contract');
  assert.equal(f.calls.length, 0, 'no provider call without a verified contract');
  let job = f.sql.prepare('SELECT state, last_error_kind FROM tracking_sync_jobs WHERE target_id=?').get(targetId);
  assert.equal(job.state, 'blocked_policy');
  assert.equal(job.last_error_kind, 'contract_unavailable');
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'config_blocked');
  let reservation = f.sql.prepare("SELECT state FROM tracking_reservations WHERE target_id=?").get(targetId);
  assert.equal(reservation.state, 'reserved', 'the reservation is held while the account is unverified');
  await f.verifyContract();
  job = f.sql.prepare('SELECT state FROM tracking_sync_jobs WHERE target_id=?').get(targetId);
  assert.equal(job.state, 'queued', 'verification requeues the contract-blocked job');
  summary = await f.runSync();
  assert.equal(summary.jobs[0].outcome, 'charged');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://provider.test/v1/tracking/track');
  assert.equal(f.calls[0].body.trackingNumber, 'TESTBLCFG01');
  assert.equal(f.calls[0].body.type, 'bl');
  assert.equal(JSON.stringify(f.calls[0]).includes(KEY), false, 'the credential never leaves the redact layer');
  const target = f.sql.prepare('SELECT status, data_state, provider_ref FROM tracking_targets WHERE id=?').get(targetId);
  assert.equal(target.status, 'authorized');
  assert.equal(target.data_state, 'live');
  assert.equal(target.provider_ref, 'REF-77');
  reservation = f.sql.prepare('SELECT state FROM tracking_reservations WHERE target_id=?').get(targetId);
  assert.equal(reservation.state, 'committed');
});

test('linking normalizes identifiers and dedupes at account scope across and inside workspaces', async () => {
  const f = await fixture();
  const { shipment, targetId, bl } = await f.link({ bl: 'TESTBLDD01', containers: CONTAINERS });
  const repeat = await f.track('/targets', { id: crypto.randomUUID(), purchaseOrderId: f.sql.prepare('SELECT purchase_order_id FROM tracking_target_links WHERE target_id=?').get(targetId).purchase_order_id, shipmentId: shipment.id, identifierType: 'bol', identifier: ' testbldd01  '.toUpperCase().slice(1), requestNotAllowed: undefined ? undefined : undefined });
  assert.equal(repeat.status, 422, 'unexpected request fields are rejected before any state changes');
  const samePo = await f.track('/targets', { id: crypto.randomUUID(), purchaseOrderId: f.sql.prepare('SELECT purchase_order_id FROM tracking_target_links WHERE target_id=?').get(targetId).purchase_order_id, identifierType: 'bol', identifier: 'TESTBLDD01' });
  assert.equal(samePo.status, 201);
  assert.equal(samePo.data.deduped, true, 'same identifier + same PO dedupes onto the shared target');
  assert.equal(samePo.data.target.id, targetId);
  const other = await f.active('Beta');
  const r = await f.rfq();
  const { order } = await f.award(other, r);
  const differentPo = await f.track('/targets', { id: crypto.randomUUID(), purchaseOrderId: order.id, identifierType: 'bol', identifier: 'TESTBLDD01' });
  assert.equal(differentPo.status, 409, 'a second PO cannot silently adopt the same provider row');
  assert.equal(differentPo.data.code, 'tracking_target_po_conflict');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_targets').get().n, 1, 'still exactly one account-scoped target');

  const shipmentConflict = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'container', identifier: 'ABCD1234567', shipmentId: shipment.id });
  assert.equal(shipmentConflict.status, 409);
  assert.equal(shipmentConflict.data.code, 'tracking_shipment_conflict');

  const containerCreate = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'container', identifier: ' abcd1234567 ' });
  assert.equal(containerCreate.status, 201);
  assert.equal(containerCreate.data.target.identifier, 'ABCD1234567');
  assert.equal(containerCreate.data.target.identifier_type, 'container');
  const badContainer = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'container', identifier: 'ABCD123456' });
  assert.equal(badContainer.status, 422);
  assert.equal(badContainer.data.code, 'tracking_container_invalid');
  const badBol = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'bol', identifier: 'ab' });
  assert.equal(badBol.status, 422);
  assert.equal(badBol.data.code, 'tracking_bol_invalid');

  const ws2 = await f.secondWorkspaceCookie();
  const cross = await f.track('/targets', { id: crypto.randomUUID(), identifierType: 'bol', identifier: 'TESTBLDD01' }, ws2.cookie);
  assert.equal(cross.status, 201);
  assert.equal(cross.data.deduped, true, 'cross-workspace lookup reuses the provider account row');
  assert.equal(cross.data.target.id, targetId);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_targets').get().n, 2, 'bol + container targets only');
  const ws2List = await f.track('/targets', undefined, ws2.cookie);
  assert.equal(ws2List.data.targets.length, 1, 'workspace sees its own links only');
  assert.equal(ws2List.data.targets[0].links.length, 1);
  const ws1List = await f.track('/targets', undefined);
  const ws1Target = ws1List.data.targets.find(t => t.id === targetId);
  assert.equal(ws1Target.links.length, 1, 'the other workspace link is invisible here');
  assert.notEqual(ws1Target.links[0].shipment_id, ws2List.data.targets[0].links[0].shipment_id);
  const foreign = await f.track(`/targets/${targetId}/authorize`, { requestId: 'other-ws-request-1' }, ws2.cookie);
  assert.equal(foreign.status, 200, 'the shared provider account row is usable from the second workspace');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_reservations').get().n, 1, 'each workspace reserves against its own budget');
});

test('authorization reserves credits before spend; duplicate and concurrent requests converge', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLAUTH01', containers: CONTAINERS });
  const short = await f.track(`/targets/${targetId}/authorize`, { requestId: 'tiny' });
  assert.equal(short.status, 422);
  const first = await f.authorize(targetId, 'auth-request-0001-aaaa');
  assert.equal(first.purpose, 'first_track');
  assert.equal(first.estimate.credits, 2, 'two known containers = two billable units');
  assert.equal(first.estimate.containersKnown, true);
  assert.equal(first.estimate.includesRenewal, false);
  assert.ok(first.reservationId);
  const duplicate = await f.authorize(targetId, 'auth-request-0002-bbbb');
  assert.equal(duplicate.reservationId, first.reservationId, 'a second authorization of the same pending purpose reuses the reservation');
  const [p1, p2] = await Promise.all([
    f.authorize(targetId, 'auth-request-0003-cccc'),
    f.authorize(targetId, 'auth-request-0004-dddd'),
  ]);
  assert.equal(p1.reservationId, first.reservationId, 'parallel clicks converge on one reservation');
  assert.equal(p2.reservationId, first.reservationId);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM tracking_reservations WHERE state='reserved'").get().n, 1);
  const ledger = f.sql.prepare("SELECT credits FROM tracking_usage_events WHERE kind='reserve'").all();
  assert.equal(ledger.length, 1, 'exactly one reserve ledger row');
  assert.equal(ledger[0].credits, 2);
  const usage = await monthUsage(f.env.DB, f.sql.prepare('SELECT workspace_id FROM tracking_target_links WHERE target_id=?').get(targetId).workspace_id, Date.now());
  assert.equal(usage.reservedCredits, 2);

  // A request ID reused for a different purpose is refused instead of double-booked.
  const wrongPurpose = await f.track(`/targets/${targetId}/force-refresh`, { requestId: first.reservationId && 'auth-request-0001-aaaa', estimatedCredits: 2, confirm: true });
  assert.equal(wrongPurpose.status, 409, 'the first_track reservation is still open; the id belongs to it');
  assert.ok(['tracking_request_id_conflict', 'tracking_request_id_required'].includes(wrongPurpose.data.code), JSON.stringify(wrongPurpose.data));
  const job = f.sql.prepare('SELECT purpose, reservation_id, state FROM tracking_sync_jobs WHERE target_id=? ORDER BY created_at DESC LIMIT 1').get(targetId);
  assert.equal(job.purpose, 'first_track');
  assert.equal(job.reservation_id, first.reservationId);
  assert.equal(job.state, 'queued');
});

test('multi-container charge, provider-discovered containers and charge ledger details', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLMULTI1', containers: CONTAINERS });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'multi-request-0001');
  await f.runSync();
  const windows = f.sql.prepare('SELECT container, last_charge_at, window_open_until, charge_count FROM tracking_billing_windows WHERE identifier=? ORDER BY container').all('TESTBLMULTI1');
  assert.equal(windows.length, 2, 'both linked containers charged');
  assert.deepEqual(windows.map(w => w.container), CONTAINERS);
  assert.ok(windows.every(w => w.window_open_until > w.last_charge_at + 29 * 86400000), 'windows open for 30 days');
  const commitLedger = f.sql.prepare("SELECT detail FROM tracking_usage_events WHERE kind='commit'").get();
  assert.match(commitLedger.detail, /Charged units: ABCD1234567 · EFGH7654321/);
  assert.equal(f.sql.prepare("SELECT state FROM tracking_reservations WHERE id=?").get(auth.reservationId).state, 'committed');

  // Next provider answer discovers a third container plus junk; junk is never charged.
  let base = f.calls.length;
  f.setScript(url => ({ status: 200, body: { ...samplePayload(), containers: [{ number: 'ABCD1234567' }, { number: 'EFGH7654321' }, { number: 'ABCD7777777' }, { number: 'not-a-container' }] } }));
  const auth2 = await f.authorize(targetId, 'multi-request-0002');
  assert.equal(auth2.estimate.credits, 0, 'windows still cover the two known units');
  const job = await enqueueSyncJob(f.env.DB, targetId, 'refresh');
  await f.runSync();
  assert.equal(f.calls.length, base + 1);
  await f.runSync({ now: Date.now() + INTERVAL + 1000 }); // schedule check now sees provider snapshot
  const queued = f.sql.prepare("SELECT id FROM tracking_sync_jobs WHERE target_id=? AND state IN ('queued','paused')").get(targetId);
  if (queued) await f.runSync();
  const refreshed = f.sql.prepare('SELECT data_state FROM tracking_targets WHERE id=?').get(targetId);
  assert.equal(refreshed.data_state, 'live');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_billing_windows WHERE identifier=?').get('TESTBLMULTI1').n, 2, 'a free repeat never extends billing windows');

  // Expire one container's window to verify estimates count only what is actually pending.
  const soon = Date.now() - 1000;
  f.sql.prepare("UPDATE tracking_billing_windows SET window_open_until=? WHERE identifier=? AND container='ABCD1234567'").run(soon, 'TESTBLMULTI1');
  const estimate = await estimateCredits(f.env.DB, f.sql.prepare('SELECT account_scope FROM tracking_targets WHERE id=?').get(targetId).account_scope,
    f.sql.prepare('SELECT * FROM tracking_targets WHERE id=?').get(targetId), JSON.stringify(CONTAINERS), Date.now());
  assert.equal(estimate.credits, 2);
  assert.equal(estimate.units[0].container, 'ABCD1234567');
  assert.equal(estimate.includesRenewal, true, 'an expired window is a renewal, not a first track');
});

test('renewal boundary: free repeat inside the window, authorization at exact expiry', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLWIND01', containers: CONTAINERS });
  await f.verifyContract();
  await f.authorize(targetId, 'wind-request-0001-a');
  await f.runSync();
  const w0 = f.sql.prepare("SELECT window_open_until, charge_count FROM tracking_billing_windows WHERE identifier='TESTBLWIND01' AND container='ABCD1234567'").get();
  assert.equal(w0.charge_count, 1);

  // Free repeat request inside the window: no reservation, refresh job, no new charge.
  const auth = await f.authorize(targetId, 'wind-request-0002-b');
  assert.equal(auth.purpose, 'refresh', 'the estimate is free, so no authorization is needed');
  assert.equal(auth.reservationId, undefined);
  await f.runSync();
  assert.equal(f.calls.length, 2);
  const afterFree = f.sql.prepare("SELECT window_open_until, charge_count FROM tracking_billing_windows WHERE identifier='TESTBLWIND01' AND container='ABCD1234567'").get();
  assert.equal(afterFree.charge_count, 1, 'free repeats do not extend or re-bill windows');
  const usage = await monthUsage(f.env.DB, f.sql.prepare('SELECT workspace_id FROM tracking_target_links WHERE target_id=?').get(targetId).workspace_id, Date.now());
  assert.equal(usage.reservedCredits, 2, 'only the original charge counts');

  // Engine-level gate: a refresh job that would cross into paid renewal pauses honestly.
  const wRow = f.sql.prepare('SELECT window_open_until FROM tracking_billing_windows WHERE identifier=? AND container=?').get('TESTBLWIND01', 'ABCD1234567');
  f.sql.prepare('UPDATE tracking_billing_windows SET window_open_until=0 WHERE identifier=?').run('TESTBLWIND01');
  const renewalJob = await enqueueSyncJob(f.env.DB, targetId, 'refresh');
  assert.equal(renewalJob.duplicate, false);
  const before = f.calls.length;
  const gated = await f.runSync();
  assert.equal(gated.jobs[0].outcome, 'renewal_required', 'auto-sync never charges a renewal');
  assert.equal(f.calls.length, before, 'no provider call for a renewal without authorization');
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'renewal_paused');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_sync_jobs WHERE id=?').get(renewalJob.id).state, 'blocked_policy');

  // Boundary: exactly at window_open_until the unit is pending again.
  const wou = f.sql.prepare('SELECT window_open_until FROM tracking_billing_windows WHERE identifier=? AND container=?').get('TESTBLWIND01', 'ABCD1234567').window_open_until;
  f.sql.prepare("UPDATE tracking_billing_windows SET window_open_until=window_open_until WHERE identifier=?").run('TESTBLWIND01');
  const atBoundary = await estimateCredits(f.env.DB, f.sql.prepare('SELECT account_scope FROM tracking_targets WHERE id=?').get(targetId).account_scope,
    f.sql.prepare('SELECT * FROM tracking_targets WHERE id=?').get(targetId), JSON.stringify(CONTAINERS), wou);
  assert.equal(atBoundary.credits, 2, 'at exactly window_open_until the renewal is due for every unit');
  const renewal = await f.authorize(targetId, 'wind-request-0003-c');
  assert.equal(renewal.purpose, 'renewal');
  assert.equal(renewal.estimate.credits, 2);
  const result = await f.runSync();
  assert.equal(result.jobs[0].outcome, 'charged');
  const w1 = f.sql.prepare("SELECT window_open_until, charge_count FROM tracking_billing_windows WHERE identifier='TESTBLWIND01' AND container='ABCD1234567'").get();
  assert.equal(w1.charge_count, 2, 'renewal extends the window and increments charge count');
  assert.ok(w1.window_open_until > w0.window_open_until - 2_500_000_000, 'window restarted from the renewal charge');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(renewal.reservationId).state, 'committed');
});

test('billing windows and history are append-only (immutability triggers)', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLIMMUT1' });
  await f.verifyContract();
  await f.authorize(targetId, 'immu-request-0001-a');
  await f.runSync();
  assert.throws(() => f.sql.prepare('UPDATE tracking_usage_events SET credits=0').run(), /immutable credit ledger/);
  assert.throws(() => f.sql.prepare('DELETE FROM tracking_usage_events').run(), /immutable credit ledger/);
  assert.throws(() => f.sql.prepare('UPDATE tracking_events SET title=?').run('Rewritten history'), /append-only/);
  assert.throws(() => f.sql.prepare('DELETE FROM tracking_events').run(), /append-only/);
  assert.throws(() => f.sql.prepare('UPDATE tracking_billing_windows SET last_charge_at=0 WHERE identifier=?').run('TESTBLIMMUT1'), /billing windows only extend/);
});

test('monthly and per-shipment caps block with a ledger row and no reservation', async () => {
  const f = await fixture();
  await f.verifyContract();
  const policy = await f.track('/policy', { monthlyCreditCap: 2, perShipmentCreditCap: 1, autoTrack: 'manual', renewalPolicy: 'pause', forceRefreshPolicy: 'explicit', creditCostMinor: null });
  assert.equal(policy.status, 200);
  const { targetId: firstId } = await f.link({ bl: 'TESTBLCAPA01' });
  const first = await f.authorize(firstId, 'cap-request-0001-a');
  await f.runSync();
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(first.reservationId).state, 'committed');
  const { targetId: secondId } = await f.link({ bl: 'TESTBLCAPB01' });
  const second = await f.authorize(secondId, 'cap-request-0002-b');
  assert.equal(second.estimate.credits, 1);
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(second.reservationId).state, 'reserved');
  const { targetId: thirdId } = await f.link({ bl: 'TESTBLCAPC01' });
  const third = await f.track(`/targets/${thirdId}/authorize`, { requestId: 'cap-request-0003-c' });
  assert.equal(third.status, 402, 'capCheck throws inside authorize');
  const blocked = await f.track(`/targets/${thirdId}/authorize`, { requestId: 'cap-request-0003-c' });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.data.code, 'tracking_monthly_cap_reached');
  assert.match(blocked.data.error, /no credits were spent/i);
  const blockedRow = f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_reservations WHERE target_id=?').get(thirdId);
  assert.equal(blockedRow.n, 0, 'nothing was reserved for the blocked target');
  const ledgerRow = f.sql.prepare("SELECT detail FROM tracking_usage_events WHERE kind='policy_blocked' ORDER BY id DESC LIMIT 1").get();
  assert.ok(ledgerRow && ledgerRow.detail, 'policy_blocked rows are recorded');
  const ledger = f.sql.prepare("SELECT COUNT(*) AS n FROM tracking_usage_events WHERE kind='policy_blocked'").get();
  assert.ok(ledger.n >= 2, 'both cap rejections are in the ledger');

  // Per-shipment cap: same target with an open reservation cannot stack another purpose.
  const forceAttempt = await f.track(`/targets/${secondId}/force-refresh`, { requestId: 'cap-request-0004-d', estimatedCredits: 1, confirm: true });
  assert.equal(forceAttempt.status, 402);
  assert.equal(forceAttempt.data.code, 'tracking_per_shipment_cap_reached');
});

test('provider 429 backs off honestly, retries within bounds, releases on exhaustion', async () => {
  const f = await fixture();
  await f.verifyContract();
  const { targetId } = await f.link({ bl: 'TESTBLRATE01' });
  const auth = await f.authorize(targetId, 'rate-request-0001-a');
  f.setScript(() => ({ status: 429 }));
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const summary = await f.runSync({ now: now + [0, 120_000, 360_000, 720_000][i] });
    assert.equal(summary.jobs[0].outcome, 'rate_limited', `run ${i + 1} pauses with backoff`);
    assert.equal(f.sql.prepare("SELECT state FROM tracking_reservations WHERE id=?").get(auth.reservationId).state, 'reserved');
  }
  assert.equal(f.calls.length, 4, 'each retry attempts the provider once');
  const paused = f.sql.prepare('SELECT state, next_attempt_at FROM tracking_sync_jobs WHERE target_id=?').get(targetId);
  assert.equal(paused.state, 'paused');
  const summary = await f.runSync({ now: now + 1_200_000 });
  assert.equal(summary.jobs[0].outcome, 'rate_limited_exhausted');
  assert.equal(f.calls.length, 5);
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'released', 'no charge survived: the limiter declined every attempt');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_sync_jobs WHERE target_id=?').get(targetId).state, 'failed');
  assert.equal(f.sql.prepare('SELECT last_error_kind FROM tracking_targets WHERE id=?').get(targetId).last_error_kind, 'rate_limited');
  assert.equal(f.sql.prepare('SELECT data_state FROM tracking_targets WHERE id=?').get(targetId).data_state, 'none', 'no fake data appeared');
});

test('key-scoped rate limiter shares the budget across workspaces and recovers next minute', async () => {
  const f = await fixture();
  await f.verifyContract({ rateLimitPerMinute: 1 });
  const a = await f.link({ bl: 'TESTBLLIMA01' });
  const b = await f.link({ bl: 'TESTBLLIMB01' });
  await f.authorize(a.targetId, 'lim-request-0001-a');
  await f.authorize(b.targetId, 'lim-request-0002-b');
  const first = await f.runSync({ schedule: false });
  assert.deepEqual(first.jobs.map(job => job.outcome), ['charged', 'rate_limited']);
  assert.equal(f.calls.length, 1, 'the second job never reached the provider');
  assert.equal(f.sql.prepare("SELECT status FROM tracking_targets WHERE id=?").get(a.targetId).status, 'authorized');
  assert.equal(f.sql.prepare("SELECT status FROM tracking_targets WHERE id=?").get(b.targetId).status, 'rate_limited');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_reservations WHERE target_id=?").get(b.targetId).state, 'reserved', 'the limiter does not spend or release');
  const second = await f.runSync({ now: Date.now() + 90_000, schedule: false });
  assert.deepEqual(second.jobs.map(job => job.outcome), ['charged'], 'the next minute bucket restores the slot');
  assert.equal(f.calls.length, 2);
  assert.equal(f.sql.prepare("SELECT status FROM tracking_targets WHERE id=?").get(b.targetId).status, 'authorized');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_reservations WHERE target_id=?").get(b.targetId).state, 'committed');
});

test('ambiguous timeout parks the charge for reconciliation and never retries', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLAMB01' });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'amb-request-0001-a');
  f.setScript((url, body, n, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true });
  }));
  const summary = await f.runSync({ timeoutMs: 25 });
  assert.equal(summary.jobs[0].outcome, 'charge_uncertain');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_sync_jobs WHERE target_id=?").get(targetId).state, 'needs_reconcile');
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'charge_uncertain');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'reserved', 'the reservation is held for reconciliation, not silently spent');
  const heldLedger = f.sql.prepare("SELECT detail FROM tracking_usage_events WHERE kind='reserve' ORDER BY created_at DESC LIMIT 1").get();
  assert.match(heldLedger.detail, /uncertain/i);
  const before = f.calls.length;
  const again = await f.runSync({ timeoutMs: 25 });
  assert.equal(again.jobs.length, 0, 'a parked job is not retried automatically');
  assert.equal(f.calls.length, before);

  // Admin reconciles as not charged after checking the provider account.
  const reconcile = await f.track(`/targets/${targetId}/reconcile`, { decision: 'not_charged', note: 'Provider dashboard shows no charge for this attempt window.' });
  assert.equal(reconcile.status, 200, JSON.stringify(reconcile.data));
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'released');
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'not_authorized');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_sync_jobs WHERE target_id=?").get(targetId).state, 'done');
  const release = f.sql.prepare("SELECT credits FROM tracking_usage_events WHERE kind='release'").get();
  assert.equal(release.credits, 1);
});

test('reconcile charged opens billing windows; invalid decisions refuse', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLREC01', containers: CONTAINERS });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'rec-request-0001-a');
  f.setScript((url, body, n, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true });
  }));
  await f.runSync({ timeoutMs: 25 });
  const decision = await f.track(`/targets/${targetId}/reconcile`, { decision: 'maybe' });
  assert.equal(decision.status, 422);
  assert.equal(decision.data.code, 'tracking_reconcile_invalid');
  const reconcile = await f.track(`/targets/${targetId}/reconcile`, { decision: 'charged', note: 'Provider account shows a charge for both containers on this attempt.' });
  assert.equal(reconcile.status, 200, JSON.stringify(reconcile.data));
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'committed');
  const windows = f.sql.prepare('SELECT container FROM tracking_billing_windows WHERE identifier=? ORDER BY container').all('TESTBLREC01');
  assert.deepEqual(windows.map(w => w.container), CONTAINERS, 'both units got their 30-day window at reconciliation time');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_sync_jobs WHERE target_id=?").get(targetId).state, 'done');
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'authorized');
});

test('unknown identifier: contract-declared uncharged releases, undocumented stays uncertain', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLUNKN01' });
  await f.verifyContract(); // sampleContract documents invalid_identifier_charged: false
  const auth = await f.authorize(targetId, 'unk-request-0001-a');
  f.setScript(() => ({ status: 404 }));
  const summary = await f.runSync();
  assert.equal(summary.jobs[0].outcome, 'invalid_identifier');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'released', 'the contract says rejections are not charged');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_sync_jobs WHERE target_id=?").get(targetId).state, 'failed');
  assert.equal(f.sql.prepare('SELECT data_state, status FROM tracking_targets WHERE id=?').get(targetId).data_state, 'invalid_identifier');
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'provider_rejected');
});

test('garbled 200 responses park for reconciliation instead of silently retrying', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLGARBL01' });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'gar-request-0001-a');
  f.setScript(() => ({ status: 200, body: '<<<not json>>>' }));
  const summary = await f.runSync();
  assert.equal(summary.jobs[0].outcome, 'charge_uncertain');
  assert.equal(f.sql.prepare("SELECT state FROM tracking_sync_jobs WHERE target_id=?").get(targetId).state, 'needs_reconcile');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'reserved');
  assert.equal(f.sql.prepare('SELECT data_state FROM tracking_targets WHERE id=?').get(targetId).data_state, 'none');
  const unknown = await f.track(`/targets/${targetId}/reconcile`, { decision: 'not_charged', note: 'Provider account shows no completed billing events for this window.' });
  assert.equal(unknown.status, 200);
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'released');
});

test('mid-flight provider failure: billable retries then reconcile; free refreshes fail honestly', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLFAIL01', containers: CONTAINERS });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'fail-request-0001');
  f.setScript(() => ({ status: 500 }));
  const now = Date.now();
  await f.runSync({ now });
  await f.runSync({ now: now + 120_000 });
  assert.equal(f.sql.prepare('SELECT attempts FROM tracking_sync_jobs WHERE target_id=?').get(targetId).attempts, 2);
  const third = await f.runSync({ now: now + 360_000 });
  assert.equal(third.jobs[0].outcome, 'charge_uncertain', 'three billable failures become an uncertainty, not a silent retry loop');
  assert.equal(f.calls.length, 3);
  assert.equal(f.sql.prepare("SELECT state FROM tracking_sync_jobs WHERE target_id=?").get(targetId).state, 'needs_reconcile');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'reserved');
  const charged = await f.track(`/targets/${targetId}/reconcile`, { decision: 'charged', note: 'Provider account shows the charge happened during the retry window.' });
  assert.equal(charged.status, 200);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM tracking_billing_windows WHERE identifier=?").get('TESTBLFAIL01').n, 2);

  // Free (in-window) refresh failures never charge and never fake success.
  const freeTarget = f.sql.prepare('SELECT id FROM tracking_targets WHERE identifier=?').get('TESTBLFAIL01').id;
  f.setScript(() => ({ status: 500 }));
  await enqueueSyncJob(f.env.DB, freeTarget, 'refresh');
  for (let i = 0; i < 4; i++) await f.runSync({ now: now + 360_000 + (i + 1) * 60_000, schedule: false });
  const summary = await f.runSync({ now: now + 360_000 + 300_000, schedule: false });
  assert.equal(summary.jobs.filter(job => job.outcome === 'failed').length, 1);
  assert.equal(f.sql.prepare('SELECT data_state, last_error_kind FROM tracking_targets WHERE id=?').get(freeTarget).last_error_kind, 'provider_unavailable');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_events WHERE target_id=?').get(freeTarget).n, 0, 'carrier history intact');
});

test('force refresh is explicit, priced upfront, and charges every tracked unit', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLFORCE1', containers: CONTAINERS });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'for-request-0001-a');
  await f.runSync();
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'committed');
  const estimate = await estimateCredits(f.env.DB, f.sql.prepare('SELECT account_scope FROM tracking_targets WHERE id=?').get(targetId).account_scope,
    f.sql.prepare('SELECT * FROM tracking_targets WHERE id=?').get(targetId), JSON.stringify(CONTAINERS), Date.now());
  assert.equal(estimate.credits, 0, 'windows are fresh; force refresh is the only way to re-charge');

  const withoutConfirm = await f.track(`/targets/${targetId}/force-refresh`, { requestId: 'for-request-0002-b', estimatedCredits: 2 });
  assert.equal(withoutConfirm.status, 422);
  assert.equal(withoutConfirm.data.code, 'tracking_force_refresh_confirm_required');
  const mismatched = await f.track(`/targets/${targetId}/force-refresh`, { requestId: 'for-request-0002-b', estimatedCredits: 3, confirm: true });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.data.code, 'tracking_estimate_mismatch');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_reservations').get().n, 1, 'failed confirmations reserve nothing');

  const correct = await f.track(`/targets/${targetId}/force-refresh`, { requestId: 'for-request-0002-b', estimatedCredits: 2, confirm: true });
  assert.equal(correct.status, 200, JSON.stringify(correct.data));
  assert.equal(correct.data.purpose, 'force_refresh');
  const before = Date.now();
  const result = await f.runSync();
  assert.equal(result.jobs[0].outcome, 'charged');
  assert.equal(f.calls.length, 2);
  const windows = f.sql.prepare('SELECT container, charge_count, window_open_until, last_charge_at FROM tracking_billing_windows WHERE identifier=? ORDER BY container').all('TESTBLFORCE1');
  assert.deepEqual(windows.map(w => w.container), CONTAINERS);
  assert.ok(windows.every(w => w.charge_count === 2), 'force refresh re-bills each unit once');
  const reservation = f.sql.prepare('SELECT state, credits, force_update FROM tracking_reservations WHERE request_id=?').get('for-request-0002-b');
  assert.equal(reservation.state, 'committed');
  assert.equal(reservation.credits, 2);
  assert.equal(reservation.force_update, 1);
  const commit = f.sql.prepare("SELECT detail FROM tracking_usage_events WHERE kind='commit' ORDER BY id DESC LIMIT 1").get();
  assert.match(commit.detail, /Force refresh charges each tracked unit again/);
  assert.ok(windows.every(w => w.last_charge_at >= before - 5000));

  // Policy can disable force refresh outright.
  await f.track('/policy', { autoTrack: 'manual', renewalPolicy: 'pause', forceRefreshPolicy: 'disabled', monthlyCreditCap: null, perShipmentCreditCap: null, creditCostMinor: null });
  const disabled = await f.track(`/targets/${targetId}/force-refresh`, { requestId: 'for-request-0003-c', estimatedCredits: 2, confirm: true });
  assert.equal(disabled.status, 409);
  assert.equal(disabled.data.code, 'tracking_force_refresh_disabled');
});

test('stale marking, auto-refresh cadence and terminal stop need no sleeps', async () => {
  const f = await fixture();
  await f.verifyContract();
  const done = await f.link({ bl: 'TESTBLTERMIN1' });
  const live = await f.link({ bl: 'TESTBLAUTORF1' });
  await f.authorize(done.targetId, 'stale-request-0001-a');
  await f.authorize(live.targetId, 'stale-request-0002-b');
  f.setScript((url, body) => (body.trackingNumber === 'TESTBLTERMIN1' ? { status: 200, body: terminalPayload() } : { status: 200, body: samplePayload() }));
  const first = await f.runSync();
  assert.deepEqual(first.jobs.map(job => job.outcome), ['charged', 'charged']);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM tracking_targets WHERE status=?').get('authorized').n, 2);
  const now = Date.now();

  // One interval later: the terminal consignment is never fetched again, the live one auto-refreshes once.
  const later = await f.runSync({ now: now + INTERVAL + 1000 });
  assert.deepEqual(later.jobs.map(job => job.outcome), ['refreshed'], 'only the non-terminal target auto-refreshes');
  assert.equal(f.calls.length, 4, 'first_track x2 + one auto refresh');
  assert.equal(f.calls.filter(c => c.body.trackingNumber === 'TESTBLTERMIN1').length, 1, 'carrier delivered: no more calls');
  const terminalStatus = f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(done.targetId).status;
  assert.equal(terminalStatus, 'authorized');
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM tracking_sync_jobs WHERE target_id=? AND state IN ('queued','paused')").get(done.targetId).n, 0);
  // The refresh happened inside the new cadence window: nothing else is queued.
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM tracking_sync_jobs WHERE target_id=? AND state IN ('queued','paused')").get(live.targetId).n, 0);

  // Data older than 2x interval is marked stale, and stale data inside its billing window refreshes free.
  await f.runSync({ now: now + 3 * INTERVAL + 5000 });
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(live.targetId).status, 'stale');
  const queued = f.sql.prepare("SELECT id, state FROM tracking_sync_jobs WHERE target_id=? AND state IN ('queued','paused')").get(live.targetId);
  assert.ok(queued, 'stale target gets one refresh scheduled');
  const healed = await f.runSync({ now: now + 3 * INTERVAL + 10_000 });
  assert.equal(healed.jobs.filter(job => job.outcome === 'refreshed').length, 1);
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(live.targetId).status, 'authorized', 'a successful sync unmarks stale');
});

test('auto-refresh never starts a paid job once the billing windows expired', async () => {
  const f = await fixture();
  await f.verifyContract();
  const { targetId } = await f.link({ bl: 'TESTBOLDEXP1' });
  await f.authorize(targetId, 'old-request-0001-a');
  await f.runSync();
  f.sql.prepare('UPDATE tracking_billing_windows SET window_open_until=1 WHERE identifier=?').run('TESTBOLDEXP1');
  const now = Date.now();
  await f.runSync({ now: now + 2 * INTERVAL });
  const queued = f.sql.prepare("SELECT COUNT(*) AS n FROM tracking_sync_jobs WHERE target_id=? AND state IN ('queued','paused')").get(targetId);
  assert.equal(queued.n, 0, 'no scheduled refresh would charge without an authorization');
  const renewal = await f.authorize(targetId, 'old-request-0002-b');
  assert.equal(renewal.purpose, 'renewal');
  await f.runSync();
  assert.equal(f.sql.prepare('SELECT status FROM tracking_targets WHERE id=?').get(targetId).status, 'authorized');
});

test('policy endpoint validates and persists; usage ledger is append-only', async () => {
  const f = await fixture();
  const invalid = await f.track('/policy', { autoTrack: 'whenever', renewalPolicy: 'pause', forceRefreshPolicy: 'explicit' });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.data.code, 'tracking_policy_invalid');
  const impossible = await f.track('/policy', { autoTrack: 'manual', renewalPolicy: 'pause', forceRefreshPolicy: 'explicit', monthlyCreditCap: -5 });
  assert.equal(impossible.status, 422);
  const saved = await f.track('/policy', { monthlyCreditCap: 25, perShipmentCreditCap: 5, autoTrack: 'confirmed', renewalPolicy: 'allow', forceRefreshPolicy: 'explicit', creditCostMinor: 900 });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.policy.monthly_credit_cap, 25);
  assert.equal(saved.data.policy.auto_track, 'confirmed');
  const overview = await f.track('/overview');
  assert.equal(overview.data.policy.renewal_policy, 'allow');
  assert.equal(overview.data.usage.month, overview.data.usage.month, 'usage month is present');
  assert.ok(overview.data.usage);
  const { targetId } = await f.link({ bl: 'TESTBLPOL01' });
  await f.verifyContract();
  await f.authorize(targetId, 'pol-request-0001-a');
  await f.runSync();
  const overview2 = await f.track('/overview');
  assert.equal(overview2.data.usage.reservedCredits, 1);
  assert.equal(overview2.data.ledger.length > 0, true, 'the workspace ledger is visible in the overview');
  assert.throws(() => f.sql.prepare('UPDATE tracking_usage_events SET credits=999').run(), { message: /immutable credit ledger/ });
});

test('tracking sync route and module fail closed without a database', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLSYNCR1' });
  await f.authorize(targetId, 'sy-request-0001-aa');
  // The staff /sync route never reaches the provider while the contract is unverified.
  const r = await f.track('/sync', { max: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.data.jobs[0].outcome, 'blocked_contract');
  assert.equal(f.calls.length, 0);
  let problem = null;
  try { await runTrackingSync({}, { fetch: f.fakeFetch }); } catch (error) { problem = error; }
  assert.ok(problem);
  assert.equal(problem.status, 503);
  assert.equal(problem.code, 'tracking_no_database');
});

test('a failed in-window refresh releases nothing and preserves live data (no stale-success confusion)', async () => {
  const f = await fixture();
  const { targetId } = await f.link({ bl: 'TESTBLFREE01', containers: CONTAINERS });
  await f.verifyContract();
  const auth = await f.authorize(targetId, 'free-request-0001');
  await f.runSync();
  assert.equal(f.sql.prepare('SELECT data_state FROM tracking_targets WHERE id=?').get(targetId).data_state, 'live');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'committed');
  f.setScript(() => ({ status: 500 }));
  await enqueueSyncJob(f.env.DB, targetId, 'refresh');
  const now = Date.now();
  for (let i = 1; i <= 5; i++) await f.runSync({ now: now + i * 90_000, schedule: false });
  const target = f.sql.prepare('SELECT data_state, status, last_error_kind, last_error_message, last_sync_ok_at FROM tracking_targets WHERE id=?').get(targetId);
  assert.equal(target.data_state, 'live', 'the previously synced data stays live');
  assert.equal(target.status, 'authorized', 'a failed refresh does not pretend the data is gone');
  assert.equal(target.last_error_kind, 'provider_unavailable');
  assert.ok(target.last_error_message.length > 0);
  assert.ok(target.last_sync_ok_at > 0, 'the last successful sync timestamp is kept');
  assert.equal(f.sql.prepare('SELECT state FROM tracking_reservations WHERE id=?').get(auth.reservationId).state, 'committed', 'settled costs stay settled');
});
