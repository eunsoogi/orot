import Foundation

extension RealtimeVoiceSocket {
    static func retainingControl(_ writes: [RealtimeSocketWrite], sending: Bool) -> [RealtimeSocketWrite] {
        writes.enumerated().compactMap { index, write in
            (sending && index == 0) || !write.isInput ? write : nil
        }
    }

    static func matchesClose(_ event: [String: Any], sessionID: String, command: String) -> Bool {
        guard event["type"] as? String == "session.closed",
              let eventID = event["event_id"] as? String, !eventID.isEmpty,
              let reason = event["reason"] as? String,
              ["close_requested", "expired", "content", "remote_hangup", "connection_lost"].contains(reason),
              event["client_event_id"] == nil || event["client_event_id"] as? String == command,
              let session = event["session"] as? [String: Any]
        else { return false }
        return session["id"] as? String == sessionID && session["model"] as? String == "gpt-live-1.1"
    }
}

/// The queue records event kind before serialization; filtering never inspects audio contents.
struct RealtimeSocketWrite {
    let text: String
    let isInput: Bool
    let permit: LiveQueuedToolPermit?

    init(text: String, isInput: Bool, permit: LiveQueuedToolPermit? = nil) {
        self.text = text
        self.isInput = isInput
        self.permit = permit
    }
}
