import Darwin
import Foundation

/// The host regression exercises transcript creation only; audio authorization is outside this test boundary.
enum RecordingFileSecurity {
    static func existingFileURL(id _: String) throws -> URL {
        throw CocoaError(.fileNoSuchFile)
    }
}

enum RecordingExportFilesHostRegressionFailure: Error {
    case cleanupFailureWasSuppressed
    case exportStartedBeforeCleanupSucceeded
    case temporaryCopyWasRemovedDespiteCleanupFailure
    case residueRemainedAfterSuccessfulCleanup
}

@main
struct RecordingExportFilesHostRegression {
    static func main() {
        do {
            try run()
            print("PASS: cleanup failure is reported and the active export remains locked until retry succeeds")
        } catch {
            FileHandle.standardError.write(Data("FAIL: \(error)\n".utf8))
            exit(EXIT_FAILURE)
        }
    }

    private static func run() throws {
        let fileManager = FileManager.default
        let operation = try RecordingExportFiles.transcriptFile(text: "host cleanup regression")
        let exportRoot = operation.directory.deletingLastPathComponent()

        // Removing a child requires write access to its parent; this isolated root produces a real Foundation error.
        defer {
            try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: exportRoot.path)
            try? RecordingExportFiles.finish(operation.directory)
        }
        try fileManager.setAttributes([.posixPermissions: 0o555], ofItemAtPath: exportRoot.path)

        var cleanupError: Error?
        do {
            try RecordingExportFiles.finish(operation.directory)
        } catch {
            cleanupError = error
        }
        guard cleanupError != nil else {
            throw RecordingExportFilesHostRegressionFailure.cleanupFailureWasSuppressed
        }
        guard fileManager.fileExists(atPath: operation.directory.path) else {
            throw RecordingExportFilesHostRegressionFailure.temporaryCopyWasRemovedDespiteCleanupFailure
        }

        do {
            _ = try RecordingExportFiles.transcriptFile(text: "retry before cleanup")
            throw RecordingExportFilesHostRegressionFailure.exportStartedBeforeCleanupSucceeded
        } catch RecordingExportFailure.busy {
            // The active slot stays occupied while its sensitive temporary copy remains on disk.
        }

        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: exportRoot.path)
        try RecordingExportFiles.finish(operation.directory)
        try RecordingExportFiles.finish(operation.directory)
        guard !fileManager.fileExists(atPath: operation.directory.path) else {
            throw RecordingExportFilesHostRegressionFailure.residueRemainedAfterSuccessfulCleanup
        }
    }
}
