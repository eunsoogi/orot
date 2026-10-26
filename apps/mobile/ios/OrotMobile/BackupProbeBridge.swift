import Foundation
import React

#if OROT_BACKUP_PROBE_TEST || OROT_TESTS
    /// Exposes only the isolated backup fixture operations; default app builds have no probe selectors.
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
                    reject("BACKUP_PROBE_FAILED", BackupMigrationProbeSupport.failureCategory(error), error as NSError)
                }
            }
        }
    }
#endif
