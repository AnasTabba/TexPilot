-- 0026_buyer_ratings.sql: sales staff rate buyers on payment, communication and reliability.
-- Append-only like supplier_ratings (0010, 0019): the triggers below abort UPDATE and DELETE. Additive only.
CREATE TABLE buyer_ratings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  payment INTEGER NOT NULL CHECK(payment BETWEEN 1 AND 5),
  communication INTEGER NOT NULL CHECK(communication BETWEEN 1 AND 5),
  reliability INTEGER NOT NULL CHECK(reliability BETWEEN 1 AND 5),
  feedback TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX buyer_ratings_workspace_buyer ON buyer_ratings(workspace_id, buyer_id);
CREATE TRIGGER buyer_ratings_no_update BEFORE UPDATE ON buyer_ratings BEGIN SELECT RAISE(ABORT,'ratings are history'); END;
CREATE TRIGGER buyer_ratings_no_delete BEFORE DELETE ON buyer_ratings BEGIN SELECT RAISE(ABORT,'ratings are history'); END;
