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
    let connectedDuration = VoiceConnectedDuration()
    var observedCaptions = LiveObservedCaptionBuffer()
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
    var audioStarting = false
    var firstAudioStart = true
    var paused = false
    var liveSocketEpoch: UUID?
    var liveStartID: String?
    var liveUnmuteID: String?
    var liveExpiresAt: Date?
    var liveSessionID: String?
    var liveExpiryTimer: Timer?
    var managedResponses: LiveResponsesToolBridge?
    var managedResponsesTransport = false
    var managedBackgroundOwner: (owner: LiveResponsesAdmission.Owner, audio: AudioSessionOwnership.Token, capture: UUID)?
    var captureEpoch = UUID()
    var outputRenderStartedAt: DispatchTime?
    var outputRenderClock = LiveManagedToolLatency.start
    var reportOutputRender: (Int) -> Void = { NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=live_health stage=pcm_append_to_rendered_output elapsed_ms=%d", $0) }
    var lifecycleEpoch = UUID()
    var awaitingInputCommit = false
    var observers: [NSObjectProtocol] = []
    let emit: (String, [String: Any]) -> Void
    var reportTermination = VoiceSystemCallLifecycle.report

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
            // A queued process-wide notice can outlive its active state. Preserve the pending owner.
            guard let self, foreground() else { return }
            let action = pending; pending = nil; action?()
        })
        for name in [UIApplication.didEnterBackgroundNotification, UIApplication.protectedDataWillBecomeUnavailableNotification, AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                guard let self else { return }
                if name == UIApplication.didEnterBackgroundNotification {
                    let stage = VoiceSystemCallLifecycle.backgroundStage(systemCallActive: systemCallActive,
                                                                         managed: managedResponsesTransport && !canContinueAcknowledgedManagedCall(), audioStarting: audioStarting)
                    if id != nil {
                        VoiceSystemCallLifecycle.report(stage)
                    }
                    if stage == .backgroundContinued {
                        return
                    }
                } else if name == AVAudioSession.routeChangeNotification {
                    guard ready || audioStarting, !routeSignature.isEmpty, routeSignature != currentRoute() else { return }
                    if id != nil {
                        VoiceSystemCallLifecycle.report(.routeChanged)
                    }
                } else if name == AVAudioSession.interruptionNotification {
                    let stage = VoiceSystemCallLifecycle.interruptionStage(note)
                    if id != nil {
                        VoiceSystemCallLifecycle.report(stage)
                    }
                    // The process-wide end does not prove loss of the current owner or authorize restarting one.
                    guard stage != .interruptionEnded else { return }
                } else if id != nil {
                    VoiceSystemCallLifecycle.report(.protectedDataLost)
                }
                fail()
            })
        }
    }

    func beginAudio() {
        guard !ready, !paused, !audioStarting, liveIsCurrent(), let current = id, let token else { return }
        if let systemCall, !systemCallActive {
            guard !systemCallPending, foreground() else { return }
            systemCallPending = true
            let lifecycle = lifecycleEpoch
            let systemOwner = UUID()
            systemCallOwner = systemOwner
            do {
                try systemCall.start(owner: systemOwner, prepare: { [weak self] in
                    guard let self, id == current, lifecycleEpoch == lifecycle, systemCallOwner == systemOwner,
                          systemCallPending, foreground() else { throw Failure.stopped }
                    try ownership.prepareSystemCall(token)
                }, activated: { [weak self] in
                    guard let self, id == current, lifecycleEpoch == lifecycle, systemCallOwner == systemOwner,
                          systemCallPending, !paused else { return }
                    guard foreground() else { fail(); return } // Pending activation cannot start inactive audio.
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
        bindDisplayMeter(callID: current, captureEpoch: epoch)
        let inputBudget = RealtimeInputBudget()
        do {
            if systemCallActive {
                try ownership.systemCallActivated(token)
            } else {
                try ownership.activate(token, category: .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
            }
            routeSignature = ""
            audioStarting = true
            let firstStart = firstAudioStart; firstAudioStart = false
            try finishAudioStart(input: { [weak self] data in
                guard let self else { return }
                switch inputBudget.reserve(data.count) {
                case .closed: return
                case .overflow:
                    DispatchQueue.main.async {
                        if self.id == current, self.captureEpoch == epoch {
                            self.fail(.liveInputOverflow)
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
                        self?.fail(.liveCaptureFailed)
                    }
                }
            }, firstStart: firstStart, ready: { [weak self] in
                guard let self, id == current, captureEpoch == epoch, audioStarting, !paused, liveIsCurrent() else { return }
                guard routeSignature.isEmpty || routeSignature == currentRoute() else { fail(); return }
                routeSignature = currentRoute()
                audioStarting = false
                connectedDuration.markReady(current)
                ready = true; timer?.invalidate(); timer = nil
                let callback = opening; opening = nil; callback?(.success(()))
                if id == current, captureEpoch == epoch, ready {
                    state("listening")
                }
            })
            if audioStarting {
                routeSignature = currentRoute()
            }
        } catch { fail() }
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

    /// Valid only for the first observed nonzero render of this owned enqueue burst.
    func observeRenderedOutput() {
        guard let start = outputRenderStartedAt else { return }
        outputRenderStartedAt = nil
        let now = DispatchTime.now().uptimeNanoseconds
        guard now >= start.uptimeNanoseconds else { return }
        let elapsed = (now - start.uptimeNanoseconds) / 1_000_000
        guard elapsed <= 300_000 else { return }
        reportOutputRender(Int(elapsed))
    }
}
