ALTER TABLE erp_audit_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT '';
ALTER TABLE erp_audit_events ADD COLUMN object_type TEXT NOT NULL DEFAULT '';
ALTER TABLE erp_audit_events ADD COLUMN old_json TEXT;
ALTER TABLE erp_audit_events ADD COLUMN new_json TEXT;
ALTER TABLE erp_audit_events ADD COLUMN reason TEXT;
ALTER TABLE erp_audit_events ADD COLUMN intervention_reason TEXT;
ALTER TABLE erp_audit_events ADD COLUMN status TEXT NOT NULL DEFAULT 'recorded' CHECK(status='recorded');
ALTER TABLE erp_audit_events ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE erp_audit_events ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX erp_audit_time ON erp_audit_events(workspace_id, created_at DESC, id DESC);
CREATE TRIGGER erp_audit_reason_required BEFORE INSERT ON erp_audit_events BEGIN
 SELECT RAISE(ABORT,'reason required') WHERE (NEW.action GLOB '*.rejected' OR NEW.action GLOB '*.dismissed' OR NEW.action GLOB '*.held'
   OR NEW.action GLOB '*.suspended' OR NEW.action GLOB '*.cancelled' OR NEW.action GLOB '*.adjusted' OR NEW.action GLOB '*.overridden')
   AND length(trim(COALESCE(NEW.reason,''))) < 5;
 SELECT RAISE(ABORT,'reason required') WHERE NEW.intervention_reason IS NOT NULL AND length(trim(NEW.intervention_reason)) < 5;
END;
