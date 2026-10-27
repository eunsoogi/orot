import CryptoKit
import Foundation
import PDFKit

struct MedicalDocumentTextSection {
    let id: String
    let text: String
    let pageNumber: Int?
    let startOffset: Int
    let endOffset: Int

    var bridgeValue: [String: Any] {
        var value: [String: Any] = [
            "id": id,
            "text": text,
            "startOffset": startOffset,
            "endOffset": endOffset,
        ]
        if let pageNumber {
            value["pageNumber"] = pageNumber
        }
        return value
    }
}

struct MedicalDocumentExtraction {
    let contentHash: String
    let sections: [MedicalDocumentTextSection]
}

enum MedicalDocumentExtractionFailure: Error {
    case unsupportedDocument
    case unsupportedTextEncoding
    case emptyDocument
    case scannedPDFUnsupported

    var code: String {
        switch self {
        case .unsupportedDocument: "UNSUPPORTED_DOCUMENT"
        case .unsupportedTextEncoding: "UNSUPPORTED_TEXT_ENCODING"
        case .emptyDocument: "EMPTY_DOCUMENT"
        case .scannedPDFUnsupported: "SCANNED_PDF_UNSUPPORTED"
        }
    }
}

enum MedicalDocumentTextExtractor {
    /// Extracts only selectable PDF text or UTF-8 text; offsets are half-open UTF-16 code-unit ranges.
    static func extract(data: Data, fileExtension: String) throws -> MedicalDocumentExtraction {
        let sections: [MedicalDocumentTextSection]
        switch fileExtension.lowercased() {
        case "pdf":
            sections = try extractPDF(data)
        case "txt":
            sections = try extractPlainText(data)
        default:
            throw MedicalDocumentExtractionFailure.unsupportedDocument
        }

        guard !sections.isEmpty else { throw MedicalDocumentExtractionFailure.emptyDocument }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return MedicalDocumentExtraction(contentHash: "sha256:\(digest)", sections: sections)
    }

    private static func extractPlainText(_ data: Data) throws -> [MedicalDocumentTextSection] {
        guard var text = String(data: data, encoding: .utf8) else {
            throw MedicalDocumentExtractionFailure.unsupportedTextEncoding
        }
        if text.first == "\u{FEFF}" {
            text.removeFirst()
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MedicalDocumentExtractionFailure.emptyDocument
        }
        return [section(text: text, pageNumber: nil)]
    }

    private static func extractPDF(_ data: Data) throws -> [MedicalDocumentTextSection] {
        guard let document = PDFDocument(data: data), !document.isLocked else {
            throw MedicalDocumentExtractionFailure.unsupportedDocument
        }
        guard document.pageCount > 0 else {
            throw MedicalDocumentExtractionFailure.scannedPDFUnsupported
        }

        var sections: [MedicalDocumentTextSection] = []
        for index in 0 ..< document.pageCount {
            guard let rawText = document.page(at: index)?.string else {
                throw MedicalDocumentExtractionFailure.scannedPDFUnsupported
            }
            let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
            // Refuse partial imports so image-only pages are not silently omitted from a mixed PDF.
            guard !text.isEmpty else {
                throw MedicalDocumentExtractionFailure.scannedPDFUnsupported
            }
            sections.append(section(text: text, pageNumber: index + 1))
        }
        return sections
    }

    private static func section(
        text: String,
        pageNumber: Int?,
    ) -> MedicalDocumentTextSection {
        MedicalDocumentTextSection(
            id: UUID().uuidString.lowercased(),
            text: text,
            pageNumber: pageNumber,
            startOffset: 0,
            endOffset: text.utf16.count,
        )
    }
}
