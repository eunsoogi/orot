import AVFoundation
import Foundation
import React

public extension RecordingModule {
    @objc(getState:rejecter:)
    func getState(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async { resolve(self.snapshot()) }
    }

    @objc(startRecording:resolver:rejecter:)
    func startRecording(
        _ acknowledged: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard acknowledged else {
                reject("RECORDING_CONSENT_REQUIRED", "Recording consent must be acknowledged first.", nil)
                return
            }
            guard self.status == .idle || self.status == .completed else {
                reject("RECORDING_ALREADY_ACTIVE", "Stop the current recording before starting another.", nil)
                return
            }
            guard !self.startInProgress else {
                reject("RECORDING_ALREADY_ACTIVE", "A recording start is already in progress.", nil)
                return
            }
            self.startInProgress = true
            self.consentAcknowledged = true
            #if DEBUG && targetEnvironment(simulator)
                if self.syntheticCaptureRequested {
                    self.syntheticCaptureRequested = false
                    do {
                        try self.startSyntheticRecording(resolve: resolve, reject: reject)
                    } catch {
                        self.rejectStart(error, reject: reject)
                    }
                    return
                }
            #endif
            self.requestMicrophonePermission { granted in
                self.workQueue.async {
                    guard granted else {
                        self.startInProgress = false
                        self.consentAcknowledged = false
                        self.emitState()
                        reject("RECORDING_MICROPHONE_PERMISSION_DENIED", "Microphone permission was not granted.", nil)
                        return
                    }
                    do {
                        try self.startMicrophoneRecording(resolve: resolve, reject: reject)
                    } catch {
                        self.rejectStart(error, reject: reject)
                    }
                }
            }
        }
    }

    @objc(pauseRecording:rejecter:)
    func pauseRecording(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.consentAcknowledged else {
                reject("RECORDING_CONSENT_REQUIRED", "Recording consent is required.", nil)
                return
            }
            guard self.status == .recording else {
                reject("RECORDING_NOT_ACTIVE", "Only an active recording can be paused.", nil)
                return
            }
            self.recorder?.pause()
            self.deactivateAudioSession()
            self.status = .paused
            self.stopTimer()
            self.emitState()
            resolve(self.snapshot())
        }
    }

    @objc(resumeRecording:rejecter:)
    func resumeRecording(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.consentAcknowledged else {
                reject("RECORDING_CONSENT_REQUIRED", "Recording consent is required.", nil)
                return
            }
            guard self.status == .paused || self.status == .interrupted else {
                reject("RECORDING_NOT_PAUSED", "Only a paused recording can be resumed.", nil)
                return
            }
            #if DEBUG && targetEnvironment(simulator)
                if self.syntheticCapture != nil {
                    self.status = .recording
                    self.startTimer()
                    self.emitState()
                    resolve(self.snapshot())
                    return
                }
            #endif
            do {
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                reject("RECORDING_AUDIO_SESSION_FAILED", error.localizedDescription, error as NSError)
                return
            }
            guard let recorder = self.recorder, recorder.record() else {
                self.deactivateAudioSession()
                reject("RECORDING_RESUME_FAILED", "The audio recorder could not resume.", nil)
                return
            }
            self.wasInterrupted = false
            self.status = .recording
            self.startTimer()
            self.emitState()
            resolve(self.snapshot())
        }
    }

    @objc(stopRecording:rejecter:)
    func stopRecording(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            guard self.consentAcknowledged else {
                reject("RECORDING_CONSENT_REQUIRED", "Recording consent is required.", nil)
                return
            }
            guard
                self.status == .recording || self.status == .paused || self.status == .interrupted,
                let identifier = self.recordingID,
                let url = self.recordingURL,
                let startDate = self.startedAt
            else {
                reject("RECORDING_NOT_ACTIVE", "There is no recording to stop.", nil)
                return
            }

            self.lastDurationMs = self.currentDurationMs()
            self.stopTimer()
            self.recorder?.stop()
            self.recorder = nil
            let allowUnverifiedProtectionForSimulator: Bool
            #if DEBUG && targetEnvironment(simulator)
                allowUnverifiedProtectionForSimulator = self.syntheticCapture != nil
                self.syntheticCapture?.close()
                self.syntheticCapture = nil
            #else
                allowUnverifiedProtectionForSimulator = false
            #endif

            let completedAt = Date()
            let fileProtection: String
            let excludedFromBackup: Bool
            do {
                let security = try RecordingFileSecurity.protect(
                    url,
                    allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
                )
                fileProtection = security.protection
                excludedFromBackup = security.excludedFromBackup
            } catch {
                fileProtection = "unknown"
                excludedFromBackup = false
            }
            guard FileManager.default.fileExists(atPath: url.path) else {
                self.resetAfterFailure()
                reject("RECORDING_FILE_MISSING", "The completed recording file could not be found.", nil)
                return
            }

            let result: [String: Any] = [
                "id": identifier,
                "durationMs": self.lastDurationMs,
                "startedAt": Self.timestamp(startDate),
                "completedAt": Self.timestamp(completedAt),
                "fileProtection": fileProtection,
                "excludedFromBackup": excludedFromBackup,
            ]
            self.status = .completed
            self.consentAcknowledged = false
            self.wasInterrupted = false
            self.emitState()
            self.deactivateAudioSession()
            resolve(result as NSDictionary)
        }
    }
}
