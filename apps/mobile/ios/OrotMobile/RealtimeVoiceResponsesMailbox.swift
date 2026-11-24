import Foundation

/// Module-owned one-use challenge. Only the active RN policy runner receives it, and neither
/// incoming event IDs nor a stock tool reply can settle it. Cancellation never returns data.
final class LiveResponsesMailbox {
    let grant: LiveResponsesSettingsGrant
    private let identifier: String, key: String
    private let authority: LiveNativeResultDispatchAuthority
    private let emit: (String, [String: Any]) -> Void
    private var pending: (id: String, request: LiveResponsesAdmission.Request, ticket: LiveNativeResultDispatchAuthority.Ticket, finish: (String?) -> Void)?
    private var approved: (LiveResponsesAdmission.Request, String, LiveNativeResultDispatchAuthority.Ticket)?
    private var revoked = false

    init(identifier: String, grant: LiveResponsesSettingsGrant, key: String, authority: LiveNativeResultDispatchAuthority,
         emit: @escaping (String, [String: Any]) -> Void)
    {
        self.identifier = identifier; self.grant = grant; self.key = key; self.emit = emit
        self.authority = authority
    }

    func admission() -> LiveResponsesAdmission {
        LiveResponsesAdmission(
            backendModel: grant.backendModel,
            functionName: "orot_health_context",
            backendAllowed: { [weak self] in self?.current() == true },
            mayRun: { [weak self] in self?.identifier == $0.owner.callID && self?.current() == true },
            approve: { _, finish in finish(true); return {} }, // RN authorizes each exact request before any read.
            execute: { [weak self] in self?.begin($0, finish: $1) ?? {} },
            mayDisclose: { [weak self] request, output in
                guard let self, current() else { return false }
                return approved?.0 == request && approved?.1 == output
            },
            dispatchTicket: { [weak self] request, output in
                guard let self, current(), let approved, approved.0 == request, approved.1 == output else { return nil }
                return approved.2
            },
            retireDispatch: { [weak self] in self?.approved?.2.retire() },
        )
    }

    private func current() -> Bool {
        !revoked && grant.isCurrent(key: key)
    }

    private func begin(_ request: LiveResponsesAdmission.Request, finish: @escaping (String?) -> Void) -> (() -> Void) {
        guard pending == nil, current(), request.owner.callID == identifier, request.name == "orot_health_context",
              let topic = request.topic, let days = request.days,
              LiveResponsesAdmission.healthTopics.contains(topic), (3 ... 31).contains(days) else { finish(nil); return {} }
        let id = UUID().uuidString
        pending = (id, request, authority.begin(call: identifier, challenge: id), finish)
        let arguments = "{\"topic\":\"\(topic)\",\"days\":\(days)}"
        emit("VoiceRealtimeManagedToolCall", ["callId": identifier, "sessionId": request.owner.sessionID, "challengeId": id,
                                              "toolCallId": request.functionID, "responseId": request.responseID,
                                              "delegationId": request.delegationID, "name": request.name, "args": arguments])
        return { [weak self] in self?.cancel(id) }
    }

    /// Acceptance is not success: resolve only after actual socket submission of both guarded frames.
    func settle(_ id: String, output: String?, completion: @escaping (Bool) -> Void) {
        guard let pending, pending.id == id, current() else { completion(false); return }
        self.pending = nil
        guard let output else {
            pending.ticket.retire(); pending.finish(nil); completion(true); return
        }
        guard LiveResponsesAdmission.validAggregate(output, days: pending.request.days),
              pending.ticket.bind({ [weak self, weak ticket = pending.ticket] success in
                  if let ticket, self?.approved?.2 === ticket {
                      self?.approved = nil
                  }
                  completion(success)
              })
        else {
            pending.ticket.retire(); pending.finish(nil); completion(false); return
        }
        approved = (pending.request, output, pending.ticket)
        pending.finish(output)
    }

    func revoke() {
        revoked = true
        approved?.2.retire()
        approved = nil
        if let id = pending?.id {
            cancel(id)
        }
    }

    private func cancel(_ id: String) {
        guard let pending, pending.id == id else { return }
        pending.ticket.retire()
        self.pending = nil
        emit("VoiceRealtimeManagedToolCancelled", ["callId": identifier, "challengeId": id])
    }
}
