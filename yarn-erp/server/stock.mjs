/** The supervisor owns inventory: finished-goods entry, threshold-gated adjustments, stock queries from sales and the report to admin. Every ledger entry is built by stock-ledger.mjs. */
import { all, audit, fail, integer, json, keys, multiline, one, query, reason as reasonOf, recordId, role, text, viewer } from './erp-utils.mjs';
import { approvalQueries, needsApproval, thresholdOf } from './governance.mjs';
import { notifyRole } from './notify.mjs';
import { movementQueries } from './stock-ledger.mjs';

const MAX_GRAMS = 9_000_000_000_000, NEGATIVE = 'This would make stock negative.';
const LEGACY = 'Legacy cops/WIP stock is read-only; an authorized migration is required.';
const REUSED = 'This request ID was already used for different values.';
const NOT_ENOUGH_RAW = 'There is not enough raw stock for this quantity.';
const NOT_ENOUGH_WIP = 'Not enough work-in-progress stock in this batch.';
const FLAGGABLE = ['inspection', 'adjustment'];
const balanceOf = async (db, lotId, stage) => (await one(db, 'SELECT grams FROM balances WHERE lot_id=? AND stage=?', lotId, stage))?.grams ?? 0;
const adjustmentOf = (db, id, workspaceId) => one(db, 'SELECT * FROM inventory_adjustments WHERE id=? AND workspace_id=?', id, workspaceId);

/**
 * The movement and delta of an adjustment (waste when negative, receive when positive), the adjustment made applied, and its audit row.
 * A pending adjustment is decided by the same upsert, so the one statement list serves both the immediate and the approved path.
 */
export function adjustmentQueries(db, member, { id, lotId, stage, kind = undefined, deltaGrams, reason, source = 'supervisor', compensatesId = null, intervention = null, createdBy = member.user_id, createdAt }, now) {
  const movementId = crypto.randomUUID();
  return [...movementQueries(db, member, { id: movementId, lotId, action: deltaGrams < 0 ? 'waste' : 'receive', stage, deltaGrams, note: reason, sourceId: id }, now),
    query(db, `INSERT INTO inventory_adjustments(id,workspace_id,lot_id,stage,kind,delta_grams,reason,status,source,compensates_id,movement_id,created_by,created_at,updated_at,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,'applied',?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status='applied',movement_id=excluded.movement_id,decided_by=excluded.decided_by,decided_at=excluded.decided_at,updated_at=excluded.updated_at`,
      id, member.workspace_id, lotId, stage, kind ?? (deltaGrams < 0 ? 'write_off' : 'adjustment'), deltaGrams, reason, source, compensatesId, movementId, createdBy, createdAt ?? now, now, member.user_id, now),
    notifyRole(db, member.workspace_id, 'supervisor', 'stock.adjusted', 'inventory_adjustment', id, `${deltaGrams > 0 ? '+' : ''}${deltaGrams} g · ${stage}`, member.user_id),
    notifyRole(db, member.workspace_id, 'admin', 'stock.adjusted', 'inventory_adjustment', id, `${deltaGrams > 0 ? '+' : ''}${deltaGrams} g · ${stage}`, member.user_id),
    audit(db, member, 'inventory.adjusted', id, { lot: lotId, stage, deltaGrams, movement: movementId, ...(compensatesId ? { compensates: compensatesId } : {}) }, 'staff', { objectType: 'inventory', reason, intervention })];
}

export const approvalHandlers = {
  inventory_adjustment: {
    async approve(db, member, request, { now }) {
      const a = await adjustmentOf(db, request.object_id, request.workspace_id);
      if (a?.status !== 'pending_approval') throw new Error('adjustment changed');
      return adjustmentQueries(db, member, { id: a.id, lotId: a.lot_id, stage: a.stage, kind: a.kind, deltaGrams: a.delta_grams, reason: a.reason, source: a.source, compensatesId: a.compensates_id, intervention: request.payload.intervention ?? null, createdBy: a.created_by, createdAt: a.created_at }, now);
    },
    async reject(db, member, request, { now }) {
      return [query(db, "UPDATE inventory_adjustments SET status='rejected',decided_by=?,decided_at=?,updated_at=? WHERE id=? AND workspace_id=?", member.user_id, now, now, request.object_id, request.workspace_id)];
    },
    async describe(db, request) {
      const a = await adjustmentOf(db, request.object_id, request.workspace_id);
      if (!a) throw new Error('adjustment missing');
      const lot = await one(db, 'SELECT l.batch,p.name FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?', a.lot_id), current = await balanceOf(db, a.lot_id, a.stage);
      return { objectType: 'inventory_adjustment', objectId: a.id, label: `${lot.name} · ${lot.batch}`, currency: request.currency,
        evidence: { lot: lot.batch, product: lot.name, stage: a.stage, kind: a.kind, status: a.status, currentGrams: current, reason: a.reason, thresholdGrams: request.threshold, compensatesId: a.compensates_id },
        proposed: { deltaGrams: a.delta_grams, balanceGrams: current + a.delta_grams } };
    },
  },
};

const sameAs = (row, expected) => Object.entries(expected).every(([k, v]) => row[k] === v);
const adjustmentReply = async (db, a) => {
  if (a.status !== 'pending_approval') return json({ adjustment: a }, a.status === 'applied' ? 200 : 409);
  const request = await one(db, "SELECT id FROM approval_requests WHERE object_type='inventory_adjustment' AND object_id=? ORDER BY created_at DESC LIMIT 1", a.id);
  return json({ pendingApproval: true, approvalId: request.id, adjustment: a }, 202);
};

async function draftOf(db, w, from, to) {
  const rejections = async status => {
    const list = await all(db, `SELECT i.id,i.lot_id,l.reference AS lot_reference,m.name AS product_name,l.unit,i.rejected_milli,i.rejection_status,i.rejection_reason,i.decided_at
      FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id JOIN products m ON m.id=l.product_id WHERE i.workspace_id=? AND i.rejection_status=? AND i.decided_at BETWEEN ? AND ? ORDER BY i.decided_at,i.id`, w, status, from, to);
    for (const item of list) {
      item.issues = await all(db, 'SELECT id,type,severity,description,status FROM qc_issues WHERE inspection_id=? ORDER BY created_at,id', item.id);
      item.photos = (await all(db, 'SELECT id FROM qc_photos WHERE inspection_id=? OR issue_id IN (SELECT id FROM qc_issues WHERE inspection_id=?) ORDER BY created_at,id', item.id, item.id)).map(p => p.id);
    }
    return list;
  };
  return { confirmedRejections: await rejections('confirmed'), escalations: await rejections('escalated'),
    adjustments: await all(db, `SELECT a.id,a.lot_id,l.batch,m.name AS product_name,a.stage,a.kind,a.delta_grams,a.reason,a.status,a.compensates_id,u.name AS created_by_name,a.created_at
      FROM inventory_adjustments a JOIN lots l ON l.id=a.lot_id JOIN products m ON m.id=l.product_id JOIN users u ON u.id=a.created_by WHERE a.workspace_id=? AND a.created_at BETWEEN ? AND ? ORDER BY a.created_at,a.id`, w, from, to) };
}
const period = params => {
  const from = Number(params.get('from')), to = Number(params.get('to'));
  integer(from, 'From', 0, 8_640_000_000_000_000); integer(to, 'To', 0, 8_640_000_000_000_000);
  if (to < from) fail(422, 'The period must end after it starts.');
  return [from, to];
};
const reportRow = row => ({ id: row.id, period_from: row.period_from, period_to: row.period_to, content: JSON.parse(row.content_json), flagged: JSON.parse(row.flagged_json), note: row.note, status: row.status, created_by: row.created_by, created_by_name: row.created_by_name, created_at: row.created_at });

export async function stockApi(request, env, member, path, data) {
  const db = env.DB, w = member.workspace_id, now = Date.now(), base = '/api/erp/stock';
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    if (path === base) {
      viewer(member, 'supervisor');
      const lots = await all(db, `SELECT l.id,l.product_id,l.batch,p.name AS product_name,l.inventory_type,l.source,l.quality,
        COALESCE(SUM(CASE WHEN b.stage='raw' THEN b.grams END),0) AS raw_grams, COALESCE(SUM(CASE WHEN b.stage='cops' THEN b.grams END),0) AS cops_grams,
        COALESCE(SUM(CASE WHEN b.stage='wip' THEN b.grams END),0) AS wip_grams, COALESCE(SUM(CASE WHEN b.stage='finished' THEN b.grams END),0) AS finished_grams
        FROM lots l JOIN products p ON p.id=l.product_id LEFT JOIN balances b ON b.lot_id=l.id WHERE l.workspace_id=? GROUP BY l.id ORDER BY l.created_at DESC,l.id LIMIT 500`, w);
      return json({ lots: lots.map(lot => ({ ...lot, legacyReadOnly: lot.cops_grams > 0 || lot.wip_grams > 0 })), adjustmentThreshold: { value: await thresholdOf(db, w, 'inventory_adjustment'), unit: 'grams' } });
    }
    if (path === base + '/queries') {
      viewer(member, 'supervisor', 'sales_manager');
      const everyone = member.role !== 'sales_manager';
      return json({ queries: await all(db, `SELECT q.*,p.name AS product_name,u.name AS asked_by_name FROM stock_queries q JOIN products p ON p.id=q.product_id JOIN users u ON u.id=q.created_by
        WHERE q.workspace_id=? AND (?=1 OR q.created_by=?) ORDER BY q.created_at DESC,q.id LIMIT 200`, w, everyone ? 1 : 0, member.user_id) });
    }
    if (path === base + '/attention') {
      viewer(member, 'supervisor');
      return json({
        reports: await all(db, `SELECT i.id AS inspectionId,l.reference AS lotReference,s.name AS supplierName,i.accepted_milli AS acceptedMilli,l.unit,i.submitted_at AS submittedAt
          FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id JOIN suppliers s ON s.id=l.supplier_id
          WHERE i.workspace_id=? AND i.report_status='pending' ORDER BY i.submitted_at,i.id LIMIT 100`, w),
        readyForProduction: await all(db, `SELECT l.id AS lotId,l.batch,m.name AS productName,b.grams AS rawGrams,
          (SELECT MAX(v.created_at) FROM movements v WHERE v.lot_id=l.id AND v.action='receive' AND v.to_stage='raw') AS approvedAt
          FROM lots l JOIN products m ON m.id=l.product_id JOIN balances b ON b.lot_id=l.id AND b.stage='raw'
          WHERE l.workspace_id=? AND l.quality='approved' AND b.grams>0
            AND NOT EXISTS(SELECT 1 FROM balances x WHERE x.lot_id=l.id AND x.stage!='raw' AND x.grams>0) ORDER BY approvedAt DESC,l.id LIMIT 50`, w) });
    }
    if (path === base + '/reports/draft') { viewer(member, 'supervisor'); return json(await draftOf(db, w, ...period(params))); }
    if (path === base + '/reports') {
      viewer(member, 'supervisor');
      return json({ reports: (await all(db, `SELECT r.*,u.name AS created_by_name FROM supervisor_reports r JOIN users u ON u.id=r.created_by WHERE r.workspace_id=? AND (?=1 OR r.created_by=?) ORDER BY r.created_at DESC,r.id LIMIT 100`, w, member.role === 'admin' ? 1 : 0, member.user_id)).map(reportRow) });
    }
    if (path === base + '/history') {
      viewer(member, 'supervisor');
      return json({ history: await all(db, 'SELECT id,actor_id,action,record_id,object_type,reason,intervention_reason,detail_json,created_at FROM erp_audit_events WHERE workspace_id=? AND actor_id=? ORDER BY created_at DESC,id DESC LIMIT 200', w, member.user_id) });
    }
    fail(404, 'Stock route not found.');
  }

  if (path === base + '/finished') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'productId', 'batch', 'grams', 'cartons', 'cones', 'note', 'interventionReason']);
    const id = recordId(data.id), productId = recordId(data.productId), batch = text(data.batch, 'Batch', 1, 100), grams = integer(data.grams, 'Weight in grams', 1, MAX_GRAMS);
    const cartons = integer(data.cartons ?? 0, 'Cartons', 0, 1_000_000_000), cones = integer(data.cones ?? 0, 'Cones', 0, 1_000_000_000), note = text(data.note ?? '', 'Note', 0, 1000);
    const sourceId = `finished:${JSON.stringify([productId, batch, grams, cartons, cones, note])}`;
    const replay = async () => {
      const previous = await one(db, 'SELECT id,lot_id,request_hash FROM movements WHERE id=? AND workspace_id=?', id, w);
      if (!previous) return null;
      if (previous.request_hash !== `source:${sourceId}`) fail(409, REUSED);
      return json({ lotId: previous.lot_id, movementId: id });
    };
    const done = await replay(); if (done) return done;
    if (!await one(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', productId, w)) fail(404, 'Material not found.');
    const lot = await one(db, 'SELECT id,source FROM lots WHERE workspace_id=? AND product_id=? AND batch=?', w, productId, batch);
    if (lot && lot.source !== 'production') fail(409, 'Another stock lot already uses this batch number.');
    const lotId = lot?.id ?? crypto.randomUUID();
    try {
      await db.batch([
        query(db, "INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at,inventory_type,source) VALUES(?,?,?,?,'','approved',?,'finished','production') ON CONFLICT DO NOTHING", lotId, w, productId, batch, now),
        query(db, "SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM lots WHERE id=? AND workspace_id=? AND product_id=? AND batch=? AND source='production')", lotId, w, productId, batch),
        ...movementQueries(db, member, { id, lotId, action: 'receive', stage: 'finished', deltaGrams: grams, cartons, cones, note, sourceId }, now),
        notifyRole(db, w, 'supervisor', 'stock.received', 'inventory', id, batch, member.user_id),
        notifyRole(db, w, 'admin', 'stock.received', 'inventory', id, batch, member.user_id),
        audit(db, member, 'inventory.received', id, { lot: lotId, batch, grams, cartons, cones }, 'staff', { objectType: 'inventory', intervention })]);
    } catch { return await replay() ?? fail(409, 'Another stock lot already uses this batch number, or the stock changed. Refresh and try again.'); }
    return json({ lotId, movementId: id }, 201);
  }

  if (path === base + '/production') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'lotId', 'grams', 'note', 'interventionReason']);
    const id = recordId(data.id), lotId = recordId(data.lotId), grams = integer(data.grams, 'Weight in grams', 1, MAX_GRAMS), note = text(data.note ?? '', 'Note', 0, 1000);
    const hash = `source:production:${JSON.stringify([lotId, grams, note])}`;
    const replay = async () => {
      const previous = await one(db, 'SELECT id,lot_id,request_hash FROM movements WHERE id=? AND workspace_id=?', id, w);
      if (!previous) return null;
      if (previous.request_hash !== hash) fail(409, REUSED);
      return json({ lotId: previous.lot_id, movementId: id });
    };
    const done = await replay(); if (done) return done;
    const lot = await one(db, 'SELECT id,batch,quality FROM lots WHERE id=? AND workspace_id=?', lotId, w);
    if (!lot) fail(404, 'This lot was not found in your workspace.');
    if (lot.quality !== 'approved') fail(409, 'Only QC-approved stock can go to production.');
    if (await balanceOf(db, lotId, 'raw') < grams) fail(409, NOT_ENOUGH_RAW);
    const label = `${lot.batch} · ${Number((grams / 1000).toFixed(3))} kg`;
    try {
      // A transfer is one movement with two deltas; the guard and the balance CHECK keep raw stock from going negative in a race.
      await db.batch([
        query(db, "SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM balances WHERE lot_id=? AND stage='raw' AND grams>=?)", lotId, grams),
        query(db, "INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'transfer','raw','wip',?,0,0,?,?,?,NULL,?,?)",
          id, w, lotId, grams, note, member.user_id, member.name ?? member.role, hash, now),
        query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,0,0)', crypto.randomUUID(), id, lotId, 'raw', -grams),
        query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,0,0)', crypto.randomUUID(), id, lotId, 'wip', grams),
        notifyRole(db, w, 'supervisor', 'stock.to_production', 'lot', lotId, label, member.user_id),
        notifyRole(db, w, 'admin', 'stock.to_production', 'lot', lotId, label),
        audit(db, member, 'stock.to_production', id, { lot: lotId, grams, from: 'raw', to: 'wip', note }, 'staff', { objectType: 'inventory', intervention })]);
    } catch (error) {
      const again = await replay(); if (again) return again;
      fail(409, /CHECK constraint|malformed JSON/i.test(String(error)) ? NOT_ENOUGH_RAW : 'Stock changed. Refresh and try again.');
    }
    return json({ lotId, movementId: id }, 201);
  }

  if (path === base + '/finish') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'lotId', 'grams', 'note', 'interventionReason']);
    const id = recordId(data.id), lotId = recordId(data.lotId), grams = integer(data.grams, 'Weight in grams', 1, MAX_GRAMS), note = text(data.note ?? '', 'Note', 0, 1000);
    const hash = `source:finish:${JSON.stringify([lotId, grams, note])}`;
    const replay = async () => {
      const previous = await one(db, 'SELECT id,lot_id,request_hash FROM movements WHERE id=? AND workspace_id=?', id, w);
      if (!previous) return null;
      if (previous.request_hash !== hash) fail(409, REUSED);
      return json({ lotId: previous.lot_id, movementId: id });
    };
    const done = await replay(); if (done) return done;
    const lot = await one(db, 'SELECT id,batch,quality FROM lots WHERE id=? AND workspace_id=?', lotId, w);
    if (!lot) fail(404, 'This lot was not found in your workspace.');
    if (lot.quality !== 'approved') fail(409, 'Only QC-approved stock can be finished.');
    if (await balanceOf(db, lotId, 'wip') < grams) fail(409, NOT_ENOUGH_WIP);
    const label = `${lot.batch} · ${Number((grams / 1000).toFixed(3))} kg`;
    try {
      // A transfer is one movement with two deltas; the guard and the balance CHECK keep work-in-progress stock from going negative in a race.
      await db.batch([
        query(db, "SELECT json('!') WHERE NOT EXISTS(SELECT 1 FROM balances WHERE lot_id=? AND stage='wip' AND grams>=?)", lotId, grams),
        query(db, "INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'transfer','wip','finished',?,0,0,?,?,?,NULL,?,?)",
          id, w, lotId, grams, note, member.user_id, member.name ?? member.role, hash, now),
        query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,0,0)', crypto.randomUUID(), id, lotId, 'wip', -grams),
        query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,0,0)', crypto.randomUUID(), id, lotId, 'finished', grams),
        notifyRole(db, w, 'supervisor', 'stock.finished', 'lot', lotId, label, member.user_id),
        notifyRole(db, w, 'admin', 'stock.finished', 'lot', lotId, label),
        audit(db, member, 'stock.finished', id, { lot: lotId, grams, from: 'wip', to: 'finished', note }, 'staff', { objectType: 'inventory', intervention })]);
    } catch (error) {
      const again = await replay(); if (again) return again;
      fail(409, /CHECK constraint|malformed JSON/i.test(String(error)) ? NOT_ENOUGH_WIP : 'Stock changed. Refresh and try again.');
    }
    return json({ lotId, movementId: id }, 201);
  }

  if (path === base + '/adjustments') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'lotId', 'stage', 'kind', 'deltaGrams', 'reason', 'compensatesId', 'interventionReason']);
    const id = recordId(data.id), lotId = recordId(data.lotId);
    if (['cops', 'wip'].includes(data.stage)) fail(422, LEGACY);
    if (!['raw', 'finished'].includes(data.stage)) fail(422, 'Choose raw or finished stock.');
    if (!['adjustment', 'write_off'].includes(data.kind)) fail(422, 'Choose adjustment or write_off.');
    const deltaGrams = integer(data.deltaGrams, 'Change in grams', -MAX_GRAMS, MAX_GRAMS);
    if (deltaGrams === 0) fail(422, 'Change in grams cannot be zero.');
    if (data.kind === 'write_off' && deltaGrams > 0) fail(422, 'A write-off removes stock.');
    const why = reasonOf(data.reason, 'Reason'), compensatesId = data.compensatesId === undefined ? null : recordId(data.compensatesId);
    const terms = { lot_id: lotId, stage: data.stage, kind: data.kind, delta_grams: deltaGrams, reason: why, compensates_id: compensatesId, created_by: member.user_id };
    const previous = await adjustmentOf(db, id, w);
    if (previous) return sameAs(previous, terms) ? adjustmentReply(db, previous) : fail(409, REUSED);
    const lot = await one(db, 'SELECT inventory_type FROM lots WHERE id=? AND workspace_id=?', lotId, w);
    if (!lot) fail(404, 'This lot was not found in your workspace.');
    if (lot.inventory_type && lot.inventory_type !== data.stage) fail(422, `This lot holds ${lot.inventory_type} stock.`);
    if (compensatesId && !await adjustmentOf(db, compensatesId, w)) fail(404, 'The adjustment to compensate was not found.');
    if (deltaGrams < 0 && await balanceOf(db, lotId, data.stage) + deltaGrams < 0) fail(409, NEGATIVE);
    const approval = await needsApproval(db, w, 'inventory_adjustment', Math.abs(deltaGrams), member.user_id), approvalId = crypto.randomUUID();
    const statements = approval.required
      ? [query(db, "INSERT INTO inventory_adjustments(id,workspace_id,lot_id,stage,kind,delta_grams,reason,status,source,compensates_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending_approval','supervisor',?,?,?,?)", id, w, lotId, data.stage, data.kind, deltaGrams, why, compensatesId, member.user_id, now, now),
        ...approvalQueries(db, member, { id: approvalId, type: 'inventory_adjustment', objectType: 'inventory_adjustment', objectId: id, amount: Math.abs(deltaGrams), threshold: approval.threshold, unit: 'grams', payload: { adjustmentId: id, intervention } }, now),
        audit(db, member, 'inventory.adjustment_requested', id, { lot: lotId, stage: data.stage, deltaGrams, approval: approvalId, ...(compensatesId ? { compensates: compensatesId } : {}) }, 'staff', { objectType: 'inventory', reason: why, intervention })]
      : adjustmentQueries(db, member, { id, lotId, stage: data.stage, kind: data.kind, deltaGrams, reason: why, compensatesId, intervention }, now);
    try { await db.batch(statements); } catch (error) {
      const raced = await adjustmentOf(db, id, w);
      if (raced) return sameAs(raced, terms) ? adjustmentReply(db, raced) : fail(409, REUSED);
      fail(409, /CHECK constraint/i.test(String(error)) ? NEGATIVE : 'Stock changed. Refresh and try again.');
    }
    const saved = await adjustmentOf(db, id, w);
    return approval.required ? json({ pendingApproval: true, approvalId, adjustment: saved }, 202) : json({ adjustment: saved }, 201);
  }

  if (path === base + '/queries') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'productId', 'quantityMilli', 'buyerRfqId', 'question', 'interventionReason']);
    const id = recordId(data.id), productId = recordId(data.productId), question = multiline(data.question, 'Question', 5, 1000);
    const quantityMilli = data.quantityMilli === undefined ? null : integer(data.quantityMilli, 'Quantity', 1, 1_000_000_000_000), buyerRfqId = data.buyerRfqId === undefined ? null : recordId(data.buyerRfqId);
    const terms = { product_id: productId, quantity_milli: quantityMilli, buyer_rfq_id: buyerRfqId, question, created_by: member.user_id };
    const previous = await one(db, 'SELECT * FROM stock_queries WHERE id=? AND workspace_id=?', id, w);
    if (previous) return sameAs(previous, terms) ? json({ query: previous }) : fail(409, REUSED);
    const product = await one(db, 'SELECT name FROM products WHERE id=? AND workspace_id=?', productId, w);
    if (!product) fail(404, 'Material not found.');
    if (buyerRfqId && !await one(db, 'SELECT id FROM buyer_purchase_orders WHERE id=? AND workspace_id=?', buyerRfqId, w)) fail(404, 'Buyer request not found.');
    try {
      await db.batch([query(db, "INSERT INTO stock_queries(id,workspace_id,product_id,quantity_milli,buyer_rfq_id,question,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?,?)", id, w, productId, quantityMilli, buyerRfqId, question, member.user_id, now, now),
        notifyRole(db, w, 'supervisor', 'stock_query.created', 'stock_query', id, product.name),
        audit(db, member, 'stock_query.created', id, { product: productId, quantityMilli }, 'staff', { objectType: 'stock_query', intervention })]);
    } catch {
      const raced = await one(db, 'SELECT * FROM stock_queries WHERE id=? AND workspace_id=?', id, w);
      if (raced && sameAs(raced, terms)) return json({ query: raced });
      fail(409, 'This query could not be saved. Refresh and try again.');
    }
    return json({ query: await one(db, 'SELECT * FROM stock_queries WHERE id=?', id) }, 201);
  }

  if (path === base + '/queries/answer') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'availableGrams', 'answer', 'interventionReason']);
    const id = recordId(data.id), availableGrams = integer(data.availableGrams, 'Available grams', 0, MAX_GRAMS), answer = data.answer === undefined ? null : multiline(data.answer, 'Answer', 1, 1000);
    const asked = await one(db, 'SELECT * FROM stock_queries WHERE id=? AND workspace_id=?', id, w);
    if (!asked) fail(404, 'Stock query not found.');
    if (asked.status !== 'open') fail(409, 'This query was already answered.');
    try {
      // No status filter: the trigger aborts the whole batch when another supervisor answered first.
      await db.batch([query(db, "UPDATE stock_queries SET status='answered',available_grams=?,answer=?,answered_by=?,answered_at=?,updated_at=? WHERE id=? AND workspace_id=?", availableGrams, answer, member.user_id, now, now, id, w),
        audit(db, member, 'stock_query.answered', id, { product: asked.product_id, availableGrams }, 'staff', { objectType: 'stock_query', before: { status: 'open' }, after: { status: 'answered', availableGrams }, intervention })]);
    } catch { fail(409, 'This query was already answered.'); }
    return json({ query: await one(db, 'SELECT * FROM stock_queries WHERE id=?', id) });
  }

  if (path === base + '/reports') {
    const intervention = role(member, data, 'supervisor');
    keys(data, ['id', 'from', 'to', 'flagged', 'note', 'interventionReason']);
    const id = recordId(data.id), [from, to] = period(new URLSearchParams({ from: String(data.from), to: String(data.to) })), note = data.note === undefined ? '' : text(data.note, 'Note', 0, 1000);
    if (!Array.isArray(data.flagged) || data.flagged.length > 50) fail(422, 'Flag at most 50 items.');
    const content = await draftOf(db, w, from, to);
    const known = { inspection: new Set([...content.confirmedRejections, ...content.escalations].map(i => i.id)), adjustment: new Set(content.adjustments.map(a => a.id)) };
    const flagged = data.flagged.map(item => {
      keys(item, ['objectType', 'objectId', 'note']);
      if (!FLAGGABLE.includes(item.objectType) || !known[item.objectType].has(item.objectId)) fail(422, 'Flag only inspections and adjustments listed in this report.');
      return { objectType: item.objectType, objectId: item.objectId, note: text(item.note, 'Flag note', 3, 500) };
    });
    const flaggedJson = JSON.stringify(flagged), previous = await one(db, 'SELECT * FROM supervisor_reports WHERE id=? AND workspace_id=?', id, w);
    const same = row => sameAs(row, { period_from: from, period_to: to, flagged_json: flaggedJson, note, created_by: member.user_id });
    if (previous) return same(previous) ? json({ report: reportRow(previous) }) : fail(409, REUSED);
    try {
      await db.batch([query(db, 'INSERT INTO supervisor_reports(id,workspace_id,period_from,period_to,content_json,flagged_json,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, w, from, to, JSON.stringify(content), flaggedJson, note, member.user_id, now, now),
        audit(db, member, 'stock_report.submitted', id, { from, to, rejections: content.confirmedRejections.length, escalations: content.escalations.length, adjustments: content.adjustments.length, flagged: flagged.length }, 'staff', { objectType: 'stock_report', intervention })]);
    } catch {
      const raced = await one(db, 'SELECT * FROM supervisor_reports WHERE id=? AND workspace_id=?', id, w);
      if (raced && same(raced)) return json({ report: reportRow(raced) });
      fail(409, 'This report could not be saved. Refresh and try again.');
    }
    return json({ report: reportRow(await one(db, 'SELECT r.*,u.name AS created_by_name FROM supervisor_reports r JOIN users u ON u.id=r.created_by WHERE r.id=?', id)) }, 201);
  }
  fail(404, 'Stock route not found.');
}
