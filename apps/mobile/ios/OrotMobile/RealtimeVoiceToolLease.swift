import Foundation

/// Main-queue state only. Server IDs bind one completed response to one committed input;
/// model arguments never supply user text, record identifiers, or permission to read data.
final class RealtimeVoiceToolLease {
    struct Request {
        let responseID: String
        let toolCallID: String
        let inputItemID: String
    }

    var enabled = false
    private var input: String?
    private var response: String?
    private var boundInput: String?
    private var candidate: Request?
    private(set) var pending: Request?
    private var seenTools = Set<String>()
    private var seenInputs = Set<String>()
    private var seenResponses = Set<String>()

    static func validID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.utf8.allSatisfy {
            (48 ... 57).contains($0) || (65 ... 90).contains($0) || (97 ... 122).contains($0) || $0 == 45 || $0 == 95
        }
    }

    func reset(enabled: Bool) {
        _ = invalidate()
        self.enabled = enabled
        // Keep tombstones across reopen as well: a delayed bridge reply cannot match reused IDs.
    }

    /// Consumed/cancelled IDs remain tombstoned for this call. Exhaustion disables delegation,
    /// rather than evicting IDs and accidentally accepting replayed events.
    private func remember(_ value: String, in values: inout Set<String>) -> Bool {
        guard enabled, Self.validID(value), !values.contains(value) else { return false }
        guard values.count < 64 else { enabled = false; return false }
        values.insert(value)
        return true
    }

    func commit(_ item: String?) {
        guard let item, remember(item, in: &seenInputs) else { return }
        input = item
    }

    func bind(_ next: String?) {
        guard let next, remember(next, in: &seenResponses) else { self.input = nil; return }
        guard let input else { return }
        response = next; boundInput = input; self.input = nil
    }

    func receive(responseID: String, toolCallID: String, name: String, arguments: String) {
        guard enabled, responseID == response, let boundInput, candidate == nil, pending == nil,
              name == "orot_conversation", arguments.utf8.count <= 1024,
              let data = arguments.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], object.isEmpty,
              remember(toolCallID, in: &seenTools) else { return }
        candidate = Request(responseID: responseID, toolCallID: toolCallID, inputItemID: boundInput)
    }

    /// Argument completion can also occur on interruption. Dispatch only after the response
    /// itself completed successfully; JavaScript still requires exact-payload user consent.
    func complete(_ responseID: String, successful: Bool) -> Request? {
        guard responseID == response else { return nil }
        guard successful, enabled, let candidate else { _ = invalidate(); return nil }
        pending = candidate; self.candidate = nil; response = nil; boundInput = nil
        return pending
    }

    func consume(toolCallID: String, responseID: String) -> Bool {
        guard enabled, let pending, pending.toolCallID == toolCallID, pending.responseID == responseID else { return false }
        self.pending = nil
        return true
    }

    @discardableResult
    func invalidate(keepInput: Bool = false) -> String? {
        // A response.created event has no input ID. If an unbound input is superseded,
        // its eventual response is ambiguous; disable delegation instead of guessing ownership.
        if !keepInput, input != nil {
            enabled = false
        }
        let cancelled = pending?.toolCallID
        candidate = nil; pending = nil; response = nil; boundInput = nil
        if !keepInput {
            input = nil
        }
        return cancelled
    }
}
