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
            if let fixture = ComposedCanonicalOpenFixture.fixtureCall(emit: emit) {
                return fixture
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
    private(set) var active: String?
    private var responsesMailbox: OwnedLiveResponsesMailbox?
    private let resultAuthority = LiveNativeResultDispatchAuthority()
    let canonicalCallReview = CanonicalLiveCallPresenter()
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        ["supportsVoiceAudioLevels": true, "supportsCanonicalHealthContextV2": RealtimeVoiceCanonicalHealthAdmission.enabledForLiveBridge]
    }

    override func supportedEvents() -> [String]! {
        ["VoiceRealtimeState", "VoiceRealtimeTranscript", "VoiceRealtimeInterrupted", "VoiceRealtimeSystemCall", "VoiceRealtimePaused", "VoiceRealtimeAudioLevel", "VoiceRealtimeToolCall", "VoiceRealtimeToolCancelled", "VoiceRealtimeManagedToolCall", "VoiceRealtimeManagedToolCancelled"]
    }

    @objc(openLiveCall:model:apiKey:options:resolver:rejecter:)
    func openLiveCall(_ identifier: String, model: String, apiKey: String, options: NSDictionary,
                      resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async { [self] in
            guard active == nil else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            let read = Self.canonicalAuthority
            guard RealtimeVoiceCanonicalHealthAdmission.permitsStartupOptions(options, enabled: Self.canonicalReviewEnabled(identifier)),
                  Set(options.allKeys.compactMap { $0 as? String }).isSubset(of: ["language", "voice", "responsesGrant", "canonicalHealthGrant", "canonicalHealthDeclaration"]),
                  let language = options["language"] as? String, let voice = options["voice"] as? String
            else {
                reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return
            }
            let canonicalRequested = options["canonicalHealthGrant"] != nil || options["canonicalHealthDeclaration"] != nil
            var admission: LiveResponsesAdmission?
            if let request = options["responsesGrant"] {
                guard let grant = LiveResponsesSettingsGrant(request), grant.isCurrent(key: apiKey, read: read) else {
                    reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return
                }
                if canonicalRequested {
                    guard let request = options["canonicalHealthGrant"],
                          let companion = RealtimeVoiceCanonicalHealthAdmission(request),
                          let declaration = options["canonicalHealthDeclaration"] as? [String: Any],
                          companion.configuration(declaration, base: grant, key: apiKey, read: read) != nil,
                          canonicalCallReview.consume(.init(call: identifier, capability: companion))
                    else { reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return }
                    let mailbox = RealtimeVoiceCanonicalHealthMailbox(
                        call: identifier, baseline: grant, capability: companion, authority: resultAuthority, key: apiKey, read: read,
                        owns: { [weak self] request in
                            guard let self else { return false }
                            return active == request.call && call.id == request.call && call.liveSessionID == request.session
                                && call.liveSocketEpoch == request.epoch && call.ready && !call.paused
                                && call.token != nil && call.foreground() && call.liveIsCurrent()
                        },
                        emit: { [weak self] event, body in self?.emitCanonicalReviewEvent(event, body) },
                    )
                    responsesMailbox = OwnedLiveResponsesMailbox(identifier: identifier, mode: .canonical(mailbox, grant))
                    admission = mailbox.bridge(backendModel: grant.backendModel, declaration: declaration)
                } else {
                    let mailbox = LiveResponsesMailbox(identifier: identifier, grant: grant, key: apiKey, authority: resultAuthority) { [weak self] event, body in
                        self?.sendEvent(withName: event, body: body)
                    }
                    responsesMailbox = OwnedLiveResponsesMailbox(identifier: identifier, mode: .aggregate(mailbox))
                    admission = mailbox.admission()
                }
            } else if canonicalRequested {
                reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return
            }
            active = identifier
            call.open(identifier, model: model, key: apiKey, language: language, voice: voice, managedAdmission: admission) { result in
                switch result {
                case .success: resolve(nil)
                case .failure:
                    if self.call.id == nil, self.active == identifier {
                        self.responsesMailbox?.revoke()
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
                                     resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            guard self.active == identifier, let mailbox = self.responsesMailbox else { resolve(false); return }
            mailbox.settle(call: identifier, challenge: challengeId, output: output) { resolve($0) }
        }
    }

    /// These process-local methods never wait for main or inspect any health data.
    @objc(claimLiveResponsesResult:challengeId:)
    func claimLiveResponsesResult(_ identifier: String, challengeId: String) -> NSNumber {
        NSNumber(value: resultAuthority.claim(call: identifier, challenge: challengeId))
    }

    @objc(retireLiveResponsesResult:challengeId:)
    func retireLiveResponsesResult(_ identifier: String, challengeId: String) -> NSNumber {
        NSNumber(value: resultAuthority.retire(call: identifier, challenge: challengeId))
    }

    @objc(revokeLiveResponsesGrant:generation:resolver:rejecter:)
    func revokeLiveResponsesGrant(_ grantID: String, generation: String,
                                  resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            if let mailbox = self.responsesMailbox, mailbox.grant.grantID == grantID,
               mailbox.grant.generation == generation
            {
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
        DispatchQueue.main.async { [self] in
            canonicalCallReview.retire(identifier)
            do {
                let waitsForClose = graceful && call.id == identifier
                var pendingDuration: [String: Any]?
                let capture: (([String: Any]?) -> Void)? = waitsForClose ? { [weak self] captions in
                    DispatchQueue.main.async {
                        let duration = pendingDuration
                        if let duration, let captions, self?.active == nil {
                            resolve(["kind": "live_observed_close", "duration": duration, "captions": captions])
                        } else {
                            resolve(duration)
                        }
                    }
                } : nil
                try call.stop(identifier, graceful: graceful, retireMailbox: { [self] in
                    if active == identifier {
                        responsesMailbox?.revoke()
                    }
                }, observedClose: capture)
                if active == identifier {
                    responsesMailbox?.revoke()
                    responsesMailbox = nil
                    active = nil
                }
                pendingDuration = call.connectedDuration.take(identifier)
                if !waitsForClose {
                    resolve(pendingDuration)
                }
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
            self.responsesMailbox?.revoke()
            self.responsesMailbox = nil
            if let id = self.active {
                try? self.call.stop(id)
            }
        }
        super.invalidate()
    }
}
