/** Read-only analytics for admin, sales and purchasing. Every money SUM carries the source record's immutable currency;
 * counts may combine, money never does. The period arguments follow server/stock.mjs's validation. */
import { all, one, fail, json, integer, viewer } from './erp-utils.mjs';
import { supplierPerformance } from './procurement.mjs';

const period = params => {
  const from = Number(params.get('from')), to = Number(params.get('to'));
  integer(from, 'From', 0, 8_640_000_000_000_000); integer(to, 'To', 0, 8_640_000_000_000_000);
  if (to < from) fail(422, 'The period must end after it starts.');
  return [from, to];
};

// Net invoiced money is the immutable total minus its credit notes; payments do not reduce revenue.
const NET = 'total_minor - credited_minor';
// The RFCQ status the lists show; a changed factory currency never rewrites the frozen terms a PO quotes in.
const RFQ_STATUS = "CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN status='open' AND deadline_at<=? THEN 'closed' ELSE status END";
// Final dispositions of settled lots only (server/procurement.mjs supplierPerformance): accepted reports and deviation
// acceptances count as accepted, confirmed rejections as rejected; returned or re-inspect quantities stay out entirely.
const QC_DISPOSITION = `COALESCE(SUM(CASE WHEN i.report_status='accepted' THEN i.accepted_milli END),0)
  +COALESCE(SUM(CASE WHEN i.rejection_status='dismissed' AND i.dismiss_outcome='accept_with_deviation' THEN i.rejected_milli END),0)`;
const REJECTED_MILLI = "COALESCE(SUM(CASE WHEN i.rejection_status='confirmed' THEN i.rejected_milli END),0)";
// Periods are Asia/Karachi calendar months (UTC+5, +18000000 ms) wherever a call-range row is placed.
const KARACHI_MONTH = "strftime('%Y-%m', (issued_at + 18000000) / 1000, 'unixepoch')";
// Installments follow sales.mjs paymentStatus() branch order: paid money wins, then a past-due balance, then partial.
const OVERDUE = 'due_at IS NOT NULL AND ? > due_at';
const OWED = 'total_minor - credited_minor - paid_minor > 0';
const PAID = 'total_minor - credited_minor - paid_minor <= 0';
const DISPATCH_STATUSES = ['pending_approval', 'approved', 'on_hold', 'dispatched', 'delivered'];

/** The sales funnel the sales manager and the admin both read. */
export async function salesBlock(db, workspaceId, [from, to], now) {
  const byPeriod = await all(db, `SELECT ${KARACHI_MONTH} AS period, currency, SUM(${NET}) AS totalMinor FROM invoice_balances
    WHERE workspace_id=? AND issued_at BETWEEN ? AND ? GROUP BY period, currency ORDER BY period, currency`, workspaceId, from, to);
  const byBuyer = await all(db, `SELECT b.name AS buyer, v.currency, SUM(${NET}) AS totalMinor FROM invoice_balances v
    JOIN buyers b ON b.id=v.buyer_id WHERE v.workspace_id=? AND v.issued_at BETWEEN ? AND ? GROUP BY v.buyer_id, v.currency ORDER BY b.name, v.currency`, workspaceId, from, to);
  // One row per distinct invoice-product pair: repeated lines of one product count the invoice once; a multi-product invoice attributes the same net under each named product.
  const byProductRows = await all(db, `SELECT p.name AS product, v.currency, SUM(${NET}) AS totalMinor FROM (SELECT DISTINCT sales_order_id, product_id FROM sales_order_lines) l
    JOIN sales_orders o ON o.id=l.sales_order_id JOIN invoice_balances v ON v.sales_order_id=o.id LEFT JOIN products p ON p.id=l.product_id
    WHERE v.workspace_id=? AND v.issued_at BETWEEN ? AND ? GROUP BY p.name, v.currency ORDER BY p.name IS NULL, p.name, v.currency`, workspaceId, from, to);
  const settled = await one(db, `SELECT COALESCE(SUM(${PAID}),0) AS paid, COALESCE(SUM(${OWED} AND ${OVERDUE}),0) AS overdue,
    COALESCE(SUM(${OWED} AND NOT (${OVERDUE}) AND paid_minor>0),0) AS partial, COUNT(*) AS total
    FROM invoice_balances WHERE workspace_id=? AND issued_at BETWEEN ? AND ?`, now, now, workspaceId, from, to);
  const paymentStatus = { unpaid: settled.total - settled.paid - settled.overdue - settled.partial, partially_paid: settled.partial, paid: settled.paid, overdue: settled.overdue };
  return { byPeriod, byBuyer, byProduct: byProductRows.map(row => ({ ...row, product: row.product ?? null })), paymentStatus, overdueByCurrency: await owedPastDue(db, workspaceId, [from, to], now) };
}

/** A past-due balance exists only while money is still owed; every currency that owes gets its own row. */
async function owedPastDue(db, workspaceId, [from, to], now) {
  return all(db, `SELECT currency, SUM(${NET} - paid_minor) AS overdueMinor FROM invoice_balances
    WHERE workspace_id=? AND issued_at BETWEEN ? AND ? AND ${OWED} AND ${OVERDUE} GROUP BY currency`, workspaceId, from, to, now);
}

/** Outstanding money per currency, with the overdue share of the same currency merged in (zero when none is past due). */
async function paymentsBlock(db, workspaceId, range, now) {
  const outstanding = await all(db, `SELECT currency, SUM(${NET} - paid_minor) AS outstandingMinor FROM invoice_balances
    WHERE workspace_id=? AND issued_at BETWEEN ? AND ? AND ${OWED} GROUP BY currency ORDER BY currency`, workspaceId, ...range);
  const overdue = new Map((await owedPastDue(db, workspaceId, range, now)).map(row => [row.currency, row.overdueMinor]));
  return { byCurrency: outstanding.map(row => ({ currency: row.currency, outstandingMinor: row.outstandingMinor, overdueMinor: overdue.get(row.currency) ?? 0 })) };
}

const rfqStatusCounts = async (db, workspaceId, [from, to], now) => {
  const counts = { draft: 0, open: 0, closed: 0, awarded: 0, cancelled: 0 };
  for (const row of await all(db, `SELECT ${RFQ_STATUS} AS status, COUNT(*) AS n FROM procurement_rfqs
    WHERE workspace_id=? AND created_at BETWEEN ? AND ? GROUP BY status`, now, workspaceId, from, to)) counts[row.status] = row.n;
  return counts;
};

const qualityBlock = async (db, workspaceId, [from, to]) => {
  const decide = await one(db, `SELECT ${QC_DISPOSITION} AS accepted, ${REJECTED_MILLI} AS rejected
    FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id
    WHERE i.workspace_id=? AND l.status='settled' AND i.status='submitted' AND i.decided_at BETWEEN ? AND ?`, workspaceId, from, to);
  const inspected = decide.accepted + decide.rejected;
  const claims = { return: 0, replacement: 0, claim: 0 };
  for (const row of await all(db, "SELECT outcome, COUNT(*) AS n FROM claims WHERE workspace_id=? AND status='decided' AND decided_at BETWEEN ? AND ? GROUP BY outcome", workspaceId, from, to)) claims[row.outcome] = row.n;
  return { inspectedMilli: inspected, acceptedMilli: decide.accepted, rejectedMilli: decide.rejected, passRate: inspected ? decide.accepted / inspected : null, claims,
    // The decided money is the frozen PO amount unless the decision adjusted it with a reason.
    totalsByCurrency: await all(db, `SELECT json_extract(p.terms_snapshot,'$.currency') AS currency, SUM(COALESCE(c.adjusted_minor, c.calculated_minor)) AS claimMinor
      FROM claims c JOIN supplier_purchase_orders p ON p.id=c.purchase_order_id WHERE c.workspace_id=? AND c.status='decided' AND c.decided_at BETWEEN ? AND ? GROUP BY currency ORDER BY currency`, workspaceId, from, to) };
};

/** Warehouse depths read current state, not the period; legacy cops/WIP balances stay visible beside raw and finished. */
const inventoryBlock = async (db, workspaceId, [from, to]) => {
  const stages = await all(db, 'SELECT b.stage, SUM(b.grams) AS grams FROM balances b JOIN lots l ON l.id=b.lot_id WHERE l.workspace_id=? GROUP BY b.stage', workspaceId);
  const applied = await one(db, `SELECT COUNT(*) AS adjustments, COALESCE(SUM(delta_grams),0) AS adjusted FROM inventory_adjustments
    WHERE workspace_id=? AND status='applied' AND created_at BETWEEN ? AND ?`, workspaceId, from, to);
  return { rawGrams: stages.find(row => row.stage === 'raw')?.grams ?? 0, copsGrams: stages.find(row => row.stage === 'cops')?.grams ?? 0,
    wipGrams: stages.find(row => row.stage === 'wip')?.grams ?? 0, finishedGrams: stages.find(row => row.stage === 'finished')?.grams ?? 0,
    adjustments: applied.adjustments, adjustedGrams: applied.adjusted };
};

const dispatchBlock = async (db, workspaceId, range) => {
  const counts = Object.fromEntries(DISPATCH_STATUSES.map(status => [status, 0]));
  for (const row of await all(db, 'SELECT status, COUNT(*) AS n FROM dispatches WHERE workspace_id=? AND created_at BETWEEN ? AND ? GROUP BY status', workspaceId, ...range)) {
    counts[row.status] = row.n;
  }
  return counts;
};

export async function analyticsApi(request, env, member, path) {
  if (request.method !== 'GET') fail(405, 'Method not allowed.');
  const db = env.DB, workspaceId = member.workspace_id, range = period(new URL(request.url).searchParams), now = Date.now();
  if (path === '/api/erp/analytics/sales') { viewer(member, 'sales_manager'); return json(await salesBlock(db, workspaceId, range, now)); }
  if (path === '/api/erp/analytics/purchase') {
    viewer(member, 'purchase_manager');
    const statusCounts = await rfqStatusCounts(db, workspaceId, range, now);
    // Draft and cancelled RFQs never took bids in earnest, so they stay out of the bid average.
    const bids = (await one(db, "SELECT COUNT(*) AS n FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE r.workspace_id=? AND r.created_at BETWEEN ? AND ? AND r.status!='draft' AND r.cancelled_at IS NULL", workspaceId, ...range)).n;
    const suppliers = (await all(db, `SELECT id, name FROM suppliers WHERE workspace_id=?
      AND status IN ('pending','approved','rejected','suspended') ORDER BY name COLLATE NOCASE LIMIT 500`, workspaceId));
    const rfqs = Object.values(statusCounts).reduce((sum, count) => sum + count, 0) - statusCounts.draft - statusCounts.cancelled;
    return json({ suppliers: await Promise.all(suppliers.map(async supplier => ({ ...supplier, ...await supplierPerformance(db, supplier.id) }))),
      bidding: { rfqs, bids,
        averageBidsPerRfq: rfqs ? Math.round(bids / rfqs * 100) / 100 : null,
        awarded: statusCounts.awarded, cancelled: statusCounts.cancelled } });
  }
  if (path === '/api/erp/analytics/admin') {
    viewer(member);
    const statusCounts = await rfqStatusCounts(db, workspaceId, range, now);
    return json({
      purchasing: { rfqs: statusCounts, awards: statusCounts.awarded,
        // PO money groups by the frozen terms currency, never the currently configured factory currency.
        totalsByCurrency: await all(db, `SELECT json_extract(terms_snapshot,'$.currency') AS currency, SUM(total_minor) AS poTotalMinor
          FROM supplier_purchase_orders WHERE workspace_id=? AND status!='cancelled' AND created_at BETWEEN ? AND ? GROUP BY currency ORDER BY currency`, workspaceId, ...range) },
      quality: await qualityBlock(db, workspaceId, range),
      inventory: await inventoryBlock(db, workspaceId, range),
      sales: await salesBlock(db, workspaceId, range, now),
      payments: await paymentsBlock(db, workspaceId, range, now),
      dispatch: await dispatchBlock(db, workspaceId, range),
      users: await all(db, `SELECT u.name, u.portal_role AS role, (SELECT COUNT(*) FROM erp_audit_events e WHERE e.actor_id=u.id
        AND e.actor_type='staff' AND e.created_at BETWEEN ? AND ?) AS actions FROM users u WHERE u.workspace_id=? AND u.portal_role IS NOT NULL AND u.removed_at IS NULL
        ORDER BY actions DESC, u.name`, ...range, workspaceId),
    });
  }
  fail(404, 'Analytics route not found.');
}
