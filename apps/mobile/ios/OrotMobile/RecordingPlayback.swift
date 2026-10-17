import AVFoundation
import Foundation
import React

/// Keeps saved and transcript-range playback on the protected-file boundary and recording queue.
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

            let url: URL
            do {
                // Only the dedicated Simulator fixture path may tolerate unavailable protection metadata.
                url = try RecordingFileSecurity.existingFileURL(
                    id: recordingID,
                    allowUnverifiedProtectionForSimulator: syntheticFixture,
                )
            } catch {
                let failure = Self.fileFailure(for: error)
                reject(failure.code, failure.message, error as NSError)
                return
            }

            let player: AVAudioPlayer
            do {
                player = try AVAudioPlayer(contentsOf: url)
            } catch {
                reject(
                    "RECORDING_FILE_INVALID",
                    "The saved audio file could not be decoded.",
                    error as NSError,
                )
                return
            }
            guard player.duration.isFinite,
                  player.duration > 0,
                  Double(end) / 1000 <= player.duration + 0.01,
                  Double(start) / 1000 < player.duration
            else {
                reject("INVALID_AUDIO_RANGE", "The audio range exceeds its recording.", nil)
                return
            }

            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                self.deactivateAudioSession()
                reject("RECORDING_AUDIO_SESSION_FAILED", error.localizedDescription, error as NSError)
                return
            }
            guard player.prepareToPlay() else {
                self.deactivateAudioSession()
                reject(
                    "RECORDING_FILE_INVALID",
                    "The saved audio file could not be prepared for playback.",
                    nil,
                )
                return
            }

            #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                RecordingPlaybackFixtureLifetime.configure(player, synthetic: syntheticFixture, start: start, end: end)
            #endif
            player.currentTime = Double(start) / 1000
            player.delegate = self
            self.playbackPlayer = player
            self.playbackResolve = resolve
            self.playbackReject = reject
            self.playbackRecordingID = recordingID
            self.playbackEndMs = end
            self.playbackResult = [
                "startMs": start,
                "endMs": end,
                "actualStartMs": Int((player.currentTime * 1000).rounded()),
            ]

            guard player.play() else {
                self.stopPlayback(
                    code: "RECORDING_PLAYBACK_FAILED",
                    message: "The recording could not start playing.",
                )
                return
            }
            self.startPlaybackProgressTimer(for: player)
            self.emitPlaybackState()
        }
    }

    /// Lets a user stop immediately; resolving the pending play promise keeps it distinct from a player failure.
    @objc(stopRecordingPlayback:rejecter:)
    func stopRecordingPlayback(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        workQueue.async {
            self.stopPlayback()
            resolve(nil)
        }
    }

    func startPlaybackProgressTimer(for player: AVAudioPlayer) {
        let timer = DispatchSource.makeTimerSource(queue: workQueue)
        // Sample the player clock and stop at the requested excerpt end instead of trusting wall time.
        timer.schedule(
            deadline: .now() + .milliseconds(50),
            repeating: .milliseconds(50),
            leeway: .milliseconds(10),
        )
        timer.setEventHandler { [weak self, weak player] in
            guard let self, let player, playbackPlayer === player else { return }
            if player.numberOfLoops == 0, let endMs = playbackEndMs,
               player.currentTime * 1000 >= Double(endMs)
            {
                player.currentTime = Double(endMs) / 1000
                stopPlayback(completed: true)
                return
            }
            emitPlaybackState()
        }
        playbackTimer = timer
        timer.resume()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        workQueue.async { [weak self, weak player] in
            guard let self, let player, playbackPlayer === player else { return }
            if flag {
                stopPlayback(completed: true)
            } else {
                stopPlayback(
                    code: "RECORDING_PLAYBACK_FAILED",
                    message: "The recording stopped before playback completed.",
                )
            }
        }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        workQueue.async { [weak self, weak player] in
            guard let self, let player, playbackPlayer === player else { return }
            stopPlayback(
                code: "RECORDING_FILE_INVALID",
                message: "The saved audio file could not be decoded.",
                error: error as NSError?,
            )
        }
    }

    private static func fileFailure(for error: Error) -> (code: String, message: String) {
        guard let fileError = error as? RecordingFileSecurityError else {
            return ("RECORDING_PLAYBACK_FAILED", "The protected recording could not be opened.")
        }
        switch fileError {
        case .recordingNotFound:
            return ("RECORDING_FILE_MISSING", "The saved recording file could not be found.")
        case .invalidAudioFile:
            return ("RECORDING_FILE_INVALID", "The saved audio file is invalid.")
        case .invalidIdentifier:
            return ("RECORDING_FILE_INVALID", "The saved recording identifier is invalid.")
        case .directoryUnavailable, .protectionNotApplied, .backupEligibilityNotApplied:
            return ("RECORDING_PLAYBACK_FAILED", "The protected recording could not be opened.")
        }
    }

    #if targetEnvironment(simulator)
        /// Posts a route-loss notification only when the dedicated test build is enabled.
        @objc(simulatePlaybackRouteLoss:rejecter:)
        func simulatePlaybackRouteLoss(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST
                workQueue.async {
                    guard self.playbackPlayer != nil else {
                        reject("PLAYBACK_NOT_ACTIVE", "Playback must be active for this probe.", nil)
                        return
                    }
                    NotificationCenter.default.post(
                        name: AVAudioSession.routeChangeNotification,
                        object: AVAudioSession.sharedInstance(),
                        userInfo: [
                            AVAudioSessionRouteChangeReasonKey:
                                AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue,
                        ],
                    )
                    self.workQueue.async { resolve(nil) }
                }
            #else
                reject("PLAYBACK_PROBE_UNAVAILABLE", "The route probe is unavailable in this build.", nil)
            #endif
        }
    #endif
}
