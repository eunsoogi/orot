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
                socket.received?(["type": "session.updated"])
            }
            return ["synthetic": true, "opens": socket.opens, "closes": socket.closes,
                    "audioStarts": audio.starts, "audioStops": audio.stops, "readyEvents": readyEvents,
                    "transport": "in-memory", "audio": "in-memory"]
        }

        final class Socket: RealtimeSocketPort {
            var received: (([String: Any]) -> Void)?
            var failed: (() -> Void)?
            var opens = 0, closes = 0
            func open(model _: String, key _: String) {
                opens += 1
            }

            func send(_ event: [String: Any]) {
                if event["type"] as? String == "session.update" {
                    DispatchQueue.main.async { self.received?(["type": "session.updated"]) }
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
