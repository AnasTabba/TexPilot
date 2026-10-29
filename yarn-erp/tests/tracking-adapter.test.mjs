import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, trackUnit, ProviderProblem } from '../server/datalooplabs.mjs';
import { accountFromEnv } from '../server/tracking.mjs';

const KEY = 'test_key_0000000000000';
const FULL = { baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track',
  request: { number: 'number', type: 'type', types: { bol: 'bill_of_lading' } },
  response: { containers: 'containers', containerNumber: 'number', reference: 'referenceNumber', events: 'events',
    event: { time: 'eventTime', title: 'statusDescription', code: 'statusCode', location: 'location' },
    dataTimestamp: 'updatedAt', eta: 'eta', origin: 'origin', destination: 'destination', vessel: 'vessel', carrier: 'carrier' } };
const BARE = { ...FULL, response: { ...FULL.response } };
for (const k of ['eta', 'origin', 'destination', 'vessel', 'carrier']) delete BARE.response[k];
const PAYLOAD = { containers: [{ number: 'MSCU1234567' }],
  events: [{ eventTime: '2026-10-28T10:00:00Z', statusCode: 'LOADED', statusDescription: 'Loaded on vessel', location: 'Karachi' }],
  referenceNumber: 'BL123', updatedAt: '2026-10-29T08:00:00Z', eta: '2026-11-15T00:00:00Z',
  origin: 'Karachi', destination: 'Faisalabad', vessel: 'MSC ANNA', carrier: 'MSC' };
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Any accidental real network call fails the test instead of leaving the machine.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('real network call attempted in test'); };
afterEach(() => { globalThis.fetch = realFetch; });

const account = contract => accountFromEnv({ DATALOOPLABS_CONTRACT: JSON.stringify(contract) });
const track = (env, contract, fetchFn) => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return fetchFn(url, init); };
  return trackUnit(env, account(contract), { identifier: 'MSCUBL1234', identifier_type: 'bol' }, { fetch: fake }).then(r => ({ r, calls }));
};

test('normalize maps eta, origin, destination, vessel, carrier and events', () => {
  const r = normalize(FULL, PAYLOAD);
  assert.equal(r.eta, Date.parse('2026-11-15T00:00:00Z'));
  assert.equal(r.origin, 'Karachi'); assert.equal(r.destination, 'Faisalabad');
  assert.equal(r.vessel, 'MSC ANNA'); assert.equal(r.carrier, 'MSC');
  assert.equal(r.dataAt, Date.parse('2026-10-29T08:00:00Z'));
  assert.deepEqual(r.containers, ['MSCU1234567']); assert.equal(r.reference, 'BL123'); assert.equal(r.empty, false);
  assert.deepEqual(r.events, [{ at: Date.parse('2026-10-28T10:00:00Z'), title: 'Loaded on vessel', code: 'LOADED', location: 'Karachi' }]);
});

test('a contract without the optional paths normalizes them to null and keeps events', () => {
  const r = normalize(BARE, PAYLOAD);
  for (const k of ['eta', 'origin', 'destination', 'vessel', 'carrier']) assert.equal(r[k], null, k);
  assert.equal(r.events[0].title, 'Loaded on vessel'); assert.equal(r.reference, 'BL123');
});

test('a provider that leaves an optional field empty gives null, not an empty string or NaN', () => {
  const r = normalize(FULL, { ...PAYLOAD, eta: '', origin: '   ', vessel: 'not a date' });
  assert.equal(r.eta, null); assert.equal(r.origin, null); assert.equal(r.vessel, 'not a date');
});

test('trackUnit sends the key only in the Authorization header and never in the result', async () => {
  const env = { DATALOOPLABS_API_KEY: KEY };
  const { r, calls } = await track(env, FULL, () => ok(PAYLOAD));
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://provider.test/v1/tracking/track');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(r.eta, Date.parse('2026-11-15T00:00:00Z'));
  assert.ok(!JSON.stringify(r).includes(KEY), 'key appeared in the normalized result');
});

test('HTTP 401 and 403 are a rejected credential', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(track({ DATALOOPLABS_API_KEY: KEY }, FULL, () => new Response('no', { status })),
      e => e instanceof ProviderProblem && e.kind === 'credential_rejected');
  }
});

test('a missing key is not_configured and no call is made', async () => {
  let called = false;
  await assert.rejects(track({}, FULL, () => { called = true; return ok(PAYLOAD); }),
    e => e instanceof ProviderProblem && e.kind === 'not_configured');
  assert.equal(called, false);
});
