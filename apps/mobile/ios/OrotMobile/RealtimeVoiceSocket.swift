import Foundation

final class RealtimeVoiceSocket: RealtimeSocketPort {
    private let endpoint: RealtimeVoiceSocketEndpoint
    private var socket: RealtimeVoiceSocketTask?
    private var queue: [RealtimeSocketWrite] = []
    private var bytes = 0
    private var sending = false
    private var epoch = 0
    private var closing: (sessionID: String, command: String, sent: Bool)?
    private var captionTerminal = LiveSocketOwnedState()
    private var closeDeadline: DispatchWorkItem?
    var responsesTransportCurrent: (() -> Bool)?
    var received: (([String: Any]) -> Void)?
    var failed: (() -> Void)?
    var observeContinuationSend: ((LiveManagedToolLatency, UInt64) -> Void)?

    init(endpoint: RealtimeVoiceSocketEndpoint = RealtimeVoiceSocketEndpoint()) {
        self.endpoint = endpoint
    }

    func open(model: String, key: String) {
        if closing != nil {
            let current = responsesTransportCurrent
            close()
            responsesTransportCurrent = current
        }
        guard model == "gpt-live-1.1", socket == nil, captionTerminal.prepared == nil, responsesTransportCurrent?() != false, let task = endpoint.task(key: key) else { failed?(); return }
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

    func enqueueManaged(_ frames: [[String: Any]], permit: LiveQueuedToolPermit) -> Bool {
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
        let submit = { [self] (receipt: UUID?) -> Bool in
            if receipt != nil, epoch != current || socket !== task || sending || queue.first?.text != message.text || closing != nil || captionTerminal.prepared != nil {
                return false
            }
            captionTerminal.markHandoff(message, recording: endpoint.reportServerCommand != nil)
            sending = true
            let (permit, stamp) = message.continuationTiming(observed: observeContinuationSend != nil)
            task.send(.string(message.text)) { [weak self, weak permit, weak owner = message.permit, wireText = message.text, final = message.finalResultContinuation, requiresWireReceipt = message.permit?.ticket?.requiresWireReceipt == true] error in
                let end = stamp.map { _ in DispatchTime.now() }
                DispatchQueue.main.async {
                    guard let self, self.epoch == current, self.socket === task else { return }
                    if let receipt {
                        guard let owner, self.queue.first?.text == wireText else { return }
                        let accepted = owner.settleBatch(receipt, result: error == nil)
                        guard self.epoch == current, self.socket === task, self.queue.first?.text == wireText else { return }
                        if !accepted {
                            self.sending = false
                            self.discardRejected(owner)
                            return
                        }
                    }
                    guard LiveQueuedToolPermit.acceptsReceipt(requiresWireReceipt, owner: owner, final: final, succeeded: error == nil,
                                                              currentFrame: self.epoch == current && self.socket === task && self.queue.first?.permit === owner && self.queue.first?.text == wireText) else { return }
                    self.sending = false
                    if error != nil {
                        self.transportFailed()
                        return
                    }
                    self.bytes -= self.queue.removeFirst().text.utf8.count
                    permit?.reportContinuation(if: self.canReportTransportFailure, since: stamp, end: end, observe: self.observeContinuationSend)
                    if self.closing != nil {
                        self.sendClose()
                    } else {
                        self.flush()
                    }
                }
            }
            return true
        }
        if let permit = message.permit {
            if !permit.submit(submit) {
                discardRejected(permit)
            }
        } else {
            _ = submit(nil)
        }
    }

    private func discardRejected(_ permit: LiveQueuedToolPermit) {
        permit.ticket?.retire()
        permit.retireBatchIfPresent()
        queue.removeAll { $0.permit === permit }
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
        // A partial batch cannot be replayed after losing its authority.
        if permit.issued {
            transportFailed()
        } else {
            flush()
        }
    }

    private func receive(_ task: RealtimeVoiceSocketTask, epoch current: Int) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current, self.socket === task else { return }
                guard case let .success(message) = result else { self.transportFailed(); return }
                guard let event = Self.decodeSocketEvent(message) else { self.transportFailed(); return }
                if let closing = self.closing {
                    if let confirmed = Self.captionTerminalReceipt(event, closing: closing) {
                        self.close(confirmed: confirmed)
                    }
                } else if self.captionTerminal.prepared == nil {
                    self.captionTerminal.deliver(event, report: self.endpoint.reportServerCommand, to: self.received)
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
        queue.forEach { $0.permit?.retireQueueObservation() }
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
        queue.forEach { $0.permit?.retireBatchIfPresent() }
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
        task.send(Self.captionCloseMessage(command: closing.command)) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, self.epoch == current, self.socket === task, self.closing != nil else { return }
                if error != nil {
                    self.close()
                }
            }
        }
    }

    var canReportTransportFailure: Bool {
        closing == nil && captionTerminal.prepared == nil
    }

    func close(confirmed: Bool) {
        let observed = captionTerminal.retire()
        defer { observed?(confirmed) }
        epoch += 1
        closeDeadline?.cancel(); closeDeadline = nil; closing = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil; responsesTransportCurrent = nil
        queue.forEach { $0.permit?.ticket?.retire(); $0.permit?.retireBatchIfPresent() }
        queue.removeAll(); bytes = 0; sending = false
    }

    deinit { socket?.cancel(with: .goingAway, reason: nil); endpoint.invalidateAndCancel() }
}
