/** Tracking spend control and sync engine.
 *
 * Everything here is fail-closed and honest:
 *  - billable units are known containers, otherwise the identifier itself
 *  - each unit owns a 30-day billing window measured from its last charge;
 *    repeats inside the window are free, renewals need the configured policy
 *  - credits are reserved atomically with idempotent request IDs; monthly and
 *    per-shipment caps are computed from open reservations
 *  - one shared, key-scoped rate limiter sits below the provider default
 *  - retries are bounded with jittered backoff; anything that could have been
 *    charged (ambiguous timeout, garbled 200, uncertain failures) is queued for
 *    manual reconciliation instead of being retried again
 *  - provider events are append-only with stable dedupe keys
 */
import { all, one, query, ErpProblem } from './erp-utils.mjs';
import { PROVIDER, ProviderProblem, trackUnit, credentialOf, contractGaps, redact, parseContract } from './datalooplabs.mjs';

/** Same as erp-utils fail, with a stable machine-readable code for the bilingual error catalog. */
const fail = (status, message, code) => {
  const problem = new ErpProblem(status, message);
  if (code) problem.code = code;
  throw problem;
};

export const FACTORY_TZ_OFFSET_MS = 5 * 3600_000; // Asia/Karachi
export const CONTAINER = /^[A-Z]{4}[0-9]{7}$/;
const RESERVATION_TTL_MS = 30 * 60_000;
const MAX_AUTO_ATTEMPTS = 5;

export const monthBucket = now => {
  const shifted = new Date(now + FACTORY_TZ_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const monthStart = now => {
  const shifted = new Date(now + FACTORY_TZ_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - FACTORY_TZ_OFFSET_MS;
};

export function normalizeIdentifier(type, value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (type === 'container') {
    if (!CONTAINER.test(raw)) fail(422, 'Container numbers have four capital letters and seven digits, for example ABCD1234567.', 'tracking_container_invalid');
    return raw;
  }
  const normalized = raw.replace(/\s+/g, '');
  if (normalized.length < 4 || normalized.length > 100) {
    fail(422, type === 'bol' ? 'Bill of lading numbers are 4–100 characters.' : 'Booking numbers are 4–100 characters.',
      type === 'bol' ? 'tracking_bol_invalid' : 'tracking_booking_invalid');
  }
  if (/[\u0000-\u001f]/.test(normalized)) fail(422, 'The number contains unsupported characters.', 'tracking_identifier_chars');
  return normalized;
}

export const validContainer = value => CONTAINER.test(String(value ?? '').trim().toUpperCase());

/** Billable units for a target: provider-discovered or locally known containers, otherwise the identifier itself. */
export function billableUnits(containersJson, providerContainers) {
  const discovered = (Array.isArray(providerContainers) ? providerContainers : [])
    .map(value => String(value ?? '').trim().toUpperCase()).filter(validContainer);
  if (discovered.length) return discovered.map(container => ({ container, estimated: false }));
  try {
    const known = JSON.parse(containersJson || '[]');
    if (Array.isArray(known) && known.length) {
      const cleaned = [...new Set(known.map(value => String(value ?? '').trim().toUpperCase()).filter(validContainer))];
      if (cleaned.length) return cleaned.map(container => ({ container, estimated: false }));
    }
  } catch { /* no stored container list */ }
  return [{ container: '', estimated: true }];
}

/** Units that need a charge right now: no window row, or an expired window. */
export async function pendingChargeUnits(db, scope, identifierType, identifier, units, now) {
  if (!scope || !units.length) return [];
  const rows = await all(db,
    'SELECT container, last_charge_at, window_open_until FROM tracking_billing_windows WHERE account_scope=? AND identifier_type=? AND identifier=?',
    scope, identifierType, identifier);
  const pending = [];
  for (const unit of units) {
    const row = rows.find(item => item.container === unit.container);
    if (row && row.window_open_until > now) continue;
    pending.push({ container: unit.container, estimated: unit.estimated, neverCharged: !row, lastChargeAt: row?.last_charge_at ?? null });
  }
  return pending;
}

/** Estimate the credits an authorized call needs. Estimates are in credits, never a provider balance claim. */
export async function estimateCredits(db, scope, target, containersJson, now) {
  const units = billableUnits(containersJson, (parseJson(target.provider_payload_json)?.containers) ?? []);
  const pending = await pendingChargeUnits(db, scope, target.identifier_type, target.identifier, units, now);
  return {
    credits: pending.length,
    totalUnits: units.length,
    units: pending,
    containersKnown: !units.some(unit => unit.estimated),
    missingContainerEstimate: units.some(unit => unit.estimated) && units.length === 1 && units[0].container === '',
    includesRenewal: pending.some(unit => !unit.neverCharged),
  };
}

function parseJson(value) {
  try { return JSON.parse(value || 'null'); } catch { return null; }
}

export async function loadAccount(db, scope) {
  if (!scope) return null;
  return one(db, 'SELECT * FROM tracking_accounts WHERE account_scope=?', scope);
}

export async function defaultPolicy() {
  return { monthly_credit_cap: null, per_shipment_credit_cap: null, auto_track: 'manual',
    renewal_policy: 'pause', force_refresh_policy: 'explicit', credit_cost_minor: null };
}

export async function loadPolicy(db, workspaceId) {
  return await one(db, 'SELECT * FROM tracking_policies WHERE workspace_id=?', workspaceId) ?? await defaultPolicy();
}

export async function monthUsage(db, workspaceId, now) {
  const row = await one(db, `SELECT COALESCE(SUM(credits),0) AS credits FROM tracking_reservations
    WHERE workspace_id=? AND created_at>=? AND state IN ('reserved','committed')`, workspaceId, monthStart(now));
  return { month: monthBucket(now), reservedCredits: row?.credits ?? 0 };
}

/** Log one spend decision; policy blocks are recorded, never silent. Not async: it returns a statement. */
function ledger(db, { workspaceId = null, scope, targetId = null, identifierType = null, identifier = null, kind, credits, purpose = null, detail = '', bucket }) {
  return query(db, `INSERT INTO tracking_usage_events(id,workspace_id,target_id,account_scope,identifier_type,identifier,kind,credits,purpose,month_bucket,detail,actor_id,actor_type,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), workspaceId, targetId, scope, identifierType, identifier, kind, credits, purpose, bucket,
    String(detail).slice(0, 1500), null, 'system', Date.now());
}

/** Fail with a 402 and record the block when the policy cap does not allow `credits` more. */
export async function capCheck(db, workspaceId, scope, target, credits, now, purpose) {
  const policy = await loadPolicy(db, workspaceId);
  const monthly = await monthUsage(db, workspaceId, now);
  if (policy.monthly_credit_cap != null && monthly.reservedCredits + credits > policy.monthly_credit_cap) {
    await db.batch([ledger(db, { workspaceId, scope, targetId: target?.id, identifierType: target?.identifier_type, identifier: target?.identifier,
      kind: 'policy_blocked', credits, purpose, detail: `monthly cap ${policy.monthly_credit_cap} would be exceeded (${monthly.reservedCredits} credits already reserved or used this month)`, bucket: monthly.month })]);
    fail(402, `The monthly tracking credit cap (${policy.monthly_credit_cap}) is reached. ${monthly.reservedCredits} credits are already reserved or used this month. An admin can raise the cap; no credits were spent.`, 'tracking_monthly_cap_reached');
  }
  if (target && policy.per_shipment_credit_cap != null) {
    const row = await one(db, `SELECT COALESCE(SUM(credits),0) AS credits FROM tracking_reservations
      WHERE workspace_id=? AND target_id=? AND state IN ('reserved','committed')`, workspaceId, target.id);
    if ((row?.credits ?? 0) + credits > policy.per_shipment_credit_cap) {
      await db.batch([ledger(db, { workspaceId, scope, targetId: target.id, identifierType: target.identifier_type, identifier: target.identifier,
        kind: 'policy_blocked', credits, purpose, detail: `per-shipment cap ${policy.per_shipment_credit_cap} reached`, bucket: monthly.month })]);
      fail(402, `The per-shipment credit cap (${policy.per_shipment_credit_cap}) is reached for ${target.identifier}. No credits were spent.`, 'tracking_per_shipment_cap_reached');
    }
  }
  return policy;
}

/** Reserve estimated credits atomically; the same request ID and parallel clicks converge on one reservation. */
export async function reserveCredits(db, { workspaceId, target, purpose, credits, requestId, reason = '', createdBy = 'member', forceUpdate = 0 }) {
  const now = Date.now();
  if (!Number.isSafeInteger(credits) || credits < 1) fail(422, 'A credit estimate is required before starting a paid tracking call.', 'tracking_estimate_required');
  const requestIdText = String(requestId ?? '').trim();
  if (requestIdText.length < 8 || requestIdText.length > 64) fail(422, 'Use the request ID shown in the form.', 'tracking_request_id_invalid');
  const existing = await one(db, 'SELECT * FROM tracking_reservations WHERE request_id=?', requestIdText);
  if (existing) {
    if (existing.target_id !== target.id || existing.purpose !== purpose) fail(409, 'This request ID was already used for a different tracking authorization. Reload and try again.', 'tracking_request_id_conflict');
    return existing;
  }
  const same = await one(db, `SELECT * FROM tracking_reservations WHERE target_id=? AND purpose=? AND state='reserved' AND expires_at>?`, target.id, purpose, now);
  if (same) return same;
  await capCheck(db, workspaceId, target.account_scope, target, credits, now, purpose);
  const id = crypto.randomUUID();
  try {
    await db.batch([
      query(db, `INSERT INTO tracking_reservations(id,workspace_id,target_id,request_id,purpose,credits,state,force_update,reason,expires_at,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, workspaceId, target.id, requestIdText, purpose, credits, 'reserved', forceUpdate, String(reason).slice(0, 900), now + RESERVATION_TTL_MS, createdBy, now),
      ledger(db, { workspaceId, scope: target.account_scope, targetId: target.id, identifierType: target.identifier_type, identifier: target.identifier,
        kind: 'reserve', credits, purpose, detail: reason, bucket: monthBucket(now) }),
    ]);
  } catch (error) {
    const raced = await one(db, 'SELECT * FROM tracking_reservations WHERE request_id=?', requestIdText);
    if (raced) return raced;
    const concurrent = await one(db, `SELECT * FROM tracking_reservations WHERE target_id=? AND purpose=? AND state='reserved' AND expires_at>?`, target.id, purpose, now);
    if (concurrent) return concurrent;
    void error;
    fail(409, 'The tracking policy changed while reserving credits. Reload and try again.', 'tracking_reservation_conflict');
  }
  return one(db, 'SELECT * FROM tracking_reservations WHERE id=?', id);
}

/** Settle a reservation after the provider outcome is known. */
export async function settleReservation(db, target, reservation, outcome, detail) {
  const now = Date.now();
  const owned = await one(db, 'SELECT * FROM tracking_reservations WHERE id=?', reservation.id);
  if (!owned || owned.state !== 'reserved') return null;
  const state = outcome === 'charged' ? 'committed' : 'released';
  const kind = state === 'committed' ? 'commit' : 'release';
  const cleansed = redact(String(detail), null).slice(0, 1500);
  await db.batch([
    query(db, `UPDATE tracking_reservations SET state=?, settled_at=?, reason=? WHERE id=? AND state='reserved'`,
      state, now, cleansed, owned.id),
    ledger(db, { workspaceId: owned.workspace_id, scope: target.account_scope, targetId: target.id,
      identifierType: target.identifier_type, identifier: target.identifier, kind, credits: owned.credits,
      purpose: owned.purpose, detail: `${outcome}: ${cleansed}`, bucket: monthBucket(now) }),
  ]);
  return state;
}

/** Expire timed-out reservations so the monthly cap stops counting held budget. */
export async function releaseExpiredReservations(db, now) {
  const rows = await all(db, `SELECT r.*, t.account_scope AS scope, t.identifier_type, t.identifier
    FROM tracking_reservations r LEFT JOIN tracking_targets t ON t.id=r.target_id WHERE r.state='reserved' AND r.expires_at<=?`, now);
  for (const reservation of rows) {
    await db.batch([
      query(db, `UPDATE tracking_reservations SET state='expired', settled_at=?, reason=? WHERE id=? AND state='reserved'`,
        now, 'the authorization timed out before the provider call settled', reservation.id),
      ledger(db, { workspaceId: reservation.workspace_id, scope: reservation.scope ?? PROVIDER, targetId: reservation.target_id,
        identifierType: reservation.identifier_type, identifier: reservation.identifier,
        kind: 'release_expired', credits: reservation.credits, purpose: reservation.purpose,
        detail: 'reservation expired before the provider call settled; check the provider account before reauthorizing', bucket: monthBucket(now) }),
    ]);
  }
  return rows.length;
}

export function parseLinkContainers(containersJson) {
  try {
    const parsed = JSON.parse(containersJson || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.map(value => String(value ?? '').trim().toUpperCase()).filter(validContainer))] : [];
  } catch { return []; }
}

/** Extend the billing window of every charged unit. */
async function commitCharge(db, account, target, units, reservation, now, detail) {
  const queries = units.map(unit => query(db, `INSERT INTO tracking_billing_windows(id,account_scope,identifier_type,identifier,container,last_charge_at,window_open_until,charge_count,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_scope,identifier_type,identifier,container) DO UPDATE SET
      last_charge_at=excluded.last_charge_at, window_open_until=excluded.window_open_until,
      charge_count=tracking_billing_windows.charge_count+1, updated_at=excluded.updated_at`,
    crypto.randomUUID(), account.account_scope, target.identifier_type, target.identifier, unit.container, now, now + account.renewal_days * 86_400_000, 1, now, now));
  queries.push(query(db, 'UPDATE tracking_targets SET updated_at=? WHERE id=?', now, target.id));
  await db.batch(queries);
  if (reservation) await settleReservation(db, target, reservation, 'charged', detail);
}

async function acquireRateSlot(db, account, now) {
  const bucket = Math.floor(now / 60_000);
  let result = null;
  try {
    result = await one(db, `INSERT INTO tracking_rate_slots(account_scope,minute_bucket,used) VALUES(?,?,1)
      ON CONFLICT(account_scope,minute_bucket) DO UPDATE SET used=used+1 RETURNING used`, account.account_scope, bucket);
  } catch (error) {
    void error; // RETURNING can be unavailable in some runtimes; the fallback is a bounded read+write.
    const row = await one(db, 'SELECT used FROM tracking_rate_slots WHERE account_scope=? AND minute_bucket=?', account.account_scope, bucket);
    const next = (row?.used ?? 0) + 1;
    await db.batch([query(db, `INSERT INTO tracking_rate_slots(account_scope,minute_bucket,used) VALUES(?,?,?)
      ON CONFLICT(account_scope,minute_bucket) DO UPDATE SET used=excluded.used`, account.account_scope, bucket, next)]);
    result = { used: next };
  }
  return (result?.used ?? 0) <= account.rate_limit_per_minute;
}

const backoffMs = attempts => Math.min(600_000, 45_000 * 2 ** Math.max(0, attempts - 1)) + Math.floor(Math.random() * 30_000);

/** Queue one sync job. Duplicate active jobs collapse onto the existing row. */
export async function enqueueSyncJob(db, targetId, purpose, { forceUpdate = 0, reservationId = null, nextAttemptAt = Date.now() } = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await db.batch([query(db, `INSERT INTO tracking_sync_jobs(id,target_id,purpose,force_update,reservation_id,state,attempts,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,'queued',0,?,?,?)`, id, targetId, purpose, forceUpdate, reservationId, nextAttemptAt, now, now)]);
    return { id, duplicate: false };
  } catch (error) {
    void error;
    const existing = await one(db, `SELECT * FROM tracking_sync_jobs WHERE target_id=? AND state IN ('queued','running','paused') ORDER BY created_at DESC LIMIT 1`, targetId);
    return { id: existing?.id ?? null, duplicate: !!existing, job: existing ?? null };
  }
}

async function failJob(db, target, job, kind, message) {
  const now = Date.now();
  const cleansed = redact(message, null).slice(0, 1500);
  await db.batch([
    query(db, `UPDATE tracking_sync_jobs SET state='failed', next_attempt_at=?, attempts=attempts+1, last_error_kind=?, last_error_message=?, updated_at=? WHERE id=?`,
      0, kind, cleansed, now, job.id),
    query(db, `UPDATE tracking_targets SET last_attempt_at=?, last_error_kind=?, last_error_message=?, updated_at=? WHERE id=?`,
      now, kind, cleansed.slice(0, 700), now, target.id),
  ]);
}

async function pauseJob(db, target, job, kind, message, retryInMs, status) {
  const now = Date.now();
  const cleansed = redact(message, null).slice(0, 1500);
  const retry = retryInMs > 0 ? now + retryInMs : 0;
  await db.batch([
    query(db, `UPDATE tracking_sync_jobs SET state=?, next_attempt_at=?, attempts=attempts+1, last_error_kind=?, last_error_message=?, updated_at=? WHERE id=?`,
      retry ? 'paused' : 'blocked_policy', retry, kind, cleansed, now, job.id),
    query(db, `UPDATE tracking_targets SET status=?, last_attempt_at=?, last_error_kind=?, last_error_message=?, updated_at=? WHERE id=?`,
      status ?? target.status, now, kind, cleansed.slice(0, 700), now, target.id),
  ]);
}

/** Ambiguous outcomes park the job and the target until an admin reconciles the charge. */
async function reconcileJob(db, target, job, kind, message) {
  const now = Date.now();
  const cleansed = redact(message, null).slice(0, 1500);
  await db.batch([
    query(db, `UPDATE tracking_sync_jobs SET state='needs_reconcile', next_attempt_at=?, attempts=attempts+1, last_error_kind=?, last_error_message=?, updated_at=? WHERE id=?`,
      0, kind, cleansed, now, job.id),
    query(db, `UPDATE tracking_targets SET status='charge_uncertain', last_attempt_at=?, last_error_kind=?, last_error_message=?, updated_at=? WHERE id=?`,
      now, kind, cleansed.slice(0, 700), now, target.id),
  ]);
}

async function patchTarget(db, targetId, fields, now) {
  const assign = [];
  const args = [];
  for (const [key, value] of Object.entries(fields)) {
    if (['id', 'account_scope', 'identifier_type', 'identifier', 'created_at', 'created_by'].includes(key)) continue;
    assign.push(`${key}=?`);
    args.push(value);
  }
  if (!assign.length) return;
  await query(db, `UPDATE tracking_targets SET ${[...assign, 'updated_at=?'].join(', ')} WHERE id=?`, ...args, now, targetId).run();
}

async function ingestEvents(db, targetId, events, now) {
  const sorted = [...events].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || String(a.title).localeCompare(String(b.title)));
  const inserted = [];
  let orderIndex = 0;
  for (const event of sorted) {
    if (event.at == null && !event.title && !event.code) continue;
    const digest = await sha256hex(`${event.at ?? ''}|${event.code}|${event.title}|${event.location}`);
    inserted.push(query(db, `INSERT OR IGNORE INTO tracking_events(id,target_id,event_at,code,title,location,description,dedupe_key,order_index,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      crypto.randomUUID(), targetId, event.at ?? now, String(event.code || 'EVENT').slice(0, 60),
      String(event.title || event.code || 'Provider update').slice(0, 300), String(event.location ?? '').slice(0, 200),
      String(event.description ?? '').slice(0, 2000), digest, orderIndex++, now));
  }
  if (inserted.length) await db.batch(inserted);
  return sorted.length;
}

const sha256hex = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
};

/** Map a provider failure to an honest local state. `billable` calls may have charged money. */
async function classifyFailure(db, account, target, job, reservation, pending, error, now) {
  const contract = parseContract(account?.contract_json);
  const chargeSemantics = contract?.chargeSemantics ?? {};
  const billable = job.force_update === 1 || ['first_track', 'renewal'].includes(job.purpose);
  if (!(error instanceof ProviderProblem)) {
    // Unknown internal error: if it may have cost money, it is uncertain; otherwise fail safely.
    if (billable && reservation) await reconcileJob(db, target, job, 'internal_error', 'The provider call interrupted unexpectedly. Reconcile the charge on the provider account before retrying.');
    else await failJob(db, target, job, 'internal_error', 'The tracking job failed unexpectedly. Nothing was charged.');
    return 'needs_reconcile';
  }
  const message = error.message;
  switch (error.kind) {
    case 'contract_unavailable':
    case 'not_configured': {
      // Cannot call without a verified contract: hold any reservation until it expires or the admin reconciles.
      await pauseJob(db, target, job, 'contract_unavailable',
        `${message} No credits were spent because the call never happened.`, 0, 'config_blocked');
      return 'blocked_contract';
    }
    case 'rate_limited': {
      if (job.attempts + 1 < MAX_AUTO_ATTEMPTS) {
        await pauseJob(db, target, job, 'rate_limited',
          'The shared API key hit its per-minute limit. The job waits and retries within the limiter.', backoffMs(Math.max(1, job.attempts)), 'rate_limited');
        return 'rate_limited';
      }
      if (reservation) await settleReservation(db, target, reservation, 'released', 'The limiter declined every retry, so the provider call never completed and no credit is needed.');
      await failJob(db, target, job, 'rate_limited', 'Retries exhausted the rate-limited window. Nothing was charged; run the update again later.');
      return 'rate_limited_exhausted';
    }
    case 'credential_rejected': {
      if (reservation) await settleReservation(db, target, reservation, 'released', 'The provider rejected the configured credential, so the call never completed and no credit is needed.');
      await failJob(db, target, job, 'credential_rejected', message);
      return 'credential_rejected';
    }
    case 'invalid_identifier': {
      const declaredUncharged = chargeSemantics.invalid_identifier_charged === false;
      if (declaredUncharged) {
        if (reservation) await settleReservation(db, target, reservation, 'released', 'The contract documents that unknown numbers are not charged.');
        await failJob(db, target, job, 'invalid_identifier', 'The provider does not recognize this number. Check the B/L or container number.');
        await patchTarget(db, target.id, { data_state: 'invalid_identifier', status: 'provider_rejected' }, now);
        return 'invalid_identifier';
      }
      await reconcileJob(db, target, job, 'invalid_identifier',
        message + ' The provider rejected the number, but whether such a rejection is charged is not documented. Reconcile on the provider account before retrying.');
      await ledgerPending(db, target, reservation, 'invalid_identifier');
      return 'charge_uncertain';
    }    case 'ambiguous_timeout':
    case 'garbled_response': {
      await reconcileJob(db, target, job, error.kind,
        message + ' The request may have been charged; do not retry until the provider account is checked.');
      await ledgerPending(db, target, reservation, error.kind);
      return 'charge_uncertain';
    }
    default: {
      // network_error, provider_unavailable, provider_rejection: bounded retries, then reconcile if billable.
      if (job.attempts + 1 < (billable ? 3 : MAX_AUTO_ATTEMPTS)) {
        await pauseJob(db, target, job, error.kind, message, backoffMs(Math.max(1, job.attempts)));
        return 'retrying';
      }
      if (billable && reservation) {
        await reconcileJob(db, target, job, error.kind,
          message + ` Retried ${job.attempts + 1} time(s); the outcome could not be confirmed and may include a charge. Reconcile on the provider account first.`);
        await ledgerPending(db, target, reservation, error.kind);
        return 'charge_uncertain';
      }
      await failJob(db, target, job, error.kind, `${message} Nothing was charged.`);
      return 'failed';
    }
  }
}

async function ledgerPending(db, target, reservation, kind) {
  // Ledger note: the reservation stays reserved (NOT committed) until an admin reconciles it.
  if (!reservation) return;
  const rows = [{
    sql: `INSERT INTO tracking_usage_events(id,workspace_id,target_id,account_scope,identifier_type,identifier,kind,credits,purpose,month_bucket,detail,actor_id,actor_type,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [crypto.randomUUID(), reservation.workspace_id, reservation.target_id, target.account_scope, target.identifier_type,
      target.identifier, 'reserve', reservation.credits, reservation.purpose, monthBucket(Date.now()),
      `Outcome uncertain after ${kind}: Yarnflow keeps these credits reserved until an admin reconciles them against the provider's real balance; the local number is not the provider balance.`, null, 'system', Date.now()],
  }];
  await db.batch(rows.map(item => query(db, item.sql, ...item.args)));
}

/** Apply a verified 200 provider payload. */
async function applySuccess(db, env, account, target, job, reservation, units, pending, result, now) {
  await ingestEvents(db, target.id, result.events, now);
  const snapshot = {
    containers: result.containers.length ? result.containers : (parseJson(target.provider_payload_json)?.containers ?? []),
    reference: result.reference || undefined, dataAt: result.dataAt ?? undefined,
  };
  const dataState = (result.events.length || result.containers.length || result.reference) ? 'live' : 'no_carrier_data';
  await patchTarget(db, target.id, {
    data_state: dataState, provider_ref: result.reference || null, provider_payload_json: JSON.stringify(snapshot),
    last_sync_ok_at: now, last_error_kind: null, last_error_message: null, status: 'authorized',
  }, now);

  const billable = job.force_update === 1 || ['first_track', 'renewal'].includes(job.purpose);
  void env;
  if (!billable) {
    // Free repeat inside the billing windows: nothing was charged.
    await db.batch([query(db, `UPDATE tracking_sync_jobs SET state='done', next_attempt_at=0, attempts=attempts+1, updated_at=? WHERE id=?`, now, job.id)]);
    return 'refreshed';
  }
  let chargeUnits = pending;
  let extra = '';
  if (job.force_update === 1) {
    // Force refresh charges every tracked unit again (provider terms), regardless of window state.
    chargeUnits = units;
    extra = 'Force refresh charges each tracked unit again; the window restarts from now.';
  }
  if (!chargeUnits.length) {
    if (reservation) {
      await settleReservation(db, target, reservation, 'released', 'Every unit was still inside its 30-day window when the provider answered; the repeat was free.');
    }
    await db.batch([query(db, `UPDATE tracking_sync_jobs SET state='done', next_attempt_at=0, attempts=attempts+1, last_error_kind='free_repeat', last_error_message=?, updated_at=? WHERE id=?`,
      'Completed as a free repeat inside the billing window.', now, job.id)]);
    return 'free_repeat';
  }
  const discoveredNew = snapshot.containers.filter(c => !chargeUnits.some(u => u.container === c) && validContainer(c))
    .map(c => ({ container: c, estimated: false, inherited: true }));
  const allUnits = [...chargeUnits, ...discoveredNew];
  const detail =
    `${extra ? extra + ' ' : ''}Charged units: ${chargeUnits.map(u => u.container || `${target.identifier_type}:${target.identifier}`).join(' · ')}` +
    (discoveredNew.length ? `. Provider-discovered containers inherit this charge window pending contract verification: ${discoveredNew.map(u => u.container).join(', ')}.` : '') +
    (reservation && reservation.credits !== chargeUnits.length ? ` Estimate reconciliation: ${chargeUnits.length} unit(s) charged against ${reservation.credits} reserved.` : '');
  await commitCharge(db, account, target, allUnits, reservation, now, detail);
  await db.batch([query(db, `UPDATE tracking_sync_jobs SET state='done', next_attempt_at=0, attempts=attempts+1, updated_at=? WHERE id=?`, now, job.id)]);
  return 'charged';
}

async function runJob(env, db, account, job, deps) {
  const now = deps.now ?? Date.now();
  const target = await one(db, 'SELECT * FROM tracking_targets WHERE id=?', job.target_id);
  if (!target) return 'target_missing';
  const reservation = job.reservation_id ? await one(db, 'SELECT * FROM tracking_reservations WHERE id=?', job.reservation_id) : null;
  const link = await one(db, 'SELECT containers_json FROM tracking_target_links WHERE target_id=? ORDER BY rowid DESC LIMIT 1', target.id);
  const snapshotContainers = parseJson(target.provider_payload_json)?.containers ?? [];
  const units = billableUnits(link?.containers_json, snapshotContainers);
  const pending = await pendingChargeUnits(db, account.account_scope, target.identifier_type, target.identifier, units, now);
  const billable = job.force_update === 1 || ['first_track', 'renewal'].includes(job.purpose);

  if (!(await acquireRateSlot(db, account, now))) {
    await pauseJob(db, target, job, 'rate_limited',
      'The shared API key hit its per-minute limit. The job waits for a free slot before trying again.', backoffMs(Math.max(1, job.attempts)), 'rate_limited');
    return 'rate_limited';
  }
  if (job.purpose === 'refresh' && job.force_update === 0 && pending.length) {
    // A repeat would need a new charge, and only the configured policy can authorize that.
    await pauseJob(db, target, job, 'billing_authorization_pending',
      'The 30-day window already expired for this data, so an update may charge renewal credits. Authorize the renewal to run it.', 0, 'renewal_paused');
    return 'renewal_required';
  }
  if (billable && !reservation) {
    await pauseJob(db, target, job, 'billing_authorization_pending',
      'No credit reservation was attached to this billable update. Nothing was charged.', 0, target.status);
    return 'missing_reservation';
  }
  const gaps = contractGaps(account);
  if (gaps.length) {
    await pauseJob(db, target, job, 'contract_unavailable',
      `Tracking is blocked until the account contract is verified (${gaps.join('; ')}). No credits were spent because no call happened.`, 0, 'config_blocked');
    return 'blocked_contract';
  }
  let result;
  try {
    result = await trackUnit(env, account, {
      identifier_type: target.identifier_type, identifier: target.identifier,
      carrier: target.carrier, force_update: job.force_update === 1,
    }, deps);
  } catch (error) {
    return classifyFailure(db, account, target, job, reservation, pending, error, now);
  }
  return applySuccess(db, env, account, target, job, reservation, units, pending, result, now);
}

/** Mark stale authorized targets and schedule the next automatic refreshes.
 *  Automatic refreshes are billable-aware: data inside the refresh interval is left alone,
 *  terminal consignments are never re-fetched, and a job that would need a paid renewal is
 *  never scheduled without a prior authorization — renewal cost always needs a policy consent. */
async function scheduleAndStaleCheck(db, now) {
  const accounts = await all(db, 'SELECT * FROM tracking_accounts WHERE contract_verified_at IS NOT NULL');
  for (const account of accounts) {
    if (contractGaps(account).length) continue;
    const intervalMs = account.refresh_interval_minutes * 60_000;
    const contract = parseContract(account.contract_json);
    const terminal = (contract?.response?.terminalCodes ?? []).map(code => String(code).toUpperCase());
    const targets = await all(db, `SELECT t.* FROM tracking_targets t WHERE t.account_scope=? AND t.status IN ('authorized','stale') AND t.last_sync_ok_at IS NOT NULL`, account.account_scope);
    for (const target of targets) {
      if (target.last_sync_ok_at >= now - intervalMs) continue; // fresh within the configured interval
      if (target.status === 'authorized' && target.last_sync_ok_at < now - 2 * intervalMs) {
        await patchTarget(db, target.id, { status: 'stale' }, now);
      }
      const latest = await one(db, 'SELECT code FROM tracking_events WHERE target_id=? ORDER BY event_at DESC, order_index DESC LIMIT 1', target.id);
      if (latest?.code && terminal.includes(String(latest.code).toUpperCase())) continue; // nothing left to fetch at the carrier
      const link = await one(db, 'SELECT containers_json FROM tracking_target_links WHERE target_id=? ORDER BY rowid DESC LIMIT 1', target.id);
      const estimate = await estimateCredits(db, target.account_scope, target, link?.containers_json ?? '[]', now);
      if (estimate.credits) continue; // auto-refresh never starts a paid job: renewals need an explicit authorization
      await enqueueSyncJob(db, target.id, 'refresh', { nextAttemptAt: now });
    }
  }
}

/** Run due tracking jobs once. Call this from the cron handler (`manual` also picks paused jobs). */
export async function runTrackingSync(env, options = {}) {
  const db = env.DB;
  if (!db) { fail(503, 'The shared database is not connected. Tracking jobs stopped; nothing was charged.', 'tracking_no_database'); }
  const now = options.now ?? Date.now();
  const deps = { ...options, now };
  const expired = await releaseExpiredReservations(db, now);
  try {
    await db.batch([query(db, 'DELETE FROM tracking_rate_slots WHERE minute_bucket<?', Math.floor(now / 60_000) - 10)]);
  } catch { /* rate table cleanup is best effort */ }
  const summary = { expiredReservations: expired, jobs: [] };
  const jobs = await all(db, `SELECT j.*, t.account_scope AS scope FROM tracking_sync_jobs j JOIN tracking_targets t ON t.id=j.target_id
    WHERE j.state IN ('queued','paused') AND j.next_attempt_at<=? AND j.attempts<? ORDER BY j.next_attempt_at LIMIT ?`,
    now, MAX_AUTO_ATTEMPTS, options.maxJobs ?? 5);
  for (const job of jobs) {
    const account = await loadAccount(db, job.scope);
    if (!account) {
      const target = await one(db, 'SELECT * FROM tracking_targets WHERE id=?', job.target_id).catch(() => null);
      if (target) {
        await pauseJob(db, target, job, 'account_missing',
          'The provider account record is missing. No credits were spent.', 0, 'config_blocked');
        summary.jobs.push({ jobId: job.id, target: job.target_id, outcome: 'blocked_contract' });
      }
      continue;
    }
    const outcome = await runJob(env, db, account, job, deps);
    summary.jobs.push({ jobId: job.id, target: job.target_id, purpose: job.purpose, outcome });
  }
  if (options.schedule !== false) await scheduleAndStaleCheck(db, now);
  return summary;
}
