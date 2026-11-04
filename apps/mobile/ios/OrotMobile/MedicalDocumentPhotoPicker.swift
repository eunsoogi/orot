import CryptoKit
import ImageIO
import PhotosUI
import UniformTypeIdentifiers
import Vision

/// Reads only the photo explicitly selected in the system picker; no library access is requested.
final class MedicalDocumentPhotoPicker: NSObject, PHPickerViewControllerDelegate {
    private let fileStore = MedicalDocumentFileStore()
    private var completion: ((Result<[String: Any]?, Error>) -> Void)?
    var isActive: Bool { completion != nil }

    func present(from presenter: UIViewController, completion: @escaping (Result<[String: Any]?, Error>) -> Void) {
        self.completion = completion
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        configuration.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        presenter.present(picker, animated: true) {
            if picker.presentingViewController !== presenter {
                self.finish(.failure(MedicalDocumentExtractionFailure.unsupportedDocument))
            }
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let result = results.first else {
            finish(.success(nil))
            return
        }
        // The provider URL is temporary and valid only during its callback; never retain it.
        result.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
            do {
                guard let self else { return }
                if let error { throw error }
                guard let url else { throw CocoaError(.fileReadUnknown) }
                let data = try Data(contentsOf: url)
                let document = try self.extractAndStore(data)
                DispatchQueue.main.async { self.finish(.success(document)) }
            } catch {
                DispatchQueue.main.async { self?.finish(.failure(error)) }
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

    private func finish(_ result: Result<[String: Any]?, Error>) {
        let callback = completion
        completion = nil
        callback?(result)
    }
}
