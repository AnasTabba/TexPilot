-- Cancelled RFQs no longer hold a currency change; pending awards and PO changes do.
-- Sorts after 0017_payments.sql, which recreates this view: this starts from 0017's version.
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
SELECT workspace_id FROM invoice_balances WHERE total_minor>credited_minor+paid_minor;
