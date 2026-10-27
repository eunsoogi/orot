import Foundation
@testable import Orot
import XCTest

/// Verifies recovery preserves a retained original before duplicate cleanup can run.
final class MedicalDocumentFileOperationsTests: XCTestCase {
    func testDuplicateSourceRecoveryRestoresMissingCanonicalOriginal() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let retainedID = UUID().uuidString.lowercased()
        let stagedID = UUID().uuidString.lowercased()
        let bytes = Data("Synthetic restored original".utf8)
        let expectedHash = try contentHash(bytes)
        try store.store(data: bytes, identifier: stagedID, fileExtension: "txt")

        try store.ensureOriginal(
            retainedSourceID: retainedID,
            stagedSourceID: stagedID,
            expectedContentHash: expectedHash,
        )

        let retained = root.appendingPathComponent("\(retainedID).txt")
        XCTAssertEqual(try Data(contentsOf: retained), bytes)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(stagedID).txt")), bytes)
        XCTAssertEqual(
            try FileManager.default.attributesOfItem(atPath: retained.path)[.protectionKey] as? FileProtectionType,
            .complete,
        )
        XCTAssertTrue(try retained.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }

    func testDuplicateSourceRecoveryDoesNotReplaceCanonicalOriginal() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let retainedID = UUID().uuidString.lowercased()
        let stagedID = UUID().uuidString.lowercased()
        let original = Data("Synthetic retained bytes".utf8)
        let candidate = Data("Synthetic candidate bytes".utf8)
        try store.store(data: original, identifier: retainedID, fileExtension: "txt")
        try store.store(data: candidate, identifier: stagedID, fileExtension: "txt")

        try store.ensureOriginal(
            retainedSourceID: retainedID,
            stagedSourceID: stagedID,
            expectedContentHash: contentHash(original),
        )

        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(retainedID).txt")), original)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(stagedID).txt")), candidate)
    }

    func testDuplicateSourceRecoveryIsIdempotentForSameID() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let retainedID = UUID().uuidString.lowercased()
        let bytes = Data("Synthetic same-id original".utf8)
        try store.store(data: bytes, identifier: retainedID, fileExtension: "txt")
        let expectedHash = try contentHash(bytes)

        try store.ensureOriginal(
            retainedSourceID: retainedID,
            stagedSourceID: retainedID,
            expectedContentHash: expectedHash,
        )
        try store.ensureOriginal(
            retainedSourceID: retainedID,
            stagedSourceID: retainedID,
            expectedContentHash: expectedHash,
        )

        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(retainedID).txt")), bytes)
    }

    func testDuplicateSourceRecoveryFailuresKeepCandidateAndCanonicalBytes() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fileManager = FailureInjectingFileManager()
        let store = MedicalDocumentFileStore(fileManager: fileManager, rootDirectory: root)

        let copyRetainedID = UUID().uuidString.lowercased()
        let copyStagedID = UUID().uuidString.lowercased()
        let copyCandidate = Data("Synthetic copy-failure candidate".utf8)
        try store.store(data: copyCandidate, identifier: copyStagedID, fileExtension: "txt")
        fileManager.failRecoveryCopy = true
        XCTAssertThrowsError(
            try store.ensureOriginal(
                retainedSourceID: copyRetainedID,
                stagedSourceID: copyStagedID,
                expectedContentHash: contentHash(copyCandidate),
            ),
        )
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(copyStagedID).txt")), copyCandidate)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("\(copyRetainedID).txt").path))
        fileManager.failRecoveryCopy = false

        let protectedID = UUID().uuidString.lowercased()
        let protectedCandidateID = UUID().uuidString.lowercased()
        let canonicalBytes = Data("Synthetic canonical bytes".utf8)
        let protectedCandidate = Data("Synthetic protected candidate".utf8)
        try store.store(data: canonicalBytes, identifier: protectedID, fileExtension: "txt")
        try store.store(data: protectedCandidate, identifier: protectedCandidateID, fileExtension: "txt")
        fileManager.failProtectionPath = root.appendingPathComponent("\(protectedID).txt").path
        XCTAssertThrowsError(
            try store.ensureOriginal(
                retainedSourceID: protectedID,
                stagedSourceID: protectedCandidateID,
                expectedContentHash: contentHash(canonicalBytes),
            ),
        )
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(protectedID).txt")), canonicalBytes)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(protectedCandidateID).txt")), protectedCandidate)
        fileManager.failProtectionPath = nil

        let installRetainedID = UUID().uuidString.lowercased()
        let installStagedID = UUID().uuidString.lowercased()
        let installCandidate = Data("Synthetic install-failure candidate".utf8)
        try store.store(data: installCandidate, identifier: installStagedID, fileExtension: "txt")
        fileManager.failInstallationPath = root.appendingPathComponent("\(installRetainedID).txt").path
        XCTAssertThrowsError(
            try store.ensureOriginal(
                retainedSourceID: installRetainedID,
                stagedSourceID: installStagedID,
                expectedContentHash: contentHash(installCandidate),
            ),
        )
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(installStagedID).txt")), installCandidate)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("\(installRetainedID).txt").path))
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: root.path).contains { $0.hasPrefix(".recovery-") })
    }

    func testDuplicateSourceRecoveryRejectsCandidateHashMismatch() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let retainedID = UUID().uuidString.lowercased()
        let stagedID = UUID().uuidString.lowercased()
        let candidate = Data("Synthetic mismatched candidate".utf8)
        try store.store(data: candidate, identifier: stagedID, fileExtension: "txt")

        XCTAssertThrowsError(
            try store.ensureOriginal(
                retainedSourceID: retainedID,
                stagedSourceID: stagedID,
                expectedContentHash: contentHash(Data("Synthetic expected original".utf8)),
            ),
        )

        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(stagedID).txt")), candidate)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("\(retainedID).txt").path))
    }

    private func contentHash(_ data: Data) throws -> String {
        try MedicalDocumentTextExtractor.extract(data: data, fileExtension: "txt").contentHash
    }

    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-operations-\(UUID().uuidString)", isDirectory: true)
    }
}

private final class FailureInjectingFileManager: FileManager {
    var failRecoveryCopy = false
    var failProtectionPath: String?
    var failInstallationPath: String?

    override func copyItem(at sourceURL: URL, to destinationURL: URL) throws {
        if failRecoveryCopy, destinationURL.lastPathComponent.hasPrefix(".recovery-") {
            throw CocoaError(.fileWriteUnknown)
        }
        try super.copyItem(at: sourceURL, to: destinationURL)
    }

    override func setAttributes(
        _ attributes: [FileAttributeKey: Any]?,
        ofItemAtPath path: String,
    ) throws {
        if path == failProtectionPath {
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.setAttributes(attributes, ofItemAtPath: path)
    }

    override func moveItem(at sourceURL: URL, to destinationURL: URL) throws {
        if destinationURL.path == failInstallationPath {
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.moveItem(at: sourceURL, to: destinationURL)
    }
}
