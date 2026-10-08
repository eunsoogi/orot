import Foundation
import React

private enum RecordingDeletionStore {
    private static let pendingPrefix = ".pending-delete-"
    private static let supportedExtensions = ["m4a", "caf"]

    private static var allowSimulatorFixtureProtection: Bool {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            true
        #else
            false
        #endif
    }

    static func stage(recordingID: String) throws {
        // Keep the protected source recoverable until the database cascade commits.
        let identifier = try normalizedID(recordingID)
        let original = try RecordingFileSecurity.existingFileURL(
            id: identifier,
            allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
        )
        let pending = stagedURL(original: original, id: identifier)
        guard !FileManager.default.fileExists(atPath: pending.path) else {
            throw RecordingFileSecurityError.recordingNotFound
        }
        try FileManager.default.moveItem(at: original, to: pending)
        do {
            _ = try RecordingFileSecurity.protect(
                pending,
                allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
            )
        } catch {
            try? FileManager.default.moveItem(at: pending, to: original)
            throw error
        }
    }

    static func restore(recordingID: String) throws {
        let identifier = try normalizedID(recordingID)
        let folder = try RecordingFileSecurity.directory(
            allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
        )
        let staged = supportedExtensions.map { folder.appendingPathComponent("\(pendingPrefix)\(identifier).\($0)") }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        guard !staged.isEmpty else {
            _ = try RecordingFileSecurity.existingFileURL(
                id: identifier,
                allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
            )
            return
        }

        for pending in staged {
            let original = folder.appendingPathComponent("\(identifier).\(pending.pathExtension)")
            if FileManager.default.fileExists(atPath: original.path) {
                try FileManager.default.removeItem(at: pending)
                _ = try RecordingFileSecurity.protect(
                    original,
                    allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
                )
                continue
            }
            try FileManager.default.moveItem(at: pending, to: original)
            do {
                _ = try RecordingFileSecurity.protect(
                    original,
                    allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
                )
            } catch {
                try? FileManager.default.moveItem(at: original, to: pending)
                throw error
            }
        }
    }

    static func commit(recordingID: String) throws {
        let identifier = try normalizedID(recordingID)
        let folder = try RecordingFileSecurity.directory(
            allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
        )
        // A completed or retried deletion may already have removed its staged file.
        for fileExtension in supportedExtensions {
            let pending = folder.appendingPathComponent("\(pendingPrefix)\(identifier).\(fileExtension)")
            if FileManager.default.fileExists(atPath: pending.path) {
                try FileManager.default.removeItem(at: pending)
            }
        }
    }

    static func reconcile(sourceIDs: Set<String>) throws {
        // After a crash, a surviving source row means restore; its absence means finish deletion.
        let folder = try RecordingFileSecurity.directory(
            allowUnverifiedProtectionForSimulator: allowSimulatorFixtureProtection,
        )
        let liveIDs = Set(sourceIDs.compactMap { try? normalizedID($0) })
        let files = try FileManager.default.contentsOfDirectory(
            at: folder,
            includingPropertiesForKeys: nil,
        )
        for pending in files where pending.lastPathComponent.hasPrefix(pendingPrefix) {
            let suffix = String(pending.lastPathComponent.dropFirst(pendingPrefix.count))
            let parts = suffix.split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 2,
                  supportedExtensions.contains(String(parts[1])),
                  let uuid = UUID(uuidString: String(parts[0]))
            else { continue }
            let identifier = uuid.uuidString.lowercased()
            if liveIDs.contains(identifier) {
                try restore(recordingID: identifier)
            } else {
                // A missing database source means the prior cascade committed before the app stopped.
                try FileManager.default.removeItem(at: pending)
                let original = folder.appendingPathComponent("\(identifier).\(parts[1])")
                if FileManager.default.fileExists(atPath: original.path) {
                    try FileManager.default.removeItem(at: original)
                }
            }
        }
    }

    private static func normalizedID(_ value: String) throws -> String {
        guard let uuid = UUID(uuidString: value) else {
            throw RecordingFileSecurityError.invalidIdentifier
        }
        return uuid.uuidString.lowercased()
    }

    private static func stagedURL(original: URL, id: String) -> URL {
        original.deletingLastPathComponent()
            .appendingPathComponent("\(pendingPrefix)\(id).\(original.pathExtension)")
    }
}

public extension RecordingModule {
    @objc(reconcileRecordingDeletions:resolver:rejecter:)
    func reconcileRecordingDeletions(
        _ sourceIDs: [String],
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.status == .idle || self.status == .completed, !self.startInProgress else {
                reject("RECORDING_BUSY", "Saved recordings cannot be reconciled during capture.", nil)
                return
            }
            self.stopPlayback()
            do {
                try RecordingDeletionStore.reconcile(sourceIDs: Set(sourceIDs))
                resolve(nil)
            } catch {
                reject("RECORDING_DELETE_RECOVERY_FAILED", "A saved recording could not be recovered.", error as NSError)
            }
        }
    }

    @objc(stageRecordingDeletion:resolver:rejecter:)
    func stageRecordingDeletion(
        _ recordingID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.status == .idle || self.status == .completed, !self.startInProgress else {
                reject("RECORDING_BUSY", "Stop recording before deleting saved audio.", nil)
                return
            }
            self.stopPlayback()
            do {
                try RecordingDeletionStore.stage(recordingID: recordingID)
                resolve(nil)
            } catch let error as RecordingFileSecurityError {
                if case .recordingNotFound = error {
                    reject("RECORDING_FILE_MISSING", "The saved audio file was not found.", error as NSError)
                } else {
                    reject("RECORDING_DELETE_FAILED", "The protected audio file could not be staged.", error as NSError)
                }
            } catch {
                reject("RECORDING_DELETE_FAILED", "The protected audio file could not be staged.", error as NSError)
            }
        }
    }

    @objc(restoreRecordingDeletion:resolver:rejecter:)
    func restoreRecordingDeletion(
        _ recordingID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.status == .idle || self.status == .completed, !self.startInProgress else {
                reject("RECORDING_BUSY", "Stop recording before restoring saved audio.", nil)
                return
            }
            do {
                try RecordingDeletionStore.restore(recordingID: recordingID)
                resolve(nil)
            } catch {
                reject("RECORDING_DELETE_RESTORE_FAILED", "The protected audio file could not be restored.", error as NSError)
            }
        }
    }

    @objc(commitRecordingDeletion:resolver:rejecter:)
    func commitRecordingDeletion(
        _ recordingID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.status == .idle || self.status == .completed, !self.startInProgress else {
                reject("RECORDING_BUSY", "Stop recording before removing saved audio.", nil)
                return
            }
            do {
                try RecordingDeletionStore.commit(recordingID: recordingID)
                if self.recordingID?.caseInsensitiveCompare(recordingID) == .orderedSame {
                    // Clear the completed recorder snapshot after file deletion.
                    self.recordingID = nil
                    self.recordingURL = nil
                    self.startedAt = nil
                    self.lastDurationMs = 0
                    self.consentAcknowledged = false
                    self.status = .idle
                    self.emitState()
                }
                resolve(nil)
            } catch {
                reject("RECORDING_DELETE_COMMIT_FAILED", "The staged audio file could not be removed.", error as NSError)
            }
        }
    }
}
