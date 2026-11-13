import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import Photos
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// No image transformations: the upload and draft contain exactly the encoded camera/picker bytes.
enum QCCrypto { static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() } }
enum QCAccess: String, Equatable {
    case ready, cameraDenied, photosDenied, cameraUnavailable
    static func camera(authorized: Bool) -> Self { authorized ? .ready : .cameraDenied }
    static func photos(authorized: Bool) -> Self { authorized ? .ready : .photosDenied }
}
enum QCCaptureError: String, Error, LocalizedError {
    case heic, unsupported, tooLarge, expired, unavailable
    var errorDescription: String? { QCText.t("qc.capture.\(rawValue)") }
}
struct QCOriginal: Codable {
    let data: Data
    let mediaType: QCMediaType
    var attestation: QCAcquisitionAttestation
    init(data: Data, mode: QCCaptureMode, observed: QCAcquisitionAttestation? = nil) throws {
        guard data.count <= QCLimits.maxOriginalBytes else { throw QCCaptureError.tooLarge }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) == 1,
              let type = CGImageSourceGetType(source) as String?,
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let width = props[kCGImagePropertyPixelWidth as String] as? Int,
              let height = props[kCGImagePropertyPixelHeight as String] as? Int else { throw QCCaptureError.unsupported }
        if [UTType.heic.identifier, UTType.heif.identifier].contains(type) { throw QCCaptureError.heic }
        switch type {
        case UTType.jpeg.identifier: mediaType = .jpeg
        case UTType.png.identifier: mediaType = .png
        case UTType.webP.identifier: mediaType = .webp
        default: throw QCCaptureError.unsupported
        }
        guard width > 0, height > 0, width * height <= QCLimits.maxDecodedPixels else { throw QCCaptureError.tooLarge }
        self.data = data
        attestation = observed ?? QCAcquisitionAttestation(image_sha256: QCCrypto.sha256(data), capture_mode: mode, device_model: nil, lens_id: nil, zoom_factor: nil, focus_mode: nil, exposure_mode: nil, resolution: [width, height], orientation: props[kCGImagePropertyOrientation as String] as? Int, processing: nil, captured_at: QCTime.string(Date()))
        attestation.image_sha256 = QCCrypto.sha256(data)
        attestation.capture_mode = mode
        attestation.resolution = [width, height]
        attestation.orientation = props[kCGImagePropertyOrientation as String] as? Int
    }
    static func imported(_ item: PhotosPickerItem) async throws -> Self {
        // PhotosPicker itself gives item-scoped access; it does not require full library permission.
        guard let bytes = try await item.loadTransferable(type: Data.self) else { throw QCCaptureError.unavailable }
        return try Self(data: bytes, mode: .IMPORTED)
    }
}

/// OS-protected originals and attestation. Nothing goes to UserDefaults. Account invalidation
/// purges the entire queue before any new account can upload. Expiry is checked on every read.
final class QCDraftStore: @unchecked Sendable {
    let root: URL
    private let lock = NSRecursiveLock()
    init(root: URL? = nil) throws {
        self.root = try root ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("QCOriginalDrafts", isDirectory: true)
        try FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var location = self.root
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try location.setResourceValues(values)
        try expire(now: Date())
    }
    private struct Envelope: Codable { let createdAt: Date; let original: QCOriginal }
    func save(_ original: QCOriginal, id: UUID, now: Date = Date()) throws {
        lock.lock(); defer { lock.unlock() }
        try expire(now: now)
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.fileSizeKey])
        guard files.count < QCLimits.maxOriginalsPerSet,
              try files.reduce(0, { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }) + original.data.count <= QCLimits.maxSetBytes * 4 / 3 + 8192 else { throw QCCaptureError.tooLarge }
        let bytes = try JSONEncoder().encode(Envelope(createdAt: now, original: original))
        try bytes.write(to: root.appendingPathComponent(id.uuidString), options: [.atomic, .completeFileProtection])
    }
    func load(id: UUID, now: Date = Date()) throws -> QCOriginal {
        lock.lock(); defer { lock.unlock() }
        let file = root.appendingPathComponent(id.uuidString)
        guard let bytes = try? Data(contentsOf: file) else { throw QCCaptureError.expired }
        let envelope = try JSONDecoder().decode(Envelope.self, from: bytes)
        guard now.timeIntervalSince(envelope.createdAt) >= 0, now.timeIntervalSince(envelope.createdAt) < QCLimits.draftLifetime else {
            try FileManager.default.removeItem(at: file); throw QCCaptureError.expired
        }
        guard QCCrypto.sha256(envelope.original.data) == envelope.original.attestation.image_sha256 else { throw QCCaptureError.unsupported }
        return envelope.original
    }
    func expire(now: Date) throws {
        lock.lock(); defer { lock.unlock() }
        for file in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            guard let id = UUID(uuidString: file.lastPathComponent) else { try FileManager.default.removeItem(at: file); continue }
            do { _ = try load(id: id, now: now) } catch { try? FileManager.default.removeItem(at: file) }
        }
    }
    func remove(id: UUID) { lock.lock(); defer { lock.unlock() }; try? FileManager.default.removeItem(at: root.appendingPathComponent(id.uuidString)) }
    func purge() throws {
        lock.lock(); defer { lock.unlock() }
        for file in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: file) }
    }
}

@MainActor @Observable final class QCCamera: NSObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    var access = QCAccess.cameraUnavailable
    var original: QCOriginal?
    var error = ""
    private let output = AVCapturePhotoOutput()
    private var device: AVCaptureDevice?
    private var observed: QCAcquisitionAttestation?
    private let queue = DispatchQueue(label: "com.texpilot.qc.camera")
    func start() async {
        let current = AVCaptureDevice.authorizationStatus(for: .video)
        let allowed: Bool
        if current == .authorized { allowed = true }
        else if current == .notDetermined { allowed = await AVCaptureDevice.requestAccess(for: .video) }
        else { allowed = false }
        access = .camera(authorized: allowed)
        guard allowed else { return }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back), let input = try? AVCaptureDeviceInput(device: device) else { access = .cameraUnavailable; return }
        guard session.inputs.isEmpty else { return }
        session.beginConfiguration()
        // The server's 16 MP limit is enforced on encoded dimensions; no downsampling occurs.
        session.sessionPreset = .photo
        guard session.canAddInput(input), session.canAddOutput(output) else { session.commitConfiguration(); access = .cameraUnavailable; return }
        session.addInput(input); session.addOutput(output); session.commitConfiguration()
        self.device = device; access = .ready
        let session = session
        queue.async { session.startRunning() }
    }
    func stop() { let session = session; queue.async { session.stopRunning() } }
    func capture() {
        guard let device, access == .ready else { return }
        observed = QCAcquisitionAttestation(image_sha256: "", capture_mode: .NATIVE_CAMERA, device_model: Self.hardwareModel, lens_id: device.uniqueID, zoom_factor: Double(device.videoZoomFactor), focus_mode: String(describing: device.focusMode), exposure_mode: String(describing: device.exposureMode), resolution: nil, orientation: nil, processing: "AVCapturePhotoOutput JPEG; device processing", captured_at: QCTime.string(Date()))
        let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        output.capturePhoto(with: settings, delegate: self)
    }
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let bytes = photo.fileDataRepresentation()
        Task { @MainActor in
            guard error == nil, let bytes else { self.error = QCText.t("qc.capture.unavailable"); return }
            do { original = try QCOriginal(data: bytes, mode: .NATIVE_CAMERA, observed: observed) }
            catch { self.error = error.localizedDescription }
        }
    }
    static var hardwareModel: String { var sys = utsname(); uname(&sys); return withUnsafePointer(to: &sys.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } } }
}
struct QCCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    final class Preview: UIView { override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self } }
    func makeUIView(context: Context) -> Preview { let v = Preview(); (v.layer as? AVCaptureVideoPreviewLayer)?.session = session; (v.layer as? AVCaptureVideoPreviewLayer)?.videoGravity = .resizeAspect; return v }
    func updateUIView(_ view: Preview, context: Context) {}
}
