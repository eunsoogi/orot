import Foundation
import CoreFoundation
import Security

/// Only an owned, unexpired Live session may activate capture or play media.
extension RealtimeVoiceCall {
    func liveIsCurrent() -> Bool {
        if let liveExpiresAt {
            return liveExpiresAt > Date()
        }
        return false
    }

    func receive(_ event: [String: Any]) {
        guard id != nil, let type = event["type"] as? String else { return }
        switch type {
        case "session.started":
            guard let startID = liveStartID, !paused,
                  event["client_event_id"] == nil || event["client_event_id"] as? String == startID,
                  let session = event["session"] as? [String: Any], let sessionID = session["id"] as? String, !sessionID.isEmpty,
                  session["model"] as? String == "gpt-live-1.1", session["status"] as? String == "active",
                  let seconds = session["expires_at"] as? Double, seconds.isFinite, seconds > Date().timeIntervalSince1970
            else { return }
            let socketEpoch = liveSocketEpoch
            liveStartID = nil
            liveSessionID = sessionID
            liveExpiresAt = Date(timeIntervalSince1970: seconds)
            liveExpiryTimer = Timer.scheduledTimer(withTimeInterval: max(0, seconds - Date().timeIntervalSince1970), repeats: false) { [weak self] _ in
                guard let self, liveSocketEpoch == socketEpoch else { return }
                fail()
            }
            beginAudio()
        case "session.delegation.created", "response.event", "session.input_transcript.delta":
            receiveManagedResponses(event)
        case "error", "session.closed":
            fail()
        case "session.input_audio.unmuted":
            guard paused, let unmuteID = liveUnmuteID, liveIsCurrent(),
                  event["client_event_id"] as? String == unmuteID else { return }
            liveUnmuteID = nil
            paused = false
            beginAudio()
        case "session.output_audio.delta":
            guard ready, !paused, liveIsCurrent(), let encoded = event["delta"] as? String,
                  let data = Data(base64Encoded: encoded), !data.isEmpty, data.count.isMultiple(of: 2)
            else { return }
            do { try audio.append(data); state("speaking") } catch { fail() }
        default:
            // Transcript deltas are not finalized turns; never persist or bind them to the old tool lease.
            break
        }
    }

    /// Cancel local playback only. Live does not expose the legacy response/truncate commands.
    func interrupt() {
        guard id != nil else { return }
        retireManagedResponses()
        _ = audio.cancel()
        if !paused {
            state("listening")
        }
    }
}

extension RealtimeVoiceCall {
    /// Retire the local permit only. The current Live wire has no response cancellation command.
    func retireManagedResponses() {
        let previous = managedResponses
        managedResponses = nil
        previous?.retire()
    }

    func receiveManagedResponses(_ event: [String: Any]) {
        guard let bridge = managedResponses else { return }
        guard let callID = id, let sessionID = liveSessionID, let epoch = liveSocketEpoch,
              ready, !paused, token != nil, foreground(), liveIsCurrent() else {
            retireManagedResponses()
            return
        }
        let owner = LiveResponsesAdmission.Owner(callID: callID, sessionID: sessionID, epoch: epoch)
        let current: () -> Bool = { [weak self, weak bridge] in
            guard let self, let bridge else { return false }
            return managedResponses === bridge && id == callID && liveSessionID == sessionID && liveSocketEpoch == epoch
                && ready && !paused && token != nil && foreground() && liveIsCurrent()
        }
        bridge.receive(event, owner: owner, current: current) { [weak self] frames, approved in
            guard let self else { return }
            _ = enqueueManagedToolFrames(frames, callID: callID, sessionID: sessionID,
                                         socketEpoch: epoch, approvedCurrent: approved)
        }
    }
}

/// Internal policy port, supplied only for a current explicit Settings grant. Admitting voice audio
/// does not authorize a Responses backend, app-owned tool execution, or exact result transfer.
struct LiveResponsesAdmission {
    static let healthTopics = ["measurements"]
    struct Owner: Equatable {
        let callID: String
        let sessionID: String
        let epoch: UUID
    }

    struct Request: Equatable {
        let owner: Owner
        let delegationID: String
        let responseID: String
        let functionID: String
        let name: String
        let query: String?
        let topic: String?
        let days: Int?

        init(owner: Owner, delegationID: String, responseID: String, functionID: String,
             name: String, query: String? = nil, topic: String? = nil, days: Int? = nil) {
            self.owner = owner
            self.delegationID = delegationID
            self.responseID = responseID
            self.functionID = functionID
            self.name = name
            self.query = query; self.topic = topic; self.days = days
        }
    }

    let backendModel: String
    let functionName: String
    let backendAllowed: () -> Bool
    let mayRun: (Request) -> Bool
    let approve: ([Request], @escaping (Bool) -> Void) -> (() -> Void)
    let execute: (Request, @escaping (String?) -> Void) -> (() -> Void)
    // Read-only check of a separate exact current-result grant, including at transport handoff.
    let mayDisclose: (Request, String) -> Bool

    static func validAggregate(_ output: String, days: Int?) -> Bool {
        guard output.utf8.count <= 512,
              let data = (try? JSONSerialization.jsonObject(with: Data(output.utf8))) as? [String: Any],
              data.count == 6, data["topic"] as? String == "measurements",
              data["metric"] as? String == "heart_rate", data["unit"] as? String == "count/min",
              integer(data["days"]) == days, days != nil,
              let samples = integer(data["sampleCount"]), samples >= 3,
              let mean = integer(data["meanOfRecordedDailyMeans"]), mean >= 0 else { return false }
        return true
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return value as? Int
    }

    /// Same Live socket and voice model. The configured server backend model is a distinct
    /// approved choice, never inferred from the selected voice ID or the user's text model.
    func configuration() -> [String: Any]? {
        guard backendAllowed(), ["gpt-6-luna", "gpt-6-sol"].contains(backendModel),
              RealtimeVoiceToolLease.validID(functionName) else { return nil }
        let reviewedMemory = functionName == "orot_reviewed_memory"
        let properties: [String: Any] = reviewedMemory
            ? ["query": ["type": "string", "minLength": 1, "maxLength": 1000]] : [:]
        let health = functionName == "orot_health_context"
        let healthProperties: [String: Any] = ["topic": ["type": "string", "enum": Self.healthTopics],
                                               "days": ["type": "integer", "minimum": 3, "maximum": 31]]
        let schema: [String: Any] = ["type": "object", "properties": health ? healthProperties : properties,
                                     "required": health ? ["topic", "days"] : (reviewedMemory ? ["query"] : []),
                                     "additionalProperties": false]
        let function: [String: Any] = ["type": "function", "name": functionName, "strict": true,
                                       "description": health ? "Requests the rounded mean of daily heart-rate means for the requested period." : "Requests one explicitly enabled app capability.",
                                       "parameters": schema]
        return ["type": "responses", "responses": ["model": backendModel, "tools": [function]]]
    }
}

extension RealtimeVoiceSocket {
    func admitResponsesTransport(_ current: @escaping () -> Bool) -> Bool {
        guard current(), responsesTransportCurrent == nil else { return false }
        responsesTransportCurrent = current
        return true
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
        self.backendModel = model; self.grantID = grantID; self.generation = generation
    }

    func isCurrent(key: String, read: (String, String) -> [String: Any]? = LiveResponsesSettingsGrant.read) -> Bool {
        guard let authority = read("com.orot.mobile.settings-consent-authority.v1.voice-responses", "settings-consent-authority"),
              authority.count == 3, authority["version"] as? Int == 1, authority["status"] as? String == "active",
              authority["generation"] as? String == generation,
              let selection = read("com.orot.mobile.live-responses-settings.v1", "live-responses-settings"), selection.count == 5,
              selection["version"] as? Int == 1, selection["backendModel"] as? String == backendModel,
              selection["grantID"] as? String == grantID, selection["generation"] as? String == generation,
              let owner = selection["credentialEpoch"] as? String, Self.valid(owner),
              let credential = read("com.orot.mobile.voice-settings.v1", "voice-settings"),
              credential["mode"] as? String == "openai-api", credential["model"] as? String == "gpt-live-1.1",
              credential["apiKey"] as? String == key, credential["credentialEpoch"] as? String == owner else { return false }
        guard let finalAuthority = read("com.orot.mobile.settings-consent-authority.v1.voice-responses", "settings-consent-authority"),
              finalAuthority.count == 3, finalAuthority["version"] as? Int == 1,
              finalAuthority["status"] as? String == "active",
              finalAuthority["generation"] as? String == generation else { return false }
        return !key.isEmpty
    }

    private static func valid(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
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

extension LiveResponsesToolBridge {
    static func arguments(_ payload: String, tool: String) -> [String: Any]? {
        guard payload.utf8.count <= 2048,
              let object = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return nil }
        if tool == "orot_health_context" {
            guard object.count == 2, let topic = object["topic"] as? String, LiveResponsesAdmission.healthTopics.contains(topic),
                  let raw = object["days"] as? NSNumber, CFGetTypeID(raw) != CFBooleanGetTypeID(),
                  let days = object["days"] as? Int, (3...31).contains(days) else { return nil }
            return ["topic": topic, "days": days]
        }
        guard tool == "orot_reviewed_memory" else { return object.isEmpty ? object : nil }
        guard object.count == 1, let query = object["query"] as? String, query.count <= 1000,
              !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return ["query": query]
    }
}
