-- Task 8: a bill of lading attached to a purchase order by staff, with the last tracking status cached.
-- Runs after 0016 on live (file order is not apply order); it only adds a table over supplier_purchase_orders.
CREATE TABLE shipments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 purchase_order_id TEXT NOT NULL REFERENCES supplier_purchase_orders(id),
 bill_of_lading TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'not_checked' CHECK(status IN ('not_checked','tracked','error')),
 last_status_json TEXT, last_checked_at INTEGER, last_error TEXT,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(purchase_order_id, bill_of_lading)
);
CREATE INDEX shipments_workspace_order ON shipments(workspace_id, purchase_order_id);
