import Foundation
import React

/// Native-only audio and network ownership. JavaScript receives status and transcripts, never PCM.
@objc(VoiceRealtimeModule)
final class VoiceRealtimeModule: RCTEventEmitter {
    private lazy var call = RealtimeVoiceCall(systemCall: VoiceSystemCallLifecycle.shared) { [weak self] event, body in
        self?.sendEvent(withName: event, body: body)
    }

    private var active: String?
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        ["VoiceRealtimeState", "VoiceRealtimeTranscript", "VoiceRealtimeInterrupted", "VoiceRealtimeSystemCall", "VoiceRealtimeToolCall", "VoiceRealtimeToolCancelled"]
    }

    @objc(openRealtimeCall:model:apiKey:language:enableTools:resolver:rejecter:)
    func openRealtimeCall(_ identifier: String, model: String, apiKey: String, language: String, enableTools: Bool,
                          resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            guard self.active == nil else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            self.active = identifier
            self.call.open(identifier, model: model, key: apiKey, language: language, enableTools: enableTools) { result in
                switch result {
                case .success: resolve(nil)
                case .failure: reject("VOICE_REALTIME_FAILED", "Realtime voice is unavailable.", nil)
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
        DispatchQueue.main.async {
            do {
                try self.call.stop(identifier)
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
                case .failure: reject("VOICE_REALTIME_FAILED", "Realtime voice is unavailable.", nil)
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
