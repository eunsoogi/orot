#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation
    import React

    /// Synthetic test command only. Never returns identifiers, content or grants.
    enum SettingsConsentCanonicalQueueProbe {
        enum Scenario: String {
            case allow, deny, replace
        }

        static func run(identifier: String, rawScenario: String, finish: @escaping ([String: Any]) -> Void) {
            guard let scenario = Scenario(rawValue: rawScenario),
                  SettingsConsentRealtimeFixture.admitted,
                  UserDefaults.standard.string(forKey: "OROT_SETTINGS_CONSENT_CANONICAL_QUEUE") == "synthetic",
                  let namespace = SettingsConsentRealtimeFixture.canonicalNamespace(identifier),
                  let companion = RealtimeVoiceCanonicalHealthAdmission.read(
                      namespace + ".canonical-synthetic-health-binding", "synthetic-settings-consent",
                  ),
                  let binding = RealtimeVoiceCanonicalHealthAdmission(companion)
            else { finish(["denied": true]); return }
            let baseline = [
                "backendModel": binding.backendModel,
                "generation": binding.legacyGeneration,
                "grantID": binding.legacyGeneration + "-model",
            ]
            let session = Session(identifier: identifier, scenario: scenario, finish: finish)
            session.start(baseline: baseline, companion: companion)
        }

        private final class Session {
            let identifier: String
            let scenario: Scenario
            let finish: ([String: Any]) -> Void
            let owner = LiveResponsesAdmission.Owner(callID: "fixture-call", sessionID: "fixture-session", epoch: UUID())
            let task = ProbeTask(), successor = ProbeTask()
            let exact = #"{"tool":"local-health-context","items":[{"evidenceId":"fixture-source","evidenceRevision":"one","content":"synthetic"}]}"#
            var owned: SettingsConsentRealtimeFixture.CanonicalQueueOwner?
            var bridge: LiveResponsesToolBridge?
            var generation = 0
            var commands = 0
            var completed = false
            var live = true

            init(identifier: String, scenario: Scenario, finish: @escaping ([String: Any]) -> Void) {
                self.identifier = identifier
                self.scenario = scenario
                self.finish = finish
            }

            func start(baseline: [String: String], companion: [String: Any]) {
                let declaration: [String: Any] = [
                    "name": "local-health-context", "description": "Synthetic queue fixture", "strict": false,
                    "parameters": ["type": "object", "additionalProperties": false,
                                   "properties": ["days": [:], "detail": [:], "topics": [:], "window": [:]]],
                ]
                let result = SettingsConsentRealtimeFixture.canonicalQueueFixture(
                    identifier: identifier, baseline: baseline, companion: companion, declaration: declaration,
                    owns: { [weak self] request in
                        guard let self else { return false }
                        return live && request.call == owner.callID && request.session == owner.sessionID &&
                            request.epoch == owner.epoch && request.response == "fixture-response" &&
                            request.delegation == "fixture-delegation" && request.function == "fixture-function"
                    },
                    callID: owner.callID, task: { [weak self] in
                        guard let self else { return ProbeTask() }
                        generation += 1
                        return generation == 1 ? task : successor
                    },
                    emit: { [weak self] name, payload in self?.receive(name, payload) },
                )
                guard let result, let registry = LiveNativeToolRegistry(admission: result.admission),
                      registry.configuration(for: result.admission) != nil
                else { finish(["denied": true]); return }
                owned = result
                bridge = LiveResponsesToolBridge(admission: result.admission, registry: registry, discard: {})
                result.socket.open(model: "gpt-live-1.1", key: "synthetic-fixture")
                feed(["type": "session.delegation.created", "event_id": "created", "offset_ms": 0,
                      "delegation": ["type": "delegation", "target": "responses", "id": "fixture-delegation",
                                     "response_id": "fixture-response"]])
                event("response-created", ["type": "response.created", "response": ["id": "fixture-response"]])
                event("tool", ["type": "response.output_item.done",
                               "item": ["type": "function_call", "name": "local-health-context", "call_id": "fixture-function",
                                        "arguments": #"{"days":7,"topics":["measurements"]}"#]])
                event("done", ["type": "response.completed", "response": ["id": "fixture-response", "status": "completed"]])
                // Retain only this local fixture until the actual queue settles or times out.
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.complete(false, timedOut: true) }
            }

            private func event(_ id: String, _ value: [String: Any]) {
                feed(["type": "response.event", "event_id": id, "delegation_id": "fixture-delegation", "event": value])
            }

            private func feed(_ envelope: [String: Any]) {
                bridge?.receive(envelope, owner: owner, current: { [weak self] in self?.live == true }) {
                    [weak self] frames, current, ticket in
                    guard let self, let owned, let ticket,
                          owned.socket.sendTicketedToolFrames(frames, current: current, ticket: ticket)
                    else { ticket?.retire(); return }
                    if scenario == .replace {
                        live = false
                        owned.socket.close()
                        owned.socket.open(model: "gpt-live-1.1", key: "synthetic-fixture")
                    }
                    task.completeFirst()
                }
            }

            private func receive(_ name: String, _ payload: [String: Any]) {
                guard name == "VoiceRealtimeManagedToolCall", let owned,
                      let challenge = payload["challengeId"] as? String else { return }
                commands += 1
                if scenario == .deny {
                    owned.mailbox.settle(challenge, output: nil) { [weak self] _ in self?.complete(false) }
                    return
                }
                guard owned.claim(challenge) else { complete(false); return }
                owned.mailbox.settle(challenge, output: exact) { [weak self] value in self?.complete(value) }
            }

            private func complete(_ acknowledged: Bool, timedOut: Bool = false) {
                guard !completed else { return }
                completed = true
                live = false
                let observed = task.messages.compactMap {
                    (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any]
                }
                let first = observed.first?["item"] as? [String: String]
                owned?.socket.close()
                bridge?.retire()
                let expectedSuccessorResumes = scenario == .replace ? 1 : 0
                guard task.resumes == 1, successor.resumes == expectedSuccessorResumes
                else { finish(["denied": true]); return }
                finish([
                    "synthetic": true, "timedOut": timedOut, "acknowledged": acknowledged, "challenges": commands,
                    "frames": observed.count, "successorFrames": successor.messages.count,
                    "exactOutput": first?["output"] == exact,
                    "continuation": observed.last?["type"] as? String == "response.create",
                ])
            }
        }

        private final class ProbeTask: RealtimeVoiceSocketTask {
            private(set) var resumes = 0
            var messages: [String] = []
            var completions: [@Sendable (Error?) -> Void] = []
            func resume() {
                resumes += 1
            }

            func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
                guard case let .string(text) = message else { return }
                messages.append(text)
                completions.append(completionHandler)
            }

            func receive(completionHandler _: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {}
            func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {}
            func completeFirst() {
                completions.first?(nil)
            }
        }
    }

    extension VoiceRealtimeModule {
        @objc(settingsConsentCanonicalQueueProbe:scenario:resolver:rejecter:)
        func settingsConsentCanonicalQueueProbe(
            _ identifier: String, scenario: String, resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter _: @escaping RCTPromiseRejectBlock,
        ) {
            DispatchQueue.main.async {
                SettingsConsentCanonicalQueueProbe.run(identifier: identifier, rawScenario: scenario) { resolve($0) }
            }
        }
    }
#endif
