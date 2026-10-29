/** Purchase-order B/L tracking against DataLoopLabs with explicit spend control.
 *
 * Wire-in (owned by the integration worker, who edits the shared routers):
 *   `trackingApi(request, env, member, path, data)` handles `/api/erp/tracking/*`
 *   with the same `(member, data)` arrangement staffProcurement and receiving use.
 *   `runTrackingSync(env)` belongs in the scheduled worker handler.
 *
 * Endpoints (all workspace-scoped):
 *   GET  /api/erp/tracking/overview               full tracker state for one workspace
 *   POST /api/erp/tracking/targets                link an identifier (dedupes on the provider account)
 *   GET  /api/erp/tracking/targets/:id            one target with events/windows/reservations
 *   POST /api/erp/tracking/targets/:id/authorize  first track or renewal: reserve credits + queue
 *   POST /api/erp/tracking/targets/:id/refresh    free repeat inside the 30-day window
 *   POST /api/erp/tracking/targets/:id/force-refresh  paid force_update=true, explicit only
 *   POST /api/erp/tracking/targets/:id/close      stop billable syncing
 *   POST /api/erp/tracking/targets/:id/reconcile  admin: settle an ambiguous provider charge
 *   POST /api/erp/tracking/policy                 admin spending policy
 *   POST /api/erp/tracking/account                admin records the verified provider contract
 *   POST /api/erp/tracking/sync                   staff: run due jobs/refreshes once
 */
import { all, one, query, json, ErpProblem, text, multiline, integer, recordId, keys, readJson, audit } from './erp-utils.mjs';
import { PROVIDER, accountScope, maskedCredential, adapterReady, parseContract, credentialOf } from './datalooplabs.mjs';import {
  monthUsage, loadPolicy, loadAccount, estimateCredits, normalizeIdentifier, parseLinkContainers,
  reserveCredits, settleReservation, enqueueSyncJob, runTrackingSync, validContainer, defaultPolicy,
} from './tracking-budget.mjs';

/** Same as erp-utils fail, with a stable machine-readable code for the bilingual error catalog. */
const fail = (status, message, code) => {
  const problem = new ErpProblem(status, message);
  if (code) problem.code = code;
  throw problem;
};

const IDENTIFIER_TYPES = ['bol', 'booking', 'container'];
const uuid = () => crypto.randomUUID();

const loadTargetsFor = async (db, member, targetId) => {
  const target = await one(db, 'SELECT * FROM tracking_targets WHERE id=?', recordId(targetId));
  if (!target) fail(404, 'Tracking target not found.', 'tracking_target_not_found');
  const link = await one(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? AND target_id=?', member.workspace_id, target.id);
  if (!link) fail(404, 'Tracking target not found in your workspace.', 'tracking_target_not_found');
  return { target, link };
};

export async function trackingApi(request, env, member, path, data) {
  try {
    return await routing(request, env, member, path, data);
  } catch (error) {
    // Stable codes travel with the response so the integration error catalog can map Urdu text.
    if (error instanceof ErpProblem) {
      return json({ error: error.message, code: error.code ?? 'tracking_validation' }, error.status);
    }
    throw error;
  }
}

async function routing(request, env, member, path, data) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected. No tracking change was saved.', 'tracking_no_database');
  const method = request.method;
  if (method === 'POST' && data === null) data = await readJson(request);
  if (method !== 'GET' && method !== 'POST') fail(405, 'Method not allowed.');
  const sub = path.slice('/api/erp/tracking'.length) || '/overview';
  const viewAllowed = member.admin || ['procure', 'receive'].some(p => member.permissions.includes(p));
  const manage = member.admin || member.permissions.includes('procure');
  const targetMatch = /^\/targets\/([a-f\d-]{36})(\/(authorize|refresh|force-refresh|reconcile|close))?$/.exec(sub);
  const now = Date.now();

  if (sub === '/overview' && data === null) {
    if (!viewAllowed) fail(403, 'Your account cannot view shipment tracking. Ask an admin.', 'tracking_view_denied');
    return json(await buildOverview(db, env, member, now));
  }
  if (sub === '/targets' && data === null) {
    if (!viewAllowed) fail(403, 'Your account cannot view shipment tracking. Ask an admin.', 'tracking_view_denied');
    return json({ targets: await targetList(db, env, member, now) });
  }
  if (sub === '/targets' && data) {
    if (!manage) fail(403, 'Purchase managers (or an admin) link tracking identifiers. Ask an admin.', 'tracking_manage_denied');
    const created = await linkTarget(db, env, member, data, now);
    return json(created.body, created.status);
  }
  if (targetMatch) {
    const [, targetId, , action] = targetMatch;
    if (!action && data === null) {
      if (!viewAllowed) fail(403, 'Your account cannot view shipment tracking. Ask an admin.', 'tracking_view_denied');
      const list = await targetList(db, env, member, now, targetId);
      if (!list.length) fail(404, 'Tracking target not found in your workspace.', 'tracking_target_not_found');
      return json({ target: list[0] });
    }
    if (!manage) fail(403, 'Purchase managers (or an admin) control paid tracking. Ask an admin.', 'tracking_manage_denied');
    if (action === 'authorize') return json(await authorizeRoute(db, env, member, targetId, data, now));
    if (action === 'refresh') return json(await refreshTargetRoute(db, env, member, targetId, now));
    if (action === 'force-refresh') return json(await forceRefreshRoute(db, env, member, targetId, data, now));
    if (action === 'close') return json(await closeTargetRoute(db, env, member, targetId, now));
    if (action === 'reconcile') {
      if (!member.admin) fail(403, 'Only an admin can reconcile a possibly charged provider call.', 'tracking_reconcile_denied');
      return json(await reconcileRoute(db, env, member, targetId, data, now));
    }
  }
  if (sub === '/policy' && data) {
    if (!member.admin) fail(403, 'Only an admin can change the tracking spending policy.', 'tracking_policy_denied');
    return json(await savePolicyRoute(db, member, data, now));
  }
  if (sub === '/account' && data) {
    if (!member.admin) fail(403, 'Only an admin can change the provider account contract.', 'tracking_account_denied');
    return json(await saveAccountRoute(db, env, member, data, now));
  }
  if (sub === '/sync' && data) {
    if (!manage) fail(403, 'Purchase managers (or an admin) run tracking syncs. Ask an admin.', 'tracking_manage_denied');
    keys(data, ['max']);
    const max = data.max == null ? 5 : integer(data.max, 'Sync job limit', 1, 10);
    const summary = await runTrackingSync(env, { maxJobs: max });
    return json(summary);
  }
  fail(404, 'Tracking route not found.', 'tracking_route_not_found');
}

/* ------------------------------------------------------------------ links */

async function linkTarget(db, env, member, data, now) {
  keys(data, ['id', 'purchaseOrderId', 'shipmentId', 'identifierType', 'identifier', 'carrier', 'requestId', 'authorize', 'note']);
  recordId(data.id);
  if (!IDENTIFIER_TYPES.includes(data.identifierType)) fail(422, 'Choose bill of lading, booking or container as the identifier type.', 'tracking_identifier_type_invalid');
  const type = data.identifierType;
  const identifier = normalizeIdentifier(type, data.identifier);
  const carrier = text(data.carrier ?? '', 'Carrier', 0, 120);
  const note = multiline(data.note ?? '', 'Note', 0, 900);
  const scope = await accountScope(env);
  if (!scope) {
    fail(409, 'The DataLoopLabs API key is not configured as a server secret. Tracking cannot start before the credential exists; nothing was charged or reserved.', 'tracking_credential_missing');
  }
  await ensureAccountRow(db, env, now);

  let po = null;
  if (data.purchaseOrderId != null && data.purchaseOrderId !== '') {
    po = await one(db, 'SELECT * FROM supplier_purchase_orders WHERE id=? AND workspace_id=?', recordId(data.purchaseOrderId), member.workspace_id);
    if (!po) fail(404, 'Purchase order not found in your workspace.', 'tracking_po_not_found');
  }
  let shipment = null;
  if (data.shipmentId != null && data.shipmentId !== '') {
    shipment = await one(db, 'SELECT s.*, p.workspace_id AS po_workspace, p.id AS po_id FROM procurement_shipments s JOIN supplier_purchase_orders p ON p.id=s.purchase_order_id WHERE s.id=? AND s.workspace_id=?',
      recordId(data.shipmentId), member.workspace_id);
    if (!shipment) fail(404, 'Dispatch notice not found in your workspace.', 'tracking_shipment_not_found');
    else if (po && shipment.po_id !== po.id) fail(409, 'That dispatch notice belongs to a different purchase order.', 'tracking_shipment_po_mismatch');
    else if (!po) po = await one(db, 'SELECT * FROM supplier_purchase_orders WHERE id=? AND workspace_id=?', shipment.po_id, member.workspace_id);
  }

  const existing = await one(db, 'SELECT * FROM tracking_targets WHERE account_scope=? AND identifier_type=? AND identifier=?', scope, type, identifier);
  const targetId = existing?.id ?? data.id;
  if (!existing) {
    try {
      await db.batch([query(db, `INSERT INTO tracking_targets(id,provider,account_scope,identifier_type,identifier,carrier,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, targetId, PROVIDER, scope, type, identifier, carrier, member.user_id, now, now)]);
    } catch {
      const raced = await one(db, 'SELECT * FROM tracking_targets WHERE account_scope=? AND identifier_type=? AND identifier=?', scope, type, identifier);
      if (!raced) fail(409, 'The tracking target could not be created. Reload and try again.', 'tracking_target_conflict');
      if (raced.id !== targetId) return { status: 200, body: { deduped: true, target: await targetDetail(db, env, raced.id, now) } };
    }
  } else {
    const previous = await one(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? AND target_id=?', member.workspace_id, existing.id);
    if (previous && previous.purchase_order_id && po && previous.purchase_order_id !== po.id) {
      fail(409, 'This identifier is already linked to a different purchase order in this workspace.', 'tracking_target_po_conflict');
    }
  }
  const target = existing ?? await one(db, 'SELECT * FROM tracking_targets WHERE id=?', targetId);

  if (shipment) {
    const claimed = await one(db, 'SELECT * FROM tracking_target_links WHERE shipment_id=? AND workspace_id=?', shipment.id, member.workspace_id);
    if (claimed && claimed.target_id !== target.id) fail(409, 'That dispatch notice is already tracking a different shipment number.', 'tracking_shipment_conflict');
  }
  if (!(await one(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? AND target_id=?', member.workspace_id, target.id))) {
    try {
      await db.batch([query(db, `INSERT INTO tracking_target_links(workspace_id,target_id,purchase_order_id,shipment_id,containers_json,note,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?)`,
        member.workspace_id, target.id, po?.id ?? null, shipment?.id ?? null,
        JSON.stringify(shipment ? parseLinkContainers(shipment.containers_json) : []), note, member.user_id, now)]);
    } catch {
      const raced = await one(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? AND target_id=?', member.workspace_id, target.id);
      if (!raced) fail(409, 'The tracking link could not be saved. Reload and try again.', 'tracking_target_link_conflict');
    }
  }
  await audit(db, member, existing ? 'tracking.linked' : 'tracking.created', target.id, { type, identifier, carrier, po: po?.id ?? null, shipment: shipment?.id ?? null, deduped: !!existing }).run();
  const policy = await loadPolicy(db, member.workspace_id);
  const manage = member.admin || member.permissions.includes('procure');
  const wantAuto = (data.authorize === true && data.requestId) || policy.auto_track === 'confirmed';
  const autoRequestId = data.requestId || `auto-${member.workspace_id}-${target.id}`.slice(0, 64);
  const authorization = wantAuto && manage ? await authorize(db, env, member, target, { requestId: autoRequestId, auto: true }) : null;
  return {
    status: 201,
    body: {
      ...(existing ? { deduped: true } : {}),
      target: await targetDetail(db, env, target.id, now),
      ...(authorization ? { authorization } : {}),
    },
  };
}

async function ensureAccountRow(db, env, now) {
  const scope = await accountScope(env);
  if (!scope) fail(409, 'The DataLoopLabs API key is not configured as a server secret.', 'tracking_credential_missing');
  if (!(await one(db, 'SELECT account_scope FROM tracking_accounts WHERE account_scope=?', scope))) {
    try {
      await db.batch([query(db, `INSERT INTO tracking_accounts(account_scope,provider,base_url,track_path,contract_json,renewal_days,rate_limit_per_minute,refresh_interval_minutes,created_at,updated_at)
        VALUES(?,?,?,?,?,30,60,720,?,?)`, scope, PROVIDER, '', '', '', now, now)]);
    } catch { /* concurrent creation is fine */ }
  }
  return scope;
}

async function authorizeRoute(db, env, member, targetId, data, now) {
  keys(data ?? {}, ['requestId', 'note']);
  const { target } = await loadTargetsFor(db, member, targetId);
  const result = await authorize(db, env, member, target, data ?? {});
  return { target: await targetDetail(db, env, target.id, now), ...result };
}

/** Shared authorization for the endpoint and create-flow auto-track. */
async function authorize(db, env, member, target, { requestId, note = '', auto = false }) {
  const link = await one(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? AND target_id=?', member.workspace_id, target.id);
  const estimate = await estimateCredits(db, target.account_scope, target, link?.containers_json ?? [], Date.now());
  const renewal = estimate.units.some(unit => !unit.neverCharged);
  const purpose = renewal ? 'renewal' : 'first_track';
  if (target.status === 'closed') fail(409, 'Tracking was closed for this shipment. Re-open only with a new identifier.', 'tracking_target_closed');
  if (!estimate.credits) {
    // Repeat inside the billing window: free, no reservation.
    const job = await enqueueSyncJob(db, target.id, 'refresh', { nextAttemptAt: Date.now() });
    return { authorized: true, estimate, purpose: 'refresh', job };
  }
  const requestIdText = String(requestId ?? '').trim();
  if (requestIdText.length < 8) fail(422, 'Use the request ID shown in the form.', 'tracking_request_id_required');
  const policy = await loadPolicy(db, member.workspace_id);
  const reservation = await reserveCredits(db, {
    workspaceId: member.workspace_id, target, purpose, credits: estimate.credits,
    requestId: requestIdText, reason: note || `${auto ? 'auto-track policy' : 'authorized by ' + member.name}: ${estimate.units.length} unit(s), ${renewal ? 'renewal' : 'first track'}`,
    createdBy: member.user_id,
  });
  const job = await enqueueSyncJob(db, target.id, purpose, { reservationId: reservation.id, nextAttemptAt: Date.now() });
  return { authorized: true, estimate, purpose, reservationId: reservation.id, job };
}

async function refreshTargetRoute(db, env, member, targetId, now) {
  const { target, link } = await loadTargetsFor(db, member, targetId);
  const estimate = await estimateCredits(db, target.account_scope, target, link.containers_json, now);
  if (estimate.credits) {
    fail(409, `The 30-day billing window expired for ${estimate.credits} unit(s), so this update would charge renewal credits. Use the paid renewal authorization instead.`);
  }
  const job = await enqueueSyncJob(db, target.id, 'refresh', { nextAttemptAt: now });
  return { target: await targetDetail(db, env, target.id, now), job, estimate };
}

async function forceRefreshRoute(db, env, member, targetId, data, now) {
  keys(data, ['requestId', 'estimatedCredits', 'confirm']);
  const { target, link } = await loadTargetsFor(db, member, targetId);
  const policy = await loadPolicy(db, member.workspace_id);
  if (policy.force_refresh_policy === 'disabled') fail(409, 'The spending policy disables paid force refreshes. No credits were reserved.', 'tracking_force_refresh_disabled');
  if (data.confirm !== true) fail(422, 'Paid force refresh needs the explicit confirmation checkbox.', 'tracking_force_refresh_confirm_required');
  if (target.status === 'closed') fail(409, 'Tracking was closed for this shipment.', 'tracking_target_closed');
  const estimate = await estimateCredits(db, target.account_scope, target, link.containers_json, now);
  const expected = estimate.totalUnits || 1; // force refresh charges every tracked unit again
  if (integer(data.estimatedCredits, 'Estimated credits', 1, 10000) !== expected) {
    fail(409, `The estimate changed: a force refresh now charges ${expected} credit(s), and confirmation must match. Reload and confirm the new estimate; no credits were reserved.`, 'tracking_estimate_mismatch');
  }
  const reservation = await reserveCredits(db, {
    workspaceId: member.workspace_id, target, purpose: 'force_refresh', credits: expected,
    requestId: String(data.requestId ?? '').trim(), forceUpdate: 1,
    reason: `Paid force refresh confirmed by ${member.name}: ${expected} credit(s) always charged per provider terms.`,
    createdBy: member.user_id,
  });
  const job = await enqueueSyncJob(db, target.id, 'force_refresh', { forceUpdate: 1, reservationId: reservation.id, nextAttemptAt: now });
  return { target: await targetDetail(db, env, target.id, now), authorized: true, purpose: 'force_refresh', reservationId: reservation.id, job, estimate: { credits: expected } };
}

async function closeTargetRoute(db, env, member, targetId, now) {
  const { target, link } = await loadTargetsFor(db, member, targetId);
  if (target.status === 'closed') return { target: await targetDetail(db, env, target.id, now) };
  await db.batch([query(db, "UPDATE tracking_targets SET status='closed', updated_at=? WHERE id=?", now, target.id)]);
  await audit(db, member, 'tracking.closed', target.id, { workspace: member.workspace_id, note: link.note }).run();
  return { closed: true, target: await targetDetail(db, env, target.id, now) };
}

/** Admin settles a possibly-charged outcome by confirming with the provider account. */
async function reconcileRoute(db, env, member, targetId, data, now) {
  keys(data, ['decision', 'note']);
  const target = await one(db, 'SELECT * FROM tracking_targets WHERE id=?', recordId(targetId));
  if (!target) fail(404, 'Tracking target not found.');
  const decision = data.decision;
  if (!['charged', 'not_charged'].includes(decision)) fail(422, 'Reconcile with charged or not_charged only.', 'tracking_reconcile_invalid');
  const note = multiline(data.note ?? '', 'Reconciliation note', 3, 1000);
  const job = await one(db, `SELECT * FROM tracking_sync_jobs WHERE target_id=? AND state='needs_reconcile' ORDER BY created_at DESC LIMIT 1`, target.id);
  const reservation = job?.reservation_id ? await one(db, 'SELECT * FROM tracking_reservations WHERE id=?', job.reservation_id) : null;
  const link = await one(db, 'SELECT containers_json FROM tracking_target_links WHERE target_id=? ORDER BY rowid DESC LIMIT 1', target.id);
  const estimate = await estimateCredits(db, target.account_scope, target, link?.containers_json ?? [], now);
  const account = (await loadAccount(db, target.account_scope)) ?? { account_scope: target.account_scope, renewal_days: 30 };
  if (decision === 'charged') {
    if (!estimate.units.length) fail(409, 'No unit was pending a charge when reconciling; the windows may already cover the provider charge. Nothing was changed.', 'tracking_reconcile_no_pending');
    const units = estimate.units.length ? estimate.units : [{ container: '', estimated: true }];
    await commitChargeAt(db, account, target, units, reservation, now,
      `Admin reconciled as charged: ${note}`);
    if (job) await db.batch([query(db, `UPDATE tracking_sync_jobs SET state='done', next_attempt_at=0, last_error_kind='reconciled_charged', last_error_message=?, updated_at=? WHERE id=?`, note.slice(0, 500), now, job.id)]);
    await db.batch([query(db, `UPDATE tracking_targets SET status=CASE WHEN data_state='live' THEN 'authorized' WHEN data_state='none' THEN 'authorized' ELSE status END, last_error_kind='reconciled_charged', last_error_message=?, updated_at=? WHERE id=?`,
      note.slice(0, 700), now, target.id)]);
  } else {
    if (reservation) await settleReservation(db, target, reservation, 'released', `Admin reconciled as not charged: ${note}`);
    if (job) await db.batch([query(db, `UPDATE tracking_sync_jobs SET state='done', next_attempt_at=0, last_error_kind='reconciled_not_charged', last_error_message=?, updated_at=? WHERE id=?`, note.slice(0, 500), now, job.id)]);
    await db.batch([query(db, `UPDATE tracking_targets SET status=CASE WHEN data_state='live' THEN 'authorized' ELSE 'not_authorized' END, last_error_kind='reconciled_not_charged', last_error_message=?, updated_at=? WHERE id=?`,
      note.slice(0, 700), now, target.id)]);
  }
  await audit(db, member, `tracking.reconciled_${decision}`, target.id, { note, reservation: reservation?.id ?? null }).run();
  return { target: await targetDetail(db, env, target.id, now), decision };
}

async function commitChargeAt(db, account, target, units, reservation, now, detail) {
  const queries = units.map(unit => query(db, `INSERT INTO tracking_billing_windows(id,account_scope,identifier_type,identifier,container,last_charge_at,window_open_until,charge_count,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_scope,identifier_type,identifier,container) DO UPDATE SET
      last_charge_at=excluded.last_charge_at, window_open_until=excluded.window_open_until,
      charge_count=tracking_billing_windows.charge_count+1, updated_at=excluded.updated_at`,
    uuid(), account.account_scope, target.identifier_type, target.identifier, unit.container, now, now + account.renewal_days * 86_400_000, 1, now, now));
  queries.push(query(db, 'UPDATE tracking_targets SET updated_at=? WHERE id=?', now, target.id));
  await db.batch(queries);
  if (reservation) await settleReservation(db, target, reservation, 'charged', detail);
}

/* ------------------------------------------------------------------ policy & account */

async function savePolicyRoute(db, member, data, now) {
  keys(data, ['monthlyCreditCap', 'perShipmentCreditCap', 'autoTrack', 'renewalPolicy', 'forceRefreshPolicy', 'creditCostMinor']);
  const caps = {
    monthly: data.monthlyCreditCap == null ? null : integer(data.monthlyCreditCap, 'Monthly credit cap', 1, 1_000_000),
    shipment: data.perShipmentCreditCap == null ? null : integer(data.perShipmentCreditCap, 'Per-shipment credit cap', 1, 1_000_000),
    cost: data.creditCostMinor == null ? null : integer(data.creditCostMinor, 'Credit price', 1, 1_000_000),
  };
  if (!['manual', 'confirmed'].includes(data.autoTrack) || !['pause', 'allow'].includes(data.renewalPolicy) || !['explicit', 'disabled'].includes(data.forceRefreshPolicy)) {
    fail(422, 'Choose valid policy values (autoTrack manual/confirmed, renewalPolicy pause/allow, forceRefreshPolicy explicit/disabled).', 'tracking_policy_invalid');
  }
  await db.batch([query(db, `INSERT INTO tracking_policies(workspace_id,monthly_credit_cap,per_shipment_credit_cap,auto_track,renewal_policy,force_refresh_policy,credit_cost_minor,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(workspace_id) DO UPDATE SET monthly_credit_cap=excluded.monthly_credit_cap, per_shipment_credit_cap=excluded.per_shipment_credit_cap,
      auto_track=excluded.auto_track, renewal_policy=excluded.renewal_policy, force_refresh_policy=excluded.force_refresh_policy,
      credit_cost_minor=excluded.credit_cost_minor, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    member.workspace_id, caps.monthly, caps.shipment, data.autoTrack, data.renewalPolicy, data.forceRefreshPolicy, caps.cost, now, member.user_id)]);
  await audit(db, member, 'tracking.policy_updated', member.workspace_id, data).run();
  return { saved: true, policy: await loadPolicy(db, member.workspace_id) };
}

/** The contract is only valid when an admin records it from the account's own documentation. */
async function saveAccountRoute(db, env, member, data, now) {
  keys(data, ['baseUrl', 'trackPath', 'contract', 'contractNote', 'renewalDays', 'rateLimitPerMinute', 'refreshIntervalMinutes', 'verifyContract']);
  if (!credentialOf(env)) fail(409, 'The DataLoopLabs API key must exist as a server secret before recording the account contract. No credits were spent.', 'tracking_credential_missing');
  const baseUrl = String(data.baseUrl ?? '').trim();
  const trackPath = String(data.trackPath ?? '').trim();
  if (!/^https:\/\/[A-Za-z0-9.\-]+/.test(baseUrl)) fail(422, 'The provider base URL must be HTTPS, copied from the account documentation.', 'tracking_base_url_invalid');
  if (!/^\/[A-Za-z0-9_\-./]{1,120}$/.test(trackPath)) fail(422, 'The tracking endpoint path must start with a single slash.', 'tracking_track_path_invalid');
  const contract = typeof data.contract === 'string' ? data.contract.trim() : '';
  const parsed = contract ? parseContract(contract) : null;
  if (data.verifyContract && !parsed) {
    fail(422, 'The contract JSON is not complete. It needs request.number plus response.containers, response.reference and response.events with event.time and event.title.', 'tracking_contract_invalid');
  }
  if (data.verifyContract && text(data.contractNote ?? '', 'Contract note', 5, 1000).length < 5) fail(422, 'Record where the contract came from (page/section of the account documentation).', 'tracking_contract_note_required');
  const renewalDays = integer(data.renewalDays ?? 30, 'Renewal days', 1, 365);
  const rateLimitPerMinute = integer(data.rateLimitPerMinute ?? 60, 'Rate limit per minute', 1, 99);
  const refreshIntervalMinutes = integer(data.refreshIntervalMinutes ?? 720, 'Refresh interval', 60, 43200);
  const scope = await ensureAccountRow(db, env, now);
  await db.batch([query(db, `UPDATE tracking_accounts SET base_url=?, track_path=?, contract_json=?, contract_note=?,
    contract_verified_at=CASE WHEN ?=1 THEN COALESCE(contract_verified_at, ?) ELSE contract_verified_at END,
    renewal_days=?, rate_limit_per_minute=?, refresh_interval_minutes=?, updated_at=? WHERE account_scope=?`,
    baseUrl.slice(0, 300), trackPath.slice(0, 160), (parsed ? JSON.stringify(parsed) : contract).slice(0, 6000),
    String(data.contractNote ?? '').slice(0, 900),
    data.verifyContract === true ? 1 : 0, data.verifyContract === true ? now : null,
    renewalDays, rateLimitPerMinute, refreshIntervalMinutes, now, scope)]);
  if (data.verifyContract) {
    // Unblock jobs paused only because the contract was missing; they now run under the verified contract.
    await db.batch([query(db, `UPDATE tracking_sync_jobs SET state='queued', next_attempt_at=?, updated_at=? WHERE state='blocked_policy'
      AND last_error_kind='contract_unavailable' AND target_id IN (SELECT id FROM tracking_targets WHERE account_scope=?)`, now, now, scope)]);
  }
  await audit(db, member, data.verifyContract ? 'tracking.contract_verified' : 'tracking.contract_recorded', scope,
    { baseUrl, trackPath, verified: !!data.verifyContract, note: String(data.contractNote ?? '').slice(0, 300) }).run();
  const rows = await all(db, 'SELECT * FROM tracking_accounts WHERE account_scope=?', scope);
  return { saved: true, account: rows[0] ?? null, ready: adapterReady(env, rows[0]) };
}

/* ------------------------------------------------------------------ views */

async function buildOverview(db, env, member, now) {
  const linkRows = await all(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? ORDER BY created_at DESC LIMIT 200', member.workspace_id);
  const ids = [...new Set(linkRows.map(row => row.target_id))];
  const targets = ids.length ? await all(db, `SELECT * FROM tracking_targets WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const byId = new Map();
  for (const row of linkRows) {
    const list = byId.get(row.target_id) ?? [];
    list.push(row);
    byId.set(row.target_id, list);
  }
  const detailed = [];
  for (const target of targets) {
    detailed.push(await describeTarget(db, env, target, byId.get(target.id) ?? [], now));
  }
  const [orders, shipments, reservations, ledgerRows, policy, usage] = await Promise.all([
    all(db, `SELECT p.id, p.reference, p.status, p.created_at, p.supplier_id, s.name AS supplier_name, r.title, r.specifications, r.quantity_milli, r.unit, r.requested_delivery_at
      FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id JOIN procurement_rfqs r ON r.id=p.rfq_id
      WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 100`, member.workspace_id),
    all(db, `SELECT sh.*, s.name AS supplier_name FROM procurement_shipments sh JOIN supplier_purchase_orders p ON p.id=sh.purchase_order_id JOIN suppliers s ON s.id=p.supplier_id
      WHERE sh.workspace_id=? ORDER BY sh.created_at DESC LIMIT 200`, member.workspace_id),
    all(db, 'SELECT * FROM tracking_reservations WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30', member.workspace_id),
    all(db, 'SELECT * FROM tracking_usage_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30', member.workspace_id),
    loadPolicy(db, member.workspace_id),
    monthUsage(db, member.workspace_id, now),
  ]);
  return {
    provider: 'DataLoopLabs / TrackIT',
    account: accountView(env),
    policy,
    usage,
    targets: detailed,
    orders,
    shipments: shipments.map(row => ({ ...row, containers: parseLinkContainers(row.containers_json) })),
    reservations,
    ledger: ledgerRows,
  };
}

async function targetList(db, env, member, now, onlyId = null) {
  const rows = onlyId
    ? await all(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? AND target_id=?', member.workspace_id, recordId(onlyId))
    : await all(db, 'SELECT * FROM tracking_target_links WHERE workspace_id=? ORDER BY created_at DESC LIMIT 200', member.workspace_id);
  const ids = [...new Set(rows.map(row => row.target_id))];
  const out = [];
  for (const id of ids) {
    const target = await one(db, 'SELECT * FROM tracking_targets WHERE id=?', id);
    if (target) out.push(await describeTarget(db, env, target, rows.filter(row => row.target_id === id), now));
  }
  return out;
}

async function targetDetail(db, env, targetId, now) {
  const target = await one(db, 'SELECT * FROM tracking_targets WHERE id=?', targetId);
  if (!target) fail(404, 'Tracking target not found.', 'tracking_target_not_found');
  const links = await all(db, 'SELECT * FROM tracking_target_links WHERE target_id=? ORDER BY created_at DESC', targetId);
  return describeTarget(db, env, target, links, now);
}

async function describeTarget(db, env, target, links, now) {
  const [events, windows, jobs] = await Promise.all([
    all(db, 'SELECT * FROM tracking_events WHERE target_id=? ORDER BY event_at DESC, order_index DESC LIMIT 50', target.id),
    all(db, 'SELECT * FROM tracking_billing_windows WHERE account_scope=? AND identifier_type=? AND identifier=?', target.account_scope, target.identifier_type, target.identifier),
    all(db, 'SELECT * FROM tracking_sync_jobs WHERE target_id=? ORDER BY created_at DESC LIMIT 5', target.id),
  ]);
  const primaryLink = links[0];
  const estimate = await estimateCredits(db, target.account_scope, target, primaryLink?.containers_json ?? '[]', now);
  const policy = await loadPolicy(db, primaryLink?.workspace_id);
  const account = await loadAccount(db, target.account_scope);
  return {
    id: target.id, provider: target.provider, account_scope: target.account_scope,
    identifier_type: target.identifier_type, identifier: target.identifier, carrier: target.carrier,
    status: target.status, data_state: target.data_state, provider_ref: target.provider_ref,
    provider_payload: parseJson(target.provider_payload_json) ?? {},
    last_sync_ok_at: target.last_sync_ok_at, last_attempt_at: target.last_attempt_at,
    last_error_kind: target.last_error_kind, last_error_message: target.last_error_message,
    created_at: target.created_at, updated_at: target.updated_at,
    links: links.map(row => ({ purchase_order_id: row.purchase_order_id, shipment_id: row.shipment_id, containers: parseLinkContainers(row.containers_json), note: row.note, created_at: row.created_at })),
    events,
    windows,
    jobs,
    estimate,
    renewal_days: account?.renewal_days ?? 30,
    creditCostMinor: policy?.credit_cost_minor ?? null,
  };
}

const parseJson = value => { try { return JSON.parse(value || 'null'); } catch { return null; } };

function accountView(env) {
  const credential = !!credentialOf(env);
  return {
    provider: 'DataLoopLabs',
    configured: credential,
    maskedCredential: maskedCredential(env),
    verification: credential
      ? 'The API key exists as a server secret; its contract and endpoints must still be recorded from the account documentation before any provider call.'
      : 'No API key is configured as a server secret. Tracking cannot start.',
  };
}
