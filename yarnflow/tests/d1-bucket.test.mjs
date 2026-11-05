import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { d1Bucket } from '../server/d1-bucket.mjs';

test('D1 photo store round-trips multi-chunk photos and deletes them', async () => {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../drizzle/0022_photo_chunks.sql', import.meta.url), 'utf8'));
  const bucket = d1Bucket(sqliteBinding(sql)), bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => i * 7 % 256);
  await bucket.put('w/i/photo', bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM photo_chunks').get().n, 3);
  assert.deepEqual((await bucket.get('w/i/photo')).body, bytes);
  await bucket.put('w/i/photo', bytes.subarray(0, 10));
  assert.deepEqual((await bucket.get('w/i/photo')).body, bytes.subarray(0, 10));
  await bucket.delete('w/i/photo');
  assert.equal(await bucket.get('w/i/photo'), null);
});
