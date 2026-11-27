import AVFoundation
import Foundation

/// Preserve the real native completion reason and clock before releasing the player and resolving its promise.
/// Explicit stop and natural/range completion remain distinguishable; errors still reject the original promise.
public extension RecordingModule {
    /// Called only on the recording queue. Seek never opens, starts, or replaces a player.
    func seekCurrentPlayback(_ recordingID: String, seekID: String, position: Double) -> Bool {
        guard !seekID.isEmpty, seekID == playbackResult?["seekID"] as? String,
              recordingID == playbackRecordingID, let player = playbackPlayer,
              player.isPlaying, let end = playbackEndMs, end > 0,
              position.isFinite, position >= 0, position <= Double(end)
        else { return false }
        player.currentTime = min(position / 1000, Double(end - 1) / 1000, max(0, player.duration - 0.001))
        emitPlaybackState()
        return true
    }

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
        releasePlaybackAudio()

        let resolve = playbackResolve
        let reject = playbackReject
        var result = playbackResult as? [String: Any]
        result?.removeValue(forKey: "seekID")
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
