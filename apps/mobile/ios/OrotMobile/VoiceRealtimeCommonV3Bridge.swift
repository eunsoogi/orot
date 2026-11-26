import Foundation
import React

extension VoiceRealtimeModule {
    /// These process-local methods never wait for main or inspect any health data.
    @objc(claimLiveResponsesResult:challengeId:)
    func claimLiveResponsesResult(_ identifier: String, challengeId: String) -> NSNumber {
        NSNumber(value: resultAuthority.claim(call: identifier, challenge: challengeId))
    }

    @objc(retireLiveResponsesResult:challengeId:)
    func retireLiveResponsesResult(_ identifier: String, challengeId: String) -> NSNumber {
        NSNumber(value: resultAuthority.retire(call: identifier, challenge: challengeId))
    }
}

extension VoiceRealtimeModule {
    @MainActor
    func prepareCommonV3(_ callId: String, model: String, key: String, options: NSDictionary) -> LiveResponsesAdmission? {
        guard model == "gpt-live-1.1", commonV3 == nil,
              let registration = options["commonToolsRegistration"] as? [String: Any],
              let backend = registration["backendModel"] as? String,
              let generation = registration["generation"] as? String,
              let grantID = registration["grantID"] as? String,
              let base = LiveResponsesSettingsGrant(["backendModel": backend, "generation": generation, "grantID": grantID])
        else { return nil }
        guard options["responsesGrant"] == nil else { return nil }
        let pins = commonSourcePins
        guard let transport = LiveCanonicalContextV3Transport(
            call: callId, requested: registration,
            witness: { LiveConversationToolsSettingsWitness.readCurrent(base: base, key: key) },
            startupCurrent: { [weak self] callId in
                guard let self, call.foreground() else { return false }
                return (active == nil && call.id == nil) || (active == callId && call.id == callId && call.token != nil)
            },
            owns: { [weak self] owner in self?.ownsCommonV3(owner) == true },
            ownsRequest: { [weak self] request in self?.call.managedResponses?.ownsCompleted(request) == true },
            sourceTicketCurrent: pins.matches
        ) else { return nil }
        commonV3 = transport
        return transport.bridge(pins: pins) { [weak self] event, body in self?.sendEvent(withName: event, body: body) }
    }

    @MainActor
    private func ownsCommonV3(_ owner: LiveResponsesAdmission.Owner) -> Bool {
        active == owner.callID && call.id == owner.callID && call.liveSessionID == owner.sessionID &&
            call.liveSocketEpoch == owner.epoch && call.ready && !call.paused && call.token != nil &&
            call.foreground() && call.liveIsCurrent()
    }

    /// The existing open completes only after the exact Live session.started and audio admission.
    @MainActor
    func acknowledgeCommonV3(_ identifier: String) -> Bool {
        guard let commonV3 else { return true }
        guard let session = call.liveSessionID, let epoch = call.liveSocketEpoch,
              let ack = commonV3.acknowledge(.init(callID: identifier, sessionID: session, epoch: epoch))
        else { retireCommonV3(identifier); return false }
        sendEvent(withName: "VoiceRealtimeCommonToolsReady", body: ack)
        return true
    }

    @MainActor
    func retireCommonV3(_ identifier: String) {
        guard active == identifier else { return }
        commonSourcePins.retire(call: identifier)
        commonV3?.retire()
        commonV3 = nil
    }

    @MainActor
    func revokeCommonV3(grantID: String, generation: String) {
        guard let identifier = active, commonV3?.usesGrant(grantID, generation: generation) == true else { return }
        call.retireManagedResponses()
        retireCommonV3(identifier)
    }

    @objc(readLiveCommonConversationToolsWitness:rejecter:)
    func readLiveCommonConversationToolsWitness(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { resolve(LiveConversationToolsSettingsWitness.readSelected()?.bridgeFields) }
    }

    @objc(claimLiveCommonConversationResult:challengeId:exactOutput:)
    func claimLiveCommonConversationResult(_ call: String, challengeId: String, exactOutput: String) -> NSNumber {
        NSNumber(value: commonSourcePins.claim(call, challengeId, exactOutput))
    }

    @objc(retireLiveCommonConversationResult:challengeId:)
    func retireLiveCommonConversationResult(_ call: String, challengeId: String) -> NSNumber {
        commonSourcePins.retire(call: call, challenge: challengeId)
        return NSNumber(value: true)
    }

    @objc(isLiveCommonConversationToolCurrent:sessionId:delegationId:responseId:challengeId:toolCallId:)
    func isLiveCommonConversationToolCurrent(_ call: String, sessionId: String, delegationId: String, responseId: String, challengeId: String, toolCallId: String) -> NSNumber {
        NSNumber(value: commonSourcePins.isCurrent(call: call, session: sessionId, delegation: delegationId, response: responseId, challenge: challengeId, function: toolCallId))
    }

    @objc(settleLiveCommonConversationResult:challengeId:output:resolver:rejecter:)
    func settleLiveCommonConversationResult(_ call: String, challengeId: String, output: String?,
                                            resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            guard self.active == call, let transport = self.commonV3 else { resolve(false); return }
            transport.settleBridge(callId: call, challenge: challengeId, exact: output) { resolve($0) }
        }
    }
}

extension VoiceRealtimeModule {
    /// JavaScript owns per-payload approval; this boundary only accepts the still-owned pending request.
    @objc(resolveRealtimeToolCall:toolCallId:responseId:output:resolver:rejecter:)
    func resolveRealtimeToolCall(_ identifier: String, toolCallId: String, responseId: String, output: String,
                                 resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            resolve(self.call.resolveTool(identifier, toolCallID: toolCallId, responseID: responseId, output: output))
        }
    }
}
