import Foundation
import Security

// Incoming-fabric QC v2 client. The Yarnflow Worker is the only authority: this client signs in with the
// real PIN session (cookie), talks only to the fixed configured app origin, and never produces a decision
// of its own. There is no bearer token, no configurable upstream and no cached success.

// MARK: - Configuration

struct QCConfig: Equatable {
    /// What the build is allowed to reach. Release builds compile the cleartext loopback path out entirely;
    /// the development case exists only so the simulator can talk to the local Worker over `#if DEBUG`.
    enum Policy: Equatable {
        case release, development
        static var current: Policy {
            #if DEBUG
            .development
            #else
            .release
            #endif
        }
        var infoPlistKey: String { self == .development ? "YFQCAppOriginDebug" : "YFQCAppOrigin" }
    }
    /// Scheme + host (+ port) of the Yarnflow web app. Sent as `Origin` on every mutation.
    let origin: URL
    var originHeader: String { "\(origin.scheme ?? "https")://\(origin.host ?? "")\(origin.port.map { ":\($0)" } ?? "")" }

    init(origin text: String, policy: Policy = .current) throws {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespaces)), let scheme = url.scheme, let host = url.host, url.path.isEmpty || url.path == "/",
              url.query == nil, url.fragment == nil, url.user == nil, url.password == nil, Self.permits(scheme: scheme, host: host, policy: policy) else { throw QCError.notConfigured }
        origin = url
    }
    /// HTTPS everywhere. Cleartext HTTP is allowed only for a loopback host in a development build;
    /// the release branch has no code path that returns true for HTTP.
    static func permits(scheme: String, host: String, policy: Policy) -> Bool {
        if scheme == "https" { return true }
        #if DEBUG
        return policy == .development && scheme == "http" && ["127.0.0.1", "localhost"].contains(host)
        #else
        return false
        #endif
    }
    /// The origin is fixed at build time. Release reads `YFQCAppOrigin` (HTTPS Worker only);
    /// development reads `YFQCAppOriginDebug` (the local loopback Worker). Operators cannot point the app elsewhere.
    static func bundled(_ bundle: Bundle = .main, policy: Policy = .current) throws -> QCConfig {
        guard let text = bundle.object(forInfoDictionaryKey: policy.infoPlistKey) as? String else { throw QCError.notConfigured }
        return try QCConfig(origin: text, policy: policy)
    }
    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(); parts.scheme = origin.scheme; parts.host = origin.host; parts.port = origin.port; parts.path = path
        if !query.isEmpty { parts.queryItems = query }
        return parts.url!
    }
}

enum QCError: Error, Equatable, LocalizedError {
    case notConfigured
    case unauthenticated
    case server(status: Int, body: QCErrorBody)
    case unexpected(status: Int)
    case transport
    /// The answer belongs to an earlier sign-in, sample, specification, capture set or revision. It is dropped.
    case stale
    /// The request may or may not have been committed. Only a reload (or the same key again) can tell.
    case unknownOutcome
    case deadline
    case contract(QCContractError)
    var errorDescription: String? {
        switch self {
        case .notConfigured: return QCText.t("qc.error.not_configured")
        case .unauthenticated: return QCText.t("qc.error.unauthenticated")
        case .server(_, let body): return QCText.errorCode(body.code)
        case .unexpected: return QCText.t("qc.error.unexpected")
        case .transport: return QCText.t("qc.error.transport")
        case .stale: return QCText.t("qc.error.stale")
        case .unknownOutcome: return QCText.t("qc.error.unknown_outcome")
        case .deadline: return QCText.errorCode(.DEADLINE_EXCEEDED)
        case .contract(let error): return error.errorDescription
        }
    }
    var reasons: [QCReason] { if case .server(_, let body) = self { return body.reasons }; return [] }
}

// MARK: - Session credential (Keychain only; the PIN is never stored anywhere)

protocol QCCredentialStore: Sendable {
    func load(_ account: String) -> String?
    func save(_ value: String, for account: String)
    func delete(_ account: String)
}
struct QCKeychain: QCCredentialStore {
    let service = "com.texpilot.yarnflow.qc-session"
    private func query(_ account: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    func load(_ account: String) -> String? {
        var q = query(account); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    func save(_ value: String, for account: String) {
        SecItemDelete(query(account) as CFDictionary)
        var q = query(account); q[kSecValueData as String] = Data(value.utf8); q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
    func delete(_ account: String) { SecItemDelete(query(account) as CFDictionary) }
}
/// Redirects are refused: a photo or a session never follows the server to another address.
final class QCNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// MARK: - Stale-result guard

struct QCExpectation: Equatable {
    var sampleID: String
    var specID: String? = nil
    var specVersion: Int? = nil
    var captureSetID: String? = nil
    /// The revision the request was built against. A result below it is older than what is on screen.
    var minimumRevision: Int = 0
    /// Set for analyse: the capture set must be closed and any decision must rest on exactly its captures.
    var analysed = false
    var maximumRevision: Int? = nil
}
enum QCResultGuard {
    static func accept(_ result: QCResult, _ expected: QCExpectation) throws {
        guard result.sample.id == expected.sampleID, result.revision >= expected.minimumRevision else { throw QCError.stale }
        if let maximum = expected.maximumRevision, result.revision > maximum { throw QCError.stale }
        if let id = expected.specID, id != result.sample.spec_id { throw QCError.stale }
        if let version = expected.specVersion, version != result.sample.spec_version { throw QCError.stale }
        if let setID = expected.captureSetID {
            guard let set = result.capture_sets.first(where: { $0.id == setID }) else { throw QCError.stale }
            if expected.analysed {
                guard set.state == .CLOSED else { throw QCError.stale }
                if let evidence = result.evidence, Set(evidence.capture_ids) != Set(set.capture_ids) { throw QCError.stale }
            }
        }
    }
}

// MARK: - Request inputs

struct QCSelectionInput: Encodable {
    var purchase_order_id: String; var plan_version: String; var plan_sha256: String?; var randomization_seed: String?; var draw_index: Int?; var selection_probability: Double?
    var cohort: QCCohort; var independent_group_id: String; var lot_ref: String; var roll_ref: String; var location_ref: String; var face: QCFace; var planned_area_cm2: Double; var method: String
    func encode(to encoder: Encoder) throws {   // explicit nulls
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(purchase_order_id, forKey: .purchase_order_id); try c.encode(plan_version, forKey: .plan_version); try c.encode(plan_sha256, forKey: .plan_sha256)
        try c.encode(randomization_seed, forKey: .randomization_seed); try c.encode(draw_index, forKey: .draw_index); try c.encode(selection_probability, forKey: .selection_probability)
        try c.encode(cohort, forKey: .cohort); try c.encode(independent_group_id, forKey: .independent_group_id); try c.encode(lot_ref, forKey: .lot_ref); try c.encode(roll_ref, forKey: .roll_ref)
        try c.encode(location_ref, forKey: .location_ref); try c.encode(face, forKey: .face); try c.encode(planned_area_cm2, forKey: .planned_area_cm2); try c.encode(method, forKey: .method)
    }
    enum CodingKeys: String, CodingKey { case purchase_order_id, plan_version, plan_sha256, randomization_seed, draw_index, selection_probability, cohort, independent_group_id, lot_ref, roll_ref, location_ref, face, planned_area_cm2, method }
}
struct QCSampleInput {
    var selectionID: String; var specID: String; var specVersion: Int
    /// Linked evaluation under the current confirmed specification (design §20); nil for a first evaluation.
    var predecessorSampleID: String? = nil; var expectedPredecessorRevision: Int? = nil; var reason: String? = nil
    var interventionReason: String? = nil
}
struct QCCaptureUpload {
    var captureID: String; var role: QCCaptureRole; var data: Data; var mediaType: QCMediaType; var sha256: String; var takenAt: String
    var deviceProfileID: String; var calibrationID: String? = nil; var consentRecordID: String; var attestation: QCAcquisitionAttestation
}
struct QCAdjudicationInput {
    var outcome: QCAdjudicationOutcome; var reason: String; var referenceIDs: [String] = []; var supersedesID: String? = nil; var interventionReason: String? = nil
}

// MARK: - Client

actor QCClient {
    typealias Sleeper = @Sendable (TimeInterval) async throws -> Void
    static let backoff: [TimeInterval] = [1, 2, 4]
    static let retryStatuses: Set<Int> = [429, 503, 504]

    let config: QCConfig
    private var session: URLSession
    private let configuration: URLSessionConfiguration
    private let credentials: QCCredentialStore
    private let sleeper: Sleeper
    private let now: @Sendable () -> Date
    private var onInvalidate: (@Sendable () -> Void)?
    private var cookie: String?
    private var screen: QCExpectation?
    func bindScreen(_ expectation: QCExpectation?) { screen = expectation }
    private(set) var account: String?
    /// Bumped on sign-in, sign-out, 401 and account change. An answer from an older generation is dropped.
    private(set) var generation = 0

    init(config: QCConfig, credentials: QCCredentialStore = QCKeychain(), protocolClasses: [AnyClass]? = nil,
         sleeper: @escaping Sleeper = { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }, now: @escaping @Sendable () -> Date = { Date() }) {
        self.config = config; self.credentials = credentials; self.sleeper = sleeper; self.now = now
        // Isolated from the rest of the app and from other accounts: no shared cookie jar, no URL cache, no stored credentials.
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil; c.httpShouldSetCookies = false; c.httpCookieAcceptPolicy = .never; c.urlCache = nil; c.urlCredentialStorage = nil
        c.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData; c.timeoutIntervalForRequest = QCLimits.requestDeadline; c.waitsForConnectivity = false
        if let protocolClasses { c.protocolClasses = protocolClasses }
        configuration = c
        session = URLSession(configuration: c, delegate: QCNoRedirect(), delegateQueue: nil)
        if let saved = credentials.load(Self.sessionKey(config)), let split = saved.firstIndex(of: "\n") {
            account = String(saved[..<split]); cookie = String(saved[saved.index(after: split)...])
        }
    }
    func setInvalidationHandler(_ handler: @escaping @Sendable () -> Void) { onInvalidate = handler }
    var isSignedIn: Bool { cookie != nil }
    private static func sessionKey(_ config: QCConfig) -> String { "session|\(config.originHeader)" }
    static func accountKey(_ name: String) -> String { name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ") }

    // MARK: sign-in lifecycle

    /// Signs in through the Worker's real `/api/auth/login`. The PIN is used once and never kept.
    func signIn(name: String, pin: String) async throws {
        let key = Self.accountKey(name)
        if cookie != nil || (account != nil && account != key) { invalidate() }   // account switch: purge before the new actor exists
        let started = generation
        var request = URLRequest(url: config.url("/api/auth/login")); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue(config.originHeader, forHTTPHeaderField: "Origin")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "pin": pin])
        let (_, response): (Data, HTTPURLResponse)
        do { (_, response) = try await raw(request) } catch { throw QCError.transport }
        guard started == generation else { throw QCError.stale }
        guard response.statusCode == 200 else {
            if response.statusCode == 401 || response.statusCode == 403 || response.statusCode == 429 { throw QCError.unauthenticated }
            throw QCError.unexpected(status: response.statusCode)
        }
        let headers = (response.allHeaderFields as? [String: String]) ?? [:]
        guard let token = HTTPCookie.cookies(withResponseHeaderFields: headers, for: config.origin).first(where: { $0.name == "yf_session" })?.value,
              token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw QCError.unexpected(status: response.statusCode) }
        cookie = token; account = key; generation += 1
        credentials.save("\(key)\n\(token)", for: Self.sessionKey(config))
    }

    /// Local state is invalidated first, so drafts are gone even when the network call never completes.
    func signOut() async {
        let old = cookie
        invalidate()
        guard let old else { return }
        var request = URLRequest(url: config.url("/api/auth/logout")); request.httpMethod = "POST"
        request.setValue(config.originHeader, forHTTPHeaderField: "Origin"); request.setValue("yf_session=\(old)", forHTTPHeaderField: "Cookie")
        _ = try? await raw(request)
    }

    /// Sign-out, 401, revocation and account switch all land here: session gone, drafts purged, late answers ignored.
    func invalidate() {
        generation += 1; cookie = nil; account = nil; screen = nil
        session.invalidateAndCancel()
        session = URLSession(configuration: configuration, delegate: QCNoRedirect(), delegateQueue: nil)
        credentials.delete(Self.sessionKey(config))
        onInvalidate?()
    }

    // MARK: transport

    private func raw(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    private func retryDelay(_ response: HTTPURLResponse, attempt: Int) -> TimeInterval {
        if let text = response.value(forHTTPHeaderField: "Retry-After"), let seconds = TimeInterval(text), seconds >= 0 { return min(seconds, 60) }
        return Self.backoff[attempt]
    }

    /// One logical request. Retries reuse the same idempotency key and happen only for transport failure, 429, 503 and 504.
    private func send(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String = "application/json", idempotencyKey: UUID? = nil) async throws -> (Data, HTTPURLResponse) {
        guard let cookie else { throw QCError.unauthenticated }
        let started = generation
        var request = URLRequest(url: config.url("/api/qc/v2" + path, query: query)); request.httpMethod = method
        request.setValue("yf_session=\(cookie)", forHTTPHeaderField: "Cookie"); request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != "GET" {
            request.setValue(config.originHeader, forHTTPHeaderField: "Origin"); request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            request.setValue((idempotencyKey ?? UUID()).uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
            request.httpBody = body ?? Data("{}".utf8)
        }
        var attempt = 0
        while true {
            try Task.checkCancellation()
            let outcome: Result<(Data, HTTPURLResponse), Error>
            do { outcome = .success(try await raw(request)) } catch { outcome = .failure(error) }
            guard started == generation else { throw QCError.stale }
            switch outcome {
            case .failure(let error):
                if error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
                guard attempt < Self.backoff.count else { throw method == "GET" ? QCError.transport : QCError.unknownOutcome }
                try await sleeper(Self.backoff[attempt])
            case .success(let (data, response)):
                if (200..<300).contains(response.statusCode) { return (data, response) }
                if response.statusCode == 401 { invalidate(); throw QCError.unauthenticated }
                if Self.retryStatuses.contains(response.statusCode), attempt < Self.backoff.count { try await sleeper(retryDelay(response, attempt: attempt)) }
                else { throw Self.failure(data, response.statusCode) }
            }
            attempt += 1
            guard started == generation else { throw QCError.stale }
        }
    }

    static func failure(_ data: Data, _ status: Int) -> QCError {
        if let envelope = try? QCContract.decode(QCErrorEnvelope.self, type: "ErrorEnvelope", from: data) { return .server(status: status, body: envelope.error) }
        return .unexpected(status: status)   // never show a server's raw text
    }
    private func result(_ data: Data, _ expected: QCExpectation) throws -> QCResult {
        let value: QCResult
        do { value = try QCResult.decode(data) } catch let error as QCContractError { throw QCError.contract(error) }
        try QCResultGuard.accept(value, expected)
        return value
    }
    private func plain<T: Decodable>(_ kind: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(kind, from: data) } catch { throw QCError.contract(.malformed("unexpected response shape")) }
    }
    private func json(_ object: [String: Any?]) throws -> Data { try JSONSerialization.data(withJSONObject: object.mapValues { $0 ?? NSNull() }) }
    private static func lower(_ id: UUID) -> String { id.uuidString.lowercased() }

    // MARK: read

    func status() async throws -> QCStatus { try plain(QCStatus.self, try await send("GET", "/status").0) }
    func purchaseOrders() async throws -> [QCPurchaseOrderItem] { try plain(QCItems<QCPurchaseOrderItem>.self, try await send("GET", "/purchase-orders").0).items }
    func spec(id: String, version: Int) async throws -> QCSpecEnvelope {
        let envelope = try plain(QCSpecEnvelope.self, try await send("GET", "/specs/\(id)", query: [URLQueryItem(name: "version", value: String(version))]).0)
        do { try envelope.spec.check() } catch let error as QCContractError { throw QCError.contract(error) }
        guard envelope.spec.id == id, envelope.spec.version == version else { throw QCError.stale }
        return envelope
    }
    func consentAuthorities() async throws -> [QCConsentAuthority] { try plain(QCItems<QCConsentAuthority>.self, try await send("GET", "/consent-authorities").0).items }
    func samples(purchaseOrderID: String) async throws -> [QCSampleSummary] {
        try plain(QCItems<QCSampleSummary>.self, try await send("GET", "/samples", query: [URLQueryItem(name: "purchase_order_id", value: purchaseOrderID)]).0).items
    }
    func sample(id: String, minimumRevision: Int = 0) async throws -> QCResult {
        try result(try await send("GET", "/samples/\(id)").0, QCExpectation(sampleID: id, minimumRevision: minimumRevision))
    }

    // MARK: write

    func createSelection(_ input: QCSelectionInput, idempotencyKey: UUID) async throws -> QCSamplingSelection {
        let data = try await send("POST", "/selections", body: try JSONEncoder().encode(input), idempotencyKey: idempotencyKey).0
        do { return try QCContract.decode(QCSamplingSelection.self, type: "SamplingSelection", from: data) } catch let error as QCContractError { throw QCError.contract(error) }
    }
    func createSample(_ input: QCSampleInput, idempotencyKey: UUID) async throws -> QCResult {
        var body: [String: Any?] = ["selection_id": input.selectionID, "spec_id": input.specID, "spec_version": input.specVersion,
                                    "predecessor_sample_id": input.predecessorSampleID, "expected_predecessor_revision": input.expectedPredecessorRevision, "reason": input.reason]
        if let why = input.interventionReason { body["interventionReason"] = why }
        let data = try await send("POST", "/samples", body: try json(body), idempotencyKey: idempotencyKey).0
        let value: QCResult
        do { value = try QCResult.decode(data) } catch let error as QCContractError { throw QCError.contract(error) }
        guard value.sample.selection_id == input.selectionID, value.sample.spec_id == input.specID, value.sample.spec_version == input.specVersion,
              value.sample.predecessor_sample_id == input.predecessorSampleID else { throw QCError.stale }
        return value
    }
    func createCaptureSet(sampleID: String, expectedRevision: Int, idempotencyKey: UUID) async throws -> QCResult {
        try result(try await send("POST", "/samples/\(sampleID)/capture-sets", body: try json(["expected_revision": expectedRevision]), idempotencyKey: idempotencyKey).0,
                   QCExpectation(sampleID: sampleID, minimumRevision: expectedRevision))
    }
    /// Uploads the original bytes untouched. The idempotency key is derived from the stable capture ID, so a retry is the same upload.
    func uploadCapture(_ upload: QCCaptureUpload, sampleID: String, captureSetID: String, expectedRevision: Int) async throws -> QCResult {
        guard upload.data.count <= QCLimits.maxOriginalBytes, QCCrypto.sha256(upload.data) == upload.sha256, upload.attestation.image_sha256 == upload.sha256 else { throw QCError.contract(.semantic("the original does not match its recorded hash")) }
        let meta: [String: Any?] = ["capture_id": upload.captureID, "role": upload.role.rawValue, "expected_revision": expectedRevision, "sha256": upload.sha256, "taken_at": upload.takenAt,
                                    "device_profile_id": upload.deviceProfileID, "calibration_id": upload.calibrationID, "consent_record_id": upload.consentRecordID,
                                    "attestation": try JSONSerialization.jsonObject(with: try JSONEncoder().encode(upload.attestation))]
        let boundary = "yfqc-\(UUID().uuidString.lowercased())"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"meta\"\r\nContent-Type: application/json\r\n\r\n".utf8)); body.append(try json(meta))
        let ext = upload.mediaType == .jpeg ? "jpg" : upload.mediaType == .png ? "png" : "webp"
        body.append(Data("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"original\"; filename=\"\(upload.captureID).\(ext)\"\r\nContent-Type: \(upload.mediaType.rawValue)\r\n\r\n".utf8))
        body.append(upload.data); body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let data = try await send("POST", "/capture-sets/\(captureSetID)/captures", body: body, contentType: "multipart/form-data; boundary=\(boundary)", idempotencyKey: UUID(uuidString: upload.captureID)).0
        let value = try result(data, QCExpectation(sampleID: sampleID, captureSetID: captureSetID, minimumRevision: expectedRevision))
        guard let stored = value.captures.first(where: { $0.id == upload.captureID }), stored.original_sha256 == upload.sha256 else { throw QCError.stale }
        return value
    }
    func closeCaptureSet(sampleID: String, captureSetID: String, expectedRevision: Int, idempotencyKey: UUID) async throws -> QCResult {
        try result(try await send("POST", "/capture-sets/\(captureSetID)/close", body: try json(["expected_revision": expectedRevision]), idempotencyKey: idempotencyKey).0,
                   QCExpectation(sampleID: sampleID, captureSetID: captureSetID, minimumRevision: expectedRevision))
    }

    /// Asks the server to analyse one closed capture set. The returned decision is the server's; a result for
    /// any other sample, capture set or older revision is rejected. A lost answer is an unknown outcome, never a guess.
    func analyze(sampleID: UUID, captureSetID: UUID, expectedRevision: Int, idempotencyKey: UUID) async throws -> QCResult {
        let sample = Self.lower(sampleID), set = Self.lower(captureSetID)
        let bound = screen
        if let bound { guard bound.sampleID == sample, bound.minimumRevision == expectedRevision, bound.captureSetID == set else { throw QCError.stale } }
        let expected = QCExpectation(sampleID: sample, specID: bound?.specID, specVersion: bound?.specVersion, captureSetID: set, minimumRevision: expectedRevision + 1, analysed: true, maximumRevision: expectedRevision + 1)
        let deadline = now().addingTimeInterval(QCLimits.requestDeadline)
        let (data, response) = try await send("POST", "/samples/\(sample)/analyze", body: try json(["expected_revision": expectedRevision, "capture_set_id": set]), idempotencyKey: idempotencyKey)
        if response.statusCode != 202 { guard screen == bound else { throw QCError.stale }; return try result(data, expected) }
        // The same key is already running on the server: follow its request record, never start a second analysis.
        let pending = try plain(QCPending.self, data)
        while now() < deadline {
            let state = try plain(QCRequestState.self, try await send("GET", "/requests/\(pending.request_id)").0)
            switch state.state {
            case "COMPLETED":
                guard let value = state.result else { throw QCError.unknownOutcome }
                do { try value.check() } catch let error as QCContractError { throw QCError.contract(error) }
                guard screen == bound else { throw QCError.stale }; try QCResultGuard.accept(value, expected); return value
            case "EXPIRED": throw QCError.deadline
            case "FAILED": if let body = state.error { throw QCError.server(status: 0, body: body) }; throw QCError.unknownOutcome
            case "IN_PROGRESS": try await sleeper(2)
            default: throw QCError.contract(.malformed("unknown request state"))
            }
        }
        throw QCError.unknownOutcome
    }

    func adjudicate(sampleID: String, expectedRevision: Int, input: QCAdjudicationInput, idempotencyKey: UUID) async throws -> QCResult {
        var body: [String: Any?] = ["expected_revision": expectedRevision, "outcome": input.outcome.rawValue, "reason": input.reason, "reference_ids": input.referenceIDs, "supersedes_id": input.supersedesID]
        if let why = input.interventionReason { body["interventionReason"] = why }
        return try result(try await send("POST", "/samples/\(sampleID)/adjudications", body: try json(body), idempotencyKey: idempotencyKey).0,
                          QCExpectation(sampleID: sampleID, minimumRevision: expectedRevision))
    }
}


extension QCClient {
    func confirmSpec(body: JSONValue, idempotencyKey: UUID) async throws -> QCPurchaseSpec {
        try QCContract.decode(QCPurchaseSpec.self, type: "PurchaseSpec", from: try await send("POST", "/specs", body: body.data(), idempotencyKey: idempotencyKey).0)
    }
    func registerConsentAuthority(body: JSONValue, idempotencyKey: UUID) async throws -> QCConsentAuthority {
        try QCContract.decode(QCConsentAuthority.self, type: "ConsentAuthority", from: try await send("POST", "/consent-authorities", body: body.data(), idempotencyKey: idempotencyKey).0)
    }
    func requestState(id: UUID) async throws -> QCRequestState {
        try plain(QCRequestState.self, try await send("GET", "/requests/\(Self.lower(id))").0)
    }
    func original(id: UUID) async throws -> Data { try await send("GET", "/captures/\(Self.lower(id))/original").0 }
    struct Reauth: Decodable { let proof: String; let expires_at: String }
    func reauthenticate(pin: String, payloadSHA256: String, idempotencyKey: UUID) async throws -> Reauth {
        try plain(Reauth.self, try await send("POST", "/reauth", body: json(["pin": pin, "payload_sha256": payloadSHA256]), idempotencyKey: idempotencyKey).0)
    }
    struct Releases: Decodable { let items: [QCRelease]; let active_release_id: String? }
    func releases() async throws -> Releases { try plain(Releases.self, try await send("GET", "/releases").0) }
    func registerRelease(body: JSONValue, idempotencyKey: UUID) async throws -> QCRelease {
        try QCContract.decode(QCRelease.self, type: "Release", from: try await send("POST", "/releases", body: body.data(), idempotencyKey: idempotencyKey).0)
    }
    func activateRelease(id: UUID, body: JSONValue, idempotencyKey: UUID) async throws -> QCRelease {
        try QCContract.decode(QCRelease.self, type: "Release", from: try await send("POST", "/releases/\(Self.lower(id))/activate", body: body.data(), idempotencyKey: idempotencyKey).0)
    }
    func suspendRelease(id: UUID, reason: String, idempotencyKey: UUID) async throws -> QCRelease {
        try QCContract.decode(QCRelease.self, type: "Release", from: try await send("POST", "/releases/\(Self.lower(id))/suspend", body: json(["reason": reason]), idempotencyKey: idempotencyKey).0)
    }
}
