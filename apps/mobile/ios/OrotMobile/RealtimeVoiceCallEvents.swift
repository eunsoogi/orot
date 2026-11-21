import Foundation

/// Only an owned, unexpired Live session may activate capture or play media.
extension RealtimeVoiceCall {
    func liveIsCurrent() -> Bool {
        if let liveExpiresAt {
            return liveExpiresAt > Date()
        }
        return false
    }

    func receive(_ event: [String: Any]) {
        guard id != nil, let type = event["type"] as? String else { return }
        switch type {
        case "session.started":
            guard let startID = liveStartID, !paused,
                  event["client_event_id"] == nil || event["client_event_id"] as? String == startID,
                  let session = event["session"] as? [String: Any], let sessionID = session["id"] as? String, !sessionID.isEmpty,
                  session["model"] as? String == "gpt-live-1.1", session["status"] as? String == "active",
                  let seconds = session["expires_at"] as? Double, seconds.isFinite, seconds > Date().timeIntervalSince1970
            else { return }
            let socketEpoch = liveSocketEpoch
            liveStartID = nil
            liveSessionID = sessionID
            liveExpiresAt = Date(timeIntervalSince1970: seconds)
            liveExpiryTimer = Timer.scheduledTimer(withTimeInterval: max(0, seconds - Date().timeIntervalSince1970), repeats: false) { [weak self] _ in
                guard let self, liveSocketEpoch == socketEpoch else { return }
                fail()
            }
            beginAudio()
        case "error", "session.closed":
            fail()
        case "session.input_audio.unmuted":
            guard paused, let unmuteID = liveUnmuteID, liveIsCurrent(),
                  event["client_event_id"] as? String == unmuteID else { return }
            liveUnmuteID = nil
            paused = false
            beginAudio()
        case "session.output_audio.delta":
            guard ready, !paused, liveIsCurrent(), let encoded = event["delta"] as? String,
                  let data = Data(base64Encoded: encoded), !data.isEmpty, data.count.isMultiple(of: 2)
            else { return }
            do { try audio.append(data); state("speaking") } catch { fail() }
        default:
            // Transcript deltas are not finalized turns; never persist or bind them to the old tool lease.
            break
        }
    }

    /// Cancel local playback only. Live does not expose the legacy response/truncate commands.
    func interrupt() {
        guard id != nil else { return }
        _ = audio.cancel()
        if !paused {
            state("listening")
        }
    }
}
