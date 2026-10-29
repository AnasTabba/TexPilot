-- Production module: machines, versioned capacities, shift calendars, buyer-linked
-- batches, machine allocations, actual runs with measured inputs/outputs/downtime,
-- stock reservations, fabric rolls, packing and final QC state.
--
-- The frozen sales_order_lines contract (see docs/plans/erp-expansion/parallel-implementation-plan.md)
-- is owned by 0004_sales.sql, which is applied immediately before this file on the shared
-- branch, so production_batches can hold a hard foreign key to it:
--   sales_orders(id, workspace_id, reference, buyer_id, status, created_at)
--   sales_order_lines(id, workspace_id, sales_order_id, product_id, specifications,
--                     quantity_milli, unit, created_at)
-- Amounts are fixed point in a declared unit (kg/metre/piece); mass stays integer grams.
-- No kg-to-metre conversion is recorded anywhere: both measured quantities are stored as
-- measured, and only where the source measurement exists.

-- ---------------------------------------------------------------------------
-- Reviewed ledger extension (root-approved under conditions).
-- A yarn-to-cloth transformation consumes input lots and produces output lots. The
-- existing action vocabulary has no honest recording for that: labelling consumed stock
-- 'waste' or 'dispatch' would be false reporting, and 'transfer' cannot change the lot.
-- The approved decision extends movements.action with:
--   'consume'  - stock leaves a stage because a production run issued/consumed it.
--   'produce'  - stock enters a stage as measured output of a production run.
-- SQLite cannot alter a CHECK constraint in place, so the movements table is rebuilt.
-- Every row, its foreign keys (workspaces, lots, self-referencing reverses) and every
-- trigger that guards the ledger are preserved; the rebuild keeps the original shape
-- (0000_inventory.sql) with the 0003 tightened QC gate plus consume/produce guards.
-- PRAGMA strategy (root condition 2): D1 wraps migrations transactionally and
-- PRAGMA foreign_keys is a no-op inside a transaction, so the rebuild uses
-- PRAGMA defer_foreign_keys=ON — the D1-documented, transaction-safe way to defer every
-- foreign-key check to the commit that ends the migration transaction.
-- The rehearsal test proves this exact file; the release report states which pragma path
-- was exercised and that end-to-end tests drive both new actions.
-- Tests assert row counts, foreign_key_check and each trigger's behaviour after migration.
-- ---------------------------------------------------------------------------
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE movements_rebuilt (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  lot_id TEXT NOT NULL REFERENCES lots(id),
  action TEXT NOT NULL CHECK(action IN ('receive','dispatch','transfer','waste','reverse','consume','produce')),
  from_stage TEXT, to_stage TEXT,
  grams INTEGER NOT NULL CHECK(grams > 0 AND grams <= 9000000000000),
  cartons INTEGER NOT NULL CHECK(cartons >= 0), cones INTEGER NOT NULL CHECK(cones >= 0),
  note TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
  reverses TEXT UNIQUE REFERENCES movements_rebuilt(id), request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO movements_rebuilt
  SELECT id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at FROM movements;
DROP TABLE movements;
ALTER TABLE movements_rebuilt RENAME TO movements;

CREATE INDEX movements_workspace_time ON movements(workspace_id,created_at DESC,id DESC);
CREATE TRIGGER validate_movement BEFORE INSERT ON movements BEGIN
  SELECT RAISE(ABORT,'lot not in workspace') WHERE NOT EXISTS (
    SELECT 1 FROM lots WHERE id=NEW.lot_id AND workspace_id=NEW.workspace_id
  );
  SELECT RAISE(ABORT,'QC approval required') WHERE (NEW.action='dispatch'
    OR (NEW.action='transfer' AND NEW.from_stage='raw') OR NEW.action='consume')
    AND NOT EXISTS (SELECT 1 FROM lots WHERE id=NEW.lot_id AND quality='approved');
  SELECT RAISE(ABORT,'held lot cannot move') WHERE NEW.action IN ('transfer','consume')
    AND EXISTS (SELECT 1 FROM lots WHERE id=NEW.lot_id AND quality='hold');
  SELECT RAISE(ABORT,'consume must record the stage it leaves') WHERE NEW.action='consume' AND NEW.from_stage IS NULL;
  SELECT RAISE(ABORT,'produce must record the stage it enters') WHERE NEW.action='produce' AND NEW.to_stage IS NULL;
END;
CREATE TRIGGER movements_immutable_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
CREATE TRIGGER movements_immutable_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;

-- Re-enable foreign keys for local (non-transactional) sessions; harmless no-op inside D1's transaction.
PRAGMA foreign_keys=ON;
-- deferring ends with the migration transaction; the explicit reset keeps local sqlite sessions clean.
PRAGMA defer_foreign_keys=OFF;

-- Admin-owned master data -------------------------------------------------------

CREATE TABLE machines (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('spinning','weaving','winding','dyeing','finishing')),
  operations TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id,name)
);
CREATE TABLE machine_capacities (
  -- Immutable snapshots referenced by allocations; planning always points at the
  -- version that was current when it was made, so later rate changes never rewrite history.
  id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES machines(id),
  version INTEGER NOT NULL, unit TEXT NOT NULL CHECK(unit IN ('kg','metre','piece')),
  rate_milli_per_hour INTEGER NOT NULL CHECK(rate_milli_per_hour > 0),
  note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(machine_id,version)
);
CREATE TABLE shifts (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL, start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
  -- Weekend/week patterns in Asia/Karachi factory time: ISO day numbers 1..7 (1=Monday).
  days TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(workspace_id,name)
);
CREATE TABLE machine_downtimes (
  -- Planned maintenance announced by admin; actual shift downtime is recorded per run below.
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  machine_id TEXT NOT NULL REFERENCES machines(id), from_at INTEGER NOT NULL,
  to_at INTEGER NOT NULL CHECK(to_at > from_at), reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','cancelled')),
  cancel_reason TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX machine_downtimes_machine ON machine_downtimes(machine_id);

-- Buyer-linked batches ----------------------------------------------------------
-- One batch belongs to one confirmed sales order line for the first release. The line
-- keeps its own buyer/order backlinks (owned by the sales module); the batch never
-- duplicates an order system. Lifecycle (guarded in server/production.mjs):
-- accepted -> planned -> in_production -> packing -> completed
-- plus hold/resume, cancel (only before consumption) and post-completion rework.
-- 'partially_dispatched'/'dispatched' stay reserved for the sales module.
CREATE TABLE production_batches (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  reference TEXT NOT NULL, sales_order_line_id TEXT NOT NULL REFERENCES sales_order_lines(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  operation TEXT NOT NULL CHECK(operation IN ('spinning','weaving','winding','dyeing','finishing')),
  planned_quantity_milli INTEGER NOT NULL CHECK(planned_quantity_milli > 0),
  unit TEXT NOT NULL CHECK(unit IN ('kg','metre','piece')),
  specifications TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  due_at INTEGER NOT NULL, hold_reason TEXT NOT NULL DEFAULT '', previous_status TEXT,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN
    ('accepted','planned','in_production','packing','completed','partially_dispatched','dispatched','hold','cancelled')),
  request_hash TEXT NOT NULL, created_by TEXT NOT NULL,
  completed_at INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(workspace_id,reference)
);
-- Cross-workspace leak guard (0003 goods-receipt trigger pattern, reviewer-added gate):
-- the sales order line and the product behind a batch must live in the same workspace.
CREATE TRIGGER validate_batch_line BEFORE INSERT ON production_batches BEGIN
  SELECT RAISE(ABORT,'sales order line not in workspace') WHERE NOT EXISTS (
    SELECT 1 FROM sales_order_lines l WHERE l.id=NEW.sales_order_line_id AND l.workspace_id=NEW.workspace_id
  );
  SELECT RAISE(ABORT,'product not in workspace') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.workspace_id=NEW.workspace_id
  );
END;
CREATE TRIGGER batches_no_delete BEFORE DELETE ON production_batches BEGIN SELECT RAISE(ABORT,'production batch history is kept'); END;
CREATE INDEX production_batches_line ON production_batches(sales_order_line_id);
CREATE TABLE production_counters (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id), prefix TEXT NOT NULL,
  last INTEGER NOT NULL CHECK(last > 0), created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,prefix)
);

-- Machine allocations: overlap-safe planning -------------------------------------
CREATE TABLE machine_allocations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  batch_id TEXT NOT NULL REFERENCES production_batches(id),
  machine_id TEXT NOT NULL REFERENCES machines(id), shift_id TEXT REFERENCES shifts(id),
  capacity_version_id TEXT REFERENCES machine_capacities(id),
  planned_from INTEGER NOT NULL, planned_to INTEGER NOT NULL CHECK(planned_to > planned_from),
  quantity_planned_milli INTEGER NOT NULL CHECK(quantity_planned_milli > 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','started','completed','cancelled')),
  cancel_reason TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX machine_allocations_machine ON machine_allocations(machine_id,planned_from);
CREATE INDEX machine_allocations_batch ON machine_allocations(batch_id);

-- Reservations reduce availability without touching balances ---------------------
CREATE TABLE stock_reservations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  batch_id TEXT NOT NULL REFERENCES production_batches(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), stage TEXT NOT NULL CHECK(stage IN ('raw','wip','finished','cops')),
  grams INTEGER NOT NULL CHECK(grams > 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','consumed','released')),
  released_reason TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX stock_reservations_live ON stock_reservations(lot_id,stage,status);

-- Actual runs --------------------------------------------------------------------
CREATE TABLE production_runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  batch_id TEXT NOT NULL REFERENCES production_batches(id),
  allocation_id TEXT REFERENCES machine_allocations(id),
  seq INTEGER NOT NULL CHECK(seq > 0), label TEXT NOT NULL,
  rework INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
  consumed_grams INTEGER, output_grams INTEGER, loss_grams INTEGER, loss_metres INTEGER,
  note TEXT NOT NULL DEFAULT '', request_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  started_at INTEGER NOT NULL, completed_at INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(batch_id,seq)
);
CREATE TABLE production_inputs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES production_runs(id),
  movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), stage TEXT NOT NULL CHECK(stage IN ('raw','wip','finished','cops')),
  grams INTEGER NOT NULL CHECK(grams > 0), cones INTEGER NOT NULL DEFAULT 0 CHECK(cones >= 0),
  cartons INTEGER NOT NULL DEFAULT 0 CHECK(cartons >= 0), reservation_id TEXT REFERENCES stock_reservations(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE production_outputs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES production_runs(id),
  movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), product_id TEXT NOT NULL REFERENCES products(id),
  grams INTEGER NOT NULL CHECK(grams > 0), metres INTEGER,
  pieces INTEGER, to_stage TEXT NOT NULL CHECK(to_stage IN ('raw','wip','finished','cops')),
  created_at INTEGER NOT NULL
);
CREATE TABLE downtime_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES production_runs(id), machine_id TEXT REFERENCES machines(id),
  from_at INTEGER NOT NULL, to_at INTEGER NOT NULL CHECK(to_at > from_at),
  reason TEXT NOT NULL, actor_name TEXT NOT NULL, created_at INTEGER NOT NULL
);

-- Fabric rolls, packing -----------------------------------------------------------
CREATE TABLE fabric_rolls (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  batch_id TEXT NOT NULL REFERENCES production_batches(id), lot_id TEXT NOT NULL REFERENCES lots(id),
  run_id TEXT NOT NULL REFERENCES production_runs(id),
  metres INTEGER NOT NULL CHECK(metres > 0), grams INTEGER NOT NULL CHECK(grams > 0),
  width_mm INTEGER NOT NULL CHECK(width_mm > 0), gsm INTEGER NOT NULL CHECK(gsm > 0),
  result TEXT NOT NULL DEFAULT 'pending' CHECK(result IN ('pending','passed','failed')),
  disposition TEXT NOT NULL DEFAULT 'unpacked' CHECK(disposition IN ('unpacked','packed','packed_rework','scrap')),
  package_id TEXT, inspection_note TEXT NOT NULL DEFAULT '', inspected_by TEXT, inspected_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX fabric_rolls_batch ON fabric_rolls(batch_id);
-- A roll must never certify another workspace's stock.
CREATE TRIGGER validate_fabric_roll BEFORE INSERT ON fabric_rolls BEGIN
  SELECT RAISE(ABORT,'roll lot not in workspace') WHERE NOT EXISTS (
    SELECT 1 FROM lots l WHERE l.id=NEW.lot_id AND l.workspace_id=NEW.workspace_id
  );
END;
CREATE TABLE production_packages (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  batch_id TEXT NOT NULL REFERENCES production_batches(id),
  code TEXT NOT NULL, request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX production_packages_batch ON production_packages(batch_id);

-- Ledger rails --------------------------------------------------------------------
CREATE TRIGGER production_inputs_immutable_update BEFORE UPDATE ON production_inputs BEGIN SELECT RAISE(ABORT,'immutable issue record'); END;
CREATE TRIGGER production_inputs_immutable_delete BEFORE DELETE ON production_inputs BEGIN SELECT RAISE(ABORT,'immutable issue record'); END;
CREATE TRIGGER production_outputs_immutable_update BEFORE UPDATE ON production_outputs BEGIN SELECT RAISE(ABORT,'immutable output record'); END;
CREATE TRIGGER production_outputs_immutable_delete BEFORE DELETE ON production_outputs BEGIN SELECT RAISE(ABORT,'immutable output record'); END;
CREATE TRIGGER roll_measures_immutable BEFORE UPDATE ON fabric_rolls
WHEN NEW.grams!=OLD.grams OR NEW.metres!=OLD.metres OR NEW.width_mm!=OLD.width_mm OR NEW.gsm!=OLD.gsm
BEGIN SELECT RAISE(ABORT,'measured roll quantities are immutable'); END;
CREATE TRIGGER roll_inspected_once BEFORE UPDATE ON fabric_rolls
WHEN OLD.result!='pending' AND NEW.result!=OLD.result
BEGIN SELECT RAISE(ABORT,'a roll inspection outcome cannot change afterwards'); END;
CREATE TRIGGER productions_runs_no_update_label BEFORE UPDATE ON production_runs
WHEN NEW.label!=OLD.label
BEGIN SELECT RAISE(ABORT,'run labels are immutable'); END;
