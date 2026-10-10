import AVFoundation
import Foundation

enum RecordingFileSecurity {
    private static let directoryName = "Recordings"

    static func directory(allowUnverifiedProtectionForSimulator: Bool = false) throws -> URL {
        guard let supportDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
        ).first else {
            throw RecordingFileSecurityError.directoryUnavailable
        }

        let url = supportDirectory.appendingPathComponent(directoryName, isDirectory: true)
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete],
        )
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: url.path,
        )
        try RecordingBackupEligibility.prepareDirectoryAndFiles(url)
        _ = try verify(url, allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator)
        return url
    }

    static func fileURL(
        id: String,
        extension fileExtension: String,
        allowUnverifiedProtectionForSimulator: Bool = false,
    ) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw RecordingFileSecurityError.invalidIdentifier }
        return try directory(
            allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
        ).appendingPathComponent("\(id).\(fileExtension)")
    }

    static func existingFileURL(
        id: String,
        allowUnverifiedProtectionForSimulator: Bool = false,
    ) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw RecordingFileSecurityError.invalidIdentifier }
        let folder = try directory(
            allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
        )
        guard let url = ["m4a", "caf"].map({ folder.appendingPathComponent("\(id).\($0)") })
            .first(where: { FileManager.default.fileExists(atPath: $0.path) })
        else {
            throw RecordingFileSecurityError.recordingNotFound
        }
        _ = try verify(url, allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator)
        return url
    }

    #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
        /// Installs bundled synthetic speech only in the isolated Simulator transcription build.
        static func installSyntheticTranscriptionFixture(base64: String) throws -> [String: Any] {
            guard let data = Data(base64Encoded: base64), !data.isEmpty else {
                throw RecordingFileSecurityError.invalidAudioFile
            }
            let id = UUID().uuidString.lowercased()
            let url = try fileURL(id: id, extension: "m4a", allowUnverifiedProtectionForSimulator: true)
            do {
                // The dedicated Simulator adapter verifies protection after writing instead of requiring simulator-only file protection support.
                try data.write(to: url, options: [.atomic])
                let security = try protect(url, allowUnverifiedProtectionForSimulator: true)
                let audio = try AVAudioFile(forReading: url)
                let duration = Double(audio.length) / audio.processingFormat.sampleRate
                guard duration.isFinite, duration > 0 else {
                    throw RecordingFileSecurityError.invalidAudioFile
                }
                RecordingSimulatorFixtureIntegrity.register(id: id, bytes: data)
                let completedAt = Date()
                return [
                    "id": id,
                    "durationMs": Int(ceil(duration * 1000)),
                    "startedAt": RecordingModule.timestamp(completedAt.addingTimeInterval(-duration)),
                    "completedAt": RecordingModule.timestamp(completedAt),
                    "fileProtection": security.protection,
                    "excludedFromBackup": security.excludedFromBackup,
                ]
            } catch {
                try? FileManager.default.removeItem(at: url)
                throw error
            }
        }

        static func removeSyntheticTranscriptionFixture(id: String) throws {
            // Drop authorization before deletion so a failed cleanup cannot keep a fixture on the test-only export path.
            RecordingSimulatorFixtureIntegrity.discard(id: id)
            let url = try fileURL(
                id: id,
                extension: "m4a",
                allowUnverifiedProtectionForSimulator: true,
            )
            // A retry after partial test cleanup may find the fixture already removed.
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            _ = try verify(url, allowUnverifiedProtectionForSimulator: true)
            try FileManager.default.removeItem(at: url)
        }
    #endif

    static func protect(
        _ url: URL,
        allowUnverifiedProtectionForSimulator: Bool = false,
    ) throws -> (protection: String, excludedFromBackup: Bool) {
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: url.path,
        )
        try RecordingBackupEligibility.markEligible(url)
        let protection = try verify(
            url,
            allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
        )
        return (protection, false)
    }

    static func prepareForDeviceBackup() throws -> Int {
        let recordingDirectory = try directory()
        let recordings = try FileManager.default.contentsOfDirectory(
            at: recordingDirectory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [],
        )
        // Report readiness only after each permanent recording passes both local security readbacks.
        for recording in recordings {
            _ = try verify(recording, allowUnverifiedProtectionForSimulator: false)
        }
        return recordings.count
    }

    private static func verify(
        _ url: URL,
        allowUnverifiedProtectionForSimulator: Bool,
    ) throws -> String {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let protectionApplied = (attributes[.protectionKey] as? FileProtectionType) == .complete
        let protection: String
        #if (DEBUG || OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST) && targetEnvironment(simulator)
            // Simulator builds may not expose file-protection metadata; only the dedicated synthetic probe may report that limit.
            if protectionApplied {
                protection = "complete"
            } else if allowUnverifiedProtectionForSimulator {
                protection = "unverified"
            } else {
                throw RecordingFileSecurityError.protectionNotApplied
            }
        #else
            guard protectionApplied else { throw RecordingFileSecurityError.protectionNotApplied }
            protection = "complete"
        #endif

        try RecordingBackupEligibility.verify(url)
        return protection
    }
}

enum RecordingFileSecurityError: Error {
    case directoryUnavailable
    case invalidIdentifier
    case recordingNotFound
    case invalidAudioFile
    case protectionNotApplied
    case backupEligibilityNotApplied
}
