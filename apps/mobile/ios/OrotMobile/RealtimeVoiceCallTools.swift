import Foundation

/// Native transports only identifiers and a separately approved JS reply. It never reads
/// health stores or interprets model arguments as a delegated action or user authorization.
extension RealtimeVoiceCall {
    func cancelTools(keepInput: Bool = false) {
        if let tool = tools.invalidate(keepInput: keepInput), let id {
            emit("VoiceRealtimeToolCancelled", ["callId": id, "toolCallId": tool])
        }
    }

    func receiveTool(_ event: [String: Any]) {
        guard !paused, ready, let responseID = event["response_id"] as? String,
              responseID == response, !ignoredResponses.contains(responseID),
              let toolCallID = event["call_id"] as? String, let name = event["name"] as? String,
              let arguments = event["arguments"] as? String else { return }
        tools.receive(responseID: responseID, toolCallID: toolCallID, name: name, arguments: arguments)
    }

    func completeTools(_ result: [String: Any]?) {
        guard let result, let responseID = result["id"] as? String else { return }
        let successful = result["status"] as? String == "completed" && !paused && ready
        guard let request = tools.complete(responseID, successful: successful), let id else { return }
        emit("VoiceRealtimeToolCall", ["callId": id, "responseId": request.responseID,
                                       "toolCallId": request.toolCallID, "inputItemId": request.inputItemID])
    }

    /// The new tool port accepts only the exact current Live call, plus its separate native grant.
    func enqueueManagedToolFrames(
        _ frames: [[String: Any]], callID: String, sessionID: String, socketEpoch: UUID,
        approvedCurrent: @escaping () -> Bool,
        ticket: LiveNativeResultDispatchAuthority.Ticket? = nil,
    ) -> Bool {
        let owns = { [weak self] in
            guard let self else { return false }
            return id == callID && liveSessionID == sessionID && liveSocketEpoch == socketEpoch
                && token != nil && ready && !paused && foreground() && liveIsCurrent()
        }
        let current = { owns() && approvedCurrent() && owns() }
        if let ticket {
            return socket.sendTicketedToolFrames(frames, current: current, ticket: ticket)
        }
        return socket.sendManagedToolFrames(frames, current: current)
    }

    func resolveTool(_ identifier: String, toolCallID: String, responseID: String, output: String) -> Bool {
        guard id == identifier, !paused, ready, token != nil else { return false }
        guard foreground() else { cancelTools(); return false }
        guard output.utf8.count <= 16384,
              tools.consume(toolCallID: toolCallID, responseID: responseID) else { return false }
        socket.send(["type": "conversation.item.create", "item": ["type": "function_call_output", "call_id": toolCallID, "output": output]])
        socket.send(["type": "response.create"])
        return true
    }
}

/// Permit one independently approved local tool result per delegation. Do not
/// continue an incomplete or ambiguous response; legacy Realtime cannot use this port.
final class LiveResponsesToolBridge {
    typealias Owner = LiveResponsesAdmission.Owner
    typealias Request = LiveResponsesAdmission.Request

    private let admission: LiveResponsesAdmission
    private let registry: LiveNativeToolRegistry
    private let discard: () -> Void
    private var owner: Owner?
    private var delegation: (id: String, response: String, offset: Int, timestamp: DispatchTime?)?
    private var pending: [Request] = []
    private var received: [String: Bool] = [:]
    private var created = false, spent = false
    private var progress = 0
    private var approvalSettled = false, retired = false
    private var cancel: (() -> Void)?
    init(admission: LiveResponsesAdmission, registry: LiveNativeToolRegistry, discard: @escaping () -> Void) {
        self.admission = admission; self.registry = registry; self.discard = discard
    }

    func retire() {
        guard !retired else { return }
        retired = true
        admission.retireDispatch?()
        received.removeAll()
        let stop = cancel
        cancel = nil
        stop?()
        discard()
    }

    func receive(_ envelope: [String: Any], owner: Owner, current: @escaping () -> Bool,
                 send: @escaping ([[String: Any]], @escaping () -> Bool, LiveNativeResultDispatchAuthority.Ticket?) -> Void)
    {
        guard !retired, current(), admission.backendAllowed() else { retire(); return }
        guard self.owner == nil || self.owner == owner else { retire(); return }
        self.owner = owner
        if delegation == nil, envelope["type"] as? String == "session.input_transcript.delta" {
            return
        }
        guard let id = envelope["event_id"] as? String, RealtimeVoiceToolLease.validID(id) else { return }
        let event = envelope["event"] as? [String: Any]
        let repeatedItem = event?["item"] as? [String: Any]
        let itemKind = repeatedItem?["type"] as? String
        let scopedToolItem = envelope["type"] as? String == "response.event"
            && (envelope["delegation_id"] as? String).map { $0 == delegation?.id } == true
            && event?["type"] as? String == "response.output_item.done"
            && itemKind != "message" && itemKind != "reasoning"
        if let prior = received[id] {
            if prior || scopedToolItem {
                // Same receipt only if it still identifies the same validated request.
                // The terminal event has no output list to recover a conflicting item from.
                guard prior, scopedToolItem, let item = repeatedItem, let delegation,
                      let previous = pending.first,
                      toolRequest(item, owner: owner, delegationID: delegation.id, responseID: delegation.response) == previous
                else { retire(); return }
            }
            return
        }
        received[id] = scopedToolItem
        if envelope["type"] as? String == "session.delegation.created" {
            guard let item = envelope["delegation"] as? [String: Any], item["type"] as? String == "delegation",
                  item["target"] as? String == "responses", let delegationID = item["id"] as? String,
                  let responseID = item["response_id"] as? String, RealtimeVoiceToolLease.validID(delegationID),
                  RealtimeVoiceToolLease.validID(responseID), let offset = envelope["offset_ms"] as? Int,
                  offset >= 0 else { return }
            if let delegation {
                if delegation.id != delegationID || delegation.response != responseID {
                    retire()
                }
            } else {
                delegation = (delegationID, responseID, offset, LiveManagedToolLatency.start())
            }
            return
        }
        guard let delegation else { return }
        // New speech can revoke this local operation, never authorize it or cancel server work.
        if envelope["type"] as? String == "session.input_transcript.delta",
           let start = envelope["start_ms"] as? Int, start > delegation.offset
        {
            retire(); return
        }
        // Even an early creation event for a different delegation can make unscoped
        // response.create unsafe; do not wait for a second event to retire this owner.
        if envelope["type"] as? String == "response.event", envelope["delegation_id"] as? String != delegation.id,
           (envelope["event"] as? [String: Any])?["type"] as? String == "response.created"
        {
            retire(); return
        }
        guard !spent, envelope["type"] as? String == "response.event",
              envelope["delegation_id"] as? String == delegation.id,
              let event = envelope["event"] as? [String: Any], let type = event["type"] as? String else { return }
        if type == "response.created" {
            guard let response = event["response"] as? [String: Any],
                  response["id"] as? String == delegation.response else { retire(); return }
            created = true
            return
        }
        guard created else { return }
        if type == "response.output_item.done", let item = event["item"] as? [String: Any] {
            if item["type"] as? String == "message" || item["type"] as? String == "reasoning" {
                return
            }
            guard let request = toolRequest(item, owner: owner, delegationID: delegation.id, responseID: delegation.response)
            else { retire(); return }
            let functionID = request.functionID
            if let previous = pending.first(where: { $0.functionID == functionID }) {
                if previous != request {
                    retire()
                }
                return
            }
            // An earlier result's protected source is not re-proved after another
            // independent challenge. Reject a second call before any approval/read.
            guard pending.isEmpty else { retire(); return }
            pending.append(request)
            return
        }
        guard let response = event["response"] as? [String: Any], response["id"] as? String == delegation.response
        else { return }
        switch (type, response["status"] as? String) {
        case ("response.failed", "failed"), ("response.incomplete", "incomplete"):
            retire()
            return
        case ("response.completed", "completed") where !pending.isEmpty:
            break
        default:
            return
        }
        spent = true
        LiveManagedToolLatency.finish(.delegationToToolTerminal, since: delegation.timestamp)
        guard pending.allSatisfy(admission.mayRun), current(), admission.backendAllowed() else { retire(); return }
        cancel = admission.approve(pending, LiveManagedToolLatency.queuedApproval(admission.observeTiming) { [weak self] granted, timing in
            guard let self, !retired, !approvalSettled else { return }
            approvalSettled = true
            cancel = nil
            guard granted, current(), admission.backendAllowed() else { retire(); return }
            runBatch([], current: current, send: send, timing: timing)
        })
    }

    private func toolRequest(_ item: [String: Any], owner: Owner, delegationID: String, responseID: String) -> Request? {
        guard item["type"] as? String == "function_call", let name = item["name"] as? String,
              registry.allows(name), let functionID = item["call_id"] as? String,
              RealtimeVoiceToolLease.validID(functionID), let arguments = item["arguments"] as? String
        else { return nil }
        if name == RealtimeVoiceCanonicalHealthAdmission.name {
            return Request.canonicalHealth(owner, delegationID, responseID, functionID, arguments)
        }
        guard let fields = Self.arguments(arguments, tool: name) else { return nil }
        return Request(owner: owner, delegationID: delegationID, responseID: responseID, functionID: functionID,
                       name: name, query: fields["query"] as? String, topic: fields["topic"] as? String, days: fields["days"] as? Int)
    }

    private func runBatch(_ results: [(Request, String)], current: @escaping () -> Bool,
                          send: @escaping ([[String: Any]], @escaping () -> Bool, LiveNativeResultDispatchAuthority.Ticket?) -> Void,
                          timing: LiveManagedToolLatency.ApprovalTiming? = nil)
    {
        guard !retired, current(), admission.backendAllowed() else { retire(); return }
        if results.count == pending.count {
            let permitted = { [weak self] in
                guard let self, !retired, current(), admission.backendAllowed() else { return false }
                return results.allSatisfy { self.admission.mayDisclose($0.0, $0.1) } && current()
            }
            guard permitted() else { retire(); return }
            // response.create names no delegation. Keep this batch owned at *every*
            // transport handoff; a replacement retires queued work, and nothing retries.
            var frames: [[String: Any]] = results.map { request, value in
                ["type": "response.item.create", "event_id": UUID().uuidString,
                 "item": ["type": "function_call_output", "call_id": request.functionID, "output": value]]
            }
            frames.append(["type": "response.create", "event_id": UUID().uuidString])
            let ticket = results.count == 1 ? admission.dispatchTicket?(results[0].0, results[0].1) : nil
            guard admission.dispatchTicket == nil || ticket != nil else { retire(); return }
            send(frames, permitted, ticket)
            return
        }
        let request = pending[results.count]
        guard admission.mayRun(request) else { retire(); return }
        timing?.finish()
        cancel = admission.execute(request) { [weak self] result in
            DispatchQueue.main.async { [weak self] in
                guard let self, !retired else { return }
                let currentIndex = results.count
                guard progress == currentIndex else { return }
                progress += 1
                cancel = nil
                guard let result, !result.isEmpty, result.utf8.count <= 8192 else { retire(); return }
                runBatch(results + [(request, result)], current: current, send: send)
            }
        }
    }
}
