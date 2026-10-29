-- Invoice-level immutable payments; legacy payment accounting stays readable.
CREATE TABLE invoice_payments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), received_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'recorded' CHECK(status='recorded'), created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE VIEW invoice_balances AS
SELECT i.*,
 COALESCE((SELECT SUM(c.amount_minor) FROM credit_notes c WHERE c.invoice_id=i.id AND c.workspace_id=i.workspace_id),0) AS credited_minor,
 COALESCE((SELECT SUM(p.amount_minor) FROM invoice_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id),0)
 +COALESCE((SELECT SUM(p.amount_minor) FROM sales_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id AND p.currency=i.currency),0) AS paid_minor
FROM invoices i;
CREATE TRIGGER validate_invoice_payment BEFORE INSERT ON invoice_payments BEGIN
 SELECT RAISE(ABORT,'payment exceeds balance') WHERE NOT EXISTS (
 SELECT 1 FROM invoice_balances i WHERE i.id=NEW.invoice_id AND i.workspace_id=NEW.workspace_id AND i.due_at IS NOT NULL
 AND NEW.amount_minor<=i.total_minor-i.credited_minor-i.paid_minor);
END;
CREATE TRIGGER invoice_payments_no_update BEFORE UPDATE ON invoice_payments BEGIN SELECT RAISE(ABORT,'immutable payment'); END;
CREATE TRIGGER invoice_payments_no_delete BEFORE DELETE ON invoice_payments BEGIN SELECT RAISE(ABORT,'immutable payment'); END;
CREATE TABLE credit_alerts (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent' CHECK(status='sent'), created_by TEXT NOT NULL DEFAULT 'system:credit_alerts',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(invoice_id,kind)
);
DROP VIEW currency_change_blockers;
CREATE VIEW currency_change_blockers AS
SELECT r.workspace_id FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id
WHERE r.status IN ('open','closed') AND b.status='submitted'
AND NOT EXISTS(SELECT 1 FROM supplier_purchase_orders p WHERE p.rfq_id=r.id AND p.status!='cancelled')
UNION
SELECT q.workspace_id FROM sales_quote_revisions q JOIN buyer_purchase_orders p ON p.id=q.buyer_po_id
WHERE p.status IN ('entered','quoted') AND (q.status='draft' OR (q.status='sent' AND (p.sent_revision_id IS NULL OR p.sent_revision_id=q.id)))
UNION
SELECT workspace_id FROM invoice_balances WHERE total_minor>credited_minor+paid_minor;
