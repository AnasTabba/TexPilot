/** The factory's outbound door. The dispatcher requests a sale dispatch against a confirmed order, the
 * sales manager approves it or holds it with a term, and goods leave only when the dispatch itself runs:
 * one batch writes the sale dispatch, the ledger movement and the order status together. The factory
 * floor may hold an approved dispatch only after a sales-manager hold notice. Stock problems go to the
 * supervisor as stock issues whose gates — the dispatch-stock-issue and inventory-adjustment thresholds
 * — decide through the shared approvals engine whether the accepted correction waits for an admin. */
import { all, audit, fail, integer, json, keys, multiline, one, query, reason as reasonOf, recordId, role, text, viewer } from './erp-utils.mjs';
import { approvalQueries, needsApproval, thresholdOf } from './governance.mjs';
import { notifyRole, notifyUser } from './notify.mjs';
import { movementQueries, reversalQueries } from './stock-ledger.mjs';
import { adjustmentQueries } from './stock.mjs';

const MAX_GRAMS = 9_000_000_000_000;
const STATUSES = ['pending_approval', 'approved', 'on_hold', 'dispatched', 'delivered'];
const TERMS = ['payment_overdue', 'terms_not_met', 'other'];
const REUSED = 'This request ID was already used for different values.';
const HOLD_PENDING = 'A sales-manager hold notice is pending; acknowledge it before dispatching.';
const RAW_ONLY = 'Raw stock cannot be sale-dispatched; only finished goods are supported.';
const LEGACY = 'Legacy cops/WIP stock is read-only; an authorized migration is required.';
const FINISHED_ONLY = 'No finished stock is left in this batch.';
const IN_PRODUCTION = 'This batch is still in production. Finish it before it can be dispatched.';
const APPROVED_ONLY = 'Only an approved dispatch can leave the factory.';
const SHORT_STOCK = 'Stock is short or does not match. Raise a stock issue to the supervisor.';
const NEGATIVE = 'This would make stock negative.';
const DECIDED = 'This request was already decided. Reload.';
const NO_NOTICE = 'A hold needs a message from the sales manager.';
const guard = (db, condition, ...args) => query(db, `SELECT json('!') WHERE NOT (${condition})`, ...args);
const fmt = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const kg = milli => fmt.format(milli / 1000);
const sameAs = (row, expected) => Object.entries(expected).every(([k, v]) => row[k] === v);
const balanceOf = async (db, lotId, stage) => (await one(db, 'SELECT grams FROM balances WHERE lot_id=? AND stage=?', lotId, stage))?.grams ?? 0;
const dispatchOf = (db, id, workspaceId) => one(db, 'SELECT * FROM dispatches WHERE id=? AND workspace_id=?', id, workspaceId);
const labelOf = async (db, dispatchId) => {
  const row = await one(db, 'SELECT l.batch,p.name FROM dispatches d JOIN lots l ON l.id=d.lot_id JOIN products p ON p.id=l.product_id WHERE d.id=?', dispatchId);
  return row ? `${row.name} · ${row.batch}` : '';
};
// A reversed sale dispatch no longer counts against the order (its movement reverses it).
const liveSales = `sales_dispatches d WHERE d.sales_order_id=o.id AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=d.movement_id)`;
const remainingOf = line => `${line}.quantity_milli
  - COALESCE((SELECT SUM(d.quantity_milli) FROM ${liveSales}),0)
  - COALESCE((SELECT SUM(g.quantity_milli) FROM dispatches g WHERE g.sales_order_id=o.id AND g.status IN ('pending_approval','approved','on_hold')),0)`;

export async function dispatchApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now(), base = '/api/erp/dispatch';

  if (request.method === 'GET') {
    if (path === base) {
      viewer(member, 'dispatch', 'sales_manager');
      const status = new URL(request.url).searchParams.get('status');
      if (status !== null && !STATUSES.includes(status)) fail(422, 'Choose a valid dispatch status.');
      const dispatches = await all(db, `SELECT d.*,l.batch AS lot_batch,p.name AS product_name,o.reference AS order_reference,b.name AS buyer_name,
        lg.quantity_milli AS ordered_milli,${remainingOf('lg')} AS remaining_milli,
        (SELECT r.id FROM dispatch_requests r WHERE r.dispatch_id=d.id AND r.kind='approval' AND r.status='pending' LIMIT 1) AS approval_request_id,
        (SELECT r.id FROM dispatch_requests r WHERE r.dispatch_id=d.id AND r.kind='hold_notice' AND r.status='pending' LIMIT 1) AS hold_notice_id
        FROM dispatches d JOIN lots l ON l.id=d.lot_id JOIN products p ON p.id=l.product_id
        JOIN sales_orders o ON o.id=d.sales_order_id JOIN sales_order_lines lg ON lg.id=(SELECT MIN(l2.id) FROM sales_order_lines l2 WHERE l2.sales_order_id=o.id) JOIN buyers b ON b.id=o.buyer_id
        WHERE d.workspace_id=?${status ? ' AND d.status=?' : ''} ORDER BY d.created_at DESC,d.id DESC LIMIT 200`, ...(status ? [w, status] : [w]));
      const orders = await all(db, `SELECT o.id,o.reference,o.status,b.name AS buyer_name,l.product_id,p.name AS product_name,l.quantity_milli,${remainingOf('l')} AS remaining_milli
        FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id JOIN buyers b ON b.id=o.buyer_id LEFT JOIN products p ON p.id=l.product_id
        WHERE o.workspace_id=? AND o.status IN ('confirmed','partially_dispatched') ORDER BY o.created_at DESC,o.id DESC LIMIT 200`, w);
      return json({ dispatches, orders });
    }
    if (path === base + '/stock-issues') {
      viewer(member, 'supervisor');
      const status = new URL(request.url).searchParams.get('status');
      if (status !== null && !['open', 'pending_approval', 'accepted', 'rejected'].includes(status)) fail(422, 'Choose a valid issue status.');
      const issues = await all(db, `SELECT i.id,i.dispatch_id,i.lot_id,i.stage,i.kind,i.difference_grams,i.description,i.status,i.decision_reason,
        i.correction_grams,i.adjustment_id,i.created_at,l.batch AS lot_batch,p.name AS product_name
        FROM stock_issues i JOIN lots l ON l.id=i.lot_id JOIN products p ON p.id=l.product_id
        WHERE i.workspace_id=?${status ? ' AND i.status=?' : ''} ORDER BY i.created_at DESC,i.id DESC LIMIT 200`, ...(status ? [w, status] : [w]));
      return json({ issues, thresholds: { dispatchStockIssueGrams: await thresholdOf(db, w, 'dispatch_stock_issue'), inventoryAdjustmentGrams: await thresholdOf(db, w, 'inventory_adjustment') } });
    }
    fail(404, 'Dispatch route not found.');
  }

  if (path === base) {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['id', 'orderId', 'lotId', 'quantityMilli', 'grams', 'cartons', 'cones', 'vehicle', 'transporter', 'interventionReason']);
    const id = recordId(data.id), orderId = recordId(data.orderId), lotId = recordId(data.lotId);
    const quantityMilli = integer(data.quantityMilli, 'Quantity', 1, 1_000_000_000);
    const grams = data.grams === undefined ? quantityMilli : integer(data.grams, 'Weight in grams', 1, MAX_GRAMS);
    if (grams !== quantityMilli) fail(422, 'The dispatched weight must match the ordered quantity.');
    const cartons = integer(data.cartons ?? 0, 'Cartons', 0, 1_000_000_000), cones = integer(data.cones ?? 0, 'Cones', 0, 1_000_000_000);
    const vehicle = text(data.vehicle ?? '', 'Vehicle', 0, 100), transporter = text(data.transporter ?? '', 'Transporter', 0, 100);
    const terms = { sales_order_id: orderId, lot_id: lotId, quantity_milli: quantityMilli, grams, cartons, cones, vehicle, transporter, created_by: member.user_id };
    const previous = await dispatchOf(db, id, w);
    if (previous) return sameAs(previous, terms) ? json({ dispatch: previous }) : fail(409, REUSED);
    const order = await one(db, `SELECT o.reference,o.status,l.product_id,l.unit,${remainingOf('l')} AS remaining
      FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id WHERE o.id=? AND o.workspace_id=?`, orderId, w);
    if (!order) fail(404, 'Sale order not found.');
    if (!['confirmed', 'partially_dispatched'].includes(order.status)) fail(409, 'The sale order is not open for dispatch.');
    if (order.unit !== 'kg') fail(422, 'Sale dispatch moves weighed stock; this order is not sold by the kilogram.');
    if (order.remaining < quantityMilli) fail(409, `Only ${kg(order.remaining)} kg remain on this order.`);
    const lot = await one(db, 'SELECT id,product_id,inventory_type,quality FROM lots WHERE id=? AND workspace_id=?', lotId, w);
    if (!lot) fail(404, 'This lot was not found in your workspace.');
    if (lot.quality !== 'approved') fail(409, 'A batch may be dispatched only after QC approves it.');
    // Decided by balances: a batch moves raw -> wip -> finished and keeps its origin (inventory_type) for life.
    const held = new Set((await all(db, 'SELECT stage FROM balances WHERE lot_id=? AND grams>0', lotId)).map(b => b.stage));
    const finishedGrams = await balanceOf(db, lotId, 'finished');
    if (finishedGrams <= 0) {
      if (held.has('cops') || (held.has('wip') && lot.inventory_type !== 'raw')) fail(422, LEGACY);
      if (held.has('wip')) fail(422, IN_PRODUCTION);
      if (held.has('raw')) fail(422, RAW_ONLY);
      fail(422, FINISHED_ONLY);
    }
    if (order.product_id !== null && order.product_id !== lot.product_id) fail(422, 'The batch is not the material on this sale order.');
    const requestId = crypto.randomUUID();
    const lotLabel = await one(db, 'SELECT l.batch,p.name FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?', lotId);
    try {
      await db.batch([
        guard(db, `EXISTS(SELECT 1 FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id
          WHERE o.id=? AND o.workspace_id=? AND o.status IN ('confirmed','partially_dispatched') AND l.unit='kg' AND ${remainingOf('l')} >= ?)`, orderId, w, quantityMilli),
        query(db, `INSERT INTO dispatches(id,workspace_id,sales_order_id,lot_id,quantity_milli,grams,cartons,cones,status,vehicle,transporter,version,created_by,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'pending_approval',?,?,1,?,?,?)`, id, w, orderId, lotId, quantityMilli, grams, cartons, cones, vehicle, transporter, member.user_id, now, now),
        query(db, `INSERT INTO dispatch_requests(id,workspace_id,dispatch_id,kind,status,message,requested_by,created_by,created_at,updated_at)
          VALUES(?,?,?,'approval','pending','',?,?,?,?)`, requestId, w, id, member.user_id, member.user_id, now, now),
        notifyRole(db, w, 'sales_manager', 'dispatch.approval_requested', 'dispatch', id, `${order.reference} · ${lotLabel.name} · ${lotLabel.batch}`),
        audit(db, member, 'dispatch.requested', id, { order: order.reference, lot: lotId, quantityMilli, grams, request: requestId }, 'staff', { objectType: 'dispatch', intervention }),
      ]);
    } catch {
      const raced = await dispatchOf(db, id, w);
      if (raced) return sameAs(raced, terms) ? json({ dispatch: raced }) : fail(409, REUSED);
      fail(409, 'The dispatch could not be requested. Refresh and try again.');
    }
    return json({ dispatch: await dispatchOf(db, id, w), requestId }, 201);
  }

  if (path === base + '/request') {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['dispatchId', 'interventionReason']);
    const dispatchId = recordId(data.dispatchId);
    const row = await dispatchOf(db, dispatchId, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    if (row.status === 'approved') fail(409, 'This dispatch is already approved.');
    if (row.status !== 'on_hold') fail(409, 'Only an on-hold dispatch can be re-requested.');
    try {
      await db.batch([
        query(db, "UPDATE dispatches SET status='pending_approval',updated_at=? WHERE id=? AND workspace_id=?", now, dispatchId, w),
        query(db, `INSERT INTO dispatch_requests(id,workspace_id,dispatch_id,kind,status,message,requested_by,created_by,created_at,updated_at)
          VALUES(?,?,?,'approval','pending','',?,?,?,?)`, crypto.randomUUID(), w, dispatchId, member.user_id, member.user_id, now, now),
        notifyRole(db, w, 'sales_manager', 'dispatch.approval_requested', 'dispatch', dispatchId, await labelOf(db, dispatchId)),
        audit(db, member, 'dispatch.re_requested', dispatchId, {}, 'staff', { objectType: 'dispatch', intervention }),
      ]);
    } catch {
      const raced = await dispatchOf(db, dispatchId, w);
      if (raced?.status === 'pending_approval') return json({ dispatch: raced });
      fail(409, 'This dispatch already waits for a decision. Refresh and try again.');
    }
    return json({ dispatch: await dispatchOf(db, dispatchId, w) }, 200);
  }

  if (path === base + '/hold-notices' && request.method === 'POST') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['dispatchId', 'term', 'message', 'interventionReason']);
    const dispatchId = recordId(data.dispatchId);
    if (!TERMS.includes(data.term)) fail(422, 'Choose payment_overdue, terms_not_met or other.');
    const message = multiline(data.message, 'Message', 1, 1000);
    const row = await dispatchOf(db, dispatchId, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    if (!['pending_approval', 'approved'].includes(row.status)) fail(409, 'Only an open dispatch can receive a hold notice.');
    const pendingNotice = await one(db, "SELECT * FROM dispatch_requests WHERE dispatch_id=? AND workspace_id=? AND kind='hold_notice' AND status='pending'", dispatchId, w);
    if (pendingNotice) {
      if (pendingNotice.term === data.term && pendingNotice.message === message && pendingNotice.requested_by === member.user_id)
        return json({ dispatch: row, noticeId: pendingNotice.id });
      fail(409, 'A hold notice is already waiting for dispatch.');
    }
    const label = await labelOf(db, dispatchId), id = crypto.randomUUID();
    try {
      await db.batch([
        query(db, `INSERT INTO dispatch_requests(id,workspace_id,dispatch_id,kind,status,term,message,requested_by,created_by,created_at,updated_at)
          VALUES(?,?,?,'hold_notice','pending',?,?,?,?,?,?)`, id, w, dispatchId, data.term, message, member.user_id, member.user_id, now, now),
        notifyUser(db, w, row.created_by, 'dispatch.hold_notice', 'dispatch', dispatchId, `${label} · ${data.term.replace(/_/g, ' ')}`),
        audit(db, member, 'dispatch.hold_notice', dispatchId, { term: data.term, notice: id }, 'staff', { objectType: 'dispatch', intervention }),
      ]);
    } catch {
      const raced = await one(db, "SELECT * FROM dispatch_requests WHERE dispatch_id=? AND workspace_id=? AND kind='hold_notice' AND status='pending'", dispatchId, w);
      if (raced?.term === data.term && raced.message === message && raced.requested_by === member.user_id) return json({ dispatch: row, noticeId: raced.id });
      fail(409, 'The hold notice could not be sent. Refresh and try again.');
    }
    return json({ dispatch: await dispatchOf(db, dispatchId, w), noticeId: id }, 201);
  }

  if (path === base + '/requests/decide' && request.method === 'POST') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['requestId', 'decision', 'term', 'reason', 'interventionReason']);
    const requestId = recordId(data.requestId);
    if (!['approve', 'hold'].includes(data.decision)) fail(422, 'Choose approve or hold.');
    const request = await one(db, "SELECT * FROM dispatch_requests WHERE id=? AND workspace_id=? AND kind='approval'", requestId, w);
    if (!request) fail(404, 'Dispatch approval request not found.');
    if (request.status !== 'pending') fail(409, DECIDED);
    const row = await dispatchOf(db, request.dispatch_id, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    if (row.status !== 'pending_approval') fail(409, DECIDED);
    if (data.decision === 'hold' && !TERMS.includes(data.term)) fail(422, 'Choose payment_overdue, terms_not_met or other.');
    let why = null;
    if (data.decision === 'hold') why = reasonOf(data.reason, 'Hold reason');
    else if (data.reason !== undefined) why = reasonOf(data.reason, 'Decision reason');
    const label = await labelOf(db, request.dispatch_id), decided = data.decision === 'approve', term = decided ? null : data.term;
    try {
      // No status filter: the decision triggers abort the whole batch when somebody decided first.
      await db.batch([
        query(db, "UPDATE dispatch_requests SET status=?,term=?,reason=?,decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?",
          decided ? 'approved' : 'held', term, why, member.user_id, now, now, requestId, w),
        decided
          ? query(db, "UPDATE dispatches SET status='approved',updated_at=? WHERE id=? AND workspace_id=?", now, request.dispatch_id, w)
          : query(db, "UPDATE dispatches SET status='on_hold',hold_reason=?,updated_at=? WHERE id=? AND workspace_id=?", why, now, request.dispatch_id, w),
        notifyUser(db, w, row.created_by, `dispatch.${decided ? 'approved' : 'held'}`, 'dispatch', request.dispatch_id, label),
        audit(db, member, `dispatch.${decided ? 'approved' : 'held'}`, request.dispatch_id, { request: requestId, ...(decided ? {} : { term }), reason: why }, 'staff', { objectType: 'dispatch', reason: why, intervention }),
      ]);
    } catch { fail(409, DECIDED); }
    const done = await dispatchOf(db, request.dispatch_id, w);
    return json({ request: { ...request, status: decided ? 'approved' : 'held' }, dispatch: done });
  }

  if (path === base + '/hold' && request.method === 'POST') {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['dispatchId', 'noticeId', 'reason', 'interventionReason']);
    const dispatchId = recordId(data.dispatchId);
    const why = reasonOf(data.reason, 'Hold reason');
    const row = await dispatchOf(db, dispatchId, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    const notice = data.noticeId === undefined ? null
      : await one(db, "SELECT * FROM dispatch_requests WHERE id=? AND dispatch_id=? AND workspace_id=? AND kind='hold_notice' AND status='pending'", recordId(data.noticeId), dispatchId, w);
    if (!notice) fail(409, NO_NOTICE);
    const label = await labelOf(db, dispatchId);
    try {
      await db.batch([
        query(db, "UPDATE dispatches SET status='on_hold',hold_reason=?,updated_at=? WHERE id=? AND workspace_id=?", why, now, dispatchId, w),
        query(db, "UPDATE dispatch_requests SET status='held',term=?,reason=?,decided_by=?,decided_at=?,updated_at=? WHERE dispatch_id=? AND workspace_id=? AND kind='approval' AND status='pending'",
          notice.term, why, member.user_id, now, now, dispatchId, w),
        query(db, "UPDATE dispatch_requests SET status='acknowledged',decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?", member.user_id, now, now, notice.id, w),
        notifyUser(db, w, row.created_by, 'dispatch.held', 'dispatch', dispatchId, label),
        audit(db, member, 'dispatch.held', dispatchId, { notice: notice.id, term: notice.term }, 'staff', { objectType: 'dispatch', reason: why, intervention }),
      ]);
    } catch (error) {
      const raced = await dispatchOf(db, dispatchId, w);
      if (raced?.status === 'on_hold') return json({ dispatch: raced });
      fail(409, 'The dispatch cannot be held right now. Refresh and try again.');
    }
    return json({ dispatch: await dispatchOf(db, dispatchId, w) }, 200);
  }

  if (path === base + '/dispatched' && request.method === 'POST') {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['dispatchId', 'vehicle', 'transporter', 'interventionReason']);
    const dispatchId = recordId(data.dispatchId);
    const row = await dispatchOf(db, dispatchId, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    if (row.status === 'dispatched' || row.status === 'delivered') return json({ dispatch: row });
    if (row.status !== 'approved') fail(409, APPROVED_ONLY);
    if (await one(db, "SELECT 1 AS n FROM dispatch_requests WHERE dispatch_id=? AND kind='hold_notice' AND status='pending'", dispatchId)) fail(409, HOLD_PENDING);
    const available = await balanceOf(db, row.lot_id, 'finished');
    if (available < row.grams) fail(409, SHORT_STOCK);
    const vehicle = data.vehicle === undefined ? row.vehicle : text(data.vehicle, 'Vehicle', 0, 100);
    const transporter = data.transporter === undefined ? row.transporter : text(data.transporter, 'Transporter', 0, 100);
    const order = await one(db, 'SELECT o.id,o.reference FROM sales_orders o WHERE o.id=? AND o.workspace_id=?', row.sales_order_id, w);
    if (!order) fail(404, 'This dispatch was not found in your workspace.');
    const movementId = crypto.randomUUID(), salesId = crypto.randomUUID();
    // The ledger entry and the sale dispatch are one write. The sale-dispatch trigger validates the
    // pre-decrement balance, the file immutability does the rest, and every failure reads as short stock.
    const [movement, delta] = movementQueries(db, member, { id: movementId, lotId: row.lot_id, action: 'dispatch', stage: 'finished',
      deltaGrams: -row.grams, cartons: row.cartons, cones: row.cones, note: `Dispatch ${order.reference}`, sourceId: `dispatch:${dispatchId}` }, now);
    try {
      await db.batch([
        guard(db, `EXISTS(SELECT 1 FROM dispatches d JOIN sales_orders o ON o.id=d.sales_order_id JOIN sales_order_lines l ON l.sales_order_id=o.id
          JOIN lots lt ON lt.id=d.lot_id WHERE d.id=? AND d.workspace_id=? AND d.status='approved' AND lt.quality='approved'
          AND NOT EXISTS(SELECT 1 FROM dispatch_requests hr WHERE hr.dispatch_id=d.id AND hr.kind='hold_notice' AND hr.status='pending')
          AND o.status IN ('confirmed','partially_dispatched') AND l.unit='kg' AND (l.product_id IS NULL OR l.product_id=lt.product_id)
          AND EXISTS(SELECT 1 FROM balances fb WHERE fb.lot_id=d.lot_id AND fb.stage='finished' AND fb.grams>=d.grams AND fb.cartons>=d.cartons AND fb.cones>=d.cones)
          AND l.quantity_milli>=d.quantity_milli+(SELECT COALESCE(SUM(sd.quantity_milli),0) FROM sales_dispatches sd WHERE sd.sales_order_id=o.id
            AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=sd.movement_id)))`, dispatchId, w),
        movement,
        query(db, `INSERT INTO sales_dispatches(id,workspace_id,sales_order_id,movement_id,lot_id,from_stage,quantity_milli,unit,grams,cartons,cones,carrier,packages_json,documents_note,dispatched_at,request_hash,created_by,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, salesId, w, row.sales_order_id, movementId, row.lot_id, 'finished', row.quantity_milli, 'kg', row.grams, row.cartons, row.cones,
          transporter || 'Factory transport', '[]', '', now, `dispatch:${dispatchId}`, member.user_id, now),
        delta,
        query(db, `UPDATE sales_orders SET status=CASE WHEN COALESCE((SELECT SUM(d.quantity_milli) FROM sales_dispatches d
          WHERE d.sales_order_id=sales_orders.id AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=d.movement_id)),0)
          >=(SELECT l.quantity_milli FROM sales_order_lines l WHERE l.sales_order_id=sales_orders.id)
          THEN 'dispatched' ELSE 'partially_dispatched' END WHERE id=?`, row.sales_order_id),
        query(db, "UPDATE dispatches SET status='dispatched',sales_dispatch_id=?,dispatched_at=?,vehicle=?,transporter=?,updated_at=? WHERE id=? AND workspace_id=?",
          salesId, now, vehicle, transporter, now, dispatchId, w),
        audit(db, member, 'dispatch.dispatched', dispatchId, { order: order.reference, lot: row.lot_id, grams: row.grams, movement: movementId, salesDispatch: salesId }, 'staff', { objectType: 'dispatch', intervention }),
      ]);
    } catch {
      const raced = await dispatchOf(db, dispatchId, w);
      if (raced?.status === 'dispatched') return json({ dispatch: raced });
      if (raced?.status !== 'approved') fail(409, APPROVED_ONLY);
      if (await one(db, "SELECT 1 AS n FROM dispatch_requests WHERE dispatch_id=? AND kind='hold_notice' AND status='pending'", dispatchId)) fail(409, HOLD_PENDING);
      fail(409, SHORT_STOCK);
    }
    return json({ dispatch: await dispatchOf(db, dispatchId, w) }, 201);
  }

  // Undo a dispatch before delivery: a compensating movement puts the grams back in the same lot's finished stock, the order is recounted, and the dispatch returns to approved.
  if (path === base + '/dispatched/reverse' && request.method === 'POST') {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['id', 'dispatchId', 'reason', 'interventionReason']);
    const id = recordId(data.id), dispatchId = recordId(data.dispatchId), why = multiline(data.reason, 'Reason', 3, 500);
    const hash = `reverse:dispatch:${dispatchId}:${why}`;
    const previous = await one(db, 'SELECT id,request_hash FROM movements WHERE id=? AND workspace_id=?', id, w);
    if (previous) {
      if (previous.request_hash !== hash) fail(409, REUSED);
      return json({ dispatch: await dispatchOf(db, dispatchId, w), reversalId: id });
    }
    const row = await dispatchOf(db, dispatchId, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    if (row.status === 'delivered') fail(409, 'A delivered dispatch cannot be undone.');
    if (row.status !== 'dispatched' || !row.sales_dispatch_id) fail(409, 'Only a dispatched batch can be undone.');
    const sale = await one(db, 'SELECT * FROM sales_dispatches WHERE id=? AND workspace_id=?', row.sales_dispatch_id, w);
    if (!sale) fail(404, 'The sale dispatch for this batch was not found.');
    if (await one(db, 'SELECT id FROM movements WHERE reverses=?', sale.movement_id)) fail(409, 'This dispatch was already undone.');
    const order = await one(db, 'SELECT reference FROM sales_orders WHERE id=? AND workspace_id=?', row.sales_order_id, w);
    const liveTotal = `COALESCE((SELECT SUM(d.quantity_milli) FROM sales_dispatches d WHERE d.sales_order_id=sales_orders.id AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=d.movement_id)),0)`;
    try {
      await db.batch([
        guard(db, "EXISTS(SELECT 1 FROM dispatches WHERE id=? AND workspace_id=? AND status='dispatched' AND sales_dispatch_id=?)", dispatchId, w, sale.id),
        ...reversalQueries(db, member, { id, lotId: row.lot_id, reverses: sale.movement_id, toStage: 'finished', grams: sale.grams, cartons: sale.cartons, cones: sale.cones,
          note: `Undo dispatch ${order.reference}: ${why}`, requestHash: hash, deltas: [{ stage: 'finished', grams: sale.grams, cartons: sale.cartons, cones: sale.cones }] }, now),
        query(db, 'INSERT INTO dispatch_reversals(id,workspace_id,dispatch_id,sales_dispatch_id,movement_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)', id, w, dispatchId, sale.id, id, why, member.user_id, now),
        query(db, `UPDATE sales_orders SET status=CASE WHEN ${liveTotal}=0 THEN 'confirmed'
          WHEN ${liveTotal}>=(SELECT l.quantity_milli FROM sales_order_lines l WHERE l.sales_order_id=sales_orders.id) THEN 'dispatched' ELSE 'partially_dispatched' END WHERE id=?`, row.sales_order_id),
        query(db, "UPDATE dispatches SET status='approved',sales_dispatch_id=NULL,dispatched_at=NULL,updated_at=? WHERE id=? AND workspace_id=?", now, dispatchId, w),
        audit(db, member, 'dispatch.undone', dispatchId, { order: order.reference, lot: row.lot_id, grams: sale.grams, reverses: sale.movement_id, salesDispatch: sale.id }, 'staff', { objectType: 'dispatch', reason: why, intervention }),
      ]);
    } catch {
      const raced = await dispatchOf(db, dispatchId, w);
      if (raced?.status !== 'dispatched') fail(409, 'This dispatch changed while it was being undone. Refresh and try again.');
      fail(409, 'The dispatch could not be undone. Refresh and try again.');
    }
    return json({ dispatch: await dispatchOf(db, dispatchId, w), reversalId: id }, 201);
  }

  if (path === base + '/delivered' && request.method === 'POST') {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['dispatchId', 'deliveryProof', 'interventionReason']);
    const dispatchId = recordId(data.dispatchId);
    const proof = data.deliveryProof === undefined ? '' : text(data.deliveryProof, 'Delivery proof', 0, 500);
    const row = await dispatchOf(db, dispatchId, w);
    if (!row) fail(404, 'This dispatch was not found in your workspace.');
    if (row.status === 'delivered') return json({ dispatch: row });
    if (row.status !== 'dispatched') fail(409, 'Only a dispatched delivery can be confirmed.');
    try {
      await db.batch([
        query(db, "UPDATE dispatches SET status='delivered',delivery_proof=?,delivered_at=?,updated_at=? WHERE id=? AND workspace_id=?", proof, now, now, dispatchId, w),
        audit(db, member, 'dispatch.delivered', dispatchId, { delivered: row.sales_dispatch_id }, 'staff', { objectType: 'dispatch', intervention }),
      ]);
    } catch { fail(409, 'The dispatch changed while confirming delivery. Refresh and try again.'); }
    return json({ dispatch: await dispatchOf(db, dispatchId, w) }, 200);
  }

  if (path === base + '/stock-issues' && request.method === 'POST') {
    const intervention = role(member, data, 'dispatch');
    keys(data, ['id', 'dispatchId', 'lotId', 'stage', 'kind', 'differenceGrams', 'description', 'interventionReason']);
    const id = recordId(data.id), lotId = recordId(data.lotId);
    const dispatchId = data.dispatchId === undefined ? null : recordId(data.dispatchId);
    if (!['raw', 'finished'].includes(data.stage)) fail(422, 'Choose raw or finished stock.');
    if (!['shortage', 'mismatch'].includes(data.kind)) fail(422, 'Choose shortage or mismatch.');
    const differenceGrams = integer(data.differenceGrams, 'Difference in grams', 0, MAX_GRAMS);
    const description = multiline(data.description, 'Description', 5, 2000);
    const terms = { dispatch_id: dispatchId, lot_id: lotId, stage: data.stage, kind: data.kind, difference_grams: differenceGrams, description, created_by: member.user_id };
    const previous = await one(db, 'SELECT * FROM stock_issues WHERE id=? AND workspace_id=?', id, w);
    if (previous) return sameAs(previous, terms) ? json({ issue: previous }) : fail(409, REUSED);
    const lot = await one(db, 'SELECT id FROM lots WHERE id=? AND workspace_id=?', lotId, w);
    if (!lot) fail(404, 'This lot was not found in your workspace.');
    if (dispatchId) {
      const linked = await dispatchOf(db, dispatchId, w);
      if (!linked) fail(404, 'This dispatch was not found in your workspace.');
      if (linked.lot_id !== lotId) fail(422, 'The stock issue lot must be the dispatch lot.');
    }
    const lotLabel = await one(db, 'SELECT l.batch,p.name FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?', lotId);
    try {
      await db.batch([
        query(db, `INSERT INTO stock_issues(id,workspace_id,dispatch_id,lot_id,stage,kind,difference_grams,description,status,created_by,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'open',?,?,?)`, id, w, dispatchId, lotId, data.stage, data.kind, differenceGrams, description, member.user_id, now, now),
        notifyRole(db, w, 'supervisor', 'stock_issue.raised', 'stock_issue', id, `${lotLabel.name} · ${lotLabel.batch}`),
        audit(db, member, 'stock_issue.raised', id, { lot: lotId, dispatch: dispatchId, kind: data.kind, differenceGrams }, 'staff', { objectType: 'stock_issue', intervention }),
      ]);
    } catch {
      const raced = await one(db, 'SELECT * FROM stock_issues WHERE id=? AND workspace_id=?', id, w);
      if (raced) return sameAs(raced, terms) ? json({ issue: raced }) : fail(409, REUSED);
      fail(409, 'The issue could not be raised. Refresh and try again.');
    }
    return json({ issue: await one(db, 'SELECT * FROM stock_issues WHERE id=?', id) }, 201);
  }

  if (path === base + '/stock-issues/decide' && request.method === 'POST') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'decision', 'reason', 'correctionGrams', 'interventionReason']);
    const id = recordId(data.id);
    if (!['accept', 'reject'].includes(data.decision)) fail(422, 'Choose accept or reject.');
    const issue = await one(db, 'SELECT * FROM stock_issues WHERE id=? AND workspace_id=?', id, w);
    if (!issue) fail(404, 'Stock issue not found.');
    if (issue.status !== 'open') fail(409, 'This issue was already decided. Reload.');
    const why = reasonOf(data.reason, 'Reason');
    let correction = 0;
    if (data.decision === 'accept' && data.correctionGrams !== undefined) {
      correction = integer(data.correctionGrams, 'Correction in grams', -MAX_GRAMS, MAX_GRAMS);
      if (correction === 0) fail(422, 'A correction cannot be zero grams. Accept it without changing stock instead.');
    }
    if (correction < 0 && (await balanceOf(db, issue.lot_id, issue.stage)) + correction < 0) fail(409, NEGATIVE);
    if (data.decision === 'reject') {
      try {
        await db.batch([
          query(db, "UPDATE stock_issues SET status='rejected',decision_reason=?,decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?", why, member.user_id, now, now, id, w),
          audit(db, member, 'stock_issue.rejected', id, { lot: issue.lot_id, description: issue.description }, 'staff', { objectType: 'stock_issue', reason: why, intervention }),
        ]);
      } catch {
        fail(409, (await one(db, 'SELECT status FROM stock_issues WHERE id=?', id))?.status !== 'open' ? 'This issue was already decided. Reload.' : 'The issue changed while deciding. Refresh and try again.');
      }
      return json({ issue: await one(db, 'SELECT * FROM stock_issues WHERE id=?', id) }, 200);
    }
    const dispatchGate = await needsApproval(db, w, 'dispatch_stock_issue', issue.difference_grams, member.user_id);
    const inventoryGate = correction ? await needsApproval(db, w, 'inventory_adjustment', Math.abs(correction), member.user_id) : { required: false, threshold: null };
    const gate = dispatchGate.required ? dispatchGate : inventoryGate, amount = dispatchGate.required ? issue.difference_grams : Math.abs(correction);
    const payload = {
      correctionGrams: correction || null, correctionReason: correction ? why : null, intervention, lotId: issue.lot_id, stage: issue.stage,
      gates: {
        dispatch: { amount: issue.difference_grams, threshold: dispatchGate.threshold, required: dispatchGate.required },
        inventory: correction ? { amount: Math.abs(correction), threshold: inventoryGate.threshold, required: inventoryGate.required } : null,
      },
    };
    if (dispatchGate.required || inventoryGate.required) {
      const adjustmentId = correction ? crypto.randomUUID() : null;
      try {
        await db.batch([
          ...(adjustmentId ? [query(db, `INSERT INTO inventory_adjustments(id,workspace_id,lot_id,stage,kind,delta_grams,reason,status,source,compensates_id,created_by,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,'pending_approval','stock_issue',NULL,?,?,?)`, adjustmentId, w, issue.lot_id, issue.stage, correction < 0 ? 'write_off' : 'adjustment', correction, why, member.user_id, now, now)] : []),
          query(db, "UPDATE stock_issues SET status='pending_approval',correction_grams=?,adjustment_id=?,updated_at=? WHERE id=? AND workspace_id=?", correction || null, adjustmentId, now, id, w),
          ...approvalQueries(db, member, { type: 'dispatch_stock_issue', objectType: 'stock_issue', objectId: id, amount, threshold: gate.threshold, unit: 'grams', payload: { ...payload, adjustmentId } }, now),
          audit(db, member, 'stock_issue.accepted', id, { gates: payload.gates, pendingApproval: true }, 'staff', { objectType: 'stock_issue', reason: why, intervention }),
        ]);
      } catch {
        fail(409, (await one(db, 'SELECT status FROM stock_issues WHERE id=?', id))?.status !== 'open' ? 'This issue was already decided. Reload.' : 'The correction could not be parked for approval. Refresh and try again.');
      }
      return json({ issue: await one(db, 'SELECT * FROM stock_issues WHERE id=?', id), pendingApproval: true, approvalId: (await one(db, 'SELECT id FROM approval_requests WHERE object_type=? AND object_id=? ORDER BY created_at DESC LIMIT 1', 'stock_issue', id))?.id }, 202);
    }
    // No gate applies: the accepted correction applies to the stock immediately.
    const adjustmentId = correction ? crypto.randomUUID() : null;
    try {
      await db.batch([
        ...(adjustmentId ? adjustmentQueries(db, member, { id: adjustmentId, lotId: issue.lot_id, stage: issue.stage,
          deltaGrams: correction, reason: why, source: 'stock_issue' }, now) : []),
        query(db, "UPDATE stock_issues SET status='accepted',decision_reason=?,correction_grams=?,adjustment_id=?,decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?",
          why, correction || null, adjustmentId, member.user_id, now, now, id, w),
      ]);
    } catch {
      fail(409, (await one(db, 'SELECT status FROM stock_issues WHERE id=?', id))?.status !== 'open' ? 'This issue was already decided. Reload.' : 'The stock changed while deciding this issue. Refresh and try again.');
    }
    return json({ issue: await one(db, 'SELECT * FROM stock_issues WHERE id=?', id) }, 200);
  }

  fail(404, 'Dispatch route not found.');
}

/** The admin engine resolves gated corrections: one approval satisfies both gates in one batch. */
export const approvalHandlers = {
  dispatch_stock_issue: {
    async approve(db, member, request, { reason, now }) {
      const issue = await one(db, 'SELECT * FROM stock_issues WHERE id=? AND workspace_id=?', request.object_id, request.workspace_id);
      if (!issue || issue.status !== 'pending_approval') throw new Error('issue changed');
      const { correctionGrams, correctionReason } = request.payload, statements = [];
      // The administration applies the correction through the same builder the supervisor uses.
      if (correctionGrams) statements.push(...adjustmentQueries(db, member, { id: issue.adjustment_id, lotId: issue.lot_id, stage: issue.stage,
        deltaGrams: correctionGrams, reason: correctionReason, source: 'stock_issue', intervention: request.payload.intervention ?? null }, now));
      statements.push(query(db, "UPDATE stock_issues SET status='accepted',decision_reason=?,decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?",
        reason ?? request.payload.correctionReason ?? 'Approved by admin', member.user_id, now, now, issue.id, issue.workspace_id));
      return statements;
    },
    async reject(db, member, request, { reason, now }) {
      const issue = await one(db, 'SELECT * FROM stock_issues WHERE id=? AND workspace_id=?', request.object_id, request.workspace_id);
      if (!issue || issue.status !== 'pending_approval') throw new Error('issue changed');
      return [query(db, "UPDATE stock_issues SET status='rejected',decision_reason=?,decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?",
        reason, member.user_id, now, now, issue.id, request.workspace_id),
        ...(issue.adjustment_id ? [query(db, "UPDATE inventory_adjustments SET status='rejected',decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=? AND status='pending_approval'",
          member.user_id, now, now, issue.adjustment_id, request.workspace_id)] : [])];
    },
    async describe(db, request) {
      const issue = await one(db, 'SELECT * FROM stock_issues WHERE id=? AND workspace_id=?', request.object_id, request.workspace_id);
      if (!issue || issue.status !== 'pending_approval') throw new Error('issue changed');
      const lot = await one(db, 'SELECT l.batch,p.name FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?', issue.lot_id);
      const current = await balanceOf(db, issue.lot_id, issue.stage), gates = request.payload.gates, correction = request.payload.correctionGrams ?? 0;
      return { objectType: 'stock_issue', objectId: issue.id, label: `${lot.name} · ${lot.batch}`, currency: null,
        evidence: { lot: lot.batch, product: lot.name, stage: issue.stage, kind: issue.kind, differenceGrams: issue.difference_grams, description: issue.description,
          dispatchId: issue.dispatch_id, currentGrams: current, correctionGrams: correction || null, correctionReason: request.payload.correctionReason, gates },
        proposed: { deltaGrams: correction, balanceGrams: current + correction } };
    },
  },
};
