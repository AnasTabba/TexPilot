CREATE TABLE approval_requests (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 type TEXT NOT NULL CHECK(type IN ('purchase_award','po_change','inventory_adjustment','claim','dispatch_stock_issue','escalation')),
 object_type TEXT NOT NULL, object_id TEXT NOT NULL,
 amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(amount)='integer'),
 threshold INTEGER CHECK(threshold IS NULL OR (typeof(threshold)='integer' AND threshold>=0)),
 unit TEXT NOT NULL CHECK(unit IN ('minor','grams','none')),
 currency TEXT,
 payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json) AND json_type(payload_json)='object'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL, requested_role TEXT NOT NULL,
 created_by TEXT NOT NULL CHECK(created_by=requested_by),
 decided_by TEXT, reason TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_at INTEGER,
 CHECK((unit='minor' AND currency IN ('PKR','USD','EUR','GBP') AND currency IS NOT NULL) OR (unit!='minor' AND currency IS NULL))
);
CREATE UNIQUE INDEX approval_one_pending ON approval_requests(object_type,object_id) WHERE status='pending';
CREATE INDEX approval_workspace_status ON approval_requests(workspace_id,status,created_at);
CREATE TRIGGER approval_decided_once BEFORE UPDATE ON approval_requests
WHEN OLD.status!='pending' BEGIN SELECT RAISE(ABORT,'approval already decided'); END;
CREATE TRIGGER approval_terms_immutable BEFORE UPDATE ON approval_requests
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.type IS NOT OLD.type
 OR NEW.object_type IS NOT OLD.object_type OR NEW.object_id IS NOT OLD.object_id
 OR NEW.amount IS NOT OLD.amount OR NEW.threshold IS NOT OLD.threshold OR NEW.unit IS NOT OLD.unit
 OR NEW.currency IS NOT OLD.currency OR NEW.payload_json IS NOT OLD.payload_json
 OR NEW.requested_by IS NOT OLD.requested_by OR NEW.requested_role IS NOT OLD.requested_role
 OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'approval terms are immutable'); END;
CREATE TRIGGER approval_reject_reason BEFORE UPDATE ON approval_requests
WHEN NEW.status='rejected' AND length(trim(COALESCE(NEW.reason,'')))<5
BEGIN SELECT RAISE(ABORT,'reason required'); END;
CREATE TRIGGER approval_no_delete BEFORE DELETE ON approval_requests
BEGIN SELECT RAISE(ABORT,'approval requests cannot be deleted'); END;
