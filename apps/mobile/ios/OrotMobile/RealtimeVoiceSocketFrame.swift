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
    func prepareManagedCaptionClose(sessionID _: String) -> Bool {
        false
    }

    func finishObservedLive(sessionID: String, completion: @escaping (Bool) -> Void) {
        finishLive(sessionID: sessionID)
        completion(false)
    }
}

extension RealtimeVoiceSocket {
    /// Queue acceptance is not a provider receipt. Never reconnect or use a fallback transport.
    func sendManagedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool) -> Bool {
        enqueueManaged(frames, permit: LiveQueuedToolPermit(current: current))
    }

    func sendTicketedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool,
                                ticket: LiveNativeResultDispatchAuthority.Ticket) -> Bool
    {
        enqueueManaged(frames, permit: LiveQueuedToolPermit(current: current, ticket: ticket))
    }

    func close() {
        close(confirmed: false)
    }

    @MainActor
    func sendTicketedToolBatch(_ batch: LiveNativeResultBatch) -> Bool {
        guard let frames = batch.reserveWireFrames() else { return false }
        let permit = LiveQueuedToolPermit(current: { true }, batch: batch)
        guard enqueueManaged(frames, permit: permit) else { batch.retire(); return false }
        return true
    }

    func transportFailed() {
        (canReportTransportFailure ? failed : close)?()
    }

    static func decodeSocketEvent(_ message: URLSessionWebSocketTask.Message) -> [String: Any]? {
        let data: Data
        switch message {
        case let .data(value): data = value
        case let .string(value): data = Data(value.utf8)
        @unknown default: return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// The command is an app-generated UUID; neither server input nor user data enters JSON.
    static func captionCloseMessage(command: String) -> URLSessionWebSocketTask.Message {
        .string("{\"type\":\"session.close\",\"event_id\":\"\(command)\"}")
    }

    static func retainingControl(_ writes: [RealtimeSocketWrite], sending: Bool) -> [RealtimeSocketWrite] {
        writes.enumerated().compactMap { index, write in
            (sending && index == 0) || !write.isInput ? write : nil
        }
    }

    /// nil keeps the terminal receive open; false is a cleanup receipt only.
    static func captionTerminalReceipt(_ event: [String: Any], closing: (sessionID: String, command: String, sent: Bool)) -> Bool? {
        guard closing.sent, matchesClose(event, sessionID: closing.sessionID, command: closing.command) else { return nil }
        return LiveObservedCaptionBuffer.acknowledged(event, sessionID: closing.sessionID, command: closing.command)
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
    private let isFinalContinuation: Bool

    init(text: String, isInput: Bool, permit: LiveQueuedToolPermit? = nil, isFinalContinuation: Bool = false) {
        self.text = text
        self.isInput = isInput
        self.permit = permit
        self.isFinalContinuation = isFinalContinuation
    }

    /// Only the validated, ticketed final write can start a transport observation.
    func continuationTiming(observed: Bool) -> (LiveQueuedToolPermit?, DispatchTime?) {
        guard isFinalContinuation, let permit, permit.ticket != nil else { return (nil, nil) }
        return (permit, observed ? .now() : LiveManagedToolLatency.start())
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
        guard !sending || !writes.isEmpty,
              !writes.contains(where: { $0.permit?.issued == true }),
              !sending || writes.first?.permit == nil else { return nil }
        let retained = Array(writes.prefix(sending ? 1 : 0))
        let discarded = writes.dropFirst(retained.count)
        return .init(retained: retained, bytes: retained.reduce(0) { $0 + $1.text.utf8.count }) {
            discarded.forEach { $0.permit?.ticket?.retire(); $0.permit?.retireBatchIfPresent() }
        }
    }
}

/// A graceful caption reservation never makes ordinary transport reentrant.
struct LiveCaptionTerminalState {
    var prepared: String?
    var completion: ((Bool) -> Void)?

    mutating func retire() -> ((Bool) -> Void)? {
        defer { self = Self() }
        return completion
    }
}

/** The real queue owns one reference-identity task per epoch. The host-only
 * constructor substitutes only the physical submission and receive boundary. */
protocol RealtimeVoiceSocketTask: AnyObject {
    func resume()
    @preconcurrency func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void)
    @preconcurrency func receive(completionHandler: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
}

extension URLSessionWebSocketTask: RealtimeVoiceSocketTask {}

final class RealtimeVoiceSocketEndpoint {
    private let session: URLSession?
    #if OROT_TESTS && targetEnvironment(simulator)
        private let fixture: (() -> RealtimeVoiceSocketTask)?
    #endif

    init() {
        session = URLSession(configuration: .ephemeral, delegate: LiveSocketSessionDelegate(), delegateQueue: nil)
        #if OROT_TESTS && targetEnvironment(simulator)
            fixture = nil
        #endif
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        init(networklessTask: @escaping () -> RealtimeVoiceSocketTask) {
            session = nil
            fixture = networklessTask
        }
    #endif

    func task(key: String) -> RealtimeVoiceSocketTask? {
        #if OROT_TESTS && targetEnvironment(simulator)
            if let fixture {
                return fixture()
            }
        #endif
        guard let session else { return nil }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/live/sessions")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 1024 * 1024
        return task
    }

    func invalidateAndCancel() {
        session?.invalidateAndCancel()
    }
}
