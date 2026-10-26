import Foundation

enum MedicalDocumentFileStoreFailure: Error {
    case directoryUnavailable
    case invalidIdentifier
    case fileProtectionUnavailable
    case cleanupFailed
}

/// Keeps imported originals under UUID-only names with device-lock protection and no backup copy.
struct MedicalDocumentFileStore {
    private static let supportedExtensions: Set<String> = ["pdf", "txt"]
    private static let pendingPrefix = ".pending-delete-"
    private let fileManager: FileManager
    private let rootOverride: URL?

    init(fileManager: FileManager = .default, rootDirectory: URL? = nil) {
        self.fileManager = fileManager
        rootOverride = rootDirectory
    }

    func store(data: Data, identifier: String, fileExtension: String) throws {
        let id = try normalizedIdentifier(identifier)
        let ext = try normalizedExtension(fileExtension)
        let destination = try fileURL(id, ext)
        do {
            try data.write(to: destination, options: .atomic)
            try protect(destination)
        } catch MedicalDocumentFileStoreFailure.fileProtectionUnavailable {
            try? fileManager.removeItem(at: destination)
            throw MedicalDocumentFileStoreFailure.fileProtectionUnavailable
        } catch {
            try? fileManager.removeItem(at: destination)
            throw error
        }
    }

    func stage(_ sourceID: String) throws {
        let id = try normalizedIdentifier(sourceID)
        let originals = try permanentFiles(for: id)
        var staged: [(pending: URL, original: URL)] = []
        do {
            for original in originals {
                let pending = try pendingURL(id, original.pathExtension)
                guard !fileManager.fileExists(atPath: pending.path) else {
                    throw MedicalDocumentFileStoreFailure.cleanupFailed
                }
                try fileManager.moveItem(at: original, to: pending)
                do {
                    try protect(pending)
                } catch {
                    try? fileManager.moveItem(at: pending, to: original)
                    throw error
                }
                staged.append((pending, original))
            }
        } catch {
            for item in staged.reversed() {
                try? fileManager.moveItem(at: item.pending, to: item.original)
                try? protect(item.original)
            }
            throw error
        }
    }

    func restore(_ sourceID: String) throws {
        let id = try normalizedIdentifier(sourceID)
        for pending in try stagedFiles(for: id) {
            let original = try fileURL(id, pending.pathExtension)
            guard !fileManager.fileExists(atPath: original.path) else {
                throw MedicalDocumentFileStoreFailure.cleanupFailed
            }
            try fileManager.moveItem(at: pending, to: original)
            do {
                try protect(original)
            } catch {
                try? fileManager.moveItem(at: original, to: pending)
                throw error
            }
        }
    }

    func commit(_ sourceID: String) throws {
        let id = try normalizedIdentifier(sourceID)
        for pending in try stagedFiles(for: id) {
            do {
                try fileManager.removeItem(at: pending)
            } catch {
                throw MedicalDocumentFileStoreFailure.cleanupFailed
            }
        }
    }

    func discard(_ sourceID: String) throws {
        let id = try normalizedIdentifier(sourceID)
        for file in try permanentFiles(for: id) + stagedFiles(for: id) {
            do {
                try fileManager.removeItem(at: file)
            } catch {
                throw MedicalDocumentFileStoreFailure.cleanupFailed
            }
        }
    }

    /// Restores files that still have database rows and removes staged or unreferenced originals after a crash.
    func reconcile(sourceIDs: [String]) throws {
        let retained = try Set(sourceIDs.map(normalizedIdentifier))
        let root = try directory()
        let entries = try fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [],
        )
        for entry in entries {
            if let (id, _) = stagedIdentity(entry) {
                if retained.contains(id) {
                    try restore(id)
                } else {
                    try remove(entry)
                }
            } else if let (id, _) = permanentIdentity(entry), !retained.contains(id) {
                try remove(entry)
            }
        }
    }

    private func fileURL(_ identifier: String, _ fileExtension: String) throws -> URL {
        try directory().appendingPathComponent("\(identifier).\(fileExtension)")
    }

    private func pendingURL(_ identifier: String, _ fileExtension: String) throws -> URL {
        try directory().appendingPathComponent("\(Self.pendingPrefix)\(identifier).\(fileExtension)")
    }

    private func directory() throws -> URL {
        let url: URL
        if let rootOverride {
            url = rootOverride
        } else {
            guard let support = fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
            ).first else {
                throw MedicalDocumentFileStoreFailure.directoryUnavailable
            }
            url = support.appendingPathComponent("MedicalDocuments", isDirectory: true)
        }
        do {
            try fileManager.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete],
            )
            try protect(url)
            return url
        } catch {
            throw MedicalDocumentFileStoreFailure.fileProtectionUnavailable
        }
    }

    private func protect(_ url: URL) throws {
        do {
            try fileManager.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: url.path,
            )
            var mutableURL = url
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try mutableURL.setResourceValues(values)

            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            let isProtected = (attributes[.protectionKey] as? FileProtectionType) == .complete
            let isExcluded = try url.resourceValues(
                forKeys: [.isExcludedFromBackupKey],
            ).isExcludedFromBackup == true
            guard isProtected, isExcluded else {
                throw MedicalDocumentFileStoreFailure.fileProtectionUnavailable
            }
        } catch {
            throw MedicalDocumentFileStoreFailure.fileProtectionUnavailable
        }
    }

    private func permanentFiles(for id: String) throws -> [URL] {
        try Self.supportedExtensions
            .map { try fileURL(id, $0) }
            .filter { fileManager.fileExists(atPath: $0.path) }
    }

    private func stagedFiles(for id: String) throws -> [URL] {
        try Self.supportedExtensions
            .map { try pendingURL(id, $0) }
            .filter { fileManager.fileExists(atPath: $0.path) }
    }

    private func normalizedIdentifier(_ value: String) throws -> String {
        guard let id = UUID(uuidString: value) else {
            throw MedicalDocumentFileStoreFailure.invalidIdentifier
        }
        return id.uuidString.lowercased()
    }

    private func normalizedExtension(_ value: String) throws -> String {
        let ext = value.lowercased()
        guard Self.supportedExtensions.contains(ext) else {
            throw MedicalDocumentFileStoreFailure.invalidIdentifier
        }
        return ext
    }

    private func permanentIdentity(_ url: URL) -> (String, String)? {
        let ext = url.pathExtension.lowercased()
        guard Self.supportedExtensions.contains(ext),
              let id = UUID(uuidString: url.deletingPathExtension().lastPathComponent)
        else { return nil }
        return (id.uuidString.lowercased(), ext)
    }

    private func stagedIdentity(_ url: URL) -> (String, String)? {
        let ext = url.pathExtension.lowercased()
        let name = url.deletingPathExtension().lastPathComponent
        guard Self.supportedExtensions.contains(ext),
              name.hasPrefix(Self.pendingPrefix),
              let id = UUID(uuidString: String(name.dropFirst(Self.pendingPrefix.count)))
        else { return nil }
        return (id.uuidString.lowercased(), ext)
    }

    private func remove(_ url: URL) throws {
        do {
            try fileManager.removeItem(at: url)
        } catch {
            throw MedicalDocumentFileStoreFailure.cleanupFailed
        }
    }
}
