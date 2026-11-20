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
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        ["VoiceRealtimeState", "VoiceRealtimeTranscript", "VoiceRealtimeInterrupted", "VoiceRealtimeSystemCall", "VoiceRealtimePaused", "VoiceRealtimeToolCall", "VoiceRealtimeToolCancelled"]
    }

    @objc(openLiveCall:model:apiKey:options:resolver:rejecter:)
    func openLiveCall(_ identifier: String, model: String, apiKey: String, options: NSDictionary,
                      resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            guard self.active == nil else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            guard options.count == 2, let language = options["language"] as? String, let voice = options["voice"] as? String else {
                reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil); return
            }
            self.active = identifier
            self.call.open(identifier, model: model, key: apiKey, language: language, voice: voice) { result in
                switch result {
                case .success: resolve(nil)
                case .failure:
                    if self.call.id == nil, self.active == identifier {
                        self.active = nil
                    }
                    reject("VOICE_LIVE_FAILED", "Live voice is unavailable.", nil)
                }
            }
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
                    self.active = nil
                }
                resolve(nil)
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
