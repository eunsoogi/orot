import Foundation

struct RecordingExportOperation {
    let directory: URL
    let file: URL
}

enum RecordingExportFailure: Error {
    case busy
    case emptyTranscript
    case backupExclusionNotApplied
    case cleanupFailed
}

enum RecordingExportFiles {
    private static let folderName = "OrotRecordingExports"
    private static let lock = NSLock()
    private static var prepared = false
    private static var activeDirectory: URL?
    #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
        private static var cancelNextForSimulator = false
    #endif

    private static var root: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(
            folderName,
            isDirectory: true,
        )
    }

    /// Temporary copies stay outside the persistent recording store and are swept on the next export after a process restart.
    private static func beginOperation() throws -> URL {
        lock.lock()
        defer { lock.unlock() }
        guard activeDirectory == nil else { throw RecordingExportFailure.busy }
        if !prepared {
            if FileManager.default.fileExists(atPath: root.path) {
                try FileManager.default.removeItem(at: root)
            }
            prepared = true
        }
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
        )
        activeDirectory = directory
        return directory
    }

    private static func protectTemporaryFile(_ url: URL) throws {
        do {
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: url.path,
            )
        } catch {
            #if !targetEnvironment(simulator)
                throw error
            #endif
        }
        var mutableURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try mutableURL.setResourceValues(values)
        try verifyBackupExclusion(url)
    }

    private static func verifyBackupExclusion(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        guard values.isExcludedFromBackup == true else {
            throw RecordingExportFailure.backupExclusionNotApplied
        }
    }

    /// Only the registered dedicated Simulator fixture may use the unverified-metadata probe path.
    private static func audioExportSourceURL(recordingID: String) throws -> URL {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            return try RecordingFileSecurity.simulatorProbeAudioExportSourceURL(id: recordingID)
        #else
            return try RecordingFileSecurity.existingFileURL(id: recordingID)
        #endif
    }

    static func audioCopy(recordingID: String) throws -> RecordingExportOperation {
        let directory = try beginOperation()
        do {
            // User recordings remain fully verified; only the registered synthetic Simulator fixture may lack readable protection metadata.
            let source = try audioExportSourceURL(recordingID: recordingID)
            let file = directory.appendingPathComponent("recording.\(source.pathExtension)")
            try FileManager.default.copyItem(at: source, to: file)
            try protectTemporaryFile(file)
            return RecordingExportOperation(directory: directory, file: file)
        } catch {
            try finish(directory)
            throw error
        }
    }

    static func transcriptFile(text: String) throws -> RecordingExportOperation {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw RecordingExportFailure.emptyTranscript
        }
        let directory = try beginOperation()
        do {
            let file = directory.appendingPathComponent("transcript.txt")
            // Apply complete protection during the atomic write so an interrupted export cannot leave weaker-protected plaintext.
            try Data(text.utf8).write(
                to: file,
                options: [.atomic, .completeFileProtection],
            )
            try protectTemporaryFile(file)
            return RecordingExportOperation(directory: directory, file: file)
        } catch {
            try finish(directory)
            throw error
        }
    }

    /// Removes the temporary copy before releasing its slot, so failed cleanup stays retryable.
    static func finish(_ directory: URL) throws {
        do {
            try FileManager.default.removeItem(at: directory)
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
            // A missing export directory already satisfies the cleanup postcondition.
        } catch {
            throw RecordingExportFailure.cleanupFailed
        }

        lock.lock()
        if activeDirectory == directory {
            activeDirectory = nil
        }
        lock.unlock()
    }

    #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
        /// Checks the temporary export boundary; permanent recordings have a different backup policy.
        static func temporaryBackupExclusionIsMandatory() -> Bool {
            let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true,
                )
                defer { try? FileManager.default.removeItem(at: directory) }
                let file = directory.appendingPathComponent("probe.txt")
                try Data("synthetic export backup probe".utf8).write(to: file, options: [.atomic])
                try protectTemporaryFile(file)

                // A temporary export must reject becoming backup-eligible even though the source recording remains eligible.
                var mutableFile = file
                var values = URLResourceValues()
                values.isExcludedFromBackup = false
                try mutableFile.setResourceValues(values)
                do {
                    try verifyBackupExclusion(file)
                    return false
                } catch RecordingExportFailure.backupExclusionNotApplied {
                    return true
                }
            } catch {
                return false
            }
        }

        static func prepareSyntheticResidue() throws {
            lock.lock()
            defer { lock.unlock() }
            guard activeDirectory == nil else { throw RecordingExportFailure.busy }
            if FileManager.default.fileExists(atPath: root.path) {
                try FileManager.default.removeItem(at: root)
            }
            let directory = root.appendingPathComponent("interrupted-session", isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
            )
            let file = directory.appendingPathComponent("orphan.txt")
            try Data("synthetic residue".utf8).write(to: file, options: [.atomic])
            try protectTemporaryFile(file)
            // This fixture models a previous process so the next operation must sweep it before sharing.
            prepared = false
        }

        static func residueCount() -> Int {
            guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else {
                return 0
            }
            return files.allObjects.compactMap { $0 as? URL }.filter {
                (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
            }.count
        }

        static func armCancellation() {
            lock.lock()
            cancelNextForSimulator = true
            lock.unlock()
        }
    #endif

    static func consumeSimulatorCancellation() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            let shouldCancel = cancelNextForSimulator
            cancelNextForSimulator = false
            return shouldCancel
        #else
            return false
        #endif
    }
}
