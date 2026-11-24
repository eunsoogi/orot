import Foundation

/// Transport-observed fragments only; even an acknowledged close isn't final utterance evidence.
struct LiveObservedCaptionBuffer {
    struct Owner: Equatable {
        let call: String
        let session: String
        let epoch: UUID
    }

    private var owner: Owner?
    private var seen = Set<String>()
    private var lines: [[String: Any]] = []
    private var units = 0

    mutating func append(_ event: [String: Any], owner incoming: Owner) {
        guard owner == nil || owner == incoming, lines.count < 48,
              let type = event["type"] as? String,
              let eventID = event["event_id"] as? String, !eventID.isEmpty,
              eventID.utf8.count <= 128, !seen.contains(eventID),
              let delta = event["delta"] as? String, !delta.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              delta.utf16.count <= 2000, units + delta.utf16.count <= 8000 else { return }
        let role: String
        switch type {
        case "session.input_transcript.delta": role = "user"
        case "session.output_transcript.delta": role = "assistant"
        default: return
        }
        owner = incoming
        seen.insert(eventID)
        units += delta.utf16.count
        lines.append(["order": lines.count + 1, "role": role, "text": delta])
    }

    static func acknowledged(_ event: [String: Any], sessionID: String, command: String) -> Bool {
        guard event["type"] as? String == "session.closed",
              let id = event["event_id"] as? String, !id.isEmpty, id.utf8.count <= 128,
              event["client_event_id"] as? String == command,
              event["reason"] as? String == "close_requested",
              let session = event["session"] as? [String: Any] else { return false }
        return session["id"] as? String == sessionID && session["model"] as? String == "gpt-live-1.1"
    }

    mutating func take(_ expected: Owner?) -> [String: Any]? {
        defer { self = Self() }
        guard let owner, owner == expected, !lines.isEmpty else { return nil }
        let result: [String: Any] = ["callId": owner.call, "status": "observed_incomplete", "lines": lines]
        guard let encoded = try? JSONSerialization.data(withJSONObject: result),
              encoded.count <= 24_000 else { return nil }
        return result
    }
}
