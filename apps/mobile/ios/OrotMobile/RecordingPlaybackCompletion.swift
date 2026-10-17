import AVFoundation
import Foundation

/// Preserve the real native completion reason and clock before releasing the player and resolving its promise.
/// Explicit stop and natural/range completion remain distinguishable; errors still reject the original promise.
public extension RecordingModule {
    func stopPlayback(
        completed: Bool = false,
        code: String? = nil,
        message: String? = nil,
        error: NSError? = nil,
    ) {
        let player = playbackPlayer
        let hadPlayback = player != nil || playbackTimer != nil || playbackResolve != nil
        guard hadPlayback else { return }

        playbackTimer?.cancel()
        playbackTimer = nil
        player?.delegate = nil
        let observedEnd = completed ? min(player?.duration ?? 0, Double(playbackEndMs ?? 0) / 1000) : (player?.currentTime ?? 0)
        player?.stop()
        playbackPlayer = nil
        deactivateAudioSession()

        let resolve = playbackResolve
        let reject = playbackReject
        var result = playbackResult as? [String: Any]
        result?["completion"] = completed ? "completed" : "stopped"
        result?["actualEndMs"] = Int((observedEnd * 1000).rounded())
        playbackResolve = nil
        playbackReject = nil
        playbackResult = nil
        playbackRecordingID = nil
        playbackEndMs = nil
        emitPlaybackState()

        if let code, let reject {
            reject(code, message ?? "The recording could not be played.", error)
        } else {
            resolve?(result)
        }
    }
}
