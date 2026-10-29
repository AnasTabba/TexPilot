-- 0016_sales_portal.sql: buyer RFQs, quotations with credit days, buyer acceptance, noted sales,
-- locked invoices with GST and credit notes. Additive on top of 0004: nothing is backfilled because
-- invoices are immutable and no invoice exists on the live database yet.

ALTER TABLE buyers ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';

-- The buyer RFQ owns the pointer to the one quotation the buyer may currently accept.
ALTER TABLE buyer_purchase_orders ADD COLUMN sent_revision_id TEXT REFERENCES sales_quote_revisions(id);
ALTER TABLE buyer_purchase_orders ADD COLUMN sent_version INTEGER;

ALTER TABLE sales_quote_revisions ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 30 CHECK(credit_days BETWEEN 0 AND 365);
DROP TRIGGER quote_revision_terms_immutable;
CREATE TRIGGER quote_revision_terms_immutable BEFORE UPDATE ON sales_quote_revisions
WHEN NEW.status!=OLD.status OR NEW.quantity_milli!=OLD.quantity_milli OR NEW.unit!=OLD.unit OR NEW.price_minor!=OLD.price_minor
 OR NEW.currency!=OLD.currency OR NEW.specifications!=OLD.specifications OR NEW.requested_delivery_at!=OLD.requested_delivery_at
 OR NEW.payment_terms!=OLD.payment_terms OR NEW.credit_days!=OLD.credit_days OR NEW.note!=OLD.note OR NEW.buyer_po_id!=OLD.buyer_po_id
 OR NEW.buyer_id!=OLD.buyer_id OR NEW.version!=OLD.version OR NEW.workspace_id!=OLD.workspace_id OR NEW.created_by!=OLD.created_by
BEGIN
 SELECT RAISE(ABORT,'quoted terms are immutable') WHERE NEW.quantity_milli!=OLD.quantity_milli OR NEW.unit!=OLD.unit
  OR NEW.price_minor!=OLD.price_minor OR NEW.currency!=OLD.currency OR NEW.specifications!=OLD.specifications
  OR NEW.requested_delivery_at!=OLD.requested_delivery_at OR NEW.payment_terms!=OLD.payment_terms OR NEW.credit_days!=OLD.credit_days OR NEW.note!=OLD.note
  OR NEW.buyer_po_id!=OLD.buyer_po_id OR NEW.buyer_id!=OLD.buyer_id OR NEW.version!=OLD.version
  OR NEW.workspace_id!=OLD.workspace_id OR NEW.created_by!=OLD.created_by
  OR (OLD.status='draft' AND NEW.status!='sent') OR (OLD.status='sent' AND NEW.status!='approved') OR OLD.status='approved';
END;
-- Publishing is refused once a quotation was accepted, for a superseded revision, or for a buyer that is not approved.
CREATE TRIGGER quote_send_guard BEFORE UPDATE OF status ON sales_quote_revisions
WHEN OLD.status='draft' AND NEW.status='sent'
BEGIN
 SELECT RAISE(ABORT,'This request already has an accepted quotation.') WHERE EXISTS(SELECT 1 FROM sales_quote_revisions WHERE buyer_po_id=NEW.buyer_po_id AND status='approved');
 SELECT RAISE(ABORT,'Only the newest revision can be sent.') WHERE NEW.version<(SELECT MAX(version) FROM sales_quote_revisions WHERE buyer_po_id=NEW.buyer_po_id);
 SELECT RAISE(ABORT,'Respond only to RFQs from approved buyers.') WHERE NOT EXISTS(
  SELECT 1 FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id
  WHERE p.id=NEW.buyer_po_id AND p.status IN ('entered','quoted') AND b.status='active' AND b.workspace_id=NEW.workspace_id);
END;

CREATE TABLE quotation_acceptances (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 revision_id TEXT NOT NULL UNIQUE REFERENCES sales_quote_revisions(id), buyer_id TEXT NOT NULL REFERENCES buyers(id),
 version INTEGER NOT NULL, accepted_by TEXT NOT NULL, created_by TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'accepted' CHECK(status='accepted'), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- Acceptance needs the exact current sent revision and an approved buyer that owns the RFQ.
CREATE TRIGGER validate_quotation_acceptance BEFORE INSERT ON quotation_acceptances BEGIN
 SELECT RAISE(ABORT,'This quotation was replaced. Accept the latest revision.') WHERE NOT EXISTS (
  SELECT 1 FROM sales_quote_revisions r JOIN buyer_purchase_orders p ON p.id=r.buyer_po_id JOIN buyers b ON b.id=p.buyer_id
  WHERE r.id=NEW.revision_id AND r.workspace_id=NEW.workspace_id AND r.status='sent' AND r.version=NEW.version
   AND p.sent_revision_id=r.id AND p.sent_version=r.version AND p.status='quoted' AND p.buyer_id=NEW.buyer_id
   AND b.workspace_id=r.workspace_id AND b.status='active'
 );
END;
CREATE TRIGGER quotation_acceptances_no_update BEFORE UPDATE ON quotation_acceptances BEGIN SELECT RAISE(ABORT,'quotation acceptances are immutable'); END;
CREATE TRIGGER quotation_acceptances_no_delete BEFORE DELETE ON quotation_acceptances BEGIN SELECT RAISE(ABORT,'quotation acceptances are immutable'); END;

ALTER TABLE invoices ADD COLUMN subtotal_minor INTEGER;
ALTER TABLE invoices ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN due_at INTEGER;
ALTER TABLE invoices ADD COLUMN payment_terms TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN credit_days INTEGER;
ALTER TABLE invoices ADD COLUMN locked INTEGER NOT NULL DEFAULT 1 CHECK(locked=1);
ALTER TABLE invoices ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';
ALTER TABLE invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'issued' CHECK(status='issued');
ALTER TABLE invoices ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE credit_notes (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 number TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=5), status TEXT NOT NULL DEFAULT 'issued' CHECK(status='issued'),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(workspace_id,number)
);
CREATE INDEX credit_notes_invoice ON credit_notes(invoice_id);
CREATE TRIGGER validate_credit_note BEFORE INSERT ON credit_notes BEGIN
 SELECT RAISE(ABORT,'credit exceeds the invoice balance') WHERE NOT EXISTS (
  SELECT 1 FROM invoices i WHERE i.id=NEW.invoice_id AND i.workspace_id=NEW.workspace_id
   AND NEW.amount_minor<=i.total_minor-COALESCE((SELECT SUM(c.amount_minor) FROM credit_notes c WHERE c.invoice_id=i.id),0)
 );
END;
CREATE TRIGGER credit_notes_no_update BEFORE UPDATE ON credit_notes BEGIN SELECT RAISE(ABORT,'credit notes are immutable'); END;
CREATE TRIGGER credit_notes_no_delete BEFORE DELETE ON credit_notes BEGIN SELECT RAISE(ABORT,'credit notes are immutable'); END;

-- Currency guards (replace 0007): an issued invoice keeps its accepted quotation's currency, a
-- superseded quotation, or a draft on an RFQ that is closed or sold, no longer blocks a switch, and credit notes count as settled.
DROP VIEW currency_change_blockers;
CREATE VIEW currency_change_blockers AS
SELECT r.workspace_id FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id
WHERE r.status IN ('open','closed') AND b.status='submitted'
AND NOT EXISTS(SELECT 1 FROM supplier_purchase_orders p WHERE p.rfq_id=r.id AND p.status!='cancelled')
UNION
SELECT q.workspace_id FROM sales_quote_revisions q JOIN buyer_purchase_orders p ON p.id=q.buyer_po_id
WHERE p.status IN ('entered','quoted') AND (q.status='draft' OR (q.status='sent' AND (p.sent_revision_id IS NULL OR p.sent_revision_id=q.id)))
UNION
SELECT i.workspace_id FROM invoices i WHERE i.total_minor>
COALESCE((SELECT SUM(p.amount_minor) FROM sales_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id AND p.currency=i.currency),0)
+COALESCE((SELECT SUM(c.amount_minor) FROM credit_notes c WHERE c.invoice_id=i.id AND c.workspace_id=i.workspace_id),0);
DROP TRIGGER invoices_currency_insert;
CREATE TRIGGER invoices_currency_insert BEFORE INSERT ON invoices
WHEN NEW.currency IS NOT (SELECT currency FROM sales_quote_revisions WHERE id=NEW.revision_id)
BEGIN SELECT RAISE(ABORT,'Use the accepted quotation currency.'); END;
