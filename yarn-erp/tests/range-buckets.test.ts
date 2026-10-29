import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buckets, bucketIndex } from '../src/range-buckets.ts';

const KARACHI = 5 * 3_600_000;
const karachi = (y: number, m: number, d: number) => Date.UTC(y, m, d) - KARACHI;
const now = Date.UTC(2026, 9, 30, 10, 0) - KARACHI; // 30 Oct 2026, 15:00 Karachi

function assertContiguous(list: { start: number; end: number }[], current: number) {
  for (const b of list) assert.ok(b.start < b.end);
  for (let i = 1; i < list.length; i++) assert.equal(list[i].start, list[i - 1].end);
  assert.ok(list[0].start <= current && current < list[list.length - 1].end);
}

test('fixed ranges have the expected bucket counts', () => {
  assert.equal(buckets('14d', now).length, 14);
  assert.equal(buckets('30d', now).length, 30);
  assert.equal(buckets('6m', now).length, 26);
  assert.equal(buckets('1y', now).length, 12);
});

test('every range is contiguous and covers now', () => {
  for (const range of ['14d', '30d', '6m', '1y'] as const) assertContiguous(buckets(range, now), now);
  const firstTime = karachi(2026, 2, 14);
  assertContiguous(buckets('all', now, firstTime), now);
});

test('daily buckets end with today in Karachi time', () => {
  const list = buckets('14d', now);
  assert.equal(list[list.length - 1].label, '30');
  assert.equal(list[list.length - 1].start, karachi(2026, 9, 30));
  // 20:00 UTC on 30 Oct is already 31 Oct in Karachi.
  const late = Date.UTC(2026, 9, 30, 20, 0);
  assert.equal(buckets('14d', late).at(-1)?.label, '31');
});

test('all starts at the month of the first data point', () => {
  const list = buckets('all', now, karachi(2026, 0, 15));
  assert.equal(list[0].start, karachi(2026, 0, 1));
  assert.equal(list[0].label, 'Jan 26');
  assert.equal(list.length, 10); // Jan..Oct 2026
  assert.equal(list[list.length - 1].label, 'Oct');
});

test('all without data shows the last 12 months', () => {
  assert.equal(buckets('all', now).length, 12);
});

test('all is capped at the most recent 60 months', () => {
  const list = buckets('all', now, karachi(2015, 0, 1));
  assert.equal(list.length, 60);
  assert.equal(list[0].start, karachi(2021, 10, 1)); // Nov 2021 .. Oct 2026 is 60 months
  assertContiguous(list, now);
});

test('bucketIndex places times in the right bucket', () => {
  const list = buckets('6m', now);
  assert.equal(bucketIndex(list, now), list.length - 1);
  assert.equal(bucketIndex(list, list[0].start - 1), -1);
});
