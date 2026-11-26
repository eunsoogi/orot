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
            let owned = admission(model: model, functionName: "orot_health_context", allowed: true)
            let registry = try XCTUnwrap(LiveNativeToolRegistry(admission: owned))
            let configuration = try XCTUnwrap(registry.configuration(for: owned))
            let responses = try XCTUnwrap(configuration["responses"] as? [String: Any])
            XCTAssertEqual(responses["model"] as? String, model)
            let tools = try XCTUnwrap(responses["tools"] as? [[String: Any]])
            XCTAssertEqual(tools.compactMap { $0["name"] as? String }, ["orot_health_context"])
            let parameters = try XCTUnwrap(tools.first?["parameters"] as? [String: Any])
            XCTAssertEqual(parameters["required"] as? [String], ["topic", "days"])
            XCTAssertEqual(parameters["additionalProperties"] as? Bool, false)
            XCTAssertTrue(registry.allows("orot_health_context"))
            XCTAssertFalse(registry.allows("orot_personal_records"))
            XCTAssertFalse(registry.allows("orot_reviewed_memory"))
            XCTAssertNil(registry.configuration(for: admission(model: model, functionName: "orot_health_context", allowed: false)))
            XCTAssertNil(LiveNativeToolRegistry(admission: admission(model: model, functionName: "orot_personal_records", allowed: true)))
            let instruction = RealtimeVoiceCall.instructions(language: "en", tools: registry.eligible)
            XCTAssertTrue(instruction.contains("one bounded ordinary heart-rate average"))
            XCTAssertTrue(instruction.contains("do not claim other record access"))
        }
    }

    private static func admission(model: String, functionName: String, allowed: Bool) -> LiveResponsesAdmission {
        LiveResponsesAdmission(
            backendModel: model, functionName: functionName, backendAllowed: { allowed },
            mayRun: { _ in false }, approve: { _, finish in finish(false); return {} },
            execute: { _, finish in finish(nil); return {} }, mayDisclose: { _, _ in false },
        )
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
                task.writes.removeFirst()(nil)
                await fulfillment(of: [settled], timeout: 1)
                XCTAssertEqual(task.types, mode == "allowed" ? ["response.item.create", "response.create"] : ["response.item.create"])
                XCTAssertEqual(receipts, [mode == "allowed"])
            }
        }
    }

    private final class CommonV3NetworklessSocketTask: RealtimeVoiceSocketTask {
        var writes: [@Sendable (Error?) -> Void] = []
        var types: [String] = []
        func resume() {}
        func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
            types.append(RealtimeVoiceSocket.decodeSocketEvent(message)?["type"] as? String ?? "")
            writes.append(completionHandler)
        }

        func receive(completionHandler _: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {}
        func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {}
    }
#endif
