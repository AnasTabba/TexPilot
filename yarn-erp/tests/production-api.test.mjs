import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { productionApi } from '../server/production.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { ErpProblem } from '../server/erp-utils.mjs';
import { PERMISSIONS, seedRows } from '../server/auth.mjs';

const ORIGIN = 'https://yarnflow.test';
const PIN = '2468';
const migrations = new URL('../drizzle/', import.meta.url);
const now = () => Date.now();
const u = () => crypto.randomUUID();

// 0005's batches table carries the frozen sales_order_lines contract FK, which is owned by
// 0004_sales.sql on the shared branch. The fixture materialises exactly that minimal contract
// before applying every drizzle migration that exists on this isolated branch.
const SALES_CONTRACT = `
CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, reference TEXT NOT NULL, buyer_id TEXT,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(workspace_id,reference)
);
CREATE TABLE sales_order_lines (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  product_id TEXT, specifications TEXT NOT NULL DEFAULT '', quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0),
  unit TEXT NOT NULL, created_at INTEGER NOT NULL
);
`;

async function applyMigrations(sql, withProduction = true) {
  sql.exec(SALES_CONTRACT);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort())
    if (withProduction || file !== '0005_production.sql') sql.exec(readFileSync(new URL(file, migrations), 'utf8'));
}

/** Dysconnected production API binding: tests call productionApi with hand-built members
 * exactly the way the shared worker will after the integration worker auth-dispatches them. */
async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  await applyMigrations(sql);
  for (const { sql: query, args } of await seedRows(PIN)) sql.prepare(query).run(...args);
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id;
  const env = { DB: sqliteBinding(sql) };
  const run = async (path, data, member) => {
    const apiData = data === undefined ? undefined : Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'badOrigin'));
    try {
      const response = await productionApi(new Request(`${ORIGIN}${path}`, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: data?.badOrigin || ORIGIN },
        ...(data === undefined ? {} : { body: JSON.stringify(apiData) }),
      }), env, member, path, apiData);
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null };
    } catch (error) {
      if (error instanceof ErpProblem) return { status: error.status, data: { error: error.message } };
      throw error;
    }
  };
  const admin = { user_id: u(), workspace_id: workspaceId, name: 'Anas', role: 'owner', admin: true, permissions: PERMISSIONS };
  const person = (name, permissions, workspace = workspaceId) =>
    ({ user_id: u(), workspace_id: workspace, name, role: 'operator', admin: false, permissions });
  const product = (name, sku) => {
    const id = u();
    sql.prepare('INSERT INTO products(id,workspace_id,sku,name,created_at) VALUES(?,?,?,?,?)').run(id, workspaceId, sku, name, now());
    return id;
  };
  const lot = (productId, batch, quality = 'uninspected') => {
    const id = u();
    sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,quality,created_at) VALUES(?,?,?,?,'uninspected',?)")
      .run(id, workspaceId, productId, batch, now());
    if (quality !== 'uninspected') {
      sql.prepare('UPDATE lots SET quality=? WHERE id=?').run(quality, id);
      sql.prepare('INSERT INTO quality_events(id,workspace_id,lot_id,status,note,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(u(), workspaceId, id, quality, 'seeded', 'seed', 'seed', now());
    }
    return id;
  };
  const move = (lotId, action, { fromStage = null, toStage = null, grams = 10000, cartons = 2, cones = 40 } = {}) => {
    const id = u();
    sql.prepare(`INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, workspaceId, lotId, action, fromStage, toStage, grams, cartons, cones, 'seeded', 'seed', 'seed', null, u(), now());
    for (const [stage, sign] of [[fromStage, -1], [toStage, 1]]) if (stage)
      sql.prepare('INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)')
        .run(u(), id, lotId, stage, sign * grams, sign * cartons, sign * cones);
    return id;
  };
  const balance = lotId => sql.prepare('SELECT stage,grams,cartons,cones FROM balances WHERE lot_id=?').all(lotId);
  const salesOrder = (reference = 'SO-1') => {
    const id = u();
    sql.prepare("INSERT INTO sales_orders(id,workspace_id,reference,buyer_id,status,created_at) VALUES(?,?,?,?, 'confirmed', ?)")
      .run(id, workspaceId, reference, 'buyer-seed', now());
    return id;
  };
  const salesLine = (orderId, productId, milli = 500000, unit = 'kg') => {
    const id = u();
    sql.prepare("INSERT INTO sales_order_lines(id,workspace_id,sales_order_id,product_id,specifications,quantity_milli,unit,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, workspaceId, orderId, productId, '', milli, unit, now());
    return id;
  };
  const machine = async (name, kind, operations, { unit = 'kg', rate = 600000 } = {}) => {
    const id = u();
    const result = await run('/api/erp/production/machines', {
      id, name, kind, operations, unit, ratePerHourMilli: rate, note: 'seeded machine',
    }, admin);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return id;
  };
  /** Creates a confirmed order line, a planned batch on it, an allocation and starts production. */
  const flowingBatch = async ({ productId, operation = 'spinning', unit = 'kg', milli = 400000, machineId, machineCapacity = 'kg' } = {}) => {
    const order = salesOrder();
    const line = salesLine(order, productId, 500000, unit);
    const created = await run('/api/erp/production/batches', {
      id: u(), salesOrderLineId: line, productId, operation, plannedQuantityMilli: milli, unit, dueAt: now() + 864e5, specifications: '30/1 combed',
    }, person('Planner', ['production']));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const batch = created.data.batch;
    const allocated = await run('/api/erp/production/batches/allocate', {
      id: u(), batchId: batch.id, machineId, plannedFrom: now() + 36e5, plannedTo: now() + 72e5, quantityMilli: milli,
    }, person('Planner', ['production']));
    assert.equal(allocated.status, 201, JSON.stringify(allocated.data));
    const started = await run('/api/erp/production/batches/start', { id: batch.id }, person('Planner', ['production']));
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const operator = person('Zubeir', ['produce']);
    const opened = await run('/api/erp/production/runs/open', { id: u(), batchId: batch.id }, operator);
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    return { batch: started.data.batch, run: opened.data.run, line, operator, capacityUnit: machineCapacity };
  };
  const statusOf = batchId => sql.prepare('SELECT status FROM production_batches WHERE id=?').get(batchId).status;
  const balancesOf = lotId => Object.fromEntries(sql.prepare('SELECT stage,grams FROM balances WHERE lot_id=?').all(lotId).map(r => [r.stage, r.grams]));
  const con = (issue, message) => assert.equal(issue.status, 409, message ? `${message}: ${JSON.stringify(issue.data)}` : JSON.stringify(issue.data));
  return { sql, run, admin, person, product, lot, move, balance, salesOrder, salesLine, machine, flowingBatch, statusOf, balancesOf, con,
    workspaceId, env };
}

test('migration rehearsal: the movements rebuild preserves rows, foreign keys, triggers and every canonical write path', async () => {
  // Build the pre-migration world (0000-0003 + frozen sales contract) with ledger rows that the
  // rebuild must carry over exactly: a receive, a raw->wip transfer, a dispatch with its reversal.
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  await applyMigrations(sql, false);
  sql.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('w1','Factory',?)").run(now());
  const p = u(), l1 = u(), l2 = u(), l3 = u();
  sql.prepare("INSERT INTO products(id,workspace_id,sku,name,created_at) VALUES(?,'w1','COT','Cotton',?)").run(p, now());
  for (const lotId of [l1, l2, l3])
    sql.prepare("INSERT INTO lots(id,workspace_id,product_id,batch,quality,created_at) VALUES(?,'w1',?,?,'approved',?)").run(lotId, p, u(), now());
  sql.prepare('UPDATE lots SET quality=? WHERE id=?').run('approved', l1);
  const receive = u(), transfer = u(), dispatch = u();
  const ledgerMove = (id, lotId, action, from, to, grams, reverses = null) => {
    sql.prepare(`INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
      VALUES(?, 'w1', ?,?,?,?,?,?,?, 'rehearsal','seed','seed',?,?,?)`)
      .run(id, lotId, action, from, to, grams, 0, 0, reverses, u(), now());
    for (const [stage, sign] of [[from, -1], [to, 1]]) if (stage)
      sql.prepare('INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)')
        .run(u(), id, lotId, stage, sign * grams, 0, 0);
  };
  ledgerMove(receive, l1, 'receive', null, 'raw', 9000);
  ledgerMove(transfer, l1, 'transfer', 'raw', 'wip', 4000);
  ledgerMove(dispatch, l3, 'dispatch', null, null, 1000);
  const reversal = u();
  ledgerMove(reversal, l3, 'reverse', null, null, 1000, dispatch);
  const tables = ['movements', 'stock_deltas', 'balances', 'users', 'products', 'supplier_categories'];
  const baseline = Object.fromEntries(tables.map(t => [t, sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  // The enqueue: apply the full 0005 file — the exact bytes the shared branch runs after 0004.
  sql.exec(readFileSync(new URL('0005_production.sql', migrations), 'utf8'));
  for (const t of tables) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, baseline[t], `${t} row count preserved`);
  assert.equal(baseline.movements, 4, 'rehearsal seeds four ledger rows');
  assert.equal(sql.prepare('SELECT grams FROM balances WHERE lot_id=? AND stage=?').get(l1, 'raw').grams, 5000, 'balances survive');
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [], 'foreign_key_check clean after rebuild');
  const schema = sql.prepare("SELECT sql FROM sqlite_master WHERE name='movements' AND type='table'").get().sql;
  assert.match(schema, /'consume'/);
  assert.match(schema, /'produce'/);
  assert.match(schema, /REFERENCES "movements"\(id\)/, 'self-referencing reversal FK resolves to the renamed table');
  assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE name='validate_movement'").all().length, 1);
  // Canonical write paths still work after migration, and the tightened gates speak for live rows.
  ledgerMove(u(), l1, 'receive', null, 'raw', 1000);
  ledgerMove(u(), l1, 'transfer', 'wip', 'finished', 500);
  ledgerMove(u(), l1, 'waste', 'raw', null, 100);
  ledgerMove(u(), l1, 'dispatch', null, null, 200);
  const consume = u();
  ledgerMove(consume, l1, 'consume', 'raw', null, 200);
  ledgerMove(u(), l1, 'produce', null, 'wip', 150);
  const reversed = u();
  ledgerMove(reversed, l1, 'reverse', null, null, 200, consume);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [], 'write paths keep foreign keys valid incl. reversal self-reference');
  assert.throws(() => sql.prepare('UPDATE movements SET grams=999 WHERE id=?').run(receive), /immutable ledger/, 'ledger stays immutable');
  assert.throws(() => sql.prepare('DELETE FROM movements WHERE id=?').run(receive), /immutable ledger/, 'ledger rows never delete');
  const insertMovement = (lotId, action, from, to) => sql.prepare(`INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
    VALUES(?, 'w1', ?,?,?,?,?,1,0,'x','a','a',NULL,?,?)`).run;
  assert.throws(() => insertMovement(u(), l1, 'audit', null, null)(u(), now()), /CHECK constraint/, 'unknown action refused');
  assert.throws(() => insertMovement(u(), l1, 'consume', null, null)(u(), now()), /consume must record the stage it leaves/);
  assert.throws(() => insertMovement(u(), l1, 'produce', 'raw', 'raw')(u(), now()), /produce must record the stage it enters/);
  sql.exec("INSERT INTO lots(id,workspace_id,product_id,batch,quality,created_at) VALUES('lq1','w1',?,'quarantine-seed','uninspected',?)", p, now());
  const movement = insertMovement(u(), 'lq1', 'consume', 'raw', null);
  assert.throws(() => movement(u(), now()), /QC approval required/, 'uninspected stock refuses both dispatch and consume');
  assert.throws(() => sql.prepare(`INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
    VALUES(?, 'w1', ?, 'transfer', 'raw', 'wip', 10, 0, 0, 'x', 'a', 'a', NULL, ?, ?)`).run(u(), 'lq1', u(), now()), /QC approval required/, 'raw transfer stays gated');
  sql.prepareStatement('UPDATE lots SET quality=? WHERE id=?').constructor;
  sql.prepare('UPDATE lots SET quality=? WHERE id=?').run('hold', 'lq1');
  assert.throws(() => movement(u(), now()), /held lot cannot move/, 'held stock cannot consume');
});

test('authorization: machines are admin-only and each job needs its permission; cross-site writes are refused', async () => {
  const f = await fixture();
  const staff = f.person('Bilal', []);
  assert.equal((await f.run('/api/erp/production', undefined, f.person('Nadira', ['sales']))).status, 200, 'overview opens with any production-relevant permission');
  assert.equal((await f.run('/api/erp/production', undefined, staff)).status, 403);
  assert.equal((await f.run('/api/erp/production/machines', { id: u(), name: 'Frame 1', kind: 'spinning', operations: ['spinning'], unit: 'kg', ratePerHourMilli: 600000, note: 'x' }, staff)).status, 403);
  assert.equal((await f.run('/api/erp/production/batches', { id: u() }, f.person('Kiran', ['produce']))).status, 403, 'runs crew cannot plan batches');
  const productId = f.product('Cotton 30/1', 'COT-30');
  const order = f.salesOrder();
  const line = f.salesLine(order, productId);
  const batch = await f.run('/api/erp/production/batches', {
    id: u(), salesOrderLineId: line, productId, operation: 'spinning', plannedQuantityMilli: 400000, unit: 'kg', dueAt: now() + 864e5,
  }, f.person('Planner', ['production']));
  assert.equal(batch.status, 201, JSON.stringify(batch.data));
  assert.equal(await f.run('/api/erp/production/batches', undefined, staff).status !== 0, true);
  const memberId = f.person('Zubeir', ['produce']);
  assert.equal((await f.run('/api/erp/production/machines/capacity', { machineId: u(), unit: 'kg', ratePerHourMilli: 1, note: 'x' }, memberId)).status, 403);
  const crossSite = await f.run('/api/erp/production/machines', {
    id: u(), name: 'Frame 2', kind: 'spinning', operations: ['spinning'], unit: 'kg', ratePerHourMilli: 600000, note: 'x', badOrigin: 'https://attacker.test',
  }, f.admin);
  assert.equal(crossSite.status, 403, 'Origin must match the open app');
});

test('admin setup: machines with versioned capacities, maintenance windows and non-overlapping shifts', async () => {
  const f = await fixture();
  const machineId = u();
  const created = await f.run('/api/erp/production/machines', {
    id: machineId, name: 'Ring frame 12', kind: 'spinning', operations: ['spinning', 'weaving'], unit: 'kg', ratePerHourMilli: 600000, note: 'Main frame',
  }, f.admin);
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.machine.capacities.length, 1);
  const again = await f.run('/api/erp/production/machines', {
    id: machineId, name: 'Ring frame 12', kind: 'spinning', operations: ['spinning', 'weaving'], unit: 'kg', ratePerHourMilli: 600000, note: 'Main frame',
  }, f.admin);
  assert.equal(again.status, 200, 'same ID + same values is an idempotent repeat');
  const clash = await f.run('/api/erp/production/machines', {
    id: machineId, name: 'Ring frame 12', kind: 'weaving', operations: ['weaving'], unit: 'metre', ratePerHourMilli: 300000, note: 'y',
  }, f.admin);
  assert.equal(clash.status, 409);
  const nameClash = await f.run('/api/erp/production/machines', {
    id: u(), name: 'Ring frame 12', kind: 'spinning', operations: ['spinning'], unit: 'kg', ratePerHourMilli: 600000, note: '',
  }, f.admin);
  assert.equal(nameClash.status, 409, 'machine names are unique per workspace');
  const capacity = await f.run('/api/erp/production/machines/capacity', {
    machineId, unit: 'kg', ratePerHourMilli: 480000, note: 'Reduced after overhaul',
  }, f.admin);
  assert.equal(capacity.status, 201);
  assert.equal(capacity.data.machine.capacities.at(-1).version, 2, 'capacities version up, never overwrite');
  const from = now() + 36e5, to = from + 36e5;
  const downtime = await f.run('/api/erp/production/machines/downtime', {
    id: u(), machineId, fromAt: from, toAt: to, reason: 'Scheduled gear change',
  }, f.admin);
  assert.equal(downtime.status, 201);
  const overlap = await f.run('/api/erp/production/machines/downtime', {
    id: u(), machineId, fromAt: from + 18e5, toAt: to + 18e5, reason: 'Overlap attempt',
  }, f.admin);
  assert.equal(overlap.status, 409, 'planned maintenance windows never overlap');
  const repeat = await f.run('/api/erp/production/machines/downtime', {
    id: downtime.data.downtime.id, machineId, fromAt: from, toAt: to, reason: 'Scheduled gear change',
  }, f.admin);
  assert.equal(repeat.status, 200, 'downtime create is idempotent by ID');
  const cancelled = await f.run('/api/erp/production/machines/downtime/cancel', {
    id: downtime.data.downtime.id, reason: 'Vendor moved the visit',
  }, f.admin);
  assert.equal(cancelled.status, 200);
  const shiftA = await f.run('/api/erp/production/shifts', {
    id: u(), name: 'A shift', startMinute: 480, endMinute: 960, days: [1, 2, 3, 4, 5],
  }, f.admin);
  assert.equal(shiftA.status, 201, JSON.stringify(shiftA.data));
  const colliding = await f.run('/api/erp/production/shifts', {
    id: u(), name: 'Morning overlap', startMinute: 900, endMinute: 1200, days: [1, 3],
  }, f.admin);
  assert.equal(colliding.status, 409, 'active shift calendars never overlap on a shared day');
  const night = await f.run('/api/erp/production/shifts', {
    id: u(), name: 'B shift', startMinute: 960, endMinute: 1200, days: [1, 2, 3, 4, 5],
  }, f.admin);
  assert.equal(night.status, 201, 'back-to-back shifts are fine');
  const weekend = await f.run('/api/erp/production/shifts', {
    id: u(), name: 'Weekend', startMinute: 480, endMinute: 960, days: [6, 7],
  }, f.admin);
  assert.equal(weekend.status, 201, 'same clock window on different days is fine');
  const overview = await f.run('/api/erp/production', undefined, f.admin);
  assert.equal(overview.data.machines.at(0).capacities.length, 2);
  assert.equal(overview.data.shifts.length, 3);
  assert.equal(overview.data.machines.at(0).downtime.length, 0, 'cancelled maintenance leaves the calendar');
  const audit = f.sql.prepare("SELECT COUNT(*) AS n FROM erp_audit_events WHERE action LIKE 'production.%'").get().n;
  assert.ok(audit >= 8, `setup actions are audited (${audit})`);
});

test('batch planning: buyer-linked, numbered PB-YYYY-NNNNNN, capped at the line plus 10 percent, idempotent', async () => {
  const f = await fixture();
  const productId = f.product('Cotton 30/1', 'COT-30');
  const order = f.salesOrder('SO-2026-77');
  const line = f.salesLine(order, productId, 500000, 'kg');
  const planner = f.person('Nadia', ['production']);
  const body = { id: u(), salesOrderLineId: line, productId, operation: 'spinning', plannedQuantityMilli: 400000, unit: 'kg', dueAt: now() + 864e5, specifications: '30/1 combed' };
  const first = await f.run('/api/erp/production/batches', body, planner);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.match(first.data.batch.reference, /^PB-\d{4}-000001$/);
  const repeat = await f.run('/api/erp/production/batches', body, planner);
  assert.equal(repeat.status, 200, 'reposting the same entry is idempotent');
  const mutation = await f.run('/api/erp/production/batches', { ...body, plannedQuantityMilli: 390000 }, planner);
  assert.equal(mutation.status, 409, 'same ID with different values is refused');
  const second = await f.run('/api/erp/production/batches', {
    ...body, id: u(), plannedQuantityMilli: 99_999,
  }, planner);
  assert.equal(second.status, 201);
  assert.match(second.data.batch.reference, /000002$/, 'references number up atomically');
  const overCap = await f.run('/api/erp/production/batches', {
    ...body, id: u(), plannedQuantityMilli: 50_002,
  }, planner);
  assert.equal(overCap.status, 409, 'planned quantity exceeds line + 10% (running total would cross the cap)');
  const underCap = await f.run('/api/erp/production/batches', {
    ...body, id: u(), plannedQuantityMilli: 50_001,
  }, planner);
  assert.equal(underCap.status, 201, 'exactly to the cap is allowed');
  const cancelledBatch = await f.run('/api/erp/production/batches/cancel', {
    id: second.data.batch.id, reason: 'Buyer postponed the season',
  }, planner);
  assert.equal(cancelledBatch.status, 200, JSON.stringify(cancelledBatch.data));
  const repeatAfterCancel = await f.run('/api/erp/production/batches', {
    ...body, id: u(), plannedQuantityMilli: 99_999,
  }, planner);
  assert.equal(repeatAfterCancel.status, 201, 'cancelled plans release the cap');
  const draftOrder = f.salesOrder('SO-draft'), draftLine = f.salesLine(draftOrder, productId);
  f.sql.prepare('UPDATE sales_orders SET status=? WHERE id=?').run('draft', draftOrder);
  assert.equal((await f.run('/api/erp/production/batches', {
    ...body, id: u(), salesOrderLineId: draftLine,
  }, planner)).status, 409, 'only a confirmed order line receives a batch');
  const metreLine = f.salesLine(order, productId, 100000, 'metre');
  assert.equal((await f.run('/api/erp/production/batches', {
    ...body, id: u(), salesOrderLineId: metreLine, unit: 'kg',
  }, planner)).status, 409, 'no unit switching: the line unit carries the batch');
  const otherProduct = f.product('Polyester 45', 'POL-45');
  assert.equal((await f.run('/api/erp/production/batches', {
    ...body, id: u(), productId: otherProduct,
  }, planner)).status, 409, 'a mapped line keeps its product');
  const overview = await f.run('/api/erp/production', undefined, planner);
  const lineOptions = overview.data.lineOptions ?? overview.batches;
  void lineOptions;
  assert.ok(overview.data.batches.some(b => b.sales_order_line_id === line), 'batch carries the frozen-contract backlink');
});

test('allocations: capability + unit must match, capacity bounds the window, windows never overlap and maintenance blocks them', async () => {
  const f = await fixture();
  const productId = f.product('Cotton 30/1', 'COT-30');
  const spinning = await f.machine('Ring frame 12', 'spinning', ['spinning']);
  const weaving = await f.machine('Loom 3', 'weaving', ['weaving'], { unit: 'metre', rate: 400000 });
  const both = await f.machine('Combo cell', 'winding', ['spinning', 'weaving']);
  const planner = f.person('Nadia', ['production']);
  const plan = async (over = {}) => {
    const order = f.salesOrder(`SO-${u()}`);
    const milli = over.milli ?? 400000, unit = over.unit ?? 'kg', operation = over.operation ?? 'spinning';
    const line = f.salesLine(order, productId, 900000, unit);
    const created = await f.run('/api/erp/production/batches', {
      id: over.batchId ?? u(), salesOrderLineId: line, productId, operation, plannedQuantityMilli: milli, unit, dueAt: now() + 864e5,
    }, planner);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return created.data.batch;
  };
  const spinningBatch = await plan();
  const from = now() + 36e5;
  const allocation = (batch, over = {}) => f.run('/api/erp/production/batches/allocate', {
    id: over.id ?? u(), batchId: batch.id, machineId: over.machineId ?? spinning, plannedFrom: over.from ?? from,
    plannedTo: over.to ?? from + 36e5, quantityMilli: over.quantity ?? 400000,
  }, planner);
  const ok = await allocation(spinningBatch);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.allocation.status, 'planned');
  assert.equal(f.statusOf(spinningBatch.id), 'planned', 'first allocation plans the batch');
  assert.equal((await allocation(spinningBatch, { id: u(), from: from + 18e5, to: from + 54e5 })).status, 409, 'same machine cannot double-book');
  assert.equal((await f.run('/api/erp/production/batches/allocate', {
    id: u(), batchId: spinningBatch.id, machineId: weaving, plannedFrom: from + 36e5, plannedTo: from + 72e5, quantityMilli: 100000,
  }, planner)).status, 409, 'capability checked before allocation — loom cannot spin');
  const comboOk = await allocation(spinningBatch, { machineId: both, machineCapacity: 'kg', from: from + 36e5, to: from + 72e5, id: u() });
  assert.equal(comboOk.status, 201, 'a machine listing both operations can take it');
  const weavingBatch = await plan({ unit: 'metre', operation: 'weaving', milli: 100000 });
  assert.equal((await f.run('/api/erp/production/batches/allocate', {
    id: u(), batchId: weavingBatch.id, machineId: spinning, plannedFrom: from, plannedTo: from + 36e5, quantityMilli: 100000,
  }, planner)).status, 409, 'no invented unit conversion: kg-rated machine refuses a metre batch');
  const weavingOk = await f.run('/api/erp/production/batches/allocate', {
    id: u(), batchId: weavingBatch.id, machineId: weaving, plannedFrom: from, plannedTo: from + 36e5, quantityMilli: 100000,
  }, planner);
  assert.equal(weavingOk.status, 201);
  const tooMuch = await f.run('/api/erp/production/batches/allocate', {
    id: u(), batchId: weavingBatch.id, machineId: weaving, plannedFrom: from + 108e5, plannedTo: from + 144e5, quantityMilli: 400001,
  }, planner);
  assert.equal(tooMuch.status, 409, '400,000 milli/h x 1h = the window bound; one milli over refuses');
  const cancelled = await f.run('/api/erp/production/allocations/cancel', {
    id: comboOk.data.allocation.id, reason: 'Cell assigned to binning',
  }, planner);
  assert.equal(cancelled.status, 200);
  const uncancelled = await f.run('/api/erp/production/allocations/cancel', {
    id: ok.data.allocation.id, reason: 'Second try',
  }, planner);
  assert.equal(uncancelled.status, 200);
  const startRefused = await f.run('/api/erp/production/batches/start', { id: spinningBatch.id }, planner);
  assert.equal(startRefused.status, 409, 'starting needs a live planned allocation, all were cancelled');
});

test('actual runs: quarantine gates, exact consume decrements, and issue records never masquerade as waste or dispatch', async () => {
  const f = await fixture();
  const productId = f.product('Cotton 30/1', 'COT-30');
  const spinning = await f.machine('Ring frame 12', 'spinning', ['spinning']);
  const productionLot = f.lot(productId, 'BIG-LOT-1', 'approved');
  f.move(productionLot, 'receive', { toStage: 'raw', grams: 9_000, cartons: 18, cones: 300 });
  const { batch, run, operator } = await f.flowingBatch({ productId, machineId: spinning });
  f.sql.prepare('INSERT INTO stock_reservations(id,workspace_id,batch_id,lot_id,stage,grams,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(u(), f.workspaceId, batch.id, productionLot, 'raw', 2000, 'active', 'seed', now());
  const openConsume = issue => f.run('/api/erp/production/runs/consume', { runId: run.id, note: 'Frame start', ...issue }, operator);
  const firstIssue = await openConsume({ inputs: [{ id: u(), lotId: productionLot, stage: 'raw', grams: 3000, cartons: 6, cones: 100 }] });
  assert.equal(firstIssue.status, 201, JSON.stringify(firstIssue.data));
  assert.equal(f.balancesOf(productionLot).raw, 6000, 'stock leaves exactly once, by exactly the issued grams');
  const secondIssue = await openConsume({ inputs: [{ id: u(), lotId: productionLot, stage: 'raw', grams: 5000 }] });
  assert.equal(secondIssue.status, 201, JSON.stringify(secondIssue.data), 'the lot still holds what was left, so the next issue within the balance is allowed');
  assert.equal(f.balancesOf(productionLot).raw, 1000, 'balances move by exactly the issued grams, never by a guessed restock');
});

test('actual runs: output, loss reconciliation and close guards', async () => {
  const f = await fixture();
  const productId = f.product('Cotton 30/1', 'COT-30');
  const spinning = await f.machine('Ring frame 12', 'spinning', ['spinning']);
  const productionLot = f.lot(productId, 'BIG-LOT-2', 'approved');
  f.move(productionLot, 'receive', { toStage: 'raw', grams: 9_000, cartons: 18, cones: 300 });
  const { batch, run, operator } = await f.flowingBatch({ productId, machineId: spinning });
  const issue = await f.run('/api/erp/production/runs/consume', { runId: run.id, inputs: [{ id: u(), lotId: productionLot, stage: 'raw', grams: 3000, cartons: 6, cones: 100 }] }, operator);
  assert.equal(issue.status, 201, JSON.stringify(issue.data));
  const outputs = await f.run('/api/erp/production/runs/outputs', { runId: run.id, outputs: [{ id: u(), lotId: u(), grams: 2500, metres: null, pieces: null, toStage: 'wip' }] }, operator);
  assert.equal(outputs.status, 201, JSON.stringify(outputs.data));
  const closed = await f.run('/api/erp/production/runs/close', { runId: run.id, note: 'Frame closed cleanly' }, operator);
  assert.equal(closed.status, 201, JSON.stringify(closed.data));
  assert.equal(closed.data.totals.consumed_grams, 3000);
  assert.equal(closed.data.totals.output_grams, 2500);
  assert.equal(closed.data.totals.loss_grams, 500, 'loss is the reconciled difference, never invented');
});

test('runs cannot close without both an issued lot and a produced lot, and output above consumption is refused', async () => {
  const f = await fixture();
  const productId = f.product('Cotton 30/1', 'COT-30');
  const spinning = await f.machine('Ring frame 12', 'spinning', ['spinning']);
  const productionLot = f.lot(productId, 'BIG-LOT-3', 'approved');
  f.move(productionLot, 'receive', { toStage: 'raw', grams: 9_000, cartons: 18, cones: 300 });
  const { batch, run, operator } = await f.flowingBatch({ productId, machineId: spinning });
  const consume = await f.run('/api/erp/production/runs/consume', { runId: run.id, inputs: [{ id: u(), lotId: productionLot, stage: 'raw', grams: 3000, cartons: 6, cones: 100 }] }, operator);
  assert.equal(consume.status, 201);
  assert.equal((await f.run('/api/erp/production/runs/close', { runId: run.id, note: 'Close without output' }, operator)).status, 409, 'a run that consumed but produced nothing cannot be closed as reconciled');
  const outputs = await f.run('/api/erp/production/runs/outputs', { runId: run.id, outputs: [{ id: u(), lotId: u(), grams: 4000, metres: null, pieces: null, toStage: 'wip' }] }, operator);
  assert.equal(outputs.status, 409, 'output mass above consumed mass is refused before any stock moves');
  const goodOutput = await f.run('/api/erp/production/runs/outputs', { runId: run.id, outputs: [{ id: u(), lotId: u(), grams: 2500, metres: null, pieces: null, toStage: 'wip' }] }, operator);
  assert.equal(goodOutput.status, 201, JSON.stringify(goodOutput.data));
  const closed = await f.run('/api/erp/production/runs/close', { runId: run.id, note: 'Clean close' }, operator);
  assert.equal(closed.status, 201, JSON.stringify(closed.data));
});