import Foundation
import React
import Security

struct DatabaseKeychainItem {
    let data: Data
    let accessibility: String
}

enum BackupMigrationFailure: LocalizedError {
    case keychainRead(OSStatus)
    case keychainWrite(OSStatus)
    case invalidKeychainItem
    case unsupportedAccessibility
    case invalidDatabaseLocation

    var errorDescription: String? {
        switch self {
        case let .keychainRead(status):
            "The database key could not be read from Keychain (\(status))."
        case let .keychainWrite(status):
            "The database key accessibility could not be updated (\(status))."
        case .invalidKeychainItem:
            "The database key item could not be verified."
        case .unsupportedAccessibility:
            "The database key has an unsupported accessibility setting."
        case .invalidDatabaseLocation:
            "The encrypted database location could not be verified."
        }
    }
}

#if OROT_BACKUP_PROBE_TEST
    /// Contains fault injection and recording fixtures compiled only for the dedicated backup probe.
    enum BackupMigrationProbeSupport {
        private final class ReadbackFault: @unchecked Sendable {
            private let lock = NSLock()
            private var isArmed = false
            private var wasTriggered = false

            func arm() {
                lock.lock()
                defer { lock.unlock() }
                isArmed = true
                wasTriggered = false
            }

            func consumeAfterSuccessfulUpdate(status: OSStatus) -> Bool {
                lock.lock()
                defer { lock.unlock() }
                defer { isArmed = false }
                guard isArmed, status == errSecSuccess else { return false }
                wasTriggered = true
                return true
            }

            func didTrigger() -> Bool {
                lock.lock()
                defer { lock.unlock() }
                return wasTriggered
            }
        }

        private enum ProbeFailure: Error {
            case invalidRecordingID
            case recordingNotFound
            case backupExclusionNotReadable
        }

        private static let readbackFault = ReadbackFault()

        static func armPostUpdateReadbackFailure() {
            readbackFault.arm()
        }

        static func postUpdateReadbackFailureWasTriggered() -> Bool {
            readbackFault.didTrigger()
        }

        static func readAfterSuccessfulUpdate<Value>(
            status: OSStatus,
            read: () throws -> Value?,
        ) throws -> Value? {
            if readbackFault.consumeAfterSuccessfulUpdate(status: status) {
                return nil
            }
            return try read()
        }

        static func prepareLegacyRecording(recordingID: String) throws -> [String: Any] {
            var url = try recordingURL(recordingID: recordingID)
            var legacyResources = URLResourceValues()
            legacyResources.isExcludedFromBackup = true
            var mutableURL = url
            try mutableURL.setResourceValues(legacyResources)

            let before = try recordingState(at: url)
            guard before.excludedFromBackup else { throw ProbeFailure.backupExclusionNotReadable }

            var preparedCount: Int?
            var preparationError = "none"
            do {
                preparedCount = try RecordingFileSecurity.prepareForDeviceBackup()
            } catch let error as RecordingFileSecurityError {
                preparationError = preparationErrorCode(error)
            } catch {
                preparationError = "other-native-error"
            }

            url.removeCachedResourceValue(forKey: .isExcludedFromBackupKey) // Drop stale exclusion metadata.
            let after = try recordingState(at: url)
            let ready = preparedCount == 1 &&
                preparationError == "none" &&
                after.protection == "complete" &&
                !after.excludedFromBackup
            return [
                "legacyExcludedBefore": before.excludedFromBackup,
                "preparedCount": preparedCount ?? 0,
                "preparationError": preparationError,
                "preparationReady": ready,
                "fileProtection": after.protection,
                "excludedFromBackup": after.excludedFromBackup,
                "fileReadable": after.readable,
            ]
        }

        static func inspectRecording(recordingID: String) throws -> [String: Any] {
            let state = try recordingState(at: recordingURL(recordingID: recordingID))
            return [
                "fileProtection": state.protection,
                "excludedFromBackup": state.excludedFromBackup,
                "fileReadable": state.readable,
            ]
        }

        private static func recordingURL(recordingID: String) throws -> URL {
            guard let normalizedID = UUID(uuidString: recordingID)?.uuidString.lowercased(),
                  let supportDirectory = FileManager.default.urls(
                      for: .applicationSupportDirectory,
                      in: .userDomainMask,
                  ).first
            else {
                throw ProbeFailure.invalidRecordingID
            }

            let directory = supportDirectory.appendingPathComponent("Recordings", isDirectory: true)
            guard let url = ["m4a", "caf"]
                .map({ directory.appendingPathComponent("\(normalizedID).\($0)") })
                .first(where: { FileManager.default.fileExists(atPath: $0.path) })
            else {
                throw ProbeFailure.recordingNotFound
            }
            return url
        }

        private static func recordingState(
            at url: URL,
        ) throws -> (protection: String, excludedFromBackup: Bool, readable: Bool) {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let protection: String = if let value = attributes[.protectionKey] as? FileProtectionType {
                value == .complete ? "complete" : "not-complete"
            } else {
                // Simulator metadata may be absent; preserve that limitation as unknown evidence.
                "unverified"
            }
            let resources = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
            guard let excludedFromBackup = resources.isExcludedFromBackup else {
                throw ProbeFailure.backupExclusionNotReadable
            }
            let audio = try Data(contentsOf: url, options: [.mappedIfSafe])
            return (protection, excludedFromBackup, !audio.isEmpty)
        }

        private static func preparationErrorCode(_ error: RecordingFileSecurityError) -> String {
            switch error {
            case .protectionNotApplied:
                "protection-not-applied"
            case .backupEligibilityNotApplied:
                "backup-eligibility-not-applied"
            default:
                "recording-preparation-failed"
            }
        }
    }

    extension BackupMigrationModule {
        @objc(armPostUpdateReadbackFailureForProbe:rejecter:)
        func armPostUpdateReadbackFailureForProbe(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter _: @escaping RCTPromiseRejectBlock,
        ) {
            BackupMigrationProbeSupport.armPostUpdateReadbackFailure()
            resolve(true)
        }

        @objc(postUpdateReadbackFailureWasTriggeredForProbe:rejecter:)
        func postUpdateReadbackFailureWasTriggeredForProbe(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter _: @escaping RCTPromiseRejectBlock,
        ) {
            resolve(BackupMigrationProbeSupport.postUpdateReadbackFailureWasTriggered())
        }

        @objc(prepareLegacyRecordingForBackupProbe:resolver:rejecter:)
        func prepareLegacyRecordingForBackupProbe(
            _ recordingID: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            performBackupProbe(resolve: resolve, reject: reject) {
                try BackupMigrationProbeSupport.prepareLegacyRecording(recordingID: recordingID)
            }
        }

        @objc(inspectRecordingForBackupProbe:resolver:rejecter:)
        func inspectRecordingForBackupProbe(
            _ recordingID: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            performBackupProbe(resolve: resolve, reject: reject) {
                try BackupMigrationProbeSupport.inspectRecording(recordingID: recordingID)
            }
        }

        @objc(backupKeyAccessibilityForProbe:rejecter:)
        func backupKeyAccessibilityForProbe(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            performBackupProbe(resolve: resolve, reject: reject) {
                try BackupMigrationModule.backupKeyAccessibilityForProbe()
            }
        }

        private func performBackupProbe(
            resolve: @escaping RCTPromiseResolveBlock,
            reject: @escaping RCTPromiseRejectBlock,
            operation: @escaping () throws -> Any,
        ) {
            DispatchQueue.global(qos: .utility).async {
                do {
                    try resolve(operation())
                } catch {
                    reject("BACKUP_PROBE_FAILED", "The isolated backup probe failed.", error as NSError)
                }
            }
        }
    }
#endif
