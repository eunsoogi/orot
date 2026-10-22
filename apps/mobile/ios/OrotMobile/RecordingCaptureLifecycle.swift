import AVFoundation
import Foundation
import OSLog
import React

extension RecordingModule {
    public func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        RecordingCaptureDiagnostics.emit(flag ? .finished : .finishFailed, fileURL: recorder.url)
    }

    public func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error _: Error?) {
        workQueue.async {
            guard self.recorder === recorder, self.status == .recording else { return }
            RecordingCaptureDiagnostics.emit(.encodeFailed, clockMs: self.currentDurationMs())
            recorder.pause()
            self.deactivateAudioSession()
            self.status = .paused
            self.stopTimer()
            self.emitState()
        }
    }

    func startMicrophoneRecording(
        resolve: @escaping RCTPromiseResolveBlock,
        reject _: @escaping RCTPromiseRejectBlock,
    ) throws {
        let identifier = UUID().uuidString.lowercased()
        let url = try RecordingStartDiagnostic.run(.fileLocation) {
            try RecordingFileSecurity.fileURL(id: identifier, extension: "m4a")
        }
        pendingRecordingURL = url
        let session = AVAudioSession.sharedInstance()
        try RecordingStartDiagnostic.run(.sessionCategory) {
            try session.setCategory(.record, mode: .default, options: [])
        }
        try RecordingStartDiagnostic.run(.sessionActivation) { try session.setActive(true) }
        let recorder = try RecordingStartDiagnostic.run(.recorderInitialization) {
            try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64000,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ])
        }
        recorder.delegate = self
        // Meter only the consented local microphone session; no audio samples cross the bridge.
        recorder.isMeteringEnabled = true
        try RecordingStartDiagnostic.run(.recorderPreparation) {
            guard recorder.prepareToRecord() else { throw RecordingModuleError.prepareFailed }
        }
        _ = try RecordingStartDiagnostic.run(.fileProtection) { try RecordingFileSecurity.protect(url) }
        try RecordingStartDiagnostic.run(.recorderStart) {
            guard recorder.record() else { throw RecordingModuleError.startFailed }
        }
        self.recorder = recorder
        RecordingCaptureDiagnostics.emit(.started, clockMs: Int(recorder.currentTime * 1000))
        beginSession(identifier: identifier, url: url)
        resolve(snapshot())
    }

    #if DEBUG && targetEnvironment(simulator)
        func startSyntheticRecording(
            resolve: @escaping RCTPromiseResolveBlock,
            reject _: @escaping RCTPromiseRejectBlock,
        ) throws {
            let identifier = UUID().uuidString.lowercased()
            if syntheticStartFailurePoint == "beforeFileURL" {
                syntheticStartFailurePoint = nil
                throw RecordingModuleError.syntheticStartFailure
            }
            let url = try RecordingFileSecurity.fileURL(
                id: identifier,
                extension: "caf",
                allowUnverifiedProtectionForSimulator: true,
            )
            pendingRecordingURL = url
            let capture = try RecordingSyntheticCapture(url: url)
            syntheticCapture = capture
            if syntheticStartFailurePoint == "afterFileCreated" {
                syntheticStartFailurePoint = nil
                throw RecordingModuleError.syntheticStartFailure
            }
            _ = try RecordingFileSecurity.protect(url, allowUnverifiedProtectionForSimulator: true)
            beginSession(identifier: identifier, url: url)
            resolve(snapshot())
        }
    #endif

    func beginSession(identifier: String, url: URL) {
        recordingID = identifier
        recordingURL = url
        startedAt = Date()
        pendingRecordingURL = nil
        startInProgress = false
        lastDurationMs = 0
        status = .recording
        startTimer()
        emitState()
    }

    func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
        DispatchQueue.main.async {
            let reply: (Bool) -> Void = { granted in
                RecordingCaptureDiagnostics.emit(granted ? .permissionGranted : .permissionDenied)
                completion(granted)
            }
            if #available(iOS 17.0, *) {
                RecordingCaptureDiagnostics.emit(AVAudioApplication.shared.recordPermission == .undetermined ? .permissionFirst : .permissionKnown)
                AVAudioApplication.requestRecordPermission(completionHandler: reply)
            } else {
                RecordingCaptureDiagnostics.emit(AVAudioSession.sharedInstance().recordPermission == .undetermined ? .permissionFirst : .permissionKnown)
                AVAudioSession.sharedInstance().requestRecordPermission(reply)
            }
        }
    }
}

/// Start diagnostics contain only fixed stages/reasons and a numeric system code, never a path or audio.
private struct RecordingStartDiagnostic: LocalizedError {
    enum Stage: String {
        case fileLocation = "file_location"
        case sessionCategory = "session_category"
        case sessionActivation = "session_activation"
        case recorderInitialization = "recorder_initialization"
        case recorderPreparation = "recorder_preparation"
        case fileProtection = "file_protection"
        case recorderStart = "recorder_start"
    }

    let stage: Stage
    let reason: String
    let systemCode: Int
    var errorDescription: String? {
        "Recording start failed: stage=\(stage.rawValue) reason=\(reason) code=\(systemCode)"
    }

    static func run<T>(_ stage: Stage, operation: () throws -> T) throws -> T {
        do {
            return try operation()
        } catch {
            let failure = Self(stage: stage, reason: classify(error), systemCode: (error as NSError).code)
            let logger = Logger(subsystem: "com.orot.mobile.recording", category: "start")
            logger.error("Recording start failed stage=\(failure.stage.rawValue, privacy: .public) reason=\(failure.reason, privacy: .public) code=\(failure.systemCode, privacy: .public)")
            // The bridge receives a sanitized error too; the original may carry a private file URL.
            throw failure
        }
    }

    private static func classify(_ error: Error) -> String {
        if let security = error as? RecordingFileSecurityError {
            return switch security {
            case .directoryUnavailable: "directory_unavailable"
            case .invalidIdentifier: "invalid_identifier"
            case .recordingNotFound: "recording_not_found"
            case .invalidAudioFile: "invalid_audio_file"
            case .protectionNotApplied: "protection_not_applied"
            case .backupEligibilityNotApplied: "backup_eligibility_not_applied"
            }
        }
        if let recording = error as? RecordingModuleError {
            return switch recording {
            case .prepareFailed: "recorder_prepare_failed"
            case .startFailed: "recorder_start_failed"
            case .syntheticStartFailure: "synthetic_start_failure"
            }
        }
        return switch (error as NSError).domain {
        case NSCocoaErrorDomain, NSPOSIXErrorDomain: "filesystem_error"
        case NSOSStatusErrorDomain: "audio_system_error"
        case AVFoundationErrorDomain: "audio_framework_error"
        default: "unclassified_error"
        }
    }
}
