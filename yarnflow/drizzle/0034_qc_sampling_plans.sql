-- Registered sampling-plan authority for the QC v2 selection boundary. Expand-only: one new table and its guards; nothing
-- existing is altered. A plan belongs to one workspace and one plan_version, and lists its rolls and faces as JSON arrays.
-- ponytail: plans are inserted by an operator migration/SQL for now; a supervised registration route arrives with the G1
-- sampling gate. IF NOT EXISTS throughout: replaying this file over a database that already has it changes nothing.
CREATE TABLE IF NOT EXISTS qc_sampling_plans (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), plan_version TEXT NOT NULL, plan_sha256 TEXT NOT NULL CHECK(length(plan_sha256)=64),
 roll_refs TEXT NOT NULL CHECK(json_valid(roll_refs) AND json_type(roll_refs)='array'), faces TEXT NOT NULL CHECK(json_valid(faces) AND json_type(faces)='array'),
 registered_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,plan_version)
);
CREATE TRIGGER IF NOT EXISTS qc_sampling_plans_no_update BEFORE UPDATE ON qc_sampling_plans BEGIN SELECT RAISE(ABORT,'qc: sampling plans are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_sampling_plans_no_delete BEFORE DELETE ON qc_sampling_plans BEGIN SELECT RAISE(ABORT,'qc: sampling plans are immutable'); END;
