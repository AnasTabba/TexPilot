import test from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { recallQCDecisions } from '../server/qc-recalls.mjs';

// Every workspace, release, decision, evidence row and incident below is a test double. No
// production decision, recall, recipient or delivery exists on this machine, and nothing is sent.
const NOW = 1_800_000_000_000;
const RELEASE_SHA = 'c'.repeat(64);
const MANIFEST = 'e'.repeat(64);

// A second tenant (and the first) is built directly so the same release id and domain id exist in
// both workspaces: only the tenant boundary can keep their decisions apart.
function seedTenantDouble(sql, label, { domainId = 'defects', releaseId = crypto.randomUUID() } = {}) {
  const workspaceId = crypto.randomUUID(), adminId = crypto.randomUUID(), supervisorId = crypto.randomUUID(), now = NOW;
  sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(workspaceId, `${label} factory double`, now);
  const user = (id, name, role) => sql.prepare('INSERT INTO users(id,workspace_id,name,name_key,pin_hash,pin_salt,role,status,permissions,created_at,created_by,portal_role,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, workspaceId, name, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'hash-double', 'salt-double', role === 'admin' ? 'admin' : 'member', 'active', '[]', now, 'system:seed', role, now);
  user(adminId, `${label} Admin`, 'admin');
  user(supervisorId, `${label} Supervisor`, 'supervisor');
  const supplierId = crypto.randomUUID();
  sql.prepare('INSERT INTO suppliers(id,workspace_id,name,contact_name,email,phone,city,website,source_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(supplierId, workspaceId, `${label} mill double`, 'Contact', `${supplierId}@mill.test`, '+923001234567', 'Karachi', '', '', 'approved', now, now);
  const rfqId = crypto.randomUUID();
  sql.prepare(`INSERT INTO procurement_rfqs(id,workspace_id,reference,title,category_id,specifications,quantity_milli,unit,delivery_location,deadline_at,requested_delivery_at,status,request_hash,created_by,created_at,published_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`)
    .run(rfqId, workspaceId, `RFQ-${rfqId.slice(0, 8)}`, 'Cotton double', 'cotton', '30/1 double', 1_000_000, 'kg', 'Karachi', now + 86_400_000, now + 86_400_000, rfqId, adminId, now, now, now);
  sql.prepare('INSERT INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) VALUES(?,?,?,?)').run(rfqId, supplierId, '{}', now);
  const bidId = crypto.randomUUID();
  sql.prepare(`INSERT INTO supplier_bids(id,rfq_id,supplier_id,quantity_milli,price_minor,currency,payment_terms,delivery_at,valid_until,note,version,status,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,'submitted',?,?,?)`)
    .run(bidId, rfqId, supplierId, 1_000_000, 125_000, 'PKR', 'Net 30', now + 86_400_000, now + 86_400_000, 'Test double', adminId, now, now);
  const orderId = crypto.randomUUID();
  sql.prepare(`INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at,quantity_milli,total_minor,approval_status,version,updated_at,created_by)
    VALUES(?,?,?,?,?,?,?,'accepted',?,?,?,?,'approved',1,?,?)`)
    .run(orderId, workspaceId, rfqId, bidId, supplierId, `PO-${orderId.slice(0, 8)}`, '{}', adminId, now, 1_000_000, 125_000, now, adminId);
  sql.prepare("UPDATE procurement_rfqs SET status='awarded' WHERE id=?").run(rfqId);
  const specId = crypto.randomUUID();
  sql.prepare('INSERT INTO qc_po_specs(workspace_id,id,version,purchase_order_id,content_sha256,json,candidates_json,confirmed_by,reason,created_at) VALUES(?,?,1,?,?,?,?,?,?,?)')
    .run(workspaceId, specId, orderId, 'd'.repeat(64), '{}', '[]', adminId, 'Recall double specification', now);
  const releaseJson = { schema_version: '2', id: releaseId, workspace_id: workspaceId, monitoring_protocol_sha256: null };
  sql.prepare("INSERT INTO qc_releases(workspace_id,id,state,sha256,json,domain_json,policy_json,expires_at,created_by,created_at,updated_at) VALUES(?,?,'STATISTICAL_CANDIDATE',?,?,?,?,?,?,?,?)")
    .run(workspaceId, releaseId, RELEASE_SHA, JSON.stringify(releaseJson), '{}', '{}', now + 30 * 86_400_000, adminId, now, now);
  sql.prepare("UPDATE qc_releases SET state='ACTIVE',activated_by=?,updated_at=? WHERE workspace_id=? AND id=?").run(adminId, now, workspaceId, releaseId);
  return { workspaceId, adminId, supervisorId, orderId, specId, releaseId, domainId };
}

function decisionDouble(sql, tenant, { createdAt, domainId = tenant.domainId, manifest = MANIFEST } = {}) {
  const { workspaceId, adminId, orderId, specId, releaseId } = tenant;
  const selectionId = crypto.randomUUID(), sampleId = crypto.randomUUID(), setId = crypto.randomUUID(), evidenceId = crypto.randomUUID(), id = crypto.randomUUID();
  sql.prepare('INSERT INTO qc_selections(workspace_id,id,purchase_order_id,cohort,json,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(workspaceId, selectionId, orderId, 'OPERATIONAL', '{}', adminId, createdAt);
  sql.prepare("INSERT INTO qc_samples(workspace_id,id,selection_id,purchase_order_id,spec_id,spec_version,revision,capture_attempt,disposition,created_by,created_at) VALUES(?,?,?,?,?,?,0,0,'SELECTED',?,?)")
    .run(workspaceId, sampleId, selectionId, orderId, specId, 1, adminId, createdAt);
  sql.prepare("INSERT INTO qc_capture_sets(workspace_id,id,sample_id,state,required_roles,revision,created_by,created_at) VALUES(?,?,?,'OPEN','[]',0,?,?)").run(workspaceId, setId, sampleId, adminId, createdAt);
  sql.prepare("UPDATE qc_capture_sets SET state='CLOSED',attempt=1,closed_at=? WHERE workspace_id=? AND id=?").run(createdAt, workspaceId, setId);
  const evidence = { manifest_sha256: manifest };
  sql.prepare('INSERT INTO qc_evidence(workspace_id,id,sample_id,capture_set_id,spec_id,spec_version,manifest_sha256,json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(workspaceId, evidenceId, sampleId, setId, specId, 1, manifest, JSON.stringify(evidence), createdAt);
  sql.prepare('INSERT INTO qc_decisions(workspace_id,id,sample_id,evidence_id,spec_id,spec_version,revision,status,automatic,release_id,domain_id,policy_version,request_id,json,created_by,created_at) VALUES(?,?,?,?,?,?,1,?,1,?,?,?,?,?,?,?)')
    .run(workspaceId, id, sampleId, evidenceId, specId, 1, 'ACCEPT', releaseId, domainId, 'policy-double-1', crypto.randomUUID(), JSON.stringify({ schema_version: '2', id }), adminId, createdAt);
  return id;
}

function incidentDouble(sql, tenant, { cutoffAt = NOW - 1000, kind = `DRIFT:${tenant.domainId}`, detail = { release_sha256: RELEASE_SHA } } = {}) {
  const id = crypto.randomUUID();
  sql.prepare('INSERT INTO qc_incidents(workspace_id,id,release_id,domain_id,kind,cutoff_at,protocol_sha256,detail_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(tenant.workspaceId, id, tenant.releaseId, tenant.domainId, kind, cutoffAt, null, JSON.stringify(detail), 'system:test-double', cutoffAt);
  return id;
}

const snapshot = sql => sql.prepare('SELECT * FROM qc_decisions ORDER BY workspace_id,id').all().map(row => ({ ...row }));
const count = (sql, table, where = '', ...args) => sql.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ' WHERE ' + where : ''}`).get(...args).n;

test('250 decisions in one tenant are recalled exhaustively; the other tenant and other slices stay untouched', async t => {
  const f = await portalFixture(); t.after(() => f.sql.close());
  const alpha = seedTenantDouble(f.sql, 'Alpha', { domainId: 'defects' });
  // Same release id and domain id in a second workspace: only workspace_id separates the tenants.
  const bravo = seedTenantDouble(f.sql, 'Bravo', { domainId: 'defects', releaseId: alpha.releaseId });
  const intended = [];
  for (let i = 0; i < 250; i++) intended.push(decisionDouble(f.sql, alpha, { createdAt: NOW - 300_000 + i }));
  const afterCutoff = decisionDouble(f.sql, alpha, { createdAt: NOW - 100 });
  const otherDomain = decisionDouble(f.sql, alpha, { domainId: 'fabric', createdAt: NOW - 5000 });
  const foreign = [];
  for (let i = 0; i < 40; i++) foreign.push(decisionDouble(f.sql, bravo, { createdAt: NOW - 5000 + i }));
  const incident = incidentDouble(f.sql, alpha, { cutoffAt: NOW - 1000 });
  const before = snapshot(f.sql);

  const report = await recallQCDecisions(f.env.DB, { id: incident, workspace_id: alpha.workspaceId }, NOW);
  assert.equal(report.incident_id, incident);
  assert.equal(report.recalled, 250);
  assert.equal(report.total_recalled, 250);
  assert.equal(report.pages, 3);
  assert.equal(report.recalled_decision_ids.length, 250);
  assert.deepEqual(new Set(report.recalled_decision_ids), new Set(intended));

  assert.equal(count(f.sql, 'qc_recalls', 'workspace_id=? AND incident_id=?', alpha.workspaceId, incident), 250);
  assert.equal(count(f.sql, 'qc_recalls', 'workspace_id=?', bravo.workspaceId), 0);
  assert.equal(count(f.sql, 'qc_recalls', 'decision_id IN (?,?,?)', afterCutoff, otherDomain, foreign[0]), 0);
  // The original decision rows are never updated or deleted.
  assert.deepEqual(snapshot(f.sql), before);
  assert.equal(count(f.sql, 'qc_decisions'), 292);

  // One outbox row per (incident, intended recipient); nothing sent, nothing foreign.
  const outbox = f.sql.prepare('SELECT * FROM qc_recall_outbox WHERE workspace_id=? AND incident_id=? ORDER BY recipient_id').all(alpha.workspaceId, incident);
  assert.equal(outbox.length, 2);
  assert.deepEqual(outbox.map(row => row.recipient_id), [alpha.adminId, alpha.supervisorId].sort());
  assert.ok(outbox.every(row => row.state === 'PENDING' && row.attempts === 0 && row.delivered_at === null && row.acked_at === null));
  assert.equal(count(f.sql, 'qc_recall_outbox', 'workspace_id=?', bravo.workspaceId), 0);
  assert.equal(report.notifications.created, 2);
  assert.equal(report.notifications.pending, 2);
  assert.equal(report.notifications.acked, 0);

  // Replay is idempotent: no second recall row, notice or decision change.
  const replay = await recallQCDecisions(f.env.DB, { id: incident, workspace_id: alpha.workspaceId }, NOW + 1000);
  assert.equal(replay.recalled, 0);
  assert.equal(replay.total_recalled, 250);
  assert.equal(replay.notifications.created, 0);
  assert.equal(count(f.sql, 'qc_recalls', 'workspace_id=? AND incident_id=?', alpha.workspaceId, incident), 250);
  assert.equal(count(f.sql, 'qc_recall_outbox', 'workspace_id=? AND incident_id=?', alpha.workspaceId, incident), 2);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM qc_decision_events WHERE event='recall.recorded'").get().n, 1);
  assert.deepEqual(snapshot(f.sql), before);

  // The notify owner delivers/acks outside this module; the report exposes that status without sending.
  f.sql.prepare("UPDATE qc_recall_outbox SET state='DELIVERED',delivered_at=?,acked_at=?,updated_at=? WHERE workspace_id=? AND incident_id=? AND recipient_id=?").run(NOW + 2000, NOW + 2000, NOW + 2000, alpha.workspaceId, incident, alpha.adminId);
  f.sql.prepare("UPDATE qc_recall_outbox SET state='FAILED',attempts=3,updated_at=? WHERE workspace_id=? AND incident_id=? AND recipient_id=?").run(NOW + 2000, alpha.workspaceId, incident, alpha.supervisorId);
  const status = await recallQCDecisions(f.env.DB, { id: incident, workspace_id: alpha.workspaceId }, NOW + 3000);
  assert.equal(status.notifications.delivered, 1);
  assert.equal(status.notifications.failed, 1);
  assert.equal(status.notifications.acked, 1);
  assert.equal(status.notifications.pending, 0);
  assert.equal(count(f.sql, 'qc_recalls', 'workspace_id=? AND incident_id=?', alpha.workspaceId, incident), 250);
});

test('an incident only recalls its own workspace, even with the same release id', async t => {
  const f = await portalFixture(); t.after(() => f.sql.close());
  const alpha = seedTenantDouble(f.sql, 'Alpha', { domainId: 'defects' });
  const bravo = seedTenantDouble(f.sql, 'Bravo', { domainId: 'defects', releaseId: alpha.releaseId });
  for (let i = 0; i < 3; i++) decisionDouble(f.sql, alpha, { createdAt: NOW - 5000 + i });
  const foreign = [];
  for (let i = 0; i < 4; i++) foreign.push(decisionDouble(f.sql, bravo, { createdAt: NOW - 5000 + i }));
  const incident = incidentDouble(f.sql, bravo, { cutoffAt: NOW - 1000 });
  const report = await recallQCDecisions(f.env.DB, { id: incident, workspace_id: bravo.workspaceId }, NOW);
  assert.equal(report.recalled, 4);
  assert.deepEqual(new Set(report.recalled_decision_ids), new Set(foreign));
  assert.equal(count(f.sql, 'qc_recalls', 'workspace_id=?', alpha.workspaceId), 0);
  assert.equal(count(f.sql, 'qc_recalls', 'workspace_id=? AND incident_id=?', bravo.workspaceId, incident), 4);
});

test('an incident artifact hash narrows the recall to decisions bound to that artifact', async t => {
  const f = await portalFixture(); t.after(() => f.sql.close());
  const tenant = seedTenantDouble(f.sql, 'Alpha');
  const first = 'f'.repeat(64), second = '0'.repeat(64);
  const matches = [decisionDouble(f.sql, tenant, { createdAt: NOW - 5000, manifest: first }), decisionDouble(f.sql, tenant, { createdAt: NOW - 4000, manifest: first })];
  const other = decisionDouble(f.sql, tenant, { createdAt: NOW - 3000, manifest: second });
  const incident = incidentDouble(f.sql, tenant, { cutoffAt: NOW - 1000, detail: { release_sha256: RELEASE_SHA, artifact_sha256: first } });
  const report = await recallQCDecisions(f.env.DB, { id: incident, workspace_id: tenant.workspaceId }, NOW);
  assert.equal(report.recalled, 2);
  assert.deepEqual(new Set(report.recalled_decision_ids), new Set(matches));
  assert.equal(count(f.sql, 'qc_recalls', 'decision_id=?', other), 0);
});

test('a missing incident recalls nothing; an unknown or foreign incident is not trusted', async t => {
  const f = await portalFixture(); t.after(() => f.sql.close());
  const tenant = seedTenantDouble(f.sql, 'Alpha');
  for (let i = 0; i < 3; i++) decisionDouble(f.sql, tenant, { createdAt: NOW - 5000 + i });
  await assert.rejects(recallQCDecisions(f.env.DB, { id: crypto.randomUUID(), workspace_id: tenant.workspaceId }, NOW), error => error.code === 'NOT_FOUND');
  assert.equal(count(f.sql, 'qc_recalls'), 0);
  assert.equal(count(f.sql, 'qc_recall_outbox'), 0);
});

test('explicit intended recipients are honoured; a foreign recipient is refused before any recall', async t => {
  const f = await portalFixture(); t.after(() => f.sql.close());
  const alpha = seedTenantDouble(f.sql, 'Alpha'), bravo = seedTenantDouble(f.sql, 'Bravo', { releaseId: alpha.releaseId });
  decisionDouble(f.sql, alpha, { createdAt: NOW - 5000 });
  const explicit = incidentDouble(f.sql, alpha, { cutoffAt: NOW - 1000, detail: { release_sha256: RELEASE_SHA, recipients: [alpha.supervisorId] } });
  const report = await recallQCDecisions(f.env.DB, { id: explicit, workspace_id: alpha.workspaceId }, NOW);
  assert.equal(report.notifications.created, 1);
  assert.equal(count(f.sql, 'qc_recall_outbox', 'incident_id=?', explicit), 1);
  const foreign = incidentDouble(f.sql, alpha, { cutoffAt: NOW - 1000, kind: 'RECIPIENT_CHECK', detail: { release_sha256: RELEASE_SHA, recipients: [bravo.adminId] } });
  await assert.rejects(recallQCDecisions(f.env.DB, { id: foreign, workspace_id: alpha.workspaceId }, NOW), error => error.code === 'VALIDATION_FAILED');
  assert.equal(count(f.sql, 'qc_recalls', 'incident_id=?', foreign), 0);
  assert.equal(count(f.sql, 'qc_recall_outbox', 'incident_id=?', foreign), 0);
});
