import AVFoundation
import Foundation
import React
import Speech
import UIKit

/// Bridges one explicitly started ephemeral turn; it never sends or stores captured audio.
@objc(VoiceConversationModule)
final class VoiceConversationModule: RCTEventEmitter {
    private lazy var duplex = VoiceDuplexCallCoordinator { [weak self] name, body in
        self?.sendEvent(withName: name, body: body)
    }

    private let capture = VoiceConversationCapture()
    private let speech = VoiceConversationSpeech()
    private var token: AudioSessionOwnership.Token?
    private var turn: String?
    private var observers: [NSObjectProtocol] = []
    private var pendingActivation: ((Bool) -> Void)?
    private var activationEpoch = 0

    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        ["VoiceConversationInterrupted", "VoiceConversationListening", "VoiceCallSpeechStarted", "VoiceCallTranscript", "VoiceCallInterrupted"]
    }

    override init() {
        super.init()
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            activationEpoch += 1
            guard let pending = pendingActivation else { return }
            pendingActivation = nil
            pending(true)
        })
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                guard let self else { return }
                if name == AVAudioSession.routeChangeNotification {
                    duplex.routeChanged()
                    let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
                    guard raw == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
                }
                if name != AVAudioSession.routeChangeNotification {
                    duplex.systemInterrupted()
                }
                guard turn != nil else { return }
                sendEvent(withName: "VoiceConversationInterrupted", body: ["turnId": turn ?? ""])
                stopOwned()
            })
        }
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    override func invalidate() {
        DispatchQueue.main.async {
            self.duplex.systemInterrupted()
            self.stopOwned()
        }
        super.invalidate()
    }

    @objc(start:language:resolver:rejecter:)
    func start(_ identifier: String, language: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard self.turn == nil, !identifier.isEmpty else { reject("VOICE_BUSY", "Voice is already active.", nil); return }
            do { self.token = try AudioSessionOwnership.shared.reserve() }
            catch { reject("VOICE_AUDIO_BUSY", "Audio is in use by another activity.", nil); return }
            self.turn = identifier
            let speechWasUndetermined = SFSpeechRecognizer.authorizationStatus() == .notDetermined
            let epoch = self.activationEpoch
            SFSpeechRecognizer.requestAuthorization { speechStatus in
                DispatchQueue.main.async {
                    guard self.turn == identifier else { reject("VOICE_CANCELLED", "Voice was stopped.", nil); return }
                    guard speechStatus == .authorized else {
                        self.stopOwned()
                        reject("VOICE_PERMISSION", "Speech recognition permission is unavailable.", nil)
                        return
                    }
                    self.afterPermission(epoch: epoch, requiresTransition: speechWasUndetermined) { active in
                        guard active, self.turn == identifier else { reject("VOICE_CANCELLED", "Voice was stopped.", nil); return }
                        self.requestMicrophone(identifier, language: language, resolve: resolve, reject: reject)
                    }
                }
            }
        }
    }

    private func afterPermission(epoch: Int, requiresTransition: Bool, completion: @escaping (Bool) -> Void) {
        if UIApplication.shared.applicationState == .active, !requiresTransition || activationEpoch > epoch {
            completion(true)
        } else {
            pendingActivation = completion
        }
    }

    private func requestMicrophone(_ identifier: String, language: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let undetermined = AVAudioSession.sharedInstance().recordPermission == .undetermined
        let epoch = activationEpoch
        AVAudioSession.sharedInstance().requestRecordPermission { allowed in
            DispatchQueue.main.async {
                guard self.turn == identifier, let token = self.token else { reject("VOICE_CANCELLED", "Voice was stopped.", nil); return }
                guard allowed else { self.stopOwned(); reject("VOICE_PERMISSION", "Microphone permission is unavailable.", nil); return }
                self.afterPermission(epoch: epoch, requiresTransition: undetermined) { active in
                    guard active, self.turn == identifier, self.token == token else { reject("VOICE_CANCELLED", "Voice was stopped.", nil); return }
                    do {
                        try AudioSessionOwnership.shared.activate(token, category: .record, mode: .measurement)
                        let started = try self.capture.start(locale: Locale(identifier: language)) { result in
                            guard self.turn == identifier else { return }
                            self.releaseAudio()
                            guard self.token == nil else { reject("VOICE_CLEANUP_FAILED", "Audio could not be released.", nil); return }
                            switch result {
                            case let .success(text): resolve(text)
                            case .failure: reject("VOICE_CAPTURE_FAILED", "Speech recognition stopped.", nil)
                            }
                        }
                        if started, self.turn == identifier {
                            self.sendEvent(withName: "VoiceConversationListening", body: ["turnId": identifier])
                        }
                    } catch {
                        self.stopOwned()
                        reject("VOICE_CAPTURE_FAILED", "Speech recognition is unavailable.", nil)
                    }
                }
            }
        }
    }

    @objc(finishCapture:)
    func finishCapture(_ identifier: String) {
        DispatchQueue.main.async {
            if self.turn == identifier {
                self.capture.completeTurn()
            }
        }
    }

    @objc(speak:text:language:resolver:rejecter:)
    func speak(_ identifier: String, text: String, language: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard self.turn == identifier, self.token == nil else { reject("VOICE_STALE", "Voice turn is no longer current.", nil); return }
            do {
                let token = try AudioSessionOwnership.shared.reserve()
                self.token = token
                try AudioSessionOwnership.shared.activate(token, category: .playback, mode: .spokenAudio)
                guard self.speech.speak(text, language: language, completion: { spoken in
                    guard self.turn == identifier else { return }
                    self.releaseAudio()
                    guard self.token == nil else { reject("VOICE_CLEANUP_FAILED", "Audio could not be released.", nil); return }
                    if spoken {
                        resolve(nil)
                    } else {
                        reject("VOICE_SPEECH_STOPPED", "Speech output stopped.", nil)
                    }
                }) else { throw VoiceConversationCapture.Failure.unavailable }
            } catch {
                self.releaseAudio()
                reject("VOICE_SPEECH_FAILED", "Speech output is unavailable.", nil)
            }
        }
    }

    @objc(stop:resolver:rejecter:)
    func stop(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard self.turn == identifier else { resolve(nil); return }
            self.stopOwned()
            if self.token == nil {
                resolve(nil)
            } else {
                reject("VOICE_CLEANUP_FAILED", "Audio could not be released.", nil)
            }
        }
    }

    @objc(openCall:language:resolver:rejecter:)
    func openCall(_ id: String, language: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.duplex.open(id, language: language) { result in
                switch result {
                case .success: resolve(nil)
                case let .failure(error): reject("VOICE_CALL_FAILED", "Voice call unavailable.", error)
                }
            }
        }
    }

    @objc(stopCall:resolver:rejecter:)
    func stopCall(_ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do { try self.duplex.stop(id); resolve(nil) }
            catch { reject("VOICE_CLEANUP_FAILED", "Audio could not be released.", error) }
        }
    }

    @objc(interruptOutput:resolver:rejecter:)
    func interruptOutput(_ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { self.duplex.interruptOutput(id); resolve(nil) }
    }

    @objc(finishCallCapture:)
    func finishCallCapture(_ id: String) {
        DispatchQueue.main.async { self.duplex.finishCapture(id) }
    }

    @objc(speakCall:generation:text:language:resolver:rejecter:)
    func speakCall(_ id: String, generation: Int, text: String, language: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.duplex.speak(id, sequence: generation, text: text, language: language) { result in
                switch result {
                case let .success(spoken): resolve(spoken)
                case let .failure(error): reject("VOICE_SPEECH_STOPPED", "Voice output interrupted.", error)
                }
            }
        }
    }

    private func stopOwned() {
        let pending = pendingActivation
        pendingActivation = nil
        pending?(false)
        capture.cancel()
        guard speech.stop() else { return }
        releaseAudio()
        if token == nil {
            turn = nil
        }
    }

    private func releaseAudio() {
        guard let token else { return }
        do { try AudioSessionOwnership.shared.release(token); self.token = nil } catch {}
    }
}
