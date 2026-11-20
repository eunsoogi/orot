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
    let tools = RealtimeVoiceToolLease()
    let systemCall: VoiceSystemCallPort?
    var systemCallOwner: UUID?
    var systemCallPending = false
    var systemCallActive = false
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
    var liveSocketEpoch: UUID?
    var liveStartID: String?
    var liveUnmuteID: String?
    var liveExpiresAt: Date?
    var liveSessionID: String?
    var liveExpiryTimer: Timer?
    var captureEpoch = UUID()
    var lifecycleEpoch = UUID()
    var awaitingInputCommit = false
    var observers: [NSObjectProtocol] = []
    let emit: (String, [String: Any]) -> Void

    init(audio: RealtimeAudioPort = RealtimeVoiceAudio(), socket: RealtimeSocketPort = RealtimeVoiceSocket(),
         ownership: AudioSessionOwnership = .shared, systemCall: VoiceSystemCallPort? = nil,
         permission: @escaping (@escaping (Bool) -> Void) -> Void = RealtimeVoiceCall.requestPermission,
         foreground: @escaping () -> Bool = { UIApplication.shared.applicationState == .active },
         emit: @escaping (String, [String: Any]) -> Void)
    {
        self.audio = audio; self.socket = socket; self.ownership = ownership
        self.permission = permission; self.foreground = foreground; self.systemCall = systemCall
        self.emit = emit
        audio.drained = { [weak self] in
            guard let self else { return }
            guard ready, !paused else { return }
            state("listening")
        }
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            let action = self?.pending; self?.pending = nil; action?()
        })
        for name in [UIApplication.didEnterBackgroundNotification, UIApplication.protectedDataWillBecomeUnavailableNotification, AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                if name == UIApplication.didEnterBackgroundNotification, self?.systemCallActive == true {
                    return
                }
                if name == AVAudioSession.routeChangeNotification {
                    guard let self, ready, routeSignature != currentRoute() else { return }
                }
                self?.fail()
            })
        }
    }

    func beginAudio() {
        guard !ready, !paused, liveIsCurrent(), let current = id, let token else { return }
        if let systemCall, !systemCallActive {
            guard !systemCallPending, foreground() else { return }
            systemCallPending = true
            let lifecycle = lifecycleEpoch
            let systemOwner = UUID()
            systemCallOwner = systemOwner
            do {
                try systemCall.start(owner: systemOwner, prepare: { [weak self] in
                    guard let self, id == current, lifecycleEpoch == lifecycle else { throw Failure.stopped }
                    try ownership.prepareSystemCall(token)
                }, activated: { [weak self] in
                    guard let self, id == current, lifecycleEpoch == lifecycle, !paused else { return }
                    systemCallPending = false; systemCallActive = true
                    emit("VoiceRealtimeSystemCall", ["callId": current, "active": true])
                    beginAudio()
                }, ended: { [weak self] in
                    guard let self, id == current, lifecycleEpoch == lifecycle else { return }
                    fail()
                }, muted: { [weak self] in
                    guard let self, id == current, lifecycleEpoch == lifecycle else { return }
                    // Only a successfully released, previously active call is resumable from JS.
                    guard ready, liveIsCurrent() else { fail(); return }
                    do {
                        try pause(current)
                        if id == current, paused, self.token == nil {
                            emit("VoiceRealtimePaused", ["callId": current])
                        }
                    } catch { fail() }
                })
            } catch { fail() }
            return
        }
        let epoch = UUID()
        captureEpoch = epoch
        let inputBudget = RealtimeInputBudget()
        do {
            if systemCallActive {
                try ownership.systemCallActivated(token)
            } else {
                try ownership.activate(token, category: .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
            }
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
                    guard self.id == current, self.captureEpoch == epoch, self.ready, self.liveIsCurrent() else { return }
                    self.socket.send(["type": "session.input_audio.append", "audio": data.base64EncodedString()])
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

    func stop(_ identifier: String, graceful: Bool = false) throws {
        guard id == identifier else { return }
        let finalSession = graceful && (ready || paused) && liveIsCurrent() ? liveSessionID : nil
        liveSessionID = nil
        ready = false; paused = false; liveSocketEpoch = nil; liveStartID = nil; liveUnmuteID = nil; liveExpiresAt = nil
        liveExpiryTimer?.invalidate(); liveExpiryTimer = nil; captureEpoch = UUID(); lifecycleEpoch = UUID(); pending = nil; timer?.invalidate(); timer = nil
        cancelTools(); tools.enabled = false
        if finalSession == nil {
            socket.close()
        }
        audio.stop(); endSystemCall()
        let callback = opening; opening = nil
        // Let the bridge observe that this owner is cleared before rejecting its open.
        // If release fails, the retained owner remains available for an explicit stop retry.
        defer { callback?(.failure(Failure.stopped)) }
        do {
            if let token {
                try ownership.release(token); self.token = nil
            }
        } catch {
            if finalSession != nil {
                socket.close()
            }
            throw error
        }
        if let finalSession {
            socket.finishLive(sessionID: finalSession)
        }
        id = nil; item = nil; response = nil; ignoredResponses.removeAll(); awaitingInputCommit = false
    }

    /// Clear the background allowance before tearing down the system call or releasing audio.
    func endSystemCall() {
        systemCallActive = false; systemCallPending = false
        if let id {
            emit("VoiceRealtimeSystemCall", ["callId": id, "active": false])
        }
        if let owner = systemCallOwner {
            systemCall?.end(owner: owner)
        }
        systemCallOwner = nil
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
        guard let id else { socket.close(); return }
        emit("VoiceRealtimeInterrupted", ["callId": id])
        try? stop(id)
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        timer?.invalidate()
        liveExpiryTimer?.invalidate()
        let audio = audio, socket = socket, owned = token, ownership = ownership, systemCall = systemCall, systemCallOwner = systemCallOwner
        let tool = tools.invalidate(), callID = id, emit = emit
        DispatchQueue.main.async {
            if let tool, let callID {
                emit("VoiceRealtimeToolCancelled", ["callId": callID, "toolCallId": tool])
            }
            socket.close(); audio.stop()
            if let systemCallOwner {
                systemCall?.end(owner: systemCallOwner)
            }
            if let owned {
                try? ownership.release(owned)
            }
        }
    }
}
