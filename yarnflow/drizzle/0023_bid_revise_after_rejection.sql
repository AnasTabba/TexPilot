-- A rejected bid may be revised by its supplier; the revision goes back to the purchase manager as a submitted bid.
DROP TRIGGER validate_bid_edit;
CREATE TRIGGER validate_bid_edit BEFORE UPDATE ON supplier_bids WHEN NEW.version!=OLD.version BEGIN
 SELECT RAISE(ABORT,'RFQ not available') WHERE NOT EXISTS (
  SELECT 1 FROM procurement_rfqs r JOIN suppliers s ON s.id=NEW.supplier_id
  WHERE r.id=NEW.rfq_id AND r.status='open' AND r.deadline_at>unixepoch()*1000 AND s.status='approved'
 ) OR NEW.status!='submitted' OR NEW.version!=OLD.version+1;
END;
