-- Purchasing: RFQ closing and cancelling, PO quantity/total/approval state, and database guards behind awards.
ALTER TABLE procurement_rfqs ADD COLUMN cancelled_at INTEGER;
ALTER TABLE procurement_rfqs ADD COLUMN cancel_reason TEXT;
ALTER TABLE procurement_rfqs ADD COLUMN closed_at INTEGER;
ALTER TABLE procurement_rfqs ADD COLUMN updated_at INTEGER;
UPDATE procurement_rfqs SET updated_at=COALESCE(published_at,created_at);

ALTER TABLE supplier_purchase_orders ADD COLUMN quantity_milli INTEGER;
ALTER TABLE supplier_purchase_orders ADD COLUMN total_minor INTEGER;
ALTER TABLE supplier_purchase_orders ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('approved','pending_admin'));
ALTER TABLE supplier_purchase_orders ADD COLUMN bill_of_lading TEXT NOT NULL DEFAULT '';
ALTER TABLE supplier_purchase_orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE supplier_purchase_orders ADD COLUMN updated_at INTEGER;
ALTER TABLE supplier_purchase_orders ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';
-- Only the new columns are backfilled; purchase_terms_immutable watches the commercial ones.
UPDATE supplier_purchase_orders SET quantity_milli=json_extract(terms_snapshot,'$.quantity_milli'),
 total_minor=(json_extract(terms_snapshot,'$.price_minor')*json_extract(terms_snapshot,'$.quantity_milli')+500)/1000,
 updated_at=created_at, created_by=accepted_by;

-- Task 1 metadata contract. Old bids and revisions keep their unknown creator; they are not rewritten.
ALTER TABLE supplier_bids ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';
ALTER TABLE supplier_bid_history ADD COLUMN status TEXT NOT NULL DEFAULT 'recorded' CHECK(status='recorded');
ALTER TABLE supplier_bid_history ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';
ALTER TABLE supplier_bid_history ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- An award that went stale between request and approval fails the whole batch instead of creating nothing silently.
CREATE TRIGGER validate_purchase_order BEFORE INSERT ON supplier_purchase_orders BEGIN
 SELECT RAISE(ABORT,'bid or supplier no longer valid') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id JOIN suppliers s ON s.id=b.supplier_id
  WHERE b.id=NEW.bid_id AND b.rfq_id=NEW.rfq_id AND b.supplier_id=NEW.supplier_id AND b.status='submitted'
  AND s.status='approved' AND s.workspace_id=NEW.workspace_id
  AND r.workspace_id=NEW.workspace_id AND r.status IN ('open','closed') AND r.cancelled_at IS NULL
 );
END;
