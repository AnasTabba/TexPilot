-- Removing a team member keeps their history (created_by, audit, movements); removed_at hides them from the team list.
ALTER TABLE users ADD COLUMN removed_at INTEGER;
