import Foundation
import React
import UIKit

public extension RecordingModule {
    @objc(shareRecordingAudio:resolver:rejecter:)
    func shareRecordingAudio(
        _ recordingID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.status == .idle || self.status == .completed else {
                reject("RECORDING_BUSY", "Finish recording before exporting audio.", nil)
                return
            }
            do {
                let operation = try RecordingExportFiles.audioCopy(recordingID: recordingID)
                self.presentExport(
                    operation,
                    simulateCancellationAfterPresentation: RecordingExportFiles.consumeSimulatorCancellation(),
                    resolve: resolve,
                    reject: reject,
                )
            } catch RecordingFileSecurityError.recordingNotFound {
                reject("RECORDING_EXPORT_SOURCE_MISSING", "The protected recording file is missing.", nil)
            } catch RecordingExportFailure.busy {
                reject("RECORDING_EXPORT_BUSY", "Another recording export is still open.", nil)
            } catch RecordingExportFailure.backupExclusionNotApplied {
                reject(
                    "RECORDING_EXPORT_BACKUP_EXCLUSION_NOT_APPLIED",
                    "The temporary export could not be excluded from backup.",
                    nil,
                )
            } catch RecordingExportFailure.cleanupFailed {
                reject("RECORDING_EXPORT_CLEANUP_FAILED", "The temporary export could not be removed.", nil)
            } catch {
                #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                    // Keep production verification unchanged while exposing only fixed categories to the Simulator probe.
                    if let securityError = error as? RecordingFileSecurityError {
                        switch securityError {
                        case .protectionNotApplied:
                            reject(
                                "RECORDING_EXPORT_PROTECTION_NOT_APPLIED",
                                "The source recording protection could not be verified.",
                                nil,
                            )
                            return
                        // Permanent recordings stay backup-eligible; only temporary export copies are excluded.
                        case .backupEligibilityNotApplied:
                            reject(
                                "RECORDING_EXPORT_BACKUP_ELIGIBILITY_NOT_APPLIED",
                                "The source recording could not be verified as eligible for backup.",
                                nil,
                            )
                            return
                        default:
                            break
                        }
                    }
                #endif
                reject("RECORDING_EXPORT_FAILED", "The recording could not be prepared for export.", error as NSError)
            }
        }
    }

    @objc(shareRecordingTranscript:resolver:rejecter:)
    func shareRecordingTranscript(
        _ text: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.status == .idle || self.status == .completed else {
                reject("RECORDING_BUSY", "Finish recording before exporting a transcript.", nil)
                return
            }
            do {
                let operation = try RecordingExportFiles.transcriptFile(text: text)
                self.presentExport(
                    operation,
                    simulateCancellationAfterPresentation: RecordingExportFiles.consumeSimulatorCancellation(),
                    resolve: resolve,
                    reject: reject,
                )
            } catch RecordingExportFailure.emptyTranscript {
                reject("RECORDING_EXPORT_TRANSCRIPT_EMPTY", "There is no transcript text to export.", nil)
            } catch RecordingExportFailure.busy {
                reject("RECORDING_EXPORT_BUSY", "Another recording export is still open.", nil)
            } catch RecordingExportFailure.backupExclusionNotApplied {
                reject(
                    "RECORDING_EXPORT_BACKUP_EXCLUSION_NOT_APPLIED",
                    "The temporary export could not be excluded from backup.",
                    nil,
                )
            } catch RecordingExportFailure.cleanupFailed {
                reject("RECORDING_EXPORT_CLEANUP_FAILED", "The temporary export could not be removed.", nil)
            } catch {
                reject("RECORDING_EXPORT_FAILED", "The transcript could not be prepared for export.", error as NSError)
            }
        }
    }

    private func presentExport(
        _ operation: RecordingExportOperation,
        simulateCancellationAfterPresentation: Bool,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
    ) {
        DispatchQueue.main.async {
            #if OROT_TESTS
                TestLifecycleObservation.record("export-presentation-enqueued", fields: ["syntheticCancellation": simulateCancellationAfterPresentation])
            #endif
            // The bridge has no invoking UIView, so resolve its single foreground key window instead of guessing a scene.
            guard let anchor = WindowPresentationAnchor.resolve() else {
                guard self.finishExport(operation, reject: reject) else { return }
                reject("RECORDING_EXPORT_UNAVAILABLE", "The iOS share sheet is unavailable.", nil)
                return
            }
            let activity = UIActivityViewController(
                activityItems: [operation.file],
                applicationActivities: nil,
            )
            // UIKit distinguishes a user cancel from an activity failure; always remove the temporary copy after dismissal.
            let completeExport: (Bool, Error?) -> Void = { completed, error in
                #if OROT_TESTS
                    TestLifecycleObservation.record("export-completion", fields: ["completed": completed, "hasError": error != nil])
                #endif
                guard self.finishExport(operation, reject: reject) else { return }
                if let error {
                    reject("RECORDING_EXPORT_FAILED", "The selected export activity failed.", error as NSError)
                    return
                }
                // React Native forwards this promise value as-is; the JavaScript bridge expects a status string.
                resolve(completed ? "completed" : "cancelled")
            }
            activity.completionWithItemsHandler = { _, completed, _, error in
                completeExport(completed, error)
            }
            let popoverConfiguration = anchor.apply(to: activity)
            guard anchor.isCurrent, popoverConfiguration != false else {
                guard self.finishExport(operation, reject: reject) else { return }
                reject("RECORDING_EXPORT_UNAVAILABLE", "The iOS share sheet is unavailable.", nil)
                return
            }
            let popoverConfigured = popoverConfiguration == true
            #if OROT_TESTS
                TestLifecycleObservation.record(
                    "export-presentation-anchor",
                    fields: anchor.testObservation(
                        popoverAvailable: activity.popoverPresentationController != nil,
                        popoverConfigured: popoverConfigured,
                    ),
                )
            #endif
            #if OROT_TESTS
                TestLifecycleObservation.record("export-present-called")
            #endif
            anchor.present(activity, animated: true) { didPresent in
                #if OROT_TESTS
                    TestLifecycleObservation.record(
                        "export-presentation-completion",
                        fields: [
                            "presenterMatches": anchor.matchesPresenter(activity),
                            "presenterWindowMatches": anchor.presenterSharesWindow(activity),
                        ],
                    )
                #endif
                guard didPresent else {
                    guard self.finishExport(operation, reject: reject) else { return }
                    reject("RECORDING_EXPORT_UNAVAILABLE", "The iOS share sheet could not be presented.", nil)
                    return
                }
                if simulateCancellationAfterPresentation {
                    #if OROT_TESTS
                        TestLifecycleObservation.record("export-synthetic-cancel-scheduled")
                    #endif
                    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(1)) {
                        #if OROT_TESTS
                            TestLifecycleObservation.record("export-synthetic-cancel-executed")
                        #endif
                        // Programmatic dismissal is synthetic, so pass its cancelled result through the app's cleanup and bridge path explicitly.
                        activity.completionWithItemsHandler = nil
                        activity.dismiss(animated: true) {
                            #if OROT_TESTS
                                TestLifecycleObservation.record("export-synthetic-dismiss-completion")
                            #endif
                            completeExport(false, nil)
                        }
                    }
                }
            }
        }
    }

    /// Reports cleanup failure before resolving the share result, since a leftover copy may contain private recording data.
    private func finishExport(
        _ operation: RecordingExportOperation,
        reject: @escaping RCTPromiseRejectBlock,
    ) -> Bool {
        do {
            try RecordingExportFiles.finish(operation.directory)
            return true
        } catch {
            reject("RECORDING_EXPORT_CLEANUP_FAILED", "The temporary export could not be removed.", nil)
            return false
        }
    }
}
