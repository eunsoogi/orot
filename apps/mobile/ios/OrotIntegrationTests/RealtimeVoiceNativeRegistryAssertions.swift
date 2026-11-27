import Foundation
@testable import Orot
import XCTest

enum RealtimeVoiceNativeRegistryAssertions {
    static func assertAudioOnlySessionAdvertisesNoToolsOrRecordAccess() throws {
        let event = RealtimeVoiceCall.configuration(model: "gpt-live-1.1", language: "ko")
        let session = try XCTUnwrap(event["session"] as? [String: Any])
        let delegation = try XCTUnwrap(session["delegation"] as? [String: String])
        XCTAssertEqual(delegation, ["type": "client"])
        let instruction = try XCTUnwrap(session["instructions"] as? String)
        XCTAssertTrue(instruction.contains("Do not claim to access records or perform actions"))
        XCTAssertTrue(instruction.contains("Prefer Korean"))
    }

    static func assertExactOwnedRegistryMatchesWireAndRejectsUnknownOrRevokedAdmission() throws {
        for model in ["gpt-6-luna", "gpt-6-sol"] {
            let owned = admission(model: model, functionName: "local-health-context", allowed: true)
            let registry = try XCTUnwrap(LiveNativeToolRegistry(admission: owned))
            let configuration = try XCTUnwrap(registry.configuration(for: owned))
            let responses = try XCTUnwrap(configuration["responses"] as? [String: Any])
            XCTAssertEqual(responses["model"] as? String, model)
            let tools = try XCTUnwrap(responses["tools"] as? [[String: Any]])
            XCTAssertEqual(tools.compactMap { $0["name"] as? String }, ["local-health-context"])
            let parameters = try XCTUnwrap(tools.first?["parameters"] as? [String: Any])
            XCTAssertEqual(parameters["additionalProperties"] as? Bool, false)
            XCTAssertTrue(registry.allows("local-health-context"))
            XCTAssertFalse(registry.allows("orot_personal_records"))
            XCTAssertFalse(registry.allows("orot_reviewed_memory"))
            XCTAssertNil(registry.configuration(for: admission(model: model, functionName: "local-health-context", allowed: false)))
            XCTAssertNil(LiveNativeToolRegistry(admission: admission(model: model, functionName: "orot_personal_records", allowed: true)))
            let instruction = RealtimeVoiceCall.instructions(language: "en", tools: registry.eligible)
            XCTAssertTrue(instruction.contains("independently approved results"))
        }
    }

    private static func admission(model: String, functionName: String, allowed: Bool) -> LiveResponsesAdmission {
        LiveResponsesAdmission(
            backendModel: model, functionName: functionName, backendAllowed: { allowed },
            mayRun: { _ in false }, approve: { _, finish in finish(false); return {} },
            execute: { _, finish in finish(nil); return {} }, mayDisclose: { _, _ in false },
            dispatchTicket: { _, _ in nil },
            canonicalConfiguration: { stockConfiguration(model) },
        )
    }

    static func stockConfiguration(_ model: String) -> [String: Any] {
        var tool = LiveCanonicalContextV3Transport.stock
        tool["type"] = "function"; tool["strict"] = false
        return ["type": "responses", "responses": ["model": model, "tools": [tool]]]
    }
}

#if OROT_TESTS && targetEnvironment(simulator)
    extension RealtimeVoiceLifecycleTests {
        @MainActor
        func testCanonicalV3OwnsStockStartupAndRechecksExactSourceOnSocket() async throws {
            let selected = LiveConversationToolsSettingsWitness(backendModel: "gpt-6-luna", credentialEpoch: "test-epoch",
                                                                generation: "test-generation", grantID: "test-generation-model", voiceGeneration: "test-voice")
            let owner = LiveResponsesAdmission.Owner(callID: "fixture-call", sessionID: "fixture-session", epoch: UUID())
            let request = LiveResponsesAdmission.Request(owner: owner, delegationID: "fixture-delegation", responseID: "fixture-response",
                                                         functionID: "fixture-function", name: "local-health-context", canonicalArguments: "{}")
            let exact = #"{"tool":"local-health-context","items":[{"evidenceId":"fixture","evidenceRevision":"1","content":"Synthetic"}]}"#
            let expected = LiveCanonicalContextV3Transport.registration(selected)
            for mode in ["allowed", "source-revoked", "wrong-bytes", "retired", "replacement"] {
                var ownerCurrent = true, sourceCurrent = true
                let task = CommonV3NetworklessSocketTask()
                let socket = RealtimeVoiceSocket(endpoint: RealtimeVoiceSocketEndpoint(networklessTask: { task }))
                defer { socket.close() }
                socket.failed = { [weak socket] in socket?.close() }
                socket.open(model: "gpt-live-1.1", key: "synthetic")
                func create(_ registration: [String: Any]) -> LiveCanonicalContextV3Transport? {
                    LiveCanonicalContextV3Transport(call: owner.callID, requested: registration, witness: { selected },
                                                    startupCurrent: { $0 == owner.callID && ownerCurrent }, owns: { $0 == owner && ownerCurrent },
                                                    ownsRequest: { $0 == request },
                                                    sourceTicketCurrent: { $0 == request && $1 == exact && sourceCurrent })
                }
                var wrong = expected
                wrong["tools"] = [["name": "orot_health_context"]]
                XCTAssertNil(create(wrong))
                let factory = try XCTUnwrap(create(expected))
                XCTAssertNotNil(factory.configurationForStartup())
                XCTAssertNil(factory.begin(request))
                let ack = try XCTUnwrap(factory.acknowledge(owner))
                XCTAssertEqual(ack["sessionId"] as? String, owner.sessionID)
                XCTAssertNil(factory.acknowledge(owner))
                let body = try XCTUnwrap(factory.begin(request))
                let item = try XCTUnwrap((body["calls"] as? [[String: Any]])?.first)
                let challenge = try XCTUnwrap(item["challengeId"] as? String)
                XCTAssertEqual(item["toolCallId"] as? String, request.functionID)
                XCTAssertFalse(factory.claim(callId: "stale-call", challenge: challenge))
                XCTAssertTrue(factory.claim(callId: owner.callID, challenge: challenge))
                XCTAssertFalse(factory.claim(callId: owner.callID, challenge: challenge))
                XCTAssertNil(factory.begin(request))

                let result = mode == "wrong-bytes" ? exact + " " : exact
                var receipts: [Bool] = []
                let settled = expectation(description: "exact local settlement")
                factory.settle(callId: owner.callID, challenge: challenge, exact: result, socket: socket) {
                    receipts.append($0)
                    settled.fulfill()
                }
                if mode == "wrong-bytes" {
                    await fulfillment(of: [settled], timeout: 1)
                    XCTAssertTrue(task.writes.isEmpty)
                    XCTAssertEqual(receipts, [false])
                    continue
                }
                XCTAssertEqual(task.types, ["response.item.create"])
                if mode == "source-revoked" {
                    sourceCurrent = false
                }
                if mode == "replacement" {
                    ownerCurrent = false
                }
                if mode == "retired" {
                    factory.retire(callId: owner.callID, challenge: challenge)
                }
                if mode == "allowed" {
                    let continuation = expectation(description: "held socket continuation")
                    task.onContinuation = { continuation.fulfill() }
                    task.writes.removeFirst()(nil)
                    await fulfillment(of: [continuation], timeout: 1)
                    task.writes.removeFirst()(nil)
                } else {
                    task.writes.removeFirst()(nil)
                }
                await fulfillment(of: [settled], timeout: 1)
                XCTAssertEqual(task.types, mode == "allowed" ? ["response.item.create", "response.create"] : ["response.item.create"])
                XCTAssertEqual(receipts, [mode == "allowed"])
            }
        }
    }

    private final class CommonV3NetworklessSocketTask: RealtimeVoiceSocketTask {
        var writes: [@Sendable (Error?) -> Void] = []
        var types: [String] = []
        var onContinuation: (() -> Void)?
        func resume() {}
        func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
            let type = RealtimeVoiceSocket.decodeSocketEvent(message)?["type"] as? String ?? ""
            types.append(type)
            writes.append(completionHandler)
            if type == "response.create" {
                onContinuation?()
            }
        }

        func receive(completionHandler _: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {}
        func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {}
    }
#endif

/// Synthetic managed call witness: only an already-issued partial handoff
/// makes fresh speech retire the socket; no event payload enters diagnostics.
extension RealtimeVoiceLifecycleTests {
    func assertFreshSpeechDiscriminatesPartialToolResultRetirement() async throws {
        for issued in [false, true] {
            let socket = ManagedResponseFixtureSocket()
            let configured = expectation(description: "managed socket configured")
            let queued = expectation(description: "protected result and continuation queued")
            socket.configured = { configured.fulfill() }
            socket.queued = { queued.fulfill() }
            let call = managedFixtureCall(socket)
            defer { try? call.stop("fixture-call") }
            var observed: [VoiceSystemCallLifecycle.DiagnosticStage] = []
            call.reportTermination = { [weak call] stage in
                XCTAssertEqual(call?.id, "fixture-call", "The exact call still owns the termination.")
                observed.append(stage)
            }
            let admission = managedAdmission { _, finish in
                finish(#"{"status":"synthetic"}"#)
                return {}
            }
            call.open("fixture-call", model: "gpt-live-1.1", key: "synthetic-key", language: "auto",
                      managedAdmission: admission) { _ in }
            await fulfillment(of: [configured], timeout: 2)
            socket.received?(started())
            managedEvents().forEach { socket.received?($0) }
            await fulfillment(of: [queued], timeout: 2)
            if issued {
                XCTAssertTrue(socket.handoff())
            }
            socket.received?(["type": "session.input_transcript.delta", "event_id": "fresh-witness",
                              "start_ms": 6, "end_ms": 7, "delta": "synthetic content must not become a stage"])
            XCTAssertTrue(socket.dropped)
            XCTAssertEqual(call.id == nil, issued, "Unissued result retirement does not stop the call.")
            XCTAssertEqual(observed.map(\.rawValue), issued ? ["live_partial_tool_result_retired"] : [])
        }
    }
}
