-- Task 1 metadata contract for the supplier entities, kept additive: legacy rows are labelled, never rewritten.
ALTER TABLE suppliers ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';
ALTER TABLE supplier_registration_reviews ADD COLUMN created_by TEXT NOT NULL DEFAULT 'legacy:unknown';
ALTER TABLE supplier_registration_reviews ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE supplier_registration_reviews SET created_by=actor_id, updated_at=created_at;
ALTER TABLE supplier_categories ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status='active');
ALTER TABLE supplier_categories ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system:seed';
ALTER TABLE supplier_categories ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE supplier_categories SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000, updated_at=CAST(strftime('%s','now') AS INTEGER)*1000;
INSERT INTO supplier_categories(id,name,urdu_name,sort_order,status,created_by,created_at,updated_at) VALUES
 ('dyes','Dyes','رنگ',7,'active','system:seed',CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000),
 ('chemicals','Chemicals','کیمیکل',8,'active','system:seed',CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000),
 ('packaging','Packaging','پیکنگ',9,'active','system:seed',CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000);

CREATE TABLE supplier_ratings (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), feedback TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'), created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX supplier_ratings_supplier ON supplier_ratings(supplier_id, created_at);
CREATE TRIGGER supplier_ratings_no_update BEFORE UPDATE ON supplier_ratings BEGIN SELECT RAISE(ABORT,'ratings are history'); END;
CREATE TRIGGER supplier_ratings_no_delete BEFORE DELETE ON supplier_ratings BEGIN SELECT RAISE(ABORT,'ratings are history'); END;
