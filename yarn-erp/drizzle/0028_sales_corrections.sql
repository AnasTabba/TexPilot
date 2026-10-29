-- 0028_sales_corrections.sql: product type on materials, and reversible sales corrections.
-- Every correction is a new immutable row (payment reversal, invoice void, rating void); the original
-- payment, invoice and rating rows are never changed. Additive except the quotation status trigger,
-- which is recreated to allow a sent quotation to be withdrawn back to draft.

ALTER TABLE products ADD COLUMN product_type TEXT CHECK(product_type IS NULL OR length(product_type) BETWEEN 1 AND 60);

-- Payment reversal: one reversal per payment, same amount, same invoice and workspace.
CREATE TABLE payment_reversals (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 payment_id TEXT NOT NULL UNIQUE REFERENCES invoice_payments(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_payment_reversal BEFORE INSERT ON payment_reversals BEGIN
 SELECT RAISE(ABORT,'payment reversal does not match its payment') WHERE NOT EXISTS (
  SELECT 1 FROM invoice_payments p WHERE p.id=NEW.payment_id AND p.workspace_id=NEW.workspace_id
   AND p.invoice_id=NEW.invoice_id AND p.amount_minor=NEW.amount_minor);
END;
CREATE TRIGGER payment_reversals_no_update BEFORE UPDATE ON payment_reversals BEGIN SELECT RAISE(ABORT,'reversals are history'); END;
CREATE TRIGGER payment_reversals_no_delete BEFORE DELETE ON payment_reversals BEGIN SELECT RAISE(ABORT,'reversals are history'); END;

-- Invoice void: only while nothing was dispatched for the order and no payment, credit note or receivable stands.
CREATE TABLE invoice_voids (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id), sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=3), created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_invoice_void BEFORE INSERT ON invoice_voids BEGIN
 SELECT RAISE(ABORT,'This invoice has a payment, credit note or dispatch, so it cannot be voided. Use a credit note.') WHERE
  NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id=NEW.invoice_id AND i.workspace_id=NEW.workspace_id AND i.sales_order_id=NEW.sales_order_id)
  OR EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id=NEW.invoice_id AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id=p.id))
  OR EXISTS (SELECT 1 FROM sales_payments p WHERE p.invoice_id=NEW.invoice_id)
  OR EXISTS (SELECT 1 FROM credit_notes c WHERE c.invoice_id=NEW.invoice_id)
  OR EXISTS (SELECT 1 FROM receivables r WHERE r.invoice_id=NEW.invoice_id)
  OR EXISTS (SELECT 1 FROM dispatches d WHERE d.sales_order_id=NEW.sales_order_id)
  OR EXISTS (SELECT 1 FROM sales_dispatches d WHERE d.sales_order_id=NEW.sales_order_id)
  OR NOT EXISTS (SELECT 1 FROM sales_orders o WHERE o.id=NEW.sales_order_id AND o.workspace_id=NEW.workspace_id AND o.status='confirmed');
END;
CREATE TRIGGER invoice_voids_no_update BEFORE UPDATE ON invoice_voids BEGIN SELECT RAISE(ABORT,'voids are history'); END;
CREATE TRIGGER invoice_voids_no_delete BEFORE DELETE ON invoice_voids BEGIN SELECT RAISE(ABORT,'voids are history'); END;

-- invoice_ledger shows every invoice with its void and net payments; invoice_balances keeps only live
-- invoices, so outstanding, overdue, buyer totals, analytics and currency blockers all skip a voided invoice.
-- Net paid = recorded payments - reversals + legacy sales payments.
DROP VIEW invoice_balances;
CREATE VIEW invoice_ledger AS
SELECT i.*, v.created_at AS voided_at, v.reason AS void_reason,
 COALESCE((SELECT SUM(c.amount_minor) FROM credit_notes c WHERE c.invoice_id=i.id AND c.workspace_id=i.workspace_id),0) AS credited_minor,
 COALESCE((SELECT SUM(p.amount_minor) FROM invoice_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id),0)
 -COALESCE((SELECT SUM(r.amount_minor) FROM payment_reversals r WHERE r.invoice_id=i.id AND r.workspace_id=i.workspace_id),0)
 +COALESCE((SELECT SUM(p.amount_minor) FROM sales_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id AND p.currency=i.currency),0) AS paid_minor
FROM invoices i LEFT JOIN invoice_voids v ON v.invoice_id=i.id;
CREATE VIEW invoice_balances AS SELECT * FROM invoice_ledger WHERE voided_at IS NULL;

-- Withdrawing a sent quotation returns it to draft; accepted quotations stay locked.
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
  OR (OLD.status='draft' AND NEW.status!='sent') OR (OLD.status='sent' AND NEW.status NOT IN ('approved','draft')) OR OLD.status='approved';
END;

-- A buyer's rating can be voided by its rater or an admin; the rating row stays, and aggregates skip voided ratings.
CREATE TABLE buyer_rating_voids (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 rating_id TEXT NOT NULL UNIQUE REFERENCES buyer_ratings(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=3), created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_rating_void BEFORE INSERT ON buyer_rating_voids BEGIN
 SELECT RAISE(ABORT,'rating not in workspace') WHERE NOT EXISTS (
  SELECT 1 FROM buyer_ratings r WHERE r.id=NEW.rating_id AND r.workspace_id=NEW.workspace_id);
END;
CREATE TRIGGER buyer_rating_voids_no_update BEFORE UPDATE ON buyer_rating_voids BEGIN SELECT RAISE(ABORT,'voids are history'); END;
CREATE TRIGGER buyer_rating_voids_no_delete BEFORE DELETE ON buyer_rating_voids BEGIN SELECT RAISE(ABORT,'voids are history'); END;
