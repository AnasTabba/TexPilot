/** Loopback-only development server: the same API and PIN sign-in as Cloudflare, on SQLite. */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows } from '../server/auth.mjs';
import { seedDemoStock } from './demo-stock.mjs';

if (process.env.YARNFLOW_LOCAL_DEV !== '1') throw new Error('Local preview requires YARNFLOW_LOCAL_DEV=1. Hosted production runs on Cloudflare D1.');
const root = resolve(import.meta.dirname, '..');
const dbPath = process.env.YARNFLOW_SQLITE_PATH || resolve(root, '.local/inventory.sqlite');
if (dbPath !== ':memory:') mkdirSync(resolve(dbPath, '..'), { recursive: true });
// A new database gets the shared workspace and the three admins (PIN: YARNFLOW_SEED_PIN), and no stock.
// Test mode (in-memory only) adds the test fixture stock, and POST /__test/reset starts it over.
async function open() {
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  database.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
  for (const file of readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    const name = file.slice(0, -4);
    if (database.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
    database.exec('BEGIN IMMEDIATE');
    try { database.exec(readFileSync(resolve(root, 'drizzle', file), 'utf8')); database.prepare('INSERT INTO local_migrations VALUES(?)').run(name); database.exec('COMMIT'); }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  const DB = sqliteBinding(database);
  if (!database.prepare('SELECT id FROM workspaces LIMIT 1').get()) {
    const pin = process.env.YARNFLOW_SEED_PIN;
    if (!pin) throw new Error('New local database: set YARNFLOW_SEED_PIN (4 digits) for the admins Anas, Fahad and Zuhair.');
    for (const { sql, args } of await seedRows(pin)) database.prepare(sql).run(...args);
    if (process.env.YARNFLOW_TEST_MODE !== '1' || dbPath !== ':memory:') return { database, DB };
    const call = (path, body, cookie) => inventoryApi(new Request('http://local/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://local', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }), { DB });
    const cookie = (await call('/auth/login', { name: 'Anas', pin })).headers.get('Set-Cookie').split(';')[0];
    await seedDemoStock(async (path, body) => { const response = await call(path, body, cookie); if (!response.ok) throw new Error(`Demo stock ${path}: ${response.status}`); return response.json(); });
    database.exec('DELETE FROM sessions');
  }
  return { database, DB };
}
let { database, DB } = await open();
const bucketRoot = resolve(root, '.local/photos');
function objectPath(key) { const path = resolve(bucketRoot, key); if (!path.startsWith(bucketRoot + '/')) throw new Error('Invalid object key'); return path; }
const bucket = {
  async put(key, value) { const path = objectPath(key); mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, value); },
  async get(key) { const path = objectPath(key); return existsSync(path) ? { body: readFileSync(path) } : null; },
  async delete(key) { rmSync(objectPath(key), { force: true }); },
};
const env = { DB, BUCKET: bucket, TEXPILOT_API_URL: process.env.TEXPILOT_API_URL, INVENTREE_URL: process.env.INVENTREE_URL, INVENTREE_TOKEN: process.env.INVENTREE_TOKEN };
const port = Number(process.env.PORT || 8788);
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url || '/', `http://${incoming.headers.host || `127.0.0.1:${port}`}`);
    if (url.pathname === '/__test/reset' && incoming.method === 'POST' && process.env.YARNFLOW_TEST_MODE === '1' && dbPath === ':memory:') {
      database.close(); ({ database, DB } = await open()); env.DB = DB;
      outgoing.writeHead(204); outgoing.end(); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      let body;
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        const chunks = []; let size = 0;
        const limit = url.pathname === '/api/photos' ? 11 * 1024 * 1024 : 65536;
        for await (const chunk of incoming) { size += chunk.length; if (size > limit) { outgoing.writeHead(413, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: 'Request too large' })); return; } chunks.push(chunk); }
        body = Buffer.concat(chunks);
      }
      const response = await inventoryApi(new Request(url, { method: incoming.method, headers, ...(body ? { body } : {}) }), env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const dist = resolve(root, 'dist');
    const target = resolve(dist, '.' + decodeURIComponent(url.pathname));
    const file = target.startsWith(dist + '/') && existsSync(target) && extname(target) ? target : resolve(dist, 'index.html');
    if (!existsSync(file)) { outgoing.writeHead(503, { 'Content-Type': 'text/plain' }); outgoing.end('Run npm run build first, or use the Vite dev server on port 5174.'); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
    outgoing.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); outgoing.end(readFileSync(file));
  } catch (error) { console.error('Local preview request failed:', error.message); outgoing.writeHead(500); outgoing.end('Local preview error'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Yarnflow LOCAL DEVELOPMENT: http://127.0.0.1:${port} (PIN sign-in, SQLite; not a production server)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { database.close(); process.exit(0); }));
