import Foundation
import React

/// Native-only audio and network ownership. JavaScript receives status and transcripts, never PCM.
@objc(VoiceRealtimeModule)
final class VoiceRealtimeModule: RCTEventEmitter {
    private(set) lazy var call: RealtimeVoiceCall = {
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
    let commonSourcePins = LiveCommonV3SourcePins()
    @MainActor var commonV3: LiveCanonicalContextV3Transport?
    #if OROT_TESTS && targetEnvironment(simulator)
        let canonicalCallReview = CanonicalLiveCallPresenter()
    #endif
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        ["supportsVoiceAudioLevels": true, "supportsLiveCommonConversationToolsV3": true]
    }

    override func supportedEvents() -> [String]! {
        ["VoiceRealtimeState", "VoiceRealtimeTranscript", "VoiceRealtimeInterrupted", "VoiceRealtimeSystemCall", "VoiceRealtimePaused", "VoiceRealtimeAudioLevel", "VoiceRealtimeToolCall", "VoiceRealtimeToolCancelled", "VoiceRealtimeManagedToolCall", "VoiceRealtimeManagedToolCancelled", "VoiceRealtimeCommonToolsReady", "VoiceRealtimeCommonToolBatch", "VoiceRealtimeCommonToolCancelled"]
    }

    @objc(openLiveCall:model:apiKey:options:resolver:rejecter:)
    func openLiveCall(_ identifier: String, model: String, apiKey: String, options: NSDictionary,
                      resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async { [self] in
            guard active == nil else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            // Native rejects retired bridge options instead of silently downgrading to audio-only.
            let keys = options.allKeys.compactMap { $0 as? String }
            guard keys.count == options.count,
                  Set(keys).isSubset(of: ["language", "voice", "commonToolsRegistration"]),
                  let language = options["language"] as? String, let voice = options["voice"] as? String
            else { reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return }
            let admission = prepareCommonV3(identifier, model: model, key: apiKey, options: options)
            guard options["commonToolsRegistration"] == nil || admission != nil
            else { reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return }
            active = identifier
            call.open(identifier, model: model, key: apiKey, language: language, voice: voice, managedAdmission: admission) { result in
                switch result {
                case .success:
                    guard self.acknowledgeCommonV3(identifier) else {
                        self.call.fail()
                        if self.active == identifier {
                            self.active = nil
                        }
                        reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil)
                        return
                    }
                    resolve(nil)
                case .failure:
                    if self.call.id == nil, self.active == identifier {
                        self.retireCommonV3(identifier)
                        self.active = nil
                    }
                    reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil)
                }
            }
        }
    }

    @objc(revokeLiveResponsesGrant:generation:resolver:rejecter:)
    func revokeLiveResponsesGrant(_ grantID: String, generation: String,
                                  resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            self.revokeCommonV3(grantID: grantID, generation: generation)
            resolve(nil)
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
            #if OROT_TESTS && targetEnvironment(simulator)
                canonicalCallReview.retire(identifier)
            #endif
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
                try call.stop(identifier, graceful: graceful, observedClose: capture)
                if active == identifier {
                    retireCommonV3(identifier)
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
            if let id = self.active {
                self.retireCommonV3(id)
                try? self.call.stop(id)
            }
        }
        super.invalidate()
    }
}
