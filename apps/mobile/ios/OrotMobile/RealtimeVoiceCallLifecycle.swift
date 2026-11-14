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

    func open(_ identifier: String, model: String, key: String, language: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard id == nil, !identifier.isEmpty, ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"].contains(model),
              !key.isEmpty, !key.contains("\n"), !key.contains("\r") else { completion(.failure(Failure.unavailable)); return }
        do { token = try ownership.reserve() } catch { completion(.failure(error)); return }
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
                    socket.open(model: model, key: key)
                    socket.send(Self.configuration(model: model, language: language))
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

    static func configuration(model: String, language: String) -> [String: Any] {
        let pcm: [String: Any] = ["type": "audio/pcm", "rate": 24000]
        return ["type": "session.update", "session": ["type": "realtime", "model": model, "output_modalities": ["audio"],
                                                      "instructions": "You are Orot, a helpful voice assistant. Speak concisely. Do not claim to access records or perform actions. Respond in the user's language.",
                                                      "audio": ["input": ["format": pcm, "transcription": ["model": "gpt-4o-mini-transcribe", "language": String(language.prefix(2))],
                                                                          "turn_detection": ["type": "server_vad", "create_response": true, "interrupt_response": true]],
                                                                "output": ["format": pcm, "voice": "marin"]]]]
    }

    func pause(_ identifier: String) throws {
        guard id == identifier else { return }
        paused = true; awaitingClear = true; ready = false; captureEpoch = UUID(); lifecycleEpoch = UUID()
        pending = nil; timer?.invalidate(); timer = nil
        let callback = opening; opening = nil
        callback?(.failure(Failure.stopped))
        socket.discardInput()
        interrupt()
        audio.stop()
        socket.send(["type": "input_audio_buffer.clear"])
        if let token {
            try ownership.release(token); self.token = nil
        }
        state("stopped")
    }

    func resume(_ identifier: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard id == identifier, paused, opening == nil, token == nil, foreground() else {
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
                    self.paused = false
                    self.beginAudio()
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
