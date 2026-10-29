-- Task 14: the factory's outbound dispatch lifecycle. The dispatcher asks, the sales manager approves
-- it or holds it with a term, and goods leave only when the dispatch itself runs: one batch writes the
-- sale dispatch, the ledger movement and the order status together with the dispatch row. The factory
-- floor may hold an approved dispatch only after a sales-manager hold notice, and stock problems go to
-- the supervisor as stock issues whose thresholds gate the accepted correction to the admin.

CREATE TABLE dispatches (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id), lot_id TEXT NOT NULL REFERENCES lots(id),
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0 AND quantity_milli <= 1000000000),
  grams INTEGER NOT NULL CHECK(grams > 0 AND grams <= 9000000000000),
  cartons INTEGER NOT NULL DEFAULT 0 CHECK(cartons >= 0), cones INTEGER NOT NULL DEFAULT 0 CHECK(cones >= 0),
  status TEXT NOT NULL CHECK(status IN ('pending_approval','approved','on_hold','dispatched','delivered')),
  hold_reason TEXT, vehicle TEXT NOT NULL DEFAULT '', transporter TEXT NOT NULL DEFAULT '',
  delivery_proof TEXT NOT NULL DEFAULT '', sales_dispatch_id TEXT REFERENCES sales_dispatches(id),
  version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, dispatched_at INTEGER, delivered_at INTEGER,
  CHECK(status != 'on_hold' OR length(trim(COALESCE(hold_reason,''))) >= 5),
  CHECK(status NOT IN ('dispatched','delivered') OR (dispatched_at IS NOT NULL AND sales_dispatch_id IS NOT NULL)),
  CHECK(status != 'delivered' OR delivered_at IS NOT NULL)
);
CREATE INDEX dispatches_workspace_status ON dispatches(workspace_id, status, created_at);
CREATE INDEX dispatches_order ON dispatches(sales_order_id);
CREATE TRIGGER dispatch_entered BEFORE INSERT ON dispatches BEGIN
  SELECT RAISE(ABORT, 'order not in workspace') WHERE NOT EXISTS (SELECT 1 FROM sales_orders WHERE id = NEW.sales_order_id AND workspace_id = NEW.workspace_id);
  SELECT RAISE(ABORT, 'lot not in workspace') WHERE NOT EXISTS (SELECT 1 FROM lots WHERE id = NEW.lot_id AND workspace_id = NEW.workspace_id);
  -- Vehicle and transporter may be prefilled at the gate; nothing else is known yet.
  SELECT RAISE(ABORT, 'A new dispatch waits for the sales manager.') WHERE NEW.status != 'pending_approval'
   OR NEW.hold_reason IS NOT NULL OR NEW.sales_dispatch_id IS NOT NULL OR NEW.dispatched_at IS NOT NULL
   OR NEW.delivered_at IS NOT NULL OR NEW.delivery_proof != '';
END;
CREATE TRIGGER dispatch_terms_immutable BEFORE UPDATE ON dispatches
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.sales_order_id IS NOT OLD.sales_order_id
 OR NEW.lot_id IS NOT OLD.lot_id OR NEW.quantity_milli IS NOT OLD.quantity_milli OR NEW.grams IS NOT OLD.grams
 OR NEW.cartons IS NOT OLD.cartons OR NEW.cones IS NOT OLD.cones OR NEW.version IS NOT OLD.version
 OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'A dispatch keeps its ordered terms.'); END;
CREATE TRIGGER dispatch_status_flow BEFORE UPDATE ON dispatches
WHEN OLD.status != NEW.status OR NEW.hold_reason IS NOT OLD.hold_reason OR NEW.vehicle IS NOT OLD.vehicle
 OR NEW.transporter IS NOT OLD.transporter OR NEW.delivery_proof IS NOT OLD.delivery_proof
 OR NEW.sales_dispatch_id IS NOT OLD.sales_dispatch_id OR NEW.dispatched_at IS NOT OLD.dispatched_at
 OR NEW.delivered_at IS NOT OLD.delivered_at
BEGIN
  SELECT RAISE(ABORT, 'Invalid dispatch status change.') WHERE NOT (
    (OLD.status = 'pending_approval' AND NEW.status = 'approved' AND NEW.hold_reason IS OLD.hold_reason
      AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter AND NEW.delivery_proof = OLD.delivery_proof
      AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'pending_approval' AND NEW.status = 'on_hold'
      AND length(trim(COALESCE(NEW.hold_reason,''))) >= 5 AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter
      AND NEW.delivery_proof = OLD.delivery_proof AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id
      AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'approved' AND NEW.status = 'on_hold'
      AND length(trim(COALESCE(NEW.hold_reason,''))) >= 5 AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter
      AND NEW.delivery_proof = OLD.delivery_proof AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id
      AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'approved' AND NEW.status = 'dispatched' AND NEW.hold_reason IS OLD.hold_reason
      AND NEW.sales_dispatch_id IS NOT NULL AND NEW.dispatched_at IS NOT NULL AND NEW.delivered_at IS OLD.delivered_at
      AND OLD.delivery_proof = '')
   OR (OLD.status = 'on_hold' AND NEW.status = 'pending_approval' AND NEW.hold_reason IS OLD.hold_reason
      AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter AND NEW.delivery_proof = OLD.delivery_proof
      AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id AND NEW.dispatched_at IS OLD.dispatched_at
      AND NEW.delivered_at IS OLD.delivered_at)
   OR (OLD.status = 'dispatched' AND NEW.status = 'delivered' AND NEW.delivered_at IS NOT NULL
      AND NEW.vehicle = OLD.vehicle AND NEW.transporter = OLD.transporter AND NEW.sales_dispatch_id IS OLD.sales_dispatch_id
      AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.hold_reason IS OLD.hold_reason)
  );
END;
CREATE TRIGGER dispatches_no_delete BEFORE DELETE ON dispatches BEGIN SELECT RAISE(ABORT, 'dispatches preserve the audit trail'); END;
--> statement-breakpoint
CREATE TABLE dispatch_requests (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  kind TEXT NOT NULL CHECK(kind IN ('approval','hold_notice')),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','held','acknowledged')),
  term TEXT CHECK(term IS NULL OR term IN ('payment_overdue','terms_not_met','other')),
  message TEXT NOT NULL DEFAULT '', reason TEXT,
  requested_by TEXT NOT NULL, created_by TEXT NOT NULL,
  decided_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_at INTEGER,
  CHECK(kind != 'approval' OR status != 'acknowledged'),
  CHECK(status != 'approved' OR kind != 'hold_notice'),
  CHECK(status NOT IN ('approved','held') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(status != 'acknowledged' OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CHECK(status != 'held' OR (term IS NOT NULL AND length(trim(COALESCE(reason,''))) >= 5)),
  CHECK(status != 'approved' OR term IS NULL)
);
-- One thread of each kind at a time: the re-request can only follow the hold it answers.
CREATE UNIQUE INDEX dispatch_one_pending ON dispatch_requests(dispatch_id, kind) WHERE status = 'pending';
CREATE INDEX dispatch_requests_dispatch ON dispatch_requests(dispatch_id, created_at);
CREATE TRIGGER dispatch_request_entered BEFORE INSERT ON dispatch_requests BEGIN
  SELECT RAISE(ABORT, 'request not in workspace') WHERE NOT EXISTS (SELECT 1 FROM dispatches WHERE id = NEW.dispatch_id AND workspace_id = NEW.workspace_id);
  SELECT RAISE(ABORT, 'A new approval request is undisputed.') WHERE NEW.kind = 'approval'
   AND NOT (NEW.status = 'pending' AND NEW.decided_at IS NULL AND NEW.term IS NULL AND NEW.message = '');
  SELECT RAISE(ABORT, 'A new hold notice carries the sales-manager term and message.') WHERE NEW.kind = 'hold_notice'
   AND NOT (NEW.status = 'pending' AND NEW.term IS NOT NULL AND length(NEW.message) >= 1);
END;
CREATE TRIGGER dispatch_request_final BEFORE UPDATE ON dispatch_requests WHEN OLD.status != 'pending'
BEGIN SELECT RAISE(ABORT, 'A decided request is final.'); END;
CREATE TRIGGER dispatch_request_decision BEFORE UPDATE ON dispatch_requests WHEN OLD.status = 'pending' BEGIN
  SELECT RAISE(ABORT, 'A request keeps its kind and message.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id
   OR NEW.dispatch_id != OLD.dispatch_id OR NEW.kind != OLD.kind OR NEW.message != OLD.message
   OR NEW.requested_by IS NOT OLD.requested_by OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at;
  SELECT RAISE(ABORT, 'Invalid request decision.') WHERE NOT (
    (NEW.status = 'approved' AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL)
   OR (NEW.status = 'held' AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL)
   OR (NEW.status = 'acknowledged' AND OLD.kind = 'hold_notice'));
END;
CREATE TRIGGER dispatch_requests_no_delete BEFORE DELETE ON dispatch_requests BEGIN SELECT RAISE(ABORT, 'dispatch requests preserve the audit trail'); END;
--> statement-breakpoint
CREATE TABLE stock_issues (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  dispatch_id TEXT REFERENCES dispatches(id), lot_id TEXT NOT NULL REFERENCES lots(id),
  stage TEXT NOT NULL CHECK(stage IN ('raw','finished')), kind TEXT NOT NULL CHECK(kind IN ('shortage','mismatch')),
  difference_grams INTEGER NOT NULL CHECK(difference_grams >= 0), description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','pending_approval','accepted','rejected')),
  decision_reason TEXT, correction_grams INTEGER, adjustment_id TEXT REFERENCES inventory_adjustments(id),
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER,
  CHECK(status != 'accepted' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(trim(COALESCE(decision_reason,''))) >= 5)),
  CHECK(status != 'rejected' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(trim(COALESCE(decision_reason,''))) >= 5)),
  CHECK(status != 'pending_approval' OR (decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)),
  CHECK(NOT (status = 'accepted' AND correction_grams IS NOT NULL AND correction_grams != 0 AND adjustment_id IS NULL))
);
CREATE INDEX stock_issues_workspace ON stock_issues(workspace_id, status, created_at);
CREATE INDEX stock_issues_lot ON stock_issues(lot_id);
CREATE TRIGGER stock_issue_entered BEFORE INSERT ON stock_issues BEGIN
  SELECT RAISE(ABORT, 'lot not in workspace') WHERE NOT EXISTS (SELECT 1 FROM lots WHERE id = NEW.lot_id AND workspace_id = NEW.workspace_id);
  SELECT RAISE(ABORT, 'dispatch not in workspace') WHERE NEW.dispatch_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dispatches WHERE id = NEW.dispatch_id AND workspace_id = NEW.workspace_id);
  SELECT RAISE(ABORT, 'A raised stock issue is open and undecided.') WHERE NEW.status != 'open'
   OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL
   OR NEW.correction_grams IS NOT NULL OR NEW.adjustment_id IS NOT NULL;
END;
CREATE TRIGGER stock_issue_final BEFORE UPDATE ON stock_issues WHEN OLD.status IN ('accepted','rejected')
BEGIN SELECT RAISE(ABORT, 'A decided issue is final.'); END;
CREATE TRIGGER stock_issue_decision BEFORE UPDATE ON stock_issues BEGIN
  SELECT RAISE(ABORT, 'An issue keeps its evidence.') WHERE NEW.id != OLD.id OR NEW.workspace_id != OLD.workspace_id
   OR NEW.dispatch_id IS NOT OLD.dispatch_id OR NEW.lot_id != OLD.lot_id OR NEW.stage != OLD.stage
   OR NEW.kind != OLD.kind OR NEW.difference_grams != OLD.difference_grams OR NEW.description != OLD.description
   OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at;
  SELECT RAISE(ABORT, 'A zero correction is no correction.') WHERE NEW.correction_grams IS NOT NULL AND NEW.correction_grams = 0;
  SELECT RAISE(ABORT, 'Invalid issue status change.') WHERE NOT (
    (OLD.status = 'open' AND NEW.status = 'pending_approval' AND NEW.decided_by IS NULL AND NEW.decided_at IS NULL
      AND NEW.decision_reason IS NULL AND (NEW.correction_grams IS NULL) = (NEW.adjustment_id IS NULL))
   OR (OLD.status = 'open' AND NEW.status = 'accepted' AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL
      AND length(trim(COALESCE(NEW.decision_reason,''))) >= 5
      AND (NEW.correction_grams IS NULL) = (NEW.adjustment_id IS NULL))
   OR (OLD.status = 'open' AND NEW.status = 'rejected' AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL
      AND length(trim(COALESCE(NEW.decision_reason,''))) >= 5 AND NEW.correction_grams IS OLD.correction_grams
      AND NEW.adjustment_id IS OLD.adjustment_id)
   OR (OLD.status = 'pending_approval' AND NEW.status = 'accepted' AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL
      AND length(trim(COALESCE(NEW.decision_reason,''))) >= 5 AND NEW.adjustment_id IS OLD.adjustment_id
      AND NEW.correction_grams IS OLD.correction_grams)
   OR (OLD.status = 'pending_approval' AND NEW.status = 'rejected' AND NEW.decided_by IS NOT NULL AND NEW.decided_at IS NOT NULL
      AND length(trim(COALESCE(NEW.decision_reason,''))) >= 5 AND NEW.adjustment_id IS OLD.adjustment_id
      AND NEW.correction_grams IS OLD.correction_grams)
  );
END;
CREATE TRIGGER stock_issues_no_delete BEFORE DELETE ON stock_issues BEGIN SELECT RAISE(ABORT, 'stock issues preserve the audit trail'); END;
