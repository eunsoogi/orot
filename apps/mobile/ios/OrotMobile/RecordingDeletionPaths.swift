import Foundation

enum RecordingDeletionPaths {
    static let pendingPrefix = ".pending-delete-"
    private static let directoryName = "RecordingDeletionStaging"

    static func directory(
        allowUnverifiedProtectionForSimulator: Bool,
    ) throws -> URL {
        guard let supportDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
        ).first else {
            throw RecordingFileSecurityError.directoryUnavailable
        }

        // Keep recoverable audio backup-eligible on the same volume, outside the permanent UUID-only scan.
        let url = supportDirectory.appendingPathComponent(directoryName, isDirectory: true)
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete],
        )
        _ = try RecordingFileSecurity.protect(
            url,
            allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
        )
        return url
    }

    static func pendingURL(
        recordingID: String,
        fileExtension: String,
        allowUnverifiedProtectionForSimulator: Bool,
    ) throws -> URL {
        try directory(
            allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
        ).appendingPathComponent("\(pendingPrefix)\(recordingID).\(fileExtension)")
    }
}
