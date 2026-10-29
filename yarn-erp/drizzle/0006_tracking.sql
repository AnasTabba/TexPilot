-- Tracking spend control and honest DataLoopLabs sync state.
-- Coordinates:
--  * One configured provider account serves every workspace, so identifiers are
--    deduplicated in an ACCOUNT scope (provider + key fingerprint), never per workspace.
--    A workspace links its purchase orders/dispatch notices to the shared target.
--  * Billable units are containers when known, otherwise the B/L/booking number itself;
--    each unit owns a 30-day billing window measured from its last charge.
--  * Every authorized cost decision is an immutable ledger row; reservations are
--    reserved/committed/released; policy blocks are recorded, never silent.
CREATE TABLE tracking_targets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'datalooplabs',
  account_scope TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK(identifier_type IN ('bol','booking','container')),
  identifier TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT '',
  authorized INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_authorized'
    CHECK(status IN ('not_authorized','authorized','stale','provider_rejected','error','charge_uncertain','rate_limited','renewal_paused','budget_paused','config_blocked','closed')),
  provider_ref TEXT,
  provider_payload_json TEXT NOT NULL DEFAULT '',
  data_state TEXT NOT NULL DEFAULT 'none'
    CHECK(data_state IN ('none','live','unresolved','no_carrier_data','provider_unavailable','invalid_identifier','insufficient_credits','billing_authorization_pending')),
  last_sync_ok_at INTEGER, last_attempt_at INTEGER, next_sync_at INTEGER,
  last_error_kind TEXT, last_error_message TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(account_scope, identifier_type, identifier)
);
CREATE INDEX tracking_targets_scope ON tracking_targets(account_scope, status, next_sync_at);
CREATE TABLE tracking_target_links (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  target_id TEXT NOT NULL REFERENCES tracking_targets(id),
  purchase_order_id TEXT REFERENCES supplier_purchase_orders(id),
  shipment_id TEXT REFERENCES procurement_shipments(id),
  containers_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, target_id)
);
CREATE INDEX tracking_target_links_target ON tracking_target_links(target_id);
CREATE UNIQUE INDEX tracking_target_link_shipment ON tracking_target_links(shipment_id) WHERE shipment_id IS NOT NULL;

CREATE TABLE tracking_accounts (
  account_scope TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '', track_path TEXT NOT NULL DEFAULT '',
  contract_json TEXT NOT NULL DEFAULT '',
  contract_verified_at INTEGER, contract_note TEXT NOT NULL DEFAULT '',
  renewal_days INTEGER NOT NULL DEFAULT 30 CHECK(renewal_days BETWEEN 1 AND 365),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK(rate_limit_per_minute BETWEEN 1 AND 99),
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 720 CHECK(refresh_interval_minutes BETWEEN 60 AND 43200),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX tracking_account_provider ON tracking_accounts(provider) WHERE contract_verified_at IS NOT NULL;

-- One row per billable unit: identifier + container (container empty when unknown).
CREATE TABLE tracking_billing_windows (
  id TEXT PRIMARY KEY, account_scope TEXT NOT NULL,
  identifier_type TEXT NOT NULL, identifier TEXT NOT NULL, container TEXT NOT NULL DEFAULT '',
  last_charge_at INTEGER NOT NULL, window_open_until INTEGER NOT NULL, charge_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(account_scope, identifier_type, identifier, container)
);
CREATE TRIGGER tracking_billing_windows_immutable_charge BEFORE UPDATE ON tracking_billing_windows
WHEN NEW.last_charge_at < OLD.last_charge_at OR NEW.charge_count < OLD.charge_count
BEGIN SELECT RAISE(ABORT,'billing windows only extend'); END;

CREATE TABLE tracking_policies (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  monthly_credit_cap INTEGER, per_shipment_credit_cap INTEGER,
  auto_track TEXT NOT NULL DEFAULT 'manual' CHECK(auto_track IN ('manual','confirmed')),
  renewal_policy TEXT NOT NULL DEFAULT 'pause' CHECK(renewal_policy IN ('pause','allow')),
  force_refresh_policy TEXT NOT NULL DEFAULT 'explicit' CHECK(force_refresh_policy IN ('explicit','disabled')),
  credit_cost_minor INTEGER, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  CHECK(monthly_credit_cap IS NULL OR (monthly_credit_cap>0 AND monthly_credit_cap<=1000000)),
  CHECK(per_shipment_credit_cap IS NULL OR (per_shipment_credit_cap>0 AND per_shipment_credit_cap<=1000000)),
  CHECK(credit_cost_minor IS NULL OR (credit_cost_minor>=1 AND credit_cost_minor<=1000000))
);

CREATE TABLE tracking_reservations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), target_id TEXT NOT NULL REFERENCES tracking_targets(id),
  request_id TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('first_track','renewal','force_refresh','refresh')),
  credits INTEGER NOT NULL CHECK(credits>0), state TEXT NOT NULL DEFAULT 'reserved'
    CHECK(state IN ('reserved','committed','released','expired')),
  force_update INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, settled_at INTEGER,
  UNIQUE(request_id)
);
CREATE INDEX tracking_reservations_target ON tracking_reservations(target_id,state);
-- Concurrent authorizations with different request IDs converge on one reservation per target+purpose:
-- the second insert violates this partial index and the code returns the surviving reservation.
CREATE UNIQUE INDEX tracking_reservations_active ON tracking_reservations(target_id, purpose) WHERE state='reserved';

CREATE TABLE tracking_usage_events (
  id TEXT PRIMARY KEY, workspace_id TEXT, target_id TEXT,
  account_scope TEXT NOT NULL, identifier_type TEXT, identifier TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('reserve','commit','release','release_expired','policy_blocked')),
  credits INTEGER NOT NULL, purpose TEXT, month_bucket TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', actor_id TEXT, actor_type TEXT NOT NULL DEFAULT 'staff',
  created_at INTEGER NOT NULL
);
CREATE TRIGGER tracking_usage_no_update BEFORE UPDATE ON tracking_usage_events BEGIN SELECT RAISE(ABORT,'immutable credit ledger'); END;
CREATE TRIGGER tracking_usage_no_delete BEFORE DELETE ON tracking_usage_events BEGIN SELECT RAISE(ABORT,'immutable credit ledger'); END;
CREATE INDEX tracking_usage_month ON tracking_usage_events(workspace_id, account_scope, month_bucket, kind);

CREATE TABLE tracking_sync_jobs (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES tracking_targets(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('first_track','renewal','refresh','force_refresh')),
  force_update INTEGER NOT NULL DEFAULT 0,
  reservation_id TEXT REFERENCES tracking_reservations(id),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK(state IN ('queued','running','done','paused','failed','charge_uncertain','needs_reconcile','blocked_policy')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  last_error_kind TEXT, last_error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX tracking_sync_jobs_active ON tracking_sync_jobs(target_id) WHERE state IN ('queued','running','paused');
CREATE INDEX tracking_sync_jobs_due ON tracking_sync_jobs(state, next_attempt_at);

CREATE TABLE tracking_events (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES tracking_targets(id),
  event_at INTEGER NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL, order_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL, UNIQUE(target_id, dedupe_key)
);
CREATE INDEX tracking_events_target ON tracking_events(target_id, event_at DESC, order_index DESC);
CREATE TRIGGER tracking_events_no_update BEFORE UPDATE ON tracking_events BEGIN SELECT RAISE(ABORT,'provider history is append-only'); END;
CREATE TRIGGER tracking_events_no_delete BEFORE DELETE ON tracking_events BEGIN SELECT RAISE(ABORT,'provider history is append-only'); END;

CREATE TABLE tracking_webhook_receipts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, receipt_key TEXT NOT NULL,
  signature_state TEXT NOT NULL CHECK(signature_state IN ('accepted','rejected','manual_review')),
  payload_digest TEXT NOT NULL, applied_at INTEGER, received_at INTEGER NOT NULL,
  UNIQUE(provider, receipt_key)
);

CREATE TABLE tracking_rate_slots (
  account_scope TEXT NOT NULL, minute_bucket INTEGER NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY(account_scope, minute_bucket)
);
CREATE TRIGGER tracking_rate_slots_check AFTER INSERT ON tracking_rate_slots WHEN NEW.used<0
BEGIN SELECT RAISE(ABORT,'negative rate slot'); END;
