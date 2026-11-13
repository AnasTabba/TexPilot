import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function workerDouble(text = source) {
 const handlers = {}, puts = [], deleted = [], responses = new Map();
 const cache = { put: async (request, response) => puts.push([typeof request === 'string' ? request : request.url, response]), match: async () => undefined };
 const scope = { addEventListener: (name, handler) => handlers[name] = handler, location: { origin: 'https://qc.test' }, clients: { claim: async () => {} }, skipWaiting: async () => {} };
 const cachesDouble = { open: async () => cache, keys: async () => ['yarnflow-old', 'other-cache', 'yarnflow-shell-v1'], delete: async key => deleted.push(key), match: async () => undefined };
 vm.runInNewContext(text, { self: scope, caches: cachesDouble, URL, Request, Response, fetch: async request => responses.get(typeof request === 'string' ? request : request.url) ?? new Response('shell') });
 return { handlers, puts, deleted, responses, async fetch(path, options = {}) { let promise; handlers.fetch({ request: new Request('https://qc.test' + path, options), respondWith: p => promise = p }); if (promise) await promise; return !!promise; } };
}
test('static allowlist excludes API bytes, previews, arbitrary files and private navigation', async () => { const d = workerDouble(); for (const path of ['/api/qc/v2/captures/id/original', '/api/qc/v2/samples/id', '/private', '/profile', '/uploads/private.png', '/assets/unknown.js', '/?private=1']) assert.equal(await d.fetch(path), false, path); assert.equal(d.puts.length, 0); });
test('no-store requests and no-store/private responses never enter the shell cache', async () => { const d = workerDouble(); assert.equal(await d.fetch('/icon.svg', { cache: 'no-store' }), false); for (const value of ['no-store', 'private, max-age=0']) { d.responses.set('https://qc.test/icon.svg', new Response('sensitive-double', { headers: { 'Cache-Control': value } })); await d.fetch('/icon.svg'); } assert.equal(d.puts.length, 0); });
test('activation removes obsolete yarnflow caches only', async () => { const d = workerDouble(); let wait; d.handlers.activate({ waitUntil: p => wait = p }); await wait; assert.deepEqual(d.deleted, ['yarnflow-old']); });
test('the actual build transform still replaces both literals and allowlists exactly the built assets', async () => { const dir = await mkdtemp(join(tmpdir(), 'qc-cache-double-')); try { await mkdir(join(dir,'public')); await mkdir(join(dir,'dist/assets'), { recursive: true }); await writeFile(join(dir,'public/sw.js'), source); await writeFile(join(dir,'dist/assets/app-double.js'), '/* double */'); execFileSync(process.execPath, [resolve('scripts/prepare-offline.mjs')], { cwd: dir }); const output = await readFile(join(dir,'dist/sw.js'),'utf8'); assert.ok(!output.includes("const CACHE='yarnflow-shell-v1';")); assert.ok(!output.includes("cache.addAll(['/','/icon.svg'])")); const d = workerDouble(output); assert.equal(await d.fetch('/assets/app-double.js'), true); assert.equal(await d.fetch('/assets/unknown.js'), false); assert.equal(d.puts.length, 1); } finally { await rm(dir, { recursive: true, force: true }); } });
