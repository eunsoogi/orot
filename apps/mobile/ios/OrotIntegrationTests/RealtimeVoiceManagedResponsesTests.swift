import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func testAdmittedLiveCallExecutesOneTypedToolAndUsesOnlyItsSameSocket() async throws {
        for (mute, backend) in [(false, "gpt-6-luna"), (true, "gpt-6-sol")] {
            let generation = String(repeating: "a", count: 64)
            let epoch = String(repeating: "b", count: 64)
            let request = ["backendModel": backend, "generation": generation, "grantID": generation + "-model"]
            let settings = try XCTUnwrap(LiveResponsesSettingsGrant(request))
            var status = "active"
            var selected = backend
            let read: (String, String) -> [String: Any]? = { _, account in
                switch account {
                case "settings-consent-authority":
                    ["version": 1, "status": status, "generation": generation]
                case "live-responses-settings":
                    ["version": 1, "backendModel": selected, "generation": generation,
                     "grantID": generation + "-model", "credentialEpoch": epoch]
                case "voice-settings":
                    ["mode": "openai-api", "model": "gpt-live-1.1",
                     "apiKey": "synthetic-key", "credentialEpoch": epoch]
                default:
                    nil
                }
            }
            XCTAssertTrue(settings.isCurrent(key: "synthetic-key", read: read))
            XCTAssertFalse(settings.isCurrent(key: "different-key", read: read))
            selected = backend == "gpt-6-luna" ? "gpt-6-sol" : "gpt-6-luna"
            XCTAssertFalse(settings.isCurrent(key: "synthetic-key", read: read))
            selected = backend; status = "revoked"
            XCTAssertFalse(settings.isCurrent(key: "synthetic-key", read: read))
            XCTAssertTrue(LiveResponsesAdmission.validAggregate(
                #"{"topic":"measurements","metric":"heart_rate","unit":"count/min","days":7,"sampleCount":3,"meanOfRecordedDailyMeans":66}"#,
                days: 7,
            ))
            XCTAssertFalse(LiveResponsesAdmission.validAggregate(
                #"{"topic":"measurements","metric":"heart_rate","unit":"count/min","days":7,"sampleCount":3,"meanOfRecordedDailyMeans":66,"text":"raw"}"#,
                days: 7,
            ))
            let socket = ManagedResponseFixtureSocket()
            let configured = expectation(description: "held Live socket configuration")
            let queued = expectation(description: "one owned result and continuation")
            socket.configured = { configured.fulfill() }
            socket.queued = { queued.fulfill() }
            let call = managedFixtureCall(socket)
            var invocations: [String] = []
            let admission = managedAdmission(backendModel: backend) { request, finish in
                XCTAssertEqual(request.query, "synthetic-only")
                invocations.append(request.functionID)
                finish("{\"status\":\"synthetic\"}")
                finish("must-not-send-twice")
                return {}
            }
            call.open("fixture-call", model: "gpt-live-1.1", key: "synthetic-key", language: "auto",
                      managedAdmission: admission) { _ in }
            await fulfillment(of: [configured], timeout: 2)
            let session = try XCTUnwrap(socket.controls.first?["session"] as? [String: Any])
            let delegation = session["delegation"] as? [String: Any]
            XCTAssertEqual(delegation?["type"] as? String, "responses")
            XCTAssertEqual((delegation?["responses"] as? [String: Any])?["model"] as? String, backend)
            socket.received?(started())
            for index in 0 ..< 64 {
                socket.received?(["type": "session.input_transcript.delta", "event_id": "lead-in-\(index)",
                                  "start_ms": 1, "end_ms": 2, "delta": "synthetic"])
            }
            let events = managedEvents()
            socket.received?(events[0])
            socket.received?(events[1])
            for index in 0 ..< 80 {
                socket.received?(["type": "response.event", "event_id": "reasoning-\(index)",
                                  "delegation_id": "delegation-a",
                                  "event": ["type": "response.output_item.done", "item": ["type": "reasoning"]]])
                socket.received?(["type": "session.input_transcript.delta", "event_id": "active-speech-\(index)",
                                  "start_ms": 1, "end_ms": 2, "delta": "synthetic"])
            }
            // A replay cannot retire the live operation even if its payload is different.
            socket.received?(["type": "session.input_transcript.delta", "event_id": "active-speech-0",
                              "start_ms": 6, "end_ms": 7, "delta": "synthetic"])
            for event in events.dropFirst(2) {
                socket.received?(event)
                socket.received?(event)
            }
            await fulfillment(of: [queued], timeout: 2)
            XCTAssertEqual(invocations, ["function-a"])
            XCTAssertEqual(socket.managed.map { $0["type"] as? String }, ["response.item.create", "response.create"])
            let result = socket.managed.first?["item"] as? [String: String]
            XCTAssertEqual(result?["call_id"], "function-a")
            XCTAssertEqual(result?["output"], "{\"status\":\"synthetic\"}")
            XCTAssertTrue(socket.handoff())
            if mute {
                // A held continuation cannot cross mute after an already handed result.
                try call.pause("fixture-call")
                XCTAssertTrue(socket.dropped)
                XCTAssertFalse(socket.handoff())
            } else {
                XCTAssertTrue(socket.handoff())
                XCTAssertFalse(socket.handoff())
                XCTAssertEqual(socket.handed, 2)
                try call.stop("fixture-call")
            }
        }
    }

    func testManagedReadNeverStartsOnNullOrMismatchedDelegationAndLateResultCannotCrossStop() async throws {
        for mode in ["null", "wrong", "stop", "new-speech", "second-call", "conflicting-replay", "conflicting-scope"] {
            let socket = ManagedResponseFixtureSocket()
            let configured = expectation(description: "test-only Live config \(mode)")
            socket.configured = { configured.fulfill() }
            let call = managedFixtureCall(socket)
            var hits = 0
            var late: ((String?) -> Void)?
            let entered = ["stop", "new-speech"].contains(mode) ? expectation(description: "held synthetic execution") : nil
            let admission = managedAdmission { _, finish in
                hits += 1
                late = finish
                entered?.fulfill()
                return {}
            }
            call.open("fixture-call", model: "gpt-live-1.1", key: "synthetic-key", language: "auto",
                      managedAdmission: admission) { _ in }
            await fulfillment(of: [configured], timeout: 2)
            socket.received?(started())
            var events = managedEvents()
            if entered == nil {
                if mode == "null" {
                    events[1]["delegation_id"] = NSNull()
                } else if mode == "wrong" {
                    events[1]["delegation_id"] = "other-delegation"
                } else {
                    let item = ["type": "function_call", "call_id": mode == "conflicting-scope" ? "function-a" : "function-b", "name": "orot_reviewed_memory",
                                "arguments": mode == "conflicting-scope" ? #"{"query":"different"}"# : #"{"query":"synthetic-only"}"#]
                    events.insert(["type": "response.event", "event_id": mode == "second-call" ? "second-item-event" : "item-event", "delegation_id": "delegation-a",
                                   "event": ["type": "response.output_item.done", "item": item]], at: events.count - 1)
                }
            }
            for event in events {
                socket.received?(event)
            }
            if let entered {
                await fulfillment(of: [entered], timeout: 2)
                XCTAssertEqual(hits, 1)
            } else {
                XCTAssertEqual(hits, 0)
            }
            if mode == "new-speech" {
                socket.received?(["type": "session.input_transcript.delta", "event_id": "new-speech-event",
                                  "start_ms": 6, "end_ms": 7, "delta": "synthetic"])
            } else if ["null", "wrong", "stop"].contains(mode) {
                try call.stop("fixture-call")
            }
            late?("{\"status\":\"stale\"}")
            let turn = expectation(description: "held callback drained \(mode)")
            DispatchQueue.main.async { turn.fulfill() }
            await fulfillment(of: [turn], timeout: 2)
            XCTAssertEqual(hits, entered == nil ? 0 : 1)
            XCTAssertTrue(socket.managed.isEmpty)
            if !["null", "wrong", "stop"].contains(mode) {
                try call.stop("fixture-call")
            }
        }
    }

    private func managedFixtureCall(_ socket: ManagedResponseFixtureSocket) -> RealtimeVoiceCall {
        RealtimeVoiceCall(audio: Audio(), socket: socket,
                          ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                          permission: { $0(true) }, foreground: { true }, emit: { _, _ in })
    }

    private func managedAdmission(
        backendModel: String = "gpt-6-luna",
        _ execute: @escaping (LiveResponsesAdmission.Request, @escaping (String?) -> Void) -> (() -> Void),
    ) -> LiveResponsesAdmission {
        LiveResponsesAdmission(backendModel: backendModel, functionName: "orot_reviewed_memory",
                               backendAllowed: { true }, mayRun: { $0.owner.callID == "fixture-call" },
                               approve: { _, finish in finish(true); return {} },
                               execute: execute, mayDisclose: { _, value in value.contains("synthetic") })
    }

    private func managedEvents() -> [[String: Any]] {
        func wrap(_ id: String, _ event: [String: Any]) -> [String: Any] {
            ["type": "response.event", "event_id": id, "delegation_id": "delegation-a", "event": event]
        }
        let item: [String: Any] = ["type": "function_call", "call_id": "function-a",
                                   "name": "orot_reviewed_memory", "arguments": "{\"query\":\"synthetic-only\"}"]
        return [
            ["type": "session.delegation.created", "event_id": "delegation-event", "offset_ms": 5,
             "delegation": ["type": "delegation", "id": "delegation-a", "target": "responses", "response_id": "response-a"]],
            wrap("response-event", ["type": "response.created", "response": ["id": "response-a"]]),
            wrap("item-event", ["type": "response.output_item.done", "item": item]),
            wrap("repeat-event", ["type": "response.output_item.done", "item": item]),
            wrap("done-event", ["type": "response.completed", "response": ["id": "response-a", "status": "completed", "output": []]]),
        ]
    }
}

private final class ManagedResponseFixtureSocket: RealtimeSocketPort {
    var received: (([String: Any]) -> Void)?
    var failed: (() -> Void)?
    var configured: (() -> Void)?
    var queued: (() -> Void)?
    var controls: [[String: Any]] = []
    var managed: [[String: Any]] = []
    var permit: LiveQueuedToolPermit?
    var dropped = false
    private(set) var handed = 0

    func open(model: String, key: String) {
        XCTAssertEqual(model, "gpt-live-1.1")
        XCTAssertEqual(key, "synthetic-key")
    }

    func admitResponsesTransport(_ current: @escaping () -> Bool) -> Bool {
        current()
    }

    func send(_ event: [String: Any]) {
        controls.append(event)
        if event["type"] as? String == "session.start" {
            configured?()
        }
    }

    func sendManagedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool) -> Bool {
        let next = LiveQueuedToolPermit(current: current)
        guard next.prepare(frames) != nil, permit == nil else { return false }
        managed = frames
        permit = next
        queued?()
        return true
    }

    func handoff() -> Bool {
        guard handed < managed.count, permit?.authorizeHandoff() == true else { return false }
        handed += 1
        permit?.issued = true
        return true
    }

    func discardManagedToolFrames() -> Bool {
        dropped = !managed.isEmpty
        let uncertain = handed > 0 && handed < managed.count
        permit = nil
        return uncertain
    }

    func discardInput() {}
    func close() {}
}
