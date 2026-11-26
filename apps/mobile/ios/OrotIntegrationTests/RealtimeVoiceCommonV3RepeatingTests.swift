import Foundation
@testable import Orot
import XCTest

#if OROT_TESTS && targetEnvironment(simulator)
    extension RealtimeVoiceLifecycleTests {
        @MainActor
        func testCommonV3TwoOwnedTurnsWaitForExactSameSocketWriteReceipts() async throws {
            for mode in ["serial", "replacement-before-receipt", "function-replay"] {
                let f = try CommonV3RepeatFixture()
                defer { f.close() }
                let requested = expectation(description: "first finished native delegation")
                f.onRequest = { requested.fulfill() }
                f.delegate("first", offset: 5)
                await fulfillment(of: [requested], timeout: 1)
                let first = try XCTUnwrap(f.challenge)
                let settled = expectation(description: "first correctly settled exact transport")
                var outcomes = [Bool]()
                f.settle(first) { outcomes.append($0); settled.fulfill() }
                await f.drainMain()
                XCTAssertEqual(f.task.frames, ["function-first"])
                let outputReceipt = f.task.completions.removeFirst()
                outputReceipt(nil)
                await f.drainMain()
                XCTAssertEqual(f.task.frames, ["function-first", "response.create"])
                XCTAssertTrue(outcomes.isEmpty)
                let oldContinuation = f.task.completions.removeFirst()

                if mode == "replacement-before-receipt" {
                    f.onRequest = { XCTFail("Ambiguous successor cannot execute.") }
                    f.delegate("second", offset: 10)
                    oldContinuation(nil)
                    await fulfillment(of: [settled], timeout: 1)
                    XCTAssertEqual(outcomes, [false])
                    XCTAssertEqual(f.task.frames, ["function-first", "response.create"])
                    continue
                }

                outputReceipt(nil) // Stale callback cannot acknowledge the next queue item.
                await f.drainMain()
                XCTAssertTrue(outcomes.isEmpty)
                oldContinuation(nil)
                await fulfillment(of: [settled], timeout: 1)
                XCTAssertEqual(outcomes, [true])
                let successor = expectation(description: "only the distinct next delegate may dispatch")
                successor.isInverted = mode == "function-replay"
                f.onRequest = { successor.fulfill() }
                f.delegate("first", offset: 5) // Replay the complete old set of event IDs.
                f.delegate("second", offset: 10, function: mode == "function-replay" ? "function-first" : nil)
                await fulfillment(of: [successor], timeout: mode == "function-replay" ? 0.1 : 1)
                if mode == "function-replay" {
                    XCTAssertEqual(f.task.frames, ["function-first", "response.create"])
                    continue
                }
                let second = try XCTUnwrap(f.challenge)
                XCTAssertNotEqual(first, second)
                let secondSettled = expectation(description: "second correctly settled exact transport")
                f.settle(second) { outcomes.append($0); secondSettled.fulfill() }
                await f.drainMain()
                oldContinuation(nil) // Already consumed, cannot remove second's pending output.
                await f.drainMain()
                XCTAssertEqual(f.task.frames, ["function-first", "response.create", "function-second"])
                XCTAssertEqual(outcomes, [true])
                f.task.completions.removeFirst()(nil)
                await f.drainMain()
                XCTAssertEqual(outcomes, [true])
                f.task.completions.removeFirst()(nil)
                await fulfillment(of: [secondSettled], timeout: 1)
                XCTAssertEqual(outcomes, [true, true])
                XCTAssertEqual(f.task.frames, ["function-first", "response.create", "function-second", "response.create"])
            }
        }
    }

    @MainActor
    private final class CommonV3RepeatFixture {
        let owner = LiveResponsesAdmission.Owner(callID: "fixture-call", sessionID: "fixture-session", epoch: UUID())
        let pins = LiveCommonV3SourcePins()
        let task = CommonV3HeldSocketTask()
        let output = #"{"tool":"local-health-context","items":[{"evidenceId":"fixture","evidenceRevision":"1","content":"Synthetic"}]}"#
        private(set) var socket: RealtimeVoiceSocket!
        private var bridge: LiveResponsesToolBridge?
        private var transport: LiveCanonicalContextV3Transport!
        private(set) var challenge: String?
        var onRequest: (() -> Void)?

        init() throws {
            socket = RealtimeVoiceSocket(endpoint: RealtimeVoiceSocketEndpoint(networklessTask: { [task] in task }))
            socket.failed = { [weak socket] in socket?.close() }
            let selected = LiveConversationToolsSettingsWitness(backendModel: "gpt-6-luna", credentialEpoch: "fixture",
                                                                generation: "generation", grantID: "generation-model", voiceGeneration: "voice")
            transport = try XCTUnwrap(LiveCanonicalContextV3Transport(call: owner.callID,
                                                                      requested: LiveCanonicalContextV3Transport.registration(selected), witness: { selected },
                                                                      startupCurrent: { [weak self] in $0 == self?.owner.callID }, owns: { [weak self] in $0 == self?.owner },
                                                                      ownsRequest: { [weak self] in self?.bridge?.ownsCompleted($0) == true }, sourceTicketCurrent: pins.matches))
            let admission = transport.bridge(pins: pins) { [weak self] event, body in
                guard let self, event == "VoiceRealtimeCommonToolBatch" else { return }
                challenge = (body["calls"] as? [[String: String]])?.first?["challengeId"]
                onRequest?()
            }
            let registry = try XCTUnwrap(LiveNativeToolRegistry(admission: admission))
            XCTAssertNotNil(registry.configuration(for: admission))
            socket.open(model: "gpt-live-1.1", key: "synthetic")
            XCTAssertNotNil(transport.acknowledge(owner))
            bridge = LiveResponsesToolBridge(admission: admission, registry: registry) { [weak socket] in
                if socket?.discardManagedToolFrames() == true {
                    socket?.close()
                }
            }
        }

        func delegate(_ label: String, offset: Int, function: String? = nil) {
            let delegation = "delegation-" + label, response = "response-" + label
            let item: [String: Any] = ["type": "function_call", "call_id": function ?? "function-" + label,
                                       "name": "local-health-context", "arguments": "{}"]
            func receive(_ id: String, _ event: [String: Any]) {
                submit(["type": "response.event", "event_id": label + id, "delegation_id": delegation, "event": event])
            }
            submit(["type": "session.delegation.created", "event_id": label + "-delegation", "offset_ms": offset,
                    "delegation": ["type": "delegation", "id": delegation, "target": "responses", "response_id": response]])
            receive("-created", ["type": "response.created", "response": ["id": response]])
            receive("-done", ["type": "response.output_item.done", "item": item])
            receive("-completed", ["type": "response.completed", "response": ["id": response, "status": "completed"]])
        }

        private func submit(_ event: [String: Any]) {
            bridge?.receive(event, owner: owner, current: { true }) { [weak socket] frames, current, ticket in
                guard let ticket else { XCTFail("Missing owned V3 ticket"); return }
                XCTAssertEqual(socket?.sendTicketedToolFrames(frames, current: current, ticket: ticket), true)
            }
        }

        func settle(_ challenge: String, got: @escaping (Bool) -> Void) {
            XCTAssertTrue(pins.claim(owner.callID, challenge, output))
            transport.settleBridge(callId: owner.callID, challenge: challenge, exact: output, completion: got)
        }

        func drainMain() async {
            // Actual socket callback and bridge submission each have a bounded main hop.
            for _ in 0 ..< 3 {
                await withCheckedContinuation { (step: CheckedContinuation<Void, Never>) in
                    DispatchQueue.main.async { step.resume() }
                }
            }
        }

        func close() {
            bridge?.retire(); transport.retire(); socket.close()
        }
    }

    private final class CommonV3HeldSocketTask: RealtimeVoiceSocketTask {
        var completions: [@Sendable (Error?) -> Void] = []
        var frames: [String] = []
        func resume() {}
        func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
            let frame = RealtimeVoiceSocket.decodeSocketEvent(message)
            frames.append((frame?["item"] as? [String: Any])?["call_id"] as? String ?? frame?["type"] as? String ?? "invalid")
            completions.append(completionHandler)
        }

        func receive(completionHandler _: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {}
        func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {}
    }
#endif
