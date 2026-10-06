import Foundation

struct RecordingExportOperation {
    let directory: URL
    let file: URL
}

enum RecordingExportFailure: Error {
    case busy
    case emptyTranscript
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
    }

    static func audioCopy(recordingID: String) throws -> RecordingExportOperation {
        let directory = try beginOperation()
        do {
            // Copy only a verified recording into an isolated temporary export; never write back to the protected source.
            let source = try RecordingFileSecurity.existingFileURL(id: recordingID)
            let file = directory.appendingPathComponent("recording.\(source.pathExtension)")
            try FileManager.default.copyItem(at: source, to: file)
            try protectTemporaryFile(file)
            return RecordingExportOperation(directory: directory, file: file)
        } catch {
            finish(directory)
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
            finish(directory)
            throw error
        }
    }

    static func finish(_ directory: URL) {
        lock.lock()
        if activeDirectory == directory {
            activeDirectory = nil
        }
        lock.unlock()
        try? FileManager.default.removeItem(at: directory)
    }

    #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
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
