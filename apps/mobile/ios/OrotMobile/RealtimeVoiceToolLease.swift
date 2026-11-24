import Security
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

/// An exact approved tool batch, retained only by its current socket queue.
final class LiveQueuedToolPermit {
    private let current: () -> Bool
    private var retired = false
    var issued = false

    init(current: @escaping () -> Bool) {
        self.current = current
    }

    /// A failed check is permanent, even if settings later return to the same values.
    func authorizeHandoff() -> Bool {
        guard !retired, current() else { retired = true; return false }
        return !retired
    }

    /// Permit only the Live Responses output envelope and a single final continuation.
    /// This is not user approval; the native owner must separately approve these exact bytes.
    func prepare(_ frames: [[String: Any]]) -> [RealtimeSocketWrite]? {
        guard (2 ... 9).contains(frames.count), authorizeHandoff() else { return nil }
        var calls = Set<String>()
        var events = Set<UUID>()
        var writes: [RealtimeSocketWrite] = []
        for (index, frame) in frames.enumerated() {
            guard let type = frame["type"] as? String,
                  let eventID = frame["event_id"] as? String, let command = UUID(uuidString: eventID),
                  events.insert(command).inserted else { return nil }
            if index == frames.count - 1 {
                guard type == "response.create", frame.count == 2 else { return nil }
            } else {
                guard type == "response.item.create", frame.count == 3,
                      let item = frame["item"] as? [String: Any], item.count == 3,
                      item["type"] as? String == "function_call_output",
                      let call = item["call_id"] as? String, RealtimeVoiceToolLease.validID(call),
                      calls.insert(call).inserted,
                      let value = item["output"] as? String, (1 ... 2048).contains(value.utf8.count)
                else { return nil }
            }
            guard let data = try? JSONSerialization.data(withJSONObject: frame),
                  let text = String(data: data, encoding: .utf8) else { return nil }
            writes.append(RealtimeSocketWrite(text: text, isInput: false, permit: self))
        }
        return writes
    }
}

/// The bridge's options identify a grant but cannot establish one. Resolve ownership from
/// all three device-bound stores; no missing, suspended, mismatched or old record can open.
struct LiveResponsesSettingsGrant {
    let backendModel: String
    let grantID: String
    let generation: String

    init?(_ payload: Any) {
        guard let object = payload as? [String: String], object.count == 3,
              let model = object["backendModel"], ["gpt-6-luna", "gpt-6-sol"].contains(model),
              let generation = object["generation"], Self.valid(generation),
              let grantID = object["grantID"], grantID == generation + "-model" else { return nil }
        backendModel = model; self.grantID = grantID; self.generation = generation
    }

    func isCurrent(key: String, read: (String, String) -> [String: Any]? = LiveResponsesSettingsGrant.read) -> Bool {
        let responses = "com.orot.mobile.settings-consent-authority.v1.voice-responses"
        let voice = "com.orot.mobile.settings-consent-authority.v1.voice"
        let credentialService = "com.orot.mobile.voice-settings.v1"
        func active(_ service: String, _ expected: String) -> Bool {
            guard let row = read(service, "settings-consent-authority"), row.count == 3 else { return false }
            return row["version"] as? Int == 1 && row["status"] as? String == "active" &&
                row["generation"] as? String == expected
        }
        guard !key.isEmpty, active(responses, generation),
              let credential = read(credentialService, "voice-settings"),
              credential["apiKey"] as? String == key,
              let owner = credential["credentialEpoch"] as? String, Self.valid(owner) else { return false }
        if credential["effectiveResponsesGeneration"] != nil {
            guard credential["effectiveResponsesGeneration"] as? String == generation,
                  let candidates = credential["pairCandidates"] as? [[String: Any]],
                  (1 ... 2).contains(candidates.count) else { return false }
            let matching = candidates.compactMap { $0["pair"] as? [String: Any] }.filter {
                $0["responsesGeneration"] as? String == generation
            }
            guard matching.count == 1, let pair = matching.first, pair.count == 6,
                  pair["version"] as? Int == 1, pair["credentialEpoch"] as? String == owner,
                  pair["speechModel"] as? String == "gpt-live-1.1", pair["backendModel"] as? String == backendModel,
                  let audio = pair["voiceGeneration"] as? String, Self.valid(audio),
                  audio != generation, active(voice, audio),
                  let finalCredential = read(credentialService, "voice-settings"),
                  finalCredential["credentialEpoch"] as? String == owner,
                  finalCredential["apiKey"] as? String == key,
                  finalCredential["effectiveResponsesGeneration"] as? String == generation else { return false }
            return active(responses, generation) && active(voice, audio)
        }
        guard let selection = read("com.orot.mobile.live-responses-settings.v1", "live-responses-settings"), selection.count == 5,
              selection["version"] as? Int == 1, selection["backendModel"] as? String == backendModel,
              selection["grantID"] as? String == grantID, selection["generation"] as? String == generation,
              selection["credentialEpoch"] as? String == owner,
              credential["mode"] as? String == "openai-api", credential["model"] as? String == "gpt-live-1.1" else { return false }
        return active(responses, generation)
    }

    private static func valid(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48 ... 57).contains($0) || (97 ... 102).contains($0) }
    }

    private static func read(_ service: String, _ account: String) -> [String: Any]? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne, kSecAttrSynchronizable as String: false]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
