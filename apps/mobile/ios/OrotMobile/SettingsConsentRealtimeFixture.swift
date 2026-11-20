#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation

    /// Explicit test-host only. All transport/audio/permission ports are synthetic;
    /// malformed opt-in stays denied and can never fall through to live defaults.
    enum SettingsConsentRealtimeFixture {
        static let socket = Socket()
        static let audio = Audio()
        static var readyEvents = 0
        static var requested: Bool {
            UserDefaults.standard.object(forKey: "OROT_SETTINGS_CONSENT_BOUNDARIES") != nil
        }

        static var admitted: Bool {
            let value = UserDefaults.standard.string(forKey: "OROT_SETTINGS_CONSENT_FIXTURE") ?? ""
            let prefix = "test-settings-consent-"
            return ProcessInfo.processInfo.arguments.contains("-OROT_TEST_HOST") &&
                UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "settings-provider-layout" &&
                UserDefaults.standard.string(forKey: "OROT_SETTINGS_CONSENT") == "synthetic" &&
                UserDefaults.standard.string(forKey: "OROT_SETTINGS_CONSENT_BOUNDARIES") == "synthetic" &&
                value.hasPrefix(prefix) && UUID(uuidString: String(value.dropFirst(prefix.count))) != nil
        }

        static func makeCall(emit: @escaping (String, [String: Any]) -> Void) -> RealtimeVoiceCall {
            RealtimeVoiceCall(audio: audio, socket: socket,
                              ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                              permission: { $0(admitted) }, foreground: { admitted }, emit: { name, body in
                                  if name == "VoiceRealtimeState", body["phase"] as? String == "listening" {
                                      readyEvents += 1
                                  }
                                  emit(name, body)
                              })
        }

        static func snapshot(lateEvent: Bool) -> [String: Any] {
            guard admitted else { return ["denied": true] }
            if lateEvent {
                socket.deliverLateStart?()
            }
            return ["synthetic": true, "opens": socket.opens, "closes": socket.closes,
                    "audioStarts": audio.starts, "audioStops": audio.stops, "readyEvents": readyEvents,
                    "transport": "in-memory", "audio": "in-memory"]
        }

        final class Socket: RealtimeSocketPort {
            var received: (([String: Any]) -> Void)?
            var failed: (() -> Void)?
            var opens = 0, closes = 0
            var deliverLateStart: (() -> Void)?
            func open(model: String, key _: String) {
                guard admitted, model == "gpt-live-1.1" else { failed?(); return }
                opens += 1
            }

            func send(_ event: [String: Any]) {
                guard admitted, let eventID = event["event_id"] as? String,
                      let currentReceive = received else { return }
                switch event["type"] as? String {
                case "session.start":
                    let message: [String: Any] = [
                        "type": "session.started", "client_event_id": eventID,
                        "session": ["id": "synthetic-live", "model": "gpt-live-1.1",
                                    "status": "active", "expires_at": Date().timeIntervalSince1970 + 180],
                    ]
                    // Replay the original callback, never the next call's current observer.
                    deliverLateStart = { currentReceive(message) }
                    DispatchQueue.main.async { currentReceive(message) }
                case "session.input_audio.unmute":
                    DispatchQueue.main.async {
                        currentReceive(["type": "session.input_audio.unmuted", "client_event_id": eventID])
                    }
                default:
                    break
                }
            }

            func discardInput() {}
            func close() {
                closes += 1
            }
        }

        final class Audio: RealtimeAudioPort {
            var isDrained = true
            var drained: (() -> Void)?
            var starts = 0, stops = 0
            func start(input _: @escaping (Data) -> Void, failure _: @escaping () -> Void) throws {
                starts += 1
            }

            func append(_: Data) throws {}
            func cancel() -> Int {
                0
            }

            func stop() {
                stops += 1
            }
        }
    }
#endif
