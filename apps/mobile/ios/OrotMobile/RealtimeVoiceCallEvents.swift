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
        outputRenderStartedAt = nil
        (audio as? RealtimeVoiceDisplayMeterPort)?.displayLevel = { [weak self] direction, level in
            guard let self, id == callID, captureEpoch == epoch, ready, !paused, liveIsCurrent(),
                  level.isFinite, (0 ... 1).contains(level)
            else { return }
            if direction == .output, level > 0 {
                observeRenderedOutput()
            }
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
            let owner = LiveObservedCaptionBuffer.Owner(call: call, session: session, epoch: epoch)
            observedCaptions.append(event, owner: owner)
            if let line = observedCaptions.displayEvent(event, owner: owner) {
                emit("VoiceRealtimeTranscript", line)
            }
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
                fail(.liveSessionExpired)
            }
            beginAudio()
        case "session.delegation.created", "response.event", "session.input_transcript.delta":
            receiveManagedResponses(event)
        case "error":
            fail(.liveServerError)
        case "session.closed":
            fail(.liveServerClosed)
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
            let start = audio.isDrained ? outputRenderClock() : nil
            do {
                try audio.append(data)
                if let start {
                    outputRenderStartedAt = start
                }
                state("speaking")
            } catch { fail(.liveOutputFailed) }
        default:
            // Caption collection remains independent of the managed response lease.
            break
        }
    }
}

extension RealtimeVoiceCall {
    /// Retire the local permit only. The current Live wire has no response cancellation command.
    func retireManagedResponses() {
        managedBackgroundOwner = nil
        let previous = managedResponses
        managedResponses = nil
        previous?.retire()
    }

    func receiveManagedResponses(_ event: [String: Any]) {
        guard let bridge = managedResponses else { return }
        guard let callID = id, let sessionID = liveSessionID, let epoch = liveSocketEpoch,
              ready, !paused, token != nil, managedExecutionAllowed(), liveIsCurrent()
        else {
            retireManagedResponses()
            return
        }
        let owner = LiveResponsesAdmission.Owner(callID: callID, sessionID: sessionID, epoch: epoch)
        let current: () -> Bool = { [weak self, weak bridge] in
            guard let self, let bridge else { return false }
            return managedResponses === bridge && id == callID && liveSessionID == sessionID && liveSocketEpoch == epoch
                && ready && !paused && token != nil && managedExecutionAllowed() && liveIsCurrent()
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
        let canonicalArguments: String?

        init(owner: Owner, delegationID: String, responseID: String, functionID: String,
             name: String,
             canonicalArguments: String? = nil)
        {
            self.owner = owner
            self.delegationID = delegationID
            self.responseID = responseID
            self.functionID = functionID
            self.name = name
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
    var observeTiming: ((LiveManagedToolLatency, UInt64) -> Void)?
    // Constructed by the separate native companion mailbox; no fallback schema.
    var canonicalConfiguration: (() -> [String: Any]?)?
    var serialV3: LiveV3SerialTransitions?
    // Only an independently configured trusted authority can opt in. The shipped
    // single-source transport does not provide this factory.
    var batchProof: (@MainActor (Request, String) -> LiveNativeResultBatch.Proof?)?

    /// Same Live socket and voice model. The configured server backend model is a distinct
    /// approved choice, never inferred from the selected voice ID or the user's text model.
    func configuration() -> [String: Any]? {
        guard backendAllowed(), ["gpt-6-luna", "gpt-6-sol"].contains(backendModel),
              RealtimeVoiceToolLease.validID(functionName) else { return nil }
        guard functionName == RealtimeVoiceCanonicalHealthAdmission.name else { return nil }
        return canonicalConfiguration?()
    }
}

extension RealtimeVoiceSocket {
    func admitResponsesTransport(_ current: @escaping () -> Bool) -> Bool {
        guard current(), responsesTransportCurrent == nil else { return false }
        responsesTransportCurrent = current
        return true
    }
}

extension LiveV3SerialTransitions {
    /// Unlinked answers are ordinary after a proven wire receipt, not a new grant.
    func rejectUnlinked(_ retire: () -> Void) {
        if !allowsFreshSpeech(false) {
            retire()
        }
    }
}

extension LiveResponsesAdmission {
    func queueProofBatch(_ results: [(Request, String)], current: @escaping () -> Bool,
                         send: (@MainActor (LiveNativeResultBatch) -> Bool)?) -> Bool
    {
        guard let send, Thread.isMainThread else { return false }
        return MainActor.assumeIsolated {
            guard let batch = makeProofBatch(results, current: current) else { return false }
            guard send(batch) else { batch.retire(); return false }
            return true
        }
    }

    @MainActor
    private func makeProofBatch(_ results: [(Request, String)], current: @escaping () -> Bool) -> LiveNativeResultBatch? {
        guard let batchProof, let first = results.first?.0, current() else { return nil }
        let owner = LiveNativeResultBatch.Owner(call: first.owner.callID, session: first.owner.sessionID, epoch: first.owner.epoch,
                                                delegation: first.delegationID, response: first.responseID)
        guard results.allSatisfy({
            $0.0.owner == first.owner && $0.0.delegationID == first.delegationID && $0.0.responseID == first.responseID
        }) else { return nil }
        var proofs: [LiveNativeResultBatch.Proof] = []
        var prepared: LiveNativeResultBatch?
        defer {
            if prepared == nil {
                proofs.forEach { $0.retire(reservedByBatch: false) }
            }
        }
        for (request, text) in results {
            guard current(), let proof = batchProof(request, text) else { return nil }
            proofs.append(proof)
            guard proof.owner == owner, proof.function == request.functionID,
                  Data(proof.text.utf8) == Data(text.utf8)
            else { return nil }
        }
        prepared = LiveNativeResultBatch(owner: owner, functions: results.map(\.0.functionID), outputs: proofs, owns: {
            $0 == owner && current()
        })
        return prepared
    }
}

func liveServerErrorStage(_ event: [String: Any], handed: [(id: String, final: Bool)]) -> VoiceSystemCallLifecycle.DiagnosticStage? {
    guard event["type"] as? String == "error" else { return nil }
    guard let details = event["error"] as? [String: Any], let id = details["client_event_id"] as? String,
          id.utf8.count == 36, UUID(uuidString: id) != nil, event["client_event_id"] == nil || event["client_event_id"] as? String == id
    else { return .liveServerUnattributedError }
    let matches = handed.filter { $0.id == id }
    guard matches.count == 1 else { return .liveServerUnmatchedError }
    return matches[0].final ? .liveServerContinuationError : .liveServerFunctionOutputError
}
