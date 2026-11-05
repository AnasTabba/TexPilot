-- Reversals: a correction for a wrong award, decision or record is a new append-only row, never an edit of the old one.
-- erp_reversals.id is the client request ID, so a repeated request finds its earlier row instead of acting twice.
CREATE TABLE erp_reversals (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 action TEXT NOT NULL CHECK(action IN ('order.cancelled','award.withdrawn','approval.undone','bid.reject_undone','rfq.reopened','supplier.reopened','rating.voided','user.restored','shipment.bl_corrected')),
 object_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 actor_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX erp_reversals_object ON erp_reversals(object_id, action);
-- One cancellation, one withdrawal, one undo and one void per object; the others may repeat.
CREATE UNIQUE INDEX erp_reversals_once ON erp_reversals(action, object_id) WHERE action IN ('order.cancelled','award.withdrawn','approval.undone','rating.voided');
CREATE TRIGGER erp_reversals_no_update BEFORE UPDATE ON erp_reversals BEGIN SELECT RAISE(ABORT,'reversals are history'); END;
CREATE TRIGGER erp_reversals_no_delete BEFORE DELETE ON erp_reversals BEGIN SELECT RAISE(ABORT,'reversals are history'); END;

-- A cancelled award keeps its PO row (history, quantity floor, receipts), so a later award for the same RFQ needs
-- UNIQUE(rfq_id) to allow one live PO. SQLite cannot drop a column UNIQUE in place, so the table is
-- rebuilt: rows are copied, never updated. Every trigger and view that names the table is dropped and recreated unchanged.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER po_quantity_floor;
DROP TRIGGER purchase_terms_immutable;
DROP TRIGGER purchase_orders_no_delete;
DROP TRIGGER validate_purchase_order;
DROP TRIGGER validate_procurement_dispatch;
DROP TRIGGER validate_goods_receipt;
DROP TRIGGER validate_qc_lot;
DROP TRIGGER settings_currency_insert;
DROP TRIGGER settings_currency_update;
DROP VIEW currency_change_blockers;
DROP VIEW po_arrived;
-- Copy out, drop, recreate, copy back: the parent rows come back after the drop, so the deferred FK count returns to zero.
CREATE TABLE supplier_purchase_orders_backup AS SELECT * FROM supplier_purchase_orders;
DROP TABLE supplier_purchase_orders;
CREATE TABLE supplier_purchase_orders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), rfq_id TEXT NOT NULL REFERENCES procurement_rfqs(id),
 bid_id TEXT NOT NULL REFERENCES supplier_bids(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 reference TEXT NOT NULL, terms_snapshot TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('accepted','dispatched','received','cancelled')),
 accepted_by TEXT NOT NULL, created_at INTEGER NOT NULL, quantity_milli INTEGER, total_minor INTEGER, approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('approved','pending_admin')), bill_of_lading TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER, created_by TEXT NOT NULL DEFAULT 'legacy:unknown', UNIQUE(workspace_id,reference)
);
INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at,quantity_milli,total_minor,approval_status,bill_of_lading,version,updated_at,created_by)
 SELECT id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at,quantity_milli,total_minor,approval_status,bill_of_lading,version,updated_at,created_by FROM supplier_purchase_orders_backup;
DROP TABLE supplier_purchase_orders_backup;
-- At most one live (not cancelled) PO per RFQ.
CREATE UNIQUE INDEX supplier_purchase_orders_live_rfq ON supplier_purchase_orders(rfq_id) WHERE status!='cancelled';
CREATE TRIGGER purchase_terms_immutable BEFORE UPDATE ON supplier_purchase_orders
WHEN NEW.terms_snapshot!=OLD.terms_snapshot OR NEW.rfq_id!=OLD.rfq_id OR NEW.bid_id!=OLD.bid_id OR NEW.supplier_id!=OLD.supplier_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.reference!=OLD.reference OR NEW.accepted_by!=OLD.accepted_by
BEGIN SELECT RAISE(ABORT,'accepted purchase terms are immutable'); END;
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON supplier_purchase_orders BEGIN SELECT RAISE(ABORT,'purchase orders preserve the audit trail'); END;
CREATE VIEW po_arrived AS SELECT p.id AS order_id,
 COALESCE((SELECT SUM(l.quantity_milli) FROM qc_lots l WHERE l.purchase_order_id = p.id
   AND NOT EXISTS(SELECT 1 FROM qc_corrections c WHERE c.kind = 'lot_cancelled' AND c.target_id = l.id)), 0)
 + COALESCE((SELECT SUM(g.quantity_milli) FROM goods_receipts g WHERE g.purchase_order_id = p.id AND NOT EXISTS(SELECT 1 FROM receipt_reversals r WHERE r.receipt_id = g.id)), 0) AS arrived_milli
FROM supplier_purchase_orders p;
CREATE VIEW currency_change_blockers AS
SELECT r.workspace_id FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id
WHERE r.status IN ('open','closed') AND r.cancelled_at IS NULL AND b.status='submitted'
AND NOT EXISTS(SELECT 1 FROM supplier_purchase_orders p WHERE p.rfq_id=r.id AND p.status!='cancelled')
UNION
SELECT a.workspace_id FROM approval_requests a WHERE a.type IN ('purchase_award','po_change') AND a.status='pending'
UNION
SELECT q.workspace_id FROM sales_quote_revisions q JOIN buyer_purchase_orders p ON p.id=q.buyer_po_id
WHERE p.status IN ('entered','quoted') AND (q.status='draft' OR (q.status='sent' AND (p.sent_revision_id IS NULL OR p.sent_revision_id=q.id)))
UNION
SELECT workspace_id FROM invoice_balances WHERE total_minor>credited_minor+paid_minor;
CREATE TRIGGER settings_currency_insert BEFORE INSERT ON settings
WHEN NEW.key='currency' AND json_extract(NEW.value_json,'$')!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN
 SELECT RAISE(ABORT,'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.') WHERE EXISTS(SELECT 1 FROM currency_change_blockers WHERE workspace_id=NEW.workspace_id);
END;
CREATE TRIGGER settings_currency_update BEFORE UPDATE ON settings
WHEN NEW.key='currency' AND json_extract(NEW.value_json,'$')!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN
 SELECT RAISE(ABORT,'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.') WHERE EXISTS(SELECT 1 FROM currency_change_blockers WHERE workspace_id=NEW.workspace_id);
END;
CREATE TRIGGER po_quantity_floor BEFORE UPDATE OF quantity_milli ON supplier_purchase_orders
WHEN NEW.quantity_milli < OLD.quantity_milli
BEGIN SELECT RAISE(ABORT, 'More has already arrived than that quantity.') WHERE NEW.quantity_milli < (SELECT arrived_milli FROM po_arrived WHERE order_id = NEW.id); END;
CREATE TRIGGER validate_purchase_order BEFORE INSERT ON supplier_purchase_orders BEGIN
 SELECT RAISE(ABORT,'bid or supplier no longer valid') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id JOIN suppliers s ON s.id=b.supplier_id
  WHERE b.id=NEW.bid_id AND b.rfq_id=NEW.rfq_id AND b.supplier_id=NEW.supplier_id AND b.status='submitted'
  AND s.status='approved' AND s.workspace_id=NEW.workspace_id
  AND r.workspace_id=NEW.workspace_id AND r.status IN ('open','closed') AND r.cancelled_at IS NULL
 );
END;
CREATE TRIGGER validate_procurement_dispatch BEFORE INSERT ON procurement_shipments BEGIN
 SELECT RAISE(ABORT,'invalid shipment order') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_purchase_orders p
  WHERE p.id=NEW.purchase_order_id AND p.workspace_id=NEW.workspace_id AND p.supplier_id=NEW.supplier_id
  AND p.status IN ('accepted','dispatched') AND
  NEW.quantity_milli + COALESCE((SELECT SUM(quantity_milli) FROM procurement_shipments WHERE purchase_order_id=p.id),0)<=p.quantity_milli
 );
END;
CREATE TRIGGER validate_goods_receipt BEFORE INSERT ON goods_receipts BEGIN
 SELECT RAISE(ABORT, 'invalid receipt quantity or order') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_purchase_orders p JOIN procurement_rfqs r ON r.id = p.rfq_id JOIN products m ON m.id = NEW.product_id JOIN lots l ON l.id = NEW.lot_id
  WHERE p.id = NEW.purchase_order_id AND p.workspace_id = NEW.workspace_id AND m.workspace_id = p.workspace_id AND l.workspace_id = p.workspace_id AND l.product_id = m.id
  AND p.status IN ('accepted','dispatched','received')
  AND NEW.grams = NEW.quantity_milli * CASE r.unit WHEN 'tonne' THEN 1000 ELSE 1 END
  AND NEW.quantity_milli + (SELECT arrived_milli FROM po_arrived WHERE order_id = p.id) <= COALESCE(p.quantity_milli, r.quantity_milli)
 );
END;
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
