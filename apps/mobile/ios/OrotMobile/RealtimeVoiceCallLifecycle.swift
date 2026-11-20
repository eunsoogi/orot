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

    func open(_ identifier: String, model: String, key: String, language: String, voice: String = "default", enableTools: Bool = false, completion: @escaping (Result<Void, Error>) -> Void) {
        guard id == nil, !identifier.isEmpty, model == "gpt-live-1.1", ["auto", "ko", "en"].contains(language),
              Self.liveVoices.contains(voice), !enableTools,
              !key.isEmpty, !key.contains("\n"), !key.contains("\r") else { completion(.failure(Failure.unavailable)); return }
        do { token = try ownership.reserve() } catch { completion(.failure(error)); return }
        tools.reset(enabled: false)
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
                    guard id == identifier, lifecycleEpoch == epoch else { return }
                    let startID = UUID().uuidString
                    liveStartID = startID
                    liveSocketEpoch = epoch
                    socket.received = { [weak self] event in
                        guard let self, liveSocketEpoch == epoch else { return }
                        receive(event)
                    }
                    socket.failed = { [weak self] in
                        guard let self, liveSocketEpoch == epoch else { return }
                        fail()
                    }
                    socket.open(model: model, key: key)
                    guard id == identifier, lifecycleEpoch == epoch else { return }
                    var event = Self.configuration(model: model, language: language, voice: voice)
                    event["event_id"] = startID
                    socket.send(event)
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
        let base = "You are Orot, a helpful voice assistant. Speak concisely. Do not claim to access records or perform actions."
        let instructions = switch language {
        case "ko": base + " Prefer Korean in this conversation."
        case "en": base + " Prefer English in this conversation."
        default: base
        }
        // Register neither tools nor an automatic Responses delegation.
        let session: [String: Any] = ["model": model, "audio": audio, "instructions": instructions,
                                      "delegation": ["type": "client"]]
        return ["type": "session.start", "session": session]
    }

    func pause(_ identifier: String) throws {
        guard id == identifier else { return }
        // A pending call has no confirmed session to mute, so close rather than send an out-of-order control.
        guard liveIsCurrent() else { try stop(identifier); return }
        guard !paused || opening != nil else { return }
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
