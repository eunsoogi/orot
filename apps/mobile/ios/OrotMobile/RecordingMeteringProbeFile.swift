#if (OROT_RECORDING_METERING_SIMULATOR_TEST || OROT_TESTS) && targetEnvironment(simulator)
    import AVFoundation
    import Foundation

    /// Owns only its newly created temporary directory. It never enters the production Recordings tree.
    final class RecordingMeteringProbeFile {
        private let directory: URL
        let url: URL
        private(set) var protection = "unverified"
        private(set) var excludedFromBackup = false
        private(set) var unlinked = false

        init() throws {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(
                "orot-metering-\(UUID().uuidString)", isDirectory: true,
            )
            url = directory.appendingPathComponent("microphone.m4a")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            do {
                var location = directory
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try location.setResourceValues(values)
                guard try location.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
                    throw RecordingMeteringProbeError.fileBoundary
                }
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw RecordingMeteringProbeError.fileBoundary
            }
        }

        /// Unlink after prepareToRecord; the recorder may continue on its open descriptor, never a saved source path.
        func secureAndUnlink() throws {
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            protection = (attributes[.protectionKey] as? FileProtectionType) == .complete ? "complete" : "unverified"
            var location = url
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try location.setResourceValues(values)
            excludedFromBackup = try location.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true
            guard excludedFromBackup else { throw RecordingMeteringProbeError.fileBoundary }
            try FileManager.default.removeItem(at: url)
            unlinked = !FileManager.default.fileExists(atPath: url.path)
            guard unlinked else { throw RecordingMeteringProbeError.fileBoundary }
        }

        func assertUnlinked() throws {
            guard unlinked, !FileManager.default.fileExists(atPath: url.path) else {
                throw RecordingMeteringProbeError.fileBoundary
            }
        }

        /// Only this object's exact directory is eligible for deletion; no scan or cross-session cleanup.
        func cleanup() -> Bool {
            if FileManager.default.fileExists(atPath: directory.path) {
                do { try FileManager.default.removeItem(at: directory) } catch { return false }
            }
            return !FileManager.default.fileExists(atPath: directory.path)
        }
    }

    enum RecordingMeteringProbeError: Error {
        case fileBoundary, prepare, record
    }
#endif
