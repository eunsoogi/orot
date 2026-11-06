import CryptoKit
import ImageIO
import PhotosUI
import UniformTypeIdentifiers
import Vision

/// Serializes one picker request and rejects late callbacks from retired requests.
/// UIKit callbacks run on the main queue; provider results return there before changing state.
final class MedicalDocumentPhotoPickerCompletion {
    typealias Outcome = Result<[String: Any]?, Error>
    private final class Request {
        let id = UUID()
        let callback: (Outcome) -> Void
        var processing = false
        var dismissed = false
        var outcome: Outcome?

        init(callback: @escaping (Outcome) -> Void) {
            self.callback = callback
        }
    }

    private var active: Request?
    var isActive: Bool {
        active != nil
    }

    func start(_ callback: @escaping (Outcome) -> Void) -> UUID? {
        guard active == nil else { return nil }
        let request = Request(callback: callback)
        active = request
        return request.id
    }

    func beginSelection(_ id: UUID) -> Bool {
        guard let request = active, request.id == id, !request.processing else { return false }
        request.processing = true
        return true
    }

    func interactiveDismiss(_ id: UUID) {
        guard let request = active, request.id == id, !request.processing else { return }
        finish(request, .success(nil))
    }

    func presentationFailed(_ id: UUID, error: Error) {
        guard let request = active, request.id == id, !request.processing else { return }
        finish(request, .failure(error))
    }

    func dismissed(_ id: UUID) {
        guard let request = active, request.id == id, request.processing else { return }
        request.dismissed = true
        finishWhenReady(request)
    }

    func resolved(_ id: UUID, _ outcome: Outcome) {
        guard let request = active, request.id == id, request.processing, request.outcome == nil else { return }
        request.outcome = outcome
        finishWhenReady(request)
    }

    private func finishWhenReady(_ request: Request) {
        guard request.dismissed, let outcome = request.outcome else { return }
        finish(request, outcome)
    }

    private func finish(_ request: Request, _ outcome: Outcome) {
        // Clear ownership before invoking JS so a new request cannot be retired by this callback.
        guard active === request else { return }
        active = nil
        request.callback(outcome)
    }
}

/// Reads only the photo explicitly selected in the system picker; no library access is requested.
final class MedicalDocumentPhotoPicker: NSObject, PHPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    private let fileStore = MedicalDocumentFileStore()
    private let requests = MedicalDocumentPhotoPickerCompletion()
    private var activePicker: PHPickerViewController?
    private var activeID: UUID?
    var isActive: Bool {
        requests.isActive
    }

    func present(from presenter: UIViewController, completion: @escaping (Result<[String: Any]?, Error>) -> Void) {
        guard let id = requests.start({ [weak self] result in
            self?.activePicker = nil
            self?.activeID = nil
            completion(result)
        }) else {
            completion(.failure(MedicalDocumentExtractionFailure.unsupportedDocument))
            return
        }
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        configuration.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        activePicker = picker
        activeID = id
        presenter.present(picker, animated: true) {
            if picker.presentingViewController !== presenter {
                self.requests.presentationFailed(id, error: MedicalDocumentExtractionFailure.unsupportedDocument)
            }
        }
        // UIKit reports completed interactive dismissals separately from explicit picker results.
        picker.presentationController?.delegate = self
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard let picker = activePicker, presentationController.presentedViewController === picker,
              let id = activeID else { return }
        requests.interactiveDismiss(id)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard picker === activePicker, let id = activeID, requests.beginSelection(id) else { return }
        picker.dismiss(animated: true) { self.requests.dismissed(id) }
        guard let result = results.first else {
            requests.resolved(id, .success(nil))
            return
        }
        // The provider URL is temporary and valid only during its callback; never retain it.
        result.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
            do {
                guard let self else { return }
                if let error {
                    throw error
                }
                guard let url else { throw CocoaError(.fileReadUnknown) }
                let data = try Data(contentsOf: url)
                let document = try extractAndStore(data)
                DispatchQueue.main.async { self.requests.resolved(id, .success(document)) }
            } catch {
                DispatchQueue.main.async { self?.requests.resolved(id, .failure(error)) }
            }
        }
    }

    private func extractAndStore(_ data: Data) throws -> [String: Any] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let type = CGImageSourceGetType(source) as String?,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw MedicalDocumentExtractionFailure.unsupportedDocument }
        let ext: String
        switch type {
        case UTType.jpeg.identifier: ext = "jpg"
        case UTType.heic.identifier, UTType.heif.identifier: ext = "heic"
        case UTType.png.identifier: ext = "png"
        default: throw MedicalDocumentExtractionFailure.unsupportedDocument
        }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let rawOrientation = properties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
        let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MedicalDocumentExtractionFailure.emptyDocument
        }
        let identifier = UUID().uuidString.lowercased()
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try fileStore.store(data: data, identifier: identifier, fileExtension: ext)
        // Preview stays in memory during review; the protected original is the persisted copy.
        return [
            "id": identifier,
            "displayName": "사진.\(ext)",
            "contentHash": "sha256:\(hash)",
            "previewData": "data:image/\(ext == "jpg" ? "jpeg" : ext);base64,\(data.base64EncodedString())",
            "sections": [["id": UUID().uuidString.lowercased(), "text": text,
                          "startOffset": 0, "endOffset": text.utf16.count]],
        ]
    }
}
