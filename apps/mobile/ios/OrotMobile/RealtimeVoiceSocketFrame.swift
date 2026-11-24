import Foundation

/// Ordered, bounded WebSocket writes; never logs authentication, remote errors or audio.
protocol RealtimeSocketPort: AnyObject {
    var received: (([String: Any]) -> Void)? { get set }
    var failed: (() -> Void)? { get set }
    func open(model: String, key: String)
    func admitResponsesTransport(_ current: @escaping () -> Bool) -> Bool
    func send(_ event: [String: Any])
    func sendManagedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool) -> Bool
    func sendTicketedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool,
                                ticket: LiveNativeResultDispatchAuthority.Ticket) -> Bool
    func discardManagedToolFrames() -> Bool
    func discardInput()
    func close()
    func finishLive(sessionID: String)
    func prepareManagedCaptionClose(sessionID: String) -> Bool
    func finishObservedLive(sessionID: String, completion: @escaping (Bool) -> Void)
}

extension RealtimeSocketPort {
    func prepareManagedCaptionClose(sessionID _: String) -> Bool { false }

    func finishObservedLive(sessionID: String, completion: @escaping (Bool) -> Void) {
        finishLive(sessionID: sessionID)
        completion(false)
    }
}

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

/// An issued permit can outlive a removed first frame of a batch. Closing may
/// never retain one. A previously handed ordinary write can finish, but nothing
/// queued is resubmitted after reservation.
struct LiveCaptionTerminalQueue {
    let retained: [RealtimeSocketWrite]
    let bytes: Int
    let retireDiscarded: () -> Void

    static func prepare(_ writes: [RealtimeSocketWrite], sending: Bool) -> Self? {
        guard (!sending || !writes.isEmpty),
              !writes.contains(where: { $0.permit?.issued == true }),
              !sending || writes.first?.permit == nil else { return nil }
        let retained = Array(writes.prefix(sending ? 1 : 0))
        let discarded = writes.dropFirst(retained.count)
        return .init(retained: retained, bytes: retained.reduce(0) { $0 + $1.text.utf8.count }) {
            discarded.forEach { $0.permit?.ticket?.retire() }
        }
    }
}
