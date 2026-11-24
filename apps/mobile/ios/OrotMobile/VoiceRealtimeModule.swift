import Foundation
import React

/// Native-only audio and network ownership. JavaScript receives status and transcripts, never PCM.
@objc(VoiceRealtimeModule)
final class VoiceRealtimeModule: RCTEventEmitter {
    private lazy var call: RealtimeVoiceCall = {
        let emit: (String, [String: Any]) -> Void = { [weak self] event, body in
            self?.sendEvent(withName: event, body: body)
        }
        #if OROT_TESTS && targetEnvironment(simulator)
            if SettingsConsentRealtimeFixture.requested {
                return SettingsConsentRealtimeFixture.makeCall(emit: emit)
            }
        #endif
        return RealtimeVoiceCall(systemCall: VoiceSystemCallLifecycle.shared, emit: emit)
    }()

    #if OROT_TESTS && targetEnvironment(simulator)
        @objc(settingsConsentSnapshot:resolver:rejecter:)
        func settingsConsentSnapshot(_ lateEvent: Bool, resolver resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter _: @escaping RCTPromiseRejectBlock)
        {
            DispatchQueue.main.async { resolve(SettingsConsentRealtimeFixture.snapshot(lateEvent: lateEvent)) }
        }
    #endif

    private var active: String?
    private var responsesMailbox: LiveResponsesMailbox?
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        ["VoiceRealtimeState", "VoiceRealtimeTranscript", "VoiceRealtimeInterrupted", "VoiceRealtimeSystemCall", "VoiceRealtimePaused", "VoiceRealtimeToolCall", "VoiceRealtimeToolCancelled", "VoiceRealtimeManagedToolCall", "VoiceRealtimeManagedToolCancelled"]
    }

    @objc(openLiveCall:model:apiKey:options:resolver:rejecter:)
    func openLiveCall(_ identifier: String, model: String, apiKey: String, options: NSDictionary,
                      resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            guard self.active == nil else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            guard Set(options.allKeys.compactMap { $0 as? String }).isSubset(of: ["language", "voice", "responsesGrant"]),
                  let language = options["language"] as? String, let voice = options["voice"] as? String else {
                reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return
            }
            var admission: LiveResponsesAdmission?
            if let request = options["responsesGrant"] {
                guard let grant = LiveResponsesSettingsGrant(request), grant.isCurrent(key: apiKey) else {
                    reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return
                }
                let mailbox = LiveResponsesMailbox(identifier: identifier, grant: grant, key: apiKey) { [weak self] event, body in
                    self?.sendEvent(withName: event, body: body)
                }
                self.responsesMailbox = mailbox
                admission = mailbox.admission()
            }
            self.active = identifier
            self.call.open(identifier, model: model, key: apiKey, language: language, voice: voice, managedAdmission: admission) { result in
                switch result {
                case .success: resolve(nil)
                case .failure:
                    if self.call.id == nil, self.active == identifier {
                        self.responsesMailbox = nil
                        self.active = nil
                    }
                    reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil)
                }
            }
        }
    }

    @objc(settleLiveResponsesToolCall:challengeId:output:resolver:rejecter:)
    func settleLiveResponsesToolCall(_ identifier: String, challengeId: String, output: String?,
                                     resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            resolve(self.active == identifier && self.responsesMailbox?.settle(challengeId, output: output) == true)
        }
    }

    @objc(revokeLiveResponsesGrant:generation:resolver:rejecter:)
    func revokeLiveResponsesGrant(_ grantID: String, generation: String,
                                  resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            if let mailbox = self.responsesMailbox, mailbox.grant.grantID == grantID,
               mailbox.grant.generation == generation {
                mailbox.revoke()
                self.call.fail()
            }
            resolve(nil)
        }
    }

    /// JavaScript owns per-payload approval; this boundary only accepts the still-owned pending request.
    @objc(resolveRealtimeToolCall:toolCallId:responseId:output:resolver:rejecter:)
    func resolveRealtimeToolCall(_ identifier: String, toolCallId: String, responseId: String, output: String,
                                 resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            resolve(self.call.resolveTool(identifier, toolCallID: toolCallId, responseID: responseId, output: output))
        }
    }

    /// Revocation cancels delegation without interrupting an otherwise valid voice conversation.
    @objc(cancelRealtimeTools:resolver:rejecter:)
    func cancelRealtimeTools(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            if self.active == identifier {
                self.call.cancelTools()
            }
            resolve(nil)
        }
    }

    @objc(stopRealtimeCall:resolver:rejecter:)
    func stopRealtimeCall(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        stop(identifier, graceful: false, resolve: resolve, reject: reject)
    }

    @objc(closeLiveCall:resolver:rejecter:)
    func closeLiveCall(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        stop(identifier, graceful: true, resolve: resolve, reject: reject)
    }

    private func stop(_ identifier: String, graceful: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                try self.call.stop(identifier, graceful: graceful)
                if self.active == identifier {
                    self.responsesMailbox = nil
                    self.active = nil
                }
                resolve(self.call.connectedDuration.take(identifier))
            } catch { reject("VOICE_CLEANUP_FAILED", "Audio could not be released.", nil) }
        }
    }

    @objc(pauseRealtimeCall:resolver:rejecter:)
    func pauseRealtimeCall(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do { try self.call.pause(identifier); resolve(nil) }
            catch { reject("VOICE_CLEANUP_FAILED", "Audio could not be released.", nil) }
        }
    }

    @objc(resumeRealtimeCall:resolver:rejecter:)
    func resumeRealtimeCall(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.call.resume(identifier) { result in
                switch result {
                case .success: resolve(nil)
                case .failure: reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil)
                }
            }
        }
    }

    @objc(interruptRealtimeOutput:resolver:rejecter:)
    func interruptRealtimeOutput(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            if self.active == identifier {
                self.call.interrupt()
            }
            resolve(nil)
        }
    }

    override func invalidate() {
        DispatchQueue.main.async {
            if let id = self.active {
                try? self.call.stop(id)
            }
        }
        super.invalidate()
    }
}

/// Module-owned one-use challenge. Only the active RN policy runner receives it, and neither
/// incoming event IDs nor a stock tool reply can settle it. Cancellation never returns data.
private final class LiveResponsesMailbox {
    let grant: LiveResponsesSettingsGrant
    private let identifier: String, key: String
    private let emit: (String, [String: Any]) -> Void
    private var pending: (id: String, request: LiveResponsesAdmission.Request, finish: (String?) -> Void)?
    private var approved: [(LiveResponsesAdmission.Request, String)] = []
    private var revoked = false

    init(identifier: String, grant: LiveResponsesSettingsGrant, key: String, emit: @escaping (String, [String: Any]) -> Void) {
        self.identifier = identifier; self.grant = grant; self.key = key; self.emit = emit
    }

    func admission() -> LiveResponsesAdmission {
        LiveResponsesAdmission(backendModel: grant.backendModel, functionName: "orot_health_context",
            backendAllowed: { [weak self] in self?.current() == true },
            mayRun: { [weak self] in self?.identifier == $0.owner.callID && self?.current() == true },
            approve: { _, finish in finish(true); return {} }, // RN authorizes each exact request before any read.
            execute: { [weak self] in self?.begin($0, finish: $1) ?? {} },
            mayDisclose: { [weak self] request, output in
                guard let self, current() else { return false }
                return approved.contains { $0.0 == request && $0.1 == output }
            })
    }

    private func current() -> Bool { !revoked && grant.isCurrent(key: key) }

    private func begin(_ request: LiveResponsesAdmission.Request, finish: @escaping (String?) -> Void) -> (() -> Void) {
        guard pending == nil, current(), request.owner.callID == identifier, request.name == "orot_health_context",
              let topic = request.topic, let days = request.days,
              LiveResponsesAdmission.healthTopics.contains(topic), (3...31).contains(days) else { finish(nil); return {} }
        let id = UUID().uuidString
        pending = (id, request, finish)
        let arguments = "{\"topic\":\"\(topic)\",\"days\":\(days)}"
        emit("VoiceRealtimeManagedToolCall", ["callId": identifier, "sessionId": request.owner.sessionID, "challengeId": id,
                                              "toolCallId": request.functionID, "responseId": request.responseID,
                                              "delegationId": request.delegationID, "name": request.name, "args": arguments])
        return { [weak self] in self?.cancel(id) }
    }

    func settle(_ id: String, output: String?) -> Bool {
        guard let pending, pending.id == id, current() else { return false }
        self.pending = nil
        let accepted = output.flatMap { LiveResponsesAdmission.validAggregate($0, days: pending.request.days) ? $0 : nil }
        if let accepted { approved.append((pending.request, accepted)) }
        pending.finish(accepted)
        return output == nil || accepted != nil
    }

    func revoke() {
        revoked = true; approved.removeAll()
        if let id = pending?.id { cancel(id) }
    }

    private func cancel(_ id: String) {
        guard pending?.id == id else { return }
        pending = nil
        emit("VoiceRealtimeManagedToolCancelled", ["callId": identifier, "challengeId": id])
    }
}
