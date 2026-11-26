import CryptoKit
import Foundation
import UIKit

/// The shared app holds its real SQLite source epoch until native settlement.
/// The synchronous claim pins the exact approved projection to one native
/// challenge; the protected source's pre-dispatch callback retires that ticket.
final class LiveCommonV3SourcePins: @unchecked Sendable {
    typealias Request = LiveResponsesAdmission.Request
    typealias Ticket = LiveNativeResultDispatchAuthority.Ticket

    private struct Pending {
        let request: Request
        let ticket: Ticket
        var digest: SHA256.Digest?
    }

    private var pending: Pending?
    private let lock = NSLock()

    func arm(_ request: Request, _ ticket: Ticket) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard pending == nil, request.owner.callID == ticket.call else { return false }
        pending = Pending(request: request, ticket: ticket)
        return true
    }

    func claim(_ call: String, _ challenge: String, _ exact: String) -> Bool {
        guard RealtimeVoiceCanonicalHealthAdmission.validResult(exact) else { return false }
        let digest = SHA256.hash(data: Data(exact.utf8))
        lock.lock()
        defer { lock.unlock() }
        guard let current = pending, current.ticket.call == call, current.ticket.challenge == challenge,
              current.digest == nil, current.ticket.claim()
        else { return false }
        pending?.digest = digest
        return true
    }

    func matches(_ request: Request, _ exact: String) -> Bool {
        guard exact.utf8.count <= RealtimeVoiceCanonicalHealthAdmission.resultLimit else { return false }
        let digest = SHA256.hash(data: Data(exact.utf8))
        lock.lock()
        defer { lock.unlock() }
        return pending?.request == request && pending?.digest == digest
    }

    func isCurrent(call: String, session: String, delegation: String, response: String, challenge: String, function: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let current = pending, current.ticket.challenge == challenge else { return false }
        let request = current.request
        return request.owner.callID == call && request.owner.sessionID == session && request.delegationID == delegation &&
            request.responseID == response && request.functionID == function
    }

    func retire(call: String, challenge: String? = nil) {
        lock.lock()
        guard let ticket = pending?.ticket, ticket.call == call, challenge == nil || ticket.challenge == challenge else { lock.unlock(); return }
        pending = nil
        lock.unlock()
        ticket.retire()
    }
}

extension RealtimeVoiceCall {
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

extension LiveCanonicalContextV3Transport {
    nonisolated static var stock: [String: Any] {
        LiveStockHealthAttestation.stock
    }
}

/// Only exact native V3 delegation-created events enter this serial ledger.
/// No per-call tool count: the parser independently bounds retained replay identities.
struct LiveV3SerialTransitions {
    enum Decision { case allow, replay, deny }
    let reserve: (LiveResponsesAdmission.Owner, String, String, Int, Bool) -> Decision
    let resume: (LiveResponsesAdmission.Owner, String, String) -> Bool
    let stale: (String) -> Bool
    let allowsFreshSpeech: (Bool) -> Bool
    let rememberFunction: (String) -> Bool
}

@MainActor
final class LiveV3SerialLedger {
    private var seen: [String: String] = [:]
    private var responses = Set<String>()
    private var functions = Set<String>()
    private var active: (id: String, offset: Int)?

    func reserve(_ id: String, response: String, offset: Int, mayReplace: () -> Bool) -> LiveV3SerialTransitions.Decision {
        if let prior = seen[id] {
            return prior == response ? .replay : .deny
        }
        guard !responses.contains(response) else { return .deny }
        if let active, offset < active.offset || !mayReplace() {
            return .deny
        }
        seen[id] = response
        responses.insert(response)
        active = (id, offset)
        return .allow
    }

    func resume(_ id: String, response: String, mayResume: () -> Bool) -> Bool {
        guard active?.id == id, !responses.contains(response), mayResume() else { return false }
        responses.insert(response)
        return true
    }

    func stale(_ id: String) -> Bool {
        seen[id] != nil && active?.id != id
    }

    func rememberFunction(_ id: String) -> Bool {
        functions.insert(id).inserted
    }
}

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
                && token != nil && ready && !paused && managedExecutionAllowed() && liveIsCurrent()
        }
        let current = { owns() && approvedCurrent() && owns() }
        if let ticket {
            return socket.sendTicketedToolFrames(frames, current: current, ticket: ticket)
        }
        return socket.sendManagedToolFrames(frames, current: current)
    }
}

extension LiveCanonicalContextV3Transport {
    static func bounded(_ value: Any, depth: Int = 0) -> Bool {
        guard depth <= 16 else { return false }
        if let object = value as? [String: Any] {
            return object.count <= 12 && object.allSatisfy { $0.key.utf8.count <= 64 && bounded($0.value, depth: depth + 1) }
        }
        if let list = value as? [Any] {
            return list.count <= 5 && list.allSatisfy { bounded($0, depth: depth + 1) }
        }
        if let value = value as? String {
            return value.utf8.count <= 2048
        }
        return value is NSNumber
    }

    static func json(_ value: [String: Any]) -> Data? {
        try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
}

extension RealtimeVoiceCall {
    /// Record only the acknowledged V3 owner's current audio session. Merely
    /// requesting CallKit activation or opening the managed socket grants nothing.
    func acknowledgeManagedBackgroundOwner(_ owner: LiveResponsesAdmission.Owner) {
        guard foreground(), ready, !paused, managedResponsesTransport, let token,
              id == owner.callID, liveSessionID == owner.sessionID, liveSocketEpoch == owner.epoch
        else { return }
        managedBackgroundOwner = (owner, token, captureEpoch)
    }

    func canContinueAcknowledgedManagedCall() -> Bool {
        guard systemCallActive, systemCallOwner != nil, ready, !audioStarting, !paused,
              let proof = managedBackgroundOwner, token == proof.audio, captureEpoch == proof.capture,
              id == proof.owner.callID, liveSessionID == proof.owner.sessionID, liveSocketEpoch == proof.owner.epoch,
              liveIsCurrent()
        else { return false }
        return UIApplication.shared.isProtectedDataAvailable
    }

    func managedExecutionAllowed() -> Bool {
        foreground() || canContinueAcknowledgedManagedCall()
    }
}

/// Live optionally echoes the originating client command. Do not authorize any
/// same-delegation response when the provider cannot positively associate it.
extension LiveResponsesToolBridge {
    static func foreignResponseCreated(_ envelope: [String: Any], _ delegation: String) -> Bool {
        envelope["type"] as? String == "response.event" && envelope["delegation_id"] as? String != delegation && (envelope["event"] as? [String: Any])?["type"] as? String == "response.created"
    }

    static func successorResponse(_ envelope: [String: Any], _ delegation: String, _ previous: String) -> String? {
        guard envelope["type"] as? String == "response.event", envelope["delegation_id"] as? String == delegation,
              let event = envelope["event"] as? [String: Any], event["type"] as? String == "response.created",
              let response = (event["response"] as? [String: Any])?["id"] as? String, response != previous
        else { return nil }
        return response
    }

    static func resultFrames(_ results: [(Request, String)], _ continuation: String) -> [[String: Any]] {
        results.map { request, value in
            ["type": "response.item.create", "event_id": UUID().uuidString,
             "item": ["type": "function_call_output", "call_id": request.functionID, "output": value]]
        } + [["type": "response.create", "event_id": continuation]]
    }

    static func matchesContinuation(_ envelope: [String: Any], _ delegation: String, _ continuation: String) -> Bool {
        guard envelope["type"] as? String == "response.event",
              let type = (envelope["event"] as? [String: Any])?["type"] as? String,
              ["response.created", "response.output_item.done", "response.completed", "response.failed", "response.incomplete"].contains(type)
        else { return true }
        return envelope["delegation_id"] as? String == delegation && envelope["client_event_id"] as? String == continuation
    }
}
