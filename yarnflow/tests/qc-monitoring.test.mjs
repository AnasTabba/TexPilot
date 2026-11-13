import test from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { contentSha256 } from '../server/qc-contract.mjs';
import { evaluateQCMonitoring, monitoringScheduled } from '../server/qc-monitoring.mjs';

// Everything inserted here is a test double: no approved monitoring protocol, release, audit or
// production telemetry exists on this machine. The doubles only exercise the module's mechanics.
const HEX = 'a'.repeat(64);
const NOW = 1_800_000_000_000;
const HOUR = 3600000;

function protocolDouble({ workspaceId, releaseId, domains, minimumSupport = 20, staleTelemetryMs = 30 * 60000, windowMs = HOUR }) {
  return {
    schema_version: '2', id: crypto.randomUUID(), version: 'monitoring-double-1', workspace_id: workspaceId, release_id: releaseId,
    window_ms: windowMs, cadence_ms: 10 * 60000, minimum_support: minimumSupport, stale_telemetry_ms: staleTelemetryMs,
    audit_probability_min: 0.05, max_detection_delay_ms: 2 * HOUR, approved_by: 'authority:test-double', approved_at: '2026-11-13T00:00:00Z', domains,
  };
}

async function setupDouble({ domains = [{ domain_id: 'defects', metric: 'AUDIT_DISAGREE_RATE', trigger_at_or_above: 0.2 }], ...options } = {}) {
  const f = await portalFixture();
  const releaseId = crypto.randomUUID(), supplierId = await f.insertSupplier({ status: 'approved' }), { orderId } = await f.insertPO({ supplierId });
  const specId = crypto.randomUUID();
  f.sql.prepare('INSERT INTO qc_po_specs(workspace_id,id,version,purchase_order_id,content_sha256,json,candidates_json,confirmed_by,reason,created_at) VALUES(?,?,1,?,?,?,?,?,?,?)')
    .run(f.workspaceId, specId, orderId, HEX, '{}', '[]', f.adminId, 'Monitoring double specification', NOW);
  const protocol = protocolDouble({ workspaceId: f.workspaceId, releaseId, domains, ...options });
  protocol.sha256 = await contentSha256(protocol, ['sha256']);
  const releaseJson = { schema_version: '2', id: releaseId, workspace_id: f.workspaceId, monitoring_protocol_sha256: protocol.sha256 };
  f.sql.prepare("INSERT INTO qc_releases(workspace_id,id,state,sha256,json,domain_json,policy_json,expires_at,created_by,created_at,updated_at) VALUES(?,?,'STATISTICAL_CANDIDATE',?,?,?,?,?,?,?,?)")
    .run(f.workspaceId, releaseId, 'b'.repeat(64), JSON.stringify(releaseJson), '{}', '{}', NOW + 30 * 24 * HOUR, f.adminId, NOW, NOW);
  f.sql.prepare('INSERT INTO qc_monitoring_protocols(workspace_id,id,version,release_id,sha256,json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(f.workspaceId, protocol.id, protocol.version, releaseId, protocol.sha256, JSON.stringify(protocol), f.adminId, NOW);
  f.sql.prepare("UPDATE qc_releases SET state='ACTIVE',activated_by=?,updated_at=? WHERE workspace_id=? AND id=?").run(f.adminId, NOW, f.workspaceId, releaseId);
  return { f, releaseId, specId, orderId, protocol };
}

// One automatic ACCEPT decision, with all parent rows a test double needs. Returns the decision id.
function decisionDouble(f, { releaseId, specId, orderId, domainId, createdAt, evidence = { manifest_sha256: HEX } }) {
  const selectionId = crypto.randomUUID(), sampleId = crypto.randomUUID(), setId = crypto.randomUUID(), evidenceId = crypto.randomUUID(), id = crypto.randomUUID();
  f.sql.prepare('INSERT INTO qc_selections(workspace_id,id,purchase_order_id,cohort,json,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(f.workspaceId, selectionId, orderId, 'OPERATIONAL', '{}', f.adminId, createdAt);
  f.sql.prepare("INSERT INTO qc_samples(workspace_id,id,selection_id,purchase_order_id,spec_id,spec_version,revision,capture_attempt,disposition,created_by,created_at) VALUES(?,?,?,?,?,?,0,0,'SELECTED',?,?)")
    .run(f.workspaceId, sampleId, selectionId, orderId, specId, 1, f.adminId, createdAt);
  f.sql.prepare("INSERT INTO qc_capture_sets(workspace_id,id,sample_id,state,required_roles,revision,created_by,created_at) VALUES(?,?,?,'OPEN','[]',0,?,?)").run(f.workspaceId, setId, sampleId, f.adminId, createdAt);
  f.sql.prepare("UPDATE qc_capture_sets SET state='CLOSED',attempt=1,closed_at=? WHERE workspace_id=? AND id=?").run(createdAt, f.workspaceId, setId);
  f.sql.prepare('INSERT INTO qc_evidence(workspace_id,id,sample_id,capture_set_id,spec_id,spec_version,manifest_sha256,json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(f.workspaceId, evidenceId, sampleId, setId, specId, 1, evidence.manifest_sha256, JSON.stringify(evidence), createdAt);
  f.sql.prepare('INSERT INTO qc_decisions(workspace_id,id,sample_id,evidence_id,spec_id,spec_version,revision,status,automatic,release_id,domain_id,policy_version,request_id,json,created_by,created_at) VALUES(?,?,?,?,?,?,1,?,1,?,?,?,?,?,?,?)')
    .run(f.workspaceId, id, sampleId, evidenceId, specId, 1, 'ACCEPT', releaseId, domainId, 'policy-double-1', crypto.randomUUID(), JSON.stringify({ schema_version: '2', id }), f.adminId, createdAt);
  return id;
}

function auditDouble(f, decisionId, outcome, createdAt) {
  f.sql.prepare('INSERT INTO qc_audit_results(workspace_id,id,decision_id,outcome,sampling_probability,auditor_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(f.workspaceId, crypto.randomUUID(), decisionId, outcome, 0.1, 'auditor:test-double', createdAt);
}

// n automatic decisions in one domain, with `disagree` of them audited DISAGREE and the rest AGREE.
function streamDouble(f, ctx, { domainId = 'defects', n = 30, disagree = 0, audited = n, decisionAt = NOW - 10 * 60000, auditAt = NOW - 5 * 60000 } = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(decisionDouble(f, { ...ctx, domainId, createdAt: decisionAt + i }));
  for (let i = 0; i < audited; i++) auditDouble(f, ids[i], i < disagree ? 'DISAGREE' : 'AGREE', auditAt + i);
  return ids;
}

test('normal stream: enough fresh audits below the approved trigger leave the release active', async t => {
  const ctx = await setupDouble(); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, disagree: 2 });
  const incidents = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  assert.deepEqual(incidents, []);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'ACTIVE');
  const run = ctx.f.sql.prepare('SELECT * FROM qc_monitoring_runs').get();
  assert.equal(run.state, 'OK');
  const counters = JSON.parse(run.counters_json).domains[0];
  assert.equal(counters.automatic_decisions, 30);
  assert.equal(counters.audited_decisions, 30);
  assert.equal(counters.disagree, 2);
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_incidents').get().n, 0);
});

test('shifted stream: one incident for the affected domain suspends its release by an audited event', async t => {
  const ctx = await setupDouble({ domains: [
    { domain_id: 'defects', metric: 'AUDIT_DISAGREE_RATE', trigger_at_or_above: 0.2 },
    { domain_id: 'fabric', metric: 'AUDIT_DISAGREE_RATE', trigger_at_or_above: 0.2 },
  ] }); t.after(() => ctx.f.sql.close());
  const defects = streamDouble(ctx.f, ctx, { domainId: 'defects', n: 30, disagree: 15 });
  streamDouble(ctx.f, ctx, { domainId: 'fabric', n: 30, disagree: 0 });
  const incidents = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].domain_id, 'defects');
  assert.match(incidents[0].kind, /^DRIFT:/);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'SUSPENDED');
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_incidents').get().n, 1);
  assert.equal(ctx.f.sql.prepare("SELECT COUNT(*) AS n FROM qc_incidents WHERE domain_id='fabric'").get().n, 0);
  const events = ctx.f.sql.prepare('SELECT event,record_id FROM qc_decision_events ORDER BY event').all();
  assert.deepEqual(events.map(e => e.event), ['monitoring.incident', 'release.suspended']);
  assert.equal(events.find(e => e.event === 'release.suspended').record_id, ctx.releaseId);
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_recalls').get().n, 0);
  assert.ok(defects.length);
});

test('sparse stream: below minimum support is its own incident kind, never a drift verdict', async t => {
  const ctx = await setupDouble(); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, audited: 5, disagree: 5 });
  const incidents = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  assert.equal(incidents.length, 1);
  assert.match(incidents[0].kind, /^SPARSE_SUPPORT:/);
  assert.equal(JSON.parse(incidents[0].detail_json).observed, null);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'SUSPENDED');
});

test('missing telemetry: automatic decisions without audits is its own incident kind', async t => {
  const ctx = await setupDouble(); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, audited: 0 });
  const incidents = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  assert.equal(incidents.length, 1);
  assert.match(incidents[0].kind, /^TELEMETRY_MISSING:/);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'SUSPENDED');
});

test('stale telemetry: audits older than the approved freshness budget are their own incident', async t => {
  const ctx = await setupDouble({ staleTelemetryMs: 10 * 60000, windowMs: 4 * HOUR }); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, disagree: 0, decisionAt: NOW - 3 * HOUR, auditAt: NOW - 2 * HOUR });
  const incidents = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  assert.equal(incidents.length, 1);
  assert.match(incidents[0].kind, /^TELEMETRY_STALE:/);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'SUSPENDED');
});

test('idempotent replay: the same inputs never duplicate an incident, event or suspension', async t => {
  const ctx = await setupDouble(); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, disagree: 15 });
  const first = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  const second = await evaluateQCMonitoring(ctx.f.env.DB, ctx.protocol, NOW);
  assert.deepEqual(second.map(i => i.id), first.map(i => i.id));
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_incidents').get().n, 1);
  assert.equal(ctx.f.sql.prepare("SELECT COUNT(*) AS n FROM qc_decision_events WHERE event='monitoring.incident'").get().n, 1);
  assert.equal(ctx.f.sql.prepare("SELECT COUNT(*) AS n FROM qc_decision_events WHERE event='release.suspended'").get().n, 1);
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_monitoring_runs').get().n, 1);
});

test('no approved protocol: missing, unregistered or invalid input changes nothing', async t => {
  const ctx = await setupDouble(); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, disagree: 30 });
  await assert.rejects(evaluateQCMonitoring(ctx.f.env.DB, undefined, NOW), /No approved monitoring protocol/);
  await assert.rejects(evaluateQCMonitoring(ctx.f.env.DB, { ...ctx.protocol, id: crypto.randomUUID() }, NOW), /No approved monitoring protocol/);
  const { minimum_support: _, ...incomplete } = ctx.protocol;
  await assert.rejects(evaluateQCMonitoring(ctx.f.env.DB, incomplete, NOW), /No approved monitoring protocol/);
  await assert.rejects(evaluateQCMonitoring(ctx.f.env.DB, { ...ctx.protocol, domains: [{ ...ctx.protocol.domains[0], metric: 'INVENTED' }] }, NOW), /No approved monitoring protocol/);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'ACTIVE');
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_incidents').get().n, 0);
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_monitoring_runs').get().n, 0);
});

test('scheduled monitoring evaluates only the approved protocol bound to an active release', async t => {
  const ctx = await setupDouble(); t.after(() => ctx.f.sql.close());
  streamDouble(ctx.f, ctx, { n: 30, disagree: 15 });
  const first = await monitoringScheduled(ctx.f.env, NOW);
  assert.equal(first.checked, 1);
  assert.equal(first.incidents, 1);
  assert.equal(ctx.f.sql.prepare('SELECT state FROM qc_releases WHERE id=?').get(ctx.releaseId).state, 'SUSPENDED');
  const second = await monitoringScheduled(ctx.f.env, NOW + 1000);
  assert.equal(second.checked, 0);
  assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM qc_incidents').get().n, 1);
});
