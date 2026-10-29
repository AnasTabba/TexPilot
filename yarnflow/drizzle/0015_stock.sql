-- Task 11: supervisor inventory, threshold-gated adjustments, stock queries and the report to admin.
-- Runs after 0016/0017/0017b on live (file order is not apply order): it creates only new tables, reads no 0014-0017 object and never touches the currency_change_blockers view.
-- Existing lots, movements and balances are not touched.
CREATE TABLE inventory_adjustments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), lot_id TEXT NOT NULL REFERENCES lots(id),
 stage TEXT NOT NULL CHECK(stage IN ('raw','finished')), kind TEXT NOT NULL CHECK(kind IN ('adjustment','write_off')),
 delta_grams INTEGER NOT NULL CHECK(delta_grams != 0 AND abs(delta_grams) <= 9000000000000), reason TEXT NOT NULL CHECK(length(trim(reason)) >= 5),
 status TEXT NOT NULL CHECK(status IN ('pending_approval','applied','rejected')), source TEXT NOT NULL DEFAULT 'supervisor' CHECK(source IN ('supervisor','stock_issue')),
 compensates_id TEXT, movement_id TEXT REFERENCES movements(id),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER,
 CHECK(kind = 'adjustment' OR delta_grams < 0)
);
CREATE INDEX inventory_adjustments_lot ON inventory_adjustments(lot_id);
CREATE INDEX inventory_adjustments_time ON inventory_adjustments(workspace_id, created_at);

CREATE TRIGGER inventory_adjustment_new BEFORE INSERT ON inventory_adjustments BEGIN
 SELECT RAISE(ABORT, 'lot not in workspace') WHERE NOT EXISTS (SELECT 1 FROM lots WHERE id = NEW.lot_id AND workspace_id = NEW.workspace_id);
 SELECT RAISE(ABORT, 'A compensation refers to an adjustment of the workspace.') WHERE NEW.compensates_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_adjustments WHERE id = NEW.compensates_id AND workspace_id = NEW.workspace_id);
 SELECT RAISE(ABORT, 'A new adjustment is pending or applied with its movement.') WHERE NOT ((NEW.status = 'pending_approval' AND NEW.movement_id IS NULL) OR (NEW.status = 'applied' AND NEW.movement_id IS NOT NULL));
END;
CREATE TRIGGER inventory_adjustment_final BEFORE UPDATE ON inventory_adjustments WHEN OLD.status IN ('applied','rejected')
BEGIN SELECT RAISE(ABORT, 'A decided adjustment is final.'); END;
-- pending_approval -> applied|rejected only (the approvals engine); the terms never change.
CREATE TRIGGER inventory_adjustment_decision BEFORE UPDATE ON inventory_adjustments WHEN OLD.status = 'pending_approval' BEGIN
 SELECT RAISE(ABORT, 'An adjustment keeps its terms.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.lot_id != OLD.lot_id OR NEW.stage != OLD.stage OR NEW.kind != OLD.kind
  OR NEW.delta_grams != OLD.delta_grams OR NEW.reason != OLD.reason OR NEW.source != OLD.source OR NEW.compensates_id IS NOT OLD.compensates_id OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at;
 SELECT RAISE(ABORT, 'Invalid adjustment status change.') WHERE NEW.status = 'pending_approval' OR (NEW.status = 'applied') != (NEW.movement_id IS NOT NULL) OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL;
END;
CREATE TRIGGER inventory_adjustment_no_delete BEFORE DELETE ON inventory_adjustments BEGIN SELECT RAISE(ABORT, 'adjustments cannot be deleted'); END;

CREATE TABLE stock_queries (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), product_id TEXT NOT NULL REFERENCES products(id),
 quantity_milli INTEGER CHECK(quantity_milli IS NULL OR quantity_milli > 0), buyer_rfq_id TEXT REFERENCES buyer_purchase_orders(id),
 question TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','answered')),
 available_grams INTEGER CHECK(available_grams IS NULL OR available_grams >= 0), answer TEXT, answered_by TEXT, answered_at INTEGER,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX stock_queries_status ON stock_queries(workspace_id, status, created_at);
CREATE INDEX stock_queries_asker ON stock_queries(created_by, created_at);
CREATE TRIGGER stock_query_new BEFORE INSERT ON stock_queries BEGIN
 SELECT RAISE(ABORT, 'product not in workspace') WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND workspace_id = NEW.workspace_id);
 SELECT RAISE(ABORT, 'request not in workspace') WHERE NEW.buyer_rfq_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM buyer_purchase_orders WHERE id = NEW.buyer_rfq_id AND workspace_id = NEW.workspace_id);
 SELECT RAISE(ABORT, 'A new query is open.') WHERE NEW.status != 'open' OR NEW.available_grams IS NOT NULL OR NEW.answered_by IS NOT NULL;
END;
CREATE TRIGGER stock_query_final BEFORE UPDATE ON stock_queries WHEN OLD.status = 'answered'
BEGIN SELECT RAISE(ABORT, 'An answered query is final.'); END;
CREATE TRIGGER stock_query_answer BEFORE UPDATE ON stock_queries WHEN OLD.status = 'open' BEGIN
 SELECT RAISE(ABORT, 'A query keeps its question.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.product_id != OLD.product_id OR NEW.question != OLD.question
  OR NEW.quantity_milli IS NOT OLD.quantity_milli OR NEW.buyer_rfq_id IS NOT OLD.buyer_rfq_id OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at;
 SELECT RAISE(ABORT, 'An answer records the available quantity and who gave it.') WHERE NEW.status = 'answered' AND (NEW.available_grams IS NULL OR NEW.answered_by IS NULL OR NEW.answered_at IS NULL);
END;
CREATE TRIGGER stock_query_no_delete BEFORE DELETE ON stock_queries BEGIN SELECT RAISE(ABORT, 'stock queries preserve the audit trail'); END;

CREATE TABLE supervisor_reports (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 period_from INTEGER NOT NULL, period_to INTEGER NOT NULL CHECK(period_to >= period_from), content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 flagged_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(flagged_json)), note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted' CHECK(status = 'submitted'),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX supervisor_reports_time ON supervisor_reports(workspace_id, created_at DESC);
CREATE TRIGGER supervisor_reports_no_update BEFORE UPDATE ON supervisor_reports BEGIN SELECT RAISE(ABORT, 'immutable report'); END;
CREATE TRIGGER supervisor_reports_no_delete BEFORE DELETE ON supervisor_reports BEGIN SELECT RAISE(ABORT, 'immutable report'); END;
