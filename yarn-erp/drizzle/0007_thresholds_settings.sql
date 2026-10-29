-- Factory governance: amounts retain their denomination; history is database-kept.
CREATE TABLE thresholds (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 type TEXT NOT NULL CHECK(type IN ('purchase','inventory_adjustment','claim','dispatch_stock_issue')),
 value INTEGER NOT NULL CHECK(typeof(value)='integer' AND value>=0),
 currency TEXT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,type),
 CHECK((type IN ('purchase','claim') AND currency IS NOT NULL AND currency IN ('PKR','USD','EUR','GBP'))
  OR (type IN ('inventory_adjustment','dispatch_stock_issue') AND currency IS NULL))
);
CREATE TABLE threshold_history (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 type TEXT NOT NULL CHECK(type IN ('purchase','inventory_adjustment','claim','dispatch_stock_issue')),
 old_value INTEGER, new_value INTEGER NOT NULL, old_currency TEXT, new_currency TEXT,
 changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'recorded' CHECK(status='recorded'),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX threshold_history_workspace ON threshold_history(workspace_id,changed_at);
CREATE TRIGGER threshold_history_no_update BEFORE UPDATE ON threshold_history BEGIN SELECT RAISE(ABORT,'immutable threshold history'); END;
CREATE TRIGGER threshold_history_no_delete BEFORE DELETE ON threshold_history BEGIN SELECT RAISE(ABORT,'immutable threshold history'); END;
CREATE TRIGGER threshold_insert_history AFTER INSERT ON thresholds BEGIN
 INSERT INTO threshold_history(id,workspace_id,type,old_value,new_value,old_currency,new_currency,changed_by,changed_at,created_by,created_at,updated_at)
 VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.type,NULL,NEW.value,NULL,NEW.currency,NEW.updated_by,NEW.updated_at,NEW.updated_by,NEW.updated_at,NEW.updated_at);
END;
CREATE TRIGGER threshold_update_history AFTER UPDATE OF value,currency ON thresholds BEGIN
 INSERT INTO threshold_history(id,workspace_id,type,old_value,new_value,old_currency,new_currency,changed_by,changed_at,created_by,created_at,updated_at)
 VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.type,OLD.value,NEW.value,OLD.currency,NEW.currency,NEW.updated_by,NEW.updated_at,NEW.updated_by,NEW.updated_at,NEW.updated_at);
END;
CREATE TABLE settings (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 key TEXT NOT NULL CHECK(key IN ('currency','tax_rate_bp','invoice_format','reminder_hours','credit_alert_days')),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,key),
 CHECK(key!='currency' OR (json_type(value_json)='text' AND json_extract(value_json,'$') IN ('PKR','USD','EUR','GBP')))
);
-- 0002 has no cancellations/pending awards; 0004 has no credit notes. Later owning
-- migrations extend these guards when those accounting sources are introduced.
CREATE TRIGGER settings_currency_insert BEFORE INSERT ON settings
WHEN NEW.key='currency' AND json_extract(NEW.value_json,'$')!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN
 SELECT RAISE(ABORT,'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.') WHERE EXISTS(SELECT 1 FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id
 WHERE r.workspace_id=NEW.workspace_id AND r.status IN ('open','closed') AND b.status='submitted'
 AND NOT EXISTS(SELECT 1 FROM supplier_purchase_orders p WHERE p.rfq_id=r.id AND p.status!='cancelled'))
 OR EXISTS(SELECT 1 FROM sales_quote_revisions q WHERE q.workspace_id=NEW.workspace_id AND q.status IN ('draft','sent'))
 OR EXISTS(SELECT 1 FROM invoices i WHERE i.workspace_id=NEW.workspace_id AND i.total_minor>
 COALESCE((SELECT SUM(p.amount_minor) FROM sales_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id AND p.currency=i.currency),0));
END;
CREATE TRIGGER settings_currency_update BEFORE UPDATE ON settings
WHEN NEW.key='currency' AND json_extract(NEW.value_json,'$')!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN
 SELECT RAISE(ABORT,'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.') WHERE EXISTS(SELECT 1 FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id
 WHERE r.workspace_id=NEW.workspace_id AND r.status IN ('open','closed') AND b.status='submitted'
 AND NOT EXISTS(SELECT 1 FROM supplier_purchase_orders p WHERE p.rfq_id=r.id AND p.status!='cancelled'))
 OR EXISTS(SELECT 1 FROM sales_quote_revisions q WHERE q.workspace_id=NEW.workspace_id AND q.status IN ('draft','sent'))
 OR EXISTS(SELECT 1 FROM invoices i WHERE i.workspace_id=NEW.workspace_id AND i.total_minor>
 COALESCE((SELECT SUM(p.amount_minor) FROM sales_payments p WHERE p.invoice_id=i.id AND p.workspace_id=i.workspace_id AND p.currency=i.currency),0));
END;
CREATE TRIGGER settings_identity_immutable BEFORE UPDATE OF workspace_id,key ON settings
WHEN NEW.workspace_id!=OLD.workspace_id OR NEW.key!=OLD.key BEGIN SELECT RAISE(ABORT,'setting identity is immutable'); END;
CREATE TRIGGER settings_no_delete BEFORE DELETE ON settings BEGIN SELECT RAISE(ABORT,'settings preserve configuration'); END;
CREATE TRIGGER threshold_identity_immutable BEFORE UPDATE OF workspace_id,type ON thresholds
WHEN NEW.workspace_id!=OLD.workspace_id OR NEW.type!=OLD.type BEGIN SELECT RAISE(ABORT,'threshold identity is immutable'); END;
CREATE TRIGGER thresholds_currency_insert BEFORE INSERT ON thresholds
WHEN NEW.currency IS NOT NULL AND NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
CREATE TRIGGER thresholds_currency_update BEFORE UPDATE OF value,currency ON thresholds
WHEN NEW.currency IS NOT NULL AND NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
CREATE TRIGGER supplier_bids_currency_insert BEFORE INSERT ON supplier_bids
WHEN NEW.status='submitted' AND NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=(SELECT workspace_id FROM procurement_rfqs WHERE id=NEW.rfq_id) AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
CREATE TRIGGER supplier_bids_currency_update BEFORE UPDATE OF currency,status,rfq_id ON supplier_bids
WHEN NEW.status='submitted' AND NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=(SELECT workspace_id FROM procurement_rfqs WHERE id=NEW.rfq_id) AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
CREATE TRIGGER sales_quote_revisions_currency_insert BEFORE INSERT ON sales_quote_revisions
WHEN NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
CREATE TRIGGER invoices_currency_insert BEFORE INSERT ON invoices
WHEN NEW.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
BEGIN SELECT RAISE(ABORT,'Use the factory currency.'); END;
-- Reopening an old RFQ must not reactivate bids in a different currency.
CREATE TRIGGER rfq_currency_reopen BEFORE UPDATE OF status ON procurement_rfqs
WHEN NEW.status IN ('open','closed') AND NEW.status!=OLD.status
BEGIN SELECT RAISE(ABORT,'Use the factory currency.') WHERE EXISTS (
 SELECT 1 FROM supplier_bids b WHERE b.rfq_id=NEW.id AND b.status='submitted'
 AND b.currency!=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=NEW.workspace_id AND key='currency'),'PKR')
); END;
