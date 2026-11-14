import Foundation
import React

/// Native-only audio and network ownership. JavaScript receives status and transcripts, never PCM.
@objc(VoiceRealtimeModule)
final class VoiceRealtimeModule: RCTEventEmitter {
    private lazy var call = RealtimeVoiceCall { [weak self] event, body in
        self?.sendEvent(withName: event, body: body)
    }

    private var active: String?
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        ["VoiceRealtimeState", "VoiceRealtimeTranscript", "VoiceRealtimeInterrupted"]
    }

    @objc(openRealtimeCall:model:apiKey:language:resolver:rejecter:)
    func openRealtimeCall(_ identifier: String, model: String, apiKey: String, language: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async {
            guard self.active == nil else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            self.active = identifier
            self.call.open(identifier, model: model, key: apiKey, language: language) { result in
                switch result {
                case .success: resolve(nil)
                case .failure: reject("VOICE_REALTIME_FAILED", "Realtime voice is unavailable.", nil)
                }
            }
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
