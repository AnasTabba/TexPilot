-- Task 9: arrived lots, inspections with accepted/rejected quantities, mandatory photos and issues.
-- Runs after 0016 on live (file order is not apply order). Additive: new tables, a view, new guards, and one replaced guard trigger.
-- It reads only supplier_purchase_orders, procurement_rfqs, shipments, products, goods_receipts and receipt_reversals.
CREATE TABLE qc_lots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 purchase_order_id TEXT NOT NULL REFERENCES supplier_purchase_orders(id), shipment_id TEXT NOT NULL REFERENCES shipments(id),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), product_id TEXT NOT NULL REFERENCES products(id),
 reference TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0), unit TEXT NOT NULL CHECK(unit IN ('kg','tonne')),
 supplier_lot TEXT NOT NULL DEFAULT '', arrived_at INTEGER NOT NULL, pending_since INTEGER,
 status TEXT NOT NULL CHECK(status IN ('awaiting_inspection','under_review','settled')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(workspace_id, reference)
);
CREATE INDEX qc_lots_order ON qc_lots(purchase_order_id);
CREATE INDEX qc_lots_status ON qc_lots(workspace_id, status);
CREATE TABLE qc_inspections (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), lot_id TEXT NOT NULL REFERENCES qc_lots(id),
 accepted_milli INTEGER NOT NULL CHECK(accepted_milli >= 0), rejected_milli INTEGER NOT NULL CHECK(rejected_milli >= 0),
 note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('draft','submitted')),
 report_status TEXT CHECK(report_status IS NULL OR report_status IN ('pending','accepted','returned')),
 rejection_status TEXT CHECK(rejection_status IS NULL OR rejection_status IN ('pending','confirmed','dismissed','escalated')),
 dismiss_outcome TEXT CHECK(dismiss_outcome IS NULL OR dismiss_outcome IN ('re_inspect','accept_with_deviation')),
 report_reason TEXT, rejection_reason TEXT, decided_by TEXT, submitted_at INTEGER, decided_at INTEGER,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(accepted_milli + rejected_milli > 0)
);
CREATE INDEX qc_inspections_lot ON qc_inspections(lot_id);
CREATE TABLE qc_issues (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), inspection_id TEXT NOT NULL REFERENCES qc_inspections(id),
 type TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('minor','major','critical')), description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','confirmed','dismissed','escalated')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX qc_issues_inspection ON qc_issues(inspection_id);
CREATE TABLE qc_photos (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), lot_id TEXT NOT NULL REFERENCES qc_lots(id),
 inspection_id TEXT REFERENCES qc_inspections(id), issue_id TEXT REFERENCES qc_issues(id),
 object_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL, content_hash TEXT NOT NULL, size INTEGER NOT NULL, taken_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'attached' CHECK(status = 'attached'),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((inspection_id IS NOT NULL) != (issue_id IS NOT NULL))
);
CREATE INDEX qc_photos_inspection ON qc_photos(inspection_id);
CREATE INDEX qc_photos_issue ON qc_photos(issue_id);

-- Quantity of a PO that has arrived: registered QC lots plus legacy receipts that were not reversed (the two sets never overlap).
CREATE VIEW po_arrived AS SELECT p.id AS order_id,
 COALESCE((SELECT SUM(l.quantity_milli) FROM qc_lots l WHERE l.purchase_order_id = p.id), 0)
 + COALESCE((SELECT SUM(g.quantity_milli) FROM goods_receipts g WHERE g.purchase_order_id = p.id AND NOT EXISTS(SELECT 1 FROM receipt_reversals r WHERE r.receipt_id = g.id)), 0) AS arrived_milli
FROM supplier_purchase_orders p;
-- Quantity of a lot not yet covered by an inspection: a returned report or a re-inspect dismissal frees its quantity again.
CREATE VIEW qc_lot_open AS SELECT l.id AS lot_id, l.quantity_milli - COALESCE((SELECT SUM(
  CASE WHEN i.status = 'draft' OR i.report_status IN ('pending','accepted') THEN i.accepted_milli ELSE 0 END
  + CASE WHEN i.status = 'draft' OR i.rejection_status IN ('pending','confirmed','escalated') OR (i.rejection_status = 'dismissed' AND i.dismiss_outcome = 'accept_with_deviation') THEN i.rejected_milli ELSE 0 END)
 FROM qc_inspections i WHERE i.lot_id = l.id), 0) AS open_milli
FROM qc_lots l;

CREATE TRIGGER validate_qc_lot BEFORE INSERT ON qc_lots BEGIN
 SELECT RAISE(ABORT, 'invalid lot order, shipment, supplier or unit') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_purchase_orders p JOIN procurement_rfqs r ON r.id = p.rfq_id JOIN shipments s ON s.id = NEW.shipment_id JOIN products m ON m.id = NEW.product_id
  WHERE p.id = NEW.purchase_order_id AND p.workspace_id = NEW.workspace_id AND p.approval_status = 'approved' AND p.status IN ('accepted','dispatched','received')
  AND s.purchase_order_id = p.id AND s.workspace_id = p.workspace_id AND m.workspace_id = p.workspace_id
  AND NEW.supplier_id = p.supplier_id AND NEW.unit = r.unit);
 SELECT RAISE(ABORT, 'More than the purchase order quantity.') WHERE NEW.quantity_milli >
  (SELECT p.quantity_milli - a.arrived_milli FROM supplier_purchase_orders p JOIN po_arrived a ON a.order_id = p.id WHERE p.id = NEW.purchase_order_id);
 SELECT RAISE(ABORT, 'A new lot awaits inspection.') WHERE NEW.status != 'awaiting_inspection' OR NEW.pending_since IS NULL;
END;
CREATE TRIGGER qc_lot_frozen BEFORE UPDATE ON qc_lots
WHEN NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.purchase_order_id != OLD.purchase_order_id OR NEW.shipment_id != OLD.shipment_id
 OR NEW.supplier_id != OLD.supplier_id OR NEW.product_id != OLD.product_id OR NEW.reference != OLD.reference OR NEW.quantity_milli != OLD.quantity_milli
 OR NEW.unit != OLD.unit OR NEW.supplier_lot != OLD.supplier_lot OR NEW.arrived_at != OLD.arrived_at OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT, 'a registered lot keeps its arrival record'); END;
CREATE TRIGGER qc_lot_no_delete BEFORE DELETE ON qc_lots BEGIN SELECT RAISE(ABORT, 'lots preserve the audit trail'); END;

-- A PO cannot shrink below what has arrived. Immediate changes and delayed approvals both end in this UPDATE, so one of two racing writes always loses.
CREATE TRIGGER po_quantity_floor BEFORE UPDATE OF quantity_milli ON supplier_purchase_orders
WHEN NEW.quantity_milli < OLD.quantity_milli
BEGIN SELECT RAISE(ABORT, 'More has already arrived than that quantity.') WHERE NEW.quantity_milli < (SELECT arrived_milli FROM po_arrived WHERE order_id = NEW.id); END;

-- The 0003 receipt guard measured against the original terms; it now measures against the PO's current quantity and counts QC lots too.
DROP TRIGGER validate_goods_receipt;
CREATE TRIGGER validate_goods_receipt BEFORE INSERT ON goods_receipts BEGIN
 SELECT RAISE(ABORT, 'invalid receipt quantity or order') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_purchase_orders p JOIN procurement_rfqs r ON r.id = p.rfq_id JOIN products m ON m.id = NEW.product_id JOIN lots l ON l.id = NEW.lot_id
  WHERE p.id = NEW.purchase_order_id AND p.workspace_id = NEW.workspace_id AND m.workspace_id = p.workspace_id AND l.workspace_id = p.workspace_id AND l.product_id = m.id
  AND p.status IN ('accepted','dispatched','received')
  AND NEW.grams = NEW.quantity_milli * CASE r.unit WHEN 'tonne' THEN 1000 ELSE 1 END
  AND NEW.quantity_milli + (SELECT arrived_milli FROM po_arrived WHERE order_id = p.id) <= COALESCE(p.quantity_milli, r.quantity_milli)
 );
END;

CREATE TRIGGER validate_qc_inspection BEFORE INSERT ON qc_inspections BEGIN
 SELECT RAISE(ABORT, 'invalid inspection lot') WHERE NOT EXISTS (SELECT 1 FROM qc_lots WHERE id = NEW.lot_id AND workspace_id = NEW.workspace_id);
 SELECT RAISE(ABORT, 'A new inspection is a draft.') WHERE NEW.status != 'draft' OR NEW.report_status IS NOT NULL OR NEW.rejection_status IS NOT NULL OR NEW.dismiss_outcome IS NOT NULL
  OR NEW.report_reason IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.submitted_at IS NOT NULL;
 SELECT RAISE(ABORT, 'More than the uninspected quantity.') WHERE NEW.accepted_milli + NEW.rejected_milli > (SELECT open_milli FROM qc_lot_open WHERE lot_id = NEW.lot_id);
END;
-- Graph: draft -> submitted once; accepted side NULL -> pending (at submission, quantity > 0) -> accepted|returned;
-- rejected side NULL -> pending (same rule) -> confirmed|dismissed|escalated, escalated -> confirmed|dismissed. Nothing runs backwards,
-- and an UPDATE that changes no decision column (a repeated decision) aborts so the whole batch behind it rolls back.
CREATE TRIGGER qc_inspection_transitions BEFORE UPDATE ON qc_inspections BEGIN
 SELECT RAISE(ABORT, 'An inspection keeps its lot and author.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.lot_id != OLD.lot_id OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at;
 SELECT RAISE(ABORT, 'A draft inspection cannot hold a decision.') WHERE OLD.status = 'draft' AND NEW.status = 'draft' AND (NEW.report_status IS NOT NULL OR NEW.rejection_status IS NOT NULL
  OR NEW.dismiss_outcome IS NOT NULL OR NEW.report_reason IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.submitted_at IS NOT NULL);
 SELECT RAISE(ABORT, 'More than the uninspected quantity.') WHERE OLD.status = 'draft' AND NEW.status = 'draft'
  AND NEW.accepted_milli + NEW.rejected_milli > (SELECT open_milli FROM qc_lot_open WHERE lot_id = OLD.lot_id) + OLD.accepted_milli + OLD.rejected_milli;
 SELECT RAISE(ABORT, 'Quantities are frozen on submission.') WHERE NEW.status = 'submitted' AND (NEW.accepted_milli != OLD.accepted_milli OR NEW.rejected_milli != OLD.rejected_milli OR NEW.note != OLD.note);
 SELECT RAISE(ABORT, 'Upload at least one photo of the accepted quantity.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.accepted_milli > 0
  AND NOT EXISTS (SELECT 1 FROM qc_photos WHERE inspection_id = OLD.id);
 SELECT RAISE(ABORT, 'Describe at least one issue for the rejected quantity.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.rejected_milli > 0
  AND NOT EXISTS (SELECT 1 FROM qc_issues WHERE inspection_id = OLD.id);
 SELECT RAISE(ABORT, 'A submission starts each side pending.') WHERE OLD.status = 'draft' AND NEW.status = 'submitted' AND (
  NEW.report_status IS NOT CASE WHEN NEW.accepted_milli > 0 THEN 'pending' END OR NEW.rejection_status IS NOT CASE WHEN NEW.rejected_milli > 0 THEN 'pending' END
  OR NEW.dismiss_outcome IS NOT NULL OR NEW.report_reason IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.submitted_at IS NULL);
 SELECT RAISE(ABORT, 'A submitted inspection keeps its quantities.') WHERE OLD.status = 'submitted' AND (NEW.status != 'submitted' OR NEW.accepted_milli != OLD.accepted_milli
  OR NEW.rejected_milli != OLD.rejected_milli OR NEW.note != OLD.note OR NEW.submitted_at IS NOT OLD.submitted_at);
 SELECT RAISE(ABORT, 'This inspection was already submitted or decided.') WHERE OLD.status = 'submitted' AND NEW.report_status IS OLD.report_status
  AND NEW.rejection_status IS OLD.rejection_status AND NEW.dismiss_outcome IS OLD.dismiss_outcome;
 SELECT RAISE(ABORT, 'Invalid report decision.') WHERE NEW.report_status IS NOT OLD.report_status AND NOT COALESCE((OLD.status = 'draft' AND NEW.status = 'submitted' AND OLD.report_status IS NULL AND NEW.report_status = 'pending')
  OR (OLD.status = 'submitted' AND OLD.report_status = 'pending' AND NEW.report_status IN ('accepted','returned')), 0);
 SELECT RAISE(ABORT, 'Invalid rejection decision.') WHERE NEW.rejection_status IS NOT OLD.rejection_status AND NOT COALESCE((OLD.status = 'draft' AND NEW.status = 'submitted' AND OLD.rejection_status IS NULL AND NEW.rejection_status = 'pending')
  OR (OLD.status = 'submitted' AND ((OLD.rejection_status = 'pending' AND NEW.rejection_status IN ('confirmed','dismissed','escalated')) OR (OLD.rejection_status = 'escalated' AND NEW.rejection_status IN ('confirmed','dismissed')))), 0);
 SELECT RAISE(ABORT, 'A dismissal records its outcome.') WHERE OLD.status = 'submitted' AND ((COALESCE(NEW.rejection_status = 'dismissed', 0) != (NEW.dismiss_outcome IS NOT NULL))
  OR (NEW.dismiss_outcome IS NOT OLD.dismiss_outcome AND NEW.rejection_status IS OLD.rejection_status));
 SELECT RAISE(ABORT, 'A reason is recorded with its decision.') WHERE OLD.status = 'submitted' AND ((NEW.report_reason IS NOT OLD.report_reason AND NEW.report_status IS OLD.report_status)
  OR (NEW.rejection_reason IS NOT OLD.rejection_reason AND NEW.rejection_status IS OLD.rejection_status));
END;
CREATE TRIGGER qc_inspection_no_delete BEFORE DELETE ON qc_inspections BEGIN SELECT RAISE(ABORT, 'inspections preserve the audit trail'); END;

CREATE TRIGGER validate_qc_issue BEFORE INSERT ON qc_issues BEGIN
 SELECT RAISE(ABORT, 'Issues attach only to draft inspections.') WHERE NOT EXISTS (SELECT 1 FROM qc_inspections WHERE id = NEW.inspection_id AND workspace_id = NEW.workspace_id AND status = 'draft');
 SELECT RAISE(ABORT, 'A new issue is open.') WHERE NEW.status != 'open';
END;
-- Issue evidence is frozen; only the supervisor's disposition moves, along the same graph as the rejected side, and only once submitted.
CREATE TRIGGER qc_issue_transitions BEFORE UPDATE ON qc_issues BEGIN
 SELECT RAISE(ABORT, 'Issue evidence is frozen.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id OR NEW.inspection_id != OLD.inspection_id OR NEW.type != OLD.type
  OR NEW.severity != OLD.severity OR NEW.description != OLD.description OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at;
 SELECT RAISE(ABORT, 'Invalid issue status change.') WHERE NOT (NEW.status != OLD.status AND ((OLD.status = 'open' AND NEW.status IN ('confirmed','dismissed','escalated')) OR (OLD.status = 'escalated' AND NEW.status IN ('confirmed','dismissed')))
  AND EXISTS (SELECT 1 FROM qc_inspections WHERE id = OLD.inspection_id AND status = 'submitted'));
END;
CREATE TRIGGER qc_issue_no_delete BEFORE DELETE ON qc_issues BEGIN SELECT RAISE(ABORT, 'issues preserve the audit trail'); END;

CREATE TRIGGER validate_qc_photo BEFORE INSERT ON qc_photos BEGIN
 SELECT RAISE(ABORT, 'Photos attach only to draft inspections.') WHERE NOT EXISTS (
  SELECT 1 FROM qc_inspections i WHERE i.workspace_id = NEW.workspace_id AND i.lot_id = NEW.lot_id AND i.status = 'draft'
  AND i.id = COALESCE(NEW.inspection_id, (SELECT x.inspection_id FROM qc_issues x WHERE x.id = NEW.issue_id)));
END;
CREATE TRIGGER qc_photo_no_update BEFORE UPDATE ON qc_photos BEGIN SELECT RAISE(ABORT, 'immutable photo'); END;
CREATE TRIGGER qc_photo_no_delete BEFORE DELETE ON qc_photos BEGIN SELECT RAISE(ABORT, 'immutable photo'); END;
