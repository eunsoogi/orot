import AVFoundation
import Foundation
import Speech
import UIKit

/// One explicitly activated call owns both input and output. Only text and generations reach JavaScript.
final class VoiceDuplexCallCoordinator {
    private let audio: VoiceDuplexAudioPort
    private let recognition: VoiceDuplexRecognitionPort
    private let ownership: AudioSessionOwnership
    private let speechPermission: (@escaping (SFSpeechRecognizerAuthorizationStatus) -> Void) -> Void
    private let microphonePermission: (@escaping (Bool) -> Void) -> Void
    private let foreground: () -> Bool
    private let emit: (String, [String: Any]) -> Void
    private let systemCall: VoiceSystemCallPort?
    private var systemCallOwner: UUID?
    private(set) var systemCallActive = false
    private var token: AudioSessionOwnership.Token?
    private var identifier: String?
    private var pending: (() -> Void)?
    private var opening: ((Result<Void, Error>) -> Void)?
    private var observer: NSObjectProtocol?
    private var generation = 0
    private var playbackGeneration = 0
    private var routeSignature = ""
    var isActive: Bool {
        identifier != nil
    }

    init(systemCall: VoiceSystemCallPort? = nil, audio: VoiceDuplexAudioPort = VoiceDuplexAudioEngine(),
         recognition: VoiceDuplexRecognitionPort = VoiceDuplexRecognition(), ownership: AudioSessionOwnership = .shared,
         speechPermission: @escaping (@escaping (SFSpeechRecognizerAuthorizationStatus) -> Void) -> Void = SFSpeechRecognizer.requestAuthorization,
         microphonePermission: @escaping (@escaping (Bool) -> Void) -> Void = { AVAudioSession.sharedInstance().requestRecordPermission($0) },
         foreground: @escaping () -> Bool = { UIApplication.shared.applicationState == .active },
         emit: @escaping (String, [String: Any]) -> Void)
    {
        self.audio = audio; self.recognition = recognition; self.ownership = ownership
        self.speechPermission = speechPermission; self.microphonePermission = microphonePermission; self.foreground = foreground
        self.systemCall = systemCall
        self.emit = emit
        observer = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                                          object: nil, queue: .main)
        { [weak self] _ in
            guard let self else { return }
            let action = pending
            pending = nil
            action?()
        }
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
        // Capture resources, never self, so bridge disposal also releases the native graph.
        let audio = audio
        let recognition = recognition
        let ownedToken = token, systemCall = systemCall, systemCallOwner = systemCallOwner, ownership = ownership
        DispatchQueue.main.async {
            audio.stop()
            recognition.stop()
            if let systemCallOwner {
                systemCall?.end(owner: systemCallOwner)
            }
            if let ownedToken {
                try? ownership.release(ownedToken)
            }
        }
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "VoiceCall", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    func open(_ id: String, language: String, completion: @escaping (Result<Void, Error>) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard identifier == nil, !id.isEmpty else { completion(.failure(failure("Voice call is busy"))); return }
        do { token = try ownership.reserve() }
        catch { completion(.failure(error)); return }
        identifier = id
        generation = 0
        opening = completion
        speechPermission { [weak self] status in
            DispatchQueue.main.async {
                guard let self, self.identifier == id else { return }
                guard status == .authorized else { self.failOpen(self.failure("Speech permission unavailable")); return }
                self.microphonePermission { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self, self.identifier == id else { return }
                        guard allowed else { self.failOpen(self.failure("Microphone permission unavailable")); return }
                        let begin: () -> Void = { [weak self] in self?.begin(id, language: language) }
                        if self.foreground() {
                            begin()
                        } else {
                            self.pending = begin
                        }
                    }
                }
            }
        }
    }

    private func begin(_ id: String, language: String) {
        guard identifier == id, let token else { return }
        if let systemCall, !systemCallActive {
            guard systemCallOwner == nil, foreground() else { return }
            let owner = UUID()
            systemCallOwner = owner
            do {
                try systemCall.start(owner: owner, prepare: { [weak self] in
                    guard let self, identifier == id, systemCallOwner == owner else { throw AudioSessionOwnership.Failure.stale }
                    try ownership.prepareSystemCall(token)
                }, activated: { [weak self] in
                    guard let self, identifier == id, systemCallOwner == owner else { return }
                    systemCallActive = true
                    emit("VoiceCallSystemCall", ["callId": id, "active": true])
                    begin(id, language: language)
                }, ended: { [weak self] in
                    guard let self, identifier == id, systemCallOwner == owner else { return }
                    systemInterrupted()
                }, muted: { [weak self] in
                    guard let self, identifier == id, systemCallOwner == owner else { return }
                    systemInterrupted()
                })
            } catch { failOpen(error) }
            return
        }
        do {
            // Voice processing remains inside this owner's engine, not a global mixing exemption.
            if systemCallActive {
                try ownership.systemCallActivated(token)
            } else {
                try ownership.activate(token, category: .playAndRecord, mode: .voiceChat,
                                       options: [.defaultToSpeaker, .allowBluetoothHFP])
            }
            try recognition.start(locale: Locale(identifier: language), onSpeechStarted: { [weak self] sequence in
                guard let self, identifier == id, sequence > generation else { return }
                generation = sequence
                // Stop output natively before waiting for the JS cancellation round trip. Input is untouched.
                playbackGeneration = 0
                emit("VoiceCallSpeechStarted", ["callId": id, "generation": sequence])
                audio.cancelPlayback()
            }, onTranscript: { [weak self] sequence, text in
                guard let self, identifier == id else { return }
                emit("VoiceCallTranscript", ["callId": id, "generation": sequence, "text": text])
            }, onFailure: { [weak self] _ in
                guard let self, identifier == id else { return }
                systemInterrupted()
            })
            try audio.start { [weak self] buffer in self?.recognition.append(buffer) }
            routeSignature = currentRouteSignature()
            let callback = opening
            opening = nil
            callback?(.success(()))
        } catch { failOpen(error) }
    }

    private func failOpen(_ error: Error) {
        let callback = opening
        opening = nil
        if let id = identifier {
            try? stop(id)
        }
        callback?(.failure(error))
    }

    func speak(_ id: String, sequence: Int, text: String, language: String,
               completion: @escaping (Result<Bool, Error>) -> Void)
    {
        guard identifier == id, token != nil, sequence == generation, sequence > 0 else {
            completion(.failure(failure("Stale voice output"))); return
        }
        playbackGeneration = sequence
        do {
            try audio.speak(text, language: language) { [weak self] spoken in
                guard let self else { return }
                if identifier != id || playbackGeneration != sequence {
                    completion(.success(false))
                } else if spoken {
                    completion(.success(true))
                } else {
                    completion(.failure(failure("Voice output failed")))
                }
            }
        } catch { completion(.failure(error)) }
    }

    func interruptOutput(_ id: String) {
        guard identifier == id else { return }
        playbackGeneration = 0
        audio.cancelPlayback()
    }

    func finishCapture(_ id: String) {
        if identifier == id {
            recognition.finishTurn()
        }
    }

    /// Repeated stop is safe; a failed audio-session release retains the owner for retry.
    func stop(_ id: String) throws {
        guard identifier == id else { return }
        pending = nil
        let callback = opening
        opening = nil
        playbackGeneration = 0
        audio.stop()
        recognition.stop()
        systemCallActive = false
        emit("VoiceCallSystemCall", ["callId": id, "active": false])
        if let owner = systemCallOwner {
            systemCall?.end(owner: owner)
        }
        systemCallOwner = nil
        callback?(.failure(failure("Voice call stopped")))
        if let token {
            try ownership.release(token); self.token = nil
        }
        identifier = nil
    }

    private func currentRouteSignature() -> String {
        let session = AVAudioSession.sharedInstance()
        let ports = session.currentRoute.inputs + session.currentRoute.outputs
        return ports.map(\.uid).joined(separator: "|") + "|" + String(session.sampleRate)
    }

    func routeChanged() {
        // Ignore our own startup category transition; an established graph cannot reuse a changed route.
        if identifier != nil, opening == nil, routeSignature != currentRouteSignature() {
            systemInterrupted()
        }
    }

    /// Only an already activated system-owned call may survive backgrounding; protection loss always stops.
    func applicationLifecycleChanged(_ name: Notification.Name) {
        if name == UIApplication.didEnterBackgroundNotification, systemCallActive {
            return
        }
        systemInterrupted()
    }

    func systemInterrupted() {
        guard let id = identifier else { return }
        emit("VoiceCallInterrupted", ["callId": id])
        try? stop(id)
    }
}
