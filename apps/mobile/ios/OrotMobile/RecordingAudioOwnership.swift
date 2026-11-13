import Foundation
import React

extension RecordingModule {
    /// An actual background or interruption invalidates permission replies for this start.
    func cancelPendingStart() {
        guard startInProgress else { return }
        startInProgress = false
        consentAcknowledged = false
        releaseCaptureAudio()
        emitState()
    }

    @objc(pauseRecording:rejecter:)
    func pauseRecording(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        workQueue.async {
            guard self.consentAcknowledged else { reject("RECORDING_CONSENT_REQUIRED", "Recording consent is required.", nil); return }
            guard self.status == .recording else { reject("RECORDING_NOT_ACTIVE", "Only an active recording can be paused.", nil); return }
            self.recorder?.pause()
            RecordingCaptureDiagnostics.emit(.paused, clockMs: self.currentDurationMs())
            self.deactivateAudioSession()
            self.status = .paused
            self.stopTimer()
            self.emitState()
            resolve(self.snapshot())
        }
    }

    /// Pausing retains the token; only explicit resume or terminal cleanup changes ownership.
    func deactivateAudioSession() {
        guard let token = captureAudioToken else { return }
        try? AudioSessionOwnership.shared.suspend(token)
    }

    /// Retain a failed release token so a later cleanup can retry without exposing the session.
    func releaseCaptureAudio() {
        guard let token = captureAudioToken else { return }
        do {
            try AudioSessionOwnership.shared.release(token)
            captureAudioToken = nil
        } catch {}
    }

    func releasePlaybackAudio() {
        guard let token = playbackAudioToken else { return }
        do {
            try AudioSessionOwnership.shared.release(token)
            playbackAudioToken = nil
        } catch {}
    }

    func reserveCaptureAudio() throws -> AudioSessionOwnership.Token {
        if captureAudioToken != nil {
            releaseCaptureAudio()
        }
        guard captureAudioToken == nil else { throw AudioSessionOwnership.Failure.busy }
        let token = try AudioSessionOwnership.shared.reserve()
        captureAudioToken = token
        return token
    }
}
