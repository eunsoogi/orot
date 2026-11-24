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
    ) -> Bool {
        let owns = { [weak self] in
            guard let self else { return false }
            return id == callID && liveSessionID == sessionID && liveSocketEpoch == socketEpoch
                && token != nil && ready && !paused && foreground() && liveIsCurrent()
        }
        return socket.sendManagedToolFrames(frames) { owns() && approvedCurrent() && owns() }
    }

    /// A legacy reply is one-shot, with an independently approved exact JS output.
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

/// A bounded batch of calls to one registered parameterless app tool. Do not guess how to
/// continue incomplete or ambiguous work; no old Realtime event enables this port.
final class LiveResponsesToolBridge {
    typealias Owner = LiveResponsesAdmission.Owner
    typealias Request = LiveResponsesAdmission.Request

    private let admission: LiveResponsesAdmission
    private let discard: () -> Void
    private var owner: Owner?
    private var delegation: (id: String, response: String, offset: Int)?
    private var pending: [Request] = []
    private var received = Set<String>()
    private var created = false, spent = false
    private var progress = 0
    private var approvalSettled = false, retired = false
    private var cancel: (() -> Void)?
    init(admission: LiveResponsesAdmission, discard: @escaping () -> Void) {
        self.admission = admission; self.discard = discard
    }

    func retire() {
        guard !retired else { return }
        retired = true
        let stop = cancel
        cancel = nil
        stop?()
        discard()
    }

    func receive(_ envelope: [String: Any], owner: Owner, current: @escaping () -> Bool,
                 send: @escaping ([[String: Any]], @escaping () -> Bool) -> Void)
    {
        guard !retired, current(), admission.backendAllowed() else { retire(); return }
        guard self.owner == nil || self.owner == owner else { retire(); return }
        self.owner = owner
        guard let id = envelope["event_id"] as? String, RealtimeVoiceToolLease.validID(id),
              !received.contains(id) else { return }
        guard received.count < 64 else { retire(); return }
        received.insert(id)
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
                delegation = (delegationID, responseID, offset)
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
            // The admitted session registers exactly one function, no hosted/custom tools.
            if item["type"] as? String == "message" || item["type"] as? String == "reasoning" {
                return
            }
            guard item["type"] as? String == "function_call", let name = item["name"] as? String,
                  name == admission.functionName, let functionID = item["call_id"] as? String,
                  RealtimeVoiceToolLease.validID(functionID), let arguments = item["arguments"] as? String,
                  let fields = Self.arguments(arguments, tool: name) else { retire(); return }
            let request = Request(owner: owner, delegationID: delegation.id, responseID: delegation.response,
                                  functionID: functionID, name: name, query: fields["query"] as? String,
                                  topic: fields["topic"] as? String, days: fields["days"] as? Int)
            if let previous = pending.first(where: { $0.functionID == functionID }) {
                if previous != request {
                    retire()
                }
                return
            }
            guard pending.count < 8 else { retire(); return }
            pending.append(request)
            return
        }
        if type == "response.failed" || type == "response.incomplete" {
            retire()
            return
        }
        guard type == "response.completed", let response = event["response"] as? [String: Any],
              response["id"] as? String == delegation.response, response["status"] as? String == "completed",
              !pending.isEmpty else { return }
        // Burn the batch before any policy callback. Unknown or denied calls never resume it.
        spent = true
        guard pending.allSatisfy(admission.mayRun), current(), admission.backendAllowed() else { retire(); return }
        cancel = admission.approve(pending) { [weak self] granted in
            DispatchQueue.main.async { [weak self] in
                guard let self, !retired, !approvalSettled else { return }
                approvalSettled = true
                cancel = nil
                guard granted, current(), admission.backendAllowed() else { retire(); return }
                runBatch([], current: current, send: send)
            }
        }
    }

    private func runBatch(_ results: [(Request, String)], current: @escaping () -> Bool,
                          send: @escaping ([[String: Any]], @escaping () -> Bool) -> Void)
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
            send(frames, permitted)
            return
        }
        let request = pending[results.count]
        guard admission.mayRun(request) else { retire(); return }
        cancel = admission.execute(request) { [weak self] result in
            DispatchQueue.main.async { [weak self] in
                guard let self, !retired else { return }
                // A producer that calls back twice must not emit or continue another batch.
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
