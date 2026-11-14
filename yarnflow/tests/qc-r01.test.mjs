import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDouble, uploadedDouble, analysisDouble, activeReleaseDouble, doubleRecord, idemDouble, isCode, countsDouble } from './qc-store.test.mjs';
import * as store from '../server/qc-store.mjs';
import { contentSha256, HASH_EXCLUDES } from '../server/qc-contract.mjs';

const STAGES = ['quality', 'fabric', 'defects', 'metrology', 'domain'];
const service = error => error.code === 'SERVICE_UNAVAILABLE' && error.reasons.includes('STAGE_UNAVAILABLE');

/** Rebind the all-OK fixture evidence to the captures the Worker actually signed. */
function allOkEvidence(prepared, at) {
  const evidence = doubleRecord('evidence-synthetic-all-stages-ok'), captures = prepared.request.captures;
  const ids = captures.map(c => c.capture.id), shas = captures.map(c => c.verified_sha256), pick = i => ({ capture_id: ids[i % ids.length], capture_sha256: shas[i % shas.length] });
  evidence.id = crypto.randomUUID();
  evidence.sample_id = prepared.sample.id;
  evidence.spec_sha256 = prepared.spec.content_sha256;
  evidence.capture_ids = ids;
  evidence.domain_id = prepared.domain?.id ?? null;
  evidence.created_at = new Date(at).toISOString();
  // The fixture measures both axes on the structure original; keep that shape on the signed set.
  evidence.metrology.value = evidence.metrology.value.map(measurement => ({ ...measurement, ...pick(Math.min(1, ids.length - 1)) }));
  evidence.defects.value.views = evidence.defects.value.views.map((view, i) => ({ ...view, ...pick(i) }));
  evidence.defects.value.regions = evidence.defects.value.regions.map((region, i) => ({ ...region, capture_id: ids[i % ids.length] }));
  return evidence;
}
async function candidateDouble(prepared, started, evidence, automatic = false) {
  evidence.manifest_sha256 = await contentSha256(evidence, HASH_EXCLUDES.Evidence);
  return { evidence, draft: automatic ? { status: 'ACCEPT', reasons: [], automatic: true, scope: 'INSPECTED_SAMPLE' } : doubleRecord('draft-manual-review'),
    binding: { spec_sha256: prepared.spec.content_sha256, policy_sha256: prepared.policy.sha256, release_sha256: prepared.release?.sha256 ?? null, capture_sha256s: prepared.request.captures.map(c => c.verified_sha256),
      attempt: prepared.set.attempt, expected_revision: prepared.sample.revision, request_id: started.request_id, request_generation: started.generation, deadline_at: prepared.request.context.deadline_at } };
}

test('R01 automatic ACCEPT is refused unless all five evidence stages are OK with no reasons', async t => {
  const f = await fixtureDouble(); t.after(() => f.sql.close());
  await activeReleaseDouble(f);
  const u = await uploadedDouble(f), a = await analysisDouble(f, u), before = countsDouble(f);
  const evidence = doubleRecord('evidence-review-only-stages-unavailable');
  evidence.id = crypto.randomUUID();
  evidence.sample_id = a.prepared.sample.id;
  evidence.spec_sha256 = a.prepared.spec.content_sha256;
  evidence.capture_ids = a.prepared.request.captures.map(c => c.capture.id);
  evidence.domain_id = a.prepared.domain.id; // passes the release/domain clamp, so only the stage clamp can refuse
  evidence.created_at = new Date(f.now).toISOString();
  a.candidate = await candidateDouble(a.prepared, a.started, evidence, true);
  await assert.rejects(store.checkCandidate(a.candidate, a.prepared), service);
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), service);
  assert.deepEqual(countsDouble(f), before);
});

test('R01 automatic ACCEPT is stored when every evidence stage is OK and the release is Worker-selected', async t => {
  const f = await fixtureDouble(); t.after(() => f.sql.close());
  await activeReleaseDouble(f);
  const u = await uploadedDouble(f), a = await analysisDouble(f, u);
  a.candidate = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now), true);
  const decision = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), result = await store.loadResult(f.env.DB, f.workspaceId, u.result.sample.id, f.now);
  assert.equal(decision.automatic, true); assert.equal(decision.status, 'ACCEPT'); assert.equal(decision.release_id, a.prepared.release.id);
  assert.deepEqual(result.decision, decision); assert.equal(result.history.length, 1);
  for (const stage of STAGES) assert.equal(result.evidence[stage].state, 'OK', stage);
});

test('R01 evidence citing an unsigned original is refused even with a valid manifest hash', async t => {
  const f = await fixtureDouble(); t.after(() => f.sql.close());
  const u = await uploadedDouble(f), a = await analysisDouble(f, u);
  const valid = await candidateDouble(a.prepared, a.started, allOkEvidence(a.prepared, f.now));
  await store.checkCandidate(valid, a.prepared);
  const ids = a.prepared.request.captures.map(c => c.capture.id), shas = a.prepared.request.captures.map(c => c.verified_sha256);
  const tampered = [
    evidence => { evidence.metrology.value[0].capture_sha256 = 'f'.repeat(64); },
    evidence => { evidence.metrology.value[0].capture_id = ids[0]; evidence.metrology.value[0].capture_sha256 = shas[1]; },
    evidence => { evidence.defects.value.views[0].capture_sha256 = 'f'.repeat(64); },
  ];
  for (const mutate of tampered) {
    const evidence = structuredClone(valid.evidence); mutate(evidence);
    const candidate = await candidateDouble(a.prepared, a.started, evidence);
    const before = countsDouble(f);
    await assert.rejects(store.checkCandidate(candidate, a.prepared), e => service(e) && /cites an original that was not signed/.test(e.message));
    await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), service);
    assert.deepEqual(countsDouble(f), before);
  }
});

test('R01 commit-time clock is read after every await: a passing deadline writes nothing', async t => {
  const f = await fixtureDouble(); t.after(() => f.sql.close());
  const u = await uploadedDouble(f), a = await analysisDouble(f, u), before = countsDouble(f), sample = u.result.sample;
  let calls = 0; const clock = () => (++calls === 1 ? f.now : a.started.deadline_at);
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, clock), isCode('DEADLINE_EXCEEDED'));
  assert.deepEqual(countsDouble(f), before);
  assert.equal(f.sql.prepare('SELECT current_decision_id FROM qc_samples WHERE id=?').get(sample.id).current_decision_id, null);
  assert.equal(f.sql.prepare('SELECT state FROM qc_idempotency WHERE request_id=?').get(a.started.request_id).state, 'EXPIRED');
});

test('R01 commit-time clock is read after every await: a release expiring between readings writes nothing', async t => {
  const f = await fixtureDouble(); t.after(() => f.sql.close());
  const release = await activeReleaseDouble(f), u = await uploadedDouble(f), a = await analysisDouble(f, u), before = countsDouble(f);
  let calls = 0; const clock = () => (++calls === 1 ? f.now : Date.parse(release.expires_at));
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, clock), isCode('CONFLICT'));
  assert.deepEqual(countsDouble(f), before);
  assert.equal(f.sql.prepare('SELECT current_decision_id FROM qc_samples WHERE id=?').get(u.result.sample.id).current_decision_id, null);
});

test('R01 a new capture set clears the current decision and keeps it in history', async t => {
  const f = await fixtureDouble(); t.after(() => f.sql.close());
  const u = await uploadedDouble(f), a = await analysisDouble(f, u), decision = await store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now);
  let result = await store.loadResult(f.env.DB, f.workspaceId, u.result.sample.id, f.now);
  assert.equal(result.decision.id, decision.id); assert.equal(result.history.length, 1);
  const input = { sample_id: result.sample.id, expected_revision: result.revision }, idem = await idemDouble('/capture-sets', input);
  result = (await store.createCaptureSet(f.env.DB, f.ctx, { ...input, idem }, f.now)).body;
  assert.equal(result.decision, null); assert.equal(result.evidence, null); assert.equal(result.history.length, 1); assert.equal(result.history[0].id, decision.id);
  assert.equal(f.sql.prepare('SELECT current_decision_id FROM qc_samples WHERE id=?').get(u.result.sample.id).current_decision_id, null);
  assert.equal((await store.listSamples(f.env.DB, f.workspaceId)).find(s => s.sample_id === u.result.sample.id).status, null);
  const replay = await store.beginRequest(f.env.DB, f.ctx, idem, f.now + 1);
  assert.equal(replay.replay.body.decision, null); assert.equal(replay.replay.body.evidence, null); assert.equal(replay.replay.body.history.length, 1);
  await assert.rejects(store.appendAdjudication(f.env.DB, f.supervisor, { sample_id: result.sample.id, expected_revision: result.revision, outcome: 'UNDETERMINED', reason: 'No current decision test double', reference_ids: [], supersedes_id: null }, f.now), isCode('CONFLICT'));
});
