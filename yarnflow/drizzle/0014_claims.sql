-- Task 10: supervisor review, escalation and partial claims.
-- Runs after 0017/0017b on live (file order is not apply order), so it reads only 0013 tables and never touches the currency_change_blockers view.
-- Existing lots keep NULL metadata; only lots created from a QC report carry inventory_type and source.
ALTER TABLE lots ADD COLUMN inventory_type TEXT CHECK(inventory_type IS NULL OR inventory_type IN ('raw','finished'));
ALTER TABLE lots ADD COLUMN source TEXT CHECK(source IS NULL OR source IN ('qc_lot','production'));
CREATE TABLE claims (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), lot_id TEXT NOT NULL REFERENCES qc_lots(id),
 inspection_id TEXT NOT NULL UNIQUE REFERENCES qc_inspections(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 purchase_order_id TEXT NOT NULL REFERENCES supplier_purchase_orders(id),
 rejected_milli INTEGER NOT NULL CHECK(rejected_milli > 0), po_rate_minor INTEGER NOT NULL CHECK(po_rate_minor >= 0), calculated_minor INTEGER NOT NULL CHECK(calculated_minor >= 0),
 adjusted_minor INTEGER CHECK(adjusted_minor IS NULL OR adjusted_minor >= 0), outcome TEXT CHECK(outcome IS NULL OR outcome IN ('return','replacement','claim')), adjust_reason TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending_approval','open','decided','rejected')),
 decided_by TEXT, decided_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX claims_status ON claims(workspace_id, status);
CREATE INDEX claims_supplier ON claims(supplier_id, status);

-- A claim exists only for a confirmed rejection of the same lot and quantity, and starts undecided.
CREATE TRIGGER validate_claim BEFORE INSERT ON claims BEGIN
 SELECT RAISE(ABORT, 'A claim needs a confirmed rejection.') WHERE NOT EXISTS (
  SELECT 1 FROM qc_inspections WHERE id = NEW.inspection_id AND workspace_id = NEW.workspace_id AND lot_id = NEW.lot_id AND rejection_status = 'confirmed' AND rejected_milli = NEW.rejected_milli);
 SELECT RAISE(ABORT, 'A new claim is undecided.') WHERE NEW.status NOT IN ('pending_approval','open') OR NEW.outcome IS NOT NULL OR NEW.adjusted_minor IS NOT NULL OR NEW.adjust_reason IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL;
END;
CREATE TRIGGER claims_final BEFORE UPDATE ON claims WHEN OLD.status IN ('decided','rejected')
BEGIN SELECT RAISE(ABORT, 'A decided claim is final.'); END;
CREATE TRIGGER claims_amount_immutable BEFORE UPDATE ON claims
WHEN NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.lot_id != OLD.lot_id OR NEW.inspection_id != OLD.inspection_id OR NEW.supplier_id != OLD.supplier_id OR NEW.purchase_order_id != OLD.purchase_order_id
 OR NEW.calculated_minor != OLD.calculated_minor OR NEW.rejected_milli != OLD.rejected_milli OR NEW.po_rate_minor != OLD.po_rate_minor OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT, 'A claim keeps its amount terms.'); END;
-- pending_approval -> open|rejected (the approvals engine), open -> decided (the admin). A repeated or stale decision aborts the whole batch behind it.
CREATE TRIGGER claims_transitions BEFORE UPDATE ON claims BEGIN
 SELECT RAISE(ABORT, 'Invalid claim status change.') WHERE NEW.status != OLD.status AND NOT ((OLD.status = 'pending_approval' AND NEW.status IN ('open','rejected')) OR (OLD.status = 'open' AND NEW.status = 'decided'));
 SELECT RAISE(ABORT, 'A decided claim records its outcome.') WHERE (NEW.status = 'decided') != (NEW.outcome IS NOT NULL AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL);
END;
CREATE TRIGGER claims_adjust_reason BEFORE UPDATE ON claims
WHEN NEW.adjusted_minor IS NOT NULL AND NEW.adjusted_minor != NEW.calculated_minor AND length(trim(COALESCE(NEW.adjust_reason, ''))) < 5
BEGIN SELECT RAISE(ABORT, 'reason required'); END;
CREATE TRIGGER claims_no_delete BEFORE DELETE ON claims BEGIN SELECT RAISE(ABORT, 'claims preserve the audit trail'); END;
