import Foundation
@testable import Orot
import XCTest

/// Preserve the exact FileManager assertion when present and verify absent metadata through a fresh URL.
func assertMedicalDocumentCompleteProtection(_ url: URL) throws {
    let raw = try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey]
    if let raw {
        XCTAssertEqual(raw as? FileProtectionType, .complete)
    } else {
        XCTAssertEqual(try URL(fileURLWithPath: url.path).resourceValues(forKeys: [.fileProtectionKey]).fileProtection, .complete)
    }
}

/// Verifies recovery preserves a retained original before duplicate cleanup can run.
final class MedicalDocumentFileOperationsTests: XCTestCase {
    /// Requires actual protected-directory and file readback, including Simulator's URL metadata path.
    func testProtectedSyntheticOriginalUsesCompleteProtectionAndExcludesBackup() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let id = UUID().uuidString.lowercased()
        try store.store(data: Data("Synthetic".utf8), identifier: id, fileExtension: "txt")
        for url in [root, root.appendingPathComponent("\(id).txt")] {
            let values = try url.resourceValues(forKeys: [.fileProtectionKey, .isExcludedFromBackupKey])
            XCTAssertEqual(values.fileProtection, .complete)
            XCTAssertEqual(values.isExcludedFromBackup, true)
        }
    }

    /// A known weaker FileManager value must never enter the missing-metadata fallback.
    func testKnownWeakerProtectionIsRejected() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let manager = FailureInjectingFileManager()
        manager.reportWeakerProtection = true
        XCTAssertThrowsError(try MedicalDocumentFileStore(fileManager: manager, rootDirectory: root).protect(root))
    }

    func testDuplicateSourceRecoveryRestoresMissingCanonicalOriginal() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
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
        let protection = try FileManager.default.attributesOfItem(atPath: retained.path)[.protectionKey]
        if let protection {
            XCTAssertEqual(protection as? FileProtectionType, .complete)
        } else {
            // Simulator can omit FileManager metadata; require a fresh, exact URL value instead.
            let freshURL = URL(fileURLWithPath: retained.path)
            XCTAssertEqual(try freshURL.resourceValues(forKeys: [.fileProtectionKey]).fileProtection, .complete)
        }
        XCTAssertTrue(try retained.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }

    func testDuplicateSourceRecoveryDoesNotReplaceCanonicalOriginal() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
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
        try requireMedicalDocumentProtectionSupport(root)
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
        try requireMedicalDocumentProtectionSupport(root)
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
        try requireMedicalDocumentProtectionSupport(root)
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
    var reportWeakerProtection = false
    var failRecoveryCopy = false
    var failProtectionPath: String?
    var failInstallationPath: String?

    override func attributesOfItem(atPath path: String) throws -> [FileAttributeKey: Any] {
        var attributes = try super.attributesOfItem(atPath: path)
        if reportWeakerProtection {
            attributes[.protectionKey] = FileProtectionType.none
        }
        return attributes
    }

    override func copyItem(at sourceURL: URL, to destinationURL: URL) throws {
        if failRecoveryCopy, destinationURL.lastPathComponent.hasPrefix(".recovery-") {
            throw CocoaError(.fileWriteUnknown)
        }
        try super.copyItem(at: sourceURL, to: destinationURL)
    }

    /// Mirrors FileManager's required attributes type and injects failure only for the selected path.
    override func setAttributes(
        _ attributes: [FileAttributeKey: Any],
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
