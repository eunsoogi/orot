import AVFoundation
import Foundation
import UIKit

/// Explicitly consented API speech session. Local Speech recognition and text-provider generation are never invoked.
final class RealtimeVoiceCall {
    enum Failure: Error { case unavailable, stopped }
    // Module-internal state is shared only with the lifecycle and event extensions.
    let audio: RealtimeAudioPort
    let socket: RealtimeSocketPort
    let ownership: AudioSessionOwnership
    let permission: (@escaping (Bool) -> Void) -> Void
    let foreground: () -> Bool
    var token: AudioSessionOwnership.Token?
    var id: String?
    var opening: ((Result<Void, Error>) -> Void)?
    var pending: (() -> Void)?
    var timer: Timer?
    var item: String?
    var contentIndex = 0
    var response: String?
    var ignoredResponses = Set<String>()
    var routeSignature = ""
    var ready = false
    var paused = false
    var awaitingClear = false
    var captureEpoch = UUID()
    var lifecycleEpoch = UUID()
    var awaitingInputCommit = false
    var observers: [NSObjectProtocol] = []
    let emit: (String, [String: Any]) -> Void

    init(audio: RealtimeAudioPort = RealtimeVoiceAudio(), socket: RealtimeSocketPort = RealtimeVoiceSocket(),
         ownership: AudioSessionOwnership = .shared,
         permission: @escaping (@escaping (Bool) -> Void) -> Void = RealtimeVoiceCall.requestPermission,
         foreground: @escaping () -> Bool = { UIApplication.shared.applicationState == .active },
         emit: @escaping (String, [String: Any]) -> Void)
    {
        self.audio = audio; self.socket = socket; self.ownership = ownership
        self.permission = permission; self.foreground = foreground
        self.emit = emit
        socket.failed = { [weak self] in self?.fail() }
        socket.received = { [weak self] event in self?.receive(event) }
        audio.drained = { [weak self] in
            guard let self else { return }
            guard response == nil, !paused else { return }
            state("listening")
        }
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            let action = self?.pending; self?.pending = nil; action?()
        })
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                if name == AVAudioSession.routeChangeNotification {
                    guard let self, ready, routeSignature != currentRoute() else { return }
                }
                self?.fail()
            })
        }
    }

    func beginAudio() {
        guard !ready, !paused, let current = id, let token else { return }
        let epoch = UUID()
        captureEpoch = epoch
        let inputBudget = RealtimeInputBudget()
        do {
            try ownership.activate(token, category: .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try audio.start(input: { [weak self] data in
                guard let self else { return }
                switch inputBudget.reserve(data.count) {
                case .closed: return
                case .overflow:
                    DispatchQueue.main.async {
                        if self.id == current, self.captureEpoch == epoch {
                            self.fail()
                        }
                    }
                    return
                case .accepted: break
                }
                DispatchQueue.main.async {
                    defer { inputBudget.release(data.count) }
                    guard self.id == current, self.captureEpoch == epoch, self.ready else { return }
                    self.socket.send(["type": "input_audio_buffer.append", "audio": data.base64EncodedString()])
                }
            }, failure: { [weak self] in
                DispatchQueue.main.async {
                    if self?.id == current, self?.captureEpoch == epoch {
                        self?.fail()
                    }
                }
            })
            routeSignature = currentRoute()
            ready = true; timer?.invalidate(); timer = nil
            let callback = opening; opening = nil; callback?(.success(())); state("listening")
        } catch { fail() }
    }

    func stop(_ identifier: String) throws {
        guard id == identifier else { return }
        ready = false; paused = false; awaitingClear = false; captureEpoch = UUID(); lifecycleEpoch = UUID(); pending = nil; timer?.invalidate(); timer = nil
        socket.close(); audio.stop()
        let callback = opening; opening = nil; callback?(.failure(Failure.stopped))
        if let token {
            try ownership.release(token); self.token = nil
        }
        id = nil; item = nil; response = nil; ignoredResponses.removeAll(); awaitingInputCommit = false
    }

    func currentRoute() -> String {
        let session = AVAudioSession.sharedInstance()
        return (session.currentRoute.inputs + session.currentRoute.outputs).map(\.uid).joined(separator: "|") + "|" + String(session.sampleRate)
    }

    func state(_ phase: String) {
        if let id {
            emit("VoiceRealtimeState", ["callId": id, "phase": phase])
        }
    }

    func fail() {
        guard let id else { return }
        emit("VoiceRealtimeInterrupted", ["callId": id])
        try? stop(id)
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        timer?.invalidate()
        let audio = audio, socket = socket, owned = token, ownership = ownership
        DispatchQueue.main.async {
            socket.close(); audio.stop(); if let owned {
                try? ownership.release(owned)
            }
        }
    }
}
