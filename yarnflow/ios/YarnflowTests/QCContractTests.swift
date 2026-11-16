import XCTest
@testable import Yarnflow

final class QCContractTests: XCTestCase {
    static func fixtures(_ name: String) throws -> [[String: Any]] {
        let bundle = Bundle(for: QCContractTests.self)
        let path = (bundle.resourceURL ?? bundle.bundleURL).appendingPathComponent("\(name).json").path
        guard let url = bundle.url(forResource: name, withExtension: "json"), FileManager.default.fileExists(atPath: url.path) else {
            XCTFail("Missing shared QC fixture file: \(path)")
            throw QCContractError.contractUnavailable
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]], url.path)
    }
    func testSharedFixturesAreBundled() throws {
        let bundle = Bundle(for: QCContractTests.self)
        for name in ["valid", "invalid"] {
            let path = bundle.bundleURL.appendingPathComponent("\(name).json").path
            _ = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"), "Missing shared QC fixture file: \(path)")
        }
    }
    /// A rejected row must fail validation. `contractUnavailable` means nothing was checked, so it is a failure here.
    private func assertValidationFailure(_ error: Error, _ label: String) {
        switch error as? QCContractError {
        case .malformed?, .schema?, .semantic?: break
        case .contractUnavailable?: XCTFail("\(label): contract not loaded, so the row was never validated")
        case nil: XCTFail("\(label): not a contract error: \(error)")
        }
    }
    private func exerciseSharedFixtures(_ name: String, valid: Bool) throws {
        guard QCSchema.bundled != nil else { XCTFail("qc-v2.schema.json is not bundled, so no shared fixture can be validated"); throw QCContractError.contractUnavailable }
        let fixtures = try Self.fixtures(name)
        XCTAssertGreaterThan(fixtures.count, 0, "\(name).json has no rows")
        let modeled = Set(QCContract.roundTrippers.keys)
        XCTAssertEqual(modeled, Set(QCContract.decoders.keys))
        var expected: [String: Int] = [:], exercised: [String: Int] = [:]
        for fixture in fixtures {
            let type = try XCTUnwrap(fixture["type"] as? String)
            guard modeled.contains(type) else { XCTFail("No Swift mirror for shared fixture type \(type)"); continue }
            expected[type, default: 0] += 1
            let value = try JSONValue(any: XCTUnwrap(fixture["value"]))
            let label = fixture["name"] as? String ?? type
            // Counted only after the row's own assertion has passed.
            if valid {
                do {
                    let encoded = try QCContract.roundTrip(type: type, value: value)
                    XCTAssertEqual(encoded, value, label)
                    exercised[type, default: 0] += 1
                }
                catch { XCTFail("\(label): \(error)") }
            } else {
                do { _ = try QCContract.roundTrip(type: type, value: value); XCTFail("\(label): an invalid row was accepted") }
                catch { assertValidationFailure(error, label); exercised[type, default: 0] += 1 }
            }
        }
        XCTAssertFalse(expected.isEmpty)
        if valid { XCTAssertEqual(Set(expected.keys), modeled, "Every modeled type needs a valid shared fixture") }
        for type in expected.keys.sorted() {
            print("QC shared \(name) \(type): \(exercised[type, default: 0])/\(expected[type, default: 0]) exercised")
            XCTAssertGreaterThan(exercised[type, default: 0], 0, type)
            XCTAssertEqual(exercised[type], expected[type], type)
        }
        XCTAssertEqual(exercised.values.reduce(0, +), fixtures.count)
    }
    func testEverySharedValidFixtureRoundTrips() throws { try exerciseSharedFixtures("valid", valid: true) }
    func testEverySharedInvalidFixtureFails() throws { try exerciseSharedFixtures("invalid", valid: false) }
    func testEveryModeledTypeRejectsUnknownFields() throws {
        // Four modeled types have no invalid.json row. Exercise strict decoding for all 27
        // using an explicitly derived invalid value, separately from shared fixture counts.
        var exercised: [String: Int] = [:]
        for fixture in try Self.fixtures("valid") {
            let type = try XCTUnwrap(fixture["type"] as? String)
            var object = try XCTUnwrap(fixture["value"] as? [String: Any])
            object["unknown_field_double"] = true
            do { _ = try QCContract.roundTrip(type: type, value: JSONValue(any: object)); XCTFail("\(type): unknown field accepted") }
            catch { assertValidationFailure(error, type) }
            exercised[type, default: 0] += 1
        }
        XCTAssertEqual(Set(exercised.keys), Set(QCContract.roundTrippers.keys))
        for type in exercised.keys.sorted() {
            print("QC derived invalid \(type): \(exercised[type, default: 0]) exercised")
            XCTAssertGreaterThan(exercised[type, default: 0], 0, type)
        }
    }
    func testMissingUnknownLensAndChangedAcquisitionAreNotInvented() throws {
        let fixtures = try Self.fixtures("valid")
        let row = try XCTUnwrap(fixtures.first { $0["name"] as? String == "attestation-native-observed" })
        let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(row["value"]))
        var native = try QCContract.decode(QCAcquisitionAttestation.self, type: "AcquisitionAttestation", from: data)
        let hash = native.image_sha256
        native.lens_id = nil
        XCTAssertTrue(native.isReviewOnly)
        native.capture_mode = .IMPORTED
        XCTAssertTrue(native.isReviewOnly)
        XCTAssertEqual(native.image_sha256, hash)
    }
    func testCameraAndPhotosDenialAndHEICGuidance() throws {
        XCTAssertEqual(QCAccess.camera(authorized: false), .cameraDenied)
        XCTAssertEqual(QCAccess.photos(authorized: false), .photosDenied)
        XCTAssertThrowsError(try QCOriginal(data: Data("heic".utf8), mode: .IMPORTED))
        XCTAssertFalse(QCText.t("qc.capture.heic").isEmpty)
    }
    func testOriginalPreservationProtectedExpiryAndPurge() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var requestedOptions: [Data.WritingOptions] = []
        let store = try QCDraftStore(root: root, writeOriginal: { data, url, options in
            requestedOptions.append(options)
            try data.write(to: url, options: options)
        })
        let bytes = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII="))
        let original = try QCOriginal(data: bytes, mode: .IMPORTED)
        XCTAssertEqual(original.data, bytes)
        XCTAssertEqual(original.attestation.capture_mode, .IMPORTED)
        let now = Date()
        let id = UUID()
        try store.save(original, id: id, now: now)
        XCTAssertEqual(try store.load(id: id, now: now).data, bytes)
        XCTAssertEqual(requestedOptions.count, 1)
        XCTAssertTrue(try XCTUnwrap(requestedOptions.first).contains(.completeFileProtection))
        XCTAssertTrue(try XCTUnwrap(requestedOptions.first).contains(.atomic))
        XCTAssertThrowsError(try store.load(id: id, now: now.addingTimeInterval(86400)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(id.uuidString).path))
        try store.purge()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testPhysicalDeviceDraftProtectionAttribute() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("physical device required (G8): Simulator does not report NSFileProtectionKey")
        #else
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try QCDraftStore(root: root)
        let bytes = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII="))
        let id = UUID()
        try store.save(QCOriginal(data: bytes, mode: .IMPORTED), id: id)
        let attrs = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent(id.uuidString).path)
        XCTAssertEqual(attrs[.protectionKey] as? FileProtectionType, .complete)
        #endif
    }
    func testStaleResultRejected() throws {
        let row = try XCTUnwrap(try Self.fixtures("valid").first { $0["name"] as? String == "result-created" })
        let result = try QCResult.decode(JSONSerialization.data(withJSONObject: XCTUnwrap(row["value"])))
        XCTAssertThrowsError(try QCResultGuard.accept(result, QCExpectation(sampleID: UUID().uuidString)))
        XCTAssertThrowsError(try QCResultGuard.accept(result, QCExpectation(sampleID: result.sample.id, specVersion: result.sample.spec_version + 1)))
        XCTAssertThrowsError(try QCResultGuard.accept(result, QCExpectation(sampleID: result.sample.id, minimumRevision: result.revision + 1)))
    }
    /// P1-4: a release build must never accept cleartext HTTP, and the bundled release origin is HTTPS.
    /// The loopback allowance exists only for development builds and only for a loopback host.
    func testReleaseOriginIsHTTPSOnly() throws {
        for text in ["http://127.0.0.1:8788", "http://localhost:8788", "http://qc.example.invalid"] {
            XCTAssertThrowsError(try QCConfig(origin: text, policy: .release), text)
        }
        XCTAssertNoThrow(try QCConfig(origin: "https://yarnflow.yarnflow-workspace.workers.dev", policy: .release))
        XCTAssertNoThrow(try QCConfig(origin: "http://127.0.0.1:8788", policy: .development))
        XCTAssertNoThrow(try QCConfig(origin: "http://localhost:8788", policy: .development))
        XCTAssertThrowsError(try QCConfig(origin: "http://192.168.1.2:8788", policy: .development), "only loopback may use http")
        let release = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "YFQCAppOrigin") as? String)
        XCTAssertEqual(URL(string: release)?.scheme, "https", release)
        XCTAssertNoThrow(try QCConfig(origin: release, policy: .release))
        let development = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "YFQCAppOriginDebug") as? String)
        XCTAssertNoThrow(try QCConfig(origin: development, policy: .development))
    }
}

// Doubles live only in the test target. No trained stages, release or signing proof is fabricated.
final class QCCredentialsDouble: QCCredentialStore, @unchecked Sendable {
    var values: [String: String] = [:]
    private let lock = NSLock()
    func load(_ account: String) -> String? { lock.lock(); defer { lock.unlock() }; return values[account] }
    func save(_ value: String, for account: String) { lock.lock(); defer { lock.unlock() }; values[account] = value }
    func delete(_ account: String) { lock.lock(); defer { lock.unlock() }; values[account] = nil }
}
final class QCProtocolDouble: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, Data, [String: String]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let handler = try XCTUnwrap(Self.handler, "URLProtocol double has no handler")
            let (code, data, headers) = try handler(request)
            let url = try XCTUnwrap(request.url)
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    static func body(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        let stream = try XCTUnwrap(request.httpBodyStream, "Request must carry a JSON body")
        stream.open(); defer { stream.close() }
        var body = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeRawData) }
            if count == 0 { return body }
            body.append(contentsOf: buffer.prefix(count))
        }
    }
    override func stopLoading() {}
}
final class QCDelaysDouble: @unchecked Sendable {
    var values: [TimeInterval] = []
    let lock = NSLock()
    func record(_ value: TimeInterval) { lock.lock(); defer { lock.unlock() }; values.append(value) }
}
extension QCContractTests {
    private func clientDouble(_ credentials: QCCredentialsDouble = QCCredentialsDouble(), delays: QCDelaysDouble = QCDelaysDouble()) throws -> QCClient {
        try QCClient(config: QCConfig(origin: "https://qc.example.invalid"), credentials: credentials, protocolClasses: [QCProtocolDouble.self], sleeper: { delays.record($0) })
    }
    private var sessionHeaderDouble: [String: String] { ["Set-Cookie": "yf_session=\(String(repeating: "a", count: 64)); Path=/; HttpOnly; Secure; SameSite=Strict"] }
    func testWorkerLoginPathUsingProtocolDoubleAndIsolatedCookieNoBearer() async throws {
        let credentials = QCCredentialsDouble()
        let client = try clientDouble(credentials)
        let cookieHeader = sessionHeaderDouble
        var requests = 0
        QCProtocolDouble.handler = { request in
            requests += 1
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            if requests == 1 {
                XCTAssertEqual(request.url?.path, "/api/auth/login")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://qc.example.invalid")
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: QCProtocolDouble.body(request)) as? [String: String])
                XCTAssertEqual(body, ["name": "Inspector double", "pin": "1234"])
                return (200, Data("{}".utf8), cookieHeader)
            }
            XCTAssertEqual(request.url?.path, "/api/qc/v2/purchase-orders")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "yf_session=\(String(repeating: "a", count: 64))")
            return (200, Data("{\"items\":[]}".utf8), [:])
        }
        try await client.signIn(name: "Inspector double", pin: "1234")
        _ = try await client.purchaseOrders()
        XCTAssertEqual(requests, 2)
        XCTAssertFalse(credentials.values.values.contains(where: { $0.contains("1234") }))
        let empty = try clientDouble()
        let signedIn = await empty.isSignedIn
        XCTAssertFalse(signedIn)
    }
    func testRetriesOnlyAllowedStatusesWithSameIdempotencyKey() async throws {
        let delays = QCDelaysDouble()
        let client = try clientDouble(delays: delays)
        let cookieHeader = sessionHeaderDouble
        var calls = 0
        let key = UUID()
        let fixture = try XCTUnwrap(try Self.fixtures("valid").first { $0["name"] as? String == "result-created" })
        let resultData = try JSONSerialization.data(withJSONObject: XCTUnwrap(fixture["value"]))
        let record = try QCResult.decode(resultData)
        QCProtocolDouble.handler = { request in
            if request.url?.path == "/api/auth/login" { return (200, Data("{}".utf8), cookieHeader) }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://qc.example.invalid")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), key.uuidString.lowercased())
            calls += 1
            if calls <= 3 { return ([429,503,504][calls-1], Data(), [:]) }
            return (201, resultData, [:])
        }
        try await client.signIn(name: "Inspector double", pin: "1234")
        _ = try await client.createSample(QCSampleInput(selectionID: record.sample.selection_id, specID: record.sample.spec_id, specVersion: record.sample.spec_version), idempotencyKey: key)
        XCTAssertEqual(calls, 4)
        XCTAssertEqual(delays.values, [1,2,4])
    }
    func testConflictIsNotRetried() async throws {
        let client = try clientDouble()
        let cookieHeader = sessionHeaderDouble
        var calls = 0
        QCProtocolDouble.handler = { request in
            if request.url?.path == "/api/auth/login" { return (200, Data("{}".utf8), cookieHeader) }
            calls += 1; return (409, Data(), [:])
        }
        try await client.signIn(name: "Inspector double", pin: "1234")
        do { _ = try await client.purchaseOrders(); XCTFail("Conflict must fail") } catch { XCTAssertEqual(calls, 1) }
    }
    func testUnknownOutcomeTransportReplaysSameKey() async throws {
        let delays = QCDelaysDouble()
        let client = try clientDouble(delays: delays)
        let cookieHeader = sessionHeaderDouble
        let key = UUID()
        var calls = 0
        QCProtocolDouble.handler = { request in
            if request.url?.path == "/api/auth/login" { return (200, Data("{}".utf8), cookieHeader) }
            calls += 1
            XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), key.uuidString.lowercased())
            throw URLError(.networkConnectionLost)
        }
        try await client.signIn(name: "Inspector double", pin: "1234")
        do { _ = try await client.createCaptureSet(sampleID: UUID().uuidString.lowercased(), expectedRevision: 0, idempotencyKey: key); XCTFail("Must report unknown outcome") }
        catch { XCTAssertEqual(error as? QCError, .unknownOutcome) }
        XCTAssertEqual(calls, 4); XCTAssertEqual(delays.values, [1,2,4])
    }
    func test401AndAccountSwitchPurgeSessionAndDrafts() async throws {
        let credentials = QCCredentialsDouble()
        let client = try clientDouble(credentials)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let drafts = try QCDraftStore(root: root)
        let marker = root.appendingPathComponent("draft-double")
        let invalidated = expectation(description: "401 invalidation")
        await client.setInvalidationHandler { try? drafts.purge(); invalidated.fulfill() }
        let cookieHeader = sessionHeaderDouble
        QCProtocolDouble.handler = { request in
            if request.url?.path == "/api/auth/login" { return (200, Data("{}".utf8), cookieHeader) }
            return (401, Data(), [:])
        }
        try await client.signIn(name: "Inspector double", pin: "1234")
        try Data("draft double".utf8).write(to: marker)
        do { _ = try await client.purchaseOrders(); XCTFail("401 must fail") } catch { XCTAssertEqual(error as? QCError, .unauthenticated) }
        await fulfillment(of: [invalidated], timeout: 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
        XCTAssertTrue(credentials.values.isEmpty)
        let signedIn = await client.isSignedIn; XCTAssertFalse(signedIn)
        let switched = expectation(description: "account switch invalidates")
        await client.setInvalidationHandler { try? drafts.purge(); switched.fulfill() }
        try await client.signIn(name: "First double", pin: "1234")
        try Data("draft double".utf8).write(to: marker)
        try await client.signIn(name: "Second double", pin: "5678")
        await fulfillment(of: [switched], timeout: 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
        let account = await client.account; XCTAssertEqual(account, "second double")
    }
}
