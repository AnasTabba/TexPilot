/** Migration rehearsal for drizzle/0006_tracking.sql (0004/0005 discipline).
 *
 * 1. baseline DB from migrations 0000–0005, row counts per table
 * 2. apply 0006 and verify only additive changes (no baseline table row changed)
 * 3. PRAGMA foreign_key_check stays clean
 * 4. canonical write paths through the real tracking modules touch every new table
 *
 * Run: node scripts/migration-rehearse-0006.mjs   (exits non-zero on any failure)
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, sha256, PERMISSIONS } from '../server/auth.mjs';
import { trackingApi } from '../server/tracking.mjs';
import { runTrackingSync } from '../server/tracking-budget.mjs';

const trackingTables = ['tracking_webhook_receipts', 'tracking_rate_slots', 'tracking_events', 'tracking_sync_jobs',
  'tracking_usage_events', 'tracking_reservations', 'tracking_policies', 'tracking_billing_windows',
  'tracking_accounts', 'tracking_target_links', 'tracking_targets'];

const tables = async db => (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sqlite_sequence%'`).all()).map(row => row.name);
const counts = async db => {
  const list = await tables(db);
  const out = {};
  for (const table of list.sort()) out[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return out;
};

const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const dir = new URL('../drizzle/', import.meta.url);
const migrations = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const baseline = migrations.filter(f => f !== '0006_tracking.sql');
for (const file of baseline) sql.exec(readFileSync(new URL(file, dir), 'utf8'));
const before = await counts(sql);
console.log(`baseline migrations applied (${baseline.join(', ')}): ${Object.keys(before).length} tables, ${Object.values(before).reduce((a, b) => a + b, 0)} rows`);

// No pre-seeded rows anywhere: 0006 must start from the shipped baseline.
sql.exec(readFileSync(new URL('0006_tracking.sql', dir), 'utf8'));
const after = await counts(sql);
for (const [table, n] of Object.entries(before)) {
  assert.equal(after[table] ?? null, n, `${table} row count changed during 0006 (baseline ${n})`);
  console.log(`after 0006, ${table}: ${after[table]} rows (unchanged)`);
}
for (const table of trackingTables) {
  assert.ok(table in after, `tracking table ${table} missing after 0006`);
  assert.equal(after[table], 0, `${table} must start empty`);
  console.log(`after 0006, ${table}: exists, ${after[table]} rows`);
}

const fkCheck = sql.prepare('PRAGMA foreign_key_check').all();
assert.deepEqual(fkCheck, [], 'foreign_key_check must return no violations after baseline + 0006');
console.log('PRAGMA foreign_key_check: clean');

// Canonical write paths: seed auth rows, then exercise the real tracking modules end to end.
for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
const origin = 'https://yarnflow.test';
const KEY = 'datalooplabs-rehearsal-credential-00ffee11';
const env = { DB: sqliteBinding(sql), DATALOOPLABS_API_KEY: KEY };
async function call(module, route, member, data) {
  const path = '/api' + route;
  const response = await module(new Request(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(data === undefined ? {} : { body: JSON.stringify(data) }) },
  }), env, member, path, data === undefined ? null : data);
  return { status: response.status, body: await response.json() };
}
const adminRow = sql.prepare(`SELECT id, workspace_id, name FROM users WHERE name_key='anas' ORDER BY created_at DESC LIMIT 1`).get();
assert.ok(adminRow, 'seeded admin user found');
const admin = { user_id: adminRow.id, workspace_id: adminRow.workspace_id, name: adminRow.name, role: 'owner', admin: true, permissions: PERMISSIONS };

const account = await call(trackingApi, '/erp/tracking/account', admin, {
  baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track',
  contract: JSON.stringify({
    request: { number: 'trackingNumber', type: 'type', force: 'force_update', carrier: 'carrier', types: { bol: 'BL', booking: 'BOOKING', container: 'CNTR' } },
    response: { containers: 'containers', containerNumber: 'number', events: 'events', event: { time: 'eventTime', code: 'statusCode', title: 'statusDescription', location: 'location' }, reference: 'referenceNumber', dataTimestamp: 'lastUpdated', terminalCodes: ['DELIVERED'] },
    chargeSemantics: { invalid_identifier_charged: false },
  }),
  contractNote: 'Rehearsal contract from the account documentation placeholder', renewalDays: 30, rateLimitPerMinute: 60, verifyContract: true,
});
assert.equal(account.status, 200, JSON.stringify(account.body));
assert.equal(account.body.ready.contract, true, JSON.stringify(account.body.ready));
console.log('tracking_accounts written through POST /api/erp/tracking/account (verified contract)');

const targetId = crypto.randomUUID();
const created = await call(trackingApi, '/erp/tracking/targets', admin,
  { id: targetId, identifierType: 'bol', identifier: 'REHEARSALBL01', carrier: 'Test Line', requestId: 'rehearsal-auth-0001', authorize: true });
assert.equal(created.status, 201, JSON.stringify(created.body));
assert.ok(created.body.target, 'target detail returned');
assert.ok(created.body.authorization?.reservationId, 'authorize created a reservation');
console.log('tracking_targets + tracking_target_links + tracking_reservations + tracking_usage_events + tracking_sync_jobs written through POST /targets');

const calls = [];
const summary = await runTrackingSync(env, { fetch: async (url, init) => {
  calls.push({ url: String(url), body: JSON.parse(init.body) });
  return { status: 200, json: async () => ({
    referenceNumber: 'REF-RH-1',
    lastUpdated: '2026-10-26T10:00:00Z',
    containers: [{ number: 'ABCD1234567' }],
    events: [{ eventTime: '2026-10-01T09:00:00Z', statusCode: 'GATE_IN', statusDescription: 'Container received at origin port', location: 'Port Klang' }],
  }) };
}, maxJobs: 5 });
assert.equal(summary.jobs.length, 1, JSON.stringify(summary));
assert.equal(summary.jobs[0].outcome, 'charged', JSON.stringify(summary));
console.log(`tracking_billing_windows + tracking_events + tracking_rate_slots written through runTrackingSync (${calls.length} provider call)`);

const policy = await call(trackingApi, '/erp/tracking/policy', admin,
  { monthlyCreditCap: 50, perShipmentCreditCap: 10, autoTrack: 'manual', renewalPolicy: 'pause', forceRefreshPolicy: 'explicit', creditCostMinor: null });
assert.equal(policy.status, 200, JSON.stringify(policy.body));
console.log('tracking_policies written through POST /api/erp/tracking/policy');

const detail = await call(trackingApi, `/erp/tracking/targets/${targetId}`, admin);
assert.equal(detail.status, 200, JSON.stringify(detail.body));
assert.equal(detail.body.target.data_state, 'live');
assert.equal(detail.body.target.status, 'authorized');
assert.equal(detail.body.target.events.length, 1, 'provider event ingested once');

// Webhook receipts have no live ingest path yet by design; the canonical DDL shape is rehearsed directly.
sql.prepare(`INSERT INTO tracking_webhook_receipts(id,provider,receipt_key,signature_state,payload_digest,received_at)
  VALUES(?,?,?,?,?,?)`).run(crypto.randomUUID(), 'datalooplabs', 'rehearsal-receipt-1', 'manual_review', 'digest', Date.now());

const finalCounts = await counts(sql);
for (const table of trackingTables) {
  assert.ok(finalCounts[table] > 0, `${table} must have at least one row after the canonical write paths`);
  console.log(`${table}: ${finalCounts[table]} row(s) written through canonical paths`);
}
const fkAfterPaths = sql.prepare('PRAGMA foreign_key_check').all();
assert.deepEqual(fkAfterPaths, [], 'foreign_key_check stays clean after canonical writes');
console.log('PRAGMA foreign_key_check after canonical writes: clean');
console.log('MIGRATION REHEARSAL 0006: PASS');
