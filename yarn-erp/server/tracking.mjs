/** Bill of lading on a PO and DataLoopLabs shipment tracking with a cached last status. The API key stays in env and never leaves this module. */
import { all, audit, fail, json, keys, one, query, recordId, role, text, viewer } from './erp-utils.mjs';
import { ProviderProblem, contractGaps, credentialOf, redact, trackUnit } from './datalooplabs.mjs';

const PROVIDER = 'DataLoopLabs';
const OPEN = "('accepted','dispatched')";

/** The non-secret contract var (JSON) becomes the adapter's account; null when absent, unparsable or incomplete. */
export function accountFromEnv(env) {
  let c; try { c = JSON.parse(env?.DATALOOPLABS_CONTRACT); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const account = { base_url: c.baseUrl, track_path: c.trackPath, contract_json: JSON.stringify({ request: c.request, response: c.response }), contract_verified_at: 1 };
  return contractGaps(account).length ? null : account;
}
export const trackingConfigured = env => !!credentialOf(env) && !!accountFromEnv(env);
export const trackingStatus = env => ({ configured: trackingConfigured(env), provider: PROVIDER });

/** Strip the key (any case) and bearer patterns from every string, however deeply nested. */
export function sanitizeTrackingPayload(payload, env) {
  const key = credentialOf(env), clean = s => { const r = redact(s, env); return key ? r.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[credential removed]') : r; };
  const walk = v => typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  return walk(payload);
}

const FIELDS = 'id,purchase_order_id,bill_of_lading,status,last_status_json,last_checked_at,last_error,created_at';
const shipmentOf = (db, id, w) => one(db, `SELECT ${FIELDS} FROM shipments WHERE id=? AND workspace_id=?`, id, w);

export async function trackingApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now();
  if (path === '/api/erp/shipments' && !data) {
    viewer(member, 'purchase_manager');
    const orderId = new URL(request.url).searchParams.get('orderId');
    const shipments = orderId
      ? await all(db, `SELECT ${FIELDS} FROM shipments WHERE workspace_id=? AND purchase_order_id=? ORDER BY created_at DESC,id`, w, recordId(orderId))
      : await all(db, `SELECT ${FIELDS} FROM shipments WHERE workspace_id=? ORDER BY created_at DESC,id LIMIT 200`, w);
    return json({ shipments, tracking: trackingStatus(env) });
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
  if (path === '/api/erp/shipments/track' && data) {
    const intervention = role(member, data, 'purchase_manager');
    keys(data, ['id', 'interventionReason']);
    const shipment = await shipmentOf(db, recordId(data.id), w);
    if (!shipment) fail(404, 'Shipment not found.');
    // Only an admin override is audited; the purchase manager's own lookups are not decisions.
    const tracked = (sh, why) => why ? [audit(db, member, 'shipment.tracked', sh.id, { orderId: sh.purchase_order_id }, 'staff', { objectType: 'shipment', intervention: why })] : [];
    let result;
    try {
      // ponytail: one paid provider call per Track press; add the credit budget from the erp-tracking worktree if billing matters
      result = sanitizeTrackingPayload(await trackUnit(env, accountFromEnv(env), { identifier: shipment.bill_of_lading, identifier_type: 'bol' }), env);
    } catch (error) {
      if (!(error instanceof ProviderProblem)) throw error;
      if (error.kind === 'not_configured') return json({ shipment, error: 'Tracking is not configured: API key missing.' });
      if (error.kind === 'contract_unavailable') return json({ shipment, error: 'Tracking is not configured: provider contract unavailable.' });
      const message = sanitizeTrackingPayload(error.message, env);
      await db.batch([query(db, `UPDATE shipments SET last_error=?,status=CASE WHEN last_status_json IS NULL THEN 'error' ELSE status END,updated_at=? WHERE id=? AND workspace_id=?`, message, now, shipment.id, w), ...tracked(shipment, intervention)]);
      return json({ shipment: await shipmentOf(db, shipment.id, w), error: message });
    }
    await db.batch([query(db, "UPDATE shipments SET status='tracked',last_status_json=?,last_checked_at=?,last_error=NULL,updated_at=? WHERE id=? AND workspace_id=?", JSON.stringify(result), now, now, shipment.id, w), ...tracked(shipment, intervention)]);
    return json({ shipment: await shipmentOf(db, shipment.id, w) });
  }
  fail(404, 'Shipment route not found.');
}
