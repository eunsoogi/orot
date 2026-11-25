#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation

    /// No test setting reaches the normal bridge build. Use the real saved
    /// settings witness over UUID-owned Keychain aliases, not a JS true flag.
    enum ComposedCanonicalOpenFixture {
        static var requested: Bool {
            UserDefaults.standard.object(forKey: "OROT_SETTINGS_CONSENT_CANONICAL_OPEN") != nil
        }
        static var allowed: Bool {
            SettingsConsentRealtimeFixture.admitted &&
                UserDefaults.standard.string(forKey: "OROT_SETTINGS_CONSENT_CANONICAL_OPEN") == "synthetic"
        }
        static var session: Session?

        static func read(_ service: String, _ account: String) -> [String: Any]? {
            guard allowed, let namespace = session?.namespace,
                  let alias = SettingsConsentRealtimeFixture.canonicalServiceAlias(service, account)
            else { return nil }
            return RealtimeVoiceCanonicalHealthAdmission.read(namespace + "." + alias, "synthetic-settings-consent")
        }

        static func makeCall(emit: @escaping (String, [String: Any]) -> Void) -> RealtimeVoiceCall {
            let endpoint = RealtimeVoiceSocketEndpoint(networklessTask: {
                session?.transport ?? ComposedCanonicalFixtureTransport()
            })
            return RealtimeVoiceCall(
                audio: SettingsConsentRealtimeFixture.Audio(), socket: RealtimeVoiceSocket(endpoint: endpoint),
                ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                permission: { $0(allowed && session != nil) }, foreground: { allowed && session != nil }, emit: emit,
            )
        }

        static func run(_ module: VoiceRealtimeModule, identifier: String, scenario: String,
                        finish: @escaping ([String: Any]) -> Void)
        {
            guard allowed, session == nil, module.active == nil,
                  let namespace = SettingsConsentRealtimeFixture.canonicalNamespace(identifier),
                  let value = RealtimeVoiceCanonicalHealthAdmission.read(
                      namespace + ".canonical-synthetic-health-binding", "synthetic-settings-consent",
                  ),
                  let binding = RealtimeVoiceCanonicalHealthAdmission(value),
                  ["open-allow", "open-decline", "open-mismatch", "open-reject-transfer", "open-retired", "open-locked"].contains(scenario)
            else {
                finish(["passed": false])
                return
            }
            let next = Session(namespace: namespace, scenario: scenario, module: module, finish: finish)
            session = next
            next.start(value, binding: binding)
        }

        final class Session {
            let namespace: String
            let scenario: String
            let module: VoiceRealtimeModule
            let finish: ([String: Any]) -> Void
            let transport = ComposedCanonicalFixtureTransport()
            let id = "canonical-open-" + UUID().uuidString
            let exact = #"{"tool":"local-health-context","items":[{"evidenceId":"synthetic","evidenceRevision":"one","content":"fixture"}]}"#
            var challenges = 0
            var completed = false
            private(set) var protectedBlocked = false

            init(namespace: String, scenario: String, module: VoiceRealtimeModule, finish: @escaping ([String: Any]) -> Void) {
                self.namespace = namespace
                self.scenario = scenario
                self.module = module
                self.finish = finish
            }

            func start(_ value: [String: Any], binding: RealtimeVoiceCanonicalHealthAdmission) {
                guard let key = ComposedCanonicalOpenFixture.read(
                    "com.orot.mobile.voice-settings.v1", "voice-settings",
                )?["apiKey"] as? String, key == "synthetic-live-" + String(namespace.dropFirst("com.orot.test.".count))
                else { complete(false); return }
                let base: NSDictionary = [
                    "backendModel": binding.backendModel, "generation": binding.legacyGeneration,
                    "grantID": binding.legacyGeneration + "-model",
                ]
                let declaration: [String: Any] = [
                    "name": RealtimeVoiceCanonicalHealthAdmission.name,
                    "description": "Synthetic owned canonical tool",
                    "strict": false,
                    "parameters": ["type": "object", "additionalProperties": false,
                                   "properties": ["days": [:], "topics": [:], "detail": [:], "window": [:]]],
                ]
                module.reviewCanonicalLiveCall(id, canonical: value as NSDictionary, baseline: base, resolver: { [weak self] result in
                    guard let self else { return }
                    let approved = result as? Bool
                    if scenario == "open-retired" {
                        complete(approved == nil && transport.openCount == 0 && challenges == 0)
                        return
                    }
                    if scenario == "open-decline" {
                        guard approved == false else { complete(false); return }
                        open(id, key: key, options: ["language": "auto", "voice": "default"])
                        return
                    }
                    guard approved == true else { complete(false); return }
                    let requested = scenario == "open-mismatch" ? id + "-wrong" : id
                    protectedBlocked = scenario == "open-locked"
                    open(requested, key: key, options: [
                        "language": "auto", "voice": "default", "responsesGrant": base,
                        "canonicalHealthGrant": value, "canonicalHealthDeclaration": declaration,
                    ])
                }, rejecter: { [weak self] _, _, _ in self?.complete(false) })
                DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
                    self?.complete(false)
                }
            }

            private func open(_ requested: String, key: String, options: NSDictionary) {
                module.openLiveCall(requested, model: "gpt-live-1.1", apiKey: key, options: options, resolver: { [weak self] _ in
                    guard let self else { return }
                    guard transport.openCount == 1,
                          let begin = transport.submitted.first?["session"] as? [String: Any],
                          let delegation = begin["delegation"] as? [String: Any]
                    else { complete(false); return }
                    if scenario == "open-decline" {
                        complete(delegation["type"] as? String == "client" && challenges == 0 && transport.resultFrames.isEmpty)
                        return
                    }
                    guard scenario != "open-mismatch", let response = delegation["responses"] as? [String: Any],
                          let tools = response["tools"] as? [[String: Any]],
                          tools.compactMap({ $0["name"] as? String }) == [RealtimeVoiceCanonicalHealthAdmission.name]
                    else { complete(false); return }
                    transport.delegate()
                }, rejecter: { [weak self] _, _, _ in
                    guard let self else { return }
                    let rejected = ["open-mismatch", "open-locked"].contains(scenario)
                    complete(rejected && transport.openCount == 0 && challenges == 0)
                })
            }

            func receive(_ event: String, _ payload: [String: Any]) {
                guard event == "VoiceRealtimeManagedToolCall", payload["callId"] as? String == id,
                      payload["name"] as? String == RealtimeVoiceCanonicalHealthAdmission.name,
                      let challenge = payload["challengeId"] as? String
                else { return }
                challenges += 1
                let denying = scenario == "open-reject-transfer"
                if !denying, !module.claimLiveResponsesResult(id, challengeId: challenge).boolValue {
                    complete(false)
                    return
                }
                module.settleLiveResponsesToolCall(id, challengeId: challenge, output: denying ? nil : exact, resolver: { [weak self] accepted in
                    guard let self else { return }
                    let frames = transport.resultFrames
                    if denying {
                        complete(challenges == 1 && frames.isEmpty)
                    } else {
                        let item = frames.first?["item"] as? [String: Any]
                        complete((accepted as? Bool) == true && challenges == 1 && frames.count == 2 &&
                                 item?["output"] as? String == exact && frames.last?["type"] as? String == "response.create")
                    }
                }, rejecter: { [weak self] _, _, _ in self?.complete(false) })
            }

            private func complete(_ passed: Bool) {
                guard !completed else { return }
                completed = true
                module.retireCanonicalLiveReview(id, resolver: { _ in }, rejecter: { _, _, _ in })
                module.stopRealtimeCall(id, resolver: { [self] _ in
                    ComposedCanonicalOpenFixture.session = nil
                    finish(["passed": passed])
                }, rejecter: { [self] _, _, _ in
                    ComposedCanonicalOpenFixture.session = nil
                    finish(["passed": false])
                })
            }
        }
    }
#endif
