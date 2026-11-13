import Foundation
import CoreFoundation

// Incoming-fabric QC v2 wire contract, mirrored from scanner/services/api/qc_schemas.py.
//
// Decoding is strict and has three layers, all of which must pass before the app shows a record:
//   1. the canonical JSON Schema (scanner/contracts/qc-v2.schema.json, bundled as a resource):
//      unknown fields, unknown enum values, patterns, ranges and required keys;
//   2. Codable decoding into the types below (property names equal the wire names on purpose);
//   3. `check()`: the same cross-field rules the Python models enforce.
// There is no business policy here. The server decides; this file only refuses malformed records.

// MARK: - JSON value and schema validation

enum JSONValue: Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    static func parse(_ data: Data) throws -> JSONValue {
        do { return try JSONValue(any: JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) }
        catch let error as QCContractError { throw error }
        catch { throw QCContractError.malformed("not valid JSON") }
    }
    init(any: Any) throws {
        switch any {
        case is NSNull: self = .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) }
            else { guard n.doubleValue.isFinite else { throw QCContractError.malformed("non-finite number") }; self = .number(n.doubleValue) }
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(try a.map(JSONValue.init(any:)))
        case let o as [String: Any]: self = .object(try o.mapValues(JSONValue.init(any:)))
        default: throw QCContractError.malformed("unsupported JSON value")
        }
    }
    var any: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n): return n.rounded() == n && abs(n) < 9e15 ? NSNumber(value: Int64(n)) : NSNumber(value: n)
        case .string(let s): return s
        case .array(let a): return a.map(\.any)
        case .object(let o): return o.mapValues(\.any)
        }
    }
    func data() throws -> Data { try JSONSerialization.data(withJSONObject: any, options: [.fragmentsAllowed, .sortedKeys]) }
    subscript(key: String) -> JSONValue? { if case .object(let o) = self { return o[key] }; return nil }
}

enum QCContractError: Error, Equatable, LocalizedError {
    case malformed(String)
    case schema(String)
    case semantic(String)
    case contractUnavailable
    var errorDescription: String? {
        switch self {
        case .malformed: return NSLocalizedString("qc.error.contract", comment: "Invalid record")
        case .schema: return NSLocalizedString("qc.error.contract", comment: "Invalid record")
        case .semantic: return NSLocalizedString("qc.error.contract", comment: "Invalid record")
        case .contractUnavailable: return NSLocalizedString("qc.error.not_configured", comment: "Missing contract")
        }
    }
}

/// The subset of JSON Schema 2020-12 that the generated contract uses.
struct QCSchema {
    let defs: [String: JSONValue]
    let limits: [String: Double]
    let captureFixable: Set<String>
    let typeNames: [String]

    init(data: Data) throws {
        let root = try JSONValue.parse(data)
        guard case .object(let d)? = root["$defs"] else { throw QCContractError.malformed("schema has no $defs") }
        defs = d
        var l: [String: Double] = [:]
        if case .object(let o)? = root["x-limits"] { for (k, v) in o { if case .number(let n) = v { l[k] = n } } }
        limits = l
        var fixable: Set<String> = []
        if case .array(let a)? = root["x-capture-fixable"] { for v in a { if case .string(let s) = v { fixable.insert(s) } } }
        captureFixable = fixable
        var names: [String] = []
        if case .array(let a)? = root["x-types"] { for v in a { if case .string(let s) = v { names.append(s) } } }
        typeNames = names
    }

    /// Fail closed: a build without the contract cannot decode any QC record.
    static let bundled: QCSchema? = {
        for bundle in [Bundle.main] + Bundle.allBundles {
            if let url = bundle.url(forResource: "qc-v2.schema", withExtension: "json"), let data = try? Data(contentsOf: url), let schema = try? QCSchema(data: data) { return schema }
        }
        return nil
    }()

    func validate(_ value: JSONValue, type: String) throws {
        guard let node = defs[type] else { throw QCContractError.schema("unknown contract type \(type)") }
        try check(value, node, path: type)
    }

    private static var regexCache: [String: NSRegularExpression] = [:]
    private static let regexLock = NSLock()
    private static func regex(_ pattern: String) throws -> NSRegularExpression {
        regexLock.lock(); defer { regexLock.unlock() }
        if let r = regexCache[pattern] { return r }
        guard let r = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else { throw QCContractError.schema("unsupported pattern") }
        regexCache[pattern] = r; return r
    }

    private func check(_ value: JSONValue, _ schema: JSONValue, path: String) throws {
        guard case .object(let s) = schema else { throw QCContractError.schema("\(path): schema node is not an object") }
        func fail(_ why: String) -> QCContractError { .schema("\(path): \(why)") }
        if case .string(let ref)? = s["$ref"] {
            let name = ref.replacingOccurrences(of: "#/$defs/", with: "")
            guard let target = defs[name] else { throw fail("unresolved \(ref)") }
            try check(value, target, path: path)
        }
        if case .array(let options)? = s["anyOf"] {
            guard options.contains(where: { (try? check(value, $0, path: path)) != nil }) else { throw fail("matches none of the allowed shapes") }
        }
        if let constant = s["const"], constant != value { throw fail("must equal a fixed value") }
        if case .array(let allowed)? = s["enum"], !allowed.contains(value) { throw fail("is not an allowed value") }
        if case .string(let type)? = s["type"] {
            switch (type, value) {
            case ("null", .null), ("boolean", .bool), ("string", .string), ("number", .number), ("array", .array), ("object", .object): break
            case ("integer", .number(let n)) where n.rounded() == n: break
            default: throw fail("must be \(type)")
            }
        }
        switch value {
        case .string(let text):
            let length = text.unicodeScalars.count
            if case .number(let n)? = s["minLength"], Double(length) < n { throw fail("is too short") }
            if case .number(let n)? = s["maxLength"], Double(length) > n { throw fail("is too long") }
            if case .string(let pattern)? = s["pattern"] {
                let r = try QCSchema.regex(pattern)
                if r.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) == nil { throw fail("has the wrong format") }
            }
        case .number(let x):
            if case .number(let n)? = s["minimum"], x < n { throw fail("is below the minimum") }
            if case .number(let n)? = s["maximum"], x > n { throw fail("is above the maximum") }
            if case .number(let n)? = s["exclusiveMinimum"], x <= n { throw fail("is not above the exclusive minimum") }
            if case .number(let n)? = s["exclusiveMaximum"], x >= n { throw fail("is not below the exclusive maximum") }
        case .array(let items):
            if case .number(let n)? = s["minItems"], Double(items.count) < n { throw fail("has too few items") }
            if case .number(let n)? = s["maxItems"], Double(items.count) > n { throw fail("has too many items") }
            var prefix = 0
            if case .array(let schemas)? = s["prefixItems"] {
                prefix = schemas.count
                for (i, item) in items.enumerated() where i < schemas.count { try check(item, schemas[i], path: "\(path)[\(i)]") }
            }
            if let each = s["items"], case .object = each {
                for (i, item) in items.enumerated() where i >= prefix { try check(item, each, path: "\(path)[\(i)]") }
            }
        case .object(let members):
            if case .array(let required)? = s["required"] {
                for key in required { if case .string(let k) = key, members[k] == nil { throw fail("is missing \(k)") } }
            }
            var known: [String: JSONValue] = [:]
            if case .object(let p)? = s["properties"] { known = p }
            for (key, member) in members {
                if let sub = known[key] { try check(member, sub, path: "\(path).\(key)") }
                else if case .bool(false)? = s["additionalProperties"] { throw fail("has the unknown field \(key)") }
            }
        default: break
        }
    }
}

/// Cross-field rules. Every contract type states its own, and containers check their members.
protocol QCChecked { func check() throws }
extension Array: QCChecked where Element: QCChecked { func check() throws { for element in self { try element.check() } } }
extension Optional: QCChecked where Wrapped: QCChecked { func check() throws { try self?.check() } }
private func rule(_ ok: Bool, _ message: String) throws { if !ok { throw QCContractError.semantic(message) } }

enum QCContract {
    /// Strictly decode one contract record. `type` is the contract type name in the schema.
    static func decode<T: Decodable & QCChecked>(_ kind: T.Type, type: String, from data: Data, schema: QCSchema? = QCSchema.bundled) throws -> T {
        guard let schema else { throw QCContractError.contractUnavailable }
        try schema.validate(try JSONValue.parse(data), type: type)
        let record: T
        do { record = try JSONDecoder().decode(kind, from: data) } catch { throw QCContractError.malformed("\(type) could not be decoded") }
        try record.check()
        return record
    }

    /// Fixture parity: validates any contract type by name, exactly as the Python models do.
    static func validate(type: String, value: JSONValue, schema: QCSchema) throws {
        try schema.validate(value, type: type)
        guard let decoder = decoders[type] else { throw QCContractError.schema("no Swift mirror for \(type)") }
        try decoder(try value.data())
    }
    static func roundTrip(type: String, value: JSONValue, schema: QCSchema? = .bundled) throws -> JSONValue {
        guard let schema else { throw QCContractError.contractUnavailable }
        try validate(type: type, value: value, schema: schema)
        guard let roundTrip = roundTrippers[type] else { throw QCContractError.schema("no mirror") }
        return try roundTrip(value.data())
    }
    private static func round<T: Codable & QCChecked>(_ kind: T.Type) -> (Data) throws -> JSONValue {
        { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(kind, type: String(describing: kind).dropFirst(2).description, from: data))) }
    }
    private static func strict<T: Decodable & QCChecked>(_ kind: T.Type) -> (Data) throws -> Void {
        { data in
            let record: T
            do { record = try JSONDecoder().decode(kind, from: data) } catch { throw QCContractError.malformed("could not be decoded: \(error)") }
            try record.check()
        }
    }
    static let roundTrippers: [String: (Data) throws -> JSONValue] = [
        "Provenance": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCProvenance.self, type: "Provenance", from: data))) },
        "DensitySpec": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCDensitySpec.self, type: "DensitySpec", from: data))) },
        "PurchaseSpec": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCPurchaseSpec.self, type: "PurchaseSpec", from: data))) },
        "SamplingSelection": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCSamplingSelection.self, type: "SamplingSelection", from: data))) },
        "Sample": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCSample.self, type: "Sample", from: data))) },
        "AcquisitionAttestation": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCAcquisitionAttestation.self, type: "AcquisitionAttestation", from: data))) },
        "Capture": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCCaptureRecord.self, type: "Capture", from: data))) },
        "CaptureSet": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCCaptureSet.self, type: "CaptureSet", from: data))) },
        "ConsentAuthority": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCConsentAuthority.self, type: "ConsentAuthority", from: data))) },
        "Evidence": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCEvidence.self, type: "Evidence", from: data))) },
        "DecisionDraft": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCDecisionDraft.self, type: "DecisionDraft", from: data))) },
        "Decision": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCDecision.self, type: "Decision", from: data))) },
        "Adjudication": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCAdjudication.self, type: "Adjudication", from: data))) },
        "QCResult": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCResult.self, type: "QCResult", from: data))) },
        "Policy": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCPolicy.self, type: "Policy", from: data))) },
        "DomainManifest": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCDomainManifest.self, type: "DomainManifest", from: data))) },
        "Release": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCRelease.self, type: "Release", from: data))) },
        "EvaluationContext": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCEvaluationContext.self, type: "EvaluationContext", from: data))) },
        "CalibrationProfile": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCCalibrationProfile.self, type: "CalibrationProfile", from: data))) },
        "ScaleReference": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCScaleReference.self, type: "ScaleReference", from: data))) },
        "AxisRegistration": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCAxisRegistration.self, type: "AxisRegistration", from: data))) },
        "ValidatedCapture": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCValidatedCapture.self, type: "ValidatedCapture", from: data))) },
        "Readiness": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCReadiness.self, type: "Readiness", from: data))) },
        "AnalysisCandidate": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCAnalysisCandidate.self, type: "AnalysisCandidate", from: data))) },
        "AnalyzeRequest": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCAnalyzeRequest.self, type: "AnalyzeRequest", from: data))) },
        "AssertionClaims": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCAssertionClaims.self, type: "AssertionClaims", from: data))) },
        "ErrorEnvelope": { data in try JSONValue.parse(JSONEncoder().encode(QCContract.decode(QCErrorEnvelope.self, type: "ErrorEnvelope", from: data))) },
    ]
    static let decoders: [String: (Data) throws -> Void] = [
        "Provenance": strict(QCProvenance.self), "DensitySpec": strict(QCDensitySpec.self), "PurchaseSpec": strict(QCPurchaseSpec.self),
        "SamplingSelection": strict(QCSamplingSelection.self), "Sample": strict(QCSample.self), "AcquisitionAttestation": strict(QCAcquisitionAttestation.self),
        "Capture": strict(QCCaptureRecord.self), "CaptureSet": strict(QCCaptureSet.self), "ConsentAuthority": strict(QCConsentAuthority.self),
        "Evidence": strict(QCEvidence.self), "DecisionDraft": strict(QCDecisionDraft.self), "Decision": strict(QCDecision.self),
        "Adjudication": strict(QCAdjudication.self), "QCResult": strict(QCResult.self), "Policy": strict(QCPolicy.self),
        "DomainManifest": strict(QCDomainManifest.self), "Release": strict(QCRelease.self), "EvaluationContext": strict(QCEvaluationContext.self),
        "CalibrationProfile": strict(QCCalibrationProfile.self), "ScaleReference": strict(QCScaleReference.self), "AxisRegistration": strict(QCAxisRegistration.self),
        "ValidatedCapture": strict(QCValidatedCapture.self), "Readiness": strict(QCReadiness.self), "AnalysisCandidate": strict(QCAnalysisCandidate.self),
        "AnalyzeRequest": strict(QCAnalyzeRequest.self), "AssertionClaims": strict(QCAssertionClaims.self), "ErrorEnvelope": strict(QCErrorEnvelope.self),
    ]
}

// MARK: - Enumerations (an unknown value fails decoding; nothing is guessed)

enum QCDecisionStatus: String, Codable, CaseIterable { case ACCEPT, HOLD, RECAPTURE, MANUAL_REVIEW }
enum QCStageState: String, Codable, CaseIterable { case OK, ABSTAINED, FAILED, DISABLED, NOT_RUN }
enum QCStageName: String, Codable, CaseIterable { case quality, fabric, defects, metrology, domain }
enum QCReason: String, Codable, CaseIterable {
    case QUALITY_BLUR, QUALITY_GLARE, QUALITY_MOIRE, QUALITY_FOLD, QUALITY_FRAMING, SCALE_MISSING, SCALE_INVALID, CALIBRATION_EXPIRED,
         RESOLUTION_LOW, MEASUREMENT_UNCERTAIN, PATTERN_AMBIGUOUS, OOD, UNKNOWN_FABRIC, PO_UNCONFIRMED, PO_CONFLICT, PO_VERSION_STALE,
         UNIT_UNSUPPORTED, SPEC_MISSING, STAGE_UNAVAILABLE, DEFECT_SUSPECTED, CONSTRUCTION_OUTSIDE_TOLERANCE, FABRIC_MISMATCH,
         DOMAIN_UNVALIDATED, POLICY_UNRELEASED, RECAPTURE_LIMIT, EVIDENCE_STALE, AUDIT_UNAVAILABLE
    /// Reasons an operator can fix by taking the capture again (design §4).
    static let captureFixable: Set<QCReason> = [.QUALITY_BLUR, .QUALITY_GLARE, .QUALITY_MOIRE, .QUALITY_FOLD, .QUALITY_FRAMING, .SCALE_MISSING, .SCALE_INVALID, .RESOLUTION_LOW]
}
enum QCErrorCode: String, Codable, CaseIterable {
    case UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, MALFORMED_REQUEST, METHOD_NOT_ALLOWED, CONFLICT, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA,
         VALIDATION_FAILED, CAPACITY_LIMIT, SERVICE_UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL_ERROR
}
enum QCAxis: String, Codable, CaseIterable { case ends, picks, wales, courses }
enum QCDensityUnit: String, Codable { case perInch = "count/in", perCm = "count/cm" }
enum QCConstruction: String, Codable, CaseIterable {
    case woven, knit
    var axes: Set<QCAxis> { self == .woven ? [.ends, .picks] : [.wales, .courses] }
}
enum QCCaptureRole: String, Codable, CaseIterable { case overview, structure, defect, scale }
enum QCProvenanceSource: String, Codable { case PO_CONFIRMED, OCR_CANDIDATE, OPERATOR, MODEL, PHYSICAL_REFERENCE }
enum QCFace: String, Codable, CaseIterable { case face, back, unknown }
enum QCCohort: String, Codable, CaseIterable { case OPERATIONAL, CONFIRMATORY, CHALLENGE }
enum QCDisposition: String, Codable { case SELECTED, SUBMITTED, MISSING, EXCLUDED }
enum QCCaptureMode: String, Codable { case NATIVE_CAMERA, WEB_CAMERA, IMPORTED, REENCODED, CANVAS }
enum QCMediaType: String, Codable { case jpeg = "image/jpeg", png = "image/png", webp = "image/webp" }
enum QCOriginalState: String, Codable { case AVAILABLE, PURGED }
enum QCCaptureSetState: String, Codable { case OPEN, CLOSED }
enum QCMode: String, Codable { case REVIEW_ONLY, AUTOMATIC }
enum QCAdjudicationOutcome: String, Codable, CaseIterable { case CONFORMING, NONCONFORMING, UNDETERMINED }
enum QCReleaseState: String, Codable { case STATISTICAL_CANDIDATE, ACTIVE, SUSPENDED }
enum QCPhysicalIndicator: String, Codable { case SELVEDGE, WARP_MARK, QUALIFIED_REGISTRATION }

enum QCLimits {
    static let maxOriginalsPerSet = 4
    static let maxOriginalBytes = 12 * 1024 * 1024
    static let maxSetBytes = 48 * 1024 * 1024
    static let maxDecodedPixels = 16_000_000
    static let maxCaptureSets = 3
    static let requestDeadline: TimeInterval = 60
    static let draftLifetime: TimeInterval = 24 * 3600
}

// MARK: - Purchase specification

struct QCProvenance: Codable, Equatable, QCChecked {
    var source: QCProvenanceSource; var source_id: String; var source_version: String; var actor_id: String?; var observed_at: String; var image_sha256: String?
    var document_sha256: String?; var page: Int?; var span: [Int]?; var raw_value: String?; var raw_unit: String?; var ocr_confidence: Double?; var candidate_id: String?; var corrects_id: String?
    func check() throws { if let span { try rule(span.count == 2 && span[0] <= span[1], "span start must not exceed its end") } }
}
struct QCDensitySpec: Codable, Equatable, QCChecked {
    var axis: QCAxis; var unit: QCDensityUnit; var target: Double; var lower: Double; var upper: Double; var provenance: QCProvenance
    func check() throws {
        try provenance.check()
        try rule(lower <= target && target <= upper, "density limits must satisfy lower <= target <= upper")
        try rule(provenance.source == .PO_CONFIRMED, "a specification value must be a confirmed PO value")
    }
    /// Counts per inch: exactly ×2.54 from counts per centimetre, nothing else.
    func perInch(_ value: Double) -> Double { unit == .perInch ? value : value * 2.54 }
}
struct QCPurchaseSpec: Codable, Equatable, QCChecked {
    var schema_version: String; var id: String; var version: Int; var workspace_id: String; var purchase_order_id: String; var content_sha256: String
    var construction: QCConstruction; var allowed_fabric_labels: [String]; var taxonomy_version: String; var density: [QCDensitySpec]
    var confirmed_by: String; var confirmed_at: String; var supersedes_version: Int?
    func check() throws {
        try density.check()
        let axes = density.map(\.axis)
        try rule(Set(axes).count == axes.count && Set(axes) == construction.axes, "a \(construction.rawValue) specification needs exactly its two axes")
        try rule(Set(allowed_fabric_labels).count == allowed_fabric_labels.count, "allowed_fabric_labels must be unique")
        if let s = supersedes_version { try rule(s == version - 1, "a version supersedes exactly the version before it") }
        try rule((version == 1) == (supersedes_version == nil), "only version 1 has no predecessor")
    }
}

// MARK: - Sampling and capture

struct QCSamplingSelection: Codable, Equatable, QCChecked {
    var id: String; var workspace_id: String; var purchase_order_id: String; var plan_version: String; var plan_sha256: String?; var randomization_seed: String?
    var draw_index: Int?; var selection_probability: Double?; var cohort: QCCohort; var independent_group_id: String; var lot_ref: String; var roll_ref: String
    var location_ref: String; var face: QCFace; var planned_area_cm2: Double; var method: String; var created_by: String; var created_at: String
    func check() throws {}
}
struct QCSample: Codable, Equatable, QCChecked {
    var schema_version: String; var id: String; var workspace_id: String; var purchase_order_id: String; var spec_id: String; var spec_version: Int
    var lot_ref: String; var roll_ref: String; var location_ref: String; var sample_plan_version: String; var capture_attempt: Int; var revision: Int
    var predecessor_sample_id: String?; var selection_id: String; var face: QCFace; var planned_area_cm2: Double; var usable_area_cm2: Double?
    var sampling_method: String; var independent_group_id: String; var disposition: QCDisposition; var exclusion_reason: String?; var created_by: String; var created_at: String
    func check() throws {
        try rule((disposition == .MISSING || disposition == .EXCLUDED) == (exclusion_reason != nil), "MISSING and EXCLUDED samples carry a reason; others do not")
    }
}
struct QCAcquisitionAttestation: Codable, Equatable, QCChecked {
    var image_sha256: String; var capture_mode: QCCaptureMode; var device_model: String?; var lens_id: String?; var zoom_factor: Double?; var focus_mode: String?
    var exposure_mode: String?; var resolution: [Int]?; var orientation: Int?; var processing: String?; var captured_at: String
    func check() throws {}
    /// An imported, re-encoded or canvas image, or one whose lens/zoom/focus/exposure/resolution could not be
    /// observed, can never enter a validated physical profile: it is review-only evidence (design §18).
    var isReviewOnly: Bool {
        capture_mode != .NATIVE_CAMERA || device_model == nil || lens_id == nil || zoom_factor == nil || focus_mode == nil || exposure_mode == nil || resolution == nil || orientation == nil || processing == nil
    }
}
struct QCCaptureRecord: Codable, Equatable, Identifiable, QCChecked {
    var id: String; var sample_id: String; var capture_set_id: String; var original_sha256: String; var role: QCCaptureRole; var taken_at: String
    var device_profile_id: String; var calibration_id: String?; var width: Int; var height: Int; var preprocessing_version: String; var consent_record_id: String
    var byte_size: Int; var media_type: QCMediaType; var original_state: QCOriginalState; var attestation_sha256: String
    func check() throws { try rule(width * height <= QCLimits.maxDecodedPixels, "capture exceeds the decoded pixel limit") }
}
struct QCCaptureSet: Codable, Equatable, Identifiable, QCChecked {
    var id: String; var sample_id: String; var state: QCCaptureSetState; var required_roles: [QCCaptureRole]; var capture_ids: [String]; var revision: Int; var attempt: Int?
    func check() throws {
        try rule((state == .CLOSED) == (attempt != nil), "only a closed capture set has an attempt number")
        try rule(Set(capture_ids).count == capture_ids.count, "capture_ids must be unique")
        try rule(Set(required_roles).count == required_roles.count, "required_roles must be unique")
    }
}
struct QCConsentAuthority: Codable, Equatable, Identifiable, QCChecked {
    var id: String; var version: Int; var workspace_id: String; var authority_evidence_sha256: String; var operational_capture: Bool; var operational_retention_days: Int
    var research_use: Bool; var training_use: Bool; var export_destinations: [String]; var valid_from: String; var expires_at: String; var withdrawn_at: String?
    func check() throws {}
    /// Whether the app may offer this record for an operational capture now. The server checks again.
    func permitsCapture(at now: Date) -> Bool {
        let stamp = QCTime.string(now)
        return operational_capture && withdrawn_at == nil && valid_from <= stamp && stamp < expires_at
    }
}

// MARK: - Evidence stages

struct QCStage<Value: Codable & Equatable & QCChecked>: Codable, Equatable, QCChecked {
    var state: QCStageState; var value: Value?; var reasons: [QCReason]; var artifact_sha256: String?; var duration_ms: Double
    func check() throws {
        if state == .OK { try rule(value != nil && artifact_sha256 != nil, "an OK stage needs a value and the artifact that produced it") }
        else { try rule(value == nil, "a \(state.rawValue) stage carries no value"); try rule(!reasons.isEmpty, "a \(state.rawValue) stage must say why") }
        try rule(Set(reasons).count == reasons.count, "reasons must be unique")
        try value?.check()
    }
}
struct QCDomainValue: Codable, Equatable, QCChecked { var in_domain: Bool; var assessment_version: String; var profile_sha256: String; func check() throws {} }
struct QCFabricCandidate: Codable, Equatable, QCChecked { var label: String; var raw_score: Double; func check() throws {} }
struct QCFabricValue: Codable, Equatable, QCChecked {
    var label: String?; var taxonomy_version: String; var calibrated_probability: Double?; var unknown: Bool; var candidates: [QCFabricCandidate]
    func check() throws { try rule(unknown == (label == nil), "unknown fabric has a null label, and a known one has a label") }
}
private func boxOrdered(_ box: [Double]) -> Bool { box.count == 4 && box[0] < box[2] && box[1] < box[3] }
struct QCDefectRegion: Codable, Equatable, QCChecked {
    var capture_id: String; var transform_id: String; var box: [Double]; var score: Double; var label: String?
    func check() throws { try rule(boxOrdered(box), "box must satisfy x0 < x1 and y0 < y1") }
}
struct QCDefectView: Codable, Equatable, QCChecked { var capture_id: String; var capture_sha256: String; var transform_id: String; var score: Double; var observed_area_cm2: Double?; func check() throws {} }
struct QCDefectValue: Codable, Equatable, QCChecked {
    var score: Double; var regions: [QCDefectRegion]; var observed_area_cm2: Double; var views: [QCDefectView]
    func check() throws {
        try regions.check()
        let seen = Set(views.map(\.capture_id))
        try rule(seen.count == views.count, "one defect view per capture")
        try rule(regions.allSatisfy { seen.contains($0.capture_id) }, "every region belongs to an evaluated view")
    }
}
struct QCMeasurement: Codable, Equatable, QCChecked {
    var capture_id: String; var capture_sha256: String; var source_roi: [Double]; var calibration_sha256: String; var geometry_artifact_sha256: String
    var uncertainty_report_sha256: String; var axis_registration_id: String; var axis: QCAxis; var unit: String; var value: Double; var interval95: [Double]
    var reference_id: String; var method_version: String
    func check() throws {
        try rule(interval95.count == 2 && interval95[0] <= value && value <= interval95[1], "interval95 must satisfy low <= value <= high")
        try rule(boxOrdered(source_roi), "source_roi must satisfy x0 < x1 and y0 < y1")
    }
}
struct QCQualityChecks: Codable, Equatable {
    var blur: Bool; var glare: Bool; var moire: Bool; var fold: Bool; var framing: Bool; var resolution: Bool; var marker_geometry: Bool
    var named: [(String, Bool)] { [("blur", blur), ("glare", glare), ("moire", moire), ("fold", fold), ("framing", framing), ("resolution", resolution), ("marker_geometry", marker_geometry)] }
}
struct QCQualityValue: Codable, Equatable, QCChecked { var checks: QCQualityChecks; func check() throws {} }
struct QCEvidence: Codable, Equatable, QCChecked {
    var schema_version: String; var id: String; var sample_id: String; var capture_ids: [String]; var spec_sha256: String; var domain_id: String?
    var domain: QCStage<QCDomainValue>; var fabric: QCStage<QCFabricValue>; var defects: QCStage<QCDefectValue>; var metrology: QCStage<[QCMeasurement]>; var quality: QCStage<QCQualityValue>
    var contradictions: [QCReason]; var manifest_sha256: String; var created_at: String
    func check() throws {
        try domain.check(); try fabric.check(); try defects.check(); try metrology.check(); try quality.check()
        let ids = Set(capture_ids)
        if metrology.state == .OK {
            let measured = metrology.value ?? []
            let axes = measured.map(\.axis)
            try rule(axes.count == 2 && Set(axes).count == 2, "an OK metrology stage has exactly one measurement per axis")
            try rule(Set(axes) == QCConstruction.woven.axes || Set(axes) == QCConstruction.knit.axes, "measurements must be one construction's two axes")
            try rule(measured.allSatisfy { ids.contains($0.capture_id) }, "a measurement must belong to this evidence's captures")
        }
        if defects.state == .OK, let value = defects.value {
            try rule(value.views.allSatisfy { ids.contains($0.capture_id) }, "a defect view must belong to this evidence's captures")
        }
    }
    var stages: [(QCStageName, QCStageState, [QCReason])] {
        [(.quality, quality.state, quality.reasons), (.fabric, fabric.state, fabric.reasons), (.defects, defects.state, defects.reasons), (.metrology, metrology.state, metrology.reasons), (.domain, domain.state, domain.reasons)]
    }
}

// MARK: - Decisions

private func draftRules(status: QCDecisionStatus, reasons: [QCReason], automatic: Bool) throws {
    try rule(automatic == (status == .ACCEPT || status == .HOLD), "automatic is true exactly for ACCEPT and HOLD")
    try rule(status == .ACCEPT || !reasons.isEmpty, "every status except ACCEPT states at least one reason")
    try rule(Set(reasons).count == reasons.count, "reasons must be unique")
}
struct QCDecisionDraft: Codable, Equatable, QCChecked {
    var status: QCDecisionStatus; var reasons: [QCReason]; var automatic: Bool; var scope: String
    func check() throws { try draftRules(status: status, reasons: reasons, automatic: automatic) }
}
struct QCDecision: Codable, Equatable, Identifiable, QCChecked {
    var status: QCDecisionStatus; var reasons: [QCReason]; var automatic: Bool; var scope: String
    var schema_version: String; var id: String; var sample_id: String; var evidence_id: String; var spec_id: String; var spec_version: Int; var revision: Int
    var policy_version: String; var release_id: String?; var evaluated_at: String
    func check() throws {
        try draftRules(status: status, reasons: reasons, automatic: automatic)
        try rule(!automatic || release_id != nil, "an automatic decision names the release that authorised it")
    }
}
struct QCAdjudication: Codable, Equatable, Identifiable, QCChecked {
    var id: String; var sample_id: String; var revision: Int; var outcome: QCAdjudicationOutcome; var reason: String; var reference_ids: [String]
    var actor_id: String; var created_at: String; var supersedes_id: String?; var intervention_reason: String?
    func check() throws {}
}
struct QCFamily: Codable, Equatable, QCChecked {
    var selection_id: String; var predecessor_sample_id: String?; var successor_sample_ids: [String]; var attempts_used: Int; var attempts_max: Int; var spec_is_current: Bool; var current_spec_version: Int
    func check() throws {}
}
struct QCResult: Codable, Equatable, QCChecked {
    var schema_version: String; var mode: QCMode; var sample: QCSample; var captures: [QCCaptureRecord]; var capture_sets: [QCCaptureSet]
    var evidence: QCEvidence?; var decision: QCDecision?; var history: [QCDecision]; var adjudications: [QCAdjudication]; var current_human_disposition: QCAdjudication?
    var recalled_decision_ids: [String]; var family: QCFamily; var revision: Int
    func check() throws {
        try sample.check(); try captures.check(); try capture_sets.check(); try evidence.check(); try decision.check(); try history.check()
        try rule(revision == sample.revision, "revision must equal the sample revision")
        try rule((decision == nil) == (evidence == nil), "a decision and its evidence are returned together")
        if let decision {
            try rule(decision.sample_id == sample.id, "the decision belongs to another sample")
            if let evidence { try rule(decision.evidence_id == evidence.id, "the decision is bound to different evidence") }
            try rule(decision.spec_id == sample.spec_id && decision.spec_version == sample.spec_version, "the decision is bound to a different specification")
            try rule(history.contains { $0.id == decision.id }, "the current decision must appear in history")
        }
        try rule(captures.allSatisfy { $0.sample_id == sample.id }, "a capture belongs to another sample")
    }
    static func decode(_ data: Data) throws -> QCResult { try QCContract.decode(QCResult.self, type: "QCResult", from: data) }
}

// MARK: - Policy, release and service records (mirrored for fixture parity; the app only lists releases)

private let allStages: Set<QCStageName> = Set(QCStageName.allCases)
struct QCPolicy: Codable, Equatable, QCChecked {
    var schema_version: String; var version: String; var sha256: String; var mode: QCMode; var required_stages: [QCStageName]; var max_capture_sets: Int
    func check() throws { try rule(Set(required_stages) == allStages, "a policy requires all five stages") }
}
struct QCDomainManifest: Codable, Equatable, QCChecked {
    var id: String; var version: String; var sha256: String; var construction: QCConstruction; var effective_labels: [String]; var taxonomy_sha256: String
    var required_roles: [QCCaptureRole]; var profile_sha256s: [String]; var preprocessing_sha256: String; var score_transform_sha256: String
    var unknown_assessment_sha256: String; var quality_thresholds_sha256: String; var metrology_validation_sha256: String; var defect_accept_below: Double; var defect_hold_at_or_above: Double
    func check() throws {
        try rule(defect_accept_below < defect_hold_at_or_above, "defect_accept_below must be below defect_hold_at_or_above")
        try rule(Set(required_roles).count == required_roles.count, "required_roles must be unique")
    }
}
struct QCRelease: Codable, Equatable, Identifiable, QCChecked {
    var id: String; var version: String; var sha256: String; var workspace_id: String; var state: QCReleaseState; var domain_sha256: String; var policy_sha256: String
    var bundle_sha256: String; var calibration_sha256: String; var statistics_report_sha256: String; var operations_proof_sha256: String?; var monitoring_protocol_sha256: String?
    var authority_record_sha256: String; var approved_by: String; var independent_signatory: String; var expires_at: String; var predecessor_release_id: String?
    func check() throws {
        func key(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        try rule(key(approved_by) != key(independent_signatory), "the independent signatory must be a different person")
        try rule(state != .ACTIVE || (operations_proof_sha256 != nil && monitoring_protocol_sha256 != nil), "an ACTIVE release needs operations and monitoring proof")
    }
}
struct QCEvaluationContext: Codable, Equatable, QCChecked {
    var evaluated_at: String; var clock_source: String; var deadline_at: String; var calibration_records_sha256: String; var capture_binding_sha256: String; var request_id: String; var request_generation: Int
    func check() throws {}
}
struct QCCalibrationProfile: Codable, Equatable, QCChecked {
    var id: String; var version: String; var sha256: String; var device_profile_id: String; var lens_id: String; var resolution: [Int]; var focus_mode: String; var distance_mm: [Double]
    var lighting_protocol_sha256: String; var processing_sha256: String; var distortion_model_sha256: String; var source_resolution_limits_sha256: String; var uncertainty_model_sha256: String
    var reference_ids: [String]; var valid_from: String; var expires_at: String
    func check() throws {
        try rule(distance_mm.count == 2 && distance_mm[0] <= distance_mm[1], "distance_mm must be [near, far]")
        try rule(valid_from < expires_at, "a calibration profile must be valid before it expires")
    }
}
struct QCScaleReference: Codable, Equatable, QCChecked {
    var id: String; var sha256: String; var dimensions_mm: [Double]; var uncertainty_mm: [Double]; var traceability_report_sha256: String; var print_verification_sha256: String
    func check() throws {}
}
struct QCAxisRegistration: Codable, Equatable, QCChecked {
    var id: String; var capture_id: String; var capture_sha256: String; var physical_indicator: QCPhysicalIndicator; var provenance: QCProvenance
    var origin_xy: [Double]; var direction_xy: [Double]; var transform_sha256: String
    func check() throws {
        try provenance.check()
        let length = direction_xy.count == 2 ? (direction_xy[0] * direction_xy[0] + direction_xy[1] * direction_xy[1]).squareRoot() : 0
        try rule(length >= 0.99 && length <= 1.01, "direction_xy must be a unit vector")
    }
}
struct QCValidatedCapture: Codable, Equatable, QCChecked {
    var capture: QCCaptureRecord; var original_storage_reference: String; var verified_sha256: String; var acquisition_attestation_sha256: String; var attestation: QCAcquisitionAttestation
    var geometry_artifact_sha256: String?; var calibration: QCCalibrationProfile?; var reference: QCScaleReference?; var axis_registration: QCAxisRegistration?
    func check() throws {
        try capture.check(); try calibration.check(); try axis_registration.check()
        try rule(verified_sha256 == capture.original_sha256, "verified_sha256 must equal the capture's original hash")
        try rule(attestation.image_sha256 == capture.original_sha256, "the attestation describes a different image")
        if let a = axis_registration { try rule(a.capture_id == capture.id && a.capture_sha256 == capture.original_sha256, "the axis registration describes a different capture") }
    }
}
struct QCReadinessStage: Codable, Equatable { var name: QCStageName; var state: QCStageState; var artifact_sha256: String?; var reasons: [QCReason] }
struct QCReadiness: Codable, Equatable, QCChecked {
    var schema_version: String; var ready: Bool; var bundle_sha256: String?; var stages: [QCReadinessStage]
    func check() throws {
        try rule(stages.map(\.name) == QCStageName.allCases, "readiness reports each required stage once, in order")
        let usable = stages.allSatisfy { $0.state == .OK && ($0.artifact_sha256 ?? "") != "" }
        try rule(ready == (usable && bundle_sha256 != nil), "ready is true exactly when every stage has a usable artifact")
    }
}
struct QCAnalysisBinding: Codable, Equatable {
    var spec_sha256: String; var policy_sha256: String; var release_sha256: String?; var capture_sha256s: [String]; var attempt: Int; var expected_revision: Int
    var request_id: String; var request_generation: Int; var deadline_at: String
}
struct QCAnalysisCandidate: Codable, Equatable, QCChecked {
    var evidence: QCEvidence; var draft: QCDecisionDraft; var binding: QCAnalysisBinding
    func check() throws { try evidence.check(); try draft.check() }
}
struct QCAnalyzeRequest: Codable, Equatable, QCChecked {
    var schema_version: String; var sample_id: String; var workspace_id: String; var spec: QCPurchaseSpec; var policy: QCPolicy; var release: QCRelease?; var domain: QCDomainManifest?
    var attempt: Int; var expected_revision: Int; var context: QCEvaluationContext; var captures: [QCValidatedCapture]
    func check() throws {
        try spec.check(); try policy.check(); try release.check(); try domain.check(); try captures.check()
        let ids = captures.map(\.capture.id)
        try rule(Set(ids).count == ids.count, "captures must be distinct")
        try rule(captures.allSatisfy { $0.capture.sample_id == sample_id }, "a capture belongs to another sample")
        try rule(Set(captures.map(\.capture.capture_set_id)).count == 1, "captures must come from one closed capture set")
        try rule(spec.workspace_id == workspace_id, "the specification belongs to another workspace")
        if let release { try rule(release.workspace_id == workspace_id, "the release belongs to another workspace") }
    }
}
struct QCAssertionClaims: Codable, Equatable, QCChecked {
    var kid: String; var aud: String; var iat: Int; var exp: Int; var nonce: String; var request_id: String; var request_generation: Int
    var workspace_id: String; var actor_id: String; var payload_sha256: String; var deadline_at: String
    func check() throws { try rule(exp - iat > 0 && exp - iat <= 30, "an assertion lives at most 30 seconds") }
}
struct QCErrorBody: Codable, Equatable { var code: QCErrorCode; var reasons: [QCReason]; var retryable: Bool; var request_id: String }
struct QCErrorEnvelope: Codable, Equatable, QCChecked { var schema_version: String; var error: QCErrorBody; func check() throws {} }

// MARK: - Public API payloads that are not contract records (lead contract decisions, "Public Worker API")
// These shapes are described only in prose, so they are decoded with plain Codable and no schema.

struct QCStatus: Decodable, Equatable {
    struct Automation: Decodable, Equatable { var enabled: Bool; var missing_gates: [String] }
    struct Can: Decodable, Equatable { var confirm_spec: Bool; var create_sample: Bool; var capture: Bool; var adjudicate: Bool; var manage_release: Bool }
    var schema_version: String; var mode: QCMode; var automation: Automation; var readiness: QCReadiness?; var scanner: String; var role: String; var can: Can
}
struct QCPurchaseOrderItem: Decodable, Equatable, Identifiable {
    struct CurrentSpec: Decodable, Equatable { var id: String; var version: Int; var confirmed_at: String; var construction: QCConstruction }
    var purchase_order_id: String; var reference: String; var supplier_name: String; var status: String; var current_spec: CurrentSpec?
    var id: String { purchase_order_id }
}
struct QCSampleSummary: Decodable, Equatable, Identifiable {
    var sample_id: String; var roll_ref: String; var location_ref: String; var spec_version: Int; var revision: Int; var status: QCDecisionStatus?; var disposition: QCDisposition; var created_at: String
    var id: String { sample_id }
}
struct QCItems<Item: Decodable>: Decodable { var items: [Item] }
struct QCSpecEnvelope: Decodable { var spec: QCPurchaseSpec; var current: Bool; var versions: [Int] }
struct QCRequestState: Decodable {
    var schema_version: String; var request_id: String; var state: String; var result: QCResult?; var error: QCErrorBody?
}
struct QCPending: Decodable { var schema_version: String; var request_id: String; var state: String; var status_url: String }

enum QCTime {
    /// UTC RFC 3339 with the Z suffix, the only timestamp form the contract accepts.
    static func string(_ date: Date) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: date)
    }
    static func date(_ text: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: text) { return d }
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: text)
    }
}

// Codable's synthesized optional encoding drops nulls. The wire has explicit nulls, so each
// mirror validates its raw JSON before decoding and encodes every field, including nulls.
extension JSONValue: Codable {
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let x = try? c.decode(Bool.self) { self = .bool(x) }
        else if let x = try? c.decode(Double.self), x.isFinite { self = .number(x) }
        else if let x = try? c.decode(String.self) { self = .string(x) }
        else if let x = try? c.decode([JSONValue].self) { self = .array(x) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let x): try c.encode(x)
        case .number(let x): try c.encode(x)
        case .string(let x): try c.encode(x)
        case .array(let x): try c.encode(x)
        case .object(let x): try c.encode(x)
        }
    }
}
private func validateDecoder(_ decoder: Decoder, type: String) throws {
    guard let schema = QCSchema.bundled else { throw QCContractError.contractUnavailable }
    try schema.validate(JSONValue(from: decoder), type: type)
}

extension QCProvenance {
    enum CodingKeys: String, CodingKey { case source, source_id, source_version, actor_id, observed_at, image_sha256, document_sha256, page, span, raw_value, raw_unit, ocr_confidence, candidate_id, corrects_id }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Provenance")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decode(QCProvenanceSource.self, forKey: .source)
        source_id = try c.decode(String.self, forKey: .source_id)
        source_version = try c.decode(String.self, forKey: .source_version)
        actor_id = try c.decodeIfPresent(String.self, forKey: .actor_id)
        observed_at = try c.decode(String.self, forKey: .observed_at)
        image_sha256 = try c.decodeIfPresent(String.self, forKey: .image_sha256)
        document_sha256 = try c.decodeIfPresent(String.self, forKey: .document_sha256)
        page = try c.decodeIfPresent(Int.self, forKey: .page)
        span = try c.decodeIfPresent([Int].self, forKey: .span)
        raw_value = try c.decodeIfPresent(String.self, forKey: .raw_value)
        raw_unit = try c.decodeIfPresent(String.self, forKey: .raw_unit)
        ocr_confidence = try c.decodeIfPresent(Double.self, forKey: .ocr_confidence)
        candidate_id = try c.decodeIfPresent(String.self, forKey: .candidate_id)
        corrects_id = try c.decodeIfPresent(String.self, forKey: .corrects_id)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(source, forKey: .source)
        try c.encode(source_id, forKey: .source_id)
        try c.encode(source_version, forKey: .source_version)
        try c.encode(actor_id, forKey: .actor_id)
        try c.encode(observed_at, forKey: .observed_at)
        try c.encode(image_sha256, forKey: .image_sha256)
        try c.encode(document_sha256, forKey: .document_sha256)
        try c.encode(page, forKey: .page)
        try c.encode(span, forKey: .span)
        try c.encode(raw_value, forKey: .raw_value)
        try c.encode(raw_unit, forKey: .raw_unit)
        try c.encode(ocr_confidence, forKey: .ocr_confidence)
        try c.encode(candidate_id, forKey: .candidate_id)
        try c.encode(corrects_id, forKey: .corrects_id)
    }
}

extension QCDensitySpec {
    enum CodingKeys: String, CodingKey { case axis, unit, target, lower, upper, provenance }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DensitySpec")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        axis = try c.decode(QCAxis.self, forKey: .axis)
        unit = try c.decode(QCDensityUnit.self, forKey: .unit)
        target = try c.decode(Double.self, forKey: .target)
        lower = try c.decode(Double.self, forKey: .lower)
        upper = try c.decode(Double.self, forKey: .upper)
        provenance = try c.decode(QCProvenance.self, forKey: .provenance)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(axis, forKey: .axis)
        try c.encode(unit, forKey: .unit)
        try c.encode(target, forKey: .target)
        try c.encode(lower, forKey: .lower)
        try c.encode(upper, forKey: .upper)
        try c.encode(provenance, forKey: .provenance)
    }
}

extension QCPurchaseSpec {
    enum CodingKeys: String, CodingKey { case schema_version, id, version, workspace_id, purchase_order_id, content_sha256, construction, allowed_fabric_labels, taxonomy_version, density, confirmed_by, confirmed_at, supersedes_version }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "PurchaseSpec")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        id = try c.decode(String.self, forKey: .id)
        version = try c.decode(Int.self, forKey: .version)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        purchase_order_id = try c.decode(String.self, forKey: .purchase_order_id)
        content_sha256 = try c.decode(String.self, forKey: .content_sha256)
        construction = try c.decode(QCConstruction.self, forKey: .construction)
        allowed_fabric_labels = try c.decode([String].self, forKey: .allowed_fabric_labels)
        taxonomy_version = try c.decode(String.self, forKey: .taxonomy_version)
        density = try c.decode([QCDensitySpec].self, forKey: .density)
        confirmed_by = try c.decode(String.self, forKey: .confirmed_by)
        confirmed_at = try c.decode(String.self, forKey: .confirmed_at)
        supersedes_version = try c.decodeIfPresent(Int.self, forKey: .supersedes_version)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(id, forKey: .id)
        try c.encode(version, forKey: .version)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(purchase_order_id, forKey: .purchase_order_id)
        try c.encode(content_sha256, forKey: .content_sha256)
        try c.encode(construction, forKey: .construction)
        try c.encode(allowed_fabric_labels, forKey: .allowed_fabric_labels)
        try c.encode(taxonomy_version, forKey: .taxonomy_version)
        try c.encode(density, forKey: .density)
        try c.encode(confirmed_by, forKey: .confirmed_by)
        try c.encode(confirmed_at, forKey: .confirmed_at)
        try c.encode(supersedes_version, forKey: .supersedes_version)
    }
}

extension QCSamplingSelection {
    enum CodingKeys: String, CodingKey { case id, workspace_id, purchase_order_id, plan_version, plan_sha256, randomization_seed, draw_index, selection_probability, cohort, independent_group_id, lot_ref, roll_ref, location_ref, face, planned_area_cm2, method, created_by, created_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "SamplingSelection")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        purchase_order_id = try c.decode(String.self, forKey: .purchase_order_id)
        plan_version = try c.decode(String.self, forKey: .plan_version)
        plan_sha256 = try c.decodeIfPresent(String.self, forKey: .plan_sha256)
        randomization_seed = try c.decodeIfPresent(String.self, forKey: .randomization_seed)
        draw_index = try c.decodeIfPresent(Int.self, forKey: .draw_index)
        selection_probability = try c.decodeIfPresent(Double.self, forKey: .selection_probability)
        cohort = try c.decode(QCCohort.self, forKey: .cohort)
        independent_group_id = try c.decode(String.self, forKey: .independent_group_id)
        lot_ref = try c.decode(String.self, forKey: .lot_ref)
        roll_ref = try c.decode(String.self, forKey: .roll_ref)
        location_ref = try c.decode(String.self, forKey: .location_ref)
        face = try c.decode(QCFace.self, forKey: .face)
        planned_area_cm2 = try c.decode(Double.self, forKey: .planned_area_cm2)
        method = try c.decode(String.self, forKey: .method)
        created_by = try c.decode(String.self, forKey: .created_by)
        created_at = try c.decode(String.self, forKey: .created_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(purchase_order_id, forKey: .purchase_order_id)
        try c.encode(plan_version, forKey: .plan_version)
        try c.encode(plan_sha256, forKey: .plan_sha256)
        try c.encode(randomization_seed, forKey: .randomization_seed)
        try c.encode(draw_index, forKey: .draw_index)
        try c.encode(selection_probability, forKey: .selection_probability)
        try c.encode(cohort, forKey: .cohort)
        try c.encode(independent_group_id, forKey: .independent_group_id)
        try c.encode(lot_ref, forKey: .lot_ref)
        try c.encode(roll_ref, forKey: .roll_ref)
        try c.encode(location_ref, forKey: .location_ref)
        try c.encode(face, forKey: .face)
        try c.encode(planned_area_cm2, forKey: .planned_area_cm2)
        try c.encode(method, forKey: .method)
        try c.encode(created_by, forKey: .created_by)
        try c.encode(created_at, forKey: .created_at)
    }
}

extension QCSample {
    enum CodingKeys: String, CodingKey { case schema_version, id, workspace_id, purchase_order_id, spec_id, spec_version, lot_ref, roll_ref, location_ref, sample_plan_version, capture_attempt, revision, predecessor_sample_id, selection_id, face, planned_area_cm2, usable_area_cm2, sampling_method, independent_group_id, disposition, exclusion_reason, created_by, created_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Sample")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        id = try c.decode(String.self, forKey: .id)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        purchase_order_id = try c.decode(String.self, forKey: .purchase_order_id)
        spec_id = try c.decode(String.self, forKey: .spec_id)
        spec_version = try c.decode(Int.self, forKey: .spec_version)
        lot_ref = try c.decode(String.self, forKey: .lot_ref)
        roll_ref = try c.decode(String.self, forKey: .roll_ref)
        location_ref = try c.decode(String.self, forKey: .location_ref)
        sample_plan_version = try c.decode(String.self, forKey: .sample_plan_version)
        capture_attempt = try c.decode(Int.self, forKey: .capture_attempt)
        revision = try c.decode(Int.self, forKey: .revision)
        predecessor_sample_id = try c.decodeIfPresent(String.self, forKey: .predecessor_sample_id)
        selection_id = try c.decode(String.self, forKey: .selection_id)
        face = try c.decode(QCFace.self, forKey: .face)
        planned_area_cm2 = try c.decode(Double.self, forKey: .planned_area_cm2)
        usable_area_cm2 = try c.decodeIfPresent(Double.self, forKey: .usable_area_cm2)
        sampling_method = try c.decode(String.self, forKey: .sampling_method)
        independent_group_id = try c.decode(String.self, forKey: .independent_group_id)
        disposition = try c.decode(QCDisposition.self, forKey: .disposition)
        exclusion_reason = try c.decodeIfPresent(String.self, forKey: .exclusion_reason)
        created_by = try c.decode(String.self, forKey: .created_by)
        created_at = try c.decode(String.self, forKey: .created_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(id, forKey: .id)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(purchase_order_id, forKey: .purchase_order_id)
        try c.encode(spec_id, forKey: .spec_id)
        try c.encode(spec_version, forKey: .spec_version)
        try c.encode(lot_ref, forKey: .lot_ref)
        try c.encode(roll_ref, forKey: .roll_ref)
        try c.encode(location_ref, forKey: .location_ref)
        try c.encode(sample_plan_version, forKey: .sample_plan_version)
        try c.encode(capture_attempt, forKey: .capture_attempt)
        try c.encode(revision, forKey: .revision)
        try c.encode(predecessor_sample_id, forKey: .predecessor_sample_id)
        try c.encode(selection_id, forKey: .selection_id)
        try c.encode(face, forKey: .face)
        try c.encode(planned_area_cm2, forKey: .planned_area_cm2)
        try c.encode(usable_area_cm2, forKey: .usable_area_cm2)
        try c.encode(sampling_method, forKey: .sampling_method)
        try c.encode(independent_group_id, forKey: .independent_group_id)
        try c.encode(disposition, forKey: .disposition)
        try c.encode(exclusion_reason, forKey: .exclusion_reason)
        try c.encode(created_by, forKey: .created_by)
        try c.encode(created_at, forKey: .created_at)
    }
}

extension QCAcquisitionAttestation {
    enum CodingKeys: String, CodingKey { case image_sha256, capture_mode, device_model, lens_id, zoom_factor, focus_mode, exposure_mode, resolution, orientation, processing, captured_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "AcquisitionAttestation")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        image_sha256 = try c.decode(String.self, forKey: .image_sha256)
        capture_mode = try c.decode(QCCaptureMode.self, forKey: .capture_mode)
        device_model = try c.decodeIfPresent(String.self, forKey: .device_model)
        lens_id = try c.decodeIfPresent(String.self, forKey: .lens_id)
        zoom_factor = try c.decodeIfPresent(Double.self, forKey: .zoom_factor)
        focus_mode = try c.decodeIfPresent(String.self, forKey: .focus_mode)
        exposure_mode = try c.decodeIfPresent(String.self, forKey: .exposure_mode)
        resolution = try c.decodeIfPresent([Int].self, forKey: .resolution)
        orientation = try c.decodeIfPresent(Int.self, forKey: .orientation)
        processing = try c.decodeIfPresent(String.self, forKey: .processing)
        captured_at = try c.decode(String.self, forKey: .captured_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(image_sha256, forKey: .image_sha256)
        try c.encode(capture_mode, forKey: .capture_mode)
        try c.encode(device_model, forKey: .device_model)
        try c.encode(lens_id, forKey: .lens_id)
        try c.encode(zoom_factor, forKey: .zoom_factor)
        try c.encode(focus_mode, forKey: .focus_mode)
        try c.encode(exposure_mode, forKey: .exposure_mode)
        try c.encode(resolution, forKey: .resolution)
        try c.encode(orientation, forKey: .orientation)
        try c.encode(processing, forKey: .processing)
        try c.encode(captured_at, forKey: .captured_at)
    }
}

extension QCCaptureRecord {
    enum CodingKeys: String, CodingKey { case id, sample_id, capture_set_id, original_sha256, role, taken_at, device_profile_id, calibration_id, width, height, preprocessing_version, consent_record_id, byte_size, media_type, original_state, attestation_sha256 }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Capture")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sample_id = try c.decode(String.self, forKey: .sample_id)
        capture_set_id = try c.decode(String.self, forKey: .capture_set_id)
        original_sha256 = try c.decode(String.self, forKey: .original_sha256)
        role = try c.decode(QCCaptureRole.self, forKey: .role)
        taken_at = try c.decode(String.self, forKey: .taken_at)
        device_profile_id = try c.decode(String.self, forKey: .device_profile_id)
        calibration_id = try c.decodeIfPresent(String.self, forKey: .calibration_id)
        width = try c.decode(Int.self, forKey: .width)
        height = try c.decode(Int.self, forKey: .height)
        preprocessing_version = try c.decode(String.self, forKey: .preprocessing_version)
        consent_record_id = try c.decode(String.self, forKey: .consent_record_id)
        byte_size = try c.decode(Int.self, forKey: .byte_size)
        media_type = try c.decode(QCMediaType.self, forKey: .media_type)
        original_state = try c.decode(QCOriginalState.self, forKey: .original_state)
        attestation_sha256 = try c.decode(String.self, forKey: .attestation_sha256)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(sample_id, forKey: .sample_id)
        try c.encode(capture_set_id, forKey: .capture_set_id)
        try c.encode(original_sha256, forKey: .original_sha256)
        try c.encode(role, forKey: .role)
        try c.encode(taken_at, forKey: .taken_at)
        try c.encode(device_profile_id, forKey: .device_profile_id)
        try c.encode(calibration_id, forKey: .calibration_id)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
        try c.encode(preprocessing_version, forKey: .preprocessing_version)
        try c.encode(consent_record_id, forKey: .consent_record_id)
        try c.encode(byte_size, forKey: .byte_size)
        try c.encode(media_type, forKey: .media_type)
        try c.encode(original_state, forKey: .original_state)
        try c.encode(attestation_sha256, forKey: .attestation_sha256)
    }
}

extension QCCaptureSet {
    enum CodingKeys: String, CodingKey { case id, sample_id, state, required_roles, capture_ids, revision, attempt }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "CaptureSet")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sample_id = try c.decode(String.self, forKey: .sample_id)
        state = try c.decode(QCCaptureSetState.self, forKey: .state)
        required_roles = try c.decode([QCCaptureRole].self, forKey: .required_roles)
        capture_ids = try c.decode([String].self, forKey: .capture_ids)
        revision = try c.decode(Int.self, forKey: .revision)
        attempt = try c.decodeIfPresent(Int.self, forKey: .attempt)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(sample_id, forKey: .sample_id)
        try c.encode(state, forKey: .state)
        try c.encode(required_roles, forKey: .required_roles)
        try c.encode(capture_ids, forKey: .capture_ids)
        try c.encode(revision, forKey: .revision)
        try c.encode(attempt, forKey: .attempt)
    }
}

extension QCConsentAuthority {
    enum CodingKeys: String, CodingKey { case id, version, workspace_id, authority_evidence_sha256, operational_capture, operational_retention_days, research_use, training_use, export_destinations, valid_from, expires_at, withdrawn_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "ConsentAuthority")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        version = try c.decode(Int.self, forKey: .version)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        authority_evidence_sha256 = try c.decode(String.self, forKey: .authority_evidence_sha256)
        operational_capture = try c.decode(Bool.self, forKey: .operational_capture)
        operational_retention_days = try c.decode(Int.self, forKey: .operational_retention_days)
        research_use = try c.decode(Bool.self, forKey: .research_use)
        training_use = try c.decode(Bool.self, forKey: .training_use)
        export_destinations = try c.decode([String].self, forKey: .export_destinations)
        valid_from = try c.decode(String.self, forKey: .valid_from)
        expires_at = try c.decode(String.self, forKey: .expires_at)
        withdrawn_at = try c.decodeIfPresent(String.self, forKey: .withdrawn_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(version, forKey: .version)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(authority_evidence_sha256, forKey: .authority_evidence_sha256)
        try c.encode(operational_capture, forKey: .operational_capture)
        try c.encode(operational_retention_days, forKey: .operational_retention_days)
        try c.encode(research_use, forKey: .research_use)
        try c.encode(training_use, forKey: .training_use)
        try c.encode(export_destinations, forKey: .export_destinations)
        try c.encode(valid_from, forKey: .valid_from)
        try c.encode(expires_at, forKey: .expires_at)
        try c.encode(withdrawn_at, forKey: .withdrawn_at)
    }
}

extension QCEvidence {
    enum CodingKeys: String, CodingKey { case schema_version, id, sample_id, capture_ids, spec_sha256, domain_id, domain, fabric, defects, metrology, quality, contradictions, manifest_sha256, created_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Evidence")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        id = try c.decode(String.self, forKey: .id)
        sample_id = try c.decode(String.self, forKey: .sample_id)
        capture_ids = try c.decode([String].self, forKey: .capture_ids)
        spec_sha256 = try c.decode(String.self, forKey: .spec_sha256)
        domain_id = try c.decodeIfPresent(String.self, forKey: .domain_id)
        domain = try c.decode(QCStage<QCDomainValue>.self, forKey: .domain)
        fabric = try c.decode(QCStage<QCFabricValue>.self, forKey: .fabric)
        defects = try c.decode(QCStage<QCDefectValue>.self, forKey: .defects)
        metrology = try c.decode(QCStage<[QCMeasurement]>.self, forKey: .metrology)
        quality = try c.decode(QCStage<QCQualityValue>.self, forKey: .quality)
        contradictions = try c.decode([QCReason].self, forKey: .contradictions)
        manifest_sha256 = try c.decode(String.self, forKey: .manifest_sha256)
        created_at = try c.decode(String.self, forKey: .created_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(id, forKey: .id)
        try c.encode(sample_id, forKey: .sample_id)
        try c.encode(capture_ids, forKey: .capture_ids)
        try c.encode(spec_sha256, forKey: .spec_sha256)
        try c.encode(domain_id, forKey: .domain_id)
        try c.encode(domain, forKey: .domain)
        try c.encode(fabric, forKey: .fabric)
        try c.encode(defects, forKey: .defects)
        try c.encode(metrology, forKey: .metrology)
        try c.encode(quality, forKey: .quality)
        try c.encode(contradictions, forKey: .contradictions)
        try c.encode(manifest_sha256, forKey: .manifest_sha256)
        try c.encode(created_at, forKey: .created_at)
    }
}

extension QCDecisionDraft {
    enum CodingKeys: String, CodingKey { case status, reasons, automatic, scope }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DecisionDraft")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(QCDecisionStatus.self, forKey: .status)
        reasons = try c.decode([QCReason].self, forKey: .reasons)
        automatic = try c.decode(Bool.self, forKey: .automatic)
        scope = try c.decode(String.self, forKey: .scope)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(reasons, forKey: .reasons)
        try c.encode(automatic, forKey: .automatic)
        try c.encode(scope, forKey: .scope)
    }
}

extension QCDecision {
    enum CodingKeys: String, CodingKey { case status, reasons, automatic, scope, schema_version, id, sample_id, evidence_id, spec_id, spec_version, revision, policy_version, release_id, evaluated_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Decision")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(QCDecisionStatus.self, forKey: .status)
        reasons = try c.decode([QCReason].self, forKey: .reasons)
        automatic = try c.decode(Bool.self, forKey: .automatic)
        scope = try c.decode(String.self, forKey: .scope)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        id = try c.decode(String.self, forKey: .id)
        sample_id = try c.decode(String.self, forKey: .sample_id)
        evidence_id = try c.decode(String.self, forKey: .evidence_id)
        spec_id = try c.decode(String.self, forKey: .spec_id)
        spec_version = try c.decode(Int.self, forKey: .spec_version)
        revision = try c.decode(Int.self, forKey: .revision)
        policy_version = try c.decode(String.self, forKey: .policy_version)
        release_id = try c.decodeIfPresent(String.self, forKey: .release_id)
        evaluated_at = try c.decode(String.self, forKey: .evaluated_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(reasons, forKey: .reasons)
        try c.encode(automatic, forKey: .automatic)
        try c.encode(scope, forKey: .scope)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(id, forKey: .id)
        try c.encode(sample_id, forKey: .sample_id)
        try c.encode(evidence_id, forKey: .evidence_id)
        try c.encode(spec_id, forKey: .spec_id)
        try c.encode(spec_version, forKey: .spec_version)
        try c.encode(revision, forKey: .revision)
        try c.encode(policy_version, forKey: .policy_version)
        try c.encode(release_id, forKey: .release_id)
        try c.encode(evaluated_at, forKey: .evaluated_at)
    }
}

extension QCAdjudication {
    enum CodingKeys: String, CodingKey { case id, sample_id, revision, outcome, reason, reference_ids, actor_id, created_at, supersedes_id, intervention_reason }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Adjudication")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sample_id = try c.decode(String.self, forKey: .sample_id)
        revision = try c.decode(Int.self, forKey: .revision)
        outcome = try c.decode(QCAdjudicationOutcome.self, forKey: .outcome)
        reason = try c.decode(String.self, forKey: .reason)
        reference_ids = try c.decode([String].self, forKey: .reference_ids)
        actor_id = try c.decode(String.self, forKey: .actor_id)
        created_at = try c.decode(String.self, forKey: .created_at)
        supersedes_id = try c.decodeIfPresent(String.self, forKey: .supersedes_id)
        intervention_reason = try c.decodeIfPresent(String.self, forKey: .intervention_reason)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(sample_id, forKey: .sample_id)
        try c.encode(revision, forKey: .revision)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(reason, forKey: .reason)
        try c.encode(reference_ids, forKey: .reference_ids)
        try c.encode(actor_id, forKey: .actor_id)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(supersedes_id, forKey: .supersedes_id)
        try c.encode(intervention_reason, forKey: .intervention_reason)
    }
}

extension QCResult {
    enum CodingKeys: String, CodingKey { case schema_version, mode, sample, captures, capture_sets, evidence, decision, history, adjudications, current_human_disposition, recalled_decision_ids, family, revision }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "QCResult")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        mode = try c.decode(QCMode.self, forKey: .mode)
        sample = try c.decode(QCSample.self, forKey: .sample)
        captures = try c.decode([QCCaptureRecord].self, forKey: .captures)
        capture_sets = try c.decode([QCCaptureSet].self, forKey: .capture_sets)
        evidence = try c.decodeIfPresent(QCEvidence.self, forKey: .evidence)
        decision = try c.decodeIfPresent(QCDecision.self, forKey: .decision)
        history = try c.decode([QCDecision].self, forKey: .history)
        adjudications = try c.decode([QCAdjudication].self, forKey: .adjudications)
        current_human_disposition = try c.decodeIfPresent(QCAdjudication.self, forKey: .current_human_disposition)
        recalled_decision_ids = try c.decode([String].self, forKey: .recalled_decision_ids)
        family = try c.decode(QCFamily.self, forKey: .family)
        revision = try c.decode(Int.self, forKey: .revision)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(mode, forKey: .mode)
        try c.encode(sample, forKey: .sample)
        try c.encode(captures, forKey: .captures)
        try c.encode(capture_sets, forKey: .capture_sets)
        try c.encode(evidence, forKey: .evidence)
        try c.encode(decision, forKey: .decision)
        try c.encode(history, forKey: .history)
        try c.encode(adjudications, forKey: .adjudications)
        try c.encode(current_human_disposition, forKey: .current_human_disposition)
        try c.encode(recalled_decision_ids, forKey: .recalled_decision_ids)
        try c.encode(family, forKey: .family)
        try c.encode(revision, forKey: .revision)
    }
}

extension QCPolicy {
    enum CodingKeys: String, CodingKey { case schema_version, version, sha256, mode, required_stages, max_capture_sets }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Policy")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        version = try c.decode(String.self, forKey: .version)
        sha256 = try c.decode(String.self, forKey: .sha256)
        mode = try c.decode(QCMode.self, forKey: .mode)
        required_stages = try c.decode([QCStageName].self, forKey: .required_stages)
        max_capture_sets = try c.decode(Int.self, forKey: .max_capture_sets)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(version, forKey: .version)
        try c.encode(sha256, forKey: .sha256)
        try c.encode(mode, forKey: .mode)
        try c.encode(required_stages, forKey: .required_stages)
        try c.encode(max_capture_sets, forKey: .max_capture_sets)
    }
}

extension QCDomainManifest {
    enum CodingKeys: String, CodingKey { case id, version, sha256, construction, effective_labels, taxonomy_sha256, required_roles, profile_sha256s, preprocessing_sha256, score_transform_sha256, unknown_assessment_sha256, quality_thresholds_sha256, metrology_validation_sha256, defect_accept_below, defect_hold_at_or_above }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DomainManifest")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        version = try c.decode(String.self, forKey: .version)
        sha256 = try c.decode(String.self, forKey: .sha256)
        construction = try c.decode(QCConstruction.self, forKey: .construction)
        effective_labels = try c.decode([String].self, forKey: .effective_labels)
        taxonomy_sha256 = try c.decode(String.self, forKey: .taxonomy_sha256)
        required_roles = try c.decode([QCCaptureRole].self, forKey: .required_roles)
        profile_sha256s = try c.decode([String].self, forKey: .profile_sha256s)
        preprocessing_sha256 = try c.decode(String.self, forKey: .preprocessing_sha256)
        score_transform_sha256 = try c.decode(String.self, forKey: .score_transform_sha256)
        unknown_assessment_sha256 = try c.decode(String.self, forKey: .unknown_assessment_sha256)
        quality_thresholds_sha256 = try c.decode(String.self, forKey: .quality_thresholds_sha256)
        metrology_validation_sha256 = try c.decode(String.self, forKey: .metrology_validation_sha256)
        defect_accept_below = try c.decode(Double.self, forKey: .defect_accept_below)
        defect_hold_at_or_above = try c.decode(Double.self, forKey: .defect_hold_at_or_above)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(version, forKey: .version)
        try c.encode(sha256, forKey: .sha256)
        try c.encode(construction, forKey: .construction)
        try c.encode(effective_labels, forKey: .effective_labels)
        try c.encode(taxonomy_sha256, forKey: .taxonomy_sha256)
        try c.encode(required_roles, forKey: .required_roles)
        try c.encode(profile_sha256s, forKey: .profile_sha256s)
        try c.encode(preprocessing_sha256, forKey: .preprocessing_sha256)
        try c.encode(score_transform_sha256, forKey: .score_transform_sha256)
        try c.encode(unknown_assessment_sha256, forKey: .unknown_assessment_sha256)
        try c.encode(quality_thresholds_sha256, forKey: .quality_thresholds_sha256)
        try c.encode(metrology_validation_sha256, forKey: .metrology_validation_sha256)
        try c.encode(defect_accept_below, forKey: .defect_accept_below)
        try c.encode(defect_hold_at_or_above, forKey: .defect_hold_at_or_above)
    }
}

extension QCRelease {
    enum CodingKeys: String, CodingKey { case id, version, sha256, workspace_id, state, domain_sha256, policy_sha256, bundle_sha256, calibration_sha256, statistics_report_sha256, operations_proof_sha256, monitoring_protocol_sha256, authority_record_sha256, approved_by, independent_signatory, expires_at, predecessor_release_id }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Release")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        version = try c.decode(String.self, forKey: .version)
        sha256 = try c.decode(String.self, forKey: .sha256)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        state = try c.decode(QCReleaseState.self, forKey: .state)
        domain_sha256 = try c.decode(String.self, forKey: .domain_sha256)
        policy_sha256 = try c.decode(String.self, forKey: .policy_sha256)
        bundle_sha256 = try c.decode(String.self, forKey: .bundle_sha256)
        calibration_sha256 = try c.decode(String.self, forKey: .calibration_sha256)
        statistics_report_sha256 = try c.decode(String.self, forKey: .statistics_report_sha256)
        operations_proof_sha256 = try c.decodeIfPresent(String.self, forKey: .operations_proof_sha256)
        monitoring_protocol_sha256 = try c.decodeIfPresent(String.self, forKey: .monitoring_protocol_sha256)
        authority_record_sha256 = try c.decode(String.self, forKey: .authority_record_sha256)
        approved_by = try c.decode(String.self, forKey: .approved_by)
        independent_signatory = try c.decode(String.self, forKey: .independent_signatory)
        expires_at = try c.decode(String.self, forKey: .expires_at)
        predecessor_release_id = try c.decodeIfPresent(String.self, forKey: .predecessor_release_id)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(version, forKey: .version)
        try c.encode(sha256, forKey: .sha256)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(state, forKey: .state)
        try c.encode(domain_sha256, forKey: .domain_sha256)
        try c.encode(policy_sha256, forKey: .policy_sha256)
        try c.encode(bundle_sha256, forKey: .bundle_sha256)
        try c.encode(calibration_sha256, forKey: .calibration_sha256)
        try c.encode(statistics_report_sha256, forKey: .statistics_report_sha256)
        try c.encode(operations_proof_sha256, forKey: .operations_proof_sha256)
        try c.encode(monitoring_protocol_sha256, forKey: .monitoring_protocol_sha256)
        try c.encode(authority_record_sha256, forKey: .authority_record_sha256)
        try c.encode(approved_by, forKey: .approved_by)
        try c.encode(independent_signatory, forKey: .independent_signatory)
        try c.encode(expires_at, forKey: .expires_at)
        try c.encode(predecessor_release_id, forKey: .predecessor_release_id)
    }
}

extension QCEvaluationContext {
    enum CodingKeys: String, CodingKey { case evaluated_at, clock_source, deadline_at, calibration_records_sha256, capture_binding_sha256, request_id, request_generation }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "EvaluationContext")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        evaluated_at = try c.decode(String.self, forKey: .evaluated_at)
        clock_source = try c.decode(String.self, forKey: .clock_source)
        deadline_at = try c.decode(String.self, forKey: .deadline_at)
        calibration_records_sha256 = try c.decode(String.self, forKey: .calibration_records_sha256)
        capture_binding_sha256 = try c.decode(String.self, forKey: .capture_binding_sha256)
        request_id = try c.decode(String.self, forKey: .request_id)
        request_generation = try c.decode(Int.self, forKey: .request_generation)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(evaluated_at, forKey: .evaluated_at)
        try c.encode(clock_source, forKey: .clock_source)
        try c.encode(deadline_at, forKey: .deadline_at)
        try c.encode(calibration_records_sha256, forKey: .calibration_records_sha256)
        try c.encode(capture_binding_sha256, forKey: .capture_binding_sha256)
        try c.encode(request_id, forKey: .request_id)
        try c.encode(request_generation, forKey: .request_generation)
    }
}

extension QCCalibrationProfile {
    enum CodingKeys: String, CodingKey { case id, version, sha256, device_profile_id, lens_id, resolution, focus_mode, distance_mm, lighting_protocol_sha256, processing_sha256, distortion_model_sha256, source_resolution_limits_sha256, uncertainty_model_sha256, reference_ids, valid_from, expires_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "CalibrationProfile")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        version = try c.decode(String.self, forKey: .version)
        sha256 = try c.decode(String.self, forKey: .sha256)
        device_profile_id = try c.decode(String.self, forKey: .device_profile_id)
        lens_id = try c.decode(String.self, forKey: .lens_id)
        resolution = try c.decode([Int].self, forKey: .resolution)
        focus_mode = try c.decode(String.self, forKey: .focus_mode)
        distance_mm = try c.decode([Double].self, forKey: .distance_mm)
        lighting_protocol_sha256 = try c.decode(String.self, forKey: .lighting_protocol_sha256)
        processing_sha256 = try c.decode(String.self, forKey: .processing_sha256)
        distortion_model_sha256 = try c.decode(String.self, forKey: .distortion_model_sha256)
        source_resolution_limits_sha256 = try c.decode(String.self, forKey: .source_resolution_limits_sha256)
        uncertainty_model_sha256 = try c.decode(String.self, forKey: .uncertainty_model_sha256)
        reference_ids = try c.decode([String].self, forKey: .reference_ids)
        valid_from = try c.decode(String.self, forKey: .valid_from)
        expires_at = try c.decode(String.self, forKey: .expires_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(version, forKey: .version)
        try c.encode(sha256, forKey: .sha256)
        try c.encode(device_profile_id, forKey: .device_profile_id)
        try c.encode(lens_id, forKey: .lens_id)
        try c.encode(resolution, forKey: .resolution)
        try c.encode(focus_mode, forKey: .focus_mode)
        try c.encode(distance_mm, forKey: .distance_mm)
        try c.encode(lighting_protocol_sha256, forKey: .lighting_protocol_sha256)
        try c.encode(processing_sha256, forKey: .processing_sha256)
        try c.encode(distortion_model_sha256, forKey: .distortion_model_sha256)
        try c.encode(source_resolution_limits_sha256, forKey: .source_resolution_limits_sha256)
        try c.encode(uncertainty_model_sha256, forKey: .uncertainty_model_sha256)
        try c.encode(reference_ids, forKey: .reference_ids)
        try c.encode(valid_from, forKey: .valid_from)
        try c.encode(expires_at, forKey: .expires_at)
    }
}

extension QCScaleReference {
    enum CodingKeys: String, CodingKey { case id, sha256, dimensions_mm, uncertainty_mm, traceability_report_sha256, print_verification_sha256 }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "ScaleReference")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sha256 = try c.decode(String.self, forKey: .sha256)
        dimensions_mm = try c.decode([Double].self, forKey: .dimensions_mm)
        uncertainty_mm = try c.decode([Double].self, forKey: .uncertainty_mm)
        traceability_report_sha256 = try c.decode(String.self, forKey: .traceability_report_sha256)
        print_verification_sha256 = try c.decode(String.self, forKey: .print_verification_sha256)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(sha256, forKey: .sha256)
        try c.encode(dimensions_mm, forKey: .dimensions_mm)
        try c.encode(uncertainty_mm, forKey: .uncertainty_mm)
        try c.encode(traceability_report_sha256, forKey: .traceability_report_sha256)
        try c.encode(print_verification_sha256, forKey: .print_verification_sha256)
    }
}

extension QCAxisRegistration {
    enum CodingKeys: String, CodingKey { case id, capture_id, capture_sha256, physical_indicator, provenance, origin_xy, direction_xy, transform_sha256 }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "AxisRegistration")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        capture_id = try c.decode(String.self, forKey: .capture_id)
        capture_sha256 = try c.decode(String.self, forKey: .capture_sha256)
        physical_indicator = try c.decode(QCPhysicalIndicator.self, forKey: .physical_indicator)
        provenance = try c.decode(QCProvenance.self, forKey: .provenance)
        origin_xy = try c.decode([Double].self, forKey: .origin_xy)
        direction_xy = try c.decode([Double].self, forKey: .direction_xy)
        transform_sha256 = try c.decode(String.self, forKey: .transform_sha256)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(capture_id, forKey: .capture_id)
        try c.encode(capture_sha256, forKey: .capture_sha256)
        try c.encode(physical_indicator, forKey: .physical_indicator)
        try c.encode(provenance, forKey: .provenance)
        try c.encode(origin_xy, forKey: .origin_xy)
        try c.encode(direction_xy, forKey: .direction_xy)
        try c.encode(transform_sha256, forKey: .transform_sha256)
    }
}

extension QCValidatedCapture {
    enum CodingKeys: String, CodingKey { case capture, original_storage_reference, verified_sha256, acquisition_attestation_sha256, attestation, geometry_artifact_sha256, calibration, reference, axis_registration }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "ValidatedCapture")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        capture = try c.decode(QCCaptureRecord.self, forKey: .capture)
        original_storage_reference = try c.decode(String.self, forKey: .original_storage_reference)
        verified_sha256 = try c.decode(String.self, forKey: .verified_sha256)
        acquisition_attestation_sha256 = try c.decode(String.self, forKey: .acquisition_attestation_sha256)
        attestation = try c.decode(QCAcquisitionAttestation.self, forKey: .attestation)
        geometry_artifact_sha256 = try c.decodeIfPresent(String.self, forKey: .geometry_artifact_sha256)
        calibration = try c.decodeIfPresent(QCCalibrationProfile.self, forKey: .calibration)
        reference = try c.decodeIfPresent(QCScaleReference.self, forKey: .reference)
        axis_registration = try c.decodeIfPresent(QCAxisRegistration.self, forKey: .axis_registration)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(capture, forKey: .capture)
        try c.encode(original_storage_reference, forKey: .original_storage_reference)
        try c.encode(verified_sha256, forKey: .verified_sha256)
        try c.encode(acquisition_attestation_sha256, forKey: .acquisition_attestation_sha256)
        try c.encode(attestation, forKey: .attestation)
        try c.encode(geometry_artifact_sha256, forKey: .geometry_artifact_sha256)
        try c.encode(calibration, forKey: .calibration)
        try c.encode(reference, forKey: .reference)
        try c.encode(axis_registration, forKey: .axis_registration)
    }
}

extension QCReadiness {
    enum CodingKeys: String, CodingKey { case schema_version, ready, bundle_sha256, stages }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Readiness")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        ready = try c.decode(Bool.self, forKey: .ready)
        bundle_sha256 = try c.decodeIfPresent(String.self, forKey: .bundle_sha256)
        stages = try c.decode([QCReadinessStage].self, forKey: .stages)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(ready, forKey: .ready)
        try c.encode(bundle_sha256, forKey: .bundle_sha256)
        try c.encode(stages, forKey: .stages)
    }
}

extension QCAnalysisCandidate {
    enum CodingKeys: String, CodingKey { case evidence, draft, binding }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "AnalysisCandidate")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        evidence = try c.decode(QCEvidence.self, forKey: .evidence)
        draft = try c.decode(QCDecisionDraft.self, forKey: .draft)
        binding = try c.decode(QCAnalysisBinding.self, forKey: .binding)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(evidence, forKey: .evidence)
        try c.encode(draft, forKey: .draft)
        try c.encode(binding, forKey: .binding)
    }
}

extension QCAnalyzeRequest {
    enum CodingKeys: String, CodingKey { case schema_version, sample_id, workspace_id, spec, policy, release, domain, attempt, expected_revision, context, captures }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "AnalyzeRequest")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        sample_id = try c.decode(String.self, forKey: .sample_id)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        spec = try c.decode(QCPurchaseSpec.self, forKey: .spec)
        policy = try c.decode(QCPolicy.self, forKey: .policy)
        release = try c.decodeIfPresent(QCRelease.self, forKey: .release)
        domain = try c.decodeIfPresent(QCDomainManifest.self, forKey: .domain)
        attempt = try c.decode(Int.self, forKey: .attempt)
        expected_revision = try c.decode(Int.self, forKey: .expected_revision)
        context = try c.decode(QCEvaluationContext.self, forKey: .context)
        captures = try c.decode([QCValidatedCapture].self, forKey: .captures)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(sample_id, forKey: .sample_id)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(spec, forKey: .spec)
        try c.encode(policy, forKey: .policy)
        try c.encode(release, forKey: .release)
        try c.encode(domain, forKey: .domain)
        try c.encode(attempt, forKey: .attempt)
        try c.encode(expected_revision, forKey: .expected_revision)
        try c.encode(context, forKey: .context)
        try c.encode(captures, forKey: .captures)
    }
}

extension QCAssertionClaims {
    enum CodingKeys: String, CodingKey { case kid, aud, iat, exp, nonce, request_id, request_generation, workspace_id, actor_id, payload_sha256, deadline_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "AssertionClaims")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kid = try c.decode(String.self, forKey: .kid)
        aud = try c.decode(String.self, forKey: .aud)
        iat = try c.decode(Int.self, forKey: .iat)
        exp = try c.decode(Int.self, forKey: .exp)
        nonce = try c.decode(String.self, forKey: .nonce)
        request_id = try c.decode(String.self, forKey: .request_id)
        request_generation = try c.decode(Int.self, forKey: .request_generation)
        workspace_id = try c.decode(String.self, forKey: .workspace_id)
        actor_id = try c.decode(String.self, forKey: .actor_id)
        payload_sha256 = try c.decode(String.self, forKey: .payload_sha256)
        deadline_at = try c.decode(String.self, forKey: .deadline_at)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kid, forKey: .kid)
        try c.encode(aud, forKey: .aud)
        try c.encode(iat, forKey: .iat)
        try c.encode(exp, forKey: .exp)
        try c.encode(nonce, forKey: .nonce)
        try c.encode(request_id, forKey: .request_id)
        try c.encode(request_generation, forKey: .request_generation)
        try c.encode(workspace_id, forKey: .workspace_id)
        try c.encode(actor_id, forKey: .actor_id)
        try c.encode(payload_sha256, forKey: .payload_sha256)
        try c.encode(deadline_at, forKey: .deadline_at)
    }
}

extension QCErrorEnvelope {
    enum CodingKeys: String, CodingKey { case schema_version, error }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "ErrorEnvelope")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema_version = try c.decode(String.self, forKey: .schema_version)
        error = try c.decode(QCErrorBody.self, forKey: .error)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema_version, forKey: .schema_version)
        try c.encode(error, forKey: .error)
    }
}

extension QCDomainValue {
    enum CodingKeys: String, CodingKey { case in_domain, assessment_version, profile_sha256 }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DomainValue")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        in_domain = try c.decode(Bool.self, forKey: .in_domain)
        assessment_version = try c.decode(String.self, forKey: .assessment_version)
        profile_sha256 = try c.decode(String.self, forKey: .profile_sha256)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(in_domain, forKey: .in_domain)
        try c.encode(assessment_version, forKey: .assessment_version)
        try c.encode(profile_sha256, forKey: .profile_sha256)
    }
}

extension QCFabricCandidate {
    enum CodingKeys: String, CodingKey { case label, raw_score }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "FabricCandidate")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decode(String.self, forKey: .label)
        raw_score = try c.decode(Double.self, forKey: .raw_score)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(label, forKey: .label)
        try c.encode(raw_score, forKey: .raw_score)
    }
}

extension QCFabricValue {
    enum CodingKeys: String, CodingKey { case label, taxonomy_version, calibrated_probability, unknown, candidates }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "FabricValue")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decodeIfPresent(String.self, forKey: .label)
        taxonomy_version = try c.decode(String.self, forKey: .taxonomy_version)
        calibrated_probability = try c.decodeIfPresent(Double.self, forKey: .calibrated_probability)
        unknown = try c.decode(Bool.self, forKey: .unknown)
        candidates = try c.decode([QCFabricCandidate].self, forKey: .candidates)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(label, forKey: .label)
        try c.encode(taxonomy_version, forKey: .taxonomy_version)
        try c.encode(calibrated_probability, forKey: .calibrated_probability)
        try c.encode(unknown, forKey: .unknown)
        try c.encode(candidates, forKey: .candidates)
    }
}

extension QCDefectRegion {
    enum CodingKeys: String, CodingKey { case capture_id, transform_id, box, score, label }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DefectRegion")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        capture_id = try c.decode(String.self, forKey: .capture_id)
        transform_id = try c.decode(String.self, forKey: .transform_id)
        box = try c.decode([Double].self, forKey: .box)
        score = try c.decode(Double.self, forKey: .score)
        label = try c.decodeIfPresent(String.self, forKey: .label)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(capture_id, forKey: .capture_id)
        try c.encode(transform_id, forKey: .transform_id)
        try c.encode(box, forKey: .box)
        try c.encode(score, forKey: .score)
        try c.encode(label, forKey: .label)
    }
}

extension QCDefectView {
    enum CodingKeys: String, CodingKey { case capture_id, capture_sha256, transform_id, score, observed_area_cm2 }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DefectView")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        capture_id = try c.decode(String.self, forKey: .capture_id)
        capture_sha256 = try c.decode(String.self, forKey: .capture_sha256)
        transform_id = try c.decode(String.self, forKey: .transform_id)
        score = try c.decode(Double.self, forKey: .score)
        observed_area_cm2 = try c.decodeIfPresent(Double.self, forKey: .observed_area_cm2)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(capture_id, forKey: .capture_id)
        try c.encode(capture_sha256, forKey: .capture_sha256)
        try c.encode(transform_id, forKey: .transform_id)
        try c.encode(score, forKey: .score)
        try c.encode(observed_area_cm2, forKey: .observed_area_cm2)
    }
}

extension QCDefectValue {
    enum CodingKeys: String, CodingKey { case score, regions, observed_area_cm2, views }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "DefectValue")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        score = try c.decode(Double.self, forKey: .score)
        regions = try c.decode([QCDefectRegion].self, forKey: .regions)
        observed_area_cm2 = try c.decode(Double.self, forKey: .observed_area_cm2)
        views = try c.decode([QCDefectView].self, forKey: .views)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(score, forKey: .score)
        try c.encode(regions, forKey: .regions)
        try c.encode(observed_area_cm2, forKey: .observed_area_cm2)
        try c.encode(views, forKey: .views)
    }
}

extension QCMeasurement {
    enum CodingKeys: String, CodingKey { case capture_id, capture_sha256, source_roi, calibration_sha256, geometry_artifact_sha256, uncertainty_report_sha256, axis_registration_id, axis, unit, value, interval95, reference_id, method_version }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Measurement")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        capture_id = try c.decode(String.self, forKey: .capture_id)
        capture_sha256 = try c.decode(String.self, forKey: .capture_sha256)
        source_roi = try c.decode([Double].self, forKey: .source_roi)
        calibration_sha256 = try c.decode(String.self, forKey: .calibration_sha256)
        geometry_artifact_sha256 = try c.decode(String.self, forKey: .geometry_artifact_sha256)
        uncertainty_report_sha256 = try c.decode(String.self, forKey: .uncertainty_report_sha256)
        axis_registration_id = try c.decode(String.self, forKey: .axis_registration_id)
        axis = try c.decode(QCAxis.self, forKey: .axis)
        unit = try c.decode(String.self, forKey: .unit)
        value = try c.decode(Double.self, forKey: .value)
        interval95 = try c.decode([Double].self, forKey: .interval95)
        reference_id = try c.decode(String.self, forKey: .reference_id)
        method_version = try c.decode(String.self, forKey: .method_version)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(capture_id, forKey: .capture_id)
        try c.encode(capture_sha256, forKey: .capture_sha256)
        try c.encode(source_roi, forKey: .source_roi)
        try c.encode(calibration_sha256, forKey: .calibration_sha256)
        try c.encode(geometry_artifact_sha256, forKey: .geometry_artifact_sha256)
        try c.encode(uncertainty_report_sha256, forKey: .uncertainty_report_sha256)
        try c.encode(axis_registration_id, forKey: .axis_registration_id)
        try c.encode(axis, forKey: .axis)
        try c.encode(unit, forKey: .unit)
        try c.encode(value, forKey: .value)
        try c.encode(interval95, forKey: .interval95)
        try c.encode(reference_id, forKey: .reference_id)
        try c.encode(method_version, forKey: .method_version)
    }
}

extension QCQualityChecks {
    enum CodingKeys: String, CodingKey { case blur, glare, moire, fold, framing, resolution, marker_geometry }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "QualityChecks")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        blur = try c.decode(Bool.self, forKey: .blur)
        glare = try c.decode(Bool.self, forKey: .glare)
        moire = try c.decode(Bool.self, forKey: .moire)
        fold = try c.decode(Bool.self, forKey: .fold)
        framing = try c.decode(Bool.self, forKey: .framing)
        resolution = try c.decode(Bool.self, forKey: .resolution)
        marker_geometry = try c.decode(Bool.self, forKey: .marker_geometry)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(blur, forKey: .blur)
        try c.encode(glare, forKey: .glare)
        try c.encode(moire, forKey: .moire)
        try c.encode(fold, forKey: .fold)
        try c.encode(framing, forKey: .framing)
        try c.encode(resolution, forKey: .resolution)
        try c.encode(marker_geometry, forKey: .marker_geometry)
    }
}

extension QCQualityValue {
    enum CodingKeys: String, CodingKey { case checks }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "QualityValue")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        checks = try c.decode(QCQualityChecks.self, forKey: .checks)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(checks, forKey: .checks)
    }
}

extension QCFamily {
    enum CodingKeys: String, CodingKey { case selection_id, predecessor_sample_id, successor_sample_ids, attempts_used, attempts_max, spec_is_current, current_spec_version }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "Family")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        selection_id = try c.decode(String.self, forKey: .selection_id)
        predecessor_sample_id = try c.decodeIfPresent(String.self, forKey: .predecessor_sample_id)
        successor_sample_ids = try c.decode([String].self, forKey: .successor_sample_ids)
        attempts_used = try c.decode(Int.self, forKey: .attempts_used)
        attempts_max = try c.decode(Int.self, forKey: .attempts_max)
        spec_is_current = try c.decode(Bool.self, forKey: .spec_is_current)
        current_spec_version = try c.decode(Int.self, forKey: .current_spec_version)
        try check()
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(selection_id, forKey: .selection_id)
        try c.encode(predecessor_sample_id, forKey: .predecessor_sample_id)
        try c.encode(successor_sample_ids, forKey: .successor_sample_ids)
        try c.encode(attempts_used, forKey: .attempts_used)
        try c.encode(attempts_max, forKey: .attempts_max)
        try c.encode(spec_is_current, forKey: .spec_is_current)
        try c.encode(current_spec_version, forKey: .current_spec_version)
    }
}

extension QCReadinessStage {
    enum CodingKeys: String, CodingKey { case name, state, artifact_sha256, reasons }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "ReadinessStage")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(QCStageName.self, forKey: .name)
        state = try c.decode(QCStageState.self, forKey: .state)
        artifact_sha256 = try c.decodeIfPresent(String.self, forKey: .artifact_sha256)
        reasons = try c.decode([QCReason].self, forKey: .reasons)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(state, forKey: .state)
        try c.encode(artifact_sha256, forKey: .artifact_sha256)
        try c.encode(reasons, forKey: .reasons)
    }
}

extension QCAnalysisBinding {
    enum CodingKeys: String, CodingKey { case spec_sha256, policy_sha256, release_sha256, capture_sha256s, attempt, expected_revision, request_id, request_generation, deadline_at }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "AnalysisBinding")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        spec_sha256 = try c.decode(String.self, forKey: .spec_sha256)
        policy_sha256 = try c.decode(String.self, forKey: .policy_sha256)
        release_sha256 = try c.decodeIfPresent(String.self, forKey: .release_sha256)
        capture_sha256s = try c.decode([String].self, forKey: .capture_sha256s)
        attempt = try c.decode(Int.self, forKey: .attempt)
        expected_revision = try c.decode(Int.self, forKey: .expected_revision)
        request_id = try c.decode(String.self, forKey: .request_id)
        request_generation = try c.decode(Int.self, forKey: .request_generation)
        deadline_at = try c.decode(String.self, forKey: .deadline_at)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(spec_sha256, forKey: .spec_sha256)
        try c.encode(policy_sha256, forKey: .policy_sha256)
        try c.encode(release_sha256, forKey: .release_sha256)
        try c.encode(capture_sha256s, forKey: .capture_sha256s)
        try c.encode(attempt, forKey: .attempt)
        try c.encode(expected_revision, forKey: .expected_revision)
        try c.encode(request_id, forKey: .request_id)
        try c.encode(request_generation, forKey: .request_generation)
        try c.encode(deadline_at, forKey: .deadline_at)
    }
}

extension QCErrorBody {
    enum CodingKeys: String, CodingKey { case code, reasons, retryable, request_id }
    init(from decoder: Decoder) throws {
        try validateDecoder(decoder, type: "ErrorBody")
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(QCErrorCode.self, forKey: .code)
        reasons = try c.decode([QCReason].self, forKey: .reasons)
        retryable = try c.decode(Bool.self, forKey: .retryable)
        request_id = try c.decode(String.self, forKey: .request_id)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(code, forKey: .code)
        try c.encode(reasons, forKey: .reasons)
        try c.encode(retryable, forKey: .retryable)
        try c.encode(request_id, forKey: .request_id)
    }
}

extension QCStage {
    enum CodingKeys: String, CodingKey { case state, value, reasons, artifact_sha256, duration_ms }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(state, forKey: .state); try c.encode(value, forKey: .value)
        try c.encode(reasons, forKey: .reasons); try c.encode(artifact_sha256, forKey: .artifact_sha256)
        try c.encode(duration_ms, forKey: .duration_ms)
    }
}
