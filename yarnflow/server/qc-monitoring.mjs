/**
 * T12 monitoring: per-domain drift/telemetry evaluation over the existing scheduled Worker.
 *
 * `evaluateQCMonitoring(db, protocol, now) -> Promise<Incident[]>` consumes one versioned,
 * registered MonitoringProtocol supplied by the caller. There is no default protocol and no
 * numeric threshold in this file: every counter, denominator, window, minimum support, freshness
 * budget and per-domain trigger is read from the protocol. A missing, unregistered, altered or
 * incomplete protocol raises `SERVICE_UNAVAILABLE` ("No approved monitoring protocol") and
 * changes nothing; it never activates or suspends a release by guesswork.
 *
 * Protocol shape (all fields required, no extra fields):
 *   {schema_version:'2', id, version, workspace_id, release_id, window_ms, cadence_ms,
 *    minimum_support, stale_telemetry_ms, audit_probability_min, max_detection_delay_ms,
 *    approved_by, approved_at, domains:[{domain_id, metric, trigger_at_or_above}], sha256}
 * `metric` is AUDIT_DISAGREE_RATE (disagreements / audited decisions) or
 * AUDIT_DISAGREE_COUNT (disagreements). `sha256` is the canonical content hash without itself.
 * `cadence_ms` is the scheduler's cadence; evaluation is idempotent per (protocol, window).
 *
 * Per-domain precedence, so one domain never yields two incidents:
 *   no automatic decisions -> not evaluated (NO_ACTIVITY, no incident)
 *   no audits              -> TELEMETRY_MISSING
 *   untrusted/stale audits -> TELEMETRY_STALE
 *   audited < support      -> SPARSE_SUPPORT
 *   metric >= trigger      -> DRIFT
 * Every incident suspends the release that the protocol binds (design §11, §18: pending, sparse,
 * stale or missing telemetry cannot support continued automatic authority). Suspension is a state
 * change plus append-only `qc_decision_events`; re-running the same window writes no second
 * incident, event or suspension. Incidents are scoped to a domain and tenant; unaffected domains
 * get no incident, no event and no recall.
 *
 * `monitoringScheduled(env, now)` is the cron entry: it evaluates only protocols whose hash the
 * ACTIVE release binds. No registered protocol means nothing runs.
 */
import { all, one, query } from './erp-utils.mjs';
import { contentSha256 } from './qc-contract.mjs';
import { QCProblem, qcFail } from './qc-store.mjs';

const SYSTEM = 'system:qc-monitoring';
const METRICS = new Set(['AUDIT_DISAGREE_RATE', 'AUDIT_DISAGREE_COUNT']);
const PROTOCOL_KEYS = ['schema_version', 'id', 'version', 'workspace_id', 'release_id', 'window_ms', 'cadence_ms', 'minimum_support', 'stale_telemetry_ms', 'audit_probability_min', 'max_detection_delay_ms', 'approved_by', 'approved_at', 'domains', 'sha256'];
const RULE_KEYS = ['domain_id', 'metric', 'trigger_at_or_above'];
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
const isInteger = (value, min = 1) => Number.isSafeInteger(value) && value >= min;
const isHex64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const reject = detail => qcFail('SERVICE_UNAVAILABLE', [], `No approved monitoring protocol: ${detail}.`);
const guard = (db, sql, ...args) => query(db, `SELECT json('!') WHERE NOT EXISTS(${sql})`, ...args);
const incidentOf = row => ({ ...row, detail: JSON.parse(row.detail_json) });

/** Shape and hash first: a protocol that cannot be read exactly is not an approved protocol. */
async function validateProtocol(protocol) {
  if (!isObject(protocol)) reject('the protocol is missing');
  for (const key of PROTOCOL_KEYS) if (!Object.hasOwn(protocol, key)) reject(`the protocol has no ${key}`);
  for (const key of Object.keys(protocol)) if (!PROTOCOL_KEYS.includes(key)) reject(`the protocol has an unknown field ${key}`);
  if (protocol.schema_version !== '2') reject('the protocol schema version is not 2');
  for (const key of ['id', 'version', 'workspace_id', 'release_id', 'approved_by']) if (!isText(protocol[key])) reject(`the protocol ${key} is invalid`);
  if (typeof protocol.approved_at !== 'string' || !UTC.test(protocol.approved_at)) reject('the protocol approved_at is not UTC RFC 3339');
  for (const key of ['window_ms', 'cadence_ms', 'minimum_support', 'stale_telemetry_ms', 'max_detection_delay_ms']) if (!isInteger(protocol[key])) reject(`the protocol ${key} is not a positive whole number`);
  if (typeof protocol.audit_probability_min !== 'number' || !(protocol.audit_probability_min > 0 && protocol.audit_probability_min <= 1)) reject('the protocol audit_probability_min is not a probability');
  if (!Array.isArray(protocol.domains) || protocol.domains.length < 1 || protocol.domains.length > 64) reject('the protocol has no domain rules');
  const seen = new Set();
  for (const rule of protocol.domains) {
    if (!isObject(rule)) reject('a domain rule is not an object');
    for (const key of RULE_KEYS) if (!Object.hasOwn(rule, key)) reject(`a domain rule has no ${key}`);
    for (const key of Object.keys(rule)) if (!RULE_KEYS.includes(key)) reject(`a domain rule has an unknown field ${key}`);
    if (!isText(rule.domain_id)) reject('a domain rule id is invalid');
    if (seen.has(rule.domain_id)) reject(`the protocol repeats domain ${rule.domain_id}`);
    seen.add(rule.domain_id);
    if (!METRICS.has(rule.metric)) reject(`the protocol metric ${rule.metric} is not defined`);
    if (typeof rule.trigger_at_or_above !== 'number' || !Number.isFinite(rule.trigger_at_or_above)) reject('a trigger threshold is not a finite number');
    if (rule.metric === 'AUDIT_DISAGREE_RATE' && !(rule.trigger_at_or_above >= 0 && rule.trigger_at_or_above <= 1)) reject('a rate trigger is outside [0,1]');
    if (rule.metric === 'AUDIT_DISAGREE_COUNT' && !isInteger(rule.trigger_at_or_above, 0)) reject('a count trigger is not a non-negative whole number');
  }
  if (!isHex64(protocol.sha256)) reject('the protocol sha256 is not SHA-256');
  const expected = await contentSha256(protocol, ['sha256']);
  if (protocol.sha256 !== expected) reject('the protocol hash does not match its content');
  return expected;
}

/** Registered, hash-matching, release-bound and active: otherwise there is no approved protocol. */
async function loadApprovedProtocol(db, protocol) {
  const sha = await validateProtocol(protocol), w = protocol.workspace_id;
  const row = await one(db, 'SELECT * FROM qc_monitoring_protocols WHERE workspace_id=? AND id=?', w, protocol.id);
  if (!row) reject('the protocol is not registered in this workspace');
  if (row.version !== protocol.version || row.release_id !== protocol.release_id || row.sha256 !== sha) reject('the registered protocol does not match the supplied version');
  let stored;
  try { stored = JSON.parse(row.json); } catch { reject('the registered protocol is not JSON'); }
  if (await contentSha256(stored, ['sha256']) !== sha) reject('the registered protocol content does not match its hash');
  const release = await one(db, 'SELECT * FROM qc_releases WHERE workspace_id=? AND id=?', w, protocol.release_id);
  if (!release) reject('the protocol release does not exist');
  if (!['ACTIVE', 'SUSPENDED'].includes(release.state)) reject('the protocol release is not active');
  let releaseJson;
  try { releaseJson = JSON.parse(release.json); } catch { reject('the release record is not JSON'); }
  if (releaseJson.monitoring_protocol_sha256 !== sha) reject('the release does not bind this monitoring protocol');
  return { sha, release };
}

async function countersFor(db, protocol, domainId, start, end) {
  const w = protocol.workspace_id;
  const { n: automatic } = await one(db, `SELECT COUNT(*) AS n FROM qc_decisions
    WHERE workspace_id=? AND release_id=? AND domain_id=? AND automatic=1 AND created_at>? AND created_at<=?`, w, protocol.release_id, domainId, start, end);
  const audits = await all(db, `SELECT a.outcome, a.sampling_probability, a.created_at FROM qc_audit_results a
    JOIN qc_decisions d ON d.workspace_id=a.workspace_id AND d.id=a.decision_id
    WHERE d.workspace_id=? AND d.release_id=? AND d.domain_id=? AND d.automatic=1 AND d.created_at>? AND d.created_at<=?`, w, protocol.release_id, domainId, start, end);
  const agree = audits.filter(row => row.outcome === 'AGREE').length, disagree = audits.filter(row => row.outcome === 'DISAGREE').length;
  const invalid = audits.filter(row => !(row.sampling_probability >= protocol.audit_probability_min)).length;
  const latest = audits.reduce((max, row) => Math.max(max, row.created_at), 0);
  return { automatic_decisions: automatic, audited_decisions: audits.length, agree, disagree, missing_audits: Math.max(0, automatic - audits.length), invalid_probability: invalid, latest_audit_at: latest || null };
}

/** Exactly one classification per domain, in the documented fail-closed order. */
function classify(protocol, rule, counters, now, start) {
  const base = { ...counters, metric: rule.metric, trigger_at_or_above: rule.trigger_at_or_above };
  if (counters.automatic_decisions === 0) return { kind: null, observed: null, counters: base };
  if (counters.audited_decisions === 0) return { kind: 'TELEMETRY_MISSING', observed: null, counters: base };
  const latest = counters.latest_audit_at;
  if (counters.invalid_probability > 0 || latest === null || latest > now || latest < start || now - latest > protocol.stale_telemetry_ms) return { kind: 'TELEMETRY_STALE', observed: null, counters: base };
  if (counters.audited_decisions < protocol.minimum_support) return { kind: 'SPARSE_SUPPORT', observed: null, counters: base };
  const observed = rule.metric === 'AUDIT_DISAGREE_RATE' ? counters.disagree / counters.audited_decisions : counters.disagree;
  return { kind: observed >= rule.trigger_at_or_above ? 'DRIFT' : null, observed, counters: base };
}

async function recordIncident(db, { protocol, release, rule, classification, now, start }) {
  const w = protocol.workspace_id, kind = `${classification.kind}:${rule.domain_id}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await one(db, 'SELECT * FROM qc_incidents WHERE workspace_id=? AND release_id=? AND kind=?', w, protocol.release_id, kind);
    if (existing) return incidentOf(existing);
    const current = await one(db, 'SELECT state FROM qc_releases WHERE workspace_id=? AND id=?', w, protocol.release_id);
    if (!current || !['ACTIVE', 'SUSPENDED'].includes(current.state)) throw new QCProblem('SERVICE_UNAVAILABLE', [], 'The monitored release changed state during monitoring; no incident was recorded.');
    const row = { workspace_id: w, id: crypto.randomUUID(), release_id: protocol.release_id, domain_id: rule.domain_id, kind, cutoff_at: now, protocol_sha256: protocol.sha256,
      detail_json: JSON.stringify({ protocol_id: protocol.id, protocol_version: protocol.version, protocol_sha256: protocol.sha256, release_id: protocol.release_id, release_sha256: release.sha256,
        domain_id: rule.domain_id, window_start: start, window_end: now, detected_at: now, metric: rule.metric, trigger_at_or_above: rule.trigger_at_or_above, observed: classification.observed, counters: classification.counters }),
      created_by: SYSTEM, created_at: now };
    const statements = [
      query(db, 'INSERT INTO qc_incidents(workspace_id,id,release_id,domain_id,kind,cutoff_at,protocol_sha256,detail_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        w, row.id, row.release_id, row.domain_id, row.kind, row.cutoff_at, row.protocol_sha256, row.detail_json, row.created_by, row.created_at),
      query(db, 'INSERT INTO qc_decision_events(id,workspace_id,sample_id,record_id,event,actor_id,actor_role,request_id,detail_json,reason,intervention_reason,created_at) VALUES(?,?,NULL,?,?,?,?,NULL,?,?,NULL,?)',
        crypto.randomUUID(), w, row.id, 'monitoring.incident', SYSTEM, 'system', row.detail_json, `${classification.kind} for ${rule.domain_id}`, now),
    ];
    if (current.state === 'ACTIVE') statements.push(
      guard(db, "SELECT 1 FROM qc_releases WHERE workspace_id=? AND id=? AND state='ACTIVE'", w, protocol.release_id),
      query(db, 'INSERT INTO qc_decision_events(id,workspace_id,sample_id,record_id,event,actor_id,actor_role,request_id,detail_json,reason,intervention_reason,created_at) VALUES(?,?,NULL,?,?,?,?,NULL,?,?,NULL,?)',
        crypto.randomUUID(), w, protocol.release_id, 'release.suspended', SYSTEM, 'system', JSON.stringify({ incident_id: row.id, kind, domain_id: rule.domain_id }), `Monitoring incident ${kind}`, now),
      query(db, "UPDATE qc_releases SET state='SUSPENDED',suspended_by=?,suspend_reason=?,updated_at=? WHERE workspace_id=? AND id=? AND state='ACTIVE'", SYSTEM, `Monitoring incident ${kind}`, now, w, protocol.release_id),
    );
    try { await db.batch(statements); } catch (error) {
      const again = await one(db, 'SELECT * FROM qc_incidents WHERE workspace_id=? AND release_id=? AND kind=?', w, protocol.release_id, kind);
      if (again) return incidentOf(again);
      if (attempt) throw error;
      continue;
    }
    const saved = await one(db, 'SELECT * FROM qc_incidents WHERE workspace_id=? AND id=?', w, row.id);
    if (!saved) throw new QCProblem('SERVICE_UNAVAILABLE', [], 'The monitoring incident could not be read back; nothing else was recorded.');
    if (current.state === 'ACTIVE') {
      const after = await one(db, 'SELECT state FROM qc_releases WHERE workspace_id=? AND id=?', w, protocol.release_id);
      if (after?.state !== 'SUSPENDED') throw new QCProblem('SERVICE_UNAVAILABLE', [], 'The monitored release was not suspended; review the incident before continuing.');
    }
    return incidentOf(saved);
  }
  throw new QCProblem('SERVICE_UNAVAILABLE', [], 'The monitoring incident could not be recorded because the release kept changing state.');
}

export async function evaluateQCMonitoring(db, protocol, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0) qcFail('VALIDATION_FAILED', [], 'Monitoring needs a valid UTC millisecond clock.');
  const { sha, release } = await loadApprovedProtocol(db, protocol);
  const start = now - protocol.window_ms, results = [];
  for (const rule of protocol.domains) {
    const counters = await countersFor(db, protocol, rule.domain_id, start, now);
    results.push({ rule, classification: classify(protocol, rule, counters, now, start) });
  }
  const incidents = [];
  for (const result of results) if (result.classification.kind) incidents.push(await recordIncident(db, { protocol, release, rule: result.rule, classification: result.classification, now, start }));
  const active = results.some(result => result.classification.counters.automatic_decisions > 0);
  const triggered = results.some(result => result.classification.kind === 'DRIFT');
  const insufficient = results.some(result => result.classification.kind && result.classification.kind !== 'DRIFT');
  const state = !active ? 'UNAVAILABLE' : triggered ? 'TRIGGERED' : insufficient ? 'INSUFFICIENT' : 'OK';
  const counters = results.map(result => ({ domain_id: result.rule.domain_id, metric: result.rule.metric, kind: result.classification.kind, ...result.classification.counters }));
  await query(db, 'INSERT OR IGNORE INTO qc_monitoring_runs(workspace_id,id,protocol_id,release_id,window_start,window_end,state,counters_json,incident_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    protocol.workspace_id, crypto.randomUUID(), protocol.id, protocol.release_id, start, now, state, JSON.stringify({ protocol_sha256: sha, domains: counters, incidents: incidents.map(incident => incident.id) }), incidents[0]?.id ?? null, now).run();
  return incidents;
}

/** Cron entry. Only the protocol hash bound by an ACTIVE release is evaluated; a failure is counted, never guessed. */
export async function monitoringScheduled(env, now = Date.now()) {
  const db = env.DB, report = { checked: 0, incidents: 0, failed: 0 };
  for (const workspace of await all(db, 'SELECT id FROM workspaces')) {
    const rows = await all(db, `SELECT p.* FROM qc_monitoring_protocols p JOIN qc_releases r ON r.workspace_id=p.workspace_id AND r.id=p.release_id
      WHERE p.workspace_id=? AND r.state='ACTIVE' AND json_extract(r.json,'$.monitoring_protocol_sha256')=p.sha256`, workspace.id);
    for (const row of rows) {
      report.checked++;
      try { report.incidents += (await evaluateQCMonitoring(db, JSON.parse(row.json), now)).length; }
      catch { report.failed++; }
    }
  }
  return report;
}
