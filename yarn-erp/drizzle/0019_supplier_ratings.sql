-- supplier_ratings already exists from 0010 (one overall score, append-only). Extend it instead of recreating it.
-- Legacy rows keep NULL criteria and count their single score for all three criteria.
ALTER TABLE supplier_ratings ADD COLUMN delivery INTEGER CHECK(delivery IS NULL OR delivery BETWEEN 1 AND 5);
ALTER TABLE supplier_ratings ADD COLUMN quality INTEGER CHECK(quality IS NULL OR quality BETWEEN 1 AND 5);
ALTER TABLE supplier_ratings ADD COLUMN terms INTEGER CHECK(terms IS NULL OR terms BETWEEN 1 AND 5);
ALTER TABLE supplier_ratings ADD COLUMN order_id TEXT REFERENCES supplier_purchase_orders(id);
CREATE INDEX supplier_ratings_workspace_supplier ON supplier_ratings(workspace_id, supplier_id);
