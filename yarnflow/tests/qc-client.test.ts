import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQCClient, QCError } from '../src/qc-client.ts';
import { QCDraftStore } from '../src/qc-drafts.ts';
const fixtures = JSON.parse(readFileSync('../scanner/tests/fixtures/qc-v2/valid.json', 'utf8'));
const resultDouble = fixtures.find((f: any) => f.name === 'result-created').value;
const key = '11111111-1111-4111-8111-111111111111';
const responseDouble = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
function sessionDouble() { const store = new QCDraftStore({ now: Date.now, createObjectURL: () => '', revokeObjectURL: () => {}, setTimeout: () => 0, clearTimeout: () => {}, channel: null }); store.begin({ actorId: 'actor-double', workspaceId: resultDouble.sample.workspace_id }); return store; }
function setupDouble(replies: (() => Promise<Response>)[]) {
 const calls: { url: string; init: RequestInit }[] = [], waits: number[] = [], unknown: string[] = []; const store = sessionDouble();
 const client = createQCClient({ store, fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return replies.shift()!(); }, sleep: async ms => { waits.push(ms); }, onUnknown: k => unknown.push(k) });
 return { client, calls, waits, unknown, store };
}
test('analysis uses only the public Worker route and a stable key; transport retries at 1/2/4 seconds', async () => {
 const d = setupDouble([1,2,3].map(() => async () => { throw new TypeError('transport-double'); }).concat([async () => responseDouble(resultDouble)]));
 assert.deepEqual(await d.client.analyzeSample(resultDouble.sample.id, 'set-double', 9, key), resultDouble);
 assert.deepEqual(d.waits, [1000, 2000, 4000]); assert.equal(d.unknown.length, 3);
 for (const call of d.calls) { assert.equal(call.url, `/api/qc/v2/samples/${resultDouble.sample.id}/analyze`); assert.equal(new Headers(call.init.headers).get('Idempotency-Key'), key); assert.deepEqual(JSON.parse(call.init.body as string), { capture_set_id: 'set-double', expected_revision: 9 }); assert.equal(call.init.cache, 'no-store'); }
});
for (const status of [401,403,409,422,500]) test(`never retries HTTP ${status}`, async () => {
 const d = setupDouble([async () => responseDouble({ schema_version: '2', error: { code: status === 401 ? 'UNAUTHENTICATED' : 'CONFLICT', reasons: [], retryable: false, request_id: key } }, status)]);
 await assert.rejects(d.client.analyzeSample(resultDouble.sample.id, 'set-double', 0, key), QCError); assert.equal(d.calls.length, 1); assert.deepEqual(d.waits, []);
 if (status === 401) assert.equal(d.store.identity, null);
});
for (const status of [429,503,504]) test(`retries ${status} and caps Retry-After at 60 seconds`, async () => {
 const d = setupDouble([async () => responseDouble({}, status, { 'Retry-After': '120' }), async () => responseDouble(resultDouble)]);
 await d.client.analyzeSample(resultDouble.sample.id, 'set-double', 0, key); assert.deepEqual(d.waits, [60000]);
});
test('transport outcome remains UNKNOWN; no earlier success is cached', async () => {
 const d = setupDouble([async () => responseDouble(resultDouble), ...[1,2,3,4].map(() => async () => { throw new TypeError('transport-double'); })]);
 await d.client.getSample(resultDouble.sample.id);
 await assert.rejects(d.client.analyzeSample(resultDouble.sample.id, 'set-double', 0, key), (e: QCError) => e.outcome === 'UNKNOWN'); assert.equal(d.calls.length, 5);
});
test('late success after logout is discarded and no old-session retry is sent', async () => {
 let finish!: (r: Response) => void; const d = setupDouble([() => new Promise(resolve => { finish = resolve; })]);
 const pending = d.client.analyzeSample(resultDouble.sample.id, 'set-double', 0, key); d.store.invalidate(); finish(responseDouble(resultDouble));
 await assert.rejects(pending, (e: QCError) => e.code === 'STALE_SESSION'); assert.equal(d.calls.length, 1);
});
test('abort interrupts retries and an already aborted signal sends nothing', async () => {
 const d = setupDouble([]), controller = new AbortController(); controller.abort();
 await assert.rejects(d.client.getSample(resultDouble.sample.id, controller.signal), (e: QCError) => e.code === 'ABORTED'); assert.equal(d.calls.length, 0);
});
test('upload preserves original bytes, hash and acquisition metadata', async () => {
 const d = setupDouble([async () => responseDouble(resultDouble)]); const original = new Blob([new Uint8Array([255,216,255,0,1])], { type: 'image/jpeg' });
 const meta = { capture_id: key, role: 'overview', expected_revision: 1, sha256: 'a'.repeat(64), taken_at: '2026-11-13T00:00:00Z', device_profile_id: 'web-unvalidated', calibration_id: null, consent_record_id: key, attestation: fixtures.find((f: any) => f.type === 'AcquisitionAttestation').value };
 await d.client.uploadCapture(key, meta, original, key);
 const body = d.calls[0].init.body as FormData; assert.deepEqual(new Uint8Array(await (body.get('original') as Blob).arrayBuffer()), new Uint8Array(await original.arrayBuffer())); assert.deepEqual(JSON.parse(body.get('meta') as string), meta);
});
test('202 uses the authorised request resource and returns the validated final envelope', async () => {
 const d = setupDouble([async () => responseDouble({ schema_version: '2', request_id: key, state: 'IN_PROGRESS', status_url: `/api/qc/v2/requests/${key}` }, 202), async () => responseDouble({ schema_version: '2', request_id: key, state: 'COMPLETED', result: resultDouble, error: null })]);
 assert.deepEqual(await d.client.analyzeSample(resultDouble.sample.id, 'set-double', 0, key), resultDouble); assert.equal(d.calls[1].url, `/api/qc/v2/requests/${key}`);
});
test('clearing a PO invalidates an old response while a new operation uses the current store generation', async () => {
 let finishDouble!: (r: Response) => void;
 const d = setupDouble([() => new Promise(resolve => { finishDouble = resolve; }), async () => responseDouble(resultDouble)]);
 const previous = d.client.getSample(resultDouble.sample.id);
 d.store.clear(resultDouble.sample.workspace_id);
 assert.deepEqual(await d.client.getSample(resultDouble.sample.id), resultDouble);
 finishDouble(responseDouble(resultDouble));
 await assert.rejects(previous, (e: QCError) => e.code === 'STALE_SESSION'); assert.equal(d.calls.length, 2);
});
test('a workspace switch during retry backoff sends no upload under the previous identity', async () => {
 const store = sessionDouble(); let callsDouble = 0;
 const client = createQCClient({ store, fetch: async () => { callsDouble++; return responseDouble({}, 503); }, sleep: async () => { store.begin({ actorId: 'replacement-actor-double', workspaceId: 'replacement-workspace-double' }); } });
 await assert.rejects(client.analyzeSample(resultDouble.sample.id, 'set-double', 0, key), (e: QCError) => e.code === 'STALE_SESSION'); assert.equal(callsDouble, 1);
});
