import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDouble, uploadedDouble, analysisDouble, activeReleaseDouble, doubleRecord, countsDouble } from './qc-store.test.mjs';
import * as store from '../server/qc-store.mjs';
import { contentSha256, HASH_EXCLUDES } from '../server/qc-contract.mjs';

function conformingEvidence(prepared, at) {
  const evidence = doubleRecord('evidence-synthetic-all-stages-ok'), captures = prepared.request.captures;
  const ids = captures.map(c => c.capture.id), shas = captures.map(c => c.verified_sha256), pick = i => ({ capture_id: ids[i % ids.length], capture_sha256: shas[i % shas.length] });
  evidence.id = crypto.randomUUID();
  evidence.sample_id = prepared.sample.id;
  evidence.spec_sha256 = prepared.spec.content_sha256;
  evidence.capture_ids = ids;
  evidence.domain_id = prepared.domain?.id ?? null;
  evidence.created_at = new Date(at).toISOString();
  evidence.fabric.value.taxonomy_version = prepared.spec.taxonomy_version;
  evidence.fabric.value.calibrated_probability = 0.97;
  evidence.metrology.value = evidence.metrology.value.map(measurement => {
    const m = { ...measurement, ...pick(Math.min(1, ids.length - 1)) };
    if (m.axis === 'ends') {
      m.value = 70.0;
      m.interval95 = [68.0, 72.0];
    }
    if (prepared.domain) {
      m.uncertainty_report_sha256 = prepared.domain.metrology_validation_sha256;
    }
    return m;
  });
  evidence.defects.value.views = evidence.defects.value.views.map((view, i) => ({ ...view, ...pick(i) }));
  evidence.defects.value.regions = evidence.defects.value.regions.map((region, i) => ({ ...region, capture_id: ids[i % ids.length] }));
  return evidence;
}

function signCaptures(prepared, evidence) {
  const byId = new Map(evidence.metrology.value.map(m => [m.capture_id, m]));
  for (const c of prepared.request.captures) {
    const m = byId.get(c.capture.id);
    if (m) {
      c.geometry_artifact_sha256 = m.geometry_artifact_sha256;
      c.calibration = { sha256: m.calibration_sha256 };
      c.reference = { id: m.reference_id };
      c.axis_registration = { id: m.axis_registration_id };
    }
  }
}

async function candidateDouble(prepared, started, evidence, automatic = false, draftOverride = null) {
  evidence.manifest_sha256 = await contentSha256(evidence, HASH_EXCLUDES.Evidence);
  const draft = draftOverride ?? (automatic ? { status: 'ACCEPT', reasons: [], automatic: true, scope: 'INSPECTED_SAMPLE' } : doubleRecord('draft-manual-review'));
  return {
    evidence,
    draft,
    binding: {
      spec_sha256: prepared.spec.content_sha256,
      policy_sha256: prepared.policy.sha256,
      release_sha256: prepared.release?.sha256 ?? null,
      capture_sha256s: prepared.request.captures.map(c => c.verified_sha256),
      attempt: prepared.set.attempt,
      expected_revision: prepared.sample.revision,
      request_id: started.request_id,
      request_generation: started.generation,
      deadline_at: prepared.request.context.deadline_at,
    },
  };
}

async function automaticSetup() {
  const f = await fixtureDouble();
  const release = await activeReleaseDouble(f);
  const u = await uploadedDouble(f), a = await analysisDouble(f, u);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  a.candidate = await candidateDouble(a.prepared, a.started, ev, true);
  return { f, release, u, a };
}

// ============================================================================
// B1 tests: contradiction check on stored inputs
// ============================================================================

test('B1 Worker refuses forged automatic ACCEPT: defect view 0.9 >= hold 0.8', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.defects.value.score = 0.9;
  ev.defects.value.views[0].score = 0.9;
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B1 Worker refuses forged automatic ACCEPT: aggregate 0.0 != max view 0.3', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.defects.value.score = 0.0;
  ev.defects.value.views[0].score = 0.3;
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B1 Worker refuses forged automatic ACCEPT: fabric denim vs allowed twill', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.fabric.value.label = 'denim';
  ev.fabric.value.candidates = [{ label: 'denim', raw_score: 4.0 }];
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B1 Worker refuses forged automatic ACCEPT: blur check false', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.quality.value.checks.blur = false;
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B1 conforming automatic ACCEPT is stored', async () => {
  const { f, u, a } = await automaticSetup();
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  const stored = await store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now);
  assert.equal(stored.status, 'ACCEPT');
  assert.equal(stored.automatic, true);
  f.sql.close();
});

test('B1 real fabric-mismatch HOLD is stored', async () => {
  const { f, u, a } = await automaticSetup();
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.fabric.value.label = 'denim';
  ev.fabric.value.candidates = [{ label: 'denim', raw_score: 4.0 }];
  const candidate = await candidateDouble(a.prepared, a.started, ev, true, { status: 'HOLD', reasons: ['FABRIC_MISMATCH'], automatic: true, scope: 'INSPECTED_SAMPLE' });
  const stored = await store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now);
  assert.equal(stored.status, 'HOLD');
  assert.equal(stored.automatic, true);
  assert.deepEqual(stored.reasons, ['FABRIC_MISMATCH']);
  f.sql.close();
});

test('B1 HOLD with conforming evidence is refused', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  const candidate = await candidateDouble(a.prepared, a.started, ev, true, { status: 'HOLD', reasons: ['FABRIC_MISMATCH'], automatic: true, scope: 'INSPECTED_SAMPLE' });
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

// ============================================================================
// B1 tests: clamp shape attacks (all held before the fix; kept as permanent regression)
// ============================================================================

const clampAttacks = [
  ['missing stage key (quality)', ev => { delete ev.quality; }],
  ['stage null (defects)', ev => { ev.defects = null; }],
  ['reasons null (quality)', ev => { ev.quality.reasons = null; }],
  ['reasons a string (metrology)', ev => { ev.metrology.reasons = 'none'; }],
  ['extra stage key', ev => { ev.extra_stage = structuredClone(ev.quality); }],
  ['state lowercase ok (fabric)', ev => { ev.fabric.state = 'ok'; }],
  ['OK stage with a reason the clamp must see (domain, OOD)', ev => { ev.domain.reasons = ['OOD']; }],
  ['OK stage with fixable reason (quality, QUALITY_BLUR)', ev => { ev.quality.reasons = ['QUALITY_BLUR']; }],
  ['OK stage with value null (defects)', ev => { ev.defects.value = null; }],
  ['OK stage with artifact null (metrology)', ev => { ev.metrology.artifact_sha256 = null; }],
];

for (const [name, mutate] of clampAttacks) {
  test(`B1 Worker refuses automatic ACCEPT: ${name}`, async () => {
    const { f, u, a } = await automaticSetup();
    const before = countsDouble(f);
    const ev = conformingEvidence(a.prepared, f.now);
    signCaptures(a.prepared, ev);
    mutate(ev);
    const candidate = await candidateDouble(a.prepared, a.started, ev, true);
    await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
    await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
    assert.deepEqual(countsDouble(f), before);
    f.sql.close();
  });
}

// ============================================================================
// B3 tests: signed capture bindings and domain metrology validation binding
// ============================================================================

test('B3 Worker refuses automatic draft citing unsigned measurement.geometry_artifact_sha256', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.metrology.value[0].geometry_artifact_sha256 = 'a'.repeat(64);
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B3 Worker refuses automatic draft citing unsigned measurement.calibration_sha256', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.metrology.value[0].calibration_sha256 = 'b'.repeat(64);
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B3 Worker refuses automatic draft citing unsigned measurement.uncertainty_report_sha256', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.metrology.value[0].uncertainty_report_sha256 = 'c'.repeat(64);
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B3 Worker refuses automatic draft citing unsigned measurement.axis_registration_id', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.metrology.value[0].axis_registration_id = '00000000-0000-4000-8000-0000000000ee';
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B3 Worker refuses automatic draft citing unsigned measurement.reference_id', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  const ev = conformingEvidence(a.prepared, f.now);
  signCaptures(a.prepared, ev);
  ev.metrology.value[0].reference_id = 'card-unlisted';
  const candidate = await candidateDouble(a.prepared, a.started, ev, true);
  await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B3 non-automatic draft citing unreleased domain or null signed capture values is stored unchanged', async () => {
  const f = await fixtureDouble();
  const u = await uploadedDouble(f), a = await analysisDouble(f, u);
  const ev = conformingEvidence(a.prepared, f.now);
  // prepared.request.captures has null signed values and prepared.domain is null (REVIEW_ONLY)
  const candidate = await candidateDouble(a.prepared, a.started, ev, false);
  const stored = await store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now);
  assert.equal(stored.status, 'MANUAL_REVIEW');
  assert.equal(stored.automatic, false);
  f.sql.close();
});

// ============================================================================
// B4 tests: release domain_sha256, policy_sha256, workspace_id and content hashes
// ============================================================================

test('B4 Worker refuses automatic draft when release.domain_sha256 does not match domain manifest', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  a.prepared.release.domain_sha256 = 'd'.repeat(64);
  a.candidate.binding.release_sha256 = a.prepared.release.sha256;
  await assert.rejects(store.checkCandidate(a.candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B4 Worker refuses automatic draft when release.policy_sha256 does not match policy', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  a.prepared.release.policy_sha256 = 'e'.repeat(64);
  a.candidate.binding.release_sha256 = a.prepared.release.sha256;
  await assert.rejects(store.checkCandidate(a.candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B4 Worker refuses automatic draft when release.workspace_id does not match request workspace', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  a.prepared.release.workspace_id = crypto.randomUUID();
  await assert.rejects(store.checkCandidate(a.candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B4 Worker refuses automatic draft when domain manifest content sha256 is tampered', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  a.prepared.domain.defect_accept_below = 0.99; // tampered without recomputing domain.sha256
  await assert.rejects(store.checkCandidate(a.candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

test('B4 Worker refuses automatic draft when policy content sha256 is tampered', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  a.prepared.policy.version = 'tampered-policy'; // tampered without recomputing policy.sha256
  await assert.rejects(store.checkCandidate(a.candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});

for (const stage of ['fabric', 'defects', 'quality', 'metrology', 'domain']) {
  test(`B4 Worker refuses automatic draft when the ${stage} stage artifact is not the released one`, async () => {
    const { f, u, a } = await automaticSetup();
    const before = countsDouble(f);
    const ev = conformingEvidence(a.prepared, f.now);
    signCaptures(a.prepared, ev);
    ev[stage].artifact_sha256 = 'f'.repeat(64);
    const candidate = await candidateDouble(a.prepared, a.started, ev, true);
    await assert.rejects(store.checkCandidate(candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
    await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, { ...a, candidate }, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
    assert.deepEqual(countsDouble(f), before);
    f.sql.close();
  });
}

/** Models a database administrator: the release immutability trigger is dropped before the write. */
async function tamperReleaseColumn(f, column, mutate, exclude) {
  f.sql.exec('DROP TRIGGER IF EXISTS qc_releases_transition');
  const row = JSON.parse(f.sql.prepare('SELECT json AS v FROM qc_releases').get().v);
  const record = JSON.parse(f.sql.prepare(`SELECT ${column} AS v FROM qc_releases`).get().v);
  mutate(record);
  record.sha256 = await contentSha256(record, exclude);
  f.sql.prepare(`UPDATE qc_releases SET ${column}=?`).run(JSON.stringify(record));
  return row;
}

for (const [column, mutate, exclude, label] of [
  ['domain_json', d => { d.defect_accept_below = 0.99; d.defect_hold_at_or_above = 0.995; }, HASH_EXCLUDES.DomainManifest, 'domain manifest'],
  ['policy_json', p => { p.version = 'automatic-tampered'; }, HASH_EXCLUDES.Policy, 'policy'],
]) {
  test(`B4 Worker refuses automatic draft when the stored ${label} is not the one the release names`, async () => {
    const { f, u, a } = await automaticSetup();
    const before = countsDouble(f);
    await tamperReleaseColumn(f, column, mutate, exclude);
    a.prepared = await store.prepareAnalysis(f.env.DB, f.env.BUCKET, f.ctx, { sample_id: u.result.sample.id, capture_set_id: u.set.id, expected_revision: u.result.revision }, a.started, f.now);
    const ev = conformingEvidence(a.prepared, f.now);
    signCaptures(a.prepared, ev);
    a.candidate = await candidateDouble(a.prepared, a.started, ev, true);
    await assert.rejects(store.checkCandidate(a.candidate, a.prepared), e => e.code === 'SERVICE_UNAVAILABLE');
    await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'SERVICE_UNAVAILABLE');
    assert.deepEqual(countsDouble(f), before);
    f.sql.close();
  });
}

test('B4 commit guard refuses when the release row stops naming the prepared domain', async () => {
  const { f, u, a } = await automaticSetup();
  const before = countsDouble(f);
  f.sql.exec('DROP TRIGGER IF EXISTS qc_releases_transition');
  const row = JSON.parse(f.sql.prepare('SELECT json AS v FROM qc_releases').get().v);
  row.domain_sha256 = 'd'.repeat(64);
  f.sql.prepare('UPDATE qc_releases SET json=?').run(JSON.stringify(row));
  await assert.rejects(store.finalizeQC(f.env.DB, f.ctx, a, u.result.revision, f.now), e => e.code === 'CONFLICT');
  assert.deepEqual(countsDouble(f), before);
  f.sql.close();
});
