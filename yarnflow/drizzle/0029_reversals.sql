-- 0029_reversals.sql: undo and void records. Additive only: no existing row changes and no ledger row is edited.
-- Reversals are new compensating movements (movements.reverses, unique per original). This file adds the
-- records that link them to their reasons, lets a dispatched batch go back to approved (only with a reversal
-- row), records voids of answered stock queries and submitted reports, and lets a corrected report name the voided one.

CREATE TABLE dispatch_reversals (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  sales_dispatch_id TEXT NOT NULL UNIQUE REFERENCES sales_dispatches(id),
  movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id),
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 3), actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER dispatch_reversal_entered BEFORE INSERT ON dispatch_reversals BEGIN
  SELECT RAISE(ABORT, 'A reversal refers to a dispatch of the workspace.') WHERE NOT EXISTS (SELECT 1 FROM dispatches WHERE id = NEW.dispatch_id AND workspace_id = NEW.workspace_id);
  SELECT RAISE(ABORT, 'A dispatch reversal undoes its own sale dispatch.') WHERE NOT EXISTS (
    SELECT 1 FROM movements m JOIN sales_dispatches s ON s.movement_id = m.reverses
    WHERE m.id = NEW.movement_id AND s.id = NEW.sales_dispatch_id AND s.workspace_id = NEW.workspace_id);
END;
CREATE TRIGGER dispatch_reversals_no_update BEFORE UPDATE ON dispatch_reversals BEGIN SELECT RAISE(ABORT, 'immutable dispatch reversal'); END;
CREATE TRIGGER dispatch_reversals_no_delete BEFORE DELETE ON dispatch_reversals BEGIN SELECT RAISE(ABORT, 'immutable dispatch reversal'); END;
--> statement-breakpoint
-- A dispatched batch that has not been delivered may return to approved, and only with its reversal row written first in the same batch.
DROP TRIGGER dispatch_status_flow;
CREATE TRIGGER dispatch_status_flow BEFORE UPDATE ON dispatches
WHEN OLD.status != NEW.status OR NEW.hold_reason IS NOT OLD.hold_reason OR NEW.vehicle IS NOT OLD.vehicle
 OR NEW.transporter IS NOT OLD.transporter OR NEW.delivery_proof IS NOT OLD.delivery_proof
 OR NEW.sales_dispatch_id IS NOT OLD.sales_dispatch_id OR NEW.dispatched_at IS NOT OLD.dispatched_at
 OR NEW.delivered_at IS NOT OLD.delivered_at
BEGIN
  SELECT RAISE(ABORT, 'Invalid dispatch status change.') WHERE NOT (
    (OLD.status = 'pending_approval' AND NEW.status = 'approved' AND NEW.hold_reason IS OLD.hold_reason
      AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter AND NEW.delivery_proof = OLD.delivery_proof
      AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'pending_approval' AND NEW.status = 'on_hold'
      AND length(trim(COALESCE(NEW.hold_reason,''))) >= 5 AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter
      AND NEW.delivery_proof = OLD.delivery_proof AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id
      AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'approved' AND NEW.status = 'on_hold'
      AND length(trim(COALESCE(NEW.hold_reason,''))) >= 5 AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter
      AND NEW.delivery_proof = OLD.delivery_proof AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id
      AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'approved' AND NEW.status = 'dispatched' AND NEW.hold_reason IS OLD.hold_reason
      AND NEW.sales_dispatch_id IS NOT NULL AND NEW.dispatched_at IS NOT NULL AND NEW.delivered_at IS OLD.delivered_at
      AND OLD.delivery_proof = '')
   OR (OLD.status = 'on_hold' AND NEW.status = 'pending_approval' AND NEW.hold_reason IS OLD.hold_reason
      AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter AND NEW.delivery_proof = OLD.delivery_proof
      AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id AND NEW.dispatched_at IS OLD.dispatched_at
      AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'dispatched' AND NEW.status = 'delivered' AND NEW.delivered_at IS NOT NULL
      AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id
      AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.hold_reason IS OLD.hold_reason)
   OR (OLD.status = 'dispatched' AND NEW.status = 'approved' AND NEW.sales_dispatch_id IS NULL AND NEW.dispatched_at IS NULL
      AND NEW.delivered_at IS NULL AND NEW.hold_reason IS OLD.hold_reason AND NEW.vehicle = OLD.vehicle
      AND NEW.transporter = OLD.transporter AND NEW.delivery_proof = OLD.delivery_proof
      AND EXISTS (SELECT 1 FROM dispatch_reversals r WHERE r.dispatch_id = OLD.id AND r.sales_dispatch_id = OLD.sales_dispatch_id))
  );
END;
--> statement-breakpoint
CREATE TABLE stock_query_voids (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  query_id TEXT NOT NULL UNIQUE REFERENCES stock_queries(id),
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 3), voided_by TEXT NOT NULL, voided_at INTEGER NOT NULL
);
CREATE TRIGGER stock_query_void_entered BEFORE INSERT ON stock_query_voids BEGIN
  SELECT RAISE(ABORT, 'Only an answered stock query can be voided.') WHERE NOT EXISTS (
    SELECT 1 FROM stock_queries WHERE id = NEW.query_id AND workspace_id = NEW.workspace_id AND status = 'answered');
END;
CREATE TRIGGER stock_query_voids_no_update BEFORE UPDATE ON stock_query_voids BEGIN SELECT RAISE(ABORT, 'immutable void'); END;
CREATE TRIGGER stock_query_voids_no_delete BEFORE DELETE ON stock_query_voids BEGIN SELECT RAISE(ABORT, 'immutable void'); END;
--> statement-breakpoint
CREATE TABLE supervisor_report_voids (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  report_id TEXT NOT NULL UNIQUE REFERENCES supervisor_reports(id),
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 3), voided_by TEXT NOT NULL, voided_at INTEGER NOT NULL
);
CREATE TRIGGER supervisor_report_void_entered BEFORE INSERT ON supervisor_report_voids BEGIN
  SELECT RAISE(ABORT, 'A void refers to a report of the workspace.') WHERE NOT EXISTS (
    SELECT 1 FROM supervisor_reports WHERE id = NEW.report_id AND workspace_id = NEW.workspace_id);
END;
CREATE TRIGGER supervisor_report_voids_no_update BEFORE UPDATE ON supervisor_report_voids BEGIN SELECT RAISE(ABORT, 'immutable void'); END;
CREATE TRIGGER supervisor_report_voids_no_delete BEFORE DELETE ON supervisor_report_voids BEGIN SELECT RAISE(ABORT, 'immutable void'); END;
--> statement-breakpoint
-- A corrected report names the voided report it replaces (one correction per voided report).
-- Kept in its own table so this file needs nothing from 0015 beyond the foreign keys it may be ordered before.
CREATE TABLE supervisor_report_corrections (
  report_id TEXT PRIMARY KEY REFERENCES supervisor_reports(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  supersedes_id TEXT NOT NULL UNIQUE REFERENCES supervisor_reports(id), created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  CHECK(report_id != supersedes_id)
);
CREATE TRIGGER supervisor_report_correction_entered BEFORE INSERT ON supervisor_report_corrections BEGIN
  SELECT RAISE(ABORT, 'Only a voided report can be corrected.') WHERE NOT EXISTS (
    SELECT 1 FROM supervisor_report_voids v WHERE v.report_id = NEW.supersedes_id AND v.workspace_id = NEW.workspace_id);
END;
CREATE TRIGGER supervisor_report_corrections_no_update BEFORE UPDATE ON supervisor_report_corrections BEGIN SELECT RAISE(ABORT, 'immutable correction'); END;
CREATE TRIGGER supervisor_report_corrections_no_delete BEFORE DELETE ON supervisor_report_corrections BEGIN SELECT RAISE(ABORT, 'immutable correction'); END;
