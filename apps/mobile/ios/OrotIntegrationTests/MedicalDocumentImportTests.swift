import Foundation
@testable import Orot
import UIKit
import XCTest

/// Exercises local parsing and protected-file recovery with synthetic document bytes only.
final class MedicalDocumentImportTests: XCTestCase {
    func testPlainTextOffsetsUseUtf16CodeUnitsAndHashOriginalBytes() throws {
        let text = "Synthetic note 🌱"
        let data = Data(text.utf8)

        let result = try MedicalDocumentTextExtractor.extract(data: data, fileExtension: "txt")

        XCTAssertEqual(result.sections.count, 1)
        XCTAssertEqual(result.sections[0].text, text)
        XCTAssertNil(result.sections[0].pageNumber)
        XCTAssertEqual(result.sections[0].startOffset, 0)
        XCTAssertEqual(result.sections[0].endOffset, text.utf16.count)
        XCTAssertEqual(result.contentHash.count, "sha256:".count + 64)
    }

    func testPDFExtractionRetainsEachPageNumberAndRejectsImageOnlyPages() throws {
        let result = try MedicalDocumentTextExtractor.extract(
            data: pdfDocument(pages: ["Synthetic first page", "Synthetic second page"]),
            fileExtension: "pdf",
        )

        XCTAssertEqual(result.sections.map(\.pageNumber), [1, 2])
        XCTAssertTrue(result.sections[0].text.contains("Synthetic first page"))
        XCTAssertTrue(result.sections[1].text.contains("Synthetic second page"))
        XCTAssertThrowsError(
            try MedicalDocumentTextExtractor.extract(
                data: imageOnlyPDF(),
                fileExtension: "pdf",
            ),
        ) { error in
            XCTAssertEqual(
                (error as? MedicalDocumentExtractionFailure)?.code,
                "SCANNED_PDF_UNSUPPORTED",
            )
        }
    }

    func testPlainTextRejectsUnsupportedEncodingAndEmptyContent() {
        XCTAssertThrowsError(
            try MedicalDocumentTextExtractor.extract(data: Data([0xFF, 0xFE]), fileExtension: "txt"),
        ) { error in
            XCTAssertEqual(
                (error as? MedicalDocumentExtractionFailure)?.code,
                "UNSUPPORTED_TEXT_ENCODING",
            )
        }
        XCTAssertThrowsError(
            try MedicalDocumentTextExtractor.extract(data: Data(" \n".utf8), fileExtension: "txt"),
        ) { error in
            XCTAssertEqual((error as? MedicalDocumentExtractionFailure)?.code, "EMPTY_DOCUMENT")
        }
    }

    func testCoordinatedSourceReadReturnsSelectedFileBytes() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-coordinated-read-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("provider-note.txt")
        let bytes = Data("Synthetic provider-backed note".utf8)
        try bytes.write(to: url)

        XCTAssertEqual(try MedicalDocumentCoordinatedFileReader.read(at: url), bytes)
    }

    func testCoordinatedSourceReadUsesProviderAccessorURL() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-accessor-read-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let selectedURL = root.appendingPathComponent("selected-name.txt")
        let accessorURL = root.appendingPathComponent("materialized-name.txt")
        let selectedBytes = Data("Synthetic selected URL".utf8)
        let accessorBytes = Data("Synthetic coordinated accessor".utf8)
        try selectedBytes.write(to: selectedURL)
        try accessorBytes.write(to: accessorURL)

        let bytes = try MedicalDocumentCoordinatedFileReader.read(
            at: selectedURL,
            coordinator: RedirectingFileCoordinator(accessorURL: accessorURL),
        )

        XCTAssertEqual(bytes, accessorBytes)
    }

    func testCoordinatedSourceReadRejectsCoordinatorAndAccessorFailures() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-coordinated-failure-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let selectedURL = root.appendingPathComponent("selected-name.txt")
        let missingAccessorURL = root.appendingPathComponent("missing-materialized-file.txt")

        XCTAssertThrowsError(
            try MedicalDocumentCoordinatedFileReader.read(
                at: selectedURL,
                coordinator: RejectingFileCoordinator(),
            ),
        )
        XCTAssertThrowsError(
            try MedicalDocumentCoordinatedFileReader.read(
                at: selectedURL,
                coordinator: NoAccessorFileCoordinator(),
            ),
        )
        XCTAssertThrowsError(
            try MedicalDocumentCoordinatedFileReader.read(
                at: selectedURL,
                coordinator: RedirectingFileCoordinator(accessorURL: missingAccessorURL),
            ),
        )
    }

    func testSecurityScopedReadBalancesAccessAroundCoordinatedSnapshot() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-scope-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("SyntheticProviderDocument.txt")
        let bytes = Data("Synthetic provider document".utf8)
        try bytes.write(to: url)
        var isActive = false
        var didCoordinate = false
        var startCount = 0
        var stopCount = 0
        let access = MedicalDocumentSecurityScopeAccess(
            start: { _ in
                startCount += 1
                isActive = true
                return true
            },
            stop: { _ in
                stopCount += 1
                isActive = false
            },
        )
        let coordinator = RedirectingFileCoordinator(
            accessorURL: url,
            onCoordinate: {
                didCoordinate = true
                XCTAssertTrue(isActive)
            },
        )

        XCTAssertEqual(try MedicalDocumentScopedFileReader.read(at: url, access: access, coordinator: coordinator), bytes)
        XCTAssertTrue(didCoordinate)
        XCTAssertFalse(isActive)
        XCTAssertEqual(startCount, 1)
        XCTAssertEqual(stopCount, 1)
        didCoordinate = false
        let deniedAccess = MedicalDocumentSecurityScopeAccess(
            start: { _ in false },
            stop: { _ in XCTFail("Denied file access must not be stopped.") },
        )
        XCTAssertThrowsError(
            try MedicalDocumentScopedFileReader.read(at: url, access: deniedAccess, coordinator: coordinator),
        )
        XCTAssertFalse(didCoordinate)
        XCTAssertThrowsError(
            try MedicalDocumentScopedFileReader.read(at: url, access: access, coordinator: RejectingFileCoordinator()),
        )
        XCTAssertFalse(isActive)
        XCTAssertEqual(startCount, 2)
        XCTAssertEqual(stopCount, 2)
    }

    func testProtectedOriginalSupportsRestoreCommitAndOrphanReconciliation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-test-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let retainedID = UUID().uuidString.lowercased()
        let orphanID = UUID().uuidString.lowercased()
        let data = Data("Synthetic protected document".utf8)

        try store.store(data: data, identifier: retainedID, fileExtension: "txt")
        try store.store(data: data, identifier: orphanID, fileExtension: "txt")
        let original = root.appendingPathComponent("\(retainedID).txt")
        let attributes = try FileManager.default.attributesOfItem(atPath: original.path)
        XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .complete)
        XCTAssertTrue(try original.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)

        try store.stage(retainedID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: original.path))
        try store.restore(retainedID)
        XCTAssertEqual(try Data(contentsOf: original), data)
        try store.stage(retainedID)
        try store.commit(retainedID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".pending-delete-\(retainedID).txt").path))

        try store.reconcile(sourceIDs: [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("\(orphanID).txt").path))
    }

    private func pdfDocument(pages: [String]) -> Data {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        return UIGraphicsPDFRenderer(bounds: bounds).pdfData { renderer in
            for page in pages {
                renderer.beginPage()
                page.draw(
                    at: CGPoint(x: 30, y: 40),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 14)],
                )
            }
        }
    }

    private func imageOnlyPDF() -> Data {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let image = UIGraphicsImageRenderer(size: bounds.size).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: bounds.size))
            ("Synthetic scanned page" as NSString).draw(
                at: CGPoint(x: 30, y: 40),
                withAttributes: [.font: UIFont.systemFont(ofSize: 14)],
            )
        }
        return UIGraphicsPDFRenderer(bounds: bounds).pdfData { renderer in
            renderer.beginPage()
            image.draw(in: bounds)
        }
    }
}

private struct RedirectingFileCoordinator: MedicalDocumentFileCoordination {
    let accessorURL: URL
    var onCoordinate: (() -> Void)?

    func coordinateRead(at _: URL, accessor: (URL) -> Void) throws {
        onCoordinate?()
        accessor(accessorURL)
    }
}

private struct RejectingFileCoordinator: MedicalDocumentFileCoordination {
    func coordinateRead(at _: URL, accessor _: (URL) -> Void) throws {
        throw CocoaError(.fileReadNoPermission)
    }
}

private struct NoAccessorFileCoordinator: MedicalDocumentFileCoordination {
    func coordinateRead(at _: URL, accessor _: (URL) -> Void) throws {}
}
