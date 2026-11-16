import XCTest
@testable import Yarnflow

/// Holds one protocol-double answer until the test releases it, so an operation can be kept in flight.
final class QCGateDouble: @unchecked Sendable {
    private let lock = NSLock()
    private var entered = false
    let release = DispatchSemaphore(value: 0)
    func enter() { lock.lock(); entered = true; lock.unlock(); _ = release.wait(timeout: .now() + 10) }
    func waitUntilEntered() async throws {
        for _ in 0..<500 {
            lock.lock(); let done = entered; lock.unlock()
            if done { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("the operation never reached the gate")
    }
}
/// Records the paths and Idempotency-Keys the protocol double saw, and carries the answer mode for the next request.
final class QCRequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [(path: String, key: String?)] = []
    private var answer = "lost"
    var mode: String { get { lock.lock(); defer { lock.unlock() }; return answer } set { lock.lock(); answer = newValue; lock.unlock() } }
    func record(_ request: URLRequest) { lock.lock(); defer { lock.unlock() }; recorded.append((request.url?.path ?? "", request.value(forHTTPHeaderField: "Idempotency-Key"))) }
    var paths: [String] { lock.lock(); defer { lock.unlock() }; return recorded.map { $0.path } }
    var keys: [String] { lock.lock(); defer { lock.unlock() }; return recorded.compactMap { $0.key } }
}

final class QCWorkflowModelTests: XCTestCase {
    private let origin = "https://qc.example.invalid"
    private let sampleA = "00000000-0000-4000-8000-000000000030", sampleB = "00000000-0000-4000-8000-000000000032"
    private let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    override func tearDown() { QCProtocolDouble.handler = nil; try? FileManager.default.removeItem(at: root); super.tearDown() }

    private func fixture(_ name: String) throws -> [String: Any] {
        let row = try XCTUnwrap(try QCContractTests.fixtures("valid").first { $0["name"] as? String == name })
        return try XCTUnwrap(row["value"] as? [String: Any])
    }
    /// The shared result-created row with its sample ID replaced. Nothing else in the record changes.
    private func resultJSON(sample id: String) throws -> Data {
        var value = try fixture("result-created")
        var sample = try XCTUnwrap(value["sample"] as? [String: Any]); sample["id"] = id; value["sample"] = sample
        return try JSONSerialization.data(withJSONObject: value)
    }
    /// A signed-in model whose client talks only to the protocol double, with a temporary draft store.
    @MainActor private func workflowDouble(delays: QCDelaysDouble = QCDelaysDouble()) throws -> QCWorkflowModel {
        let model = QCWorkflowModel()
        let credentials = QCCredentialsDouble()
        credentials.values["session|\(origin)"] = "inspector double\n\(String(repeating: "a", count: 64))"
        model.client = try QCClient(config: QCConfig(origin: origin), credentials: credentials, protocolClasses: [QCProtocolDouble.self], sleeper: { delays.record($0) })
        model.drafts = try QCDraftStore(root: root)
        model.signedIn = true
        return model
    }

    @MainActor func testTapWhileBusyIsIgnoredAndOnlyTheOpenSampleInstalls() async throws {
        let model = try workflowDouble()
        let answerA = try resultJSON(sample: sampleA), specData = try JSONSerialization.data(withJSONObject: ["spec": try fixture("spec-woven-v1"), "current": true, "versions": [1]] as [String: Any])
        let gate = QCGateDouble(), log = QCRequestLog(), pathA = "/api/qc/v2/samples/\(sampleA)"
        QCProtocolDouble.handler = { request in
            log.record(request)
            if request.url?.path == pathA { gate.enter(); return (200, answerA, [:]) }
            if request.url?.path.hasPrefix("/api/qc/v2/specs/") == true { return (200, specData, [:]) }
            return (500, Data(), [:])
        }
        let first = Task { await model.open(sampleA) }
        try await gate.waitUntilEntered()
        XCTAssertTrue(model.busy)
        await model.open(sampleB)                      // the operator taps another sample while A is in flight
        gate.release.signal()
        await first.value
        XCTAssertEqual(model.result?.sample.id, sampleA)
        XCTAssertEqual(model.error, "")
        XCTAssertFalse(log.paths.contains { $0.hasSuffix(sampleB) }, "the second tap must not send a request")
    }

    @MainActor func testOpenRefusesResultWithDifferentSampleID() async throws {
        let model = try workflowDouble()
        let answerB = try resultJSON(sample: sampleB)
        QCProtocolDouble.handler = { request in
            if request.url?.path == "/api/qc/v2/samples/\(self.sampleA)" { return (200, answerB, [:]) }
            return (500, Data(), [:])
        }
        await model.open(sampleA)
        XCTAssertNil(model.result, "a mismatched sample ID must never be installed")
        XCTAssertEqual(model.error, QCError.stale.localizedDescription)
    }

    @MainActor func testEntryPointsDoNothingWhileBusy() async throws {
        let model = try workflowDouble()
        let log = QCRequestLog()
        QCProtocolDouble.handler = { request in log.record(request); return (500, Data(), [:]) }
        model.result = try QCResult.decode(resultJSON(sample: sampleA))
        model.busy = true
        await model.open(sampleB)
        await model.beginCaptureSet()
        XCTAssertEqual(model.result?.sample.id, sampleA, "a busy model must keep the screen it shows")
        XCTAssertTrue(log.paths.isEmpty)
        XCTAssertTrue(model.busy)
    }

    @MainActor func testAnswerThatArrivesAfterClearWritesNothing() async throws {
        let model = try workflowDouble()
        let statusJSON = try JSONSerialization.data(withJSONObject: [
            "schema_version": "2", "mode": "REVIEW_ONLY", "automation": ["enabled": false, "missing_gates": []], "scanner": "test", "role": "inspector",
            "can": ["confirm_spec": false, "create_sample": false, "capture": false, "adjudicate": false, "manage_release": false]] as [String: Any])
        let gate = QCGateDouble(), log = QCRequestLog()
        QCProtocolDouble.handler = { request in
            log.record(request)
            if request.url?.path == "/api/qc/v2/status" { gate.enter(); return (200, statusJSON, [:]) }
            return (500, Data(), [:])
        }
        let refresh = Task { await model.refresh() }
        try await gate.waitUntilEntered()
        model.clear()                                  // the epoch changes while the status answer is still in flight
        gate.release.signal()
        await refresh.value
        XCTAssertNil(model.status)
        XCTAssertTrue(model.orders.isEmpty)
        XCTAssertEqual(model.error, "")
        XCTAssertEqual(model.state, "qc.state.draft")
        XCTAssertFalse(model.busy)
        XCTAssertFalse(log.paths.contains("/api/qc/v2/purchase-orders"), "a stale operation must not send its next request")
    }

    /// P1-2: a sample answer that was already on its way when the operator signed out is never installed.
    @MainActor func testSampleAnswerThatArrivesAfterClearIsNotInstalled() async throws {
        let model = try workflowDouble()
        let answerA = try resultJSON(sample: sampleA)
        let specData = try JSONSerialization.data(withJSONObject: ["spec": try fixture("spec-woven-v1"), "current": true, "versions": [1]] as [String: Any])
        let gate = QCGateDouble(), log = QCRequestLog(), pathA = "/api/qc/v2/samples/\(sampleA)"
        QCProtocolDouble.handler = { request in
            log.record(request)
            if request.url?.path == pathA { gate.enter(); return (200, answerA, [:]) }
            if request.url?.path.hasPrefix("/api/qc/v2/specs/") == true { return (200, specData, [:]) }
            return (500, Data(), [:])
        }
        let open = Task { await model.open(sampleA) }
        try await gate.waitUntilEntered()
        model.clear()                                  // sign-out lands while the sample answer is in flight
        gate.release.signal()
        await open.value
        XCTAssertNil(model.result, "a previous account's sample must never appear after sign-out")
        XCTAssertNil(model.specification)
        XCTAssertTrue(model.familyHistory.isEmpty)
        XCTAssertEqual(model.error, "")
        XCTAssertFalse(model.busy)
        XCTAssertEqual(log.paths.filter { $0.hasPrefix("/api/qc/v2/specs/") }.count, 0, "a stale open must not fetch the specification")
    }

    @MainActor func testRetriesReuseOneKeyAndRefusalDropsIt() async throws {
        let model = try workflowDouble()
        let log = QCRequestLog()
        QCProtocolDouble.handler = { request in
            log.record(request)
            guard request.url?.path.hasSuffix("/capture-sets") == true else { return (500, Data(), [:]) }
            if log.mode == "lost" { throw URLError(.networkConnectionLost) }
            return (409, Data(), [:])
        }
        model.result = try QCResult.decode(resultJSON(sample: sampleA))
        await model.beginCaptureSet()                  // four lost answers, one key
        XCTAssertEqual(model.state, "qc.state.unknown")
        await model.beginCaptureSet()                  // the second tap after the unknown outcome
        log.mode = "refused"
        await model.beginCaptureSet()                  // 409: the server refused, so the key is dropped
        await model.beginCaptureSet()                  // a new attempt after the refusal
        let keys = log.keys
        XCTAssertEqual(keys.count, 10)
        XCTAssertEqual(Set(keys[0..<8]).count, 1, "retries of one action must reuse one key")
        XCTAssertEqual(keys[8], keys[0])
        XCTAssertNotEqual(keys[9], keys[0], "a definitive refusal must allow a new key")
    }

    func testConsentTimesAreComparedAsInstantsAndUnparsableTimesAreNotUsable() throws {
        func authority(_ from: String, _ until: String, withdrawn: String? = nil) throws -> QCConsentAuthority {
            var json: [String: Any] = ["id": "00000000-0000-4000-8000-000000000050", "version": 1, "workspace_id": "00000000-0000-4000-8000-000000000001",
                                       "authority_evidence_sha256": String(repeating: "a", count: 64), "operational_capture": true, "operational_retention_days": 30,
                                       "research_use": false, "training_use": false, "export_destinations": [], "valid_from": from, "expires_at": until]
            json["withdrawn_at"] = withdrawn ?? NSNull()   // the wire has explicit nulls
            return try JSONDecoder().decode(QCConsentAuthority.self, from: JSONSerialization.data(withJSONObject: json))
        }
        func instant(_ text: String) throws -> Date { try XCTUnwrap(QCTime.date(text), text) }
        let inside = try instant("2026-12-01T00:00:00Z")
        XCTAssertTrue(try authority("2026-11-13T08:00:00Z", "2027-11-13T08:00:00Z").permitsCapture(at: inside))
        // "08:00:00.600Z" sorts before "08:00:00Z" as a string, but after it as an instant.
        XCTAssertTrue(try authority("2026-11-13T08:00:00Z", "2027-11-13T08:00:00Z").permitsCapture(at: instant("2026-11-13T08:00:00.600Z")))
        XCTAssertFalse(try authority("2026-11-13T08:00:00.500Z", "2027-11-13T08:00:00Z").permitsCapture(at: instant("2026-11-13T08:00:00.400Z")))
        XCTAssertTrue(try authority("2026-11-13T08:00:00.500Z", "2026-12-01T00:00:00.500Z").permitsCapture(at: instant("2026-12-01T00:00:00.200Z")))
        XCTAssertFalse(try authority("2026-11-13T08:00:00Z", "2026-12-01T00:00:00Z").permitsCapture(at: inside), "expiry is exclusive")
        XCTAssertFalse(try authority("2026-11-13T08:00:00Z", "2027-11-13T08:00:00Z", withdrawn: "2026-11-20T00:00:00Z").permitsCapture(at: inside))
        // The contract decoder refuses these shapes, so the defensive branch is exercised on a built record.
        var dateOnly = try authority("2026-11-13T08:00:00Z", "2027-11-13T08:00:00Z"); dateOnly.valid_from = "2026-11-13"
        XCTAssertFalse(dateOnly.permitsCapture(at: inside), "a date without a time is not usable")
        var unparsable = try authority("2026-11-13T08:00:00Z", "2027-11-13T08:00:00Z"); unparsable.expires_at = "soon"
        XCTAssertFalse(unparsable.permitsCapture(at: inside), "an unparsable expiry is not usable")
    }
}
