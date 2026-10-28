CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  expires_at INTEGER NOT NULL, remaining INTEGER NOT NULL CHECK(remaining >= 0),
  created_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE memberships (
  user_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL CHECK(role IN ('owner','operator')), name TEXT NOT NULL,
  invite_hash TEXT REFERENCES invites(token_hash), joined_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE products (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  sku TEXT NOT NULL, name TEXT NOT NULL, barcode TEXT, created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, sku), UNIQUE(workspace_id, barcode)
);
--> statement-breakpoint
CREATE TABLE lots (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  product_id TEXT NOT NULL REFERENCES products(id), batch TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '', quality TEXT NOT NULL DEFAULT 'uninspected'
    CHECK(quality IN ('uninspected','approved','hold')),
  created_at INTEGER NOT NULL, UNIQUE(workspace_id, product_id, batch)
);
--> statement-breakpoint
CREATE TABLE movements (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  lot_id TEXT NOT NULL REFERENCES lots(id),
  action TEXT NOT NULL CHECK(action IN ('receive','dispatch','transfer','waste','reverse')),
  from_stage TEXT, to_stage TEXT,
  grams INTEGER NOT NULL CHECK(grams > 0 AND grams <= 9000000000000),
  cartons INTEGER NOT NULL CHECK(cartons >= 0), cones INTEGER NOT NULL CHECK(cones >= 0),
  note TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
  reverses TEXT UNIQUE REFERENCES movements(id), request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE balances (
  lot_id TEXT NOT NULL REFERENCES lots(id), stage TEXT NOT NULL CHECK(stage IN ('raw','wip','finished','cops')),
  grams INTEGER NOT NULL DEFAULT 0 CHECK(grams >= 0 AND grams <= 9000000000000),
  cartons INTEGER NOT NULL DEFAULT 0 CHECK(cartons >= 0 AND cartons <= 1000000000),
  cones INTEGER NOT NULL DEFAULT 0 CHECK(cones >= 0 AND cones <= 1000000000),
  PRIMARY KEY(lot_id,stage)
);
--> statement-breakpoint
CREATE TABLE stock_deltas (
  id TEXT PRIMARY KEY, movement_id TEXT NOT NULL REFERENCES movements(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), stage TEXT NOT NULL CHECK(stage IN ('raw','wip','finished','cops')),
  grams INTEGER NOT NULL, cartons INTEGER NOT NULL, cones INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE quality_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), status TEXT NOT NULL, note TEXT NOT NULL,
  actor TEXT NOT NULL, actor_name TEXT NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE inspections (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), label_text TEXT NOT NULL, note TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','client-texpilot')),
  result_json TEXT, actor TEXT NOT NULL, actor_name TEXT NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE inspection_photos (
  id TEXT PRIMARY KEY REFERENCES inspections(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  lot_id TEXT NOT NULL REFERENCES lots(id), object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL, content_hash TEXT NOT NULL, size INTEGER NOT NULL,
  actor_name TEXT NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX movements_workspace_time ON movements(workspace_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX lots_workspace ON lots(workspace_id);
--> statement-breakpoint
CREATE TRIGGER validate_invite BEFORE INSERT ON memberships WHEN NEW.invite_hash IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'invalid invite') WHERE NOT EXISTS (
    SELECT 1 FROM invites WHERE token_hash=NEW.invite_hash AND workspace_id=NEW.workspace_id
    AND expires_at > unixepoch()*1000 AND remaining > 0
  );
  UPDATE invites SET remaining=remaining-1 WHERE token_hash=NEW.invite_hash;
END;
--> statement-breakpoint
CREATE TRIGGER validate_movement BEFORE INSERT ON movements BEGIN
  SELECT RAISE(ABORT,'lot not in workspace') WHERE NOT EXISTS (
    SELECT 1 FROM lots WHERE id=NEW.lot_id AND workspace_id=NEW.workspace_id
  );
  SELECT RAISE(ABORT,'QC approval required') WHERE NEW.action='dispatch' AND NOT EXISTS (
    SELECT 1 FROM lots WHERE id=NEW.lot_id AND quality='approved'
  );
  SELECT RAISE(ABORT,'held lot cannot move') WHERE NEW.action='transfer' AND EXISTS (
    SELECT 1 FROM lots WHERE id=NEW.lot_id AND quality='hold'
  );
END;
--> statement-breakpoint
CREATE TRIGGER apply_stock_delta AFTER INSERT ON stock_deltas BEGIN
  INSERT INTO balances(lot_id,stage) VALUES(NEW.lot_id,NEW.stage) ON CONFLICT DO NOTHING;
  UPDATE balances SET grams=grams+NEW.grams,cartons=cartons+NEW.cartons,cones=cones+NEW.cones
    WHERE lot_id=NEW.lot_id AND stage=NEW.stage;
END;
--> statement-breakpoint
CREATE TRIGGER movements_immutable_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER movements_immutable_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER deltas_immutable_update BEFORE UPDATE ON stock_deltas BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER deltas_immutable_delete BEFORE DELETE ON stock_deltas BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER quality_immutable_update BEFORE UPDATE ON quality_events BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
--> statement-breakpoint
CREATE TRIGGER quality_immutable_delete BEFORE DELETE ON quality_events BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
