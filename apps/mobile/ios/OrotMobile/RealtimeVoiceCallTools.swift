import Foundation

/// Permit one independently approved local tool result per response. Do not
/// continue an incomplete or ambiguous response; legacy Realtime cannot use this port.
final class LiveResponsesToolBridge {
    typealias Owner = LiveResponsesAdmission.Owner
    typealias Request = LiveResponsesAdmission.Request

    private let admission: LiveResponsesAdmission
    private let registry: LiveNativeToolRegistry
    private let discard: () -> Void
    private let sendBatch: (@MainActor (LiveNativeResultBatch) -> Bool)?
    private var owner: Owner?
    private var delegation: (id: String, response: String, offset: Int, timestamp: DispatchTime?)?
    private var pending: [Request] = []
    private var received: [String: ManagedToolEventReceipt] = [:]
    private var skippedResponses = Set<String>()
    private var created = false, spent = false
    private var progress = 0
    private var cycle: UUID?
    private var issuedContinuation: String?, incomingContinuation: String?
    private var emptyTerminal = false
    private var approvalSettled = false, retired = false
    private var cancel: (() -> Void)?
    init(admission: LiveResponsesAdmission, registry: LiveNativeToolRegistry,
         sendBatch: (@MainActor (LiveNativeResultBatch) -> Bool)? = nil, discard: @escaping () -> Void)
    {
        self.admission = admission; self.registry = registry; self.sendBatch = sendBatch; self.discard = discard
    }

    func ownsCompleted(_ request: Request) -> Bool {
        !retired && spent && owner == request.owner && delegation?.id == request.delegationID &&
            delegation?.response == request.responseID && pending.contains(request)
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
        if envelope["type"] as? String == "response.event", let old = envelope["delegation_id"] as? String,
           admission.serialV3?.stale(old) == true
        {
            return
        }
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
        let observed: ManagedToolEventReceipt = if scopedToolItem, let item = repeatedItem, let delegation {
            .identity(toolRequest(item, owner: owner, delegationID: delegation.id, responseID: delegation.response))
        } else {
            .other
        }
        if let prior = received[id] {
            guard prior.matches(observed) else { retire(); return }
            return
        }
        if admission.serialV3 != nil, received.count >= 4096 {
            retire(); return
        }
        received[id] = observed
        if envelope["type"] as? String == "session.delegation.created" {
            guard let item = envelope["delegation"] as? [String: Any], item["type"] as? String == "delegation",
                  item["target"] as? String == "responses", let delegationID = item["id"] as? String,
                  let responseID = item["response_id"] as? String, RealtimeVoiceToolLease.validID(delegationID),
                  RealtimeVoiceToolLease.validID(responseID), !skippedResponses.contains(responseID), let offset = envelope["offset_ms"] as? Int,
                  offset >= 0 else { return }
            if let serial = admission.serialV3 {
                switch serial.reserve(owner, delegationID, responseID, offset, emptyTerminal) {
                case .replay: return
                case .deny: retire(); return
                case .allow:
                    delegation = (delegationID, responseID, offset, LiveManagedToolLatency.start())
                    incomingContinuation = nil; resetRound()
                    return
                }
            }
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
           let start = envelope["start_ms"] as? Int, start > delegation.offset,
           admission.serialV3?.allowsFreshSpeech(emptyTerminal) != true
        {
            retire(); return
        }
        if Self.foreignResponseCreated(envelope, delegation.id) {
            retire(); return
        }
        if spent, let serial = admission.serialV3, let response = Self.successorResponse(envelope, delegation.id, delegation.response) {
            guard RealtimeVoiceToolLease.validID(response), !skippedResponses.contains(response) else { return }
            guard let issuedContinuation, envelope["client_event_id"] as? String == issuedContinuation
            else { skippedResponses.insert(response); serial.rejectUnlinked(retire); return }
            guard serial.resume(owner, delegation.id, response)
            else { retire(); return }
            self.delegation = (delegation.id, response, delegation.offset, LiveManagedToolLatency.start())
            incomingContinuation = issuedContinuation
            resetRound()
            created = true
            return
        }
        if let incomingContinuation, !(spent && admission.serialV3?.allowsFreshSpeech(false) == true),
           !Self.matchesContinuation(envelope, delegation.id, incomingContinuation)
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
            guard pending.isEmpty || (admission.batchProof != nil && sendBatch != nil && pending.count < 8),
                  admission.serialV3?.rememberFunction(functionID) != false else { retire(); return }
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
        case ("response.completed", "completed") where admission.serialV3 != nil && pending.isEmpty:
            emptyTerminal = true
            spent = true
            return
        default:
            return
        }
        spent = true
        LiveManagedToolLatency.finish(.delegationToToolTerminal, since: delegation.timestamp)
        guard pending.allSatisfy(admission.mayRun), current(), admission.backendAllowed() else { retire(); return }
        let expectedCycle = cycle
        cancel = admission.approve(pending, LiveManagedToolLatency.queuedApproval(admission.observeTiming) { [weak self] granted, timing in
            guard let self, !retired, cycle == expectedCycle, !approvalSettled else { return }
            approvalSettled = true
            cancel = nil
            guard granted, current(), admission.backendAllowed() else { retire(); return }
            runBatch([], current: current, send: send, timing: timing)
        })
    }

    private func resetRound() {
        pending.removeAll()
        issuedContinuation = nil; cycle = UUID()
        created = false; spent = false; approvalSettled = false; emptyTerminal = false; progress = 0
    }

    private func toolRequest(_ item: [String: Any], owner: Owner, delegationID: String, responseID: String) -> Request? {
        guard item["type"] as? String == "function_call", let name = item["name"] as? String,
              registry.allows(name), let functionID = item["call_id"] as? String,
              RealtimeVoiceToolLease.validID(functionID), let arguments = item["arguments"] as? String
        else { return nil }
        return Request.canonicalHealth(owner, delegationID, responseID, functionID, arguments)
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
            if results.count != 1 {
                let queued = admission.queueProofBatch(results, current: permitted, send: sendBatch)
                if !queued {
                    retire()
                }
                return
            }
            let continuation = UUID().uuidString
            issuedContinuation = admission.serialV3 == nil ? nil : continuation
            let frames = Self.resultFrames(results, continuation)
            let ticket = admission.dispatchTicket?(results[0].0, results[0].1)
            if admission.dispatchTicket != nil, ticket == nil {
                retire(); return
            }
            send(frames, permitted, ticket)
            return
        }
        let request = pending[results.count]
        guard admission.mayRun(request) else { retire(); return }
        timing?.finish()
        let expectedCycle = cycle
        cancel = admission.execute(request) { [weak self] result in
            DispatchQueue.main.async { [weak self] in
                guard let self, !retired, cycle == expectedCycle else { return }
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
