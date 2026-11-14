import SwiftUI
import PhotosUI
import Photos
import Observation

// UI text is a catalog key. Technical identifiers and units use Unicode first-strong isolates.
enum QCText {
    static func t(_ key: String) -> String { NSLocalizedString(key, comment: "Incoming fabric sample QC") }
    static func reason(_ value: QCReason) -> String { t("qc.reason.\(value.rawValue)") }
    static func errorCode(_ value: QCErrorCode) -> String { t("qc.error.\(value.rawValue)") }
    static func isolated(_ value: String) -> String { "\u{2068}\(value)\u{2069}" }
}

@MainActor @Observable final class QCWorkflowModel {
    var client: QCClient?
    var status: QCStatus?
    var orders: [QCPurchaseOrderItem] = []
    var samples: [QCSampleSummary] = []
    var authorities: [QCConsentAuthority] = []
    var specification: QCPurchaseSpec?
    var result: QCResult?
    var familyHistory: [QCResult] = []
    var signedIn = false
    var busy = false
    var error = ""
    var state = "qc.state.draft"
    var epoch = 0
    var selectedOrder = ""
    var drafts: QCDraftStore?
    private var analysisKey: UUID?
    private var analysisBinding: String?
    init() {
        do {
            drafts = try QCDraftStore()
            client = QCClient(config: try QCConfig.bundled())
        } catch { self.error = QCText.t("qc.error.not_configured") }
    }
    func initialize() async {
        guard let client else { return }
        let drafts = drafts
        await client.setInvalidationHandler { [weak self] in
            try? drafts?.purge()
            Task { @MainActor [weak self] in self?.clear() }
        }
        signedIn = await client.isSignedIn
        if signedIn { await refresh() }
    }
    func clear() {
        epoch += 1; result = nil; specification = nil; status = nil; orders = []; samples = []; authorities = []; familyHistory = []; signedIn = false; busy = false; analysisKey = nil; analysisBinding = nil; selectedOrder = ""; state = "qc.state.draft"
        try? drafts?.purge()
    }
    func logout() {
        clear()
        let client = client
        Task { await client?.signOut() }
    }
    func run(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true; error = ""; let current = epoch
        defer { if epoch == current { busy = false } }
        do { try await operation() }
        catch { if epoch == current { self.error = error.localizedDescription; state = (error as? QCError) == .unknownOutcome ? "qc.state.unknown" : "qc.state.failed" } }
    }
    func login(name: String, pin: String) async {
        clear()
        await run {
            guard let client else { throw QCError.notConfigured }
            try await client.signIn(name: name, pin: pin)
            signedIn = true
            try await load()
        }
    }
    private func load() async throws {
        guard let client else { throw QCError.notConfigured }
        status = try await client.status()
        orders = try await client.purchaseOrders()
        authorities = try await client.consentAuthorities()
    }
    func refresh() async { await run { try await load() } }
    func choose(_ order: QCPurchaseOrderItem) async {
        result = nil; specification = nil; familyHistory = []; selectedOrder = order.id; analysisKey = nil
        await client?.bindScreen(nil)
        await run {
            guard let client, let spec = order.current_spec else { throw QCError.contract(.semantic("PO_UNCONFIRMED")) }
            specification = try await client.spec(id: spec.id, version: spec.version).spec
            samples = try await client.samples(purchaseOrderID: order.id)
        }
    }
    func open(_ id: String) async {
        result = nil; familyHistory = []; await client?.bindScreen(nil)
        await run {
            guard let client else { throw QCError.notConfigured }
            let value = try await client.sample(id: id)
            specification = try await client.spec(id: value.sample.spec_id, version: value.sample.spec_version).spec
            try await install(value)
            if let prior = value.family.predecessor_sample_id { familyHistory.append(try await client.sample(id: prior)) }
            for next in value.family.successor_sample_ids { familyHistory.append(try await client.sample(id: next)) }
        }
    }
    private func install(_ value: QCResult) async throws {
        if let specification { guard specification.id == value.sample.spec_id, specification.version == value.sample.spec_version else { throw QCError.stale } }
        result = value
        let set = value.capture_sets.last
        await client?.bindScreen(QCExpectation(sampleID: value.sample.id, specID: value.sample.spec_id, specVersion: value.sample.spec_version, captureSetID: set?.id, minimumRevision: value.revision))
        state = value.decision == nil ? "qc.state.draft" : "qc.state.complete"
    }
    func createSelection(plan: String, group: String, lot: String, roll: String, location: String, area: String, method: String, face: QCFace) async {
        await run {
            guard let client, let specification, let number = Double(area), number > 0 else { throw QCError.contract(.semantic("selection requires confirmed specification and positive area")) }
            let input = QCSelectionInput(purchase_order_id: specification.purchase_order_id, plan_version: plan, plan_sha256: nil, randomization_seed: nil, draw_index: nil, selection_probability: nil, cohort: .OPERATIONAL, independent_group_id: group, lot_ref: lot, roll_ref: roll, location_ref: location, face: face, planned_area_cm2: number, method: method)
            let selection = try await client.createSelection(input, idempotencyKey: UUID())
            try await install(client.createSample(QCSampleInput(selectionID: selection.id, specID: specification.id, specVersion: specification.version), idempotencyKey: UUID()))
        }
    }
    func linkedEvaluation(reason: String) async {
        guard let previous = result else { return }
        await run {
            guard let client else { throw QCError.notConfigured }
            let current = try await client.spec(id: previous.sample.spec_id, version: previous.family.current_spec_version).spec
            let value = try await client.createSample(QCSampleInput(selectionID: previous.sample.selection_id, specID: current.id, specVersion: current.version, predecessorSampleID: previous.sample.id, expectedPredecessorRevision: previous.revision, reason: reason), idempotencyKey: UUID())
            familyHistory = [previous]; specification = current
            try await install(value)
        }
    }
    func beginCaptureSet() async {
        guard let value = result else { return }
        await run {
            guard let client else { throw QCError.notConfigured }
            try await install(client.createCaptureSet(sampleID: value.sample.id, expectedRevision: value.revision, idempotencyKey: UUID()))
        }
    }
    func upload(id: UUID, role: QCCaptureRole, consent: String, profile: String) async {
        guard let value = result, let set = value.capture_sets.last, let drafts else { return }
        // Hide the old answer before acquisition changes; no cached status replaces an upload failure.
        state = "qc.state.uploading"
        await run {
            guard let client else { throw QCError.notConfigured }
            let original = try drafts.load(id: id)
            let upload = QCCaptureUpload(captureID: id.uuidString.lowercased(), role: role, data: original.data, mediaType: original.mediaType, sha256: original.attestation.image_sha256, takenAt: original.attestation.captured_at, deviceProfileID: profile, consentRecordID: consent, attestation: original.attestation)
            try await install(client.uploadCapture(upload, sampleID: value.sample.id, captureSetID: set.id, expectedRevision: value.revision))
            drafts.remove(id: id)
        }
    }
    func close() async {
        guard let value = result, let set = value.capture_sets.last else { return }
        await run {
            guard let client else { throw QCError.notConfigured }
            try await install(client.closeCaptureSet(sampleID: value.sample.id, captureSetID: set.id, expectedRevision: value.revision, idempotencyKey: UUID()))
        }
    }
    func analyze() async {
        guard let value = result, let set = value.capture_sets.last, let sample = UUID(uuidString: value.sample.id), let setID = UUID(uuidString: set.id) else { return }
        let binding = "\(sample)|\(setID)|\(value.revision)"
        if analysisBinding != binding { analysisKey = UUID(); analysisBinding = binding }
        guard let key = analysisKey else { return }
        state = "qc.state.analyzing"
        await run {
            guard let client else { throw QCError.notConfigured }
            let generation = epoch
            let answer = try await client.analyze(sampleID: sample, captureSetID: setID, expectedRevision: value.revision, idempotencyKey: key)
            guard generation == epoch, result?.revision == value.revision, result?.sample.id == value.sample.id else { throw QCError.stale }
            try await install(answer)
        }
    }
    func adjudicate(outcome: QCAdjudicationOutcome, reason: String, references: String, intervention: String) async {
        guard let value = result else { return }
        await run {
            guard let client else { throw QCError.notConfigured }
            let input = QCAdjudicationInput(outcome: outcome, reason: reason, referenceIDs: references.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }, supersedesID: value.current_human_disposition?.id, interventionReason: intervention.isEmpty ? nil : intervention)
            try await install(client.adjudicate(sampleID: value.sample.id, expectedRevision: value.revision, input: input, idempotencyKey: UUID()))
        }
    }
}

struct QCWorkflow: View {
    @Bindable var model: QCWorkflowModel
    @State private var name = ""
    @State private var pin = ""
    @State private var plan = ""
    @State private var group = ""
    @State private var lot = ""
    @State private var roll = ""
    @State private var location = ""
    @State private var area = ""
    @State private var method = ""
    @State private var face = QCFace.unknown
    @State private var reason = ""
    @State private var references = ""
    @State private var intervention = ""
    @State private var outcome = QCAdjudicationOutcome.UNDETERMINED
    @State private var role = QCCaptureRole.overview
    @State private var consent = ""
    @State private var profile = ""
    @State private var photo: PhotosPickerItem?
    @State private var originalID: UUID?
    @State private var originalReview = false
    @State private var camera = QCCamera()
    @State private var cameraOpen = false
    @State private var photosDenied = false
    @Environment(\.dismiss) private var dismiss
    private let expiryTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(QCText.t("qc.review_only"), systemImage: "eye.trianglebadge.exclamationmark").font(.headline).accessibilityIdentifier("qc-review-only")
                    Text(QCText.t("qc.scope"))
                    if model.status == nil {
                        Text(QCText.t(model.signedIn ? "qc.connection.not_connected" : "qc.connection.sign_in")).accessibilityIdentifier("qc-connection-state")
                    }
                    if Locale.current.language.languageCode?.identifier == "ur" { Text(QCText.t("qc.urdu_review")) }
                    if model.status?.mode == .AUTOMATIC { Text(QCText.t("qc.server_automatic")) }
                }
                if !model.signedIn { login }
                else {
                    Section(QCText.t("qc.purchase_orders")) {
                        ForEach(model.orders) { order in Button { Task { await model.choose(order) } } label: { VStack(alignment: .leading) { Text(order.reference); Text(order.supplier_name).font(.subheadline) } }.disabled(model.busy) }
                    }
                    if let spec = model.specification {
                        Section(QCText.t("qc.specification")) {
                            Text(QCText.isolated("\(spec.id) · v\(spec.version)"))
                            Text(QCText.t("qc.construction.\(spec.construction.rawValue)"))
                            ForEach(spec.density, id: \.axis) { density in Text("\(QCText.t("qc.axis.\(density.axis.rawValue)")) \(QCText.isolated("\(density.lower) – \(density.upper) \(density.unit.rawValue)"))") }
                        }
                        if model.result == nil && model.status?.can.create_sample == true { selection }
                    }
                    if !model.samples.isEmpty {
                        Section(QCText.t("qc.samples")) { ForEach(model.samples) { sample in Button { Task { await model.open(sample.id) } } label: { Text(QCText.isolated("\(sample.roll_ref) / \(sample.location_ref) · v\(sample.spec_version)")) } } }
                    }
                    if let result = model.result { resultView(result) }
                    Section { Button(QCText.t("qc.logout")) { model.logout(); originalID = nil; camera.stop() }.accessibilityIdentifier("qc-logout") }
                }
                Section {
                    if model.busy { ProgressView(QCText.t(model.state)) }
                    else { Text(QCText.t(model.state)).accessibilityIdentifier("qc-state") }
                    if !model.error.isEmpty { Text(model.error).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently).accessibilityIdentifier("qc-error") }
                }
            }
            .navigationTitle(QCText.t("qc.title"))
            .toolbar { Button(QCText.t("qc.done")) { camera.stop(); dismiss() } }
            .task { await model.initialize() }
            .onReceive(expiryTimer) { now in
                try? model.drafts?.expire(now: now)
                if let id = originalID, (try? model.drafts?.load(id: id, now: now)) == nil { originalID = nil; model.error = QCText.t("qc.capture.expired") }
            }
            .onChange(of: model.signedIn) { _, signedIn in if !signedIn { originalID = nil; photo = nil; camera.stop(); camera.original = nil } }
            .onChange(of: photo) { _, item in Task {
                guard let item else { return }
                do { retain(try await QCOriginal.imported(item)) }
                catch { photosDenied = PHPhotoLibrary.authorizationStatus(for: .readWrite) == .denied; model.error = photosDenied ? QCText.t("qc.photos_denied") : error.localizedDescription }
            } }
            .sheet(isPresented: $cameraOpen) {
                VStack(spacing: 20) {
                    Text(QCText.t("qc.capture.guide")).font(.body)
                    if camera.access == .ready { QCCameraPreview(session: camera.session).accessibilityLabel(QCText.t("qc.camera_preview")); Button(QCText.t("qc.shutter")) { camera.capture() }.buttonStyle(.borderedProminent).frame(minHeight: 48) }
                    else { Text(QCText.t(camera.access == .cameraDenied ? "qc.camera_denied" : "qc.camera_unavailable")) }
                    if !camera.error.isEmpty { Text(camera.error) }
                    Button(QCText.t("qc.done")) { camera.stop(); cameraOpen = false }
                }.padding().task { await camera.start() }.onDisappear { camera.stop() }
                .onChange(of: camera.original?.attestation.image_sha256) { _, _ in if let original = camera.original { retain(original); camera.original = nil; camera.stop(); cameraOpen = false } }
            }
        }
    }
    private var login: some View {
        Section(QCText.t("qc.login")) {
            Text(QCText.t("qc.fixed_origin"))
            TextField(QCText.t("qc.name"), text: $name).textContentType(.username).accessibilityIdentifier("qc-name")
            SecureField(QCText.t("qc.pin"), text: $pin).keyboardType(.numberPad).accessibilityIdentifier("qc-pin")
            Button(QCText.t("qc.login")) { let secret = pin; pin = ""; Task { await model.login(name: name, pin: secret) } }.disabled(model.busy || name.isEmpty || pin.count != 4).accessibilityIdentifier("qc-login")
        }
    }
    private var selection: some View {
        Section(QCText.t("qc.selection")) {
            field("qc.plan", $plan); field("qc.group", $group); field("qc.lot", $lot); field("qc.roll", $roll); field("qc.location", $location); field("qc.area", $area); field("qc.method", $method)
            Picker(QCText.t("qc.face"), selection: $face) { ForEach(QCFace.allCases, id: \.self) { Text(QCText.t("qc.face.\($0.rawValue)")).tag($0) } }
            Button(QCText.t("qc.create_sample")) { Task { await model.createSelection(plan: plan, group: group, lot: lot, roll: roll, location: location, area: area, method: method, face: face) } }.disabled(model.busy || [plan, group, lot, roll, location, area, method].contains(where: \.isEmpty))
        }
    }
    @ViewBuilder private func resultView(_ value: QCResult) -> some View {
        Section(QCText.t("qc.sample")) {
            Text(QCText.isolated(value.sample.id)).textSelection(.enabled)
            Text("\(QCText.t("qc.attempt")) \(QCText.isolated("\(value.family.attempts_used) / \(value.family.attempts_max)"))")
            if !value.family.spec_is_current {
                Text(QCText.reason(.PO_VERSION_STALE))
                field("qc.reason", $reason)
                Button(QCText.t("qc.linked")) { originalID = nil; Task { await model.linkedEvaluation(reason: reason) } }.disabled(model.busy || reason.isEmpty || model.status?.can.create_sample != true)
                Text(QCText.t("qc.recapture_current"))
            }
            if model.status?.can.capture == true && value.family.spec_is_current {
                if value.capture_sets.last?.state != .OPEN {
                    Button(QCText.t("qc.begin_set")) { originalID = nil; Task { await model.beginCaptureSet() } }.disabled(model.busy || value.family.attempts_used >= value.family.attempts_max)
                }
            }
            ForEach(value.capture_sets) { set in
                Text("\(QCText.isolated(set.id)) · \(QCText.t("qc.set.\(set.state.rawValue)"))")
            }
        }
        if model.status?.can.capture == true && value.capture_sets.last?.state == .OPEN { capture }
        if value.capture_sets.last?.state == .CLOSED && model.status?.can.capture == true && value.family.spec_is_current {
            Section { Button(QCText.t("qc.analyze")) { Task { await model.analyze() } }.disabled(model.busy); Text(QCText.t("qc.retry_same_key")) }
        }
        if model.state == "qc.state.complete", let decision = value.decision {
            Section(QCText.t("qc.result")) {
                Text(QCText.t("qc.status.\(decision.status.rawValue)")).font(.title2.bold())
                ForEach(decision.reasons, id: \.self) { Text(QCText.reason($0)) }
                if value.recalled_decision_ids.contains(decision.id) { Text(QCText.t("qc.recalled")) }
            }
            if let evidence = value.evidence {
                Section(QCText.t("qc.stages")) {
                    ForEach(evidence.stages, id: \.0) { name, state, reasons in
                        VStack(alignment: .leading) { Text("\(QCText.t("qc.stage.\(name.rawValue)")): \(QCText.t("qc.stage_state.\(state.rawValue)"))"); ForEach(reasons, id: \.self) { Text(QCText.reason($0)).font(.subheadline) } }.accessibilityElement(children: .combine)
                    }
                    Text(evidence.fabric.value?.label.map(QCText.isolated) ?? QCText.reason(.UNKNOWN_FABRIC))
                }
                Section(QCText.t("qc.density")) {
                    ForEach(evidence.metrology.value ?? [], id: \.axis) { m in
                        VStack(alignment: .leading) {
                            Text("\(QCText.t("qc.axis.\(m.axis.rawValue)")): \(QCText.isolated("\(m.value) \(m.unit)"))")
                            Text("\(QCText.t("qc.interval")) \(QCText.isolated("\(m.interval95[0]) – \(m.interval95[1]) \(m.unit)"))")
                            Text("\(QCText.t("qc.reference")) \(QCText.isolated(m.reference_id))")
                            if let limit = model.specification?.density.first(where: { $0.axis == m.axis }) { Text("\(QCText.t("qc.po_limits")) \(QCText.isolated("\(limit.lower) – \(limit.upper) \(limit.unit.rawValue)"))") }
                        }.accessibilityElement(children: .combine)
                    }
                }
                Section(QCText.t("qc.regions")) {
                    let regions = evidence.defects.value?.regions ?? []
                    if regions.isEmpty { Text(QCText.t("qc.no_regions")) }
                    ForEach(Array(regions.enumerated()), id: \.offset) { i, region in
                        Text("\(QCText.t("qc.region")) \(QCText.isolated("\(i + 1) · \(region.capture_id) · \(region.box) · \(region.score)"))").accessibilityElement(children: .combine)
                    }
                }
            }
        }
        Section(QCText.t("qc.history")) {
            ForEach(value.history) { d in Text("\(QCText.t("qc.status.\(d.status.rawValue)")) · \(QCText.isolated("v\(d.spec_version) · \(d.evaluated_at)"))") }
            ForEach(model.familyHistory, id: \.sample.id) { prior in
                Text(QCText.isolated("\(prior.sample.id) · v\(prior.sample.spec_version)"))
                ForEach(prior.history) { d in Text(QCText.t("qc.status.\(d.status.rawValue)")) }
            }
            ForEach(value.adjudications) { a in VStack(alignment: .leading) { Text(QCText.t("qc.outcome.\(a.outcome.rawValue)")); Text(a.reason); Text(QCText.isolated("\(a.actor_id) · \(a.reference_ids.joined(separator: ", "))")); if let intervention = a.intervention_reason { Text(intervention) } } }
        }
        if model.status?.can.adjudicate == true {
            Section(QCText.t("qc.adjudication")) {
                Picker(QCText.t("qc.outcome"), selection: $outcome) { ForEach(QCAdjudicationOutcome.allCases, id: \.self) { Text(QCText.t("qc.outcome.\($0.rawValue)")).tag($0) } }
                field("qc.reason", $reason); field("qc.references", $references)
                if model.status?.role == "admin" { field("qc.intervention", $intervention) }
                Button(QCText.t("qc.record_review")) { Task { await model.adjudicate(outcome: outcome, reason: reason, references: references, intervention: intervention) } }.disabled(model.busy || reason.isEmpty || (model.status?.role == "admin" && intervention.isEmpty))
            }
        }
    }
    private var capture: some View {
        Section(QCText.t("qc.capture")) {
            Text(QCText.t("qc.capture.guide"))
            Picker(QCText.t("qc.role"), selection: $role) { ForEach(QCCaptureRole.allCases, id: \.self) { Text(QCText.t("qc.role.\($0.rawValue)")).tag($0) } }
            Picker(QCText.t("qc.consent"), selection: $consent) { Text(QCText.t("qc.choose_consent")).tag(""); ForEach(model.authorities.filter { $0.permitsCapture(at: Date()) }) { Text(QCText.isolated($0.id)).tag($0.id) } }
            field("qc.device_profile", $profile)
            Button(QCText.t("qc.camera")) { cameraOpen = true }.frame(minHeight: 48).disabled(model.busy)
            PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .current) { Text(QCText.t("qc.import")) }.frame(minHeight: 48).disabled(model.busy)
            if photosDenied { Text(QCText.t("qc.photos_denied")) }
            Text(QCText.t("qc.import_review"))
            if originalID != nil { Text(QCText.t(originalReview ? "qc.import_review" : "qc.original_ready")) }
            Button(QCText.t("qc.upload")) { if let id = originalID { Task { await model.upload(id: id, role: role, consent: consent, profile: profile); if model.error.isEmpty { originalID = nil } } } }.disabled(model.busy || originalID == nil || consent.isEmpty || profile.isEmpty)
            Button(QCText.t("qc.close_set")) { Task { await model.close() } }.disabled(model.busy || originalID != nil)
            Text(QCText.t("qc.draft_expiry"))
        }
    }
    private func field(_ key: String, _ binding: Binding<String>) -> some View { TextField(QCText.t(key), text: binding).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityLabel(QCText.t(key)) }
    private func retain(_ original: QCOriginal) {
        do {
            guard model.signedIn, let drafts = model.drafts else { throw QCError.unauthenticated }
            if let old = originalID { drafts.remove(id: old) }
            let id = UUID(); try drafts.save(original, id: id); originalID = id; originalReview = original.attestation.isReviewOnly
        } catch { model.error = error.localizedDescription }
    }
}
