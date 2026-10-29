/** Yarnflow production API: admin-owned machines/shifts setup, buyer-linked batches against the
 * frozen sales_order_lines contract, capacity-safe machine allocations, reservations, actual runs
 * that consume and produce stock through the extended immutable ledger ('consume'/'produce'),
 * fabric rolls with real QC, packing and a guarded batch lifecycle.
 *
 * Honesty rules enforced here:
 * - Consumed stock is recorded as 'consume' movements — never as waste or a customer dispatch.
 * - Output is added once to one stage ('produce') as a new uninspected lot; WIP is never
 *   duplicated onto finished stock, so one event never shows the stock at two stages.
 * - Grams, metres and pieces stay separate measured quantities: no kg↔metre conversion exists
 *   anywhere, and a machine whose capacity unit differs from the batch unit is refused.
 * - A completed batch needs actual output, inspected rolls and packing; a planned machine
 *   allocation alone can never advance actual production.
 * - Run close reconciles mass: consumed = output + recorded loss; outputs above consumed are refused. */
import { all, one, query, json, fail, text, multiline, integer, date, keys, recordId, allow, audit } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';

const OPERATIONS = ['spinning', 'weaving', 'winding', 'dyeing', 'finishing'];
const STAGES = ['raw', 'wip', 'finished', 'cops'];
const UNITS = ['kg', 'metre', 'piece'];
const OVERVIEW_ROLES = ['production', 'produce', 'sales', 'qc', 'receive'];
const uuid = () => crypto.randomUUID();
const digest = async value => sha256(JSON.stringify(value));
const quantity = (milli, unit) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(milli / 1000)} ${unit}`;
const operationList = value => {
  if (!Array.isArray(value) || !value.length || value.length > OPERATIONS.length || value.some(op => !OPERATIONS.includes(op))) fail(422, `Choose one or more operations: ${OPERATIONS.join(', ')}.`);
  return [...new Set(value)];
};
const machineOperation = (value, label = 'Operation') => {
  if (!OPERATIONS.includes(value)) fail(422, `Choose a valid ${label.toLowerCase()}: ${OPERATIONS.join(', ')}.`);
  return value;
};
const unitOf = value => { if (!UNITS.includes(value)) fail(422, 'Choose a unit: kg, metre or piece.'); return value; };
const stageOf = value => { if (!STAGES.includes(value)) fail(422, 'Choose a valid stock stage.'); return value; };
const dayList = value => {
  if (!Array.isArray(value) || !value.length || value.length > 7 || value.some(day => !Number.isSafeInteger(day) || day < 1 || day > 7)) fail(422, 'Choose the shift days (1 is Monday, 7 is Sunday).');
  return [...new Set(value)].sort();
};
const allowAny = (member, list, what) => {
  if (!member.admin && !list.some(permission => member.permissions.includes(permission))) fail(403, `Your account does not have permission to ${what}. Ask an admin.`);
};

/** SQL fragment + args proving one lot keeps enough approved, unreserved grams at one stage.
 * Reservation counts only against other batches: a batch may freely consume into its own
 * reservation, and over-issuing is still stopped by the balances CHECK (grams >= 0). */
const availableSql = excludeBatch => `SELECT 1 FROM balances b JOIN lots l ON l.id=b.lot_id
    WHERE l.id=? AND l.workspace_id=? AND l.quality='approved' AND b.stage=?
    AND b.grams>=? + COALESCE((SELECT SUM(r.grams) FROM stock_reservations r
      WHERE r.lot_id=b.lot_id AND r.stage=b.stage AND r.status='active'${excludeBatch ? ' AND r.batch_id<>?' : ''}),0)`;
const availableArgs = (w, lotId, stage, grams, excludeBatch = null) =>
  excludeBatch ? [lotId, w, stage, grams, excludeBatch] : [lotId, w, stage, grams];

/** Human message for a rejected ledger write, so entries explain quarantine honestly. */
const ledgerProblem = error => {
  const message = String(error);
  if (/QC approval required/i.test(message)) return 'QC approval is required before consuming that stock. Uninspected (quarantined) lots cannot be issued to a run.';
  if (/held lot cannot move/i.test(message)) return 'A QC-held lot cannot be consumed. Resolve the quality hold first.';
  if (/consume must record/i.test(message)) return 'The issue did not record the stage the stock leaves.';
  if (/CHECK constraint failed/i.test(message)) return 'Not enough stock is left on that stage (grams, cartons or cones would go negative). Refresh the batch, then issue with the remaining amounts.';
  return null;
};

const shiftEnd = (start, end) => end <= start ? end + 1440 : end;
const shiftsCollide = (a, b) => JSON.parse(a.days).some(day => JSON.parse(b.days).includes(day))
  && a.start_minute < shiftEnd(b.start_minute, b.end_minute) && b.start_minute < shiftEnd(a.start_minute, a.end_minute);

const machineView = async (db, id) => {
  const machine = await one(db, 'SELECT id,workspace_id,name,kind,operations,active,created_at,updated_at FROM machines WHERE id=?', id);
  if (!machine) fail(404, 'Machine not found.');
  return {
    ...machine, operations: JSON.parse(machine.operations),
    capacities: await all(db, 'SELECT id,machine_id,version,unit,rate_milli_per_hour,note,created_at FROM machine_capacities WHERE machine_id=? ORDER BY version', id),
    downtime: await all(db, "SELECT id,from_at,to_at,reason,status,cancel_reason,created_at FROM machine_downtimes WHERE machine_id=? AND status='planned' ORDER BY from_at", id),
  };
};
const batchFor = async (db, w, id) => {
  const batch = await one(db, `SELECT b.*,p.name AS product_name,p.sku AS product_sku,
      l.quantity_milli AS line_quantity_milli,l.unit AS line_unit,l.product_id AS line_product_id,
      o.reference AS order_reference,o.status AS order_status
    FROM production_batches b JOIN products p ON p.id=b.product_id
    JOIN sales_order_lines l ON l.id=b.sales_order_line_id JOIN sales_orders o ON o.id=l.sales_order_id
    WHERE b.id=? AND b.workspace_id=?`, id, w);
  if (!batch) fail(404, 'This production batch was not found in your workspace.');
  return batch;
};
const runFor = async (db, w, id) => {
  const run = await one(db, `SELECT r.*,b.status AS batch_status,b.reference AS batch_reference,b.unit AS batch_unit,
      b.operation AS batch_operation,b.product_id AS batch_product_id
    FROM production_runs r JOIN production_batches b ON b.id=r.batch_id WHERE r.id=? AND r.workspace_id=?`, id, w);
  if (!run) fail(404, 'This production run was not found in your workspace.');
  return run;
};
const rollFor = async (db, w, id) => {
  const roll = await one(db, `SELECT f.*,b.status AS batch_status FROM fabric_rolls f JOIN production_batches b ON b.id=f.batch_id WHERE f.id=? AND f.workspace_id=?`, id, w);
  if (!roll) fail(404, 'This fabric roll was not found in your workspace.');
  return roll;
};
const runTotals = async (db, batchId) => {
  const [consumed, outputs] = await Promise.all([
    one(db, 'SELECT COALESCE(SUM(i.grams),0) AS grams FROM production_inputs i JOIN production_runs r ON r.id=i.run_id WHERE r.batch_id=?', batchId),
    one(db, 'SELECT COALESCE(SUM(o.grams),0) AS grams FROM production_outputs o JOIN production_runs r ON r.id=o.run_id WHERE r.batch_id=?', batchId),
  ]);
  return { consumed_grams: consumed.grams, output_grams: outputs.grams, loss_grams: consumed.grams - outputs.grams };
};
/** Enters actual production only when the batch really is on the floor (or a deliberate rework). */
const runWritable = run => {
  if (run.rework) return ['in_production', 'packing', 'completed'].includes(run.batch_status);
  if (run.batch_status === 'hold') fail(409, 'This batch is on hold. Resume it before recording production.');
  return run.batch_status === 'in_production';
};

async function setupRoutes(db, w, member, path, data, now) {
  if (path === '/api/erp/production/machines' && data) {
    keys(data, ['id', 'name', 'kind', 'operations', 'unit', 'ratePerHourMilli', 'note']);
    const id = recordId(data.id), name = text(data.name, 'Machine name', 2, 80);
    const kind = machineOperation(data.kind, 'Machine kind');
    const operations = JSON.stringify(operationList(data.operations));
    const unit = unitOf(data.unit);
    const rate = integer(data.ratePerHourMilli, 'Capacity per hour in thousandths of the unit', 1, 4_000_000_000);
    const note = multiline(data.note ?? '', 'Capacity note', 0, 500);
    const previous = await one(db, 'SELECT * FROM machines WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.name !== name || previous.kind !== kind || previous.operations !== operations)
        fail(409, 'This machine ID was already used for different setup values.');
      return json({ machine: await machineView(db, id) });
    }
    try {
      await db.batch([
        query(db, 'INSERT INTO machines(id,workspace_id,name,kind,operations,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)',
          id, w, name, kind, operations, member.user_id, now, now),
        query(db, 'INSERT INTO machine_capacities(id,machine_id,version,unit,rate_milli_per_hour,note,created_by,created_at) VALUES(?,?,1,?,?,?,?,?)',
          uuid(), id, unit, rate, note, member.user_id, now),
        audit(db, member, 'production.machine.created', id, { name, kind, operations: JSON.parse(operations), unit, rate }, 'staff'),
      ]);
    } catch { fail(409, 'That machine name already exists in your workspace.'); }
    return json({ machine: await machineView(db, id) }, 201);
  }
  if (path === '/api/erp/production/machines/update' && data) {
    keys(data, ['id', 'operations', 'active']);
    const machine = await one(db, 'SELECT * FROM machines WHERE id=? AND workspace_id=?', recordId(data.id), w);
    if (!machine) fail(404, 'Machine not found.');
    const operations = JSON.stringify(operationList(data.operations ?? JSON.parse(machine.operations)));
    const active = data.active ? 1 : 0;
    if (machine.operations === operations && machine.active === active) return json({ machine: await machineView(db, machine.id) });
    try {
      await db.batch([
        query(db, 'UPDATE machines SET operations=?,active=?,updated_at=? WHERE id=?', operations, active, now, machine.id),
        audit(db, member, 'production.machine.updated', machine.id, { operations: JSON.parse(operations), active }, 'staff'),
      ]);
    } catch { fail(409, 'Machine setup changed. Reload and retry.'); }
    return json({ machine: await machineView(db, machine.id) });
  }
  if (path === '/api/erp/production/machines/capacity' && data) {
    keys(data, ['machineId', 'unit', 'ratePerHourMilli', 'note']);
    const machine = await one(db, 'SELECT * FROM machines WHERE id=? AND workspace_id=?', recordId(data.machineId), w);
    if (!machine) fail(404, 'Machine not found.');
    const unit = unitOf(data.unit);
    const rate = integer(data.ratePerHourMilli, 'Capacity per hour in thousandths of the unit', 1, 4_000_000_000);
    const note = multiline(data.note ?? '', 'Capacity note', 0, 500);
    const latest = await one(db, 'SELECT version FROM machine_capacities WHERE machine_id=? ORDER BY version DESC LIMIT 1', machine.id);
    const version = (latest?.version ?? 0) + 1;
    const capacityId = uuid();
    await db.batch([
      query(db, 'INSERT INTO machine_capacities(id,machine_id,version,unit,rate_milli_per_hour,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
        capacityId, machine.id, version, unit, rate, note, member.user_id, now),
      query(db, 'UPDATE machines SET updated_at=? WHERE id=?', now, machine.id),
      audit(db, member, 'production.machine.capacity', machine.id, { capacity: capacityId, version, unit, rate }, 'staff'),
    ]);
    return json({ machine: await machineView(db, machine.id) }, 201);
  }
  if (path === '/api/erp/production/machines/downtime' && data) {
    keys(data, ['id', 'machineId', 'fromAt', 'toAt', 'reason']);
    const machine = await one(db, 'SELECT id,name FROM machines WHERE id=? AND workspace_id=?', recordId(data.machineId), w);
    if (!machine) fail(404, 'Machine not found.');
    const id = recordId(data.id), from = date(data.fromAt, 'Downtime start'), to = date(data.toAt, 'Downtime end');
    if (to <= from) fail(422, 'Planned maintenance must end after it starts.');
    const reason = multiline(data.reason, 'Downtime reason', 3, 500);
    const previous = await one(db, 'SELECT * FROM machine_downtimes WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.machine_id !== machine.id || previous.from_at !== from || previous.to_at !== to || previous.reason !== reason || previous.status !== 'planned')
        fail(409, 'This downtime ID was already used for different values.');
      return json({ downtime: previous });
    }
    const result = await db.batch([
      query(db, `INSERT INTO machine_downtimes(id,workspace_id,machine_id,from_at,to_at,reason,status,created_by,created_at)
          SELECT ?,?,?,?,?,?,'planned',?,? WHERE NOT EXISTS (SELECT 1 FROM machine_downtimes d
            WHERE d.machine_id=? AND d.status='planned' AND d.from_at<? AND d.to_at>?)`,
        id, w, machine.id, from, to, reason, member.user_id, now, machine.id, to, from),
      audit(db, member, 'production.machine.downtime', id, { machine: machine.id, from, to, reason }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, `Another planned maintenance window overlaps this one for ${machine.name}.`);
    return json({ downtime: await one(db, 'SELECT * FROM machine_downtimes WHERE id=?', id) }, 201);
  }
  if (path === '/api/erp/production/machines/downtime/cancel' && data) {
    keys(data, ['id', 'reason']);
    const id = recordId(data.id), reason = multiline(data.reason, 'Cancellation reason', 3, 500);
    if (!(await one(db, `SELECT d.id FROM machine_downtimes d JOIN machines m ON m.id=d.machine_id
        WHERE d.id=? AND m.workspace_id=? AND d.status='planned'`, id, w)))
      fail(404, 'Planned maintenance not found or already cancelled.');
    try {
      await db.batch([
        query(db, "UPDATE machine_downtimes SET status='cancelled',cancel_reason=? WHERE id=? AND status='planned'", reason, id),
        audit(db, member, 'production.machine.downtime.cancelled', id, { reason }, 'staff'),
      ]);
    } catch { fail(409, 'Maintenance changed. Reload and retry.'); }
    return json({ cancelled: true });
  }
  if (path === '/api/erp/production/shifts' && data) {
    keys(data, ['id', 'name', 'startMinute', 'endMinute', 'days']);
    const id = recordId(data.id), name = text(data.name, 'Shift name', 2, 60);
    const start = integer(data.startMinute, 'Shift start minute of day', 0, 1439);
    const end = integer(data.endMinute, 'Shift end minute of day', 1, 1440);
    if (end <= start) fail(422, 'A shift must end after midnight only when it starts on or before midnight: set end after start.');
    const days = dayList(data.days);
    const previous = await one(db, 'SELECT * FROM shifts WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.name !== name || previous.start_minute !== start || previous.end_minute !== end || previous.days !== JSON.stringify(days))
        fail(409, 'This shift ID was already used for different values.');
      return json({ shift: previous });
    }
    const draft = { start_minute: start, end_minute: end, days: JSON.stringify(days) };
    const conflict = (await all(db, 'SELECT * FROM shifts WHERE workspace_id=? AND active=1', w)).find(other => shiftsCollide(other, draft));
    if (conflict) fail(409, `Active shift "${conflict.name}" already covers part of this window on a shared day. Change one of the shifts.`);
    try {
      await db.batch([
        query(db, 'INSERT INTO shifts(id,workspace_id,name,start_minute,end_minute,days,active,created_by,created_at) VALUES(?,?,?,?,?,?,1,?,?)',
          id, w, name, start, end, draft.days, member.user_id, now),
        audit(db, member, 'production.shift.created', id, { name, start, end, days }, 'staff'),
      ]);
    } catch { fail(409, 'That shift name already exists in your workspace.'); }
    return json({ shift: await one(db, 'SELECT id,name,start_minute,end_minute,days,active,created_at FROM shifts WHERE id=?', id) }, 201);
  }
  if (path === '/api/erp/production/shifts/update' && data) {
    keys(data, ['id', 'active']);
    const shift = await one(db, 'SELECT * FROM shifts WHERE id=? AND workspace_id=?', recordId(data.id), w);
    if (!shift) fail(404, 'Shift not found.');
    const active = data.active ? 1 : 0;
    if (shift.active === active) return json({ shift });
    if (active) {
      const conflict = (await all(db, 'SELECT * FROM shifts WHERE workspace_id=? AND active=1 AND id!=?', w, shift.id))
        .find(other => shiftsCollide(other, shift));
      if (conflict) fail(409, `Reactivating this shift would overlap "${conflict.name}". Change one of the shifts first.`);
    }
    try {
      await db.batch([
        query(db, 'UPDATE shifts SET active=? WHERE id=?', active, shift.id),
        audit(db, member, 'production.shift.updated', shift.id, { active }, 'staff'),
      ]);
    } catch { fail(409, 'Shift changed. Reload and retry.'); }
    return json({ shift: await one(db, 'SELECT id,name,start_minute,end_minute,days,active FROM shifts WHERE id=?', shift.id) });
  }
  fail(404, 'Production setup route not found.');
}

/** Planning, reservations, actual runs, roll QC, packing and reconciliation — permission-routed. */
async function memberRoutes(db, w, member, path, data, now) {
  if (/^\/api\/erp\/production\/(machines|shifts)\b/.test(path))
    fail(403, 'Only an admin can set up machines, shifts and maintenance calendars.');

  // ---------------------------------------------------------------- buyer-linked batches
  if (path === '/api/erp/production/batches' && data) {
    allow(member, 'production');
    keys(data, ['id', 'salesOrderLineId', 'productId', 'operation', 'plannedQuantityMilli', 'unit', 'dueAt', 'specifications']);
    const id = recordId(data.id), lineId = recordId(data.salesOrderLineId), productId = recordId(data.productId);
    const operation = machineOperation(data.operation);
    const unit = unitOf(data.unit);
    const quantityMilli = integer(data.plannedQuantityMilli, 'Planned quantity in thousandths', 1, 1_000_000_000_000);
    const specifications = multiline(data.specifications ?? '', 'Specifications', 0, 4000);
    const dueAt = date(data.dueAt, 'Requested production date');
    if (!(await one(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', productId, w))) fail(404, 'This material was not found in your workspace.');
    const line = await one(db, `SELECT l.*,o.status AS order_status,o.reference AS order_reference
      FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id WHERE l.id=? AND l.workspace_id=?`, lineId, w);
    if (!line) fail(404, 'This sales order line was not found in your workspace.');
    if (line.order_status !== 'confirmed') fail(409, 'Only a confirmed sales order line can receive a production batch.');
    if (line.unit !== unit) fail(409, `The order line is measured in ${line.unit}; a batch cannot switch units because no conversion is recorded.`);
    if (line.product_id && line.product_id !== productId) fail(409, 'The order line is already mapped to a different product.');
    const hash = await digest({ line: lineId, product: productId, operation, quantityMilli, unit, specifications, dueAt });
    const previous = await one(db, 'SELECT * FROM production_batches WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.request_hash !== hash) fail(409, 'This batch ID was already used for different values.');
      return json({ batch: previous });
    }
    const cap = line.quantity_milli + Math.floor(line.quantity_milli / 10);
    if (!Number.isSafeInteger(cap)) fail(422, 'This sales order quantity is too large to plan against.');
    const year = new Date(now).getUTCFullYear();
    let batch = null;
    try {
      await db.batch([
        query(db, `INSERT INTO production_batches(id,workspace_id,reference,sales_order_line_id,product_id,operation,planned_quantity_milli,unit,specifications,due_at,status,request_hash,created_by,created_at)
            SELECT ?,?,'PB-${year}-' || printf('%06d', COALESCE((SELECT MAX(CAST(SUBSTR(reference,-6) AS INTEGER)) FROM production_batches WHERE workspace_id=? AND reference LIKE ?),0) + 1),
                   ?,?,?,?,?,?,?,'accepted',?,?,?
            WHERE EXISTS (SELECT 1 FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id
              WHERE l.id=? AND l.workspace_id=? AND o.status='confirmed' AND l.unit=? AND (l.product_id IS NULL OR l.product_id=?))
            AND ? + COALESCE((SELECT SUM(b.planned_quantity_milli) FROM production_batches b
              WHERE b.sales_order_line_id=? AND b.status NOT IN ('cancelled')),0) <= ?`,
          id, w, w, `PB-${year}-%`, lineId, productId, operation, quantityMilli, unit, specifications, dueAt, hash, member.user_id, now,
          lineId, w, unit, productId, quantityMilli, lineId, cap),
        audit(db, member, 'production.batch.created', id, { line: lineId, product: productId, operation, quantityMilli, unit }, 'staff'),
      ]);
      batch = await one(db, 'SELECT * FROM production_batches WHERE id=?', id);
    } catch { fail(409, 'Planning the batch raced another entry. Reload and retry — the batch reference is renumbered atomically.'); }
    if (!batch) fail(409, 'The confirmed sales order line or its planned batches changed. Reload before planning.');
    return json({ batch }, 201);
  }
  if (path === '/api/erp/production/batches/allocate' && data) {
    allow(member, 'production');
    keys(data, ['id', 'batchId', 'machineId', 'shiftId', 'plannedFrom', 'plannedTo', 'quantityMilli']);
    const id = recordId(data.id);
    const batch = await batchFor(db, w, recordId(data.batchId));
    if (!['accepted', 'planned', 'in_production'].includes(batch.status)) fail(409, `A batch in the ${batch.status} state no longer accepts machine allocations.`);
    const machine = await one(db, 'SELECT * FROM machines WHERE id=? AND workspace_id=?', recordId(data.machineId), w);
    if (!machine) fail(404, 'Machine not found.');
    if (!machine.active) fail(409, 'This machine is inactive. Re-activate it before planning on it.');
    if (!JSON.parse(machine.operations).includes(batch.operation)) fail(409, `Machine "${machine.name}" does not support ${batch.operation}. Capability is checked before allocation.`);
    const capacity = await one(db, 'SELECT * FROM machine_capacities WHERE machine_id=? ORDER BY version DESC LIMIT 1', machine.id);
    if (!capacity) fail(409, 'Record a capacity for this machine before allocating batches on it.');
    if (capacity.unit !== batch.unit) fail(409, `This machine is rated in ${capacity.unit} and the batch is measured in ${batch.unit}. Yarnflow never converts units — choose a machine whose capacity unit matches the batch.`);
    const plannedFrom = date(data.plannedFrom, 'Allocation start'), plannedTo = date(data.plannedTo, 'Allocation end');
    if (plannedTo <= plannedFrom) fail(422, 'An allocation must end after it starts.');
    if (plannedTo <= now) fail(422, 'Book an allocation window that has not finished yet.');
    const quantityMilli = integer(data.quantityMilli, 'Planned quantity for this window in thousandths', 1, 1_000_000_000_000);
    const capacityMilli = Math.floor((plannedTo - plannedFrom) * capacity.rate_milli_per_hour / 3_600_000);
    if (quantityMilli > capacityMilli) fail(409, `At the recorded rate ${machine.name} makes about ${quantity(capacityMilli, capacity.unit)} in this window; ${quantity(quantityMilli, batch.unit)} exceeds machine capacity.`);
    const shiftId = data.shiftId ? recordId(data.shiftId) : null;
    if (shiftId && !(await one(db, 'SELECT id FROM shifts WHERE id=? AND workspace_id=? AND active=1', shiftId, w))) fail(404, 'Shift not found or inactive.');
    const hash = await digest({ batch: batch.id, machine: machine.id, shift: shiftId, plannedFrom, plannedTo, quantityMilli });
    const previous = await one(db, 'SELECT * FROM machine_allocations WHERE id=?', id);
    if (previous) {
      const repeat = previous.workspace_id === w && previous.batch_id === batch.id && previous.machine_id === machine.id
        && previous.shift_id === shiftId && previous.planned_from === plannedFrom && previous.planned_to === plannedTo
        && previous.quantity_planned_milli === quantityMilli;
      if (!repeat) fail(409, 'This allocation ID was already used for different values.');
      return json({ allocation: await one(db, 'SELECT a.*,m.name AS machine_name FROM machine_allocations a JOIN machines m ON m.id=a.machine_id WHERE a.id=?', id) });
    }
    const result = await db.batch([
      query(db, `INSERT INTO machine_allocations(id,workspace_id,batch_id,machine_id,shift_id,capacity_version_id,planned_from,planned_to,quantity_planned_milli,status,created_by,created_at)
          SELECT ?,?,?,?,?,?,?,?,?,'planned',?,?
          WHERE NOT EXISTS (SELECT 1 FROM machine_allocations a WHERE a.machine_id=? AND a.status!='cancelled' AND a.planned_from<? AND a.planned_to>?)
          AND NOT EXISTS (SELECT 1 FROM machine_downtimes d WHERE d.machine_id=? AND d.status='planned' AND d.from_at<? AND d.to_at>?)`,
        id, w, batch.id, machine.id, shiftId, capacity.id, plannedFrom, plannedTo, quantityMilli, member.user_id, now,
        machine.id, plannedTo, plannedFrom, machine.id, plannedTo, plannedFrom),
      query(db, "UPDATE production_batches SET status='planned' WHERE id=? AND status='accepted'", batch.id),
      audit(db, member, 'production.batch.allocated', batch.id, { allocation: id, machine: machine.id, capacity: capacity.id, quantityMilli }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, `That window on ${machine.name} is already booked or overlaps planned maintenance. Reload and choose another window.`);
    return json({ allocation: await one(db, 'SELECT a.*,m.name AS machine_name FROM machine_allocations a JOIN machines m ON m.id=a.machine_id WHERE a.id=?', id) }, 201);
  }
  if (path === '/api/erp/production/allocations/cancel' && data) {
    allow(member, 'production');
    keys(data, ['id', 'reason']);
    const id = recordId(data.id), reason = multiline(data.reason, 'Cancellation reason', 3, 500);
    if (!(await one(db, 'SELECT a.id FROM machine_allocations a JOIN production_batches b ON b.id=a.batch_id WHERE a.id=? AND a.workspace_id=?', id, w)))
      fail(404, 'Allocation not found.');
    const result = await db.batch([
      query(db, "UPDATE machine_allocations SET status='cancelled',cancel_reason=? WHERE id=? AND status='planned'", reason, id),
      audit(db, member, 'production.allocation.cancelled', id, { reason }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, 'Only a planned allocation can be cancelled — a started allocation is part of production history.');
    return json({ cancelled: true });
  }
  if (path === '/api/erp/production/batches/start' && data) {
    allow(member, 'production');
    keys(data, ['id']);
    const batch = await batchFor(db, w, recordId(data.id));
    if (batch.status === 'in_production') return json({ batch });
    if (!['accepted', 'planned'].includes(batch.status)) fail(409, `A batch in the ${batch.status} state cannot move into production.`);
    const result = await db.batch([
      query(db, `UPDATE production_batches SET status='in_production' WHERE id=?
          AND status IN ('accepted','planned')
          AND EXISTS (SELECT 1 FROM machine_allocations WHERE batch_id=production_batches.id AND status='planned')`, batch.id),
      audit(db, member, 'production.batch.started', batch.id, {}, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, 'Plan at least one machine allocation before starting production.');
    return json({ batch: await batchFor(db, w, batch.id) });
  }
  if (path === '/api/erp/production/batches/hold' && data) {
    allow(member, 'production');
    keys(data, ['id', 'note']);
    const batch = await batchFor(db, w, recordId(data.id));
    if (['hold', 'cancelled', 'completed'].includes(batch.status)) fail(409, `A batch in the ${batch.status} state cannot be put on hold.`);
    const note = multiline(data.note, 'Hold reason', 3, 1000);
    await db.batch([
      query(db, "UPDATE production_batches SET status='hold',previous_status=status,hold_reason=? WHERE id=? AND status NOT IN ('hold','cancelled','completed')", note, batch.id),
      audit(db, member, 'production.batch.hold', batch.id, { note }, 'staff'),
    ]);
    const held = await batchFor(db, w, batch.id);
    if (held.status !== 'hold') fail(409, 'The batch changed while holding. Reload and retry.');
    return json({ batch: held });
  }
  if (path === '/api/erp/production/batches/resume' && data) {
    allow(member, 'production');
    keys(data, ['id']);
    const batch = await batchFor(db, w, recordId(data.id));
    if (batch.status !== 'hold') fail(409, 'Only a held batch can resume.');
    const target = batch.previous_status && !['hold', 'cancelled'].includes(batch.previous_status) ? batch.previous_status : 'in_production';
    await db.batch([
      query(db, "UPDATE production_batches SET status=?,hold_reason='',previous_status=NULL WHERE id=? AND status='hold'", target, batch.id),
      audit(db, member, 'production.batch.resumed', batch.id, { target }, 'staff'),
    ]);
    return json({ batch: await batchFor(db, w, batch.id) });
  }
  if (path === '/api/erp/production/batches/cancel' && data) {
    allow(member, 'production');
    keys(data, ['id', 'reason']);
    const batch = await batchFor(db, w, recordId(data.id));
    const reason = multiline(data.reason, 'Cancellation reason', 3, 1000);
    if ((await one(db, 'SELECT COUNT(*) AS n FROM production_inputs i JOIN production_runs r ON r.id=i.run_id WHERE r.batch_id=?', batch.id)).n)
      fail(409, 'This batch already consumed stock. Use hold or rework instead of cancelling so the ledger stays honest.');
    if ((await one(db, 'SELECT COUNT(*) AS n FROM production_outputs o JOIN production_runs r ON r.id=o.run_id WHERE r.batch_id=?', batch.id)).n)
      fail(409, 'This batch already produced stock. Use hold or rework instead of cancelling so the ledger stays honest.');
    try {
      await db.batch([
        query(db, "UPDATE production_batches SET status='cancelled',hold_reason=?,previous_status=status WHERE id=? AND status NOT IN ('cancelled','completed')", reason, batch.id),
        query(db, "UPDATE machine_allocations SET status='cancelled',cancel_reason=? WHERE batch_id=? AND status='planned'", `Batch cancelled: ${reason}`, batch.id),
        query(db, "UPDATE stock_reservations SET status='released',released_reason=? WHERE batch_id=? AND status='active'", `Batch cancelled: ${reason}`, batch.id),
        audit(db, member, 'production.batch.cancelled', batch.id, { reason }, 'staff'),
      ]);
    } catch { fail(409, 'Batch changed while cancelling. Reload and retry.'); }
    const after = await batchFor(db, w, batch.id);
    if (after.status !== 'cancelled') fail(409, 'The batch changed while cancelling. Reload and retry.');
    return json({ batch: after });
  }
  if (path === '/api/erp/production/batches/packing' && data) {
    allow(member, 'produce');
    keys(data, ['id', 'note']);
    const batch = await batchFor(db, w, recordId(data.id));
    if (batch.status === 'packing') return json({ batch });
    if (batch.status !== 'in_production') fail(409, `Only an in-production batch enters packing; this batch is ${batch.status}.`);
    const note = multiline(data.note ?? '', 'Packing note', 0, 1000);
    const result = await db.batch([
      query(db, `UPDATE production_batches SET status='packing' WHERE id=? AND status='in_production'
          AND NOT EXISTS (SELECT 1 FROM production_runs WHERE batch_id=production_batches.id AND status='open')`, batch.id),
      audit(db, member, 'production.batch.packing', batch.id, { note }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, 'Close every open production run before the batch enters packing.');
    return json({ batch: await batchFor(db, w, batch.id) });
  }
  if (path === '/api/erp/production/batches/complete' && data) {
    allow(member, 'production');
    keys(data, ['id']);
    const batch = await batchFor(db, w, recordId(data.id));
    if (batch.status === 'completed') return json({ batch, totals: await runTotals(db, batch.id) });
    if (!['in_production', 'packing'].includes(batch.status)) fail(409, `A batch in the ${batch.status} state cannot be completed.`);
    if ((await one(db, "SELECT COUNT(*) AS n FROM production_runs WHERE batch_id=? AND status='open'", batch.id)).n)
      fail(409, 'Close every open production run before completing the batch.');
    const rolls = await all(db, 'SELECT result,disposition FROM fabric_rolls WHERE batch_id=?', batch.id);
    if (rolls.some(roll => roll.result === 'pending')) fail(409, 'Finished QC must inspect every roll before the batch can complete.');
    if (rolls.some(roll => roll.result === 'passed' && roll.disposition === 'unpacked')) fail(409, 'Pack every QC-passed roll before completing the batch.');
    if (rolls.some(roll => roll.result === 'failed' && roll.disposition === 'unpacked')) fail(409, 'A failed roll is undispositioned: record its scrap or rework first.');
    if (!(await one(db, 'SELECT COUNT(*) AS n FROM production_outputs o JOIN production_runs r ON r.id=o.run_id WHERE r.batch_id=?', batch.id)).n)
      fail(409, 'Completion requires actual output. A batch that produced nothing cannot be completed — use hold or cancel.');
    const totals = await runTotals(db, batch.id);
    try {
      await db.batch([
        query(db, "UPDATE stock_reservations SET status='released',released_reason='Batch completed' WHERE batch_id=? AND status='active'", batch.id),
        query(db, "UPDATE machine_allocations SET status='cancelled',cancel_reason='Batch completed; window was not used' WHERE batch_id=? AND status='planned'", batch.id),
        query(db, "UPDATE machine_allocations SET status='completed' WHERE batch_id=? AND status='started'", batch.id),
        query(db, "UPDATE production_batches SET status='completed',completed_at=? WHERE id=? AND status IN ('in_production','packing')", now, batch.id),
        audit(db, member, 'production.batch.completed', batch.id, totals, 'staff'),
      ]);
    } catch { fail(409, 'Batch changed while completing. Reload and retry.'); }
    const after = await batchFor(db, w, batch.id);
    if (after.status !== 'completed') fail(409, 'The batch changed while completing. Reload and retry.');
    return json({ batch: after, totals });
  }
  if (path === '/api/erp/production/batches/rework' && data) {
    allow(member, 'production');
    keys(data, ['id', 'reason']);
    const batch = await batchFor(db, w, recordId(data.id));
    if (!['packing', 'completed'].includes(batch.status)) fail(409, 'Rework opens only after packing or completion.');
    const reason = multiline(data.reason, 'Rework reason', 3, 1000);
    try {
      await db.batch([
        query(db, "UPDATE production_batches SET status='in_production' WHERE id=? AND status IN ('packing','completed')", batch.id),
        audit(db, member, 'production.batch.rework', batch.id, { reason }, 'staff'),
      ]);
    } catch { fail(409, 'Batch changed. Reload and retry rework.'); }
    const after = await batchFor(db, w, batch.id);
    if (after.status !== 'in_production') fail(409, 'Rework was refused: the batch state changed, and dispatched stock cannot return without the sales module.');
    return json({ batch: after });
  }

  // ---------------------------------------------------------------- reservations (reduce availability only)
  if (path === '/api/erp/production/reservations' && data) {
    allow(member, 'production');
    keys(data, ['id', 'batchId', 'lotId', 'stage', 'grams']);
    const id = recordId(data.id);
    const batch = await batchFor(db, w, recordId(data.batchId));
    if (['cancelled', 'completed'].includes(batch.status)) fail(409, `A batch in the ${batch.status} state cannot reserve stock.`);
    if (batch.status === 'hold') fail(409, 'Resume the batch before reserving stock.');
    const lotId = recordId(data.lotId), stage = stageOf(data.stage ?? 'raw');
    const grams = integer(data.grams, 'Reserved weight in grams', 1, 9_000_000_000_000);
    const hash = await digest({ batch: batch.id, lot: lotId, stage, grams });
    const previous = await one(db, 'SELECT * FROM stock_reservations WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.request_hash !== hash) fail(409, 'This reservation ID was already used for different values.');
      return json({ reservation: previous });
    }
    const result = await db.batch([
      query(db, `INSERT INTO stock_reservations(id,workspace_id,batch_id,lot_id,stage,grams,status,created_by,created_at)
          SELECT ?,?,?,?,?,?,'active',?,? WHERE EXISTS (${availableSql()})`,
        id, w, batch.id, lotId, stage, grams, member.user_id, now, ...availableArgs(w, lotId, stage, grams)),
      audit(db, member, 'production.reservation.created', id, { batch: batch.id, lot: lotId, stage, grams }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, 'Not enough inspected, approved stock is available for this reservation. Uninspected and QC-held lots are excluded, and reservations of other batches reduce what is free.');
    return json({ reservation: await one(db, 'SELECT * FROM stock_reservations WHERE id=?', id) }, 201);
  }
  if (path === '/api/erp/production/reservations/release' && data) {
    allow(member, 'production');
    keys(data, ['id', 'reason']);
    const id = recordId(data.id), reason = multiline(data.reason, 'Release reason', 3, 500);
    if (!(await one(db, "SELECT id FROM stock_reservations WHERE id=? AND workspace_id=? AND status='active'", id, w)))
      fail(404, 'Active reservation not found.');
    const result = await db.batch([
      query(db, "UPDATE stock_reservations SET status='released',released_reason=? WHERE id=? AND status='active'", reason, id),
      audit(db, member, 'production.reservation.released', id, { reason }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, 'The reservation changed. Reload and retry.');
    return json({ released: true });
  }

  // ---------------------------------------------------------------- actual runs through the ledger
  if (path === '/api/erp/production/runs/open' && data) {
    allow(member, 'produce');
    keys(data, ['id', 'batchId', 'allocationId', 'rework', 'startedAt', 'note']);
    const id = recordId(data.id);
    const batch = await batchFor(db, w, recordId(data.batchId));
    if (batch.status === 'hold') fail(409, 'A held batch cannot open runs. Resume it first.');
    if (batch.status === 'cancelled') fail(409, 'A cancelled batch cannot open runs.');
    if (data.rework ? !['packing', 'completed'].includes(batch.status)
      : batch.status !== 'in_production') {
      fail(409, data.rework
        ? `A rework run opens only for a packed or completed batch; this batch is ${batch.status}.`
        : `Actual runs record on in-production batches only; this batch is ${batch.status}. Start the batch first.`);
    }
    const allocationId = data.allocationId ? recordId(data.allocationId) : null;
    if (allocationId) {
      const allocation = await one(db, 'SELECT id,status FROM machine_allocations WHERE id=? AND batch_id=? AND workspace_id=?', allocationId, batch.id, w);
      if (!allocation) fail(404, 'That machine allocation does not belong to this batch.');
      if (allocation.status === 'cancelled') fail(409, 'That allocation was cancelled; open the run without it.');
    }
    const startedAt = date(data.startedAt ?? now, 'Run start');
    const note = multiline(data.note ?? '', 'Run note', 0, 1000);
    const hash = await digest({ batch: batch.id, allocation: allocationId, rework: !!data.rework, startedAt, note });
    const previous = await one(db, 'SELECT * FROM production_runs WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.request_hash !== hash) fail(409, 'This run ID was already used for different values.');
      return json({ run: previous });
    }
    const rework = data.rework ? 1 : 0;
    try {
      await db.batch([
        query(db, `INSERT INTO production_runs(id,workspace_id,batch_id,allocation_id,seq,label,rework,status,request_hash,actor_id,actor_name,started_at,note,created_at)
            SELECT ?,?,?,?, COALESCE((SELECT MAX(seq)+1 FROM production_runs p WHERE p.batch_id=?),1),
                   ? || ' R' || printf('%d', COALESCE((SELECT MAX(seq)+1 FROM production_runs p WHERE p.batch_id=?),1)),
                   ?, 'open', ?,?,?,?,?,?
            WHERE EXISTS (SELECT 1 FROM production_batches WHERE id=? AND workspace_id=?)`,
          id, w, batch.id, allocationId, batch.id, batch.reference, batch.id, rework, hash, member.user_id, member.name, startedAt, note, now, batch.id, w),
        audit(db, member, 'production.run.opened', id, { batch: batch.id, allocation: allocationId, rework: !!data.rework }, 'staff'),
      ]);
    } catch { fail(409, `A run was opened for ${batch.reference} at the same moment. Reload and retry — the run number is renumbered atomically.`); }
    const run = await one(db, 'SELECT * FROM production_runs WHERE id=?', id);
    if (!run) fail(409, 'The batch changed while opening the run. Reload and retry.');
    return json({ run }, 201);
  }
  const run = path.startsWith('/api/erp/production/runs/')
    ? await runFor(db, w, recordId(data.runId)) : null;

  if (path === '/api/erp/production/runs/consume' && data) {
    allow(member, 'produce');
    keys(data, ['runId', 'inputs', 'note']);
    if (run.status !== 'open') fail(409, 'This run is already closed. Corrections go through reversals, not edits.');
    if (!runWritable(run)) fail(409, `A run cannot issue stock for a batch in the ${run.batch_status} state.`);
    if (!Array.isArray(data.inputs) || !data.inputs.length) fail(422, 'Record at least one lot issued to this run.');
    const note = multiline(data.note ?? '', 'Issue note', 0, 500);
    const statements = [], issued = [];
    for (const input of data.inputs) {
      keys(input, ['id', 'lotId', 'stage', 'grams', 'cones', 'cartons', 'reservationId']);
      const rowId = recordId(input.id), lotId = recordId(input.lotId), stage = stageOf(input.stage ?? 'raw');
      const grams = integer(input.grams, 'Issued weight in grams', 1, 9_000_000_000_000);
      const cones = integer(input.cones ?? 0, 'Cones', 0, 1_000_000_000);
      const cartons = integer(input.cartons ?? 0, 'Cartons', 0, 1_000_000_000);
      const reservationId = input.reservationId ? recordId(input.reservationId) : null;
      const previous = await one(db, 'SELECT * FROM production_inputs WHERE id=?', rowId);
      if (previous) {
        if (previous.run_id !== run.id || previous.lot_id !== lotId || previous.stage !== stage
          || previous.grams !== grams || previous.cones !== cones || previous.cartons !== cartons)
          fail(409, 'This issue ID was already used for different values.');
        continue;
      }
      if (reservationId) {
        const reservation = await one(db, 'SELECT * FROM stock_reservations WHERE id=?', reservationId);
        if (!reservation || reservation.workspace_id !== w) fail(404, 'The reservation used for this issue was not found.');
        if (reservation.batch_id !== run.batch_id) fail(409, 'The reservation belongs to a different batch.');
        if (reservation.status !== 'active') fail(409, 'That reservation is no longer active.');
        if (reservation.lot_id !== lotId || reservation.stage !== stage) fail(409, 'The reservation applies to a different lot or stage.');
        if (reservation.grams < grams) fail(409, `The active reservation covers ${reservation.grams} g; issue up to that per call, or use several issues.`);
      }
      const movementNote = `Issued for ${run.batch_reference} · ${run.label}${note ? ' · ' + note : ''}`;
      const hash = await digest({ run: run.id, lot: lotId, stage, grams, cones, cartons, reservation: reservationId });
      statements.push(
        query(db, `INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
            SELECT ?,?,?, 'consume', ?, NULL, ?,?,?, ?,?,?, NULL, ?, ? WHERE EXISTS (${availableSql(run.batch_id)})`,
          rowId, w, lotId, stage, grams, cartons, cones, movementNote, member.user_id, member.name, hash, now,
          ...availableArgs(w, lotId, stage, grams, run.batch_id)),
        query(db, 'INSERT INTO production_inputs(id,run_id,movement_id,lot_id,stage,grams,cones,cartons,reservation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          rowId, run.id, rowId, lotId, stage, grams, cones, cartons, reservationId, now),
        query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)',
          uuid(), rowId, lotId, stage, -grams, -cartons, -cones));
      if (reservationId) statements.push(query(db,
        `UPDATE stock_reservations SET grams=grams-?,status=CASE WHEN grams-?<=0 THEN 'consumed' ELSE status END
         WHERE id=? AND batch_id=? AND status='active' AND lot_id=? AND stage=? AND grams>=?`,
        grams, grams, reservationId, run.batch_id, lotId, stage, grams));
      issued.push(rowId);
    }
    if (statements.length === 0) return json({ run: await runFor(db, w, run.id) });
    try { await db.batch(statements); } catch (error) {
      const problem = ledgerProblem(error);
      if (problem) fail(409, problem);
      fail(409, 'The issue did not go through: not enough approved stock for one of the lots, or the held reservation no longer covers it. The whole entry was rejected, so nothing was half-issued.');
    }
    await db.batch([
      query(db, "UPDATE machine_allocations SET status='started' WHERE id=? AND status='planned'", run.allocation_id ?? ''),
      audit(db, member, 'production.run.issued', run.id, { lots: issued }, 'staff'),
    ]).catch(() => {});
    return json({ run: await runFor(db, w, run.id), issued }, 201);
  }
  if (path === '/api/erp/production/runs/outputs' && data) {
    allow(member, 'produce');
    keys(data, ['runId', 'outputs', 'note']);
    if (run.status !== 'open') fail(409, 'This run is already closed. Corrections go through reversals, not edits.');
    if (!runWritable(run)) fail(409, `A run cannot record output for a batch in the ${run.batch_status} state.`);
    if (!Array.isArray(data.outputs) || !data.outputs.length) fail(422, 'Record at least one produced lot.');
    const note = multiline(data.note ?? '', 'Output note', 0, 500);
    const base = (await one(db, 'SELECT COUNT(*) AS n FROM production_outputs WHERE run_id=?', run.id)).n;
    const statements = [], produced = [];
    for (const [index, output] of data.outputs.entries()) {
      keys(output, ['id', 'lotId', 'grams', 'cartons', 'cones', 'metres', 'pieces', 'toStage']);
      const rowId = recordId(output.id), lotId = recordId(output.lotId), toStage = stageOf(output.toStage ?? 'wip');
      const grams = integer(output.grams, 'Produced weight in grams', 1, 9_000_000_000_000);
      const cartons = integer(output.cartons ?? 0, 'Cartons', 0, 1_000_000_000);
      const cones = integer(output.cones ?? 0, 'Cones', 0, 1_000_000_000);
      const metres = output.metres === undefined || output.metres === null || output.metres === ''
        ? null : integer(output.metres, 'Produced metres', 1, 1_000_000_000);
      const pieces = output.pieces === undefined || output.pieces === null || output.pieces === ''
        ? null : integer(output.pieces, 'Produced pieces', 1, 1_000_000_000);
      if (run.batch_unit === 'metre' && metres === null) fail(422, 'The order line is measured in metres, so record the produced metres. Grams alone would misstate measured length.');
      if (run.batch_unit === 'piece' && pieces === null) fail(422, 'The order line is measured in pieces, so record the produced pieces.');
      const previous = await one(db, 'SELECT * FROM production_outputs WHERE id=?', rowId);
      if (previous) {
        if (previous.run_id !== run.id || previous.lot_id !== lotId || previous.grams !== grams
          || (previous.metres ?? null) !== metres || (previous.pieces ?? null) !== pieces || previous.to_stage !== toStage)
          fail(409, 'This output ID was already used for different values.');
        continue;
      }
      const code = `${run.label} L${base + index + 1}`;
      if (code.length > 60) fail(422, 'The produced lot label does not fit the batch code limit.');
      const movementNote = `Produced by ${run.batch_reference} · ${run.label}${note ? ' · ' + note : ''}`;
      const hash = await digest({ run: run.id, lot: lotId, grams, cartons, cones, metres, pieces, toStage });
      statements.push(
        query(db, "INSERT INTO lots(id,workspace_id,product_id,batch,quality,created_at) VALUES(?,?,?,?, 'uninspected', ?)",
          lotId, w, run.batch_product_id, code, now),
        query(db, `INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
            VALUES(?,?,?, 'produce', NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          rowId, w, lotId, toStage, grams, cartons, cones, movementNote, member.user_id, member.name, hash, now),
        query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)',
          uuid(), rowId, lotId, toStage, grams, cartons, cones),
        query(db, 'INSERT INTO production_outputs(id,run_id,movement_id,lot_id,product_id,grams,metres,pieces,to_stage,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          rowId, run.id, rowId, lotId, run.batch_product_id, grams, metres, pieces, toStage, now));
      produced.push({ id: rowId, lot: lotId, code, grams, metres, pieces, toStage });
    }
    if (statements.length === 0) return json({ run: await runFor(db, w, run.id) });
    try { await db.batch(statements); } catch (error) {
      if (/UNIQUE constraint failed.*lots|lots\.batch/i.test(String(error))) fail(409, 'Another output used the same lot label a moment ago. Reload and record the output again.');
      fail(409, 'Recording the output did not go through. The whole entry was rejected, so nothing was half-issued.');
    }
    await db.batch([audit(db, member, 'production.run.output', run.id, { lots: produced }, 'staff')]);
    return json({ run: await runFor(db, w, run.id), produced }, 201);
  }
  if (path === '/api/erp/production/runs/downtime' && data) {
    allow(member, 'produce');
    keys(data, ['id', 'runId', 'fromAt', 'toAt', 'reason']);
    const id = recordId(data.id), from = date(data.fromAt, 'Downtime start'), to = date(data.toAt, 'Downtime end');
    if (to <= from) fail(422, 'Actual downtime must end after it starts.');
    if (run.status === 'cancelled') fail(409, 'A cancelled run records no downtime.');
    const reason = multiline(data.reason, 'Downtime reason', 3, 500);
    const machineId = run.allocation_id
      ? (await one(db, 'SELECT machine_id FROM machine_allocations WHERE id=?', run.allocation_id))?.machine_id ?? null
      : null;
    const previous = await one(db, 'SELECT * FROM downtime_events WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.run_id !== run.id || previous.from_at !== from || previous.to_at !== to || previous.reason !== reason)
        fail(409, 'This downtime ID was already used for different values.');
      return json({ downtime: previous });
    }
    await db.batch([
      query(db, "INSERT INTO downtime_events(id,workspace_id,run_id,machine_id,from_at,to_at,reason,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id, w, run.id, machineId, from, to, reason, member.name, now),
      audit(db, member, 'production.run.downtime', run.id, { from, to, reason }, 'staff'),
    ]);
    return json({ downtime: await one(db, 'SELECT * FROM downtime_events WHERE id=?', id) }, 201);
  }
  if (path === '/api/erp/production/runs/close' && data) {
    allow(member, 'produce');
    keys(data, ['runId', 'note']);
    if (run.status === 'cancelled') fail(409, 'This run was cancelled and cannot be closed.');
    if (run.status !== 'open') return json({ run });
    if (run.batch_status === 'cancelled') fail(409, 'The batch was cancelled. Resolve it through hold or delete-proof counters before closing runs.');
    const consumed = (await one(db, 'SELECT COALESCE(SUM(grams),0) AS grams FROM production_inputs WHERE run_id=?', run.id)).grams;
    const outputs = (await one(db, 'SELECT COALESCE(SUM(grams),0) AS grams FROM production_outputs WHERE run_id=?', run.id)).grams;
    if (consumed === 0) fail(409, 'Close needs at least one issued lot. Cancel the run instead if it did nothing.');
    if (outputs === 0) fail(409, 'Close needs at least one produced lot so the run records real output, not consumed stock alone.');
    if (outputs > consumed) fail(409, `Mass does not reconcile: the run produced ${outputs} g after consuming ${consumed} g. Output mass cannot exceed consumed mass.`);
    const note = multiline(data.note ?? '', 'Close note', 0, 1000);
    const loss = consumed - outputs;
    const result = await db.batch([
      query(db, `UPDATE production_runs SET status='completed',consumed_grams=?,output_grams=?,loss_grams=?,completed_at=?
          WHERE id=? AND status='open'`, consumed, outputs, loss, now, run.id),
      query(db, `UPDATE machine_allocations SET status='completed' WHERE id=? AND status IN ('planned','started')
          AND NOT EXISTS (SELECT 1 FROM production_runs WHERE allocation_id=machine_allocations.id AND status='open')`, run.allocation_id ?? ''),
      audit(db, member, 'production.run.closed', run.id, { consumed, outputs, loss, note }, 'staff'),
    ]);
    if (result[0].meta.changes === 0) fail(409, 'The run changed. Reload and close it after the other entry.');
    return json({ run: await runFor(db, w, run.id), totals: { consumed_grams: consumed, output_grams: outputs, loss_grams: loss } }, 201);
  }
  if (path === '/api/erp/production/runs/cancel' && data) {
    allow(member, 'produce');
    keys(data, ['runId', 'reason']);
    if (run.status !== 'open') fail(409, 'This run is not open.');
    const reason = multiline(data.reason, 'Cancellation reason', 3, 500);
    const counts = await Promise.all([
      one(db, 'SELECT COUNT(*) AS n FROM production_inputs WHERE run_id=?', run.id),
      one(db, 'SELECT COUNT(*) AS n FROM production_outputs WHERE run_id=?', run.id),
      one(db, 'SELECT COUNT(*) AS n FROM fabric_rolls WHERE run_id=?', run.id),
      one(db, 'SELECT COUNT(*) AS n FROM downtime_events WHERE run_id=?', run.id),
    ]);
    if (counts.some(c => c.n)) fail(409, 'This run already recorded movement, output, rolls or downtime. Close it instead; records stay truthful.');
    await db.batch([
      query(db, "UPDATE production_runs SET status='cancelled',completed_at=? WHERE id=? AND status='open'", now, run.id),
      query(db, `UPDATE machine_allocations SET status='completed' WHERE id=? AND status IN ('planned','started')
          AND NOT EXISTS (SELECT 1 FROM production_runs WHERE allocation_id=machine_allocations.id AND status='open')`, run.allocation_id ?? ''),
      audit(db, member, 'production.run.cancelled', run.id, { reason }, 'staff'),
    ]);
    return json({ run: await runFor(db, w, run.id) });
  }

  // ---------------------------------------------------------------- fabric rolls: cut, inspect, disposition
  if (path === '/api/erp/production/rolls' && data) {
    allow(member, 'produce');
    keys(data, ['id', 'runId', 'lotId', 'grams', 'metres', 'widthMm', 'gsm']);
    const run = await runFor(db, w, recordId(data.runId));
    if (run.status === 'cancelled') fail(409, 'A cancelled run cannot cut rolls.');
    if (run.batch_status === 'hold') fail(409, 'Resume the batch before cutting rolls.');
    const id = recordId(data.id), lotId = recordId(data.lotId);
    const grams = integer(data.grams, 'Roll weight in grams', 1, 9_000_000_000_000);
    const metres = integer(data.metres, 'Roll length in metres', 1, 1_000_000_000);
    const widthMm = integer(data.widthMm, 'Roll width in millimetres', 1, 4000);
    const gsm = integer(data.gsm, 'Roll GSM', 1, 2000);
    const output = await one(db, 'SELECT * FROM production_outputs WHERE run_id=? AND lot_id=?', run.id, lotId);
    if (!output) fail(409, 'Rolls are cut from a produced lot of this run. Record the produced lot first.');
    if (output.metres === null) fail(409, 'Record metres on the produced lot before cutting rolls: every roll carries its measured length.');
    const previous = await one(db, 'SELECT * FROM fabric_rolls WHERE id=?', id);
    if (previous) {
      if (previous.run_id !== run.id || previous.lot_id !== lotId || previous.grams !== grams
        || previous.metres !== metres || previous.width_mm !== widthMm || previous.gsm !== gsm)
        fail(409, 'This roll ID was already used for different values.');
      return json({ roll: previous });
    }
    const cut = await one(db, `SELECT COALESCE(SUM(grams),0) AS grams, COALESCE(SUM(metres),0) AS metres
      FROM fabric_rolls WHERE run_id=? AND lot_id=?`, run.id, lotId);
    if (cut.grams + grams > output.grams || cut.metres + metres > output.metres)
      fail(409, `Only ${output.grams} g and ${output.metres} m were recorded as produced on this lot, and rolls already total ${cut.grams} g / ${cut.metres} m. Cut rolls within what the run really produced.`);
    await db.batch([
      query(db, `INSERT INTO fabric_rolls(id,workspace_id,batch_id,lot_id,run_id,metres,grams,width_mm,gsm,result,disposition,created_at)
          VALUES(?,?,?,?,?,?,?,?,?, 'pending', 'unpacked', ?)`, id, w, run.batch_id, lotId, run.id, metres, grams, widthMm, gsm, now),
      audit(db, member, 'production.roll.cut', id, { run: run.id, lot: lotId, grams, metres, widthMm, gsm }, 'staff'),
    ]).catch(() => fail(409, 'The roll could not be recorded. Refresh and retry.'));
    return json({ roll: await one(db, 'SELECT * FROM fabric_rolls WHERE id=?', id) }, 201);
  }
  if (path === '/api/erp/production/rolls/qc' && data) {
    allow(member, 'qc');
    keys(data, ['id', 'result', 'note']);
    const roll = await rollFor(db, w, recordId(data.id));
    if (roll.result !== 'pending') fail(409, 'This roll was already inspected. An inspection outcome cannot change afterwards.');
    if (!['passed', 'failed'].includes(data.result)) fail(422, 'Record a passed or failed roll inspection.');
    const note = multiline(data.note ?? '', 'Inspection note', 0, 1000);
    const lot = await one(db, 'SELECT * FROM lots WHERE id=?', roll.lot_id);
    if (!lot || lot.workspace_id !== w) fail(404, 'The roll lot was not found in your workspace.');
    const quality = data.result === 'passed' ? 'approved' : 'hold';
    const qualityNote = `Roll QC ${data.result} (batch ${roll.batch_id.slice(0, 8)})
${note}`.trim();
    await db.batch([
      query(db, "UPDATE fabric_rolls SET result=?,inspection_note=?,inspected_by=?,inspected_at=? WHERE id=? AND result='pending'",
        data.result, note, member.name, now, roll.id),
      ...(data.result === 'failed' || lot.quality === 'uninspected' ? [
        query(db, 'UPDATE lots SET quality=? WHERE id=? AND workspace_id=?', quality, roll.lot_id, w),
        query(db, 'INSERT INTO quality_events(id,workspace_id,lot_id,status,note,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?)',
          uuid(), w, roll.lot_id, quality, qualityNote, member.user_id, member.name, now),
      ] : []),
      audit(db, member, 'production.roll.inspected', roll.id, { result: data.result, lot: roll.lot_id, quality }, 'staff'),
    ]);
    const after = await one(db, 'SELECT * FROM fabric_rolls WHERE id=?', roll.id);
    if (after.result === 'pending') fail(409, 'The roll was inspected a moment ago. Reload.');
    return json({ roll: after });
  }
  if (path === '/api/erp/production/rolls/scrap' && data) {
    allow(member, 'waste');
    keys(data, ['id', 'note']);
    const roll = await rollFor(db, w, recordId(data.id));
    if (roll.result !== 'failed') fail(409, 'Only a roll that failed QC is scrapped: record the inspection first so scrap states its reason.');
    if (roll.disposition !== 'unpacked') fail(409, 'This roll is already dispositioned.');
    const note = multiline(data.note, 'Scrap reason', 3, 500);
    const output = await one(db, 'SELECT to_stage FROM production_outputs WHERE run_id=? AND lot_id=?', roll.run_id, roll.lot_id);
    if (!output) fail(409, 'This roll has no recorded produced lot for its stage.');
    const movementNote = `Scrapped failed roll of ${roll.batch_id.slice(0, 8)} · ${note}`;
    const result = await db.batch([
      query(db, `INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
          VALUES(?,?,?, 'waste', ?, NULL, ?, 0, 0, ?,?,?, NULL, ?, ?)`,
        roll.id, w, roll.lot_id, output.to_stage, roll.grams, movementNote, member.user_id, member.name, await digest({ roll: roll.id, scrap: true, note }), now),
      query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)',
        uuid(), roll.id, roll.lot_id, output.to_stage, -roll.grams, 0, 0),
      query(db, "UPDATE fabric_rolls SET disposition='scrap' WHERE id=? AND result='failed' AND disposition='unpacked'", roll.id),
      audit(db, member, 'production.roll.scrapped', roll.id, { grams: roll.grams, note }, 'staff'),
    ]);
    if (result[2].meta.changes === 0) fail(409, 'The roll changed. Reload and retry.');
    return json({ roll: await rollFor(db, w, roll.id) });
  }
  if (path === '/api/erp/production/rolls/rework' && data) {
    allow(member, 'produce');
    keys(data, ['id', 'runId', 'note']);
    const roll = await rollFor(db, w, recordId(data.id));
    const reworkRun = await runFor(db, w, recordId(data.runId));
    if (reworkRun.batch_id !== roll.batch_id) fail(409, 'Rework must go through a run of the same batch.');
    if (reworkRun.rework !== 1 || reworkRun.status !== 'open') fail(409, 'Open a rework run for the batch first; only an open rework run can take failed rolls.');
    if (roll.result !== 'failed') fail(409, 'Only a roll that failed QC is reworked: record the inspection first.');
    if (roll.disposition !== 'unpacked') fail(409, 'This roll is already dispositioned.');
    const note = multiline(data.note ?? '', 'Rework note', 0, 500);
    const previous = await one(db, 'SELECT * FROM production_inputs WHERE id=?', roll.id);
    if (previous) {
      if (previous.run_id !== reworkRun.id || previous.grams !== roll.grams) fail(409, 'This rework ID was already used for different values.');
      return json({ input: previous });
    }
    const output = await one(db, 'SELECT to_stage FROM production_outputs WHERE run_id=? AND lot_id=?', roll.run_id, roll.lot_id);
    if (!output) fail(409, 'This roll has no recorded produced lot for its stage.');
    const lot = await one(db, 'SELECT quality FROM lots WHERE id=? AND workspace_id=?', roll.lot_id, w);
    if (lot?.quality !== 'approved') fail(409, 'The reworked roll lot is uninspected or QC-held. Resolve the quality decision first, then rework the roll.');
    await db.batch([
      query(db, `INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at)
          SELECT ?,?,?, 'consume', ?, NULL, ?, 0, 0, ?,?,?, NULL, ?, ? WHERE EXISTS (${availableSql(roll.batch_id)})`,
        roll.id, w, roll.lot_id, output.to_stage, roll.grams,
        `Reworked failed roll of ${roll.batch_id.slice(0, 8)} · ${note}`, member.user_id, member.name,
        await digest({ roll: roll.id, run: reworkRun.id, rework: true }), now,
        ...availableArgs(w, roll.lot_id, output.to_stage, roll.grams, roll.batch_id)),
      query(db, 'INSERT INTO production_inputs(id,run_id,movement_id,lot_id,stage,grams,cones,cartons,reservation_id,created_at) VALUES(?,?,?,?,?,?,0,0,NULL,?)',
        roll.id, reworkRun.id, roll.id, roll.lot_id, output.to_stage, roll.grams, now),
      query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)',
        uuid(), roll.id, roll.lot_id, output.to_stage, -roll.grams, 0, 0),
      query(db, "UPDATE fabric_rolls SET disposition='packed_rework' WHERE id=? AND result='failed' AND disposition='unpacked'", roll.id),
      audit(db, member, 'production.roll.rework', roll.id, { run: reworkRun.id, grams: roll.grams, note }, 'staff'),
    ]).catch(error => { const problem = ledgerProblem(error); fail(409, problem ?? 'Rework could not be recorded: not enough approved stock for the roll lot.'); });
    const after = await rollFor(db, w, roll.id);
    if (after.disposition !== 'packed_rework') fail(409, 'The roll changed. Reload and retry rework.');
    return json({ roll: after, run: await runFor(db, w, reworkRun.id) });
  }

  // ---------------------------------------------------------------- packing
  if (path === '/api/erp/production/packs' && data) {
    allow(member, 'produce');
    keys(data, ['id', 'batchId', 'code', 'rollIds']);
    const id = recordId(data.id);
    const batch = await batchFor(db, w, recordId(data.batchId));
    if (!['in_production', 'packing'].includes(batch.status)) fail(409, `A batch in the ${batch.status} state cannot be packed.`);
    const code = text(data.code, 'Package code', 1, 60);
    if (!Array.isArray(data.rollIds) || !data.rollIds.length) fail(422, 'List the rolls packed in this package.');
    const rollIds = data.rollIds.map(recordId);
    if (new Set(rollIds).size !== rollIds.length) fail(422, 'List each roll once.');
    const rolls = await all(db, `SELECT f.*,l.quality FROM fabric_rolls f JOIN lots l ON l.id=f.lot_id
      WHERE f.workspace_id=? AND f.id IN (${rollIds.map(() => '?').join(',')})`, w, ...rollIds);
    if (rolls.length !== rollIds.length) fail(404, 'One or more rolls were not found in your workspace.');
    if (rolls.some(roll => roll.batch_id !== batch.id)) fail(409, 'Every packed roll must belong to this batch.');
    if (rolls.some(roll => roll.result !== 'passed')) fail(409, 'QC must pass every roll before it is packed; uninspected or failed rolls stay out of packages.');
    if (rolls.some(roll => roll.quality !== 'approved')) fail(409, 'A packed roll cannot come from a lot that is uninspected or QC-held.');
    if (rolls.some(roll => roll.disposition !== 'unpacked')) fail(409, 'One of the rolls is already packed, scrapped or in rework.');
    const hash = await digest({ batch: batch.id, code, rolls: rollIds });
    const previous = await one(db, 'SELECT * FROM production_packages WHERE id=?', id);
    if (previous) {
      if (previous.workspace_id !== w || previous.request_hash !== hash) fail(409, 'This package ID was already used for different values.');
      return json({ package: previous });
    }
    const result = await db.batch([
      query(db, 'INSERT INTO production_packages(id,workspace_id,batch_id,code,request_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
        id, w, batch.id, code, hash, member.user_id, now),
      query(db, `UPDATE fabric_rolls SET disposition='packed',package_id=? WHERE disposition='unpacked' AND result='passed'
          AND id IN (${rollIds.map(() => '?').join(',')})`, id, ...rollIds),
      audit(db, member, 'production.batch.packed', id, { batch: batch.id, code, rolls: rollIds }, 'staff'),
    ]);
    if (result[1].meta.changes !== rollIds.length) fail(409, 'A roll changed while packing. Reload and retry — the package was not saved.');
    return json({ package: await one(db, 'SELECT * FROM production_packages WHERE id=?', id) }, 201);
  }

  fail(404, 'Production route not found.');
}

/** Production overview for anyone with a relevant permission; admins also get this view. */
async function overview(db, w, now) {
  const [machines, capacities, plannedDowntime, shiftRows, batches, allocationRows, runRows, inputs, outputs, rolls, reservationRows, materials] = await Promise.all([
    all(db, 'SELECT id,name,kind,operations,active,created_at,updated_at FROM machines WHERE workspace_id=? ORDER BY name', w),
    all(db, 'SELECT c.* FROM machine_capacities c JOIN machines m ON m.id=c.machine_id WHERE m.workspace_id=? ORDER BY c.version', w),
    all(db, "SELECT d.* FROM machine_downtimes d JOIN machines m ON m.id=d.machine_id WHERE m.workspace_id=? AND d.status='planned' ORDER BY d.from_at", w),
    all(db, 'SELECT id,name,start_minute,end_minute,days,active,created_at FROM shifts WHERE workspace_id=? ORDER BY name', w),
    all(db, `SELECT b.*,p.name AS product_name,p.sku AS product_sku,l.quantity_milli AS line_quantity_milli,l.unit AS line_unit,
        o.reference AS order_reference,o.status AS order_status
      FROM production_batches b JOIN products p ON p.id=b.product_id
      JOIN sales_order_lines l ON l.id=b.sales_order_line_id JOIN sales_orders o ON o.id=l.sales_order_id
      WHERE b.workspace_id=? ORDER BY b.created_at DESC LIMIT 200`, w),
    all(db, `SELECT a.*,m.name AS machine_name FROM machine_allocations a JOIN machines m ON m.id=a.machine_id
      WHERE a.workspace_id=? AND a.batch_id IN (SELECT id FROM production_batches WHERE workspace_id=?) ORDER BY a.planned_from`, w, w),
    all(db, `SELECT r.* FROM production_runs r WHERE r.workspace_id=?
      AND r.batch_id IN (SELECT id FROM production_batches WHERE workspace_id=?) ORDER BY r.created_at DESC LIMIT 500`, w, w),
    all(db, `SELECT i.* FROM production_inputs i JOIN production_runs r ON r.id=i.run_id
      WHERE r.workspace_id=? AND r.batch_id IN (SELECT id FROM production_batches WHERE workspace_id=?) ORDER BY i.created_at LIMIT 2000`, w, w),
    all(db, `SELECT o.* FROM production_outputs o JOIN production_runs r ON r.id=o.run_id
      WHERE r.workspace_id=? AND r.batch_id IN (SELECT id FROM production_batches WHERE workspace_id=?) ORDER BY o.created_at LIMIT 2000`, w, w),
    all(db, `SELECT f.* FROM fabric_rolls f WHERE f.workspace_id=?
      AND f.batch_id IN (SELECT id FROM production_batches WHERE workspace_id=?) ORDER BY f.created_at LIMIT 2000`, w, w),
    all(db, `SELECT r.* FROM stock_reservations r WHERE r.workspace_id=?
      AND r.batch_id IN (SELECT id FROM production_batches WHERE workspace_id=?) ORDER BY r.created_at DESC LIMIT 1000`, w, w),
    all(db, `SELECT l.id,l.batch,l.quality,p.name AS product_name,p.sku,b.stage,b.grams,b.cartons,b.cones,
        COALESCE((SELECT SUM(r.grams) FROM stock_reservations r WHERE r.lot_id=l.id AND r.stage=b.stage AND r.status='active'),0) AS reserved_grams
      FROM lots l JOIN products p ON p.id=l.product_id JOIN balances b ON b.lot_id=l.id
      WHERE l.workspace_id=? AND l.quality='approved' AND b.grams>0 ORDER BY p.name,l.batch`, w),
  ]);
  const lines = await all(db, `SELECT l.id,l.sales_order_id,l.product_id,l.specifications,l.quantity_milli,l.unit,l.created_at,
      o.reference AS order_reference,o.status AS order_status
    FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id
    WHERE l.workspace_id=? AND o.status='confirmed' ORDER BY l.created_at LIMIT 300`, w);
  return json({
    machines: machines.map(machine => ({
      ...machine,
      capacities: capacities.filter(c => c.machine_id === machine.id),
      downtime: plannedDowntime.filter(d => d.machine_id === machine.id),
    })),
    shifts: shiftRows.map(shift => ({ ...shift, days: JSON.parse(shift.days) })),
    lineOptions: lines.map(line => ({
      ...line,
      batch_planned_milli: batches.filter(b => b.sales_order_line_id === line.id && b.status !== 'cancelled')
        .reduce((n, b) => n + b.planned_quantity_milli, 0),
    })),
    batches: batches.map(batch => ({
      ...batch,
      allocations: allocationRows.filter(a => a.batch_id === batch.id),
      rolls: rolls.filter(r => r.batch_id === batch.id),
      reservations: reservationRows.filter(r => r.batch_id === batch.id),
      runs: runRows.filter(r => r.batch_id === batch.id).map(run => ({
        ...run,
        inputs: inputs.filter(i => i.run_id === run.id),
        outputs: outputs.filter(o => o.run_id === run.id),
      })),
    })),
    materials,
    serverTime: now,
  });
}

export async function productionApi(request, env, member, path, data) {
  if (request.method !== 'GET') {
    const url = new URL(request.url);
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
      fail(403, 'Open Yarnflow directly before saving production entries.');
  }
  if (!['GET', 'POST'].includes(request.method)) fail(405, 'Method not allowed.');
  if (request.method !== 'GET' && data === undefined) fail(415, 'Send JSON as the request body.');
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected. Nothing was saved.');
  const now = Date.now();
  if (path === '/api/erp/production') {
    allowAny(member, OVERVIEW_ROLES, 'open production');
    return overview(db, member.workspace_id, now);
  }
  const w = member.workspace_id;
  if (path.startsWith('/api/erp/production/machines') || path.startsWith('/api/erp/production/shifts')) {
    if (!member.admin) fail(403, 'Only an admin can set up machines, shifts and maintenance calendars.');
    return setupRoutes(db, w, member, path, data, now);
  }
  return memberRoutes(db, w, member, path, data, now);
}
