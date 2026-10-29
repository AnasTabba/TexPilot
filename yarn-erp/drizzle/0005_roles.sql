CREATE TABLE roles (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, urdu_name TEXT NOT NULL, sort_order INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'), created_by TEXT NOT NULL DEFAULT 'system:seed',
 created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
INSERT INTO roles(id,name,urdu_name,sort_order) VALUES
 ('admin','Admin','ایڈمن',1),
 ('purchase_manager','Purchase Manager','خریداری مینیجر',2),
 ('quality_inspector','Quality Inspector','کوالٹی انسپکٹر',3),
 ('supervisor','Supervisor','سپروائزر',4),
 ('sales_manager','Sales Manager','سیلز مینیجر',5),
 ('dispatch','Dispatch','ڈسپیچ',6);
ALTER TABLE users ADD COLUMN portal_role TEXT REFERENCES roles(id);
ALTER TABLE users ADD COLUMN deactivated_at INTEGER;
ALTER TABLE users ADD COLUMN deactivated_by TEXT;
ALTER TABLE users ADD COLUMN updated_at INTEGER;
-- Existing nullable created_by is legacy:unknown; preserve its original value.
UPDATE users SET updated_at = created_at, portal_role = CASE
 WHEN role = 'admin' THEN 'admin'
 WHEN json_array_length(permissions) >= 13 THEN 'supervisor'
 WHEN permissions LIKE '%"procure"%' OR permissions LIKE '%"suppliers"%' THEN 'purchase_manager'
 WHEN permissions LIKE '%"sales"%' OR permissions LIKE '%"payments"%' THEN 'sales_manager'
 WHEN permissions LIKE '%"inspect"%' THEN 'quality_inspector'
 WHEN permissions LIKE '%"receive"%' OR permissions LIKE '%"produce"%' OR permissions LIKE '%"catalog"%' OR permissions LIKE '%"waste"%'
   OR permissions LIKE '%"reverse"%' OR permissions LIKE '%"production"%' OR permissions LIKE '%"qc"%' THEN 'supervisor'
 WHEN permissions LIKE '%"dispatch"%' THEN 'dispatch'
 ELSE 'quality_inspector' END;
-- Enforce the invariant inside the write transaction, including competing demotions.
CREATE TRIGGER users_keep_admin BEFORE UPDATE ON users
WHEN OLD.portal_role='admin' AND OLD.status='active' AND OLD.deactivated_at IS NULL
 AND (NEW.portal_role IS NOT 'admin' OR NEW.status!='active' OR NEW.deactivated_at IS NOT NULL)
BEGIN
 SELECT RAISE(ABORT,'Keep at least one admin.') WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE workspace_id=OLD.workspace_id AND id!=OLD.id
   AND portal_role='admin' AND status='active' AND deactivated_at IS NULL
 );
END;
