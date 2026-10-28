CREATE TABLE supplier_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, urdu_name TEXT NOT NULL, sort_order INTEGER NOT NULL
);
INSERT INTO supplier_categories VALUES
 ('cotton','Pure Cotton','خالص کپاس',1),
 ('blended','Blended (PC/CVC/PV)','ملاوٹ شدہ دھاگا (PC/CVC/PV)',2),
 ('synthetic','Synthetic and Filament','مصنوعی اور فلامنٹ',3),
 ('fancy','Fancy and Speciality','فینسی اور خصوصی',4),
 ('processed','Processed and Dyed','پروسیس شدہ اور رنگا ہوا',5),
 ('sustainable','Sustainable and Eco-Friendly','پائیدار اور ماحول دوست',6);

CREATE TABLE suppliers (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
 city TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
 source_checked_at INTEGER, status TEXT NOT NULL CHECK(status IN ('directory','pending','approved','rejected','suspended','archived')),
 request_hash TEXT, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX suppliers_workspace ON suppliers(workspace_id,status,name);
CREATE TABLE supplier_category_links (
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), category_id TEXT NOT NULL REFERENCES supplier_categories(id),
 PRIMARY KEY(supplier_id,category_id)
);
CREATE TABLE supplier_users (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
 failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE supplier_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES supplier_users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX supplier_sessions_user ON supplier_sessions(user_id);
CREATE TABLE supplier_registration_reviews (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), version INTEGER NOT NULL,
 status TEXT NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(supplier_id,version)
);
CREATE TABLE portal_rate_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE erp_audit_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL,
 actor_type TEXT NOT NULL CHECK(actor_type IN ('staff','supplier')), action TEXT NOT NULL,
 record_id TEXT NOT NULL, detail_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER erp_audit_no_update BEFORE UPDATE ON erp_audit_events BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER erp_audit_no_delete BEFORE DELETE ON erp_audit_events BEGIN SELECT RAISE(ABORT,'immutable audit'); END;

CREATE TABLE procurement_rfqs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), reference TEXT NOT NULL,
 title TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES supplier_categories(id), specifications TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=1000000000),
 unit TEXT NOT NULL CHECK(unit IN ('kg','tonne')), delivery_location TEXT NOT NULL,
 deadline_at INTEGER NOT NULL, requested_delivery_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','open','awarded','closed')),
 request_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER,
 UNIQUE(workspace_id,reference)
);
CREATE TABLE rfq_recipients (
 rfq_id TEXT NOT NULL REFERENCES procurement_rfqs(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 supplier_snapshot TEXT NOT NULL, delivered_at INTEGER NOT NULL, PRIMARY KEY(rfq_id,supplier_id)
);
CREATE TABLE supplier_bids (
 id TEXT PRIMARY KEY, rfq_id TEXT NOT NULL REFERENCES procurement_rfqs(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), price_minor INTEGER NOT NULL CHECK(price_minor>0 AND price_minor<=1000000000),
 currency TEXT NOT NULL CHECK(currency IN ('PKR','USD','EUR','GBP')),
 payment_terms TEXT NOT NULL, delivery_at INTEGER NOT NULL, valid_until INTEGER NOT NULL,
 note TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('submitted','rejected')), rejection_reason TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(rfq_id,supplier_id)
);
CREATE TABLE supplier_bid_history (
 id TEXT PRIMARY KEY, bid_id TEXT NOT NULL REFERENCES supplier_bids(id), version INTEGER NOT NULL,
 snapshot TEXT NOT NULL, actor_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(bid_id,version)
);
CREATE TRIGGER validate_bid_insert BEFORE INSERT ON supplier_bids BEGIN
 SELECT RAISE(ABORT,'RFQ not available') WHERE NOT EXISTS (
  SELECT 1 FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id JOIN suppliers s ON s.id=x.supplier_id
  WHERE r.id=NEW.rfq_id AND s.id=NEW.supplier_id AND s.workspace_id=r.workspace_id
  AND r.status='open' AND r.deadline_at>unixepoch()*1000 AND s.status='approved'
 );
END;
CREATE TRIGGER validate_bid_edit BEFORE UPDATE ON supplier_bids WHEN NEW.version!=OLD.version BEGIN
 SELECT RAISE(ABORT,'RFQ not available') WHERE NOT EXISTS (
  SELECT 1 FROM procurement_rfqs r JOIN suppliers s ON s.id=NEW.supplier_id
  WHERE r.id=NEW.rfq_id AND r.status='open' AND r.deadline_at>unixepoch()*1000 AND s.status='approved'
 ) OR OLD.status!='submitted' OR NEW.version!=OLD.version+1;
END;
CREATE TRIGGER bid_history_no_update BEFORE UPDATE ON supplier_bid_history BEGIN SELECT RAISE(ABORT,'immutable bid revision'); END;
CREATE TRIGGER bid_history_no_delete BEFORE DELETE ON supplier_bid_history BEGIN SELECT RAISE(ABORT,'immutable bid revision'); END;
CREATE TABLE supplier_purchase_orders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), rfq_id TEXT NOT NULL UNIQUE REFERENCES procurement_rfqs(id),
 bid_id TEXT NOT NULL REFERENCES supplier_bids(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 reference TEXT NOT NULL, terms_snapshot TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('accepted','dispatched','received','cancelled')),
 accepted_by TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(workspace_id,reference)
);
CREATE TABLE procurement_shipments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), purchase_order_id TEXT NOT NULL REFERENCES supplier_purchase_orders(id),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), bill_of_lading TEXT NOT NULL, carrier TEXT NOT NULL,
 containers_json TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 dispatched_at INTEGER NOT NULL, note TEXT NOT NULL, request_hash TEXT NOT NULL,
 tracking_status TEXT NOT NULL DEFAULT 'not_connected', created_at INTEGER NOT NULL
);
CREATE TRIGGER purchase_terms_immutable BEFORE UPDATE ON supplier_purchase_orders
WHEN NEW.terms_snapshot!=OLD.terms_snapshot OR NEW.rfq_id!=OLD.rfq_id OR NEW.bid_id!=OLD.bid_id OR NEW.supplier_id!=OLD.supplier_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.reference!=OLD.reference OR NEW.accepted_by!=OLD.accepted_by
BEGIN SELECT RAISE(ABORT,'accepted purchase terms are immutable'); END;
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON supplier_purchase_orders BEGIN SELECT RAISE(ABORT,'purchase orders preserve the audit trail'); END;
CREATE INDEX shipments_order ON procurement_shipments(purchase_order_id);
CREATE TRIGGER validate_procurement_dispatch BEFORE INSERT ON procurement_shipments BEGIN
 SELECT RAISE(ABORT,'invalid shipment order') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_purchase_orders p JOIN procurement_rfqs r ON r.id=p.rfq_id
  WHERE p.id=NEW.purchase_order_id AND p.workspace_id=NEW.workspace_id AND p.supplier_id=NEW.supplier_id
  AND p.status IN ('accepted','dispatched') AND
  NEW.quantity_milli + COALESCE((SELECT SUM(quantity_milli) FROM procurement_shipments WHERE purchase_order_id=p.id),0)<=r.quantity_milli
 );
END;
CREATE TRIGGER procurement_shipment_no_update BEFORE UPDATE ON procurement_shipments BEGIN SELECT RAISE(ABORT,'immutable dispatch notice'); END;
CREATE TRIGGER procurement_shipment_no_delete BEFORE DELETE ON procurement_shipments BEGIN SELECT RAISE(ABORT,'immutable dispatch notice'); END;
