-- Personal approval limits for supervisors: a row here overrides the workspace threshold for that person and type.
CREATE TABLE user_thresholds (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 type TEXT NOT NULL CHECK(type IN ('purchase','inventory_adjustment','claim','dispatch_stock_issue')),
 value INTEGER NOT NULL CHECK(typeof(value)='integer' AND value>=0),
 currency TEXT,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,type),
 CHECK((type IN ('purchase','claim') AND currency IS NOT NULL AND currency IN ('PKR','USD','EUR','GBP'))
  OR (type IN ('inventory_adjustment','dispatch_stock_issue') AND currency IS NULL))
);
CREATE TRIGGER user_thresholds_member_insert BEFORE INSERT ON user_thresholds
WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'Personal limits belong to a person in the same workspace.'); END;
CREATE TRIGGER user_thresholds_currency_insert BEFORE INSERT ON user_thresholds
WHEN NEW.currency IS NOT NULL AND NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
CREATE TRIGGER user_thresholds_currency_update BEFORE UPDATE OF value,currency ON user_thresholds
WHEN NEW.currency IS NOT NULL AND NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
-- Written by the admin endpoint in the same batch as each change; a cleared limit has new_value NULL.
CREATE TABLE user_threshold_history (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 type TEXT NOT NULL CHECK(type IN ('purchase','inventory_adjustment','claim','dispatch_stock_issue')),
 old_value INTEGER, new_value INTEGER, old_currency TEXT, new_currency TEXT,
 changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL
);
CREATE INDEX user_threshold_history_user ON user_threshold_history(user_id,changed_at);
CREATE TRIGGER user_threshold_history_no_update BEFORE UPDATE ON user_threshold_history BEGIN SELECT RAISE(ABORT,'immutable threshold history'); END;
CREATE TRIGGER user_threshold_history_no_delete BEFORE DELETE ON user_threshold_history BEGIN SELECT RAISE(ABORT,'immutable threshold history'); END;
