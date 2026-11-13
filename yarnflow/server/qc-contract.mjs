/**
 * Incoming-fabric QC v2 contract on the Worker: the same canonical JSON and SHA-256 as scanner/services/api/qc_schemas.py,
 * a JSON-Schema-subset validator over the checked-in schema, and the cross-field rules a record must satisfy to be a record.
 * No business policy lives here: the one evaluator is the scanner's Python evaluate_qc.
 */
import schema from './qc-schema.mjs';

export const SCHEMA = schema;
export const LIMITS = schema['x-limits'];
export const ERROR_STATUS = schema['x-error-status'];
export const CAPTURE_FIXABLE = schema['x-capture-fixable'];
export const TYPES = schema['x-types'];
export const STAGES = ['quality', 'fabric', 'defects', 'metrology', 'domain'];
const AXES = { woven: ['ends', 'picks'], knit: ['wales', 'courses'] };

/** Deterministic JSON: keys sorted by UTF-16 unit, no whitespace, ECMAScript number text. Non-finite numbers throw. */
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite numbers cannot be hashed'); return Object.is(value, -0) ? '0' : String(value); }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new TypeError('sparse arrays are not JSON'); return '[' + value.map(canonicalJson).join(',') + ']'; }
  if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw new TypeError(`cannot canonicalise ${typeof value}`);
}
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async data => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)));
/** SHA-256 of the canonical JSON of a record without the named top-level fields (its own hash, for instance). */
export const contentSha256 = (value, exclude = []) => sha256Hex(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => !exclude.includes(key)))));
export const HASH_EXCLUDES = { PurchaseSpec: ['content_sha256'], Policy: ['sha256'], DomainManifest: ['sha256'], Release: ['sha256', 'state'], Evidence: ['manifest_sha256', 'id', 'created_at'] };
export const isoTime = ms => new Date(ms).toISOString();

const unique = list => new Set(list).size === list.length;
const sameSet = (a, b) => a.length === b.length && unique(a) && a.every(item => b.includes(item));
const box = b => b[0] < b[2] && b[1] < b[3];
function stage(s) {
  if (s.state === 'OK') { if (s.value === null || s.artifact_sha256 === null) return 'an OK stage needs a value and the artifact that produced it'; }
  else { if (s.value !== null) return `a ${s.state} stage carries no value`; if (!s.reasons.length) return `a ${s.state} stage must say why`; }
  return unique(s.reasons) ? null : 'reasons must be unique';
}
function draft(d) {
  if (d.automatic !== ['ACCEPT', 'HOLD'].includes(d.status)) return 'automatic is true exactly for ACCEPT and HOLD';
  if (d.status !== 'ACCEPT' && !d.reasons.length) return 'every status except ACCEPT states at least one reason';
  return unique(d.reasons) ? null : 'reasons must be unique';
}
/** Cross-field rules, one per schema definition; each mirrors the Pydantic validator of the same record. */
const SEMANTIC = {
  Provenance: v => v.span && v.span[0] > v.span[1] ? 'span start must not exceed its end' : null,
  DensitySpec: v => !(v.lower <= v.target && v.target <= v.upper) ? 'density limits must satisfy lower <= target <= upper' : v.provenance.source !== 'PO_CONFIRMED' ? 'a specification value must be a confirmed PO value' : null,
  PurchaseSpec: v => !sameSet(v.density.map(d => d.axis), AXES[v.construction]) ? `a ${v.construction} specification needs exactly ${AXES[v.construction]}`
    : !unique(v.allowed_fabric_labels) ? 'allowed_fabric_labels must be unique'
    : v.supersedes_version !== null && v.supersedes_version !== v.version - 1 ? 'a version supersedes exactly the version before it'
    : (v.version === 1) !== (v.supersedes_version === null) ? 'only version 1 has no predecessor' : null,
  Sample: v => ['MISSING', 'EXCLUDED'].includes(v.disposition) !== (v.exclusion_reason !== null) ? 'MISSING and EXCLUDED samples carry a reason; others do not' : null,
  Capture: v => v.width * v.height > LIMITS.max_decoded_pixels ? 'capture exceeds the decoded pixel limit' : null,
  CaptureSet: v => (v.state === 'CLOSED') !== (v.attempt !== null) ? 'only a closed capture set has an attempt number' : !unique(v.capture_ids) ? 'capture_ids must be unique' : !unique(v.required_roles) ? 'required_roles must be unique' : null,
  Stage_DomainValue_: stage, Stage_FabricValue_: stage, Stage_DefectValue_: stage, Stage_QualityValue_: stage, Stage_list_Measurement__: stage,
  FabricValue: v => v.unknown !== (v.label === null) ? 'unknown fabric has a null label, and a known one has a label' : null,
  DefectRegion: v => box(v.box) ? null : 'box must satisfy x0 < x1 and y0 < y1',
  DefectValue: v => { const seen = v.views.map(view => view.capture_id); return !unique(seen) ? 'one defect view per capture' : v.regions.some(r => !seen.includes(r.capture_id)) ? 'every region belongs to an evaluated view' : null; },
  Measurement: v => !(v.interval95[0] <= v.value && v.value <= v.interval95[1]) ? 'interval95 must satisfy low <= value <= high' : box(v.source_roi) ? null : 'source_roi must satisfy x0 < x1 and y0 < y1',
  Evidence: v => {
    if (v.metrology.state === 'OK') {
      const axes = v.metrology.value.map(m => m.axis);
      if (axes.length !== 2 || !unique(axes)) return 'an OK metrology stage has exactly one measurement per axis';
      if (!sameSet(axes, AXES.woven) && !sameSet(axes, AXES.knit)) return "measurements must be one construction's two axes";
      if (v.metrology.value.some(m => !v.capture_ids.includes(m.capture_id))) return "a measurement must belong to this evidence's captures";
    }
    if (v.defects.state === 'OK' && v.defects.value && v.defects.value.views.some(view => !v.capture_ids.includes(view.capture_id))) return "a defect view must belong to this evidence's captures";
    return null;
  },
  DecisionDraft: draft,
  Decision: v => draft(v) ?? (v.automatic && v.release_id === null ? 'an automatic decision names the release that authorised it' : null),
  QCResult: v => {
    if (v.revision !== v.sample.revision) return 'revision must equal the sample revision';
    if ((v.decision === null) !== (v.evidence === null)) return 'a decision and its evidence are returned together';
    if (v.decision) {
      if (v.decision.sample_id !== v.sample.id) return 'the decision belongs to another sample';
      if (v.decision.evidence_id !== v.evidence.id) return 'the decision is bound to different evidence';
      if (v.decision.spec_id !== v.sample.spec_id || v.decision.spec_version !== v.sample.spec_version) return 'the decision is bound to a different specification';
      if (!v.history.some(d => d.id === v.decision.id)) return 'the current decision must appear in history';
    }
    return v.captures.some(c => c.sample_id !== v.sample.id) ? 'a capture belongs to another sample' : null;
  },
  Policy: v => sameSet(v.required_stages, STAGES) ? null : 'a policy requires all five stages',
  DomainManifest: v => !(v.defect_accept_below < v.defect_hold_at_or_above) ? 'defect_accept_below must be below defect_hold_at_or_above' : unique(v.required_roles) ? null : 'required_roles must be unique',
  Release: v => v.approved_by.trim().toLowerCase() === v.independent_signatory.trim().toLowerCase() ? 'the independent signatory must be a different person'
    : v.state === 'ACTIVE' && (v.operations_proof_sha256 === null || v.monitoring_protocol_sha256 === null) ? 'an ACTIVE release needs operations and monitoring proof' : null,
  CalibrationProfile: v => v.distance_mm[0] > v.distance_mm[1] ? 'distance_mm must be [near, far]' : v.valid_from >= v.expires_at ? 'a calibration profile must be valid before it expires' : null,
  AxisRegistration: v => { const n = Math.hypot(v.direction_xy[0], v.direction_xy[1]); return n >= 0.99 && n <= 1.01 ? null : 'direction_xy must be a unit vector'; },
  ValidatedCapture: v => v.verified_sha256 !== v.capture.original_sha256 ? "verified_sha256 must equal the capture's original hash"
    : v.attestation.image_sha256 !== v.capture.original_sha256 ? 'the attestation describes a different image'
    : v.axis_registration && (v.axis_registration.capture_id !== v.capture.id || v.axis_registration.capture_sha256 !== v.capture.original_sha256) ? 'the axis registration describes a different capture' : null,
  Readiness: v => {
    if (v.stages.map(s => s.name).join() !== STAGES.join()) return 'readiness reports each required stage once, in order';
    const usable = v.stages.every(s => s.state === 'OK' && s.artifact_sha256);
    return v.ready !== (usable && v.bundle_sha256 !== null) ? 'ready is true exactly when every stage has a usable artifact' : null;
  },
  AnalyzeRequest: v => !unique(v.captures.map(c => c.capture.id)) ? 'captures must be distinct'
    : v.captures.some(c => c.capture.sample_id !== v.sample_id) ? 'a capture belongs to another sample'
    : new Set(v.captures.map(c => c.capture.capture_set_id)).size !== 1 ? 'captures must come from one closed capture set'
    : v.spec.workspace_id !== v.workspace_id ? 'the specification belongs to another workspace'
    : v.release && v.release.workspace_id !== v.workspace_id ? 'the release belongs to another workspace' : null,
  AssertionClaims: v => v.exp - v.iat > 0 && v.exp - v.iat <= LIMITS.assertion_ttl_s ? null : 'an assertion lives at most 30 seconds',
};

const patterns = new Map();
const pattern = source => { if (!patterns.has(source)) patterns.set(source, new RegExp(source)); return patterns.get(source); };
const kind = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
/** First violation as `{path, message, layer}`, or null. `layer` is 'schema' (shape) or 'semantic' (cross-field rule). */
function check(node, value, path, semantic = true) {
  if (node.$ref) {
    const name = node.$ref.slice('#/$defs/'.length), failed = check(schema.$defs[name], value, path, semantic);
    if (failed) return failed;
    const message = semantic ? SEMANTIC[name]?.(value) : null;
    return message ? { path, message, layer: 'semantic' } : null;
  }
  const bad = message => ({ path, message, layer: 'schema' });
  if (node.anyOf) {
    let first = null;
    for (const option of node.anyOf) { const failed = check(option, value, path, semantic); if (!failed) return null; if (!first || (failed.layer === 'semantic' && first.layer !== 'semantic')) first = failed; }
    return first;
  }
  if ('const' in node && value !== node.const) return bad(`must be ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.includes(value)) return bad('is not an allowed value');
  const type = kind(value);
  if (node.type) {
    const ok = node.type === 'integer' ? type === 'number' && Number.isInteger(value) : node.type === 'number' ? type === 'number' && Number.isFinite(value) : node.type === type;
    if (!ok) return bad(`must be ${node.type}`);
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) return bad('must be finite');
    if (node.minimum !== undefined && value < node.minimum) return bad(`must be at least ${node.minimum}`);
    if (node.maximum !== undefined && value > node.maximum) return bad(`must be at most ${node.maximum}`);
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) return bad(`must be above ${node.exclusiveMinimum}`);
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) return bad(`must be below ${node.exclusiveMaximum}`);
  }
  if (type === 'string') {
    if (node.minLength !== undefined && [...value].length < node.minLength) return bad('is too short');
    if (node.maxLength !== undefined && [...value].length > node.maxLength) return bad('is too long');
    if (node.pattern && !pattern(node.pattern).test(value)) return bad('has an invalid format');
  }
  if (type === 'array') {
    if (node.minItems !== undefined && value.length < node.minItems) return bad('has too few items');
    if (node.maxItems !== undefined && value.length > node.maxItems) return bad('has too many items');
    for (let i = 0; i < value.length; i++) {
      const item = node.prefixItems?.[i] ?? node.items;
      if (item) { const failed = check(item, value[i], `${path}[${i}]`, semantic); if (failed) return failed; }
    }
  }
  if (type === 'object' && (node.properties || node.additionalProperties === false)) {
    const properties = node.properties ?? {};
    for (const key of node.required ?? []) if (!Object.hasOwn(value, key)) return { path: `${path}.${key}`, message: 'is required', layer: 'schema' };
    for (const key of Object.keys(value)) {
      if (!(key in properties)) { if (node.additionalProperties === false) return { path: `${path}.${key}`, message: 'is not an allowed field', layer: 'schema' }; continue; }
      const failed = check(properties[key], value[key], `${path}.${key}`, semantic); if (failed) return failed;
    }
  }
  return null;
}
/** Validate `value` as the named contract record. Returns null when valid. */
export function violation(type, value) {
  if (!schema.$defs[type]) throw new Error(`unknown contract type ${type}`);
  return check({ $ref: `#/$defs/${type}` }, value, type);
}
export const isValid = (type, value) => violation(type, value) === null;
/** Fields the schema gives a default (all null today) are written explicitly, so every language hashes the same bytes. */
export function withDefaults(type, value) {
  const node = schema.$defs[type], result = { ...value };
  for (const [key, property] of Object.entries(node.properties)) if (!(key in result) && 'default' in property) result[key] = property.default;
  return result;
}
/** A stored PurchaseSpec: valid shape and its hash matches its content (parse_qc_spec). */
export async function parseSpec(payload) {
  const failed = violation('PurchaseSpec', payload);
  if (failed) throw new Error(`${failed.path} ${failed.message}`);
  if (payload.content_sha256 !== await contentSha256(payload, HASH_EXCLUDES.PurchaseSpec)) throw new Error('content_sha256 does not match the specification content');
  return payload;
}
/** Counts per inch from counts per inch or per centimetre: exactly x2.54, nothing else. */
export function normalizeDensity(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('density must be a finite number');
  if (value < 0) throw new Error('density cannot be negative');
  if (unit === 'count/in') return value;
  if (unit === 'count/cm') return value * 2.54;
  throw new Error(`unsupported density unit ${JSON.stringify(unit)}`);
}

/** JSON Schema alone, without semantic cross-field checks. */
export function schemaViolation(type, value) { if (!schema.$defs[type]) throw new Error(`unknown contract type ${type}`); return check({ $ref: `#/$defs/${type}` }, value, type, false); }
