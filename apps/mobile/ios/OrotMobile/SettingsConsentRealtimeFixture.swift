#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation

    /// Explicit test-host only. All transport/audio/permission ports are synthetic;
    /// malformed opt-in stays denied and can never fall through to live defaults.
    enum SettingsConsentRealtimeFixture {
        struct CanonicalQueueOwner {
            let socket: RealtimeVoiceSocket
            let mailbox: RealtimeVoiceCanonicalHealthMailbox
            let admission: LiveResponsesAdmission
            let claim: (String) -> Bool
        }

        /// Private native fixture selector. Product module options cannot reach
        /// this entry: it requires the current UI-test launch and UUID namespace.
        static func canonicalQueueFixture(
            identifier: String,
            baseline: [String: String],
            companion: [String: Any],
            declaration: [String: Any],
            owns: @escaping (RealtimeVoiceCanonicalHealthMailbox.Request) -> Bool,
            callID: String,
            task: @escaping () -> RealtimeVoiceSocketTask,
            emit: @escaping (String, [String: Any]) -> Void,
        ) -> CanonicalQueueOwner? {
            guard admitted, let namespace = canonicalNamespace(identifier),
                  RealtimeVoiceToolLease.validID(callID),
                  let base = LiveResponsesSettingsGrant(baseline),
                  let cap = RealtimeVoiceCanonicalHealthAdmission(companion)
            else { return nil }
            let key = "synthetic-live-" + identifier
            let read = { (service: String, account: String) -> [String: Any]? in
                guard admitted, canonicalNamespace(identifier) == namespace,
                      let alias = canonicalServiceAlias(service, account)
                else { return nil }
                // Aliases are never resolved through a product Keychain service.
                return RealtimeVoiceCanonicalHealthAdmission.read(
                    namespace + "." + alias, "synthetic-settings-consent",
                )
            }
            guard cap.configuration(declaration, base: base, key: key, read: read) != nil else { return nil }
            let authority = LiveNativeResultDispatchAuthority()
            let mailbox = RealtimeVoiceCanonicalHealthMailbox(
                call: callID, baseline: base, capability: cap, authority: authority, key: key, read: read,
                owns: { admitted && canonicalNamespace(identifier) == namespace && owns($0) },
                emit: emit,
            )
            let socket = RealtimeVoiceSocket(endpoint: RealtimeVoiceSocketEndpoint(networklessTask: task))
            return CanonicalQueueOwner(
                socket: socket, mailbox: mailbox,
                admission: mailbox.bridge(backendModel: base.backendModel, declaration: declaration),
                claim: { challengeID in
                    admitted && canonicalNamespace(identifier) == namespace &&
                        authority.claim(call: callID, challenge: challengeID)
                },
            )
        }

        static func canonicalNamespace(_ identifier: String, launched: String? = UserDefaults.standard.string(forKey: "OROT_SETTINGS_CONSENT_FIXTURE")) -> String? {
            let prefix = "test-settings-consent-"
            guard let launched, launched.lowercased() == identifier, identifier == identifier.lowercased(),
                  identifier.hasPrefix(prefix),
                  let uuid = UUID(uuidString: String(identifier.dropFirst(prefix.count))),
                  identifier == prefix + uuid.uuidString.lowercased()
            else { return nil }
            return "com.orot.test." + identifier
        }

        static func canonicalServiceAlias(_ service: String, _ account: String) -> String? {
            switch (service, account) {
            case ("com.orot.mobile.settings-consent-authority.v1.voice", "settings-consent-authority"):
                "authority-voice"
            case ("com.orot.mobile.settings-consent-authority.v1.voice-responses", "settings-consent-authority"):
                "authority-voice-responses"
            case ("com.orot.mobile.settings-consent-authority.v1.voice-responses-health-context", "settings-consent-authority"):
                "authority-voice-responses-health-context"
            case ("com.orot.mobile.voice-settings.v1", "voice-settings"):
                "canonical-synthetic-voice-settings"
            case ("com.orot.mobile.live-health-context.v2", "live-health-context"):
                "canonical-synthetic-health-binding"
            default:
                nil
            }
        }

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
