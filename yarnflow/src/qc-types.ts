/**
 * Incoming-fabric QC v2: the web's mirror of scanner/services/api/qc_schemas.py.
 *
 * Shapes only. No decision is ever computed here: the server is the authority and the browser
 * renders what it returns. The guards reject anything the contract would reject (unknown fields,
 * out-of-range numbers, broken cross-field rules) so a malformed response is shown as an error
 * instead of being half-rendered. tests/qc-types.test.ts runs the shared fixtures in
 * scanner/tests/fixtures/qc-v2 through these guards.
 */

export const SCHEMA_VERSION = '2';
export const DECISION_STATUSES = ['ACCEPT', 'HOLD', 'RECAPTURE', 'MANUAL_REVIEW'] as const;
export const STAGE_STATES = ['OK', 'ABSTAINED', 'FAILED', 'DISABLED', 'NOT_RUN'] as const;
export const STAGE_NAMES = ['quality', 'fabric', 'defects', 'metrology', 'domain'] as const;
export const REASONS = [
  'QUALITY_BLUR', 'QUALITY_GLARE', 'QUALITY_MOIRE', 'QUALITY_FOLD', 'QUALITY_FRAMING', 'SCALE_MISSING', 'SCALE_INVALID',
  'CALIBRATION_EXPIRED', 'RESOLUTION_LOW', 'MEASUREMENT_UNCERTAIN', 'PATTERN_AMBIGUOUS', 'OOD', 'UNKNOWN_FABRIC',
  'PO_UNCONFIRMED', 'PO_CONFLICT', 'PO_VERSION_STALE', 'UNIT_UNSUPPORTED', 'SPEC_MISSING', 'STAGE_UNAVAILABLE',
  'DEFECT_SUSPECTED', 'CONSTRUCTION_OUTSIDE_TOLERANCE', 'FABRIC_MISMATCH', 'DOMAIN_UNVALIDATED', 'POLICY_UNRELEASED',
  'RECAPTURE_LIMIT', 'EVIDENCE_STALE', 'AUDIT_UNAVAILABLE',
] as const;
export const CAPTURE_FIXABLE: readonly Reason[] = ['QUALITY_BLUR', 'QUALITY_GLARE', 'QUALITY_MOIRE', 'QUALITY_FOLD', 'QUALITY_FRAMING', 'SCALE_MISSING', 'SCALE_INVALID', 'RESOLUTION_LOW'];
export const ERROR_CODES = [
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'MALFORMED_REQUEST', 'METHOD_NOT_ALLOWED', 'CONFLICT', 'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA', 'VALIDATION_FAILED', 'CAPACITY_LIMIT', 'SERVICE_UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL_ERROR',
] as const;
export const AXES = ['ends', 'picks', 'wales', 'courses'] as const;
export const CAPTURE_ROLES = ['overview', 'structure', 'defect', 'scale'] as const;
export const QUALITY_CHECKS = ['blur', 'glare', 'moire', 'fold', 'framing', 'resolution', 'marker_geometry'] as const;
export const REQUIRED_AXES: Record<Construction, readonly Axis[]> = { woven: ['ends', 'picks'], knit: ['wales', 'courses'] };

// Engineering limits (design §21). Starting points, not validated acquisition thresholds.
export const LIMITS = {
  maxOriginalsPerSet: 4, maxOriginalBytes: 12 * 1024 * 1024, maxSetBytes: 48 * 1024 * 1024,
  maxDecodedPixels: 16_000_000, maxPreviewBytes: 1024 * 1024, maxCaptureSets: 3, draftLifetimeMs: 24 * 3600_000,
} as const;

export type DecisionStatus = typeof DECISION_STATUSES[number];
export type StageState = typeof STAGE_STATES[number];
export type StageName = typeof STAGE_NAMES[number];
export type Reason = typeof REASONS[number];
export type ErrorCode = typeof ERROR_CODES[number];
export type Axis = typeof AXES[number];
export type CaptureRole = typeof CAPTURE_ROLES[number];
export type QualityCheck = typeof QUALITY_CHECKS[number];
export type Construction = 'woven' | 'knit';
export type DensityUnit = 'count/in' | 'count/cm';
export type Mode = 'REVIEW_ONLY' | 'AUTOMATIC';
export type Box = [number, number, number, number];

export interface Provenance {
  source: 'PO_CONFIRMED' | 'OCR_CANDIDATE' | 'OPERATOR' | 'MODEL' | 'PHYSICAL_REFERENCE';
  source_id: string; source_version: string; actor_id: string | null; observed_at: string; image_sha256: string | null;
  document_sha256?: string | null; page?: number | null; span?: [number, number] | null; raw_value?: string | null;
  raw_unit?: string | null; ocr_confidence?: number | null; candidate_id?: string | null; corrects_id?: string | null;
}
export interface DensitySpec { axis: Axis; unit: DensityUnit; target: number; lower: number; upper: number; provenance: Provenance }
export interface PurchaseSpec {
  schema_version: '2'; id: string; version: number; workspace_id: string; purchase_order_id: string; content_sha256: string;
  construction: Construction; allowed_fabric_labels: string[]; taxonomy_version: string; density: DensitySpec[];
  confirmed_by: string; confirmed_at: string; supersedes_version: number | null;
}
export type Face = 'face' | 'back' | 'unknown';
export interface SamplingSelection {
  id: string; workspace_id: string; purchase_order_id: string; plan_version: string; plan_sha256: string | null;
  randomization_seed: string | null; draw_index: number | null; selection_probability: number | null;
  cohort: 'OPERATIONAL' | 'CONFIRMATORY' | 'CHALLENGE'; independent_group_id: string; lot_ref: string; roll_ref: string;
  location_ref: string; face: Face; planned_area_cm2: number; method: string; created_by: string; created_at: string;
}
export interface Sample {
  schema_version: '2'; id: string; workspace_id: string; purchase_order_id: string; spec_id: string; spec_version: number;
  lot_ref: string; roll_ref: string; location_ref: string; sample_plan_version: string; capture_attempt: number; revision: number;
  predecessor_sample_id: string | null; selection_id: string; face: Face; planned_area_cm2: number; usable_area_cm2: number | null;
  sampling_method: string; independent_group_id: string; disposition: 'SELECTED' | 'SUBMITTED' | 'MISSING' | 'EXCLUDED';
  exclusion_reason: string | null; created_by: string; created_at: string;
}
export type CaptureMode = 'NATIVE_CAMERA' | 'WEB_CAMERA' | 'IMPORTED' | 'REENCODED' | 'CANVAS';
export interface AcquisitionAttestation {
  image_sha256: string; capture_mode: CaptureMode; device_model: string | null; lens_id: string | null; zoom_factor: number | null;
  focus_mode: string | null; exposure_mode: string | null; resolution: [number, number] | null; orientation: number | null;
  processing: string | null; captured_at: string;
}
export type MediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface Capture {
  id: string; sample_id: string; capture_set_id: string; original_sha256: string; role: CaptureRole; taken_at: string;
  device_profile_id: string; calibration_id: string | null; width: number; height: number; preprocessing_version: string;
  consent_record_id: string; byte_size: number; media_type: MediaType; original_state: 'AVAILABLE' | 'PURGED'; attestation_sha256: string;
}
export interface CaptureSet { id: string; sample_id: string; state: 'OPEN' | 'CLOSED'; required_roles: CaptureRole[]; capture_ids: string[]; revision: number; attempt: number | null }
export interface ConsentAuthority {
  id: string; version: number; workspace_id: string; authority_evidence_sha256: string; operational_capture: boolean;
  operational_retention_days: number; research_use: boolean; training_use: boolean; export_destinations: string[];
  valid_from: string; expires_at: string; withdrawn_at: string | null;
}
export interface Stage<T> { state: StageState; value: T | null; reasons: Reason[]; artifact_sha256: string | null; duration_ms: number }
export interface DomainValue { in_domain: boolean; assessment_version: string; profile_sha256: string }
export interface FabricValue { label: string | null; taxonomy_version: string; calibrated_probability: number | null; unknown: boolean; candidates: { label: string; raw_score: number }[] }
export interface DefectRegion { capture_id: string; transform_id: string; box: Box; score: number; label: string | null }
export interface DefectView { capture_id: string; capture_sha256: string; transform_id: string; score: number; observed_area_cm2: number | null }
export interface DefectValue { score: number; regions: DefectRegion[]; observed_area_cm2: number; views: DefectView[] }
export interface Measurement {
  capture_id: string; capture_sha256: string; source_roi: Box; calibration_sha256: string; geometry_artifact_sha256: string;
  uncertainty_report_sha256: string; axis_registration_id: string; axis: Axis; unit: 'count/in'; value: number;
  interval95: [number, number]; reference_id: string; method_version: string;
}
export interface QualityValue { checks: Record<QualityCheck, boolean> }
export interface Evidence {
  schema_version: '2'; id: string; sample_id: string; capture_ids: string[]; spec_sha256: string; domain_id: string | null;
  domain: Stage<DomainValue>; fabric: Stage<FabricValue>; defects: Stage<DefectValue>; metrology: Stage<Measurement[]>;
  quality: Stage<QualityValue>; contradictions: Reason[]; manifest_sha256: string; created_at: string;
}
export interface DecisionDraft { status: DecisionStatus; reasons: Reason[]; automatic: boolean; scope: 'INSPECTED_SAMPLE' }
export interface Decision extends DecisionDraft {
  schema_version: '2'; id: string; sample_id: string; evidence_id: string; spec_id: string; spec_version: number;
  revision: number; policy_version: string; release_id: string | null; evaluated_at: string;
}
export type Outcome = 'CONFORMING' | 'NONCONFORMING' | 'UNDETERMINED';
export interface Adjudication {
  id: string; sample_id: string; revision: number; outcome: Outcome; reason: string; reference_ids: string[]; actor_id: string;
  created_at: string; supersedes_id: string | null; intervention_reason: string | null;
}
export interface Family {
  selection_id: string; predecessor_sample_id: string | null; successor_sample_ids: string[]; attempts_used: number;
  attempts_max: 3; spec_is_current: boolean; current_spec_version: number;
}
export interface QCResult {
  schema_version: '2'; mode: Mode; sample: Sample; captures: Capture[]; capture_sets: CaptureSet[]; evidence: Evidence | null;
  decision: Decision | null; history: Decision[]; adjudications: Adjudication[]; current_human_disposition: Adjudication | null;
  recalled_decision_ids: string[]; family: Family; revision: number;
}
export interface Release {
  id: string; version: string; sha256: string; workspace_id: string; state: 'STATISTICAL_CANDIDATE' | 'ACTIVE' | 'SUSPENDED';
  domain_sha256: string; policy_sha256: string; bundle_sha256: string; calibration_sha256: string; statistics_report_sha256: string;
  operations_proof_sha256: string | null; monitoring_protocol_sha256: string | null; authority_record_sha256: string;
  approved_by: string; independent_signatory: string; expires_at: string; predecessor_release_id: string | null;
}
export interface ReadinessStage { name: StageName; state: StageState; artifact_sha256: string | null; reasons: Reason[] }
export interface Readiness { schema_version: '2'; ready: boolean; bundle_sha256: string | null; stages: ReadinessStage[] }
export interface ErrorBody { code: ErrorCode; reasons: Reason[]; retryable: boolean; request_id: string }
export interface ErrorEnvelope { schema_version: '2'; error: ErrorBody }

// ------------------------------------------------------------------ non-contract envelopes (contract-decisions.md)
export interface QCStatus {
  schema_version: '2'; mode: Mode; automation: { enabled: boolean; missing_gates: string[] }; readiness: Readiness | null;
  scanner: 'CONNECTED' | 'UNAVAILABLE'; limits?: Record<string, number>; role: string;
  can: { confirm_spec: boolean; create_sample: boolean; capture: boolean; adjudicate: boolean; manage_release: boolean };
}
export interface PurchaseOrderItem {
  purchase_order_id: string; reference: string; supplier_name: string; status: string;
  current_spec: { id: string; version: number; confirmed_at: string; construction: Construction } | null;
}
export interface SampleSummary { sample_id: string; roll_ref: string; location_ref: string; spec_version: number; revision: number; status: DecisionStatus | null; disposition: Sample['disposition']; created_at: string }
export interface RequestState { schema_version: '2'; request_id: string; state: 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED' | 'FAILED'; result: QCResult | null; error: ErrorBody | null }

// ------------------------------------------------------------------ runtime guards
type Check = (value: unknown) => boolean;
const SHA = /^[0-9a-f]{64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/, REF = /^[^\x00-\x1f]+$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (pattern: RegExp | null, min: number, max: number): Check => value => {
  if (typeof value !== 'string') return false;
  const length = [...value].length;
  return length >= min && length <= max && (!pattern || pattern.test(value));
};
const sha = text(SHA, 64, 64), uuid = text(UUID, 36, 36), utc = text(UTC, 20, 27), ref = text(REF, 1, 120), longText = text(null, 1, 2000);
const num = (min = -Infinity, max = Infinity, exclusiveMin = false): Check => value =>
  typeof value === 'number' && Number.isFinite(value) && (exclusiveMin ? value > min : value >= min) && value <= max;
const int = (min = -Infinity, max = Infinity): Check => value => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const bool: Check = value => typeof value === 'boolean';
const lit = (...allowed: readonly unknown[]): Check => value => allowed.includes(value);
const nullable = (check: Check): Check => value => value === null || check(value);
const list = (check: Check, min = 0, max = Infinity): Check => value => Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
const tuple = (...checks: Check[]): Check => value => Array.isArray(value) && value.length === checks.length && checks.every((check, index) => check(value[index]));
const unique = (values: unknown[]) => new Set(values).size === values.length;
/** Every listed field must pass; unknown fields are rejected. Fields in `optional` may be absent. */
const record = (fields: Record<string, Check>, rule?: (value: any) => boolean, optional: string[] = []): Check => value => {
  if (!isObject(value)) return false;
  for (const key of Object.keys(value)) if (!Object.hasOwn(fields, key)) return false;
  for (const [key, check] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) { if (optional.includes(key)) continue; return false; }
    if (!check(value[key])) return false;
  }
  return rule ? rule(value) : true;
};
const unit01 = num(0, 1), nonNeg = num(0), reason = lit(...REASONS);
const box = tuple(unit01, unit01, unit01, unit01);
const orderedBox = (value: Box) => value[0] < value[2] && value[1] < value[3];
const face = lit('face', 'back', 'unknown'), area = num(0, 1_000_000, true);

const provenanceExtra = ['document_sha256', 'page', 'span', 'raw_value', 'raw_unit', 'ocr_confidence', 'candidate_id', 'corrects_id'];
export const isProvenance = record({
  source: lit('PO_CONFIRMED', 'OCR_CANDIDATE', 'OPERATOR', 'MODEL', 'PHYSICAL_REFERENCE'), source_id: ref, source_version: ref,
  actor_id: nullable(ref), observed_at: utc, image_sha256: nullable(sha), document_sha256: nullable(sha), page: nullable(int(1, 10_000)),
  span: nullable(tuple(int(0), int(0))), raw_value: nullable(text(null, 0, 200)), raw_unit: nullable(text(null, 0, 40)),
  ocr_confidence: nullable(unit01), candidate_id: nullable(uuid), corrects_id: nullable(uuid),
}, (p: Provenance) => !p.span || p.span[0] <= p.span[1], provenanceExtra);
export const isDensitySpec = record({
  axis: lit(...AXES), unit: lit('count/in', 'count/cm'), target: num(0, 10_000, true), lower: num(0, 10_000), upper: num(0, 10_000), provenance: isProvenance,
}, (d: DensitySpec) => d.lower <= d.target && d.target <= d.upper && d.provenance.source === 'PO_CONFIRMED');
export const isPurchaseSpec = record({
  schema_version: lit('2'), id: uuid, version: int(1), workspace_id: uuid, purchase_order_id: ref, content_sha256: sha,
  construction: lit('woven', 'knit'), allowed_fabric_labels: list(ref, 1, 40), taxonomy_version: ref, density: list(isDensitySpec, 2, 2),
  confirmed_by: ref, confirmed_at: utc, supersedes_version: nullable(int(1)),
}, (s: PurchaseSpec) => {
  const axes = s.density.map(d => d.axis), required = REQUIRED_AXES[s.construction];
  return unique(axes) && axes.every(axis => required.includes(axis)) && unique(s.allowed_fabric_labels)
    && (s.supersedes_version === null || s.supersedes_version === s.version - 1) && (s.version === 1) === (s.supersedes_version === null);
});
export const isSamplingSelection = record({
  id: uuid, workspace_id: uuid, purchase_order_id: ref, plan_version: ref, plan_sha256: nullable(sha), randomization_seed: nullable(ref),
  draw_index: nullable(int(0)), selection_probability: nullable(num(0, 1, true)), cohort: lit('OPERATIONAL', 'CONFIRMATORY', 'CHALLENGE'),
  independent_group_id: ref, lot_ref: ref, roll_ref: ref, location_ref: ref, face, planned_area_cm2: area, method: ref, created_by: ref, created_at: utc,
});
export const isSample = record({
  schema_version: lit('2'), id: uuid, workspace_id: uuid, purchase_order_id: ref, spec_id: uuid, spec_version: int(1), lot_ref: ref,
  roll_ref: ref, location_ref: ref, sample_plan_version: ref, capture_attempt: int(0, 3), revision: int(0), predecessor_sample_id: nullable(uuid),
  selection_id: uuid, face, planned_area_cm2: area, usable_area_cm2: nullable(num(0, 1_000_000)), sampling_method: ref, independent_group_id: ref,
  disposition: lit('SELECTED', 'SUBMITTED', 'MISSING', 'EXCLUDED'), exclusion_reason: nullable(longText), created_by: ref, created_at: utc,
}, (s: Sample) => ['MISSING', 'EXCLUDED'].includes(s.disposition) === (s.exclusion_reason !== null));
export const isAcquisitionAttestation = record({
  image_sha256: sha, capture_mode: lit('NATIVE_CAMERA', 'WEB_CAMERA', 'IMPORTED', 'REENCODED', 'CANVAS'), device_model: nullable(ref),
  lens_id: nullable(ref), zoom_factor: nullable(num(0, 100, true)), focus_mode: nullable(ref), exposure_mode: nullable(ref),
  resolution: nullable(tuple(int(1), int(1))), orientation: nullable(int(1, 8)), processing: nullable(ref), captured_at: utc,
});
export const isCapture = record({
  id: uuid, sample_id: uuid, capture_set_id: uuid, original_sha256: sha, role: lit(...CAPTURE_ROLES), taken_at: utc, device_profile_id: ref,
  calibration_id: nullable(ref), width: int(1, 20_000), height: int(1, 20_000), preprocessing_version: ref, consent_record_id: uuid,
  byte_size: int(1, LIMITS.maxOriginalBytes), media_type: lit('image/jpeg', 'image/png', 'image/webp'), original_state: lit('AVAILABLE', 'PURGED'), attestation_sha256: sha,
}, (c: Capture) => c.width * c.height <= LIMITS.maxDecodedPixels);
export const isCaptureSet = record({
  id: uuid, sample_id: uuid, state: lit('OPEN', 'CLOSED'), required_roles: list(lit(...CAPTURE_ROLES), 1, 4), capture_ids: list(uuid, 0, 4),
  revision: int(0), attempt: nullable(int(1, 3)),
}, (s: CaptureSet) => (s.state === 'CLOSED') === (s.attempt !== null) && unique(s.capture_ids) && unique(s.required_roles));
export const isConsentAuthority = record({
  id: uuid, version: int(1), workspace_id: uuid, authority_evidence_sha256: sha, operational_capture: bool, operational_retention_days: int(1, 3650),
  research_use: bool, training_use: bool, export_destinations: list(ref, 0, 20), valid_from: utc, expires_at: utc, withdrawn_at: nullable(utc),
});
const stage = (value: Check): Check => record({
  state: lit(...STAGE_STATES), value: nullable(value), reasons: list(reason, 0, 12), artifact_sha256: nullable(sha), duration_ms: num(0, 600_000),
}, (s: Stage<unknown>) => unique(s.reasons) && (s.state === 'OK' ? s.value !== null && s.artifact_sha256 !== null : s.value === null && s.reasons.length > 0));
const domainValue = record({ in_domain: bool, assessment_version: ref, profile_sha256: sha });
const fabricValue = record({
  label: nullable(ref), taxonomy_version: ref, calibrated_probability: nullable(unit01), unknown: bool,
  candidates: list(record({ label: ref, raw_score: num(-1e6, 1e6) }), 0, 10),
}, (f: FabricValue) => f.unknown === (f.label === null));
const defectRegion = record({ capture_id: uuid, transform_id: ref, box, score: unit01, label: nullable(ref) }, (r: DefectRegion) => orderedBox(r.box));
const defectView = record({ capture_id: uuid, capture_sha256: sha, transform_id: ref, score: unit01, observed_area_cm2: nullable(nonNeg) });
const defectValue = record({ score: unit01, regions: list(defectRegion, 0, 200), observed_area_cm2: nonNeg, views: list(defectView, 1, 4) }, (d: DefectValue) => {
  const seen = d.views.map(view => view.capture_id);
  return unique(seen) && d.regions.every(region => seen.includes(region.capture_id));
});
const measurement = record({
  capture_id: uuid, capture_sha256: sha, source_roi: box, calibration_sha256: sha, geometry_artifact_sha256: sha, uncertainty_report_sha256: sha,
  axis_registration_id: uuid, axis: lit(...AXES), unit: lit('count/in'), value: nonNeg, interval95: tuple(nonNeg, nonNeg), reference_id: ref, method_version: ref,
}, (m: Measurement) => m.interval95[0] <= m.value && m.value <= m.interval95[1] && orderedBox(m.source_roi));
const qualityValue = record({ checks: record(Object.fromEntries(QUALITY_CHECKS.map(name => [name, bool]))) });
export const isEvidence = record({
  schema_version: lit('2'), id: uuid, sample_id: uuid, capture_ids: list(uuid, 1, 4), spec_sha256: sha, domain_id: nullable(ref),
  domain: stage(domainValue), fabric: stage(fabricValue), defects: stage(defectValue), metrology: stage(list(measurement)), quality: stage(qualityValue),
  contradictions: list(reason, 0, 12), manifest_sha256: sha, created_at: utc,
}, (e: Evidence) => {
  if (e.metrology.state === 'OK') {
    const axes = (e.metrology.value ?? []).map(m => m.axis);
    if (axes.length !== 2 || !unique(axes)) return false;
    if (!Object.values(REQUIRED_AXES).some(pair => axes.every(axis => pair.includes(axis)))) return false;
    if ((e.metrology.value ?? []).some(m => !e.capture_ids.includes(m.capture_id))) return false;
  }
  return !(e.defects.state === 'OK' && e.defects.value?.views.some(view => !e.capture_ids.includes(view.capture_id)));
});
const draftFields = { status: lit(...DECISION_STATUSES), reasons: list(reason, 0, 16), automatic: bool, scope: lit('INSPECTED_SAMPLE') };
const draftRule = (d: DecisionDraft) => d.automatic === (d.status === 'ACCEPT' || d.status === 'HOLD') && (d.status === 'ACCEPT' || d.reasons.length > 0) && unique(d.reasons);
export const isDecisionDraft = record(draftFields, draftRule);
export const isDecision = record({
  ...draftFields, schema_version: lit('2'), id: uuid, sample_id: uuid, evidence_id: uuid, spec_id: uuid, spec_version: int(1), revision: int(1),
  policy_version: ref, release_id: nullable(uuid), evaluated_at: utc,
}, (d: Decision) => draftRule(d) && !(d.automatic && d.release_id === null));
export const isAdjudication = record({
  id: uuid, sample_id: uuid, revision: int(1), outcome: lit('CONFORMING', 'NONCONFORMING', 'UNDETERMINED'), reason: longText,
  reference_ids: list(ref, 0, 20), actor_id: ref, created_at: utc, supersedes_id: nullable(uuid), intervention_reason: nullable(longText),
});
const family = record({
  selection_id: uuid, predecessor_sample_id: nullable(uuid), successor_sample_ids: list(uuid, 0, 20), attempts_used: int(0, 3), attempts_max: lit(3),
  spec_is_current: bool, current_spec_version: int(1),
});
export const isQCResult = record({
  schema_version: lit('2'), mode: lit('REVIEW_ONLY', 'AUTOMATIC'), sample: isSample, captures: list(isCapture, 0, 12), capture_sets: list(isCaptureSet, 0, 4),
  evidence: nullable(isEvidence), decision: nullable(isDecision), history: list(isDecision, 0, 50), adjudications: list(isAdjudication, 0, 100),
  current_human_disposition: nullable(isAdjudication), recalled_decision_ids: list(uuid, 0, 50), family, revision: int(0),
}, (r: QCResult) => {
  if (r.revision !== r.sample.revision || (r.decision === null) !== (r.evidence === null)) return false;
  if (r.decision) {
    if (r.decision.sample_id !== r.sample.id || r.decision.evidence_id !== r.evidence!.id) return false;
    if (r.decision.spec_id !== r.sample.spec_id || r.decision.spec_version !== r.sample.spec_version) return false;
    if (!r.history.some(d => d.id === r.decision!.id)) return false;
  }
  return r.captures.every(c => c.sample_id === r.sample.id);
}) as (value: unknown) => value is QCResult;
export const isRelease = record({
  id: uuid, version: ref, sha256: sha, workspace_id: uuid, state: lit('STATISTICAL_CANDIDATE', 'ACTIVE', 'SUSPENDED'), domain_sha256: sha,
  policy_sha256: sha, bundle_sha256: sha, calibration_sha256: sha, statistics_report_sha256: sha, operations_proof_sha256: nullable(sha),
  monitoring_protocol_sha256: nullable(sha), authority_record_sha256: sha, approved_by: ref, independent_signatory: ref, expires_at: utc,
  predecessor_release_id: nullable(uuid),
}, (r: Release) => r.approved_by.trim().toLowerCase() !== r.independent_signatory.trim().toLowerCase()
  && !(r.state === 'ACTIVE' && (r.operations_proof_sha256 === null || r.monitoring_protocol_sha256 === null)));
export const isReadiness = record({
  schema_version: lit('2'), ready: bool, bundle_sha256: nullable(sha),
  stages: list(record({ name: lit(...STAGE_NAMES), state: lit(...STAGE_STATES), artifact_sha256: nullable(sha), reasons: list(reason, 0, 12) }), 5, 5),
}, (r: Readiness) => r.stages.every((s, index) => s.name === STAGE_NAMES[index])
  && r.ready === (r.stages.every(s => s.state === 'OK' && !!s.artifact_sha256) && r.bundle_sha256 !== null)) as (value: unknown) => value is Readiness;
export const isErrorEnvelope = record({
  schema_version: lit('2'), error: record({ code: lit(...ERROR_CODES), reasons: list(reason, 0, 12), retryable: bool, request_id: ref }),
}) as (value: unknown) => value is ErrorEnvelope;

/** Guards by contract type name, for the shared fixtures. Types the web never receives are absent. */
export const GUARDS: Record<string, Check> = {
  Provenance: isProvenance, DensitySpec: isDensitySpec, PurchaseSpec: isPurchaseSpec, SamplingSelection: isSamplingSelection, Sample: isSample,
  AcquisitionAttestation: isAcquisitionAttestation, Capture: isCapture, CaptureSet: isCaptureSet, ConsentAuthority: isConsentAuthority,
  Evidence: isEvidence, DecisionDraft: isDecisionDraft, Decision: isDecision, Adjudication: isAdjudication, QCResult: isQCResult,
  Release: isRelease, Readiness: isReadiness, ErrorEnvelope: isErrorEnvelope,
};

/** Counts per inch from counts per inch or per centimetre: exactly x2.54, for display beside a measurement only. */
export function perInch(value: number, unit: DensityUnit): number { return unit === 'count/cm' ? value * 2.54 : value; }

/** Public envelopes are validated as well as the records inside them. */
export const isQCStatus = record({
 schema_version: lit('2'), mode: lit('REVIEW_ONLY', 'AUTOMATIC'), automation: record({ enabled: bool, missing_gates: list(ref) }),
 readiness: nullable(isReadiness), scanner: lit('CONNECTED', 'UNAVAILABLE'), limits: value => isObject(value) && Object.values(value).every(num(0)), role: ref,
 can: record({ confirm_spec: bool, create_sample: bool, capture: bool, adjudicate: bool, manage_release: bool }),
}, undefined, ['limits']) as (value: unknown) => value is QCStatus;
export const isPurchaseOrderList = record({ items: list(record({ purchase_order_id: ref, reference: ref, supplier_name: text(null, 0, 2000), status: ref, current_spec: nullable(record({ id: uuid, version: int(1), confirmed_at: utc, construction: lit('woven', 'knit') })) })) });
export const isSampleList = record({ items: list(record({ sample_id: uuid, roll_ref: ref, location_ref: ref, spec_version: int(1), revision: int(0), status: nullable(lit(...DECISION_STATUSES)), disposition: lit('SELECTED', 'SUBMITTED', 'MISSING', 'EXCLUDED'), created_at: utc })) });
export const isRequestState = record({ schema_version: lit('2'), request_id: uuid, state: lit('IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'FAILED'), result: nullable(isQCResult), error: nullable(record({ code: lit(...ERROR_CODES), reasons: list(reason, 0, 12), retryable: bool, request_id: ref })) }, (v: RequestState) => (v.state === 'COMPLETED') === (v.result !== null)) as (value: unknown) => value is RequestState;
