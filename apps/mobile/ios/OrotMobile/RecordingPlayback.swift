import AVFoundation
import Foundation
import React

/// Keeps transcript range playback on the protected-file boundary and recording queue.
public extension RecordingModule {
    @objc(playRecordingRange:startMs:endMs:syntheticFixture:resolver:rejecter:)
    func playRecordingRange(
        _ recordingID: String,
        startMs: NSNumber,
        endMs: NSNumber,
        syntheticFixture: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            let start = startMs.intValue
            let end = endMs.intValue
            guard start >= 0, end > start else {
                reject("INVALID_AUDIO_RANGE", "The audio range is invalid.", nil)
                return
            }
            guard self.status == .idle || self.status == .completed else {
                reject("RECORDING_BUSY", "Playback is unavailable while recording.", nil)
                return
            }
            self.stopPlayback()
            do {
                // Resolve only protected files so transcript seeking uses the same local storage boundary as transcription.
                let url = try RecordingFileSecurity.existingFileURL(
                    id: recordingID,
                    allowUnverifiedProtectionForSimulator: syntheticFixture,
                )
                let player = try AVAudioPlayer(contentsOf: url)
                guard player.duration.isFinite,
                      Double(end) / 1000 <= player.duration + 0.01,
                      Double(start) / 1000 < player.duration
                else {
                    reject("INVALID_AUDIO_RANGE", "The audio range exceeds its recording.", nil)
                    return
                }
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                guard player.prepareToPlay() else {
                    self.deactivateAudioSession()
                    reject("RECORDING_PLAYBACK_FAILED", "The recording could not be prepared for playback.", nil)
                    return
                }
                player.currentTime = Double(start) / 1000
                let actualStart = Int((player.currentTime * 1000).rounded())
                guard player.play() else {
                    self.deactivateAudioSession()
                    reject("RECORDING_PLAYBACK_FAILED", "The recording could not start playing.", nil)
                    return
                }
                self.playbackPlayer = player
                self.playbackResolve = resolve
                self.playbackResult = ["startMs": start, "endMs": end, "actualStartMs": actualStart]
                let timer = DispatchSource.makeTimerSource(queue: self.workQueue)
                timer.schedule(deadline: .now() + .milliseconds(end - start))
                timer.setEventHandler { [weak self] in self?.stopPlayback() }
                self.playbackTimer = timer
                timer.resume()
            } catch {
                self.deactivateAudioSession()
                reject("RECORDING_PLAYBACK_FAILED", "The protected recording could not be played.", error as NSError)
            }
        }
    }

    func stopPlayback() {
        let hadPlayback = playbackTimer != nil || playbackPlayer != nil
        playbackTimer?.cancel()
        playbackTimer = nil
        playbackPlayer?.stop()
        playbackPlayer = nil
        if hadPlayback {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        let resolve = playbackResolve
        let result = playbackResult
        playbackResolve = nil
        playbackResult = nil
        resolve?(result)
    }
}
