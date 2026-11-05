-- Settings-driven DataLoopLabs tracking: an admin-verified provider contract per workspace, stage and ETA on shipments,
-- an event history and a call log for the daily budget. Additive only.
CREATE TABLE tracking_settings (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 base_url TEXT NOT NULL DEFAULT '', track_path TEXT NOT NULL DEFAULT '', contract_json TEXT NOT NULL DEFAULT '',
 refresh_hours INTEGER NOT NULL DEFAULT 12 CHECK(refresh_hours BETWEEN 1 AND 168),
 daily_budget INTEGER NOT NULL DEFAULT 0 CHECK(daily_budget BETWEEN 0 AND 1000),
 verified_by TEXT, verified_at INTEGER, updated_by TEXT, updated_at INTEGER
);
CREATE TABLE shipment_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), shipment_id TEXT NOT NULL REFERENCES shipments(id),
 at INTEGER, title TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
 UNIQUE(shipment_id, at, code, title)
);
CREATE INDEX shipment_events_shipment_at ON shipment_events(shipment_id, at);
CREATE TABLE tracking_calls (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, shipment_id TEXT NOT NULL,
 trigger TEXT NOT NULL CHECK(trigger IN ('manual','auto')), outcome TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX tracking_calls_workspace_created ON tracking_calls(workspace_id, created_at);
ALTER TABLE shipments ADD COLUMN stage TEXT;
ALTER TABLE shipments ADD COLUMN eta INTEGER;
ALTER TABLE shipments ADD COLUMN origin TEXT;
ALTER TABLE shipments ADD COLUMN destination TEXT;
ALTER TABLE shipments ADD COLUMN vessel TEXT;
ALTER TABLE shipments ADD COLUMN stage_changed_at INTEGER;
