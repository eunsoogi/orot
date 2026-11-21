import Foundation

/// Ordered, bounded WebSocket writes; never logs authentication, remote errors or audio.
protocol RealtimeSocketPort: AnyObject {
    var received: (([String: Any]) -> Void)? { get set }
    var failed: (() -> Void)? { get set }
    func open(model: String, key: String)
    func send(_ event: [String: Any])
    func discardInput()
    func close()
    func finishLive(sessionID: String)
}

extension RealtimeSocketPort {
    func finishLive(sessionID _: String) {
        close()
    }
}

/// A redirect must never carry a user's BYOK credential to a second destination.
private final class LiveSocketSessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_: URLSession, task _: URLSessionTask, willPerformHTTPRedirection _: HTTPURLResponse,
                    newRequest _: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void)
    {
        completionHandler(nil)
    }
}

final class RealtimeVoiceSocket: RealtimeSocketPort {
    private let session = URLSession(configuration: .ephemeral, delegate: LiveSocketSessionDelegate(), delegateQueue: nil)
    private var socket: URLSessionWebSocketTask?
    private var queue: [RealtimeSocketWrite] = []
    private var bytes = 0
    private var sending = false
    private var epoch = 0
    private var closing: (sessionID: String, command: String, sent: Bool)?
    private var closeDeadline: DispatchWorkItem?
    var received: (([String: Any]) -> Void)?
    var failed: (() -> Void)?

    func open(model: String, key: String) {
        if closing != nil {
            close()
        }
        guard model == "gpt-live-1.1", socket == nil else { failed?(); return }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/live/sessions")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 1024 * 1024
        socket = task
        task.resume()
        receive(task, epoch: epoch)
    }

    func send(_ event: [String: Any]) {
        guard closing == nil else { return }
        guard socket != nil, let data = try? JSONSerialization.data(withJSONObject: event),
              let string = String(data: data, encoding: .utf8) else { failed?(); return }
        guard bytes + data.count <= 512 * 1024 else { failed?(); return }
        bytes += data.count
        queue.append(RealtimeSocketWrite(text: string, isInput: event["type"] as? String == "session.input_audio.append"))
        flush()
    }

    private func flush() {
        guard !sending, let task = socket, let message = queue.first else { return }
        sending = true
        let current = epoch
        task.send(.string(message.text)) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current, self.socket === task else { return }
                self.sending = false
                if error != nil {
                    self.transportFailed(); return
                }
                self.bytes -= self.queue.removeFirst().text.utf8.count
                if self.closing != nil {
                    self.sendClose()
                } else {
                    self.flush()
                }
            }
        }
    }

    private func receive(_ task: URLSessionWebSocketTask, epoch current: Int) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current, self.socket === task else { return }
                guard case let .success(message) = result else { self.transportFailed(); return }
                let data: Data
                switch message {
                case let .data(value): data = value
                case let .string(value): data = Data(value.utf8)
                @unknown default: self.transportFailed(); return
                }
                guard let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { self.transportFailed(); return }
                if let closing = self.closing {
                    if closing.sent, Self.matchesClose(event, sessionID: closing.sessionID, command: closing.command) {
                        self.close()
                    }
                } else {
                    self.received?(event)
                }
                if self.socket === task {
                    self.receive(task, epoch: current)
                }
            }
        }
    }

    /// Mute drops unsent audio while preserving ordered control messages. A write already handed
    /// to URLSession cannot be retracted; the Live mute command follows it on the same socket.
    func discardInput() {
        queue = Self.retainingControl(queue, sending: sending)
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
    }

    static func retainingControl(_ writes: [RealtimeSocketWrite], sending: Bool) -> [RealtimeSocketWrite] {
        writes.enumerated().compactMap { index, write in
            (sending && index == 0) || !write.isInput ? write : nil
        }
    }

    /// A stopped call keeps only its existing task long enough for one terminal command.
    func finishLive(sessionID: String) {
        guard socket != nil, closing == nil else { return }
        let current = epoch
        closing = (sessionID, UUID().uuidString, false)
        // An already handed write cannot be retracted; do not queue any other normal event.
        queue = sending ? Array(queue.prefix(1)) : []
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, epoch == current, closing != nil else { return }
            close()
        }
        closeDeadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(2), execute: timeout)
        sendClose()
    }

    private func sendClose() {
        guard !sending, let task = socket, let closing, !closing.sent else { return }
        self.closing?.sent = true
        let current = epoch
        // The command is an app-generated UUID; neither server input nor user data enters JSON.
        task.send(.string("{\"type\":\"session.close\",\"event_id\":\"\(closing.command)\"}")) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, self.epoch == current, self.socket === task, self.closing != nil else { return }
                if error != nil {
                    self.close()
                }
            }
        }
    }

    private func transportFailed() {
        if closing != nil {
            close()
        } else {
            failed?()
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

    func close() {
        epoch += 1
        closeDeadline?.cancel(); closeDeadline = nil; closing = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        queue.removeAll(); bytes = 0; sending = false
    }

    deinit { socket?.cancel(with: .goingAway, reason: nil); session.invalidateAndCancel() }
}

/// The queue records event kind before serialization; filtering never inspects audio contents.
struct RealtimeSocketWrite {
    let text: String
    let isInput: Bool
}
