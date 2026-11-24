import Foundation

final class RealtimeVoiceSocket: RealtimeSocketPort {
    private let session = URLSession(configuration: .ephemeral, delegate: LiveSocketSessionDelegate(), delegateQueue: nil)
    private var socket: URLSessionWebSocketTask?
    private var queue: [RealtimeSocketWrite] = []
    private var bytes = 0
    private var sending = false
    private var epoch = 0
    private var closing: (sessionID: String, command: String, sent: Bool)?
    private var captionTerminal = LiveCaptionTerminalState()
    private var closeDeadline: DispatchWorkItem?
    var responsesTransportCurrent: (() -> Bool)?
    var received: (([String: Any]) -> Void)?
    var failed: (() -> Void)?

    func open(model: String, key: String) {
        if closing != nil {
            let current = responsesTransportCurrent
            close()
            responsesTransportCurrent = current
        }
        guard model == "gpt-live-1.1", socket == nil, captionTerminal.prepared == nil, responsesTransportCurrent?() != false else { failed?(); return }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/live/sessions")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 1024 * 1024
        socket = task
        task.resume()
        receive(task, epoch: epoch)
    }

    func send(_ event: [String: Any]) {
        // Protected Live results must not fall back to the unguarded control/audio queue.
        guard closing == nil, captionTerminal.prepared == nil, !["response.item.create", "response.create"].contains(event["type"] as? String ?? "") else { return }
        guard socket != nil, let data = try? JSONSerialization.data(withJSONObject: event),
              let string = String(data: data, encoding: .utf8) else { failed?(); return }
        guard bytes + data.count <= 512 * 1024 else { failed?(); return }
        bytes += data.count
        queue.append(RealtimeSocketWrite(text: string, isInput: event["type"] as? String == "session.input_audio.append"))
        flush()
    }

    /// Queue acceptance is not a provider receipt. Never reconnect or use a fallback transport.
    func sendManagedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool) -> Bool {
        enqueueManaged(frames, permit: LiveQueuedToolPermit(current: current))
    }

    func sendTicketedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool,
                                ticket: LiveNativeResultDispatchAuthority.Ticket) -> Bool
    {
        enqueueManaged(frames, permit: LiveQueuedToolPermit(current: current, ticket: ticket))
    }

    private func enqueueManaged(_ frames: [[String: Any]], permit: LiveQueuedToolPermit) -> Bool {
        guard closing == nil, captionTerminal.prepared == nil, let task = socket else { return false }
        let currentEpoch = epoch
        guard let writes = permit.prepare(frames), epoch == currentEpoch, socket === task, closing == nil, captionTerminal.prepared == nil,
              !queue.contains(where: { $0.permit != nil }) else { return false }
        let size = writes.reduce(0) { $0 + $1.text.utf8.count }
        guard bytes + size <= 512 * 1024 else { return false }
        if let ticket = permit.ticket {
            guard ticket.observeQueueRetirement({ [weak self, weak task, weak permit] partial in
                guard let self, let task, let permit, epoch == currentEpoch, socket === task,
                      queue.contains(where: { $0.permit === permit }) else { return }
                if partial {
                    transportFailed()
                } else {
                    discardRejected(permit)
                }
            }) else { return false }
        }
        bytes += size
        queue.append(contentsOf: writes)
        flush()
        return true
    }

    private func flush() {
        guard closing == nil, captionTerminal.prepared == nil, !sending, let task = socket, let message = queue.first else { return }
        let current = epoch
        guard responsesTransportCurrent?() != false else { transportFailed(); return }
        guard epoch == current, socket === task, captionTerminal.prepared == nil, !sending else { return }
        if let permit = message.permit {
            let allowed = permit.authorizeHandoff()
            // Authority lookup may retire this exact socket or clear its queue synchronously.
            guard epoch == current, socket === task, captionTerminal.prepared == nil, !sending, queue.first?.permit === permit else { return }
            guard allowed else { discardRejected(permit); return }
        }
        let submit = { [self] in
            message.permit?.issued = true
            sending = true
            task.send(.string(message.text)) { [weak self] error in
                DispatchQueue.main.async {
                    guard let self, self.epoch == current, self.socket === task else { return }
                    self.sending = false
                    if error != nil {
                        self.transportFailed()
                        return
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
        if let permit = message.permit, let ticket = permit.ticket {
            if !ticket.submit(submit) {
                discardRejected(permit)
            }
        } else {
            submit()
        }
    }

    private func discardRejected(_ permit: LiveQueuedToolPermit) {
        permit.ticket?.retire()
        queue.removeAll { $0.permit === permit }
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
        // A partial batch cannot be replayed after losing its authority.
        if permit.issued {
            transportFailed()
        } else {
            flush()
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
                        let confirmed = LiveObservedCaptionBuffer.acknowledged(event, sessionID: closing.sessionID, command: closing.command)
                        self.close(confirmed: confirmed)
                    }
                } else if self.captionTerminal.prepared == nil {
                    self.received?(event)
                }
                if self.socket === task {
                    self.receive(task, epoch: current)
                }
            }
        }
    }

    /// Remove protected frames before later events can resume this queue. A partial handoff is not replayable.
    func discardManagedToolFrames() -> Bool {
        let retained = sending ? 1 : 0
        queue.forEach { $0.permit?.ticket?.retire() }
        let uncertain = queue.dropFirst(retained).contains { $0.permit?.issued == true }
        queue = Array(queue.prefix(retained)) + queue.dropFirst(retained).filter { $0.permit == nil }
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
        return uncertain
    }

    /// Mute drops unsent audio while preserving ordered control messages. A write already handed
    /// to URLSession cannot be retracted; the Live mute command follows it on the same socket.
    func discardInput() {
        queue = Self.retainingControl(queue, sending: sending)
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
    }

    /// Reserve the exact terminal path before callbacks can retire the bridge.
    func prepareManagedCaptionClose(sessionID: String) -> Bool {
        guard let task = socket, closing == nil, captionTerminal.prepared == nil else { return false }
        let owner = epoch
        guard responsesTransportCurrent?() == true,
              epoch == owner, socket === task, closing == nil, captionTerminal.prepared == nil,
              let cutoff = LiveCaptionTerminalQueue.prepare(queue, sending: sending) else { return false }
        captionTerminal.prepared = sessionID
        queue = cutoff.retained
        bytes = cutoff.bytes
        cutoff.retireDiscarded()
        return epoch == owner && socket === task && captionTerminal.prepared == sessionID
    }

    func finishObservedLive(sessionID: String, completion: @escaping (Bool) -> Void) {
        guard socket != nil, closing == nil else { completion(false); return }
        guard responsesTransportCurrent == nil ? captionTerminal.prepared == nil : captionTerminal.prepared == sessionID
        else { close(); completion(false); return }
        captionTerminal.completion = completion
        finishLive(sessionID: sessionID)
    }

    /// A stopped call keeps only its existing task long enough for one terminal command.
    func finishLive(sessionID: String) {
        guard socket != nil, closing == nil else { return }
        let current = epoch
        closing = (sessionID, UUID().uuidString, false)
        captionTerminal.prepared = nil
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
        (closing == nil && captionTerminal.prepared == nil ? failed : close)?()
    }

    func close() {
        close(confirmed: false)
    }
    private func close(confirmed: Bool) {
        let observed = captionTerminal.retire()
        defer { observed?(confirmed) }
        epoch += 1
        closeDeadline?.cancel(); closeDeadline = nil; closing = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil; responsesTransportCurrent = nil
        queue.forEach { $0.permit?.ticket?.retire() }
        queue.removeAll(); bytes = 0; sending = false
    }

    deinit { socket?.cancel(with: .goingAway, reason: nil); session.invalidateAndCancel() }
}
