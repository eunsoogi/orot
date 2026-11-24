import CoreFoundation
import Foundation
import Security

/// Only an owned, unexpired Live session may activate capture or play media.
extension RealtimeVoiceCall {
    func liveIsCurrent() -> Bool {
        if let liveExpiresAt {
            return liveExpiresAt > Date()
        }
        return false
    }

    /// Presentation gets only the scalar from the currently owned active audio graph.
    func bindDisplayMeter(callID: String, captureEpoch epoch: UUID) {
        (audio as? RealtimeVoiceDisplayMeterPort)?.displayLevel = { [weak self] direction, level in
            guard let self, id == callID, captureEpoch == epoch, ready, !paused, liveIsCurrent(),
                  level.isFinite, (0 ... 1).contains(level)
            else { return }
            emit("VoiceRealtimeAudioLevel", [
                "callId": callID,
                "direction": direction == .input ? "input" : "output",
                "level": level,
            ])
        }
    }

    func receive(_ event: [String: Any]) {
        guard id != nil, let type = event["type"] as? String else { return }
        if type == "session.input_transcript.delta" || type == "session.output_transcript.delta",
           let call = id, let session = liveSessionID, let epoch = liveSocketEpoch,
           ready, !paused, token != nil, foreground(), liveIsCurrent()
        {
            observedCaptions.append(event, owner: .init(call: call, session: session, epoch: epoch))
        }
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
            // Caption collection remains independent of the managed response lease.
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
              ready, !paused, token != nil, foreground(), liveIsCurrent()
        else {
            retireManagedResponses()
            return
        }
        let owner = LiveResponsesAdmission.Owner(callID: callID, sessionID: sessionID, epoch: epoch)
        let current: () -> Bool = { [weak self, weak bridge] in
            guard let self, let bridge else { return false }
            return managedResponses === bridge && id == callID && liveSessionID == sessionID && liveSocketEpoch == epoch
                && ready && !paused && token != nil && foreground() && liveIsCurrent()
        }
        bridge.receive(event, owner: owner, current: current) { [weak self] frames, approved, ticket in
            guard let self else { ticket?.retire(); return }
            if !enqueueManagedToolFrames(frames, callID: callID, sessionID: sessionID,
                                         socketEpoch: epoch, approvedCurrent: approved, ticket: ticket)
            {
                ticket?.retire()
            }
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
        let canonicalArguments: String?

        init(owner: Owner, delegationID: String, responseID: String, functionID: String,
             name: String, query: String? = nil, topic: String? = nil, days: Int? = nil,
             canonicalArguments: String? = nil)
        {
            self.owner = owner
            self.delegationID = delegationID
            self.responseID = responseID
            self.functionID = functionID
            self.name = name
            self.query = query; self.topic = topic; self.days = days
            self.canonicalArguments = canonicalArguments
        }
    }

    let backendModel: String
    let functionName: String
    let backendAllowed: () -> Bool
    let mayRun: (Request) -> Bool
    let approve: ([Request], @escaping (Bool) -> Void) -> (() -> Void)
    let execute: (Request, @escaping (String?) -> Void) -> (() -> Void)
    /// Read-only check of a separate exact current-result grant, including at transport handoff.
    let mayDisclose: (Request, String) -> Bool
    var dispatchTicket: ((Request, String) -> LiveNativeResultDispatchAuthority.Ticket?)?
    var retireDispatch: (() -> Void)?
    // Constructed by the separate native companion mailbox; no fallback schema.
    var canonicalConfiguration: (() -> [String: Any]?)?

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
        if functionName == RealtimeVoiceCanonicalHealthAdmission.name {
            return canonicalConfiguration?()
        }
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

extension LiveResponsesToolBridge {
    static func arguments(_ payload: String, tool: String) -> [String: Any]? {
        guard payload.utf8.count <= 2048,
              let object = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return nil }
        if tool == "orot_health_context" {
            guard object.count == 2, let topic = object["topic"] as? String, LiveResponsesAdmission.healthTopics.contains(topic),
                  let raw = object["days"] as? NSNumber, CFGetTypeID(raw) != CFBooleanGetTypeID(),
                  let days = object["days"] as? Int, (3 ... 31).contains(days) else { return nil }
            return ["topic": topic, "days": days]
        }
        guard tool == "orot_reviewed_memory" else { return object.isEmpty ? object : nil }
        guard object.count == 1, let query = object["query"] as? String, query.count <= 1000,
              !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return ["query": query]
    }
}
