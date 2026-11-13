import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson, sha256Hex, violation, schemaViolation, SCHEMA, parseSpec } from '../server/qc-contract.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`../../scanner/tests/fixtures/qc-v2/${name}.json`, import.meta.url)));
test('generated schema has no drift', () => assert.deepEqual(SCHEMA, JSON.parse(readFileSync(new URL('../../scanner/contracts/qc-v2.schema.json', import.meta.url)))));
for (const f of fixture('canonical')) test(`canonical bytes/hash: ${f.name}`, async () => { assert.equal(canonicalJson(f.value), f.canonical); assert.equal(await sha256Hex(f.canonical), f.sha256); });
for (const f of fixture('valid')) test(`valid: ${f.name}`, () => assert.equal(violation(f.type, f.value), null));
for (const f of fixture('invalid')) test(`invalid: ${f.name}`, () => assert.ok(violation(f.type, f.value)));
test('schema-only layer labels are reported honestly', () => assert.deepEqual(fixture('invalid').filter(f => Boolean(schemaViolation(f.type, f.value)) !== (f.layer === 'schema')).map(f => f.name), []));
test('canonical JSON refuses non JSON values and sparse arrays', () => { for (const x of [NaN, Infinity, undefined, () => {}, new Date(), new Map(), Array(2)]) assert.throws(() => canonicalJson(x)); });
test('Unicode lengths count code points; inherited required fields reject', () => {
  const f = fixture('valid').find(f => f.type === 'SamplingSelection').value;
  assert.equal(violation('SamplingSelection', { ...f, method: '🧵'.repeat(120) }), null);
  const v = Object.assign(Object.create({ id: f.id }), f); delete v.id; assert.ok(violation('SamplingSelection', v));
});
test('spec parser verifies content hash', async () => { const f = fixture('valid').find(f => f.name === 'spec-woven-v1').value; await parseSpec(f); await assert.rejects(parseSpec({ ...f, taxonomy_version: 'changed' }), /content_sha256/); });
