import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';

const base = '/erp/buyer-ratings', uuid = () => crypto.randomUUID();
async function setup() {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  await f.person('Qasim', 'quality_inspector');
  return f;
}
const rejects = (result, status, message) => { assert.equal(result.status, status, result.text); if (message) assert.match(result.data.error, new RegExp(message)); };
const rate = (f, buyerId, scores = {}, as = 'Sana') => f.call(base, { id: uuid(), buyerId, payment: 4, communication: 5, reliability: 3, ...scores }, as);

test('a sales manager rates a buyer and the averages include every rating', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  const first = { id: uuid(), buyerId, payment: 4, communication: 5, reliability: 3, feedback: 'Pays on the 30th, calls ahead.' };
  const saved = await f.call(base, first, 'Sana');
  assert.equal(saved.status, 201, saved.text);
  assert.deepEqual(saved.data, { id: first.id, buyerId, payment: 4, communication: 5, reliability: 3, feedback: first.feedback });
  assert.equal((await rate(f, buyerId, { payment: 2, communication: 3, reliability: 5 })).status, 201);

  const detail = (await f.call(`${base}?buyerId=${buyerId}`, undefined, 'Sana')).data;
  assert.deepEqual(detail.summary, { payment: 3, communication: 4, reliability: 4, overall: 3.7, count: 2 });
  assert.deepEqual(detail.ratings.map(r => r.created_by_name), ['Sana', 'Sana']);


  const map = (await f.call(`${base}/summary`, undefined, 'Sana')).data;
  assert.deepEqual(map.summaries[buyerId], detail.summary);

  const replay = await f.call(base, first, 'Sana');
  assert.equal(replay.status, 200, 'the same ID returns the saved rating without a second row');
  assert.deepEqual(replay.data, saved.data);
  rejects(await f.call(base, { ...first, payment: 1 }, 'Sana'), 409, 'different rating');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM buyer_ratings WHERE buyer_id=?').get(buyerId).n, 2);

  const audits = f.sql.prepare("SELECT COUNT(*) AS n FROM erp_audit_events WHERE action='buyer.rated' AND record_id=?").get(buyerId).n;
  assert.equal(audits, 2, 'each saved rating is audited once');
});

test('a buyer with no ratings reads as no summary', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  assert.deepEqual((await f.call(`${base}?buyerId=${buyerId}`, undefined, 'Sana')).data, { summary: null, ratings: [] });
});

test('scores must be whole numbers from 1 to 5 and feedback at most 1000 characters', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  for (const score of [0, 6, 1.5, '3', null, -1]) rejects(await rate(f, buyerId, { reliability: score }), 422);
  rejects(await rate(f, buyerId, { payment: undefined }), 422);
  rejects(await rate(f, buyerId, { feedback: 'x'.repeat(1001) }), 422);
  rejects(await rate(f, buyerId, { extra: true }), 422);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM buyer_ratings').get().n, 0);
});

test('quality inspectors cannot read or write buyer ratings', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  rejects(await rate(f, buyerId, {}, 'Qasim'), 403);
  rejects(await f.call(`${base}?buyerId=${buyerId}`, undefined, 'Qasim'), 403);
  rejects(await f.call(`${base}/summary`, undefined, 'Qasim'), 403);
});

test('only an active buyer in the workspace can be rated', async () => {
  const f = await setup();
  for (const status of ['pending', 'rejected', 'suspended', 'archived']) {
    const buyerId = await f.insertBuyer({ status: status === 'archived' ? 'active' : status });
    if (status === 'archived') f.sql.prepare("UPDATE buyers SET status='archived' WHERE id=?").run(buyerId);
    rejects(await rate(f, buyerId), 409, 'active buyer');
  }
  rejects(await rate(f, uuid()), 404);
  rejects(await rate(f, 'not-an-id'), 422);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM buyer_ratings').get().n, 0);
});

test('ratings are append-only at the database level', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' });
  assert.equal((await rate(f, buyerId)).status, 201);
  assert.throws(() => f.sql.prepare('UPDATE buyer_ratings SET payment=1').run(), /ratings are history/);
  assert.throws(() => f.sql.prepare('DELETE FROM buyer_ratings').run(), /ratings are history/);
  assert.equal(f.sql.prepare('SELECT payment FROM buyer_ratings').get().payment, 4);
});
