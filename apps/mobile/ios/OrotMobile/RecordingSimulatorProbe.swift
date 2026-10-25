#if DEBUG && targetEnvironment(simulator)
    import AVFoundation
    import Foundation
    import React

    public extension RecordingModule {
        @objc(prepareSyntheticCapture:rejecter:)
        func prepareSyntheticCapture(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                guard self.status == .idle || self.status == .completed else {
                    reject("RECORDING_ALREADY_ACTIVE", "Stop the current recording first.", nil)
                    return
                }
                self.syntheticStartFailurePoint = nil
                self.syntheticCaptureRequested = true
                resolve(true)
            }
        }

        @objc(prepareSyntheticStartFailure:resolver:rejecter:)
        func prepareSyntheticStartFailure(
            _ point: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                guard self.status == .idle || self.status == .completed else {
                    reject("RECORDING_ALREADY_ACTIVE", "Stop the current recording first.", nil)
                    return
                }
                guard point == "beforeFileURL" || point == "afterFileCreated" else {
                    reject("INVALID_RECORDING_FAILURE_PROBE", "The failure probe point is invalid.", nil)
                    return
                }
                self.syntheticStartFailurePoint = point
                self.syntheticCaptureRequested = true
                resolve(nil)
            }
        }

        @objc(simulateInterruption:resolver:rejecter:)
        func simulateInterruption(
            _ phase: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                let type: AVAudioSession.InterruptionType
                if phase == "began", self.status == .recording {
                    type = .began
                } else if phase == "ended", self.status == .interrupted {
                    type = .ended
                } else {
                    reject("INVALID_INTERRUPTION_PROBE", "The recording is not in the expected state.", nil)
                    return
                }
                NotificationCenter.default.post(
                    name: AVAudioSession.interruptionNotification,
                    object: AVAudioSession.sharedInstance(),
                    userInfo: [AVAudioSessionInterruptionTypeKey: type.rawValue],
                )
                self.workQueue.async { resolve(nil) }
            }
        }
    }
#endif

import Foundation
import React

public extension RecordingModule {
    @objc(installSyntheticTranscriptionFixture:resolver:rejecter:)
    func installSyntheticTranscriptionFixture(
        _ base64: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            workQueue.async {
                do {
                    try resolve(RecordingFileSecurity.installSyntheticTranscriptionFixture(base64: base64) as NSDictionary)
                } catch {
                    reject(
                        "SYNTHETIC_FIXTURE_FAILED",
                        "The bundled transcription fixture could not be installed: \(error.localizedDescription)",
                        error as NSError,
                    )
                }
            }
        #else
            reject("SYNTHETIC_FIXTURE_UNAVAILABLE", "Synthetic recording fixtures are available only in the dedicated Simulator transcription build.", nil)
        #endif
    }

    @objc(removeSyntheticTranscriptionFixture:resolver:rejecter:)
    func removeSyntheticTranscriptionFixture(
        _ recordingID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            workQueue.async {
                do {
                    try RecordingFileSecurity.removeSyntheticTranscriptionFixture(id: recordingID)
                    resolve(true)
                } catch {
                    reject("SYNTHETIC_FIXTURE_CLEANUP_FAILED", "The bundled transcription fixture could not be removed.", error as NSError)
                }
            }
        #else
            reject("SYNTHETIC_FIXTURE_UNAVAILABLE", "Synthetic recording fixtures are available only in the dedicated Simulator transcription build.", nil)
        #endif
    }
}

#if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
    /// Keeps byte snapshots only for synthetic fixtures installed in this Simulator process.
    /// RecordingModule callers access this registry through its serial workQueue.
    enum RecordingSimulatorFixtureIntegrity {
        private static var installedBytes = [String: Data]()

        /// Registers the original synthetic source bytes after fixture validation succeeds.
        static func register(id: String, bytes: Data) {
            installedBytes[id] = bytes
        }

        /// Removes test-only export authorization before fixture cleanup or a cleanup retry.
        static func discard(id: String) {
            installedBytes.removeValue(forKey: id)
        }

        /// Returns a snapshot only for a fixture installed during this process.
        static func expectedBytes(for id: String) -> Data? {
            installedBytes[id]
        }
    }

    extension RecordingFileSecurity {
        /// Allows unreadable Simulator protection metadata only for a registered fixture while backup exclusion stays enforced.
        static func simulatorProbeAudioExportSourceURL(id: String) throws -> URL {
            guard RecordingSimulatorFixtureIntegrity.expectedBytes(for: id) != nil else {
                return try existingFileURL(id: id)
            }
            return try existingFileURL(id: id, allowUnverifiedProtectionForSimulator: true)
        }

        /// Compares current source bytes with the same-process fixture snapshot without exposing either value.
        static func isSyntheticTranscriptionFixtureUnchanged(id: String) throws -> Bool {
            guard let expectedBytes = RecordingSimulatorFixtureIntegrity.expectedBytes(for: id) else {
                return false
            }
            let url = try existingFileURL(id: id, allowUnverifiedProtectionForSimulator: true)
            return try Data(contentsOf: url) == expectedBytes
        }
    }
#endif
