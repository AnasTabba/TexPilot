-- PIN accounts replace the hosted identity and invite codes: one shared factory workspace,
-- admins approve requested accounts and choose each person's permissions.
DROP TRIGGER IF EXISTS validate_invite;
--> statement-breakpoint
DROP TABLE IF EXISTS memberships;
--> statement-breakpoint
DROP TABLE IF EXISTS invites;
--> statement-breakpoint
CREATE TABLE users (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL, pin_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  status TEXT NOT NULL CHECK(status IN ('active','pending')),
  permissions TEXT NOT NULL DEFAULT '[]',
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, created_by TEXT
);
--> statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sessions_user ON sessions(user_id);
