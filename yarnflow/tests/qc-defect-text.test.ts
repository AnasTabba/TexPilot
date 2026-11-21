import test from 'node:test';
import assert from 'node:assert/strict';
import { defectSummary, stageReasons, STATE_TEXT } from '../src/qc-reasons.ts';
import type { DefectValue, Reason, Stage, StageState } from '../src/qc-types.ts';

const value: DefectValue = { score: 0.1, regions: [], observed_area_cm2: 1, views: [] };
const stage = (state: StageState, reasons: Reason[] = []): Stage<DefectValue> =>
  ({ state, value: state === 'OK' ? value : null, reasons, artifact_sha256: state === 'OK' ? 'x' : null, duration_ms: 0 });

const cases: [Stage<DefectValue>, string][] = [
  [stage('DISABLED'), 'The defect check is not installed on this scanner. Look for faults by eye.'],
  [stage('ABSTAINED', ['OOD']), 'This fabric is unlike the fabrics the defect check learned, so it gave no result. Look for faults by eye.'],
  [stage('ABSTAINED', ['QUALITY_FRAMING']), 'The photo did not show enough fabric for the defect check. Retake it closer.'],
  [stage('ABSTAINED', ['STAGE_UNAVAILABLE']), 'The defect check ran out of time. Look for faults by eye.'],
  [stage('FAILED'), 'The defect check failed to run. Look for faults by eye.'],
  [stage('NOT_RUN'), 'The defect check did not run. Look for faults by eye.'],
  [stage('OK', ['DEFECT_SUSPECTED']), 'Possible defect in the marked areas. The supervisor decides.'],
  [stage('OK'), 'No defect marked in the checked photos. This covers only the photographed area.'],
];

test('defectSummary English wording per state', () => {
  for (const [s, en] of cases) assert.equal(defectSummary(s)[0], en);
});

test('Urdu present, distinct, and no pass wording', () => {
  const seen = new Set<string>();
  for (const [s] of cases) {
    const [en, ur] = defectSummary(s);
    assert.ok(ur.trim().length > 0);
    assert.doesNotMatch(en.toLowerCase(), /clean|pass|approved/);
    seen.add(ur);
  }
  assert.equal(seen.size, cases.length);
});

test('every stage state gives a summary', () => {
  for (const state of Object.keys(STATE_TEXT) as StageState[]) {
    const [en, ur] = defectSummary(stage(state));
    assert.ok(en && ur, state);
  }
  // abstained with an unlisted reason still says no result
  assert.match(defectSummary(stage('ABSTAINED', ['SCALE_MISSING']))[0], /no result/);
});

test('OOD is said once: the defect stage list drops it, other stages keep it', () => {
  assert.deepEqual(stageReasons('defects', stage('ABSTAINED', ['OOD'])), []);
  assert.deepEqual(stageReasons('defects', stage('ABSTAINED', ['OOD', 'STAGE_UNAVAILABLE'])), ['STAGE_UNAVAILABLE']);
  assert.deepEqual(stageReasons('fabric', stage('ABSTAINED', ['OOD'])), ['OOD']);
});

test('defect OOD Urdu is plain trade Urdu', () => {
  const ur = defectSummary(stage('ABSTAINED', ['OOD']))[1];
  assert.ok(ur.includes('جانچنے والا ماڈل سکھایا گیا'));
  assert.ok(!ur.includes('سیکھے تھے'));
});
