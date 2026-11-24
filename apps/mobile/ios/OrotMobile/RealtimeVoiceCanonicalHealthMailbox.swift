import Foundation

/// Serial, native-owned entry for the new capability, separate from the
/// legacy heart-aggregate mailbox. An options dictionary cannot authorize it.
final class RealtimeVoiceCanonicalHealthMailbox {
    struct Request: Equatable {
        let call: String
        let session: String
        let epoch: UUID
        let response: String
        let delegation: String
        let function: String
        let rawArguments: String

        var valid: Bool {
            [call, session, response, delegation, function].allSatisfy(RealtimeVoiceToolLease.validID) &&
                RealtimeVoiceCanonicalHealthAdmission.boundedArguments(rawArguments)
        }
    }

    typealias Ticket = LiveNativeResultDispatchAuthority.Ticket
    private let call: String
    private let baseline: LiveResponsesSettingsGrant
    private let capability: RealtimeVoiceCanonicalHealthAdmission
    private let authority: LiveNativeResultDispatchAuthority
    private let key: String
    private let read: (String, String) -> [String: Any]?
    private let owns: (Request) -> Bool
    private let emit: (String, [String: Any]) -> Void
    private var pending: (request: Request, ticket: Ticket, finish: (String?) -> Void)?
    private var approved: (request: Request, output: String, ticket: Ticket)?
    private var used = false
    private var retired = false

    init(call: String, baseline: LiveResponsesSettingsGrant, capability: RealtimeVoiceCanonicalHealthAdmission,
         authority: LiveNativeResultDispatchAuthority, key: String,
         read: @escaping (String, String) -> [String: Any]? = RealtimeVoiceCanonicalHealthAdmission.read,
         owns: @escaping (Request) -> Bool, emit: @escaping (String, [String: Any]) -> Void)
    {
        self.call = call
        self.baseline = baseline
        self.capability = capability
        self.authority = authority
        self.key = key
        self.read = read
        self.owns = owns
        self.emit = emit
    }

    private func current(_ request: Request) -> Bool {
        !retired && request.call == call && owns(request) &&
            capability.current(base: baseline, key: key, read: read) && owns(request)
    }

    func configuration(_ declaration: [String: Any]) -> [String: Any]? {
        guard !retired else { return nil }
        return capability.configuration(declaration, base: baseline, key: key, read: read)
    }

    func begin(_ request: Request, finish: @escaping (String?) -> Void) -> (() -> Void) {
        guard !used, pending == nil, approved == nil, request.valid, current(request) else {
            finish(nil)
            return {}
        }
        let challenge = UUID().uuidString
        guard let ticket = authority.beginCanonicalHealth(call: call, challenge: challenge, admission: capability,
                                                          base: baseline, key: key, read: read),
            current(request)
        else {
            _ = authority.retire(call: call, challenge: challenge)
            finish(nil)
            return {}
        }
        used = true
        pending = (request, ticket, finish)
        emit("VoiceRealtimeManagedToolCall", [
            "callId": call, "sessionId": request.session, "responseId": request.response,
            "delegationId": request.delegation, "toolCallId": request.function,
            "challengeId": challenge, "name": RealtimeVoiceCanonicalHealthAdmission.name,
            "args": request.rawArguments,
        ])
        return { [weak self] in self?.cancel(challenge) }
    }

    func settle(_ challenge: String, output: String?, completion: @escaping (Bool) -> Void) {
        guard let pending, pending.ticket.challenge == challenge else { completion(false); return }
        self.pending = nil
        guard let output else {
            pending.ticket.retire()
            pending.finish(nil)
            completion(true)
            return
        }
        guard current(pending.request), RealtimeVoiceCanonicalHealthAdmission.validResult(output),
              pending.ticket.bind({ [weak self, weak ticket = pending.ticket] accepted in
                  if let ticket, self?.approved?.ticket === ticket {
                      self?.approved = nil
                  }
                  completion(accepted)
              })
        else {
            pending.ticket.retire()
            pending.finish(nil)
            completion(false)
            return
        }
        approved = (pending.request, output, pending.ticket)
        pending.finish(output)
    }

    func dispatchTicket(for request: Request, exact output: String) -> Ticket? {
        guard let approved, approved.request == request, approved.output == output, current(request) else { return nil }
        return approved.ticket
    }

    func revoke() {
        retired = true
        approved?.ticket.retire()
        approved = nil
        if let challenge = pending?.ticket.challenge {
            cancel(challenge)
        }
    }

    private func cancel(_ challenge: String) {
        guard let pending, pending.ticket.challenge == challenge else { return }
        self.pending = nil
        pending.ticket.retire()
        emit("VoiceRealtimeManagedToolCancelled", ["callId": call, "challengeId": challenge])
    }
}

extension LiveResponsesAdmission.Request {
    /// Preserve exact bytes for the app's shared Conversation parser; this is
    /// only envelope validation. No local read is authorized here.
    static func canonicalHealth(_ owner: LiveResponsesAdmission.Owner, _ delegationID: String,
                                _ responseID: String, _ functionID: String, _ arguments: String) -> Self?
    {
        guard RealtimeVoiceCanonicalHealthAdmission.boundedArguments(arguments) else { return nil }
        return Self(owner: owner, delegationID: delegationID, responseID: responseID, functionID: functionID,
                    name: RealtimeVoiceCanonicalHealthAdmission.name, canonicalArguments: arguments)
    }
}

extension RealtimeVoiceCanonicalHealthMailbox {
    /// This admission feeds the same single-delegation/current-socket send as
    /// the aggregate. The companion mailbox alone may mint a typed ticket.
    func bridge(backendModel: String, declaration: [String: Any]) -> LiveResponsesAdmission {
        func mailboxRequest(_ request: LiveResponsesAdmission.Request) -> Request? {
            guard request.name == RealtimeVoiceCanonicalHealthAdmission.name,
                  let raw = request.canonicalArguments else { return nil }
            return Request(call: request.owner.callID, session: request.owner.sessionID, epoch: request.owner.epoch,
                           response: request.responseID, delegation: request.delegationID,
                           function: request.functionID, rawArguments: raw)
        }
        let valid: (LiveResponsesAdmission.Request) -> Bool = { [weak self] request in
            guard let self, let value = mailboxRequest(request) else { return false }
            return value.valid && current(value)
        }
        return LiveResponsesAdmission(
            backendModel: backendModel,
            functionName: RealtimeVoiceCanonicalHealthAdmission.name,
            backendAllowed: { [weak self] in self?.configuration(declaration) != nil },
            mayRun: valid,
            approve: { requests, finish in
                finish(requests.count == 1 && requests.allSatisfy(valid))
                return {}
            },
            execute: { [weak self] request, finish in
                guard let self, let value = mailboxRequest(request) else { finish(nil); return {} }
                return begin(value, finish: finish)
            },
            mayDisclose: { [weak self] request, exact in
                guard let value = mailboxRequest(request) else { return false }
                return self?.dispatchTicket(for: value, exact: exact) != nil
            },
            dispatchTicket: { [weak self] request, exact in
                guard let value = mailboxRequest(request) else { return nil }
                return self?.dispatchTicket(for: value, exact: exact)
            },
            retireDispatch: { [weak self] in self?.revoke() },
            canonicalConfiguration: { [weak self] in self?.configuration(declaration) },
        )
    }
}

/// Exactly one mailbox instance and purpose per active call. A stale call ID
/// cannot settle or retire the successor, even if both use the same base grant.
struct OwnedLiveResponsesMailbox {
    enum Mode {
        case aggregate(LiveResponsesMailbox)
        case canonical(RealtimeVoiceCanonicalHealthMailbox, LiveResponsesSettingsGrant)
    }

    let identifier: String
    let mode: Mode

    var grant: LiveResponsesSettingsGrant {
        switch mode {
        case let .aggregate(mailbox): mailbox.grant
        case let .canonical(_, grant): grant
        }
    }

    func settle(call: String, challenge: String, output: String?, finish: @escaping (Bool) -> Void) {
        guard identifier == call else { finish(false); return }
        switch mode {
        case let .aggregate(mailbox): mailbox.settle(challenge, output: output, completion: finish)
        case let .canonical(mailbox, _): mailbox.settle(challenge, output: output, completion: finish)
        }
    }

    func revoke() {
        switch mode {
        case let .aggregate(mailbox): mailbox.revoke()
        case let .canonical(mailbox, _): mailbox.revoke()
        }
    }
}
