import Foundation

/// Private canonical V3 transport for one existing Context read. Nothing here
/// accepts a provider-selected schema, registers a bridge, or acquires source access.
@MainActor
final class LiveCanonicalContextV3Transport {
    typealias Owner = LiveResponsesAdmission.Owner
    typealias Request = LiveResponsesAdmission.Request
    typealias Ticket = LiveNativeResultDispatchAuthority.Ticket

    static let revision = "canonical-health-context-v3"
    static let name = "local-health-context"
    private let call: String
    private let manifest: [String: Any]
    private let witness: () -> LiveConversationToolsSettingsWitness?
    private let initial: LiveConversationToolsSettingsWitness
    private let startupCurrent: (String) -> Bool
    private let owns: (Owner) -> Bool
    private let ownsRequest: (Request) -> Bool
    private let sourceTicketCurrent: (Request, String) -> Bool
    private let authority = LiveNativeResultDispatchAuthority()
    private var acknowledged: Owner?
    private var pending: (request: Request, ticket: Ticket)?
    private var used = false
    private var settling = false
    private var wireAcknowledged = false
    private var bridgeDelivery: ((String?) -> Void)?
    private weak var bridgePins: LiveCommonV3SourcePins?
    private var retired = false

    init?(call: String, requested: [String: Any], witness: @escaping () -> LiveConversationToolsSettingsWitness?,
          startupCurrent: @escaping (String) -> Bool, owns: @escaping (Owner) -> Bool,
          ownsRequest: @escaping (Request) -> Bool, sourceTicketCurrent: @escaping (Request, String) -> Bool)
    {
        guard RealtimeVoiceToolLease.validID(call), startupCurrent(call), let selected = witness() else { return nil }
        let registration = Self.registration(selected)
        guard requested.count == 10, Self.bounded(requested), Self.json(requested) == Self.json(registration),
              witness() == selected, startupCurrent(call)
        else { return nil }
        manifest = registration
        self.call = call
        initial = selected
        self.witness = witness
        self.startupCurrent = startupCurrent
        self.owns = owns
        self.ownsRequest = ownsRequest
        self.sourceTicketCurrent = sourceTicketCurrent
    }

    /// Machine reproof of the captured Settings witness; no new approval popup.
    private func isCurrent(_ owner: Owner) -> Bool {
        !retired && owner.callID == call && owns(owner) && witness() == initial && owns(owner) && !retired
    }

    private func isCurrentRequest(_ request: Request) -> Bool {
        acknowledged == request.owner && isCurrent(request.owner) && ownsRequest(request) && isCurrent(request.owner)
    }

    /// Intended only for the exact app-native session.start acknowledgement.
    func acknowledge(_ owner: Owner) -> [String: Any]? {
        guard acknowledged == nil, RealtimeVoiceToolLease.validID(owner.sessionID), isCurrent(owner), acknowledged == nil
        else { return nil }
        acknowledged = owner
        return ["callId": owner.callID, "sessionId": owner.sessionID, "registration": manifest]
    }

    /// Native session.start must advertise the static manifest before its positive session.started acknowledgement.
    func configurationForStartup() -> [String: Any]? {
        guard acknowledged == nil, !retired, startupCurrent(call), witness() == initial, startupCurrent(call),
              acknowledged == nil, !retired
        else { return nil }
        var tool = Self.stock
        tool["strict"] = false
        tool["type"] = "function"
        return ["type": "responses", "responses": ["model": initial.backendModel, "tools": [tool]]]
    }

    /// Only the nested finished function from the already-owned response may enter.
    func begin(_ request: Request) -> [String: Any]? {
        guard acknowledged == request.owner, !used, pending == nil, request.name == Self.name,
              [request.delegationID, request.responseID, request.functionID].allSatisfy(RealtimeVoiceToolLease.validID),
              let args = request.canonicalArguments, RealtimeVoiceCanonicalHealthAdmission.boundedArguments(args),
              isCurrentRequest(request), !used, pending == nil
        else { return nil }
        used = true
        guard let ticket = authority.beginV3Canonical(call: call, challenge: UUID().uuidString, current: { isCurrentRequest(request) })
        else { retire(); return nil }
        pending = (request, ticket)
        let owner = ["callId": call, "sessionId": request.owner.sessionID,
                     "delegationId": request.delegationID, "responseId": request.responseID]
        var entry = owner
        entry["challengeId"] = ticket.challenge
        entry["toolCallId"] = request.functionID
        entry["name"] = Self.name
        entry["args"] = args
        return ["owner": owner, "manifestRevision": Self.revision, "calls": [entry]]
    }

    func claim(callId: String, challenge: String) -> Bool {
        guard let pending, callId == call, pending.ticket.challenge == challenge, isCurrentRequest(pending.request)
        else { return false }
        return authority.claim(call: call, challenge: challenge)
    }

    func settle(callId: String, challenge: String, exact: String?, socket: RealtimeVoiceSocket,
                completion: @escaping (Bool) -> Void)
    {
        guard !settling, let owned = pending, callId == call, owned.ticket.challenge == challenge
        else { completion(false); return }
        settling = true
        let request = owned.request
        if exact == nil {
            retire(); completion(false); return
        }
        guard let exact, RealtimeVoiceCanonicalHealthAdmission.validResult(exact) else { retire(); completion(false); return }
        let current = { [weak self] in
            guard let self, pending?.ticket === owned.ticket, isCurrentRequest(request),
                  sourceTicketCurrent(request, exact), isCurrentRequest(request), pending?.ticket === owned.ticket
            else { return false }
            return true
        }
        guard current(), owned.ticket.bind(completion) else { retire(); completion(false); return }
        let frames: [[String: Any]] = [
            ["type": "response.item.create", "event_id": UUID().uuidString,
             "item": ["type": "function_call_output", "call_id": request.functionID, "output": exact]],
            ["type": "response.create", "event_id": UUID().uuidString],
        ]
        if !socket.sendTicketedToolFrames(frames, current: current, ticket: owned.ticket) {
            retire()
        }
    }

    func retire(callId: String, challenge: String) {
        guard callId == call, pending?.ticket.challenge == challenge else { return }
        retire()
    }

    func retire() {
        retired = true
        let old = pending?.ticket
        if let challenge = old?.challenge {
            bridgePins?.retire(call: call, challenge: challenge)
        }
        pending = nil
        bridgeDelivery = nil
        old?.retire()
    }

    func usesGrant(_ grant: String, generation: String) -> Bool {
        initial.grantID == grant && initial.generation == generation
    }

    func bridge(pins: LiveCommonV3SourcePins, emit: @escaping (String, [String: Any]) -> Void) -> LiveResponsesAdmission {
        bridgePins = pins
        let ledger = LiveV3SerialLedger()
        let allowed = { [weak self] in
            guard let self else { return false }
            if let acknowledged {
                return isCurrent(acknowledged)
            }
            return configurationForStartup() != nil
        }
        return LiveResponsesAdmission(
            backendModel: initial.backendModel, functionName: Self.name, backendAllowed: allowed,
            mayRun: { [weak self] in self?.isCurrentRequest($0) == true },
            approve: { [weak self] requests, finish in
                finish(requests.count == 1 && self?.isCurrentRequest(requests[0]) == true)
                return {}
            },
            execute: { [weak self] request, finish in
                guard let self, let body = begin(request), let ticket = pending?.ticket, pins.arm(request, ticket)
                else { finish(nil); return {} }
                bridgeDelivery = finish
                emit("VoiceRealtimeCommonToolBatch", body)
                return {}
            },
            mayDisclose: { [weak self] in self?.bridgeTicket($0, $1) != nil },
            dispatchTicket: { [weak self] in self?.bridgeTicket($0, $1) },
            retireDispatch: { [weak self] in
                if self?.wireAcknowledged == false, let challenge = self?.pending?.ticket.challenge {
                    pins.retire(call: self?.call ?? "", challenge: challenge)
                    emit("VoiceRealtimeCommonToolCancelled", ["callId": self?.call ?? "", "challengeId": challenge])
                }
                self?.retire()
            },
            canonicalConfiguration: { [weak self] in self?.configurationForStartup() },
            serialV3: LiveV3SerialTransitions(
                reserve: { [weak self] owner, id, response, offset, empty in
                    guard let self, acknowledged == owner, isCurrent(owner) else { return .deny }
                    return ledger.reserve(id, response: response, offset: offset) { self.advance(empty: empty) }
                },
                stale: ledger.stale, allowsFreshSpeech: { [weak self] in self?.canAdvance(empty: $0) == true },
                rememberFunction: ledger.rememberFunction,
            ),
        )
    }

    func settleBridge(callId: String, challenge: String, exact: String?, completion: @escaping (Bool) -> Void) {
        guard !settling, let pending, callId == call, pending.ticket.challenge == challenge, let deliver = bridgeDelivery
        else { completion(false); return }
        settling = true
        bridgeDelivery = nil
        guard let exact, RealtimeVoiceCanonicalHealthAdmission.validResult(exact), bridgeTicket(pending.request, exact) != nil,
              pending.ticket.bind({ [weak self, weak pins = bridgePins] accepted in
                  if accepted, let self, self.pending?.ticket.challenge == challenge {
                      wireAcknowledged = true
                  }
                  pins?.retire(call: callId, challenge: challenge)
                  completion(accepted)
              })
        else { retire(); deliver(nil); completion(false); return }
        deliver(exact)
    }

    private func canAdvance(empty: Bool) -> Bool {
        wireAcknowledged || (empty && !used && pending == nil)
    }

    private func advance(empty: Bool) -> Bool {
        guard canAdvance(empty: empty) else { return false }
        pending = nil
        used = false
        settling = false
        wireAcknowledged = false
        return true
    }

    private func bridgeTicket(_ request: Request, _ exact: String) -> Ticket? {
        guard let owned = pending, owned.request == request, isCurrentRequest(request),
              sourceTicketCurrent(request, exact), pending?.ticket === owned.ticket, isCurrentRequest(request)
        else { return nil }
        return owned.ticket
    }

    static func registration(_ value: LiveConversationToolsSettingsWitness) -> [String: Any] {
        ["policy": "common-tools-v3", "providerId": "openai-live-responses", "recipient": "OpenAI Responses (Live)",
         "backendModel": value.backendModel, "grantID": value.grantID, "generation": value.generation,
         "credentialEpoch": value.credentialEpoch, "voiceGeneration": value.voiceGeneration,
         "manifestRevision": revision, "tools": [stock]]
    }
}
