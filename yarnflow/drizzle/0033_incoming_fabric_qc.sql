-- Incoming-fabric QC v2 (design 2026-11-12 §9, §17, §18). Expand-only: new tables, indexes and triggers; nothing existing is
-- altered, converted or dropped. Every tenant row carries workspace_id and references its parents by (workspace_id, id), so a
-- row can never point into another workspace. Timestamps are epoch milliseconds; the *_json columns hold contract records.
-- IF NOT EXISTS throughout: replaying this file over a database that already has it changes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS users_qc_tenant ON users(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_purchase_orders_tenant ON supplier_purchase_orders(workspace_id,id);

-- Immutable, versioned PO construction specifications. One spec id per purchase order; versions count up from 1.
CREATE TABLE IF NOT EXISTS qc_po_specs (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
 purchase_order_id TEXT NOT NULL, content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64), json TEXT NOT NULL CHECK(json_valid(json)),
 candidates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(candidates_json)), confirmed_by TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason))>=5),
 intervention_reason TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id,version), UNIQUE(workspace_id,purchase_order_id,version),
 FOREIGN KEY(workspace_id,purchase_order_id) REFERENCES supplier_purchase_orders(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_po_specs_sequence BEFORE INSERT ON qc_po_specs BEGIN
 SELECT RAISE(ABORT,'qc: spec version is not the next version') WHERE NEW.version != 1+COALESCE((SELECT MAX(version) FROM qc_po_specs WHERE workspace_id=NEW.workspace_id AND purchase_order_id=NEW.purchase_order_id),0);
 SELECT RAISE(ABORT,'qc: a purchase order has one spec id') WHERE EXISTS(SELECT 1 FROM qc_po_specs WHERE workspace_id=NEW.workspace_id AND purchase_order_id=NEW.purchase_order_id AND id!=NEW.id)
  OR EXISTS(SELECT 1 FROM qc_po_specs WHERE workspace_id=NEW.workspace_id AND id=NEW.id AND purchase_order_id!=NEW.purchase_order_id);
END;
CREATE TRIGGER IF NOT EXISTS qc_po_specs_no_update BEFORE UPDATE ON qc_po_specs BEGIN SELECT RAISE(ABORT,'qc: specifications are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_po_specs_no_delete BEFORE DELETE ON qc_po_specs BEGIN SELECT RAISE(ABORT,'qc: specifications are immutable'); END;

-- Server-verified references to signed consent register entries. Only withdrawal can change a row.
CREATE TABLE IF NOT EXISTS qc_consent_authorities (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)),
 operational_capture INTEGER NOT NULL CHECK(operational_capture IN (0,1)), retention_days INTEGER NOT NULL CHECK(retention_days>=1),
 valid_from INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>valid_from), withdrawn_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_consent_withdraw_only BEFORE UPDATE ON qc_consent_authorities BEGIN
 SELECT RAISE(ABORT,'qc: a consent record can only be withdrawn') WHERE OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL OR NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.json!=OLD.json
  OR NEW.operational_capture!=OLD.operational_capture OR NEW.retention_days!=OLD.retention_days OR NEW.valid_from!=OLD.valid_from OR NEW.expires_at!=OLD.expires_at OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at;
END;
CREATE TRIGGER IF NOT EXISTS qc_consent_no_delete BEFORE DELETE ON qc_consent_authorities BEGIN SELECT RAISE(ABORT,'qc: consent records are kept'); END;

-- One immutable physical selection; linked re-evaluations share it.
CREATE TABLE IF NOT EXISTS qc_selections (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, purchase_order_id TEXT NOT NULL, cohort TEXT NOT NULL CHECK(cohort IN ('OPERATIONAL','CONFIRMATORY','CHALLENGE')),
 json TEXT NOT NULL CHECK(json_valid(json)), created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,purchase_order_id) REFERENCES supplier_purchase_orders(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_selections_no_update BEFORE UPDATE ON qc_selections BEGIN SELECT RAISE(ABORT,'qc: selections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_selections_no_delete BEFORE DELETE ON qc_selections BEGIN SELECT RAISE(ABORT,'qc: selections are immutable'); END;

CREATE TABLE IF NOT EXISTS qc_releases (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('STATISTICAL_CANDIDATE','ACTIVE','SUSPENDED')),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), json TEXT NOT NULL CHECK(json_valid(json)), domain_json TEXT NOT NULL CHECK(json_valid(domain_json)), policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, activated_by TEXT, suspended_by TEXT, suspend_reason TEXT,
 PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS qc_releases_one_active ON qc_releases(workspace_id) WHERE state='ACTIVE';
CREATE TRIGGER IF NOT EXISTS qc_releases_insert BEFORE INSERT ON qc_releases BEGIN SELECT RAISE(ABORT,'qc: a release starts as a statistical candidate') WHERE NEW.state!='STATISTICAL_CANDIDATE'; END;
CREATE TRIGGER IF NOT EXISTS qc_releases_transition BEFORE UPDATE ON qc_releases BEGIN
 SELECT RAISE(ABORT,'qc: release content is immutable') WHERE NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.sha256!=OLD.sha256 OR NEW.json!=OLD.json OR NEW.domain_json!=OLD.domain_json OR NEW.policy_json!=OLD.policy_json OR NEW.expires_at!=OLD.expires_at OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at;
 SELECT RAISE(ABORT,'qc: invalid release transition') WHERE NOT ((OLD.state='STATISTICAL_CANDIDATE' AND NEW.state IN ('ACTIVE','SUSPENDED')) OR (OLD.state='ACTIVE' AND NEW.state='SUSPENDED'));
 SELECT RAISE(ABORT,'qc: a suspension is reasoned') WHERE NEW.state='SUSPENDED' AND (NEW.suspended_by IS NULL OR NEW.suspend_reason IS NULL OR length(trim(NEW.suspend_reason))<5);
END;
CREATE TRIGGER IF NOT EXISTS qc_releases_no_delete BEFORE DELETE ON qc_releases BEGIN SELECT RAISE(ABORT,'qc: releases are kept'); END;

-- One evaluation of a selection under one frozen spec version. The spec binding never changes; a revised spec gets a linked new row.
CREATE TABLE IF NOT EXISTS qc_samples (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, selection_id TEXT NOT NULL, purchase_order_id TEXT NOT NULL,
 spec_id TEXT NOT NULL, spec_version INTEGER NOT NULL, predecessor_sample_id TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 capture_attempt INTEGER NOT NULL DEFAULT 0 CHECK(capture_attempt BETWEEN 0 AND 3), disposition TEXT NOT NULL CHECK(disposition IN ('SELECTED','SUBMITTED','MISSING','EXCLUDED')),
 exclusion_reason TEXT, usable_area_cm2 REAL, current_decision_id TEXT, reason TEXT, intervention_reason TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,predecessor_sample_id),
 CHECK((disposition IN ('MISSING','EXCLUDED'))=(exclusion_reason IS NOT NULL)),
 FOREIGN KEY(workspace_id,selection_id) REFERENCES qc_selections(workspace_id,id),
 FOREIGN KEY(workspace_id,purchase_order_id) REFERENCES supplier_purchase_orders(workspace_id,id),
 FOREIGN KEY(workspace_id,spec_id,spec_version) REFERENCES qc_po_specs(workspace_id,id,version),
 FOREIGN KEY(workspace_id,predecessor_sample_id) REFERENCES qc_samples(workspace_id,id),
 FOREIGN KEY(workspace_id,current_decision_id,id) REFERENCES qc_decisions(workspace_id,id,sample_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS qc_samples_one_root ON qc_samples(workspace_id,selection_id) WHERE predecessor_sample_id IS NULL;
CREATE INDEX IF NOT EXISTS qc_samples_po ON qc_samples(workspace_id,purchase_order_id,created_at);
CREATE TRIGGER IF NOT EXISTS qc_samples_insert BEFORE INSERT ON qc_samples BEGIN
 SELECT RAISE(ABORT,'qc: sample, selection and spec must be one purchase order') WHERE NOT EXISTS(SELECT 1 FROM qc_selections WHERE workspace_id=NEW.workspace_id AND id=NEW.selection_id AND purchase_order_id=NEW.purchase_order_id)
  OR NOT EXISTS(SELECT 1 FROM qc_po_specs WHERE workspace_id=NEW.workspace_id AND id=NEW.spec_id AND version=NEW.spec_version AND purchase_order_id=NEW.purchase_order_id);
 SELECT RAISE(ABORT,'qc: a new sample starts at revision 0') WHERE NEW.revision!=0 OR NEW.capture_attempt!=0 OR NEW.current_decision_id IS NOT NULL;
 SELECT RAISE(ABORT,'qc: a linked evaluation shares its predecessor''s selection under a later spec') WHERE NEW.predecessor_sample_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM qc_samples WHERE workspace_id=NEW.workspace_id AND id=NEW.predecessor_sample_id AND selection_id=NEW.selection_id AND spec_id=NEW.spec_id AND spec_version<NEW.spec_version);
END;
CREATE TRIGGER IF NOT EXISTS qc_samples_frozen BEFORE UPDATE ON qc_samples BEGIN
 SELECT RAISE(ABORT,'qc: a sample keeps its selection and spec') WHERE NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.selection_id!=OLD.selection_id OR NEW.purchase_order_id!=OLD.purchase_order_id
  OR NEW.spec_id!=OLD.spec_id OR NEW.spec_version!=OLD.spec_version OR NEW.predecessor_sample_id IS NOT OLD.predecessor_sample_id OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at;
 SELECT RAISE(ABORT,'qc: a sample revision advances by one') WHERE NEW.revision!=OLD.revision+1;
 SELECT RAISE(ABORT,'qc: capture attempts never go back') WHERE NEW.capture_attempt<OLD.capture_attempt;
END;
CREATE TRIGGER IF NOT EXISTS qc_samples_no_delete BEFORE DELETE ON qc_samples BEGIN SELECT RAISE(ABORT,'qc: samples are kept'); END;

CREATE TABLE IF NOT EXISTS qc_capture_sets (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, sample_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('OPEN','CLOSED')),
 required_roles TEXT NOT NULL CHECK(json_valid(required_roles)), revision INTEGER NOT NULL DEFAULT 0, attempt INTEGER CHECK(attempt BETWEEN 1 AND 3), created_by TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,id,sample_id), CHECK((state='CLOSED')=(attempt IS NOT NULL)),
 FOREIGN KEY(workspace_id,sample_id) REFERENCES qc_samples(workspace_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS qc_capture_sets_one_open ON qc_capture_sets(workspace_id,sample_id) WHERE state='OPEN';
CREATE TRIGGER IF NOT EXISTS qc_capture_sets_insert BEFORE INSERT ON qc_capture_sets BEGIN SELECT RAISE(ABORT,'qc: a capture set starts open') WHERE NEW.state!='OPEN' OR NEW.revision!=0; END;
CREATE TRIGGER IF NOT EXISTS qc_capture_sets_frozen BEFORE UPDATE ON qc_capture_sets BEGIN
 SELECT RAISE(ABORT,'qc: a closed capture set is frozen') WHERE OLD.state='CLOSED';
 SELECT RAISE(ABORT,'qc: a capture set keeps its sample') WHERE NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.sample_id!=OLD.sample_id OR NEW.required_roles!=OLD.required_roles;
 -- One physical selection gets at most three closed capture sets across all its linked evaluations, numbered 1..3 in order.
 SELECT RAISE(ABORT,'qc: capture attempt is not the next attempt of this selection') WHERE NEW.state='CLOSED' AND NEW.attempt != 1+(
  SELECT COUNT(*) FROM qc_capture_sets c JOIN qc_samples s ON s.workspace_id=c.workspace_id AND s.id=c.sample_id
  WHERE c.state='CLOSED' AND c.workspace_id=NEW.workspace_id AND s.selection_id=(SELECT selection_id FROM qc_samples WHERE workspace_id=NEW.workspace_id AND id=NEW.sample_id));
END;
CREATE TRIGGER IF NOT EXISTS qc_capture_sets_no_delete BEFORE DELETE ON qc_capture_sets BEGIN SELECT RAISE(ABORT,'qc: capture sets are kept'); END;

-- One row per stored original. Publishing a reference and claiming it for garbage collection are mutually exclusive transitions.
CREATE TABLE IF NOT EXISTS qc_blob_claims (
 object_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), sha256 TEXT NOT NULL CHECK(length(sha256)=64), size INTEGER NOT NULL CHECK(size>0),
 state TEXT NOT NULL CHECK(state IN ('PENDING','REFERENCED','GC_CLAIMED','DELETED')), purpose TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(workspace_id,object_key)
);
CREATE INDEX IF NOT EXISTS qc_blob_claims_state ON qc_blob_claims(state,updated_at);
CREATE TRIGGER IF NOT EXISTS qc_blob_claims_insert BEFORE INSERT ON qc_blob_claims BEGIN SELECT RAISE(ABORT,'qc: a blob claim starts pending') WHERE NEW.state!='PENDING'; END;
CREATE TRIGGER IF NOT EXISTS qc_blob_claims_transition BEFORE UPDATE ON qc_blob_claims BEGIN
 SELECT RAISE(ABORT,'qc: a blob claim keeps its key and hash') WHERE NEW.object_key!=OLD.object_key OR NEW.workspace_id!=OLD.workspace_id OR NEW.sha256!=OLD.sha256 OR NEW.size!=OLD.size;
 SELECT RAISE(ABORT,'qc: invalid blob claim transition') WHERE NEW.state!=OLD.state AND NOT ((OLD.state='PENDING' AND NEW.state IN ('REFERENCED','GC_CLAIMED')) OR (OLD.state='REFERENCED' AND NEW.state='GC_CLAIMED' AND NEW.purpose IN ('RETENTION','RETENTION_PENDING')) OR (OLD.state='GC_CLAIMED' AND NEW.state='DELETED') OR (OLD.state='DELETED' AND NEW.state='GC_CLAIMED' AND NEW.purpose='ORPHAN_RETRY'));
END;
CREATE TRIGGER IF NOT EXISTS qc_blob_claims_no_delete BEFORE DELETE ON qc_blob_claims BEGIN SELECT RAISE(ABORT,'qc: blob claims are kept'); END;

CREATE TABLE IF NOT EXISTS qc_captures (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, sample_id TEXT NOT NULL, capture_set_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('overview','structure','defect','scale')),
 original_sha256 TEXT NOT NULL CHECK(length(original_sha256)=64), object_key TEXT NOT NULL UNIQUE, original_state TEXT NOT NULL CHECK(original_state IN ('AVAILABLE','PURGED')),
 consent_id TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), attestation_json TEXT NOT NULL CHECK(json_valid(attestation_json)), retain_until INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,capture_set_id,role),
 FOREIGN KEY(workspace_id,capture_set_id,sample_id) REFERENCES qc_capture_sets(workspace_id,id,sample_id),
 FOREIGN KEY(workspace_id,consent_id) REFERENCES qc_consent_authorities(workspace_id,id),
 FOREIGN KEY(workspace_id,object_key) REFERENCES qc_blob_claims(workspace_id,object_key)
);
CREATE INDEX IF NOT EXISTS qc_captures_retention ON qc_captures(original_state,retain_until);
CREATE TRIGGER IF NOT EXISTS qc_captures_insert BEFORE INSERT ON qc_captures BEGIN
 SELECT RAISE(ABORT,'qc: captures join an open capture set') WHERE NOT EXISTS(SELECT 1 FROM qc_capture_sets WHERE workspace_id=NEW.workspace_id AND id=NEW.capture_set_id AND state='OPEN');
 SELECT RAISE(ABORT,'qc: a capture set holds at most four originals') WHERE (SELECT COUNT(*) FROM qc_captures WHERE workspace_id=NEW.workspace_id AND capture_set_id=NEW.capture_set_id)>=4;
 SELECT RAISE(ABORT,'qc: the original is not a published reference') WHERE NEW.original_state!='AVAILABLE' OR NOT EXISTS(SELECT 1 FROM qc_blob_claims WHERE object_key=NEW.object_key AND workspace_id=NEW.workspace_id AND state='REFERENCED' AND sha256=NEW.original_sha256);
 SELECT RAISE(ABORT,'qc: consent does not permit this capture') WHERE NOT EXISTS(SELECT 1 FROM qc_consent_authorities WHERE workspace_id=NEW.workspace_id AND id=NEW.consent_id AND operational_capture=1 AND withdrawn_at IS NULL AND valid_from<=NEW.created_at AND expires_at>NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS qc_captures_purge_only BEFORE UPDATE ON qc_captures BEGIN
 SELECT RAISE(ABORT,'qc: a capture can only be tombstoned') WHERE NOT (OLD.original_state='AVAILABLE' AND NEW.original_state='PURGED') OR NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.sample_id!=OLD.sample_id OR NEW.capture_set_id!=OLD.capture_set_id
  OR NEW.role!=OLD.role OR NEW.original_sha256!=OLD.original_sha256 OR NEW.object_key!=OLD.object_key OR NEW.consent_id!=OLD.consent_id OR NEW.json!=OLD.json OR NEW.attestation_json!=OLD.attestation_json OR NEW.created_at!=OLD.created_at;
END;
CREATE TRIGGER IF NOT EXISTS qc_captures_no_delete BEFORE DELETE ON qc_captures BEGIN SELECT RAISE(ABORT,'qc: capture metadata is kept as the tombstone'); END;

CREATE TABLE IF NOT EXISTS qc_evidence (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, sample_id TEXT NOT NULL, capture_set_id TEXT NOT NULL, spec_id TEXT NOT NULL, spec_version INTEGER NOT NULL,
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64), json TEXT NOT NULL CHECK(json_valid(json)), created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,id,sample_id), UNIQUE(workspace_id,capture_set_id),
 FOREIGN KEY(workspace_id,capture_set_id,sample_id) REFERENCES qc_capture_sets(workspace_id,id,sample_id),
 FOREIGN KEY(workspace_id,spec_id,spec_version) REFERENCES qc_po_specs(workspace_id,id,version)
);
CREATE TRIGGER IF NOT EXISTS qc_evidence_insert BEFORE INSERT ON qc_evidence BEGIN
 SELECT RAISE(ABORT,'qc: evidence binds a closed capture set under the sample''s own spec') WHERE NOT EXISTS(SELECT 1 FROM qc_capture_sets WHERE workspace_id=NEW.workspace_id AND id=NEW.capture_set_id AND state='CLOSED')
  OR NOT EXISTS(SELECT 1 FROM qc_samples WHERE workspace_id=NEW.workspace_id AND id=NEW.sample_id AND spec_id=NEW.spec_id AND spec_version=NEW.spec_version);
END;
CREATE TRIGGER IF NOT EXISTS qc_evidence_no_update BEFORE UPDATE ON qc_evidence BEGIN SELECT RAISE(ABORT,'qc: evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_evidence_no_delete BEFORE DELETE ON qc_evidence BEGIN SELECT RAISE(ABORT,'qc: evidence is immutable'); END;

CREATE TABLE IF NOT EXISTS qc_decisions (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, sample_id TEXT NOT NULL, evidence_id TEXT NOT NULL, spec_id TEXT NOT NULL, spec_version INTEGER NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1), status TEXT NOT NULL CHECK(status IN ('ACCEPT','HOLD','RECAPTURE','MANUAL_REVIEW')), automatic INTEGER NOT NULL CHECK(automatic IN (0,1)),
 release_id TEXT, domain_id TEXT, policy_version TEXT NOT NULL, request_id TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,id,sample_id), UNIQUE(workspace_id,sample_id,revision), UNIQUE(workspace_id,evidence_id),
 CHECK(automatic=(status IN ('ACCEPT','HOLD'))), CHECK(automatic=0 OR release_id IS NOT NULL),
 FOREIGN KEY(workspace_id,sample_id) REFERENCES qc_samples(workspace_id,id),
 FOREIGN KEY(workspace_id,evidence_id,sample_id) REFERENCES qc_evidence(workspace_id,id,sample_id),
 FOREIGN KEY(workspace_id,spec_id,spec_version) REFERENCES qc_po_specs(workspace_id,id,version),
 FOREIGN KEY(workspace_id,release_id) REFERENCES qc_releases(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS qc_decisions_release ON qc_decisions(workspace_id,release_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS qc_decisions_insert BEFORE INSERT ON qc_decisions BEGIN
 SELECT RAISE(ABORT,'qc: a decision is bound to its sample''s own spec') WHERE NOT EXISTS(SELECT 1 FROM qc_samples WHERE workspace_id=NEW.workspace_id AND id=NEW.sample_id AND spec_id=NEW.spec_id AND spec_version=NEW.spec_version);
 -- The last line of defence: no automatic status is ever stored without an active, unexpired release.
 SELECT RAISE(ABORT,'qc: an automatic decision needs an active release') WHERE NEW.automatic=1 AND NOT EXISTS(SELECT 1 FROM qc_releases WHERE workspace_id=NEW.workspace_id AND id=NEW.release_id AND state='ACTIVE' AND expires_at>NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS qc_decisions_no_update BEFORE UPDATE ON qc_decisions BEGIN SELECT RAISE(ABORT,'qc: decisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_decisions_no_delete BEFORE DELETE ON qc_decisions BEGIN SELECT RAISE(ABORT,'qc: decisions are immutable'); END;

-- A reviewer's recorded finding: appended beside the model decision, never a rewrite of it and never blinded research truth.
CREATE TABLE IF NOT EXISTS qc_adjudications (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, sample_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
 outcome TEXT NOT NULL CHECK(outcome IN ('CONFORMING','NONCONFORMING','UNDETERMINED')), supersedes_id TEXT, json TEXT NOT NULL CHECK(json_valid(json)), actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,sample_id,revision), UNIQUE(workspace_id,supersedes_id),
 FOREIGN KEY(workspace_id,sample_id) REFERENCES qc_samples(workspace_id,id),
 FOREIGN KEY(workspace_id,supersedes_id) REFERENCES qc_adjudications(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_adjudications_no_update BEFORE UPDATE ON qc_adjudications BEGIN SELECT RAISE(ABORT,'qc: adjudications are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_adjudications_no_delete BEFORE DELETE ON qc_adjudications BEGIN SELECT RAISE(ABORT,'qc: adjudications are immutable'); END;

-- Durable request state. Same key + same body replays the stored response; a different body is a conflict. The lease and
-- generation fence a crashed or slow worker: only the current generation may finalise, and only before the deadline.
CREATE TABLE IF NOT EXISTS qc_idempotency (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL, route TEXT NOT NULL, client_key TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
 body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64), state TEXT NOT NULL CHECK(state IN ('IN_PROGRESS','COMPLETED','EXPIRED','FAILED')),
 deadline_at INTEGER NOT NULL, lease_expires_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>=1),
 response_status INTEGER, response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,route,client_key), CHECK((state='COMPLETED')=(response_status IS NOT NULL AND response_json IS NOT NULL AND state='COMPLETED')),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES users(workspace_id,id)
);
-- Also protects a partially applied earlier copy of this expand-only migration whose table
-- already exists without the actor FK; no table rebuild or legacy row rewrite is needed.
CREATE TRIGGER IF NOT EXISTS qc_idempotency_actor_insert BEFORE INSERT ON qc_idempotency BEGIN
 SELECT RAISE(ABORT,'FOREIGN KEY constraint failed: qc request actor') WHERE NOT EXISTS(SELECT 1 FROM users WHERE workspace_id=NEW.workspace_id AND id=NEW.actor_id);
END;
CREATE TRIGGER IF NOT EXISTS qc_idempotency_transition BEFORE UPDATE ON qc_idempotency BEGIN
 SELECT RAISE(ABORT,'qc: a request keeps its identity') WHERE NEW.workspace_id!=OLD.workspace_id OR NEW.actor_id!=OLD.actor_id OR NEW.route!=OLD.route OR NEW.client_key!=OLD.client_key OR NEW.request_id!=OLD.request_id OR NEW.body_sha256!=OLD.body_sha256 OR NEW.deadline_at!=OLD.deadline_at;
 SELECT RAISE(ABORT,'qc: a finished request is final') WHERE OLD.state IN ('COMPLETED','EXPIRED');
 SELECT RAISE(ABORT,'qc: request generations only advance') WHERE NEW.generation<OLD.generation;
END;
CREATE TRIGGER IF NOT EXISTS qc_idempotency_no_delete BEFORE DELETE ON qc_idempotency BEGIN SELECT RAISE(ABORT,'qc: request records are kept'); END;

-- Append-only audit of everything the QC workflow commits. A decision and its event are written in one batch or not at all.
CREATE TABLE IF NOT EXISTS qc_decision_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), sample_id TEXT, record_id TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
 request_id TEXT, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)), reason TEXT, intervention_reason TEXT, created_at INTEGER NOT NULL,
 FOREIGN KEY(workspace_id,sample_id) REFERENCES qc_samples(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS qc_decision_events_sample ON qc_decision_events(workspace_id,sample_id,created_at);
CREATE TRIGGER IF NOT EXISTS qc_decision_events_no_update BEFORE UPDATE ON qc_decision_events BEGIN SELECT RAISE(ABORT,'qc: immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS qc_decision_events_no_delete BEFORE DELETE ON qc_decision_events BEGIN SELECT RAISE(ABORT,'qc: immutable audit'); END;

-- Monotonic deletion / hold / withdrawal ledger. A protected copy of it is replayed after any restore, so an older snapshot
-- cannot bring purged bytes back into service.
CREATE TABLE IF NOT EXISTS qc_retention_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK(kind IN ('HOLD','HOLD_RELEASED','TOMBSTONE','WITHDRAWAL')),
 capture_id TEXT, consent_id TEXT, object_key TEXT, sha256 TEXT, hold_id TEXT, actor_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason))>=5), expires_at INTEGER, created_at INTEGER NOT NULL,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,hold_id) REFERENCES qc_retention_events(workspace_id,id),
 CHECK(kind!='HOLD_RELEASED' OR hold_id IS NOT NULL),
 CHECK(kind!='HOLD' OR (capture_id IS NOT NULL AND expires_at IS NOT NULL)), CHECK(kind!='TOMBSTONE' OR (capture_id IS NOT NULL AND object_key IS NOT NULL)), CHECK(kind!='WITHDRAWAL' OR consent_id IS NOT NULL),
 FOREIGN KEY(workspace_id,capture_id) REFERENCES qc_captures(workspace_id,id),
 FOREIGN KEY(workspace_id,consent_id) REFERENCES qc_consent_authorities(workspace_id,id),
 FOREIGN KEY(workspace_id,object_key) REFERENCES qc_blob_claims(workspace_id,object_key)
);
CREATE INDEX IF NOT EXISTS qc_retention_events_capture ON qc_retention_events(workspace_id,capture_id,kind);
CREATE TRIGGER IF NOT EXISTS qc_retention_events_no_update BEFORE UPDATE ON qc_retention_events BEGIN SELECT RAISE(ABORT,'qc: immutable retention ledger'); END;
CREATE TRIGGER IF NOT EXISTS qc_retention_events_no_delete BEFORE DELETE ON qc_retention_events BEGIN SELECT RAISE(ABORT,'qc: immutable retention ledger'); END;

-- Fresh-credential proofs for release promotion: short-lived, bound to one session, actor, workspace and payload, used once.
CREATE TABLE IF NOT EXISTS qc_reauth_proofs (
 proof_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL, session_hash TEXT NOT NULL, payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 expires_at INTEGER NOT NULL, used_at INTEGER, used_key TEXT, created_at INTEGER NOT NULL,
 FOREIGN KEY(workspace_id,actor_id) REFERENCES users(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_reauth_proofs_once BEFORE UPDATE ON qc_reauth_proofs BEGIN SELECT RAISE(ABORT,'qc: a proof is used once') WHERE OLD.used_at IS NOT NULL OR NEW.used_at IS NULL OR NEW.workspace_id!=OLD.workspace_id OR NEW.created_at!=OLD.created_at OR NEW.proof_hash!=OLD.proof_hash OR NEW.actor_id!=OLD.actor_id OR NEW.session_hash!=OLD.session_hash OR NEW.payload_sha256!=OLD.payload_sha256 OR NEW.expires_at!=OLD.expires_at; END;

-- Delayed blinded random audits of automatic decisions: the monitoring protocol's telemetry.
CREATE TABLE IF NOT EXISTS qc_audit_results (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, decision_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('AGREE','DISAGREE')), sampling_probability REAL NOT NULL CHECK(sampling_probability>0 AND sampling_probability<=1),
 auditor_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,decision_id),
 FOREIGN KEY(workspace_id,decision_id) REFERENCES qc_decisions(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_audit_results_no_update BEFORE UPDATE ON qc_audit_results BEGIN SELECT RAISE(ABORT,'qc: audit results are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_audit_results_no_delete BEFORE DELETE ON qc_audit_results BEGIN SELECT RAISE(ABORT,'qc: audit results are immutable'); END;

CREATE TABLE IF NOT EXISTS qc_incidents (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, release_id TEXT NOT NULL, domain_id TEXT NOT NULL, kind TEXT NOT NULL, cutoff_at INTEGER NOT NULL,
 protocol_sha256 TEXT, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)), created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,release_id,kind), FOREIGN KEY(workspace_id,release_id) REFERENCES qc_releases(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_incidents_no_update BEFORE UPDATE ON qc_incidents BEGIN SELECT RAISE(ABORT,'qc: incidents are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_incidents_no_delete BEFORE DELETE ON qc_incidents BEGIN SELECT RAISE(ABORT,'qc: incidents are immutable'); END;
-- A recall marks a decision's current validity; the decision row itself is never touched.
CREATE TABLE IF NOT EXISTS qc_recalls (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), incident_id TEXT NOT NULL, decision_id TEXT NOT NULL, sample_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,incident_id,decision_id),
 FOREIGN KEY(workspace_id,incident_id) REFERENCES qc_incidents(workspace_id,id), FOREIGN KEY(workspace_id,decision_id,sample_id) REFERENCES qc_decisions(workspace_id,id,sample_id)
);
CREATE INDEX IF NOT EXISTS qc_recalls_decision ON qc_recalls(workspace_id,decision_id);
CREATE TRIGGER IF NOT EXISTS qc_recalls_no_update BEFORE UPDATE ON qc_recalls BEGIN SELECT RAISE(ABORT,'qc: recalls are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_recalls_no_delete BEFORE DELETE ON qc_recalls BEGIN SELECT RAISE(ABORT,'qc: recalls are immutable'); END;
-- One notice per (incident, recipient): retried idempotently, with visible delivery and acknowledgement.
CREATE TABLE IF NOT EXISTS qc_recall_outbox (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), incident_id TEXT NOT NULL, recipient_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('PENDING','DELIVERED','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0, delivered_at INTEGER, acked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,incident_id,recipient_id), FOREIGN KEY(workspace_id,recipient_id) REFERENCES users(workspace_id,id), FOREIGN KEY(workspace_id,incident_id) REFERENCES qc_incidents(workspace_id,id)
);

-- Reserved for C12 monitoring: registered approved protocol versions and append-only evaluations.
CREATE TABLE IF NOT EXISTS qc_monitoring_protocols (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, version TEXT NOT NULL,
 release_id TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 json TEXT NOT NULL CHECK(json_valid(json)), created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,release_id,version),
 FOREIGN KEY(workspace_id,release_id) REFERENCES qc_releases(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_monitoring_protocols_no_update BEFORE UPDATE ON qc_monitoring_protocols BEGIN SELECT RAISE(ABORT,'qc: monitoring protocols are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_monitoring_protocols_no_delete BEFORE DELETE ON qc_monitoring_protocols BEGIN SELECT RAISE(ABORT,'qc: monitoring protocols are immutable'); END;
CREATE TABLE IF NOT EXISTS qc_monitoring_runs (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, protocol_id TEXT NOT NULL,
 release_id TEXT NOT NULL, window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('OK','INSUFFICIENT','TRIGGERED','UNAVAILABLE')),
 counters_json TEXT NOT NULL CHECK(json_valid(counters_json)), incident_id TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,protocol_id,window_start,window_end),
 CHECK(window_end>window_start),
 FOREIGN KEY(workspace_id,protocol_id) REFERENCES qc_monitoring_protocols(workspace_id,id),
 FOREIGN KEY(workspace_id,release_id) REFERENCES qc_releases(workspace_id,id),
 FOREIGN KEY(workspace_id,incident_id) REFERENCES qc_incidents(workspace_id,id)
);
CREATE TRIGGER IF NOT EXISTS qc_monitoring_runs_no_update BEFORE UPDATE ON qc_monitoring_runs BEGIN SELECT RAISE(ABORT,'qc: monitoring runs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_monitoring_runs_no_delete BEFORE DELETE ON qc_monitoring_runs BEGIN SELECT RAISE(ABORT,'qc: monitoring runs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS qc_reauth_proofs_no_delete BEFORE DELETE ON qc_reauth_proofs BEGIN SELECT RAISE(ABORT,'qc: proofs are kept'); END;
-- Pointer and adjudication lineage bind the same physical evaluation, not merely a tenant.
CREATE TRIGGER IF NOT EXISTS qc_adjudications_insert BEFORE INSERT ON qc_adjudications BEGIN
 SELECT RAISE(ABORT,'qc: adjudication predecessor belongs to another sample') WHERE NEW.supersedes_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM qc_adjudications WHERE workspace_id=NEW.workspace_id AND id=NEW.supersedes_id AND sample_id=NEW.sample_id);
END;
