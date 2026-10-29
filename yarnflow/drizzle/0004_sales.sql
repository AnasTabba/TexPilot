-- 0004_sales.sql: buyers and scoped portal identities, buyer POs, versioned quotes with buyer
-- approval, confirmed sales orders and lines (frozen contract), one immutable numbered invoice per
-- approved revision, partial dispatch/delivery, delivery-triggered receivables, payments and
-- deduplicated reminders. Quantities are fixed point in a declared unit (quantity_milli);
-- mass stays integer grams; money is integer minor units with an explicit currency.

CREATE TABLE buyers (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
 city TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', request_hash TEXT,
 assigned_manager_id TEXT REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','suspended','archived')),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX buyers_workspace ON buyers(workspace_id,status,name);
--> statement-breakpoint
CREATE TABLE buyer_users (
 id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES buyers(id),
 email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
 failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE buyer_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES buyer_users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX buyer_sessions_user ON buyer_sessions(user_id);
--> statement-breakpoint
CREATE TABLE buyer_purchase_orders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), buyer_id TEXT NOT NULL REFERENCES buyers(id),
 reference TEXT NOT NULL, specifications TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=1000000000),
 unit TEXT NOT NULL CHECK(unit IN ('kg','metre','piece')),
 requested_delivery_at INTEGER NOT NULL, payment_terms TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('entered','quoted','confirmed','cancelled')),
 source TEXT NOT NULL CHECK(source IN ('staff','buyer_portal')), request_hash TEXT NOT NULL,
 created_by TEXT NOT NULL, actor_type TEXT NOT NULL CHECK(actor_type IN ('staff','buyer')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(workspace_id,reference)
);
CREATE TRIGGER buyer_po_terms_immutable BEFORE UPDATE ON buyer_purchase_orders
WHEN NEW.reference!=OLD.reference OR NEW.buyer_id!=OLD.buyer_id OR NEW.specifications!=OLD.specifications
 OR NEW.quantity_milli!=OLD.quantity_milli OR NEW.unit!=OLD.unit OR NEW.requested_delivery_at!=OLD.requested_delivery_at
 OR NEW.payment_terms!=OLD.payment_terms OR NEW.source!=OLD.source OR NEW.workspace_id!=OLD.workspace_id
 OR NEW.created_by!=OLD.created_by OR NEW.actor_type!=OLD.actor_type
BEGIN SELECT RAISE(ABORT,'entered buyer PO terms are immutable'); END;
CREATE TRIGGER buyer_pos_no_delete BEFORE DELETE ON buyer_purchase_orders BEGIN SELECT RAISE(ABORT,'buyer POs preserve the audit trail'); END;
--> statement-breakpoint
CREATE TABLE sales_quote_revisions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), buyer_po_id TEXT NOT NULL REFERENCES buyer_purchase_orders(id),
 buyer_id TEXT NOT NULL REFERENCES buyers(id), version INTEGER NOT NULL CHECK(version>=1),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=1000000000),
 unit TEXT NOT NULL CHECK(unit IN ('kg','metre','piece')),
 price_minor INTEGER NOT NULL CHECK(price_minor>0 AND price_minor<=1000000000),
 currency TEXT NOT NULL CHECK(currency IN ('PKR','USD','EUR','GBP')),
 specifications TEXT NOT NULL, requested_delivery_at INTEGER NOT NULL, payment_terms TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('draft','sent','approved')),
 product_id TEXT REFERENCES products(id),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(buyer_po_id,version)
);
CREATE TRIGGER validate_quote_revision BEFORE INSERT ON sales_quote_revisions BEGIN
 SELECT RAISE(ABORT,'invalid quote revision') WHERE NOT EXISTS (
  SELECT 1 FROM buyer_purchase_orders p JOIN buyers b ON b.id=p.buyer_id
  WHERE p.id=NEW.buyer_po_id AND p.workspace_id=NEW.workspace_id AND p.buyer_id=NEW.buyer_id
  AND b.workspace_id=NEW.workspace_id AND b.status='active' AND p.status IN ('entered','quoted')
 );
END;
-- The quoted terms are frozen once saved; only the delivery state may move forward.
CREATE TRIGGER quote_revision_terms_immutable BEFORE UPDATE ON sales_quote_revisions
WHEN NEW.status!=OLD.status OR NEW.quantity_milli!=OLD.quantity_milli OR NEW.unit!=OLD.unit OR NEW.price_minor!=OLD.price_minor
 OR NEW.currency!=OLD.currency OR NEW.specifications!=OLD.specifications OR NEW.requested_delivery_at!=OLD.requested_delivery_at
 OR NEW.payment_terms!=OLD.payment_terms OR NEW.note!=OLD.note OR NEW.buyer_po_id!=OLD.buyer_po_id OR NEW.buyer_id!=OLD.buyer_id
 OR NEW.version!=OLD.version OR NEW.workspace_id!=OLD.workspace_id OR NEW.created_by!=OLD.created_by
BEGIN
 SELECT RAISE(ABORT,'quoted terms are immutable') WHERE NEW.quantity_milli!=OLD.quantity_milli OR NEW.unit!=OLD.unit
  OR NEW.price_minor!=OLD.price_minor OR NEW.currency!=OLD.currency OR NEW.specifications!=OLD.specifications
  OR NEW.requested_delivery_at!=OLD.requested_delivery_at OR NEW.payment_terms!=OLD.payment_terms OR NEW.note!=OLD.note
  OR NEW.buyer_po_id!=OLD.buyer_po_id OR NEW.buyer_id!=OLD.buyer_id OR NEW.version!=OLD.version
  OR NEW.workspace_id!=OLD.workspace_id OR NEW.created_by!=OLD.created_by
  OR (OLD.status='draft' AND NEW.status!='sent') OR (OLD.status='sent' AND NEW.status!='approved') OR OLD.status='approved';
END;
CREATE TRIGGER quote_revisions_no_delete BEFORE DELETE ON sales_quote_revisions BEGIN SELECT RAISE(ABORT,'quote revisions preserve the audit trail'); END;
--> statement-breakpoint
CREATE TABLE buyer_approvals (
 id TEXT PRIMARY KEY, revision_id TEXT NOT NULL UNIQUE REFERENCES sales_quote_revisions(id),
 buyer_id TEXT NOT NULL REFERENCES buyers(id), user_id TEXT NOT NULL REFERENCES buyer_users(id),
 version INTEGER NOT NULL, terms_digest TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TRIGGER buyer_approvals_no_update BEFORE UPDATE ON buyer_approvals BEGIN SELECT RAISE(ABORT,'buyer approvals are immutable'); END;
CREATE TRIGGER buyer_approvals_no_delete BEFORE DELETE ON buyer_approvals BEGIN SELECT RAISE(ABORT,'buyer approvals are immutable'); END;
--> statement-breakpoint
CREATE TABLE sales_orders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), reference TEXT NOT NULL,
 buyer_id TEXT NOT NULL REFERENCES buyers(id), buyer_po_id TEXT NOT NULL UNIQUE REFERENCES buyer_purchase_orders(id),
 revision_id TEXT NOT NULL UNIQUE REFERENCES sales_quote_revisions(id),
 status TEXT NOT NULL CHECK(status IN ('confirmed','partially_dispatched','dispatched','cancelled')),
 terms_snapshot TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(workspace_id,reference)
);
CREATE TRIGGER sales_order_terms_immutable BEFORE UPDATE ON sales_orders
WHEN NEW.buyer_po_id!=OLD.buyer_po_id OR NEW.revision_id!=OLD.revision_id OR NEW.buyer_id!=OLD.buyer_id
 OR NEW.workspace_id!=OLD.workspace_id OR NEW.reference!=OLD.reference OR NEW.terms_snapshot!=OLD.terms_snapshot OR NEW.created_by!=OLD.created_by
BEGIN SELECT RAISE(ABORT,'confirmed sales terms are immutable'); END;
CREATE TRIGGER sales_orders_no_delete BEFORE DELETE ON sales_orders BEGIN SELECT RAISE(ABORT,'sales orders preserve the audit trail'); END;
--> statement-breakpoint
CREATE TABLE sales_order_lines (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
 product_id TEXT REFERENCES products(id), specifications TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=1000000000),
 unit TEXT NOT NULL CHECK(unit IN ('kg','metre','piece')), created_at INTEGER NOT NULL
);
CREATE INDEX sales_order_lines_order ON sales_order_lines(sales_order_id);
--> statement-breakpoint
CREATE TABLE document_counters (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK(kind IN ('invoice')),
 period TEXT NOT NULL, next_number INTEGER NOT NULL CHECK(next_number>=1),
 PRIMARY KEY(workspace_id,kind,period)
);
--> statement-breakpoint
CREATE TABLE invoices (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), number TEXT NOT NULL,
 sales_order_id TEXT NOT NULL REFERENCES sales_orders(id), revision_id TEXT NOT NULL UNIQUE REFERENCES sales_quote_revisions(id),
 buyer_id TEXT NOT NULL REFERENCES buyers(id), lines_json TEXT NOT NULL,
 total_minor INTEGER NOT NULL CHECK(total_minor>0), currency TEXT NOT NULL CHECK(currency IN ('PKR','USD','EUR','GBP')),
 issued_at INTEGER NOT NULL, UNIQUE(workspace_id,number)
);
CREATE TRIGGER invoices_immutable_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT,'invoices are immutable'); END;
CREATE TRIGGER invoices_immutable_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'invoices are immutable'); END;
--> statement-breakpoint
CREATE TABLE sales_dispatches (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id), lot_id TEXT NOT NULL REFERENCES lots(id),
 from_stage TEXT NOT NULL CHECK(from_stage IN ('finished','cops')),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=1000000000),
 unit TEXT NOT NULL CHECK(unit IN ('kg','metre','piece')),
 grams INTEGER NOT NULL CHECK(grams>0 AND grams<=9000000000000),
 cartons INTEGER NOT NULL DEFAULT 0 CHECK(cartons>=0), cones INTEGER NOT NULL DEFAULT 0 CHECK(cones>=0),
 carrier TEXT NOT NULL, packages_json TEXT NOT NULL DEFAULT '[]', documents_note TEXT NOT NULL DEFAULT '',
 dispatched_at INTEGER NOT NULL, request_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_sales_dispatch BEFORE INSERT ON sales_dispatches BEGIN
 SELECT RAISE(ABORT,'invalid sales dispatch') WHERE NEW.from_stage NOT IN ('finished','cops')
  OR (NEW.unit='kg' AND NEW.grams!=NEW.quantity_milli) OR NOT EXISTS (
  SELECT 1 FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id
  WHERE o.id=NEW.sales_order_id AND o.workspace_id=NEW.workspace_id AND o.status IN ('confirmed','partially_dispatched')
  AND l.unit=NEW.unit AND NEW.quantity_milli>0
  AND l.quantity_milli>=NEW.quantity_milli+COALESCE((SELECT SUM(d.quantity_milli) FROM sales_dispatches d
    WHERE d.sales_order_id=o.id AND NOT EXISTS(SELECT 1 FROM movements rm WHERE rm.reverses=d.movement_id)),0)
  AND (l.product_id IS NULL OR l.product_id=(SELECT product_id FROM lots WHERE id=NEW.lot_id))
  AND NEW.lot_id IN (SELECT id FROM lots WHERE workspace_id=NEW.workspace_id AND quality='approved')
  AND EXISTS (SELECT 1 FROM balances WHERE lot_id=NEW.lot_id AND stage=NEW.from_stage AND grams>=NEW.grams AND cartons>=NEW.cartons AND cones>=NEW.cones)
 );
END;
CREATE TRIGGER sales_dispatches_no_update BEFORE UPDATE ON sales_dispatches BEGIN SELECT RAISE(ABORT,'immutable dispatch'); END;
CREATE TRIGGER sales_dispatches_no_delete BEFORE DELETE ON sales_dispatches BEGIN SELECT RAISE(ABORT,'immutable dispatch'); END;
--> statement-breakpoint
CREATE TABLE sales_deliveries (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), dispatch_id TEXT NOT NULL UNIQUE REFERENCES sales_dispatches(id),
 delivery_date INTEGER NOT NULL, evidence_note TEXT NOT NULL DEFAULT '',
 confirmed_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER sales_deliveries_no_update BEFORE UPDATE ON sales_deliveries BEGIN SELECT RAISE(ABORT,'deliveries are immutable; record an audited correction'); END;
CREATE TRIGGER sales_deliveries_no_delete BEFORE DELETE ON sales_deliveries BEGIN SELECT RAISE(ABORT,'immutable delivery'); END;
--> statement-breakpoint
CREATE TABLE delivery_corrections (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), delivery_id TEXT NOT NULL REFERENCES sales_deliveries(id),
 previous_date INTEGER NOT NULL, corrected_date INTEGER NOT NULL, due_revision INTEGER NOT NULL,
 reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER delivery_corrections_no_update BEFORE UPDATE ON delivery_corrections BEGIN SELECT RAISE(ABORT,'immutable correction'); END;
CREATE TRIGGER delivery_corrections_no_delete BEFORE DELETE ON delivery_corrections BEGIN SELECT RAISE(ABORT,'immutable correction'); END;
--> statement-breakpoint
CREATE TABLE receivables (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 delivery_id TEXT NOT NULL UNIQUE REFERENCES sales_deliveries(id), buyer_id TEXT NOT NULL REFERENCES buyers(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), paid_minor INTEGER NOT NULL DEFAULT 0 CHECK(paid_minor>=0 AND paid_minor<=amount_minor),
 currency TEXT NOT NULL, due_at INTEGER NOT NULL, due_revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('open','settled')), created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_receivable BEFORE INSERT ON receivables BEGIN
 SELECT RAISE(ABORT,'invalid receivable') WHERE NOT EXISTS (
  SELECT 1 FROM sales_deliveries d JOIN sales_dispatches x ON x.id=d.dispatch_id JOIN sales_orders o ON o.id=x.sales_order_id
   JOIN invoices i ON i.sales_order_id=o.id
  WHERE d.id=NEW.delivery_id AND d.workspace_id=NEW.workspace_id AND d.delivery_date<=NEW.due_at
   AND i.id=NEW.invoice_id AND i.buyer_id=NEW.buyer_id AND i.currency=NEW.currency
 );
END;
CREATE TRIGGER receivable_links_immutable BEFORE UPDATE ON receivables
WHEN NEW.invoice_id!=OLD.invoice_id OR NEW.delivery_id!=OLD.delivery_id OR NEW.buyer_id!=OLD.buyer_id
 OR NEW.amount_minor!=OLD.amount_minor OR NEW.currency!=OLD.currency OR NEW.created_at!=OLD.created_at OR NEW.workspace_id!=OLD.workspace_id
BEGIN SELECT RAISE(ABORT,'receivable amounts are immutable; correct the delivery instead'); END;
CREATE TRIGGER receivables_no_delete BEFORE DELETE ON receivables BEGIN SELECT RAISE(ABORT,'receivables preserve the audit trail'); END;
--> statement-breakpoint
CREATE TABLE sales_payments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 receivable_id TEXT NOT NULL REFERENCES receivables(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 currency TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_sales_payment BEFORE INSERT ON sales_payments BEGIN
 SELECT RAISE(ABORT,'invalid payment') WHERE NOT EXISTS (
  SELECT 1 FROM receivables r JOIN invoices i ON i.id=r.invoice_id
  WHERE r.id=NEW.receivable_id AND r.workspace_id=NEW.workspace_id AND r.status='open'
  AND i.id=NEW.invoice_id AND i.currency=NEW.currency AND NEW.currency=i.currency
  AND NEW.amount_minor<=r.amount_minor-r.paid_minor
 );
END;
CREATE TRIGGER apply_payment AFTER INSERT ON sales_payments BEGIN
 UPDATE receivables SET paid_minor=paid_minor+NEW.amount_minor,
  status=CASE WHEN paid_minor+NEW.amount_minor>=amount_minor THEN 'settled' ELSE 'open' END
 WHERE id=NEW.receivable_id;
END;
CREATE TRIGGER sales_payments_no_update BEFORE UPDATE ON sales_payments BEGIN SELECT RAISE(ABORT,'payments are immutable'); END;
CREATE TRIGGER sales_payments_no_delete BEFORE DELETE ON sales_payments BEGIN SELECT RAISE(ABORT,'payments are immutable'); END;
--> statement-breakpoint
CREATE TABLE sales_reminders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), receivable_id TEXT NOT NULL REFERENCES receivables(id),
 kind TEXT NOT NULL CHECK(kind IN ('due_soon','overdue')), due_revision INTEGER NOT NULL,
 target_user_id TEXT NOT NULL, target_role TEXT NOT NULL CHECK(target_role IN ('sales_manager','admin')),
 created_at INTEGER NOT NULL, UNIQUE(receivable_id,kind,due_revision)
);
CREATE TRIGGER sales_reminders_no_update BEFORE UPDATE ON sales_reminders BEGIN SELECT RAISE(ABORT,'immutable reminder'); END;
CREATE TRIGGER sales_reminders_no_delete BEFORE DELETE ON sales_reminders BEGIN SELECT RAISE(ABORT,'immutable reminder'); END;
--> statement-breakpoint
CREATE TABLE sales_outbox (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK(kind IN ('quote_sent','invoice_document')),
 buyer_id TEXT NOT NULL REFERENCES buyers(id), invoice_id TEXT REFERENCES invoices(id), revision_id TEXT REFERENCES sales_quote_revisions(id),
 state TEXT NOT NULL CHECK(state IN ('queued','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_attempted_at INTEGER, sent_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX sales_outbox_workspace ON sales_outbox(workspace_id,state,created_at);
--> statement-breakpoint
-- Granted additive extension (root, 2026-10-28): erp_audit_events.actor_type admits 'buyer' so
-- buyer-portal actions (PO submission, quote approval) land in the same immutable audit trail.
-- SQLite cannot alter a CHECK constraint in place, so this is the rehearsed table rebuild:
-- the new table differs only in the CHECK, all rows are copied, and the immutability triggers
-- are recreated verbatim. A future actor (e.g. 'chat') is one more rebuild of exactly this shape.
CREATE TABLE erp_audit_events_buyer (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('staff','supplier','buyer')), action TEXT NOT NULL,
  record_id TEXT NOT NULL, detail_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
INSERT INTO erp_audit_events_buyer(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at)
  SELECT id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at FROM erp_audit_events;
DROP TABLE erp_audit_events;
ALTER TABLE erp_audit_events_buyer RENAME TO erp_audit_events;
CREATE TRIGGER erp_audit_no_update BEFORE UPDATE ON erp_audit_events BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER erp_audit_no_delete BEFORE DELETE ON erp_audit_events BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
