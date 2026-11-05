-- Reversible QC corrections: cancel an arrival, edit or delete drafts, reopen a submitted inspection, undo a reviewer decision, void a draft photo.
-- Additive except the narrowed guards below. Every narrowing allows one correction and keeps every other rule of 0013 in force.
-- Corrections keep their history in qc_corrections (kind, target, reason, actor). Nothing a decision depends on is ever deleted.

CREATE TABLE qc_corrections (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 kind TEXT NOT NULL CHECK(kind IN ('lot_cancelled','inspection_reopened','decision_undone','photo_voided')),
 target_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason)) >= 3 AND length(reason) <= 500),
 detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),
 actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX qc_corrections_target ON qc_corrections(kind, target_id);
CREATE TRIGGER qc_corrections_immutable BEFORE UPDATE ON qc_corrections BEGIN SELECT RAISE(ABORT, 'corrections preserve the audit trail'); END;
CREATE TRIGGER qc_corrections_no_delete BEFORE DELETE ON qc_corrections BEGIN SELECT RAISE(ABORT, 'corrections preserve the audit trail'); END;

-- The purchase order status an arrival replaced with 'received', so cancelling the arrival can put it back. NULL for arrivals before this migration.
ALTER TABLE qc_lots ADD COLUMN po_status_before TEXT CHECK(po_status_before IS NULL OR po_status_before IN ('accepted','dispatched'));

-- A cancelled arrival stops counting: it leaves the PO's arrived quantity and has no open quantity. Its row stays for history.
DROP VIEW po_arrived;
CREATE VIEW po_arrived AS SELECT p.id AS order_id,
 COALESCE((SELECT SUM(l.quantity_milli) FROM qc_lots l WHERE l.purchase_order_id = p.id
   AND NOT EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind = 'lot_cancelled' AND c.target_id = l.id)), 0)
 + COALESCE((SELECT SUM(g.quantity_milli) FROM goods_receipts g WHERE g.purchase_order_id = p.id AND NOT EXISTS(SELECT 1 FROM receipt_reversals r WHERE r.receipt_id = g.id)), 0) AS arrived_milli
FROM supplier_purchase_orders p;
DROP VIEW qc_lot_open;
CREATE VIEW qc_lot_open AS SELECT l.id AS lot_id,
 CASE WHEN EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind = 'lot_cancelled' AND c.target_id = l.id) THEN 0 ELSE l.quantity_milli - COALESCE((SELECT SUM(
  CASE WHEN i.status = 'draft' OR i.report_status IN ('pending','accepted') THEN i.accepted_milli ELSE 0 END
  + CASE WHEN i.status = 'draft' OR i.rejection_status IN ('pending','confirmed','escalated') OR (i.rejection_status = 'dismissed' AND i.dismiss_outcome = 'accept_with_deviation') THEN i.rejected_milli ELSE 0 END)
 FROM qc_inspections i WHERE i.lot_id = l.id), 0) END AS open_milli
FROM qc_lots l;

-- A cancelled arrival releases its lot reference (the unique key) by renaming it once, and nothing else about the arrival changes.
DROP TRIGGER qc_lot_frozen;
CREATE TRIGGER qc_lot_frozen BEFORE UPDATE ON qc_lots
WHEN NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.purchase_order_id != OLD.purchase_order_id OR NEW.shipment_id != OLD.shipment_id
 OR NEW.supplier_id != OLD.supplier_id OR NEW.product_id != OLD.product_id OR NEW.quantity_milli != OLD.quantity_milli
 OR NEW.unit != OLD.unit OR NEW.supplier_lot != OLD.supplier_lot OR NEW.arrived_at != OLD.arrived_at OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at
 OR NEW.po_status_before IS NOT OLD.po_status_before
BEGIN SELECT RAISE(ABORT, 'a registered lot keeps its arrival record'); END;
CREATE TRIGGER qc_lot_reference_release BEFORE UPDATE OF reference ON qc_lots
WHEN NEW.reference != OLD.reference
BEGIN SELECT RAISE(ABORT, 'a registered lot keeps its arrival record') WHERE NOT (NEW.reference = 'cancelled:' || OLD.id || ':' || OLD.reference
 AND EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind = 'lot_cancelled' AND c.target_id = OLD.id)); END;

-- Drafts only: an inspection, its issues and its photos can be deleted while they are still drafts. Submitted rows stay forever.
DROP TRIGGER qc_inspection_no_delete;
CREATE TRIGGER qc_inspection_no_delete BEFORE DELETE ON qc_inspections WHEN OLD.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'inspections preserve the audit trail'); END;
DROP TRIGGER qc_issue_no_delete;
CREATE TRIGGER qc_issue_no_delete BEFORE DELETE ON qc_issues WHEN NOT EXISTS(SELECT 1 FROM qc_inspections WHERE id = OLD.inspection_id AND status = 'draft')
BEGIN SELECT RAISE(ABORT, 'issues preserve the audit trail'); END;
DROP TRIGGER qc_photo_no_delete;
CREATE TRIGGER qc_photo_no_delete BEFORE DELETE ON qc_photos WHEN NOT EXISTS(SELECT 1 FROM qc_inspections i WHERE i.status = 'draft'
 AND i.id = COALESCE(OLD.inspection_id, (SELECT x.inspection_id FROM qc_issues x WHERE x.id = OLD.issue_id)))
BEGIN SELECT RAISE(ABORT, 'immutable photo'); END;

-- Drafts only: issue evidence may change while the inspection is a draft. Once submitted it is frozen as before.
-- Issue status moves back to open only while the rejection is pending again (an undone decision, applied after the inspection row in the same batch).
DROP TRIGGER qc_issue_transitions;
CREATE TRIGGER qc_issue_transitions BEFORE UPDATE ON qc_issues BEGIN
 SELECT RAISE(ABORT, 'Issue evidence is frozen.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.inspection_id != OLD.inspection_id
  OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at
  OR ((NEW.type != OLD.type OR NEW.severity != OLD.severity OR NEW.description != OLD.description) AND NOT EXISTS(SELECT 1 FROM qc_inspections WHERE id = OLD.inspection_id AND status = 'draft'));
 SELECT RAISE(ABORT, 'Invalid issue status change.') WHERE NEW.status != OLD.status AND NOT COALESCE(
  (OLD.status = 'open' AND NEW.status IN ('confirmed','dismissed','escalated') AND EXISTS(SELECT 1 FROM qc_inspections WHERE id = OLD.inspection_id AND status = 'submitted'))
  OR (OLD.status = 'escalated' AND NEW.status IN ('confirmed','dismissed') AND EXISTS(SELECT 1 FROM qc_inspections WHERE id = OLD.inspection_id AND status = 'submitted'))
  OR (OLD.status IN ('confirmed','dismissed','escalated') AND NEW.status = 'open' AND EXISTS(SELECT 1 FROM qc_inspections i WHERE i.id = OLD.inspection_id AND i.status = 'submitted' AND i.rejection_status = 'pending'
      AND EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind = 'decision_undone' AND c.target_id = i.id AND c.created_at >= i.updated_at))), 0);
 SELECT RAISE(ABORT, 'Invalid issue status change.') WHERE NEW.status = OLD.status AND NOT (
  (NEW.type != OLD.type OR NEW.severity != OLD.severity OR NEW.description != OLD.description) AND EXISTS(SELECT 1 FROM qc_inspections WHERE id = OLD.inspection_id AND status = 'draft'));
END;

-- Inspection graph with the corrections added. Forward moves are as in 0013. Backward moves:
--   submitted -> draft (reopen) while both sides are still pending; decided report accepted|returned -> pending and rejection confirmed|dismissed -> pending (undo).
-- Photos voided by a correction do not count as evidence. Draft quantities may change within the uninspected quantity.
DROP TRIGGER qc_inspection_transitions;
CREATE TRIGGER qc_inspection_transitions BEFORE UPDATE ON qc_inspections BEGIN
 SELECT RAISE(ABORT, 'An inspection keeps its lot and author.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.lot_id != OLD.lot_id OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at;
 SELECT RAISE(ABORT, 'A submitted inspection keeps its quantities.') WHERE OLD.status = 'submitted' AND (
  (NEW.status = 'submitted' AND (NEW.accepted_milli != OLD.accepted_milli OR NEW.rejected_milli != OLD.rejected_milli OR NEW.note != OLD.note OR NEW.submitted_at IS NOT OLD.submitted_at))
  OR (NEW.status != 'submitted' AND NOT (NEW.status = 'draft' AND NEW.report_status IS NULL AND NEW.rejection_status IS NULL AND NEW.submitted_at IS NULL AND NEW.dismiss_outcome IS NULL
      AND NEW.report_reason IS NULL AND NEW.rejection_reason IS NULL AND NEW.decided_by IS NULL AND NEW.decided_at IS NULL)));
 SELECT RAISE(ABORT, 'A draft inspection cannot hold a decision.') WHERE OLD.status = 'draft' AND NEW.status = 'draft' AND (NEW.report_status IS NOT NULL OR NEW.rejection_status IS NOT NULL
  OR NEW.dismiss_outcome IS NOT NULL OR NEW.report_reason IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.submitted_at IS NOT NULL);
 SELECT RAISE(ABORT, 'More than the uninspected quantity.') WHERE NEW.status = 'draft'
  AND NEW.accepted_milli + NEW.rejected_milli > (SELECT open_milli FROM qc_lot_open WHERE lot_id = OLD.lot_id) + OLD.accepted_milli + OLD.rejected_milli;
 SELECT RAISE(ABORT, 'Quantities are frozen on submission.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND (NEW.accepted_milli != OLD.accepted_milli OR NEW.rejected_milli != OLD.rejected_milli OR NEW.note != OLD.note);
 SELECT RAISE(ABORT, 'Upload at least one photo of the accepted quantity.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.accepted_milli > 0
  AND NOT EXISTS (SELECT 1 FROM qc_photos p WHERE p.inspection_id = OLD.id AND NOT EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind = 'photo_voided' AND c.target_id = p.id));
 SELECT RAISE(ABORT, 'Describe at least one issue for the rejected quantity.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.rejected_milli > 0 AND NOT EXISTS (SELECT 1 FROM qc_issues WHERE inspection_id = OLD.id);
 SELECT RAISE(ABORT, 'A submission starts each side pending.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND (
  NEW.report_status IS NOT CASE WHEN NEW.accepted_milli > 0 THEN 'pending' END OR NEW.rejection_status IS NOT CASE WHEN NEW.rejected_milli > 0 THEN 'pending' END
  OR NEW.dismiss_outcome IS NOT NULL OR NEW.report_reason IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.submitted_at IS NULL);
 SELECT RAISE(ABORT, 'Only an undecided inspection can be reopened.') WHERE OLD.status = 'submitted' AND NEW.status = 'draft'
  AND (COALESCE(OLD.report_status, 'pending') != 'pending' OR COALESCE(OLD.rejection_status, 'pending') != 'pending');
 SELECT RAISE(ABORT, 'This inspection was already submitted or decided.') WHERE OLD.status = 'submitted' AND NEW.status = 'submitted' AND NEW.report_status IS OLD.report_status
  AND NEW.rejection_status IS OLD.rejection_status AND NEW.dismiss_outcome IS OLD.dismiss_outcome;
 SELECT RAISE(ABORT, 'Invalid report decision.') WHERE NEW.report_status IS NOT OLD.report_status AND NOT COALESCE(
  (OLD.status = 'draft' AND NEW.status = 'submitted' AND OLD.report_status IS NULL AND NEW.report_status = 'pending')
  OR (OLD.status = 'submitted' AND NEW.status = 'submitted' AND ((OLD.report_status = 'pending' AND NEW.report_status IN ('accepted','returned'))
      OR (OLD.report_status IN ('accepted','returned') AND NEW.report_status = 'pending')))
  OR (OLD.status = 'submitted' AND NEW.status = 'draft' AND OLD.report_status = 'pending' AND NEW.report_status IS NULL), 0);
 SELECT RAISE(ABORT, 'Invalid rejection decision.') WHERE NEW.rejection_status IS NOT OLD.rejection_status AND NOT COALESCE(
  (OLD.status = 'draft' AND NEW.status = 'submitted' AND OLD.rejection_status IS NULL AND NEW.rejection_status = 'pending')
  OR (OLD.status = 'submitted' AND NEW.status = 'submitted' AND ((OLD.rejection_status = 'pending' AND NEW.rejection_status IN ('confirmed','dismissed','escalated'))
      OR (OLD.rejection_status = 'escalated' AND NEW.rejection_status IN ('confirmed','dismissed'))
      OR (OLD.rejection_status IN ('confirmed','dismissed') AND NEW.rejection_status = 'pending')))
  OR (OLD.status = 'submitted' AND NEW.status = 'draft' AND OLD.rejection_status = 'pending' AND NEW.rejection_status IS NULL), 0);
 SELECT RAISE(ABORT, 'A dismissal records its outcome.') WHERE OLD.status = 'submitted' AND NEW.status = 'submitted' AND ((COALESCE(NEW.rejection_status = 'dismissed', 0) != (NEW.dismiss_outcome IS NOT NULL))
  OR (NEW.dismiss_outcome IS NOT OLD.dismiss_outcome AND NEW.rejection_status IS OLD.rejection_status));
 SELECT RAISE(ABORT, 'A reason is recorded with its decision.') WHERE OLD.status = 'submitted' AND NEW.status = 'submitted' AND ((NEW.report_reason IS NOT OLD.report_reason AND NEW.report_status IS OLD.report_status)
  OR (NEW.rejection_reason IS NOT OLD.rejection_reason AND NEW.rejection_status IS OLD.rejection_status));
END;
