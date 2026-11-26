import CryptoKit
import Foundation

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
    /// Frozen stock Conversation definition (rag), compared by exact canonical JSON.
    /// Keep in sync with healthContextToolDefinition; no JS/server schema substitution.
    static var stock: [String: Any] {
        let string = ["type": "string"]
        let integer = ["type": "integer"]
        let dose: [String: Any] = [
            "type": "object", "required": ["page", "pageSize"], "additionalProperties": false,
            "properties": ["medicationName": string, "page": integer, "pageSize": integer],
        ]
        let window: [String: Any] = [
            "type": "object", "required": ["fromInclusive", "toExclusive", "timeZone"], "additionalProperties": false,
            "description": "Period for selected topics: explicit ISO instant fromInclusive and toExclusive, IANA timeZone. Omit days. Optional doseHistory { medicationName?: exact name, page: zero-based integer, pageSize: 1-20 } is medications-only.",
            "properties": ["fromInclusive": string, "toExclusive": string, "timeZone": string, "doseHistory": dose],
        ]
        let properties: [String: Any] = [
            "days": ["type": "integer", "description": "Positive local calendar days only for a requested relative period; omit for all available history."],
            "topics": ["type": "array", "minItems": 1, "maxItems": 5,
                       "items": ["type": "string", "enum": ["medications", "measurements", "activity", "sleep", "symptoms"]]],
            "detail": ["type": "string", "enum": ["summary", "weekly", "daily"]], "window": window,
        ]
        return [
            "name": name,
            "description": "Read longitudinal health context across all available imported history by default. Specify positive calendar days or an explicit window only when the requested clinical period is narrower. For broad summaries choose topics and summary, weekly, or daily detail. Step sensor sums are separate, not merged totals. Measurements include heart-rate sample ranges grouped by time overlap with already imported workout intervals, not proof of exercise, rest or causation. No new HealthKit reads are performed." +
                " Explicit windows are [fromInclusive, toExclusive) ISO instants in an IANA time zone. Convert calendar boundaries using the requested zone." +
                " Medication doseHistory supports an exact medicationName and nonnegative page with pageSize 1-20. Follow hasMore. Registration and scheduled times are not intake; absent events are unknown.",
            "parameters": ["type": "object", "additionalProperties": false, "properties": properties],
        ]
    }
}
