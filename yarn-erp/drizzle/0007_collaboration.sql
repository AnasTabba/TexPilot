-- Operational collaboration for staff: direct conversations, explicit-membership team rooms,
-- entity-linked threads, protected attachments, and a deduplicated operational-event outbox.
-- Additive migration. It references only tables that already exist in this branch
-- (workspaces, users, products). Cross-module entity links (sales 0004, production 0005,
-- tracking 0006) are deliberately plain indexed columns validated in server/collaboration.mjs
-- against real tables at integration time; they are never invented here.

CREATE TABLE collab_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK(kind IN ('direct','team','entity','external')),
  title TEXT NOT NULL DEFAULT '' CHECK(length(title) <= 120),
  -- Plain indexed columns validated by the server; a DB-level FK here would break integration
  -- sequencing with the sales/production migrations shipped by parallel workers.
  entity_type TEXT CHECK(entity_type IN ('lot','rfq','purchase_order','shipment','production_batch','sales_order')),
  entity_id TEXT,
  -- Only kind='external' carries a supplier id; internal channels can never contain a supplier.
  supplier_id TEXT REFERENCES suppliers(id),
  direct_key TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK(
    (kind = 'direct' AND entity_type IS NULL AND entity_id IS NULL AND supplier_id IS NULL AND direct_key IS NOT NULL) OR
    (kind = 'team' AND entity_type IS NULL AND entity_id IS NULL AND supplier_id IS NULL AND direct_key IS NULL) OR
    (kind = 'entity' AND entity_type IS NOT NULL AND entity_id IS NOT NULL AND supplier_id IS NULL AND direct_key IS NULL) OR
    (kind = 'external' AND entity_type IS NULL AND entity_id IS NULL AND supplier_id IS NOT NULL AND direct_key IS NULL)
  )
);
CREATE INDEX collab_conversations_workspace ON collab_conversations(workspace_id, created_at DESC, id DESC);
CREATE INDEX collab_conversations_entity ON collab_conversations(workspace_id, entity_type, entity_id);
CREATE INDEX collab_conversations_supplier ON collab_conversations(workspace_id, supplier_id);
CREATE UNIQUE INDEX collab_conversations_direct ON collab_conversations(workspace_id, direct_key) WHERE direct_key IS NOT NULL;
CREATE UNIQUE INDEX collab_conversations_external ON collab_conversations(workspace_id, supplier_id) WHERE kind = 'external';

CREATE TABLE collab_members (
  conversation_id TEXT NOT NULL REFERENCES collab_conversations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
  muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
  last_read_gseq INTEGER NOT NULL DEFAULT 0,
  added_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(conversation_id, user_id)
);
CREATE INDEX collab_members_user ON collab_members(workspace_id, user_id);

CREATE TABLE collab_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES collab_conversations(id) ON DELETE CASCADE,
  gseq INTEGER NOT NULL CHECK(gseq > 0),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL CHECK(length(sender_name) <= 80),
  body TEXT NOT NULL CHECK(length(body) <= 2000),
  -- Card references only (type + id). Card contents are generated at read time from live
  -- tables, so access changes apply immediately and price data is never copied into chat.
  references_json TEXT NOT NULL DEFAULT '[]',
  request_hash TEXT NOT NULL,
  reply_to TEXT REFERENCES collab_messages(id),
  removed_by TEXT, removed_at INTEGER, removed_reason TEXT CHECK(length(removed_reason) <= 300),
  created_at INTEGER NOT NULL,
  UNIQUE(conversation_id, gseq)
);
CREATE INDEX collab_messages_workspace ON collab_messages(workspace_id, gseq DESC);
CREATE INDEX collab_messages_created ON collab_messages(created_at);

CREATE TABLE collab_mentions (
  message_id TEXT NOT NULL REFERENCES collab_messages(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  mentioned_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(message_id, mentioned_user_id)
);
CREATE INDEX collab_mentions_user ON collab_mentions(workspace_id, mentioned_user_id, created_at DESC);

CREATE TABLE collab_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES collab_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES collab_messages(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  file_name TEXT NOT NULL CHECK(length(file_name) <= 120),
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 10485760),
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX collab_attachments_message ON collab_attachments(message_id);

-- Outbox of operational events. Rows are only written by server transitions or documented
-- event hooks reading committed domain rows; chat text can never create one. One committed
-- source row fans out at most once: dedupe repeats into this UNIQUE key and the notification
-- fan-out itself is UNIQUE(event_id, user_id).
CREATE TABLE collab_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK(kind IN ('low_stock','material_inspected','shipment_status','task_mention','chat_mention')),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('product','lot','shipment','purchase_order','task','message')),
  entity_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) <= 200),
  subject TEXT NOT NULL CHECK(length(subject) <= 200),
  detail_json TEXT NOT NULL DEFAULT '{}',
  link TEXT NOT NULL DEFAULT '' CHECK(length(link) <= 300),
  recipients_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, dedupe_key)
);
CREATE INDEX collab_events_workspace ON collab_events(workspace_id, created_at DESC, id DESC);

CREATE TABLE collab_notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  event_id TEXT NOT NULL REFERENCES collab_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(event_id, user_id)
);
CREATE INDEX collab_notifications_user ON collab_notifications(workspace_id, user_id, acknowledged_at, created_at DESC);

-- Notification-kind mutes ("alert spam" controls). Per user, per kind.
CREATE TABLE collab_mutes (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('low_stock','material_inspected','shipment_status','task_mention','chat_mention')),
  muted_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, user_id, kind)
);

-- Low-stock alert thresholds and the live alert state (per material and stock stage).
CREATE TABLE collab_stock_thresholds (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('raw','wip','finished','cops')),
  threshold_grams INTEGER NOT NULL CHECK(threshold_grams >= 0),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, product_id, stage)
);
CREATE TABLE collab_stock_alert_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('raw','wip','finished','cops')),
  alerting INTEGER NOT NULL DEFAULT 0 CHECK(alerting IN (0,1)),
  generations INTEGER NOT NULL DEFAULT 0,
  threshold_grams INTEGER NOT NULL DEFAULT 0,
  since INTEGER,
  cleared_at INTEGER,
  PRIMARY KEY(workspace_id, product_id, stage)
);
