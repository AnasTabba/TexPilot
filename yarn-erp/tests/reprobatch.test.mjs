import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { productionApi } from '/Users/anastabba/orca/workspaces/FYP/erp-production/yarn-erp/server/production.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { ErpProblem } from '../server/erp-utils.mjs';
import { PERMISSIONS, seedRows } from '../server/auth.mjs';

const ORIGIN='https://yarnflow.test';
const SALES_CONTRACT = `CREATE TABLE sales_orders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, reference TEXT NOT NULL, buyer_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(workspace_id,reference)); CREATE TABLE sales_order_lines (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, sales_order_id TEXT NOT NULL REFERENCES sales_orders(id), product_id TEXT, specifications TEXT NOT NULL DEFAULT '', quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0), unit TEXT NOT NULL, created_at INTEGER NOT NULL);`;
async function applyMigrations(sql){ sql.exec(SALES_CONTRACT); for (const file of readdirSync(new URL('/Users/anastabba/orca/workspaces/FYP/erp-production/yarn-erp/drizzle/', import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('/Users/anastabba/orca/workspaces/FYP/erp-production/yarn-erp/drizzle/'+file, import.meta.url),'utf8')); }
test('repro', async () => {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  await applyMigrations(sql);
  for (const {sql:q,args} of await seedRows('2468')) sql.prepare(q).run(...args);
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id;
  const env = { DB: sqliteBinding(sql) };
  const u=()=>crypto.randomUUID(); const now=()=>Date.now();
  const admin = { user_id: u(), workspace_id: workspaceId, name:'Anas', role:'owner', admin:true, permissions: PERMISSIONS };
  const person = (name, perms) => ({ user_id: u(), workspace_id: workspaceId, name, role:'operator', admin:false, permissions: perms });
  const product = (name, sku) => { const id=u(); sql.prepare('INSERT INTO products(id,workspace_id,sku,name,created_at) VALUES(?,?,?,?,?)').run(id,workspaceId,sku,name,now()); return id; };
  const productId = product('Cotton 30/1','COT-30');
  const order = u(); sql.prepare("INSERT INTO sales_orders(id,workspace_id,reference,buyer_id,status,created_at) VALUES(?,?,?,?, 'confirmed', ?)").run(order,workspaceId,'SO-1','buyer',now());
  const line = u(); sql.prepare("INSERT INTO sales_order_lines(id,workspace_id,sales_order_id,product_id,specifications,quantity_milli,unit,created_at) VALUES(?,?,?,?,?,?,?,?)").run(line,workspaceId,order,productId,'',500000,'kg',now());
  const path='/api/erp/production/batches';
  const data = { id: u(), salesOrderLineId: line, productId, operation:'spinning', plannedQuantityMilli:400000, unit:'kg', dueAt: now()+864e5 };
  const member = person('Planner',['production']);
  try {
    const res = await productionApi(new Request(`${ORIGIN}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:JSON.stringify(data)}), env, member, path, data);
    console.log('STATUS', res.status);
    console.log('BODY', await res.text());
  } catch(e) { console.log('THREW', e.status, e.message); }
});
