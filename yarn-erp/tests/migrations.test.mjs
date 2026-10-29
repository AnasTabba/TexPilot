import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrate, liveShapedRows, dir, legacyMigrations, portalFixture } from './portal-fixture.mjs';
const tables = ['users','sessions','products','lots','movements','stock_deltas','balances','quality_events','suppliers','supplier_users','procurement_rfqs','supplier_bids','supplier_purchase_orders','procurement_shipments','goods_receipts','erp_audit_events'];
function legacy() { const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON'); migrate(sql, legacyMigrations); liveShapedRows(sql); return sql; }
const upgrade = sql => migrate(sql, readdirSync(dir).filter(f => f.endsWith('.sql') && f >= '0004').sort());
test('every migration after 0003 applies on live-shaped data without losing a row', () => {
  const sql = legacy();
  const balancesBefore = sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY lot_id,stage').all();
  const before = Object.fromEntries(tables.map(t => [t, sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  upgrade(sql);
  for (const [t,n] of Object.entries(before)) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n,n,t);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY lot_id,stage').all(), balancesBefore);
});
test('migrations preserve stable values, not only counts and balances', () => {
  const sql = legacy();
  const snapshots = tables.map(table => {
    const info = sql.prepare(`PRAGMA table_info(${table})`).all();
    const query = `SELECT ${info.map(c => c.name).join(',')} FROM ${table} ORDER BY ${info.filter(c => c.pk).sort((a,b) => a.pk-b.pk).map(c => c.name).join(',')}`;
    return { table, query, rows: sql.prepare(query).all() };
  });
  upgrade(sql);
  for (const {table,query,rows} of snapshots) assert.deepEqual(sql.prepare(query).all(),rows,table);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM roles').get().n,6);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM users WHERE updated_at=created_at AND portal_role IS NOT NULL').get().n,10);
});
test('roles and newly created users carry required metadata', async () => {
  const f = await portalFixture();
  for (const table of ['roles','users']) {
    const columns = f.sql.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const name of ['status','created_by','created_at','updated_at']) assert.ok(columns.includes(name),`${table}.${name}`);
  }
  for (const row of f.sql.prepare('SELECT * FROM roles').all()) {
    assert.equal(row.status,'active'); assert.equal(row.created_by,'system:seed'); assert.ok(row.created_at > 0); assert.equal(row.updated_at,row.created_at);
  }
  const id = await f.person('Saima','supervisor');
  const user = f.sql.prepare('SELECT * FROM users WHERE id=?').get(id);
  assert.equal(user.created_by,f.adminId); assert.equal(user.status,'active'); assert.equal(user.updated_at,user.created_at);
});
