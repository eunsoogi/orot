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
                        case .backupExclusionNotApplied:
                            reject(
                                "RECORDING_EXPORT_BACKUP_EXCLUSION_NOT_APPLIED",
                                "The source recording backup exclusion could not be verified.",
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
            guard let presenter = Self.activePresenter() else {
                RecordingExportFiles.finish(operation.directory)
                reject("RECORDING_EXPORT_UNAVAILABLE", "The iOS share sheet is unavailable.", nil)
                return
            }
            let activity = UIActivityViewController(
                activityItems: [operation.file],
                applicationActivities: nil,
            )
            // UIKit distinguishes a user cancel from an activity failure; always remove the temporary copy after dismissal.
            let completeExport: (Bool, Error?) -> Void = { completed, error in
                RecordingExportFiles.finish(operation.directory)
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
            if let popover = activity.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX,
                    y: presenter.view.bounds.midY,
                    width: 1,
                    height: 1,
                )
            }
            presenter.present(activity, animated: true) {
                guard activity.presentingViewController === presenter else {
                    RecordingExportFiles.finish(operation.directory)
                    reject("RECORDING_EXPORT_UNAVAILABLE", "The iOS share sheet could not be presented.", nil)
                    return
                }
                if simulateCancellationAfterPresentation {
                    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(1)) {
                        // Programmatic dismissal is synthetic, so pass its cancelled result through the app's cleanup and bridge path explicitly.
                        activity.completionWithItemsHandler = nil
                        activity.dismiss(animated: true) {
                            completeExport(false, nil)
                        }
                    }
                }
            }
        }
    }

    private static func activePresenter() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var presenter = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = presenter?.presentedViewController {
            presenter = presented
        }
        return presenter
    }

    #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
        @objc(prepareSyntheticExportResidue:rejecter:)
        func prepareSyntheticExportResidue(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                do {
                    try RecordingExportFiles.prepareSyntheticResidue()
                    resolve(RecordingExportFiles.residueCount())
                } catch {
                    reject("RECORDING_EXPORT_PROBE_FAILED", "Synthetic export residue could not be prepared.", error as NSError)
                }
            }
        }

        @objc(getSyntheticExportResidueCount:rejecter:)
        func getSyntheticExportResidueCount(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter _: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async { resolve(RecordingExportFiles.residueCount()) }
        }

        /// Checks fixture source bytes without returning a path or file contents to the probe.
        @objc(isSyntheticTranscriptionFixtureUnchanged:resolver:rejecter:)
        func isSyntheticTranscriptionFixtureUnchanged(
            _ recordingID: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                do {
                    let unchanged = try RecordingFileSecurity.isSyntheticTranscriptionFixtureUnchanged(id: recordingID)
                    resolve(unchanged)
                } catch {
                    // The probe reports only a fixed failure code; native paths and file contents stay private.
                    reject("RECORDING_EXPORT_PROBE_FAILED", "The synthetic source could not be checked.", nil)
                }
            }
        }

        @objc(armSyntheticExportCancellation:rejecter:)
        func armSyntheticExportCancellation(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter _: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                RecordingExportFiles.armCancellation()
                resolve(true)
            }
        }
    #endif
}
