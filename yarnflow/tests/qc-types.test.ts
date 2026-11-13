import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUARDS, REASONS, isQCResult, perInch } from '../src/qc-types.ts';

type Fixture = { name: string; type: string; value: unknown; layer: string | null };
const load = (name: string): Fixture[] => JSON.parse(readFileSync(new URL(`../../scanner/tests/fixtures/qc-v2/${name}.json`, import.meta.url), 'utf8'));
const valid = load('valid'), invalid = load('invalid');
const consumed = (fixtures: Fixture[]) => fixtures.filter(fixture => Object.hasOwn(GUARDS, fixture.type));

test('the shared fixtures cover the record types the web receives', () => {
  assert.ok(consumed(valid).length >= 30 && consumed(invalid).length >= 50);
  for (const type of ['QCResult', 'PurchaseSpec', 'Evidence', 'Decision', 'ErrorEnvelope', 'Readiness']) assert.ok(valid.some(f => f.type === type), type);
});
for (const fixture of consumed(valid)) test(`accepts valid ${fixture.type}: ${fixture.name}`, () => assert.equal(GUARDS[fixture.type](fixture.value), true));
for (const fixture of consumed(invalid)) test(`rejects invalid ${fixture.type} (${fixture.layer}): ${fixture.name}`, () => assert.equal(GUARDS[fixture.type](fixture.value), false));

test('a response with an unknown field or a missing field is not a QCResult', () => {
  const base = valid.find(f => f.type === 'QCResult')!.value as Record<string, unknown>;
  assert.equal(isQCResult(base), true);
  assert.equal(isQCResult({ ...base, accepted_quantity: 5 }), false);
  const { family: _family, ...rest } = base;
  assert.equal(isQCResult(rest), false);
  assert.equal(isQCResult({ ...base, mode: 'AUTO' }), false);
  assert.equal(isQCResult(null), false);
});
test('the reason list matches the contract schema exactly', () => {
  const schema = JSON.parse(readFileSync(new URL('../../scanner/contracts/qc-v2.schema.json', import.meta.url), 'utf8'));
  const found = new Set<string>();
  (function walk(node: unknown) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') { const item = node as Record<string, unknown>; if (Array.isArray(item.enum) && item.enum.includes('QUALITY_BLUR')) item.enum.forEach(v => found.add(v as string)); Object.values(item).forEach(walk); }
  })(schema.$defs.DecisionDraft);
  assert.deepEqual([...found].sort(), [...REASONS].sort());
});
test('per-centimetre counts convert by exactly 2.54 for display', () => {
  assert.equal(perInch(10, 'count/cm'), 25.4);
  assert.equal(perInch(60, 'count/in'), 60);
});

test('English and Urdu catalogs cover every schema enum and capture instruction', async () => {
 const { REASON_TEXT, STATUS_TEXT, STATE_TEXT, ERROR_TEXT, ROLE_TEXT, URDU_REVIEWED } = await import('../src/qc-reasons.ts');
 const { DECISION_STATUSES, STAGE_STATES, ERROR_CODES, CAPTURE_ROLES } = await import('../src/qc-types.ts');
 for (const [values, catalog] of [[REASONS, REASON_TEXT], [DECISION_STATUSES, STATUS_TEXT], [STAGE_STATES, STATE_TEXT], [ERROR_CODES, ERROR_TEXT], [CAPTURE_ROLES, ROLE_TEXT]] as const) for (const value of values) assert.ok(Object.hasOwn(catalog, value), value);
 assert.equal(URDU_REVIEWED, false);
 for (const item of Object.values(REASON_TEXT)) assert.ok(item.text[0] && item.text[1]);
 for (const item of Object.values(ROLE_TEXT)) assert.ok(item.instruction[0] && item.instruction[1]);
});
