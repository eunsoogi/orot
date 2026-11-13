import CryptoKit
import Foundation

enum MedicalDocumentFileOperationsFailure: Error {
    case coordinatedReadUnavailable
    case securityScopeUnavailable
}

/// Lets local tests exercise a provider's remapped accessor URL without selecting a real cloud document.
protocol MedicalDocumentFileCoordination {
    func coordinateRead(at url: URL, accessor: (URL) -> Void) throws
}

struct SystemMedicalDocumentFileCoordination: MedicalDocumentFileCoordination {
    func coordinateRead(at url: URL, accessor: (URL) -> Void) throws {
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinationError: NSError?
        var didCoordinate = false
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            didCoordinate = true
            accessor(coordinatedURL)
        }
        if let coordinationError {
            throw coordinationError
        }
        guard didCoordinate else {
            throw MedicalDocumentFileOperationsFailure.coordinatedReadUnavailable
        }
    }
}

struct MedicalDocumentSecurityScopeAccess {
    let start: (URL) -> Bool
    let stop: (URL) -> Void

    static let system = Self(
        start: { $0.startAccessingSecurityScopedResource() },
        stop: { $0.stopAccessingSecurityScopedResource() },
    )
}

/// Reads provider-owned URLs inside the file-coordination access window.
enum MedicalDocumentCoordinatedFileReader {
    static func read(
        at url: URL,
        coordinator: MedicalDocumentFileCoordination = SystemMedicalDocumentFileCoordination(),
    ) throws -> Data {
        var readResult: Result<Data, Error>?
        try coordinator.coordinateRead(at: url) { coordinatedURL in
            // File providers may substitute the URL they materialize for this read.
            readResult = Result { try Data(contentsOf: coordinatedURL) }
        }
        guard let readResult else {
            throw MedicalDocumentFileOperationsFailure.coordinatedReadUnavailable
        }
        return try readResult.get()
    }
}

enum MedicalDocumentScopedFileReader {
    static func read(
        at url: URL,
        access: MedicalDocumentSecurityScopeAccess = .system,
        coordinator: MedicalDocumentFileCoordination = SystemMedicalDocumentFileCoordination(),
    ) throws -> Data {
        guard access.start(url) else {
            throw MedicalDocumentFileOperationsFailure.securityScopeUnavailable
        }
        defer { access.stop(url) }

        // After the coordinated snapshot is in memory, parsing no longer needs provider access.
        return try MedicalDocumentCoordinatedFileReader.read(at: url, coordinator: coordinator)
    }
}

extension MedicalDocumentFileStore {
    /// Resolves one image by its persisted source UUID and verifies its saved byte identity.
    /// The bridge returns image bytes only; the protected directory path never leaves native code.
    func originalPhoto(sourceID: String, expectedContentHash: String?) throws -> [String: String] {
        let id: String
        do {
            id = try normalizedIdentifier(sourceID)
        } catch {
            // A malformed persisted identity cannot safely select any protected original.
            throw MedicalDocumentFileStoreFailure.corruptOriginal
        }
        let root: URL
        do {
            root = try directory()
        } catch {
            // A locked or otherwise inaccessible protected directory is recoverable on a later open.
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }

        let names: [String]
        do {
            names = try fileManager.contentsOfDirectory(atPath: root.path)
        } catch {
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }
        let expectedNames = Set(Self.supportedExtensions.map { "\(id).\($0)" })
        let matchingNames = names.filter(expectedNames.contains)
        guard !matchingNames.isEmpty else {
            throw MedicalDocumentFileStoreFailure.originalMissing
        }
        guard matchingNames.count == 1, let name = matchingNames.first else {
            // Multiple files under one source identity are ambiguous, not a retryable lock state.
            throw MedicalDocumentFileStoreFailure.corruptOriginal
        }

        let fileExtension = URL(fileURLWithPath: name).pathExtension.lowercased()
        let mimeType: String
        switch fileExtension {
        case "jpg": mimeType = "image/jpeg"
        case "heic": mimeType = "image/heic"
        case "png": mimeType = "image/png"
        case "pdf", "txt": throw MedicalDocumentFileStoreFailure.unsupportedOriginal
        default: throw MedicalDocumentFileStoreFailure.unsupportedOriginal
        }

        let data: Data
        do {
            data = try Data(contentsOf: root.appendingPathComponent(name), options: .mappedIfSafe)
        } catch {
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }
        guard let expectedContentHash,
              Self.contentHash(data) == expectedContentHash
        else {
            throw MedicalDocumentFileStoreFailure.corruptOriginal
        }

        return [
            "sourceId": id,
            "mimeType": mimeType,
            "base64Data": data.base64EncodedString(),
        ]
    }

    /// Repairs database restores where the provenance row survived but its excluded original did not.
    func ensureOriginal(
        retainedSourceID: String,
        stagedSourceID: String,
        expectedContentHash: String,
    ) throws {
        let retainedID = try normalizedIdentifier(retainedSourceID)
        let stagedID = try normalizedIdentifier(stagedSourceID)

        let retainedFiles = try permanentFiles(for: retainedID)
        if let retainedFile = try retainedFiles.first(where: {
            try Self.contentHash(Data(contentsOf: $0)) == expectedContentHash
        }) {
            try protect(retainedFile)
            return
        }
        guard retainedFiles.isEmpty else {
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }

        let stagedFiles = try permanentFiles(for: stagedID)
        guard retainedID != stagedID,
              stagedFiles.count == 1,
              let stagedFile = stagedFiles.first
        else {
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }
        let stagedData = try Data(contentsOf: stagedFile)
        guard Self.contentHash(stagedData) == expectedContentHash else {
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }

        let retainedFile = try fileURL(retainedID, stagedFile.pathExtension)
        let recoveryFile = try directory().appendingPathComponent(
            "\(Self.recoveryPrefix)\(UUID().uuidString.lowercased()).\(stagedFile.pathExtension)",
        )
        defer { try? fileManager.removeItem(at: recoveryFile) }

        do {
            try fileManager.copyItem(at: stagedFile, to: recoveryFile)
            try protect(recoveryFile)
            guard try Self.contentHash(Data(contentsOf: recoveryFile)) == expectedContentHash else {
                throw MedicalDocumentFileStoreFailure.originalUnavailable
            }
            try fileManager.moveItem(at: recoveryFile, to: retainedFile)
        } catch {
            let concurrentOriginals = try permanentFiles(for: retainedID)
            if let matchingOriginal = try concurrentOriginals.first(where: {
                try Self.contentHash(Data(contentsOf: $0)) == expectedContentHash
            }) {
                try protect(matchingOriginal)
                return
            }
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }

        do {
            try protect(retainedFile)
            guard try Self.contentHash(Data(contentsOf: retainedFile)) == expectedContentHash else {
                throw MedicalDocumentFileStoreFailure.originalUnavailable
            }
        } catch {
            try? fileManager.removeItem(at: retainedFile)
            throw MedicalDocumentFileStoreFailure.originalUnavailable
        }
    }

    private static func contentHash(_ data: Data) -> String {
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return "sha256:\(digest)"
    }
}
