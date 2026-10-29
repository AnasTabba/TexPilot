/** Bill of lading on a PO and DataLoopLabs shipment tracking with a cached last status. The API key stays in env and never leaves this module. */
import { all, audit, fail, integer, json, keys, one, query, recordId, role, text, viewer } from './erp-utils.mjs';
import { ProviderProblem, contractGaps, credentialOf, maskedCredential, parseContract, redact, trackUnit } from './datalooplabs.mjs';
import { stageOf } from './tracking-stage.mjs';
import { notifyRole } from './notify.mjs';
import { karachiDate } from './sales.mjs';
import { reversalReason, replayed, reversalRow } from './governance.mjs';

const PROVIDER = 'DataLoopLabs';
const text2 = (value, label) => text(String(value ?? '').toUpperCase().replace(/\s+/g, ''), label, 3, 100);
const OPEN = "('accepted','dispatched')";
const DEFAULT_ROW = { enabled: 0, base_url: '', track_path: '', contract_json: '', refresh_hours: 12, daily_budget: 0, verified_by: null, verified_at: null };

/** The non-secret contract var (JSON) becomes the adapter's account; null when absent, unparsable or incomplete. */
export function accountFromEnv(env) {
  let c; try { c = JSON.parse(env?.DATALOOPLABS_CONTRACT); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const account = { base_url: c.baseUrl, track_path: c.trackPath, contract_json: JSON.stringify({ request: c.request, response: c.response }), contract_verified_at: 1 };
  return contractGaps(account).length ? null : account;
}
export const trackingConfigured = env => !!credentialOf(env) && !!accountFromEnv(env);
/** Env-only status, still read by the procurement overview. */
export const trackingStatus = env => ({ configured: trackingConfigured(env), provider: PROVIDER });

/** Strip the key (any case) and bearer patterns from every string, however deeply nested. */
export function sanitizeTrackingPayload(payload, env) {
  const key = credentialOf(env), clean = s => { const r = redact(s, env); return key ? r.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[credential removed]') : r; };
  const walk = v => typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  return walk(payload);
}

const FIELDS = 'id,purchase_order_id,bill_of_lading,status,last_status_json,last_checked_at,last_error,created_at,stage,eta,origin,destination,vessel,stage_changed_at';
// The list adds the PO reference and supplier name so rows can be labelled; the single-row reads keep FIELDS.
const LIST_FIELDS = 's.id,s.purchase_order_id,s.bill_of_lading,s.status,s.last_status_json,s.last_checked_at,s.last_error,s.created_at,s.stage,s.eta,s.origin,s.destination,s.vessel,s.stage_changed_at,po.reference,sup.name AS supplier_name';
const LIST_FROM = 'FROM shipments s LEFT JOIN supplier_purchase_orders po ON po.id=s.purchase_order_id AND po.workspace_id=s.workspace_id LEFT JOIN suppliers sup ON sup.id=po.supplier_id AND sup.workspace_id=po.workspace_id';
const shipmentOf = (db, id, w) => one(db, `SELECT ${FIELDS} FROM shipments WHERE id=? AND workspace_id=?`, id, w);

const settingsRow = async (db, w) => (await one(db, 'SELECT * FROM tracking_settings WHERE workspace_id=?', w)) ?? DEFAULT_ROW;
const accountOf = row => ({ base_url: row.base_url, track_path: row.track_path, contract_json: row.contract_json, contract_verified_at: row.verified_at });
const karachiMidnight = now => Date.parse(`${karachiDate(now)}T00:00:00+05:00`);
const callsToday = async (db, w, now) => (await one(db, 'SELECT COUNT(*) AS n FROM tracking_calls WHERE workspace_id=? AND created_at>=?', w, karachiMidnight(now))).n;

/** The account a call uses: the verified settings row when complete, else the env contract (the original path). */
export async function accountFor(db, env, w) {
  const account = accountOf(await settingsRow(db, w));
  return contractGaps(account).length === 0 ? account : accountFromEnv(env);
}

/** Status for the Tracking settings and the shipments list. Never includes the key, only its masked hint. */
export async function trackingStatusFor(db, env, w) {
  const row = await settingsRow(db, w), key = !!credentialOf(env), account = await accountFor(db, env, w);
  return {
    configured: key && !!account,
    keyConfigured: key,
    keyHint: maskedCredential(env),
    provider: PROVIDER,
    enabled: !!row.enabled,
    refreshHours: row.refresh_hours,
    dailyBudget: row.daily_budget,
    callsToday: await callsToday(db, w, Date.now()),
    contractGaps: [...(key ? [] : ['API key: the Worker secret DATALOOPLABS_API_KEY is not set']), ...(account ? [] : contractGaps(accountOf(row)))],
  };
}

const settingsView = row => ({
  enabled: !!row.enabled, baseUrl: row.base_url, trackPath: row.track_path, contract: parseContract(row.contract_json),
  refreshHours: row.refresh_hours, dailyBudget: row.daily_budget, verifiedBy: row.verified_by, verifiedAt: row.verified_at,
});
const settingsResponse = async (env, w) => ({ settings: settingsView(await settingsRow(env.DB, w)), status: await trackingStatusFor(env.DB, env, w) });

const httpsBase = value => {
  if (typeof value !== 'string' || value.length > 300) fail(422, 'Base URL must be an https:// address.');
  const v = value.trim();
  if (!v) return '';
  let u; try { u = new URL(v); } catch { fail(422, 'Base URL must be an https:// address.'); }
  if (u.protocol !== 'https:' || u.username || u.password) fail(422, 'Base URL must be an https:// address.');
  return v;
};
const trackPathOf = value => {
  if (typeof value !== 'string') fail(422, 'Tracking path must start with /.');
  const v = value.trim();
  if (v && !/^\/[A-Za-z0-9_\-./]*$/.test(v)) fail(422, 'Tracking path must start with / and use only letters, digits, - _ . and /.');
  return v;
};

async function saveSettings(env, member, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now();
  role(member, data, 'admin');
  keys(data, ['enabled', 'baseUrl', 'trackPath', 'contract', 'refreshHours', 'dailyBudget', 'verified']);
  if (typeof data.enabled !== 'boolean') fail(422, 'Enabled must be true or false.');
  const baseUrl = httpsBase(data.baseUrl), trackPath = trackPathOf(data.trackPath);
  const refreshHours = integer(data.refreshHours, 'Refresh hours', 1, 168), dailyBudget = integer(data.dailyBudget, 'Daily call budget', 0, 1000);
  let contractJson = '', verifiedBy = null, verifiedAt = null;
  if (data.contract !== null) {
    const parsed = data.contract && typeof data.contract === 'object' ? parseContract(JSON.stringify(data.contract)) : null;
    if (!parsed) fail(422, 'The contract must map request.number and the response fields containers, reference, events, event.time and event.title.');
    if (data.verified !== true) fail(422, 'Confirm you read the account documentation before saving a contract.');
    contractJson = JSON.stringify({ request: parsed.request, response: parsed.response });
    verifiedBy = member.name; verifiedAt = now;
  }
  const prior = await settingsRow(db, w);
  const next = { enabled: data.enabled ? 1 : 0, base_url: baseUrl, track_path: trackPath, contract_json: contractJson, refresh_hours: refreshHours, daily_budget: dailyBudget, verified_by: verifiedBy, verified_at: verifiedAt };
  await db.batch([
    query(db, `INSERT INTO tracking_settings(workspace_id,enabled,base_url,track_path,contract_json,refresh_hours,daily_budget,verified_by,verified_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled,base_url=excluded.base_url,track_path=excluded.track_path,contract_json=excluded.contract_json,refresh_hours=excluded.refresh_hours,daily_budget=excluded.daily_budget,verified_by=excluded.verified_by,verified_at=excluded.verified_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      w, next.enabled, baseUrl, trackPath, contractJson, refreshHours, dailyBudget, verifiedBy, verifiedAt, member.name, now),
    audit(db, member, 'tracking.settings_changed', w, {}, 'staff', { objectType: 'tracking', before: settingsView(prior), after: settingsView(next) }),
  ]);
  return json(await settingsResponse(env, w));
}

/** Track one shipment and persist the outcome: cache, events, stage, call log. Shared by the Track route and the scheduled refresh.
 * Returns { error } on a failed or unconfigured call, otherwise { stageChanged: {from, to} } when the stage moved, else {}. */
export async function trackShipment(env, w, shipment, { trigger, account, extra = [] }) {
  const db = env.DB, now = Date.now();
  const callLog = outcome => query(db, 'INSERT INTO tracking_calls(id,workspace_id,shipment_id,trigger,outcome,created_at) VALUES(?,?,?,?,?,?)', crypto.randomUUID(), w, shipment.id, trigger, outcome, now);
  let result;
  try {
    result = sanitizeTrackingPayload(await trackUnit(env, account, { identifier: shipment.bill_of_lading, identifier_type: 'bol' }), env);
  } catch (error) {
    if (!(error instanceof ProviderProblem)) throw error;
    // No call was made, so nothing is logged against the daily budget.
    if (error.kind === 'not_configured') return { error: 'Tracking is not configured: API key missing.' };
    if (error.kind === 'contract_unavailable') return { error: 'Tracking is not configured: provider contract unavailable.' };
    const message = sanitizeTrackingPayload(error.message, env);
    await db.batch([query(db, `UPDATE shipments SET last_error=?,status=CASE WHEN last_status_json IS NULL THEN 'error' ELSE status END,updated_at=? WHERE id=? AND workspace_id=?`, message, now, shipment.id, w), callLog(error.kind), ...extra]);
    return { error: message };
  }
  const stage = stageOf('tracked', result), from = shipment.stage ?? null, changed = from !== stage;
  await db.batch([
    query(db, `UPDATE shipments SET status='tracked',last_status_json=?,last_checked_at=?,last_error=NULL,updated_at=?,stage=?,stage_changed_at=?,eta=COALESCE(?,eta),origin=COALESCE(?,origin),destination=COALESCE(?,destination),vessel=COALESCE(?,vessel) WHERE id=? AND workspace_id=?`,
      JSON.stringify(result), now, now, stage, changed ? now : (shipment.stage_changed_at ?? null), result.eta, result.origin, result.destination, result.vessel, shipment.id, w),
    // ponytail: an unknown event time is stored as 0 because SQLite UNIQUE treats NULLs as distinct, which would break the dedupe
    ...result.events.map(e => query(db, 'INSERT OR IGNORE INTO shipment_events(id,workspace_id,shipment_id,at,title,code,location,created_at) VALUES(?,?,?,?,?,?,?,?)', crypto.randomUUID(), w, shipment.id, e.at ?? 0, e.title, e.code, e.location, now)),
    callLog('ok'),
    // Buyers and admins hear when a shipment moves to a new stage (first sighting included).
    ...(changed ? ['purchase_manager', 'admin'].map(role => notifyRole(db, w, role, 'shipment.stage_changed', 'shipment', shipment.id, `${shipment.bill_of_lading} · ${stage.replace('_', ' ')}`)) : []),
    ...extra,
  ]);
  return changed ? { stageChanged: { from, to: stage } } : {};
}

const eventsByShipment = async (db, w) => {
  const map = new Map();
  // The 20 newest per shipment in one query; an unknown time (stored as 0) sorts last.
  for (const e of await all(db, 'SELECT shipment_id,at,title,code,location FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY shipment_id ORDER BY at DESC, created_at DESC, id) AS rn FROM shipment_events WHERE workspace_id=?) WHERE rn<=20 ORDER BY shipment_id, rn', w)) {
    const list = map.get(e.shipment_id) ?? [];
    list.push({ at: e.at || null, title: e.title, code: e.code, location: e.location });
    map.set(e.shipment_id, list);
  }
  return map;
};

const logFailure = (env, error) => console.error('Tracking refresh failed:', redact(error?.message ?? error, env));

/** Auto-refresh for workspaces that enabled it: oldest-checked shipments first, within the Karachi-day call budget. Never throws. */
export async function trackingScheduled(env, now = Date.now()) {
  const db = env.DB, stageChanges = [];
  let checked = 0;
  try {
    if (!credentialOf(env)) return { checked, stageChanges };
    for (const s of await all(db, 'SELECT workspace_id,refresh_hours,daily_budget FROM tracking_settings WHERE enabled=1')) {
      try {
        const account = await accountFor(db, env, s.workspace_id);
        const remaining = s.daily_budget - await callsToday(db, s.workspace_id, now);
        if (!account || remaining <= 0) continue;
        const due = await all(db, `SELECT ${FIELDS} FROM shipments WHERE workspace_id=? AND COALESCE(stage,'')<>'delivered' AND (last_checked_at IS NULL OR last_checked_at<?) ORDER BY last_checked_at,id LIMIT ?`,
          s.workspace_id, now - s.refresh_hours * 3600000, Math.min(remaining, 20));
        for (const shipment of due) {
          try {
            const outcome = await trackShipment(env, s.workspace_id, shipment, { trigger: 'auto', account });
            checked++;
            if (outcome.stageChanged) stageChanges.push({ shipmentId: shipment.id, ...outcome.stageChanged });
          } catch (error) { logFailure(env, error); }
        }
      } catch (error) { logFailure(env, error); }
    }
  } catch (error) { logFailure(env, error); }
  return { checked, stageChanges };
}

export async function trackingApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now();
  // Wired from server/inventory.mjs as erp.tracking; the settings are for admins to write and purchase managers to read.
  if (path === '/api/erp/tracking/settings') {
    if (data) return saveSettings(env, member, data);
    viewer(member, 'purchase_manager');
    return json(await settingsResponse(env, w));
  }
  if (path === '/api/erp/shipments' && !data) {
    viewer(member, 'purchase_manager');
    const orderId = new URL(request.url).searchParams.get('orderId');
    const shipments = orderId
      ? await all(db, `SELECT ${LIST_FIELDS} ${LIST_FROM} WHERE s.workspace_id=? AND s.purchase_order_id=? ORDER BY s.created_at DESC,s.id`, w, recordId(orderId))
      : await all(db, `SELECT ${LIST_FIELDS} ${LIST_FROM} WHERE s.workspace_id=? ORDER BY s.created_at DESC,s.id LIMIT 200`, w);
    const events = await eventsByShipment(db, w);
    return json({ shipments: shipments.map(s => ({ ...s, events: events.get(s.id) ?? [] })), tracking: await trackingStatusFor(db, env, w) });
  }
  if (path === '/api/erp/shipments' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data, ['id', 'orderId', 'billOfLading', 'interventionReason']);
    const id = recordId(data.id), orderId = recordId(data.orderId), bl = text(String(data.billOfLading ?? '').toUpperCase().replace(/\s+/g, ''), 'Bill of lading', 3, 100);
    const order = await one(db, 'SELECT id,status,approval_status,bill_of_lading FROM supplier_purchase_orders WHERE id=? AND workspace_id=?', orderId, w);
    if (!order) fail(404, 'Purchase order not found.');
    const same = row => row.purchase_order_id === orderId && row.bill_of_lading === bl;
    const prior = await shipmentOf(db, id, w);
    if (prior) { if (!same(prior)) fail(409, 'This request ID was already used for a different bill of lading.'); return json({ shipment: prior }); }
    if (order.approval_status !== 'approved' || !['accepted', 'dispatched'].includes(order.status)) fail(409, 'A bill of lading can only be attached to an approved, open purchase order.');
    try {
      await db.batch([
        query(db, 'INSERT INTO shipments(id,workspace_id,purchase_order_id,bill_of_lading,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, w, orderId, bl, member.user_id, now, now),
        query(db, `UPDATE supplier_purchase_orders SET bill_of_lading=?,updated_at=? WHERE id=? AND workspace_id=? AND approval_status='approved' AND status IN ${OPEN}`, bl, now, orderId, w),
        // A PO that was cancelled or changed since the check above aborts the whole batch: no shipment, no audit row.
        query(db, `SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM supplier_purchase_orders WHERE id=? AND workspace_id=? AND bill_of_lading=? AND approval_status='approved' AND status IN ${OPEN})`, orderId, w, bl),
        audit(db, member, 'po.bl_attached', orderId, { shipmentId: id, billOfLading: bl }, 'staff', { objectType: 'po', before: { billOfLading: order.bill_of_lading }, after: { billOfLading: bl }, intervention }),
      ]);
    } catch {
      const raced = await shipmentOf(db, id, w);
      if (raced && same(raced)) return json({ shipment: raced });
      fail(409, 'This bill of lading is already on the order, or the order changed. Reload and try again.');
    }
    return json({ shipment: await shipmentOf(db, id, w) }, 201);
  }
  if (path === '/api/erp/shipments/correct' && data) {
    // A typed bill of lading is corrected in place, but only before tracking has events: the old number is in the audit row.
    const intervention = role(member, data, 'purchase_manager');
    keys(data, ['id','shipmentId','billOfLading','reason','interventionReason']);
    const requestId = recordId(data.id), text = reversalReason(data.reason), bl = text2(data.billOfLading, 'Bill of lading');
    const shipment = await shipmentOf(db, recordId(data.shipmentId), w);
    if (!shipment) fail(404, 'Shipment not found.');
    if (await replayed(db, requestId, 'shipment.bl_corrected', shipment.id)) return json({ shipment });
    if (shipment.bill_of_lading === bl) fail(422, 'Enter a different bill of lading.');
    if (await one(db, 'SELECT 1 AS x FROM shipment_events WHERE shipment_id=? LIMIT 1', shipment.id)) fail(409, 'Tracking already has events for this shipment, so its bill of lading cannot change. Record the correct shipment instead.');
    try {
      await db.batch([
        query(db, 'UPDATE shipments SET bill_of_lading=?,updated_at=? WHERE id=? AND workspace_id=? AND bill_of_lading=? AND NOT EXISTS(SELECT 1 FROM shipment_events WHERE shipment_id=shipments.id)', bl, now, shipment.id, w, shipment.bill_of_lading),
        query(db, "SELECT json('!') WHERE changes()=0"),
        query(db, 'UPDATE supplier_purchase_orders SET bill_of_lading=?,updated_at=? WHERE id=? AND workspace_id=? AND bill_of_lading=?', bl, now, shipment.purchase_order_id, w, shipment.bill_of_lading),
        reversalRow(db, member, requestId, 'shipment.bl_corrected', shipment.id, text, now),
        audit(db, member, 'shipment.bl_corrected', shipment.id, { orderId: shipment.purchase_order_id, billOfLading: bl }, 'staff', { objectType: 'shipment', before: { billOfLading: shipment.bill_of_lading }, after: { billOfLading: bl }, reason: text, intervention }),
      ]);
    } catch { fail(409, 'This bill of lading is already on the order, or the shipment changed. Reload and try again.'); }
    return json({ shipment: await shipmentOf(db, shipment.id, w) });
  }
  if (path === '/api/erp/shipments/track' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data, ['id', 'interventionReason']);
    const shipment = await shipmentOf(db, recordId(data.id), w);
    if (!shipment) fail(404, 'Shipment not found.');
    // Only an admin override is audited; the purchase manager's own lookups are not decisions.
    const tracked = intervention ? [audit(db, member, 'shipment.tracked', shipment.id, { orderId: shipment.purchase_order_id }, 'staff', { objectType: 'shipment', intervention })] : [];
    // ponytail: one paid provider call per Track press; add the credit budget from the erp-tracking worktree if billing matters
    const outcome = await trackShipment(env, w, shipment, { trigger: 'manual', account: await accountFor(db, env, w), extra: tracked });
    return json({ shipment: await shipmentOf(db, shipment.id, w), ...outcome });
  }
  fail(404, 'Shipment route not found.');
}
