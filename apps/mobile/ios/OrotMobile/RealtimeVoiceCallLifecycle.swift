import AVFoundation
import Foundation

/// Mute releases the audio lease but preserves the authenticated server conversation.
extension RealtimeVoiceCall {
    /// Keep older supported systems on their existing permission API.
    static func requestPermission(_ completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: completion)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(completion)
        }
    }

    func open(_ identifier: String, model: String, key: String, language: String, voice: String = "default", enableTools: Bool = false,
              managedAdmission: LiveResponsesAdmission? = nil, completion: @escaping (Result<Void, Error>) -> Void)
    {
        guard id == nil, !identifier.isEmpty, model == "gpt-live-1.1", ["auto", "ko", "en"].contains(language),
              Self.liveVoices.contains(voice), !enableTools,
              !key.isEmpty, !key.contains("\n"), !key.contains("\r") else { completion(.failure(Failure.unavailable)); return }
        do { token = try ownership.reserve() } catch { completion(.failure(error)); return }
        tools.reset(enabled: false)
        connectedDuration.begin()
        id = identifier; paused = false; opening = completion
        let epoch = UUID(); lifecycleEpoch = epoch
        // The key is retained only while permission/open is pending and by the authenticated socket request.
        permission { [weak self] allowed in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.id == identifier, self.lifecycleEpoch == epoch else { return }
                guard allowed else { self.fail(); return }
                let begin = { [weak self] in
                    guard let self else { return }
                    guard id == identifier, lifecycleEpoch == epoch, liveSocketEpoch != epoch else { return }
                    let startID = UUID().uuidString
                    liveSocketEpoch = epoch
                    socket.received = { [weak self] event in
                        guard let self, liveSocketEpoch == epoch else { return }
                        receive(event)
                    }
                    socket.failed = { [weak self] in
                        guard let self, liveSocketEpoch == epoch else { return }
                        fail()
                    }
                    var event = Self.configuration(model: model, language: language, voice: voice)
                    if let managedAdmission {
                        guard let registry = LiveNativeToolRegistry(admission: managedAdmission),
                              let configuration = registry.configuration(for: managedAdmission),
                              var session = event["session"] as? [String: Any],
                              socket.admitResponsesTransport({ [weak self] in
                                  guard let self else { return false }
                                  return id == identifier && liveSocketEpoch == epoch && foreground() && managedAdmission.backendAllowed()
                              }) else { fail(); return }
                        managedResponsesTransport = true
                        session["delegation"] = configuration
                        session["instructions"] = Self.instructions(language: language, tools: registry.eligible)
                        event["session"] = session
                        managedResponses = LiveResponsesToolBridge(admission: managedAdmission, registry: registry) { [weak self] in
                            guard let self, liveSocketEpoch == epoch else { return }
                            if socket.discardManagedToolFrames() {
                                fail()
                            }
                        }
                    }
                    socket.open(model: model, key: key)
                    guard id == identifier, lifecycleEpoch == epoch else { return }
                    sendStartWithConnectingCue(event, startID: startID, identifier: identifier, epoch: epoch)
                }
                if self.foreground() {
                    begin()
                } else {
                    self.pending = begin
                }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            if self?.lifecycleEpoch == epoch {
                self?.fail()
            }
        }
    }

    /// Keep the official Live catalog aligned with the settings domain; default is omitted from the wire.
    private static var liveVoices: Set<String> {
        ["default", "marin", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa",
         "tempo", "beacon", "delta", "cinder", "nuri", "juni", "flitz", "brise", "sillage", "nira", "harema", "shida", "noeul"]
    }

    static func configuration(model: String, language: String, voice: String = "default") -> [String: Any] {
        var audio: [String: Any] = ["format": ["type": "audio/pcm", "rate": 24000] as [String: Any]]
        if voice != "default" {
            audio["output"] = ["voice": voice]
        }
        // Audio-only startup registers neither tools nor automatic Responses delegation.
        let session: [String: Any] = ["model": model, "audio": audio, "instructions": instructions(language: language),
                                      "delegation": ["type": "client"]]
        return ["type": "session.start", "session": session]
    }

    static func instructions(language: String, tools: [LiveNativeToolRegistry.Name] = []) -> String {
        let base = "You are Orot, a helpful voice assistant. Speak concisely. "
        let capability = tools.isEmpty ? "Do not claim to access records or perform actions." :
            tools.map(\.instruction).joined(separator: " ")
        return base + capability + (language == "ko" ? " Prefer Korean in this conversation." :
            language == "en" ? " Prefer English in this conversation." : "")
    }

    func pause(_ identifier: String) throws {
        guard id == identifier else { return }
        // A pending call has no confirmed session to mute, so close rather than send an out-of-order control.
        guard liveIsCurrent() else { try stop(identifier); return }
        guard !paused || opening != nil else { return }
        retireManagedResponses()
        guard liveIsCurrent() else { return }
        paused = true; liveUnmuteID = nil; ready = false; captureEpoch = UUID(); lifecycleEpoch = UUID()
        pending = nil; timer?.invalidate(); timer = nil
        let callback = opening; opening = nil
        callback?(.failure(Failure.stopped))
        socket.discardInput()
        interrupt()
        audio.stop(); endSystemCall()
        socket.send(["type": "session.input_audio.mute"])
        if let token {
            try ownership.release(token); self.token = nil
        }
        state("stopped")
    }

    func resume(_ identifier: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard id == identifier, paused, opening == nil, token == nil, foreground(), liveIsCurrent() else {
            completion(.failure(Failure.unavailable)); return
        }
        opening = completion
        let epoch = UUID(); lifecycleEpoch = epoch
        permission { [weak self] allowed in
            DispatchQueue.main.async {
                guard let self, self.id == identifier, self.lifecycleEpoch == epoch else { return }
                guard allowed, self.foreground() else { self.fail(); return }
                do {
                    self.token = try self.ownership.reserve()
                    let eventID = UUID().uuidString
                    self.liveUnmuteID = eventID
                    self.socket.send(["type": "session.input_audio.unmute", "event_id": eventID])
                } catch { self.fail() }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            if self?.lifecycleEpoch == epoch {
                self?.fail()
            }
        }
    }
}

extension RealtimeSocketPort {
    func admitResponsesTransport(_: @escaping () -> Bool) -> Bool {
        false
    }

    func sendManagedToolFrames(_: [[String: Any]], current _: @escaping () -> Bool) -> Bool {
        false
    }

    func sendTicketedToolFrames(_: [[String: Any]], current _: @escaping () -> Bool,
                               ticket _: LiveNativeResultDispatchAuthority.Ticket) -> Bool
    { false }

    func discardManagedToolFrames() -> Bool {
        false
    }

    func finishLive(sessionID _: String) {
        close()
    }
}
