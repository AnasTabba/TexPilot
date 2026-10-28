CREATE TABLE goods_receipts (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 purchase_order_id TEXT NOT NULL REFERENCES supplier_purchase_orders(id),
 product_id TEXT NOT NULL REFERENCES products(id), lot_id TEXT NOT NULL UNIQUE REFERENCES lots(id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id), quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 grams INTEGER NOT NULL CHECK(grams>0), supplier_lot TEXT NOT NULL, request_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE receipt_reversals (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE REFERENCES goods_receipts(id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES movements(id), reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_goods_receipt BEFORE INSERT ON goods_receipts BEGIN
 SELECT RAISE(ABORT,'invalid receipt quantity or order') WHERE NOT EXISTS (
  SELECT 1 FROM supplier_purchase_orders p JOIN procurement_rfqs r ON r.id=p.rfq_id JOIN products m ON m.id=NEW.product_id JOIN lots l ON l.id=NEW.lot_id
  WHERE p.id=NEW.purchase_order_id AND p.workspace_id=NEW.workspace_id AND m.workspace_id=p.workspace_id AND l.workspace_id=p.workspace_id AND l.product_id=m.id
  AND p.status IN ('accepted','dispatched','received')
  AND NEW.grams=NEW.quantity_milli * CASE r.unit WHEN 'tonne' THEN 1000 ELSE 1 END
  AND NEW.quantity_milli + COALESCE((SELECT SUM(g.quantity_milli) FROM goods_receipts g WHERE g.purchase_order_id=p.id AND NOT EXISTS(SELECT 1 FROM receipt_reversals v WHERE v.receipt_id=g.id)),0)<=r.quantity_milli
 );
END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON goods_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON goods_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE TRIGGER receipt_reversals_no_update BEFORE UPDATE ON receipt_reversals BEGIN SELECT RAISE(ABORT,'immutable receipt reversal'); END;
CREATE TRIGGER receipt_reversals_no_delete BEFORE DELETE ON receipt_reversals BEGIN SELECT RAISE(ABORT,'immutable receipt reversal'); END;

DROP TRIGGER validate_movement;
CREATE TRIGGER validate_movement BEFORE INSERT ON movements BEGIN
 SELECT RAISE(ABORT,'lot not in workspace') WHERE NOT EXISTS (SELECT 1 FROM lots WHERE id=NEW.lot_id AND workspace_id=NEW.workspace_id);
 SELECT RAISE(ABORT,'QC approval required') WHERE (NEW.action='dispatch' OR (NEW.action='transfer' AND NEW.from_stage='raw')) AND NOT EXISTS (SELECT 1 FROM lots WHERE id=NEW.lot_id AND quality='approved');
 SELECT RAISE(ABORT,'held lot cannot move') WHERE NEW.action='transfer' AND EXISTS (SELECT 1 FROM lots WHERE id=NEW.lot_id AND quality='hold');
END;
