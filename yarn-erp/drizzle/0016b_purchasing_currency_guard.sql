-- Cancelled RFQs no longer hold a currency change; pending awards and PO changes do.
-- Split out of 0011 because 0016_sales_portal.sql recreates this view and sorts after it: this starts from 0016's version.
DROP VIEW currency_change_blockers;
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
SELECT i.workspace_id FROM invoices i WHERE i.total_minor>
COALESCE((SELECT SUM(p.amount_minor) FROM sales_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id AND p.currency=i.currency),0)
+COALESCE((SELECT SUM(c.amount_minor) FROM credit_notes c WHERE c.invoice_id=i.id AND c.workspace_id=i.workspace_id),0);
