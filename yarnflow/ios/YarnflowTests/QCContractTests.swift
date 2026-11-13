import XCTest
@testable import Yarnflow

final class QCContractTests: XCTestCase {
    static var repository: URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    static func fixtures(_ name: String) throws -> [[String: Any]] {
        let url = repository.appendingPathComponent("scanner/tests/fixtures/qc-v2/\(name).json")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
    }
    func testEverySharedValidFixtureRoundTrips() throws {
        let fixtures = try Self.fixtures("valid")
        XCTAssertFalse(fixtures.isEmpty)
        for fixture in fixtures {
            let type = try XCTUnwrap(fixture["type"] as? String)
            let value = try JSONValue(any: XCTUnwrap(fixture["value"]))
            XCTAssertEqual(try QCContract.roundTrip(type: type, value: value), value, fixture["name"] as? String ?? type)
        }
    }
    func testEverySharedInvalidFixtureFails() throws {
        let fixtures = try Self.fixtures("invalid")
        XCTAssertFalse(fixtures.isEmpty)
        for fixture in fixtures {
            let type = try XCTUnwrap(fixture["type"] as? String)
            let value = try JSONValue(any: XCTUnwrap(fixture["value"]))
            XCTAssertThrowsError(try QCContract.roundTrip(type: type, value: value), fixture["name"] as? String ?? type)
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
        let store = try QCDraftStore(root: root)
        let bytes = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII="))
        let original = try QCOriginal(data: bytes, mode: .IMPORTED)
        XCTAssertEqual(original.data, bytes)
        XCTAssertEqual(original.attestation.capture_mode, .IMPORTED)
        let now = Date()
        let id = UUID()
        try store.save(original, id: id, now: now)
        XCTAssertEqual(try store.load(id: id, now: now).data, bytes)
        let attrs = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent(id.uuidString).path)
        XCTAssertEqual(attrs[.protectionKey] as? FileProtectionType, .complete)
        XCTAssertThrowsError(try store.load(id: id, now: now.addingTimeInterval(86400)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(id.uuidString).path))
        try store.purge()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testStaleResultRejected() throws {
        let row = try XCTUnwrap(try Self.fixtures("valid").first { $0["name"] as? String == "result-created" })
        let result = try QCResult.decode(JSONSerialization.data(withJSONObject: XCTUnwrap(row["value"])))
        XCTAssertThrowsError(try QCResultGuard.accept(result, QCExpectation(sampleID: UUID().uuidString)))
        XCTAssertThrowsError(try QCResultGuard.accept(result, QCExpectation(sampleID: result.sample.id, specVersion: result.sample.spec_version + 1)))
        XCTAssertThrowsError(try QCResultGuard.accept(result, QCExpectation(sampleID: result.sample.id, minimumRevision: result.revision + 1)))
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
            let (code, data, headers) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
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
    func testRealWorkerLoginPathAndIsolatedCookieNoBearer() async throws {
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
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
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
